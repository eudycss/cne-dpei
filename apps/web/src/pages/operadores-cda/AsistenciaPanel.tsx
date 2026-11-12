import { useMemo, useState } from 'react';
import { coincideBusqueda } from '@cne/shared-validation';
import { AccionesEncabezado } from './AccionesEncabezado';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AsistenciaCdaDia, AsistenciaCdaFila, TipoMarcaAsistenciaCda } from '@cne/shared-types';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { Modal } from '../../components/Modal';
import {
  getAsistenciaCda,
  marcarAsistenciaCda,
  marcarAsistenciaCdaMasiva,
  quitarAsistenciaCda,
} from '../../lib/queries/operadores-cda';
import { CheckMarca } from './CheckMarca';
import { CorregirAsistenciaModal } from './CorregirAsistenciaModal';
import { ExportarReporteModal } from './ExportarReporteModal';
import { EscanearQrModal } from './EscanearQrModal';
import { Kpi } from './Kpi';
import { cargoCorto, hoyEcuador, iniciales } from './utils';
import { useGrupoCda } from './grupo';
import { useModulos } from '../../lib/useModulos';

type Filtro = 'todos' | 'sin-entrada' | 'sin-salida' | 'completos';
type Marca = { operadorId: string; tipo: TipoMarcaAsistenciaCda };
type MarcaVista = Marca & { marcaEn: string };

const FILTROS: { id: Filtro; etiqueta: string; cumple: (f: AsistenciaCdaFila) => boolean }[] = [
  { id: 'todos', etiqueta: 'Todos', cumple: () => true },
  { id: 'sin-entrada', etiqueta: 'Sin entrada', cumple: (f) => !f.entradaEn },
  { id: 'sin-salida', etiqueta: 'Sin salida', cumple: (f) => !!f.entradaEn && !f.salidaEn },
  { id: 'completos', etiqueta: 'Completos', cumple: (f) => !!f.salidaEn },
];

const ETIQUETA: Record<TipoMarcaAsistenciaCda, string> = { ENTRADA: 'entrada', SALIDA: 'salida' };

const PROPIA = 'Es su propia asistencia: la registra otro técnico';

function mensajeError(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

/**
 * Asistencia del día: un check de entrada y otro de salida por operador. Solo
 * hoy se puede marcar (los días pasados son de consulta). Se refresca cada
 * 30 s para ver lo que marcan los demás técnicos.
 */
export function AsistenciaPanel({ acciones = null }: { acciones?: HTMLElement | null }) {
  const qc = useQueryClient();
  const { grupo, plural, singular, Singular } = useGrupoCda();
  const { puede } = useModulos();
  const puedeMarcar = puede('cda.asistencia.marcar');
  const puedeCorregir = puede('cda.asistencia.corregir');
  const hoy = hoyEcuador();
  const [fecha, setFecha] = useState(hoy);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [masiva, setMasiva] = useState<TipoMarcaAsistenciaCda | null>(null);
  const [exportando, setExportando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState<AsistenciaCdaFila | null>(null);
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());
  // Los no convocados del día no pueden faltar: van ocultos salvo que se pida verlos (alguien llegó igual).
  const [verNoConvocados, setVerNoConvocados] = useState(false);
  const clave = ['asistencia-cda', grupo, fecha];

  const { data, isLoading, error } = useQuery({
    queryKey: clave,
    queryFn: () => getAsistenciaCda(fecha, grupo),
    refetchInterval: fecha === hoy ? 30_000 : false,
  });

  const ocupar = (m: Marca, si: boolean) =>
    setOcupados((prev) => {
      const s = new Set(prev);
      const k = `${m.operadorId}-${m.tipo}`;
      if (si) s.add(k);
      else s.delete(k);
      return s;
    });
  const refrescar = () => qc.invalidateQueries({ queryKey: ['asistencia-cda'] });

  const quitar = useMutation({
    mutationFn: ({ operadorId, tipo, marcaEn }: MarcaVista) => quitarAsistenciaCda(operadorId, tipo, marcaEn),
    onMutate: (m) => ocupar(m, true),
    onSettled: (_r, _e, m) => {
      ocupar(m, false);
      refrescar();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo quitar la marca') }),
  });

  const marcar = useMutation({
    mutationFn: ({ operadorId, tipo }: Marca) => marcarAsistenciaCda(operadorId, tipo),
    onMutate: (m) => ocupar(m, true),
    onSuccess: (fila, m) => {
      qc.setQueryData<AsistenciaCdaDia>(clave, (d) =>
        d && { ...d, filas: d.filas.map((f) => (f.operador.id === fila.operador.id ? fila : f)) },
      );
      sileo.action({
        title: `${m.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada`,
        description: fila.operador.apellidosNombres,
        duration: 5000,
        // Solo quita ESTA marca: si otro técnico la cambió entretanto, la API responde 409.
        button: {
          title: 'Deshacer',
          onClick: () => quitar.mutate({ ...m, marcaEn: (m.tipo === 'ENTRADA' ? fila.entradaEn : fila.salidaEn)! }),
        },
      });
    },
    onError: (e) => {
      sileo.error({ title: mensajeError(e, 'No se pudo registrar la marca') });
      refrescar();
    },
    onSettled: (_r, _e, m) => ocupar(m, false),
  });

  const todas = data?.filas ?? [];
  // Sin nadie convocado ese día no hay faltas: se ve a todos para poder marcar a quien llegue.
  const hayConvocatoria = (data?.convocados ?? 0) > 0;
  const conMarca = (f: AsistenciaCdaFila) => !!f.entradaEn || !!f.salidaEn;
  const esperado = (f: AsistenciaCdaFila) => !hayConvocatoria || f.convocado;
  // Los resúmenes y los botones masivos son siempre de los convocados (el día sin convocatoria, de todos).
  const base = useMemo(() => todas.filter(esperado), [todas, hayConvocatoria]);
  const noConvocados = todas.length - base.length;
  // Quien vino sin estar convocado se ve siempre; los demás no convocados, a pedido.
  const ocultos = hayConvocatoria ? todas.filter((f) => !f.convocado && !conMarca(f)).length : 0;
  const filas = useMemo(
    () => (verNoConvocados ? todas : todas.filter((f) => esperado(f) || conMarca(f))),
    [todas, hayConvocatoria, verNoConvocados],
  );
  const contar = (lista: AsistenciaCdaFila[], f: Filtro) => lista.filter(FILTROS.find((x) => x.id === f)!.cumple).length;
  const conteo = (f: Filtro) => contar(filas, f);
  const visibles = useMemo(() => {
    const q = busqueda.trim();
    const cumple = FILTROS.find((x) => x.id === filtro)!.cumple;
    return filas.filter(
      (f) => cumple(f) && coincideBusqueda([f.operador.apellidosNombres, f.operador.cedula], q),
    );
  }, [filas, filtro, busqueda]);

  // El técnico supervisor ve su propia fila, pero no se marca ni se corrige (también lo impide el servidor).
  const propioId = data?.operadorPropioId ?? null;
  const esPropia = (f: AsistenciaCdaFila) => propioId !== null && f.operador.id === propioId;
  // Masivos: solo a los convocados que se ven (nunca a un no convocado por estar mostrándolos), y nunca a sí mismo.
  const pendientesEntrada = visibles.filter((f) => esperado(f) && !esPropia(f) && !f.entradaEn);
  const pendientesSalida = visibles.filter((f) => esperado(f) && !esPropia(f) && f.entradaEn && !f.salidaEn);
  const esHoy = data?.esHoy ?? fecha === hoy;
  const corrige = !esHoy && puedeCorregir;
  const motivoBloqueo = !esHoy
    ? corrige
      ? 'Día pasado: use Corregir'
      : 'Día pasado: solo consulta'
    : !puedeMarcar
      ? 'Su rol no tiene permiso para marcar a mano'
      : undefined;

  function confirmarQuitar(f: AsistenciaCdaFila, tipo: TipoMarcaAsistenciaCda) {
    const marcaEn = tipo === 'ENTRADA' ? f.entradaEn : f.salidaEn;
    if (marcaEn && window.confirm(`¿Quitar la ${ETIQUETA[tipo]} de hoy de ${f.operador.apellidosNombres}?`)) {
      quitar.mutate({ operadorId: f.operador.id, tipo, marcaEn });
    }
  }

  const total = base.length;
  const presentes = total - contar(base, 'sin-entrada');
  const conFoto = base.filter((f) => f.operador.tieneFoto).length;
  const porcentaje = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <>
      <AccionesEncabezado destino={acciones}>
        {puede('cda.asistencia.exportar') && (
          <button type="button" className="btn secondary" onClick={() => setExportando(true)}>
            Exportar
          </button>
        )}
        {esHoy && data && puede('cda.asistencia.qr') && (
          <button type="button" className="btn secondary" onClick={() => setEscaneando(true)}>
            Escanear carnet
          </button>
        )}
        {esHoy && data && puedeMarcar && (
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={pendientesSalida.length === 0}
              onClick={() => setMasiva('SALIDA')}
            >
              Marcar salida a pendientes ({pendientesSalida.length})
            </button>
            <button
              type="button"
              className="btn"
              disabled={pendientesEntrada.length === 0}
              onClick={() => setMasiva('ENTRADA')}
            >
              Marcar entrada a pendientes ({pendientesEntrada.length})
            </button>
          </>
        )}
      </AccionesEncabezado>

      {data && (
        <div className="ocda-kpis" role="group" aria-label="Resumen del día">
          <Kpi
            etiqueta={esHoy ? 'Presentes hoy' : 'Presentes'}
            valor={`${presentes} / ${total}`}
            parte={presentes}
            total={total}
            detalle={`${porcentaje(presentes)}% registró entrada`}
          />
          <Kpi
            etiqueta="Pendientes de salida"
            valor={String(contar(base, 'sin-salida'))}
            parte={contar(base, 'sin-salida')}
            total={total}
            detalle="Con entrada y sin salida"
          />
          <Kpi
            etiqueta="Fotos cargadas"
            valor={`${conFoto} / ${total}`}
            parte={conFoto}
            total={total}
            detalle={`${total - conFoto} sin foto`}
          />
          <Kpi
            etiqueta="Completos"
            valor={String(contar(base, 'completos'))}
            parte={contar(base, 'completos')}
            total={total}
            detalle="Entrada y salida registradas"
          />
        </div>
      )}

      <div className="ocda-filtros">
        <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <SearchInput
            value={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por nombre o cédula…"
            ariaLabel={`Buscar ${singular} por nombre o cédula`}
          />
        </span>
        <label className="ocda-fecha">
          <span>Día</span>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => {
              if (!e.target.value) return;
              setFecha(e.target.value);
              setVerNoConvocados(false);
            }}
          />
        </label>
        <div className="ocda-filtros" role="group" aria-label="Filtrar por estado" style={{ margin: 0 }}>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="ocda-chip"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
            >
              {filtro === f.id && <span aria-hidden="true">✓ </span>}
              {f.etiqueta} · {data ? conteo(f.id) : '…'}
            </button>
          ))}
        </div>
      </div>

      {data && todas.length > 0 && !hayConvocatoria && (
        <div className="banner aviso">
          No hay convocatoria ni parejas para este día: nadie tiene falta. Puede marcar a quien llegue; para convocar, use la
          pestaña Convocatoria.
        </div>
      )}
      {data && hayConvocatoria && (
        <div className="row" style={{ gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {data.convocados} convocado{data.convocados === 1 ? '' : 's'} este día
            {noConvocados > 0 && ` · ${noConvocados} no convocado${noConvocados === 1 ? '' : 's'} (sin falta)`}
          </span>
          {ocultos > 0 && (
            <button type="button" className="ocda-chip" aria-pressed={verNoConvocados} onClick={() => setVerNoConvocados((v) => !v)}>
              {verNoConvocados ? 'Ocultar no convocados' : `Ver no convocados (${ocultos})`}
            </button>
          )}
        </div>
      )}
      {!esHoy && data && (
        <div className="banner" role="status">
          {corrige
            ? 'Está viendo un día pasado. Para cambiar una marca use “Corregir”: se pide el motivo y queda en la bitácora.'
            : 'Está viendo un día pasado: solo consulta. La asistencia se marca únicamente el día de hoy.'}
        </div>
      )}
      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar la asistencia.')}
        </div>
      )}
      {data && filas.length === 0 && (
        <p className="muted">Aún no hay {plural}. Impórtelos desde la pestaña Listado.</p>
      )}

      {data && filas.length > 0 && (
        <div className="ocda-tabla" tabIndex={0} role="region" aria-label={`Asistencia de ${plural}`}>
          <table>
            <caption className="sr-only">
              Asistencia del {fecha}: {visibles.length} {singular}(es) con el filtro actual
            </caption>
            <thead>
              <tr>
                <th scope="col">{Singular}</th>
                <th scope="col">Cédula</th>
                <th scope="col">Teléfono</th>
                <th scope="col">Entrada</th>
                <th scope="col">Salida</th>
                {corrige && (
                  <th scope="col">
                    <span className="sr-only">Corregir</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const o = f.operador;
                const propia = esPropia(f);
                const motivoFila = propia ? PROPIA : motivoBloqueo;
                return (
                  <tr key={o.id}>
                    <th scope="row">
                      <span className="ocda-persona">
                        <span className={`ocda-avatar${o.tieneFoto ? ' con-foto' : ''}`} aria-hidden="true">
                          {iniciales(o.apellidosNombres)}
                        </span>
                        <span className="ocda-persona-textos">
                          <span className="ocda-persona-nombre">{o.apellidosNombres}</span>
                          <span className="ocda-persona-cargo" title={o.cargo}>
                            {cargoCorto(o.cargo)}
                            {hayConvocatoria && !f.convocado && ' · No convocado'}
                            {propia && ' · Usted (solo consulta)'}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="mono">{o.cedula}</td>
                    <td className="mono">{o.telefono ?? '—'}</td>
                    <td>
                      <CheckMarca
                        tipo="ENTRADA"
                        marcaEn={f.entradaEn}
                        por={f.entradaPor}
                        nombre={o.apellidosNombres}
                        deshabilitado={propia || !esHoy || !puedeMarcar || (!!f.salidaEn && !!f.entradaEn)}
                        motivo={motivoFila ?? (f.salidaEn ? 'Quite primero la salida' : undefined)}
                        ocupado={ocupados.has(`${o.id}-ENTRADA`)}
                        onMarcar={() => marcar.mutate({ operadorId: o.id, tipo: 'ENTRADA' })}
                        onQuitar={() => confirmarQuitar(f, 'ENTRADA')}
                      />
                    </td>
                    <td>
                      <CheckMarca
                        tipo="SALIDA"
                        marcaEn={f.salidaEn}
                        por={f.salidaPor}
                        nombre={o.apellidosNombres}
                        deshabilitado={propia || !esHoy || !puedeMarcar || !f.entradaEn}
                        motivo={motivoFila ?? (!f.entradaEn ? 'Primero marque la entrada' : undefined)}
                        ocupado={ocupados.has(`${o.id}-SALIDA`)}
                        onMarcar={() => marcar.mutate({ operadorId: o.id, tipo: 'SALIDA' })}
                        onQuitar={() => confirmarQuitar(f, 'SALIDA')}
                      />
                    </td>
                    {corrige && (
                      <td>
                        {propia ? (
                          <span className="ocda-persona-cargo">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{PROPIA}</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn secondary"
                            aria-label={`Corregir asistencia de ${o.apellidosNombres}`}
                            onClick={() => setCorrigiendo(f)}
                          >
                            Corregir
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length === 0 && <p className="ocda-pie">Ningún {singular} con este filtro.</p>}
          <p className="ocda-pie">
            Mostrando {visibles.length} de {total} {plural}
            {esHoy && puedeMarcar
              ? ' · Los cambios se guardan automáticamente'
              : corrige
                ? ' · Correcciones con motivo'
                : ' · Solo consulta'}
          </p>
        </div>
      )}

      {masiva && (
        <ConfirmarMasiva
          tipo={masiva}
          filas={masiva === 'ENTRADA' ? pendientesEntrada : pendientesSalida}
          onClose={() => setMasiva(null)}
          onHecho={refrescar}
        />
      )}

      {corrigiendo && (
        <CorregirAsistenciaModal
          fila={corrigiendo}
          fecha={fecha}
          onClose={() => setCorrigiendo(null)}
          onHecho={refrescar}
        />
      )}

      {escaneando && (
        <EscanearQrModal
          onClose={() => setEscaneando(false)}
          onMarcado={(fila) => {
            qc.setQueryData<AsistenciaCdaDia>(clave, (d) =>
              d && { ...d, filas: d.filas.map((f) => (f.operador.id === fila.operador.id ? fila : f)) },
            );
            refrescar();
          }}
        />
      )}

      {exportando && (
        <ExportarReporteModal
          reporte="asistencia"
          desdeInicial={`${fecha.slice(0, 8)}01`}
          hastaInicial={fecha}
          onClose={() => setExportando(false)}
        />
      )}
    </>
  );
}

function ConfirmarMasiva({
  tipo,
  filas,
  onClose,
  onHecho,
}: {
  tipo: TipoMarcaAsistenciaCda;
  filas: AsistenciaCdaFila[];
  onClose: () => void;
  onHecho: () => void;
}) {
  const { singular } = useGrupoCda();
  const aplicar = useMutation({
    mutationFn: () => marcarAsistenciaCdaMasiva(tipo, filas.map((f) => f.operador.id)),
    onSuccess: ({ marcados, omitidos }) => {
      sileo.success({
        title: `${marcados} ${ETIQUETA[tipo]}(s) registrada(s)`,
        description: omitidos > 0 ? `${omitidos} ya la tenían u otro técnico la marcó antes.` : undefined,
      });
      onHecho();
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo registrar') }),
  });

  return (
    <Modal labelledBy="masiva-titulo" onClose={onClose}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }}>
        <h1 id="masiva-titulo">
          Marcar {ETIQUETA[tipo]} a {filas.length} {singular}(es)
        </h1>
        <p>
          Se registrará la {ETIQUETA[tipo]} de hoy con la hora actual a quienes se muestran ahora como pendientes
          {tipo === 'SALIDA' ? ' (solo los que ya tienen entrada)' : ''}. Revise que todos estén presentes.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={aplicar.isPending}>
            Cancelar
          </button>
          <button type="button" className="btn" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
            {aplicar.isPending ? 'Registrando…' : `Marcar ${ETIQUETA[tipo]}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
