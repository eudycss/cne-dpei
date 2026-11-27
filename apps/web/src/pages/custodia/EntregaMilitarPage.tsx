import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { KitCustodiaResponse, MilitarResumen, OperadorResumen } from '@cne/shared-types';
import { leerCodigoQrKit } from '@cne/shared-validation';
import { CamaraQr } from '../operadores-cda/CamaraQr';
import { mensajeError } from '../operadores-cda/utils';
import {
  buscarMilitares,
  buscarOperadores,
  cambiarOperador,
  corregirMilitar,
  getResumenCustodia,
  registrarEntrega,
  validarKitCustodia,
} from '../../lib/queries/custodia';
import { type OpcionPersona, SelectorPersona } from './SelectorPersona';

type Modo = 'NINGUNO' | 'ENTREGAR' | 'CORREGIR_MILITAR' | 'CAMBIAR_OPERADOR';

export const MOTIVO_MIN = 5;
/** Tras cerrar un kit (o leer uno que no existe), la cámara no vuelve a buscar ese código por este tiempo. */
export const ESPERA_MISMO_QR_MS = 5000;

function opcionMilitar(m: MilitarResumen, recintoKitId: string | null): OpcionPersona {
  return {
    id: m.id,
    titulo: `${m.apellidos} ${m.nombres}`,
    detalle: `C.I. ${m.cedula} · ${m.recintoNombre}`,
    aviso: recintoKitId && m.recintoId !== recintoKitId ? 'De otro recinto' : undefined,
  };
}

function opcionOperador(o: OperadorResumen): OpcionPersona {
  return { id: o.id, titulo: `${o.apellidos} ${o.nombres}`, detalle: `C.I. ${o.cedula}` };
}

function hora(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' });
}

const TEXTO_BOTON: Record<Exclude<Modo, 'NINGUNO'>, string> = {
  ENTREGAR: 'Registrar entrega',
  CORREGIR_MILITAR: 'Guardar cambio de militar',
  CAMBIAR_OPERADOR: 'Guardar cambio de operador',
};

/**
 * Entrega de kits a militares desde el navegador del celular (para el Asistente
 * Electoral Transversal con iPhone, donde la APK no se instala). Mismo flujo que
 * la app: escanear el QR del kit, confirmar el militar del recinto (o buscar
 * otro) y registrar; hasta que el CDA recibe el kit se puede corregir el militar
 * o cambiar el operador, siempre con motivo. Fuera del menú lateral para que
 * quepa en la pantalla del teléfono.
 */
export function EntregaMilitarPage() {
  const qc = useQueryClient();
  const resumen = useQuery({ queryKey: ['custodia-resumen'], queryFn: getResumenCustodia });

  const [camara, setCamara] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [validando, setValidando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [kit, setKit] = useState<KitCustodiaResponse | null>(null);
  const [modo, setModo] = useState<Modo>('NINGUNO');
  const [seleccion, setSeleccion] = useState<OpcionPersona | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  // En refs: la cámara lee varias veces por segundo y el estado llega tarde.
  const enCurso = useRef(false);
  const guardandoRef = useRef(false);
  const hayKit = useRef(false);
  const bloqueado = useRef<{ codigo: string; hasta: number } | null>(null);
  const tituloKitRef = useRef<HTMLHeadingElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  hayKit.current = !!kit;

  // El foco sigue al contenido: a la ficha del kit al abrirla y al título al volver.
  const kitId = kit?.kitId ?? null;
  const habiaKit = useRef(false);
  useEffect(() => {
    if (kitId) tituloKitRef.current?.focus();
    else if (habiaKit.current) tituloRef.current?.focus();
    habiaKit.current = !!kitId;
  }, [kitId]);

  function abrir(k: KitCustodiaResponse) {
    setKit(k);
    setMotivo('');
    setErrorGuardar(null);
    if (!k.entrega && k.editable) {
      setModo('ENTREGAR');
      // Con un solo militar en el recinto, queda propuesto.
      const unico = k.militaresRecinto.length === 1 ? k.militaresRecinto[0] : null;
      setSeleccion(unico ? opcionMilitar(unico, k.recinto?.id ?? null) : null);
    } else {
      setModo('NINGUNO');
      setSeleccion(null);
    }
  }

  /** `desdeCamara`: lecturas automáticas (se ignoran repetidas); escrito a mano siempre se busca. */
  async function buscarKit(valor: string, desdeCamara: boolean) {
    if (enCurso.current || hayKit.current) return;
    const leido = leerCodigoQrKit(valor);
    if (!leido) {
      setError('Ese código no es de un kit. Escanee la etiqueta pegada en la mochila.');
      return;
    }
    const b = bloqueado.current;
    if (desdeCamara && b?.codigo === leido && Date.now() < b.hasta) return;
    enCurso.current = true;
    setValidando(true);
    setError(null);
    setAviso(null);
    try {
      abrir(await validarKitCustodia(leido));
      setCodigo('');
    } catch (e) {
      // Con cualquier error la cámara espera antes de repetir ese código (si sigue frente al
      // lector no se dispara una petición tras otra); escrito a mano se reintenta enseguida.
      bloqueado.current = desdeCamara ? { codigo: leido, hasta: Date.now() + ESPERA_MISMO_QR_MS } : null;
      setError(mensajeError(e, 'No se pudo validar el kit. Revise la conexión e intente de nuevo.'));
    } finally {
      enCurso.current = false;
      setValidando(false);
    }
  }

  function siguienteKit() {
    if (kit) bloqueado.current = { codigo: kit.codigoUnico, hasta: Date.now() + ESPERA_MISMO_QR_MS };
    setKit(null);
    setModo('NINGUNO');
    setSeleccion(null);
    setMotivo('');
    setErrorGuardar(null);
  }

  function empezar(m: Modo) {
    setModo(m);
    setSeleccion(null);
    setMotivo('');
    setErrorGuardar(null);
  }

  const recintoKitId = kit?.recinto?.id ?? null;
  // Al corregir, no se ofrece al militar que ya tiene el kit (sería un cambio que no cambia nada).
  const militarActualId = modo === 'CORREGIR_MILITAR' ? (kit?.entrega?.militar.id ?? undefined) : undefined;
  const buscarMilitar = useCallback(
    async (q: string) => (await buscarMilitares(q)).map((m) => opcionMilitar(m, recintoKitId)),
    [recintoKitId],
  );
  const buscarOperador = useCallback(async (q: string) => (await buscarOperadores(q)).map(opcionOperador), []);

  const requiereMotivo = modo === 'CORREGIR_MILITAR' || modo === 'CAMBIAR_OPERADOR';
  const motivoValido = !requiereMotivo || motivo.trim().length >= MOTIVO_MIN;
  const puedeGuardar = !!kit && modo !== 'NINGUNO' && !!seleccion && motivoValido && !guardando;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!kit || !seleccion || !puedeGuardar || guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      let texto = '';
      if (modo === 'ENTREGAR') {
        await registrarEntrega({ kitId: kit.kitId, militarId: seleccion.id });
        texto = `Entrega registrada: kit ${kit.codigoUnico} a ${seleccion.titulo}`;
      } else if (modo === 'CORREGIR_MILITAR') {
        await corregirMilitar(kit.kitId, { militarId: seleccion.id, motivo: motivo.trim() });
        texto = `Militar cambiado a ${seleccion.titulo}`;
      } else {
        await cambiarOperador(kit.kitId, { operadorId: seleccion.id, motivo: motivo.trim() });
        texto = `Operador cambiado a ${seleccion.titulo}`;
      }
      setAviso(texto);
      void qc.invalidateQueries({ queryKey: ['custodia-resumen'] });
      void qc.invalidateQueries({ queryKey: ['informe-custodia'] });
      // La ficha se vuelve a pedir: así muestra lo que quedó guardado en el servidor.
      try {
        abrir(await validarKitCustodia(kit.codigoUnico));
      } catch {
        siguienteKit();
      }
    } catch (err) {
      setErrorGuardar(mensajeError(err, 'No se pudo guardar. Intente de nuevo.'));
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  const r = resumen.data;

  return (
    <div className="cem">
      <header className="cem-cabecera">
        <div>
          <h1 ref={tituloRef} tabIndex={-1}>
            Entregar kit a militar
          </h1>
          <p className="muted">Escanee el kit y confirme el militar que lo lleva al recinto.</p>
        </div>
        <nav aria-label="Otras opciones" className="cem-enlaces">
          <Link to="/">Inicio</Link>
          <Link to="/reportes/cadena-custodia">Informe de cadena de custodia</Link>
          <Link to="/logout">Cerrar sesión</Link>
        </nav>
      </header>

      {r && (
        <p className="cem-contador" aria-label={`Kits entregados a militares: ${r.entregados} de ${r.total}`}>
          <span className="cem-contador-numero">
            {r.entregados}
            <span className="cem-contador-total"> / {r.total}</span>
          </span>
          <span>{r.total > 0 && r.entregados >= r.total ? 'Todos los kits entregados a militares' : 'kits entregados a militares'}</span>
        </p>
      )}

      <div aria-live="polite">
        {aviso && <p className="banner success">{aviso}</p>}
      </div>

      {/* Fuera de la tarjeta: mientras se ve un kit la cámara se pausa y se oculta (no se apaga ni vuelve a pedir permiso). */}
      {camara && (
        <div className="cem-camara" hidden={!!kit}>
          <CamaraQr
            pausado={validando || !!kit}
            queLee="el QR del kit"
            indicacion="Centre el QR pegado en la mochila"
            onLeido={(valor) => void buscarKit(valor, true)}
            onError={(m) => {
              setError(`${m}. Puede escribir el código a mano.`);
              setCamara(false);
            }}
          />
        </div>
      )}

      {!kit && (
        <section aria-labelledby="cem-escanear" className="cem-tarjeta">
          <h2 id="cem-escanear">Escanear kit</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (codigo.trim()) void buscarKit(codigo, false);
            }}
          >
            <div className="field">
              <label htmlFor="cem-codigo">O escriba el código del kit</label>
              <input
                id="cem-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="search"
                aria-describedby={error ? 'cem-error' : undefined}
              />
            </div>
            <div className="cem-acciones">
              <button type="button" className="btn secondary" onClick={() => setCamara((c) => !c)}>
                {camara ? 'Apagar cámara' : 'Usar cámara'}
              </button>
              <button type="submit" className="btn" disabled={!codigo.trim() || validando}>
                {validando ? 'Validando…' : 'Validar'}
              </button>
            </div>
          </form>
          {error && (
            <p id="cem-error" className="banner error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      {kit && (
        <section aria-labelledby="cem-kit" className="cem-tarjeta">
          <h2 id="cem-kit" ref={tituloKitRef} tabIndex={-1} className="cem-kit-codigo">
            Kit {kit.codigoUnico}
          </h2>
          <p className="cem-kit-nombre">{kit.nombre}</p>
          {kit.recinto && (
            <p className="muted">
              Recinto {kit.recinto.codigo} · {kit.recinto.nombre}
            </p>
          )}

          <dl className="cem-datos">
            <div>
              <dt>Operador CDA</dt>
              <dd>
                {kit.operador ? `${kit.operador.apellidos} ${kit.operador.nombres}` : 'Sin asignar'}
                {kit.editable && modo !== 'CAMBIAR_OPERADOR' && (
                  <button type="button" className="cem-enlace" onClick={() => empezar('CAMBIAR_OPERADOR')}>
                    Cambiar operador
                  </button>
                )}
              </dd>
            </div>
            <div>
              <dt>Entrega al militar</dt>
              <dd>
                {kit.entrega ? (
                  <>
                    {kit.entrega.militar.apellidos} {kit.entrega.militar.nombres} · C.I. {kit.entrega.militar.cedula}
                    <span className="cem-meta">
                      {hora(kit.entrega.entregadoEn)} · registró {kit.entrega.entregadoPorNombre}
                    </span>
                    {kit.entrega.militarDeOtroRecinto && (
                      <span className="cem-opcion-aviso">Militar de otro recinto ({kit.entrega.militar.recintoNombre})</span>
                    )}
                    {kit.editable && modo !== 'CORREGIR_MILITAR' && (
                      <button type="button" className="cem-enlace" onClick={() => empezar('CORREGIR_MILITAR')}>
                        Cambiar militar
                      </button>
                    )}
                  </>
                ) : (
                  'Pendiente'
                )}
              </dd>
            </div>
          </dl>

          {!kit.editable && (
            <p className="banner">El operador CDA ya recibió este kit. Las correcciones las hace un administrador.</p>
          )}

          {modo !== 'NINGUNO' && (
            <form onSubmit={guardar} aria-busy={guardando}>
              {modo === 'CAMBIAR_OPERADOR' ? (
                <SelectorPersona
                  titulo="Nuevo operador CDA"
                  sugeridas={[]}
                  seleccionado={seleccion}
                  onSeleccionar={setSeleccion}
                  buscar={buscarOperador}
                  etiquetaBuscador="Buscar operador por cédula o nombre"
                />
              ) : (
                <SelectorPersona
                  titulo={kit.recinto ? `Militares del recinto ${kit.recinto.codigo}` : 'Militares'}
                  sugeridas={kit.militaresRecinto.filter((m) => m.id !== militarActualId).map((m) => opcionMilitar(m, recintoKitId))}
                  excluir={militarActualId}
                  seleccionado={seleccion}
                  onSeleccionar={setSeleccion}
                  buscar={buscarMilitar}
                  etiquetaBuscador="¿Otro militar? Busque por cédula o nombre"
                />
              )}

              {requiereMotivo && (
                <div className="field" style={{ marginTop: '0.85rem' }}>
                  <label htmlFor="cem-motivo">Motivo del cambio (obligatorio)</label>
                  <textarea
                    id="cem-motivo"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej. el militar asignado fue reemplazado"
                    maxLength={500}
                    rows={3}
                    required
                    aria-describedby="cem-motivo-ayuda"
                  />
                  <p id="cem-motivo-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
                    Mínimo {MOTIVO_MIN} caracteres. Queda en el historial del kit.
                  </p>
                </div>
              )}

              {errorGuardar && (
                <p className="banner error" role="alert">
                  {errorGuardar}
                </p>
              )}

              <div className="cem-acciones">
                {requiereMotivo && (
                  <button type="button" className="btn secondary" onClick={() => empezar('NINGUNO')} disabled={guardando}>
                    Cancelar
                  </button>
                )}
                <button type="submit" className="btn" disabled={!puedeGuardar}>
                  {guardando ? 'Guardando…' : TEXTO_BOTON[modo]}
                </button>
              </div>
            </form>
          )}

          <button type="button" className="btn secondary cem-siguiente" onClick={siguienteKit} disabled={guardando}>
            Escanear otro kit
          </button>
        </section>
      )}
    </div>
  );
}
