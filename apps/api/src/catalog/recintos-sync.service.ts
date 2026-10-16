import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type {
  CambioCampoRecinto,
  CambioSyncRecinto,
  ErrorSyncRecinto,
  SyncRecintosPreview,
  SyncRecintosResultado,
  TipoRecinto,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { RecintosSheetClient, type RecintoSheet } from './recintos-sheet.client';

/** Recinto tal como está hoy en la base. */
interface RecintoBd {
  id: string;
  codigoRecinto: string;
  nombre: string;
  direccion: string | null;
  cantonId: number;
  parroquia: string | null;
  zona: string | null;
  tipo: TipoRecinto;
  cdaDestinoCodigo: string | null;
  lat: number | null;
  lng: number | null;
  tieneInternet: boolean;
  coberturaMovil: boolean;
  numeroElectores: number | null;
  juntasFemeninas: number | null;
  juntasMasculinas: number | null;
  esDificilAcceso: boolean;
  activo: boolean;
}

/** Lo que se va a escribir para un recinto del Sheet (ya validado). */
interface Destino extends Omit<RecintoSheet, 'cantonCodigo' | 'latitud' | 'longitud'> {
  cantonId: number;
  latitud: number;
  longitud: number;
}

interface Plan {
  leidos: { cda: number; noCda: number };
  sinCambios: number;
  /** Altas y cambios, CDA primero: los NO CDA apuntan a CDA que deben existir antes. */
  escribir: Array<{ cambio: CambioSyncRecinto; destino: Destino; existente?: RecintoBd }>;
  ocultar: Array<{ cambio: CambioSyncRecinto; id: string }>;
  errores: ErrorSyncRecinto[];
  congelado: boolean;
  ocultamientoMasivo: boolean;
}

/** Caja amplia alrededor de Imbabura: una coordenada fuera es un error de tipeo en el Sheet. */
const LIMITES = { latMin: -0.3, latMax: 1.3, lngMin: -79.6, lngMax: -77.4 };
/** ~0,1 m: diferencias menores son redondeo del Sheet, no un cambio real. */
const TOLERANCIA_COORD = 1e-6;
/**
 * Ocultar más del 20 % de los recintos activos (y más de 5) huele a un Sheet
 * roto, no a un cambio real: se muestra en la vista previa pero no se aplica.
 */
const MAX_PROPORCION_OCULTAR = 0.2;
const MIN_OCULTAR_SIN_ALERTA = 5;
/** Largo de las columnas en la base: un valor más largo abortaría toda la transacción. */
const MAX_NOMBRE = 255;
const MAX_DIRECCION = 255;
const MAX_PARROQUIA_ZONA = 120;
/** Ninguna junta ni recinto llega a esto; un número mayor es un error de tipeo (y desbordaría int4). */
const MAX_ENTERO = 1_000_000;
/** Serializa dos sincronizaciones simultáneas (doble clic, dos administradores). */
const LOCK_SYNC_RECINTOS = 72_014_016;

const siNo = (v: boolean) => (v ? 'Sí' : 'No');
const textoTipo = (t: TipoRecinto) => (t === 'CDA' ? 'CDA' : 'NO CDA');
const textoDestino = (codigo: string | null) => codigo ?? 'Delegación (sin CDA)';
const textoValor = (v: string | number | null) => (v === null || v === '' ? '—' : String(v));
const mismaParroquia = (a: string | null, b: string | null) =>
  (a ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, '').toUpperCase() ===
  (b ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, '').toUpperCase();

@Injectable()
export class RecintosSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sheet: RecintosSheetClient,
  ) {}

  /** Qué cambiaría si se sincroniza ahora. No escribe nada. */
  async preview(): Promise<SyncRecintosPreview> {
    const plan = await this.planificar();
    return {
      leidos: plan.leidos,
      sinCambios: plan.sinCambios,
      cambios: [...plan.escribir.map((e) => e.cambio), ...plan.ocultar.map((o) => o.cambio)],
      errores: plan.errores,
      congelado: plan.congelado,
      ocultamientoMasivo: plan.ocultamientoMasivo,
    };
  }

  /**
   * Vuelve a leer el Sheet (no confía en una vista previa vieja) y aplica en
   * una sola transacción todo lo que no tiene error.
   */
  async aplicar(): Promise<SyncRecintosResultado> {
    const plan = await this.planificar();
    if (plan.congelado) {
      throw new BadRequestException(
        'La jornada electoral ya inició: no se pueden cambiar los recintos desde el Sheet hasta cerrar el evento.',
      );
    }
    if (plan.ocultamientoMasivo) {
      throw new BadRequestException(
        `Se ocultarían ${plan.ocultar.length} recintos de una vez: revise que el Google Sheet esté completo antes de sincronizar.`,
      );
    }

    // Recintos que no pueden tener kits al momento de escribir (se ocultan o dejan de ser CDA).
    const sinKits = [
      ...plan.ocultar.map((o) => o.id),
      ...plan.escribir.filter((e) => e.existente?.tipo === 'CDA' && e.destino.tipo === 'NO_CDA').map((e) => e.existente!.id),
    ];

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK_SYNC_RECINTOS})`;
        // Entre la vista previa y este punto alguien pudo asignar un kit.
        const evento =
          sinKits.length > 0
            ? await tx.eventoElectoral.findFirst({ where: { estado: 'ACTIVO' }, select: { id: true } })
            : null;
        if (evento) {
          const kit = await tx.kitElectoral.findFirst({
            where: { recintoId: { in: sinKits }, eventoId: evento.id },
            select: { recinto: { select: { codigoRecinto: true } } },
          });
          if (kit) {
            throw new ConflictException(
              `Se asignó un kit al recinto ${kit.recinto?.codigoRecinto} mientras se revisaba: vuelva a leer el Sheet.`,
            );
          }
        }
        const idPorCodigo = new Map<string, string>(
          (await tx.recinto.findMany({ select: { id: true, codigoRecinto: true } })).map((r): [string, string] => [
            r.codigoRecinto,
            r.id,
          ]),
        );
        for (const { destino: d, existente } of plan.escribir) {
          const cdaDestinoId = d.cdaDestinoCodigo ? (idPorCodigo.get(d.cdaDestinoCodigo) ?? null) : null;
          if (existente) {
            await tx.$executeRaw`
              UPDATE recintos SET
                nombre = ${d.nombre}, direccion = ${d.direccion}, canton_id = ${d.cantonId},
                parroquia = ${d.parroquia}, zona = ${d.zona}, tipo = ${d.tipo}::tipo_recinto,
                cda_destino_id = ${cdaDestinoId}::uuid,
                ubicacion = ST_SetSRID(ST_MakePoint(${d.longitud}, ${d.latitud}), 4326)::geography,
                tiene_internet = ${d.tieneInternet}, cobertura_movil = ${d.coberturaMovil},
                numero_electores = ${d.numeroElectores}, juntas_femeninas = ${d.juntasFemeninas},
                juntas_masculinas = ${d.juntasMasculinas}, es_dificil_acceso = ${d.esDificilAcceso},
                activo = true
              WHERE id = ${existente.id}::uuid
            `;
          } else {
            const id = crypto.randomUUID();
            await tx.$executeRaw`
              INSERT INTO recintos (
                id, codigo_recinto, nombre, direccion, canton_id, parroquia, zona, tipo, cda_destino_id,
                ubicacion, tiene_internet, cobertura_movil, numero_electores,
                juntas_femeninas, juntas_masculinas, es_dificil_acceso, activo
              ) VALUES (
                ${id}::uuid, ${d.codigoRecinto}, ${d.nombre}, ${d.direccion}, ${d.cantonId}, ${d.parroquia},
                ${d.zona}, ${d.tipo}::tipo_recinto, ${cdaDestinoId}::uuid,
                ST_SetSRID(ST_MakePoint(${d.longitud}, ${d.latitud}), 4326)::geography,
                ${d.tieneInternet}, ${d.coberturaMovil}, ${d.numeroElectores},
                ${d.juntasFemeninas}, ${d.juntasMasculinas}, ${d.esDificilAcceso}, true
              )
            `;
            idPorCodigo.set(d.codigoRecinto, id);
          }
        }
        const ocultar = plan.ocultar.map((o) => o.id);
        if (ocultar.length > 0) {
          await tx.recinto.updateMany({ where: { id: { in: ocultar } }, data: { activo: false } });
        }
      },
      { timeout: 60_000 },
    );

    const creados = plan.escribir.filter((e) => !e.existente).length;
    return {
      aplicados: plan.escribir.length + plan.ocultar.length,
      creados,
      actualizados: plan.escribir.length - creados,
      ocultados: plan.ocultar.length,
      errores: plan.errores,
    };
  }

  private async planificar(): Promise<Plan> {
    const [filas, cantones, bd, kitsActivos, congelado] = await Promise.all([
      this.sheet.leer(),
      this.prisma.canton.findMany({ select: { id: true, codigo: true, nombre: true } }),
      this.leerBd(),
      this.kitsEnEventoActivo(),
      this.jornadaIniciada(),
    ]);
    // Un Sheet vacío (hoja renombrada, filtro activo, archivo equivocado) ocultaría todo.
    if (filas.length === 0) {
      throw new BadRequestException('El Google Sheet no trae ningún recinto: revise las hojas antes de sincronizar.');
    }
    const cantonPorCodigo = new Map<string, { id: number; nombre: string }>(
      cantones.map((c): [string, { id: number; nombre: string }] => [c.codigo.trim(), { id: c.id, nombre: c.nombre }]),
    );
    const cantonNombre = new Map<number, string>(cantones.map((c): [number, string] => [c.id, c.nombre]));
    const bdPorCodigo = new Map<string, RecintoBd>(bd.map((r): [string, RecintoBd] => [r.codigoRecinto, r]));
    const codigosSheet = new Set(filas.map((f) => f.codigoRecinto));
    const cdasSheet = filas.filter((f) => f.tipo === 'CDA');
    const codigosCdaSheet = new Set(cdasSheet.map((f) => f.codigoRecinto));

    const errores: ErrorSyncRecinto[] = [];
    const conError = new Set<string>();
    const fallar = (codigoRecinto: string, nombre: string, error: string) => {
      errores.push({ codigoRecinto, nombre, error });
      conError.add(codigoRecinto);
    };

    // CDA del Sheet que hoy no son CDA activos: candidatos a haber reemplazado a uno que salió.
    const cdasNuevos = cdasSheet.filter((f) => {
      const actual = bdPorCodigo.get(f.codigoRecinto);
      return !actual || actual.tipo !== 'CDA' || !actual.activo;
    });

    const escribir: Plan['escribir'] = [];
    let sinCambios = 0;
    // CDA primero: al aplicar, los NO CDA deben encontrar ya creado su CDA destino.
    const ordenadas = [...cdasSheet, ...filas.filter((f) => f.tipo === 'NO_CDA')];
    for (const fila of ordenadas) {
      const existente = bdPorCodigo.get(fila.codigoRecinto);
      const canton = cantonPorCodigo.get(fila.cantonCodigo);
      if (!canton) {
        fallar(fila.codigoRecinto, fila.nombre, `Cantón ${fila.cantonCodigo || '(vacío)'} no existe en el sistema`);
        continue;
      }
      if (!coordenadaValida(fila.latitud, fila.longitud)) {
        fallar(fila.codigoRecinto, fila.nombre, 'Coordenadas vacías o fuera de Imbabura (columnas lat/long)');
        continue;
      }
      const invalido = validarFila(fila);
      if (invalido) {
        fallar(fila.codigoRecinto, fila.nombre, invalido);
        continue;
      }

      let cdaDestinoCodigo: string | null = null;
      let nota: string | undefined;
      if (fila.tipo === 'NO_CDA' && fila.cdaDestinoCodigo && /^\d+$/.test(fila.cdaDestinoCodigo)) {
        if (codigosCdaSheet.has(fila.cdaDestinoCodigo)) {
          cdaDestinoCodigo = fila.cdaDestinoCodigo;
        } else {
          const reemplazo = buscarReemplazo(bdPorCodigo.get(fila.cdaDestinoCodigo), cdasNuevos);
          if (!reemplazo) {
            fallar(
              fila.codigoRecinto,
              fila.nombre,
              `Su CDA destino ${fila.cdaDestinoCodigo} no está en la hoja de CDAs y no se encontró un único CDA que lo reemplace en la misma parroquia`,
            );
            continue;
          }
          cdaDestinoCodigo = reemplazo;
          nota = `El CDA ${fila.cdaDestinoCodigo} ya no está en la hoja de CDAs: se asigna ${reemplazo}, que lo reemplazó en la misma parroquia.`;
        }
        if (conError.has(cdaDestinoCodigo)) {
          fallar(fila.codigoRecinto, fila.nombre, `Su CDA destino ${cdaDestinoCodigo} tiene errores en el Sheet`);
          continue;
        }
      }

      if (existente?.tipo === 'CDA' && fila.tipo === 'NO_CDA' && (kitsActivos.get(existente.id) ?? 0) > 0) {
        fallar(
          fila.codigoRecinto,
          fila.nombre,
          `Pasa a NO CDA pero tiene ${kitsActivos.get(existente.id)} kit(s) en el evento activo: reasígnelos antes de sincronizar`,
        );
        continue;
      }

      const destino: Destino = {
        ...fila,
        cantonId: canton.id,
        latitud: fila.latitud!,
        longitud: fila.longitud!,
        cdaDestinoCodigo,
      };
      if (!existente) {
        escribir.push({
          cambio: { codigoRecinto: fila.codigoRecinto, nombre: fila.nombre, accion: 'CREAR', cambios: [], nota },
          destino,
        });
        continue;
      }
      const cambios = diferencias(existente, destino, cantonNombre);
      if (cambios.length === 0 && existente.activo) {
        sinCambios++;
        continue;
      }
      escribir.push({
        cambio: {
          codigoRecinto: fila.codigoRecinto,
          nombre: fila.nombre,
          accion: existente.activo ? 'ACTUALIZAR' : 'REACTIVAR',
          cambios,
          nota,
        },
        destino,
        existente,
      });
    }

    let ocultar: Plan['ocultar'] = [];
    for (const r of bd) {
      if (!r.activo || codigosSheet.has(r.codigoRecinto)) continue;
      const kits = kitsActivos.get(r.id) ?? 0;
      if (kits > 0) {
        fallar(
          r.codigoRecinto,
          r.nombre,
          `Ya no está en el Sheet pero tiene ${kits} kit(s) en el evento activo: reasígnelos antes de sincronizar`,
        );
        continue;
      }
      ocultar.push({
        cambio: { codigoRecinto: r.codigoRecinto, nombre: r.nombre, accion: 'OCULTAR', cambios: [] },
        id: r.id,
      });
    }

    // Un CDA que se oculta o pasa a NO CDA no puede dejar NO CDA activos
    // apuntándole (p. ej. uno que no se actualiza por un error en su fila):
    // mismo criterio que al cambiarlo a mano.
    const ocultos = new Set(ocultar.map((o) => o.cambio.codigoRecinto));
    const destinoFinal = new Map<string, string | null>();
    for (const r of bd) {
      if (r.activo && !ocultos.has(r.codigoRecinto)) destinoFinal.set(r.codigoRecinto, r.cdaDestinoCodigo);
    }
    for (const e of escribir) destinoFinal.set(e.destino.codigoRecinto, e.destino.cdaDestinoCodigo);
    const dejanDeSerCda = [
      ...ocultar.map((o) => o.cambio),
      ...escribir.filter((e) => e.existente?.tipo === 'CDA' && e.destino.tipo === 'NO_CDA').map((e) => e.cambio),
    ];
    const bloqueados = new Set<string>();
    for (const { codigoRecinto, nombre } of dejanDeSerCda) {
      const dependientes = [...destinoFinal].filter(([c, d]) => d === codigoRecinto && c !== codigoRecinto).map(([c]) => c);
      if (dependientes.length === 0) continue;
      fallar(
        codigoRecinto,
        nombre,
        `Dejaría sin CDA a ${dependientes.length} NO CDA que siguen apuntándole (${dependientes.join(', ')}): corríjalos en el Sheet`,
      );
      bloqueados.add(codigoRecinto);
    }
    ocultar = ocultar.filter((o) => !bloqueados.has(o.cambio.codigoRecinto));
    const escribirFinal = escribir.filter((e) => !bloqueados.has(e.destino.codigoRecinto));

    const activos = bd.filter((r) => r.activo).length;
    return {
      leidos: { cda: cdasSheet.length, noCda: filas.length - cdasSheet.length },
      sinCambios,
      escribir: escribirFinal,
      ocultar,
      errores,
      congelado,
      ocultamientoMasivo: ocultar.length > Math.max(MIN_OCULTAR_SIN_ALERTA, Math.ceil(activos * MAX_PROPORCION_OCULTAR)),
    };
  }

  private leerBd(): Promise<RecintoBd[]> {
    return this.prisma.$queryRaw<RecintoBd[]>`
      SELECT r.id, r.codigo_recinto AS "codigoRecinto", r.nombre, r.direccion, r.canton_id AS "cantonId",
             r.parroquia, r.zona, r.tipo::text AS tipo, d.codigo_recinto AS "cdaDestinoCodigo",
             ST_Y(r.ubicacion::geometry) AS lat, ST_X(r.ubicacion::geometry) AS lng,
             r.tiene_internet AS "tieneInternet", r.cobertura_movil AS "coberturaMovil",
             r.numero_electores AS "numeroElectores", r.juntas_femeninas AS "juntasFemeninas",
             r.juntas_masculinas AS "juntasMasculinas", r.es_dificil_acceso AS "esDificilAcceso", r.activo
      FROM recintos r
      LEFT JOIN recintos d ON d.id = r.cda_destino_id
    `;
  }

  /** Kits por recinto en el evento activo (igual criterio que al pasar un CDA a NO CDA a mano). */
  private async kitsEnEventoActivo(): Promise<Map<string, number>> {
    const evento = await this.prisma.eventoElectoral.findFirst({ where: { estado: 'ACTIVO' }, select: { id: true } });
    if (!evento) return new Map();
    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId: evento.id, recintoId: { not: null } },
      select: { recintoId: true },
    });
    const porRecinto = new Map<string, number>();
    for (const k of kits) porRecinto.set(k.recintoId!, (porRecinto.get(k.recintoId!) ?? 0) + 1);
    return porRecinto;
  }

  /** Mismo criterio que el freeze de asignaciones (HU12-CA6): evento ACTIVO y jornada alcanzada. */
  private async jornadaIniciada(): Promise<boolean> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { fechaJornada: true },
    });
    if (!evento) return false;
    return new Date().toISOString().slice(0, 10) >= evento.fechaJornada.toISOString().slice(0, 10);
  }
}

function validarFila(f: RecintoSheet): string | null {
  if (!f.nombre.trim()) return 'Nombre vacío (columna NOMBRE RECINTO)';
  if (f.nombre.length > MAX_NOMBRE) return `Nombre de más de ${MAX_NOMBRE} caracteres`;
  if ((f.direccion ?? '').length > MAX_DIRECCION) return `Dirección de más de ${MAX_DIRECCION} caracteres`;
  if ((f.parroquia ?? '').length > MAX_PARROQUIA_ZONA) return `Parroquia de más de ${MAX_PARROQUIA_ZONA} caracteres`;
  if ((f.zona ?? '').length > MAX_PARROQUIA_ZONA) return `Zona de más de ${MAX_PARROQUIA_ZONA} caracteres`;
  const enteros: [string, number | null][] = [
    ['Electores', f.numeroElectores],
    ['Juntas femeninas', f.juntasFemeninas],
    ['Juntas masculinas', f.juntasMasculinas],
  ];
  const fuera = enteros.find(([, v]) => v !== null && v > MAX_ENTERO);
  return fuera ? `${fuera[0]} fuera de rango (${fuera[1]})` : null;
}

function coordenadaValida(lat: number | null, lng: number | null): boolean {
  return (
    lat !== null &&
    lng !== null &&
    lat >= LIMITES.latMin &&
    lat <= LIMITES.latMax &&
    lng >= LIMITES.lngMin &&
    lng <= LIMITES.lngMax
  );
}

/**
 * Si un CDA salió de la hoja de CDAs, su reemplazo es el único CDA nuevo de la
 * misma parroquia y cantón (p. ej. 1207 → 8587). Con cero o varios candidatos
 * no se adivina.
 */
function buscarReemplazo(anterior: RecintoBd | undefined, cdasNuevos: RecintoSheet[]): string | null {
  if (!anterior) return null;
  const candidatos = cdasNuevos.filter(
    (c) => c.codigoRecinto !== anterior.codigoRecinto && mismaParroquia(c.parroquia, anterior.parroquia),
  );
  return candidatos.length === 1 ? candidatos[0].codigoRecinto : null;
}

function diferencias(a: RecintoBd, d: Destino, cantonNombre: Map<number, string>): CambioCampoRecinto[] {
  const cambios: CambioCampoRecinto[] = [];
  const comparar = (campo: string, antes: string, despues: string) => {
    if (antes !== despues) cambios.push({ campo, antes, despues });
  };
  comparar('Nombre', a.nombre, d.nombre);
  comparar('Dirección', textoValor(a.direccion), textoValor(d.direccion));
  comparar('Cantón', cantonNombre.get(a.cantonId) ?? String(a.cantonId), cantonNombre.get(d.cantonId) ?? String(d.cantonId));
  comparar('Parroquia', textoValor(a.parroquia), textoValor(d.parroquia));
  comparar('Zona', textoValor(a.zona), textoValor(d.zona));
  comparar('Tipo', textoTipo(a.tipo), textoTipo(d.tipo));
  comparar('CDA destino', textoDestino(a.cdaDestinoCodigo), textoDestino(d.cdaDestinoCodigo));
  const movido =
    a.lat === null ||
    a.lng === null ||
    Math.abs(a.lat - d.latitud) > TOLERANCIA_COORD ||
    Math.abs(a.lng - d.longitud) > TOLERANCIA_COORD;
  if (movido) {
    const fmt = (lat: number | null, lng: number | null) =>
      lat === null || lng === null ? '—' : `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    cambios.push({ campo: 'Coordenadas', antes: fmt(a.lat, a.lng), despues: fmt(d.latitud, d.longitud) });
  }
  comparar('Internet', siNo(a.tieneInternet), siNo(d.tieneInternet));
  comparar('Cobertura móvil', siNo(a.coberturaMovil), siNo(d.coberturaMovil));
  comparar('Electores', textoValor(a.numeroElectores), textoValor(d.numeroElectores));
  comparar('Juntas femeninas', textoValor(a.juntasFemeninas), textoValor(d.juntasFemeninas));
  comparar('Juntas masculinas', textoValor(a.juntasMasculinas), textoValor(d.juntasMasculinas));
  comparar('Difícil acceso', siNo(a.esDificilAcceso), siNo(d.esDificilAcceso));
  return cambios;
}
