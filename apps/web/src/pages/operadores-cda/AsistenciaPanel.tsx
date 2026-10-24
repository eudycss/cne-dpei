import { useMemo, useState } from 'react';
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
import { ExportarReporteModal } from './ExportarReporteModal';
import { EscanearQrModal } from './EscanearQrModal';
import { Kpi } from './Kpi';
import { cargoCorto, hoyEcuador, iniciales, normalizar } from './utils';

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
  const hoy = hoyEcuador();
  const [fecha, setFecha] = useState(hoy);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [masiva, setMasiva] = useState<TipoMarcaAsistenciaCda | null>(null);
  const [exportando, setExportando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());
  const clave = ['asistencia-cda', fecha];

  const { data, isLoading, error } = useQuery({
    queryKey: clave,
    queryFn: () => getAsistenciaCda(fecha),
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

  const filas = data?.filas ?? [];
  const conteo = (f: Filtro) => filas.filter(FILTROS.find((x) => x.id === f)!.cumple).length;
  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const cumple = FILTROS.find((x) => x.id === filtro)!.cumple;
    return filas.filter(
      (f) => cumple(f) && (!q || normalizar(f.operador.apellidosNombres).includes(q) || f.operador.cedula.includes(q)),
    );
  }, [filas, filtro, busqueda]);

  const pendientesEntrada = visibles.filter((f) => !f.entradaEn);
  const pendientesSalida = visibles.filter((f) => f.entradaEn && !f.salidaEn);
  const esHoy = data?.esHoy ?? fecha === hoy;

  function confirmarQuitar(f: AsistenciaCdaFila, tipo: TipoMarcaAsistenciaCda) {
    const marcaEn = tipo === 'ENTRADA' ? f.entradaEn : f.salidaEn;
    if (marcaEn && window.confirm(`¿Quitar la ${ETIQUETA[tipo]} de hoy de ${f.operador.apellidosNombres}?`)) {
      quitar.mutate({ operadorId: f.operador.id, tipo, marcaEn });
    }
  }

  const total = filas.length;
  const presentes = total - conteo('sin-entrada');
  const conFoto = filas.filter((f) => f.operador.tieneFoto).length;
  const porcentaje = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <>
      <AccionesEncabezado destino={acciones}>
        <button type="button" className="btn secondary" onClick={() => setExportando(true)}>
          Exportar
        </button>
        {esHoy && data && (
          <>
            <button type="button" className="btn secondary" onClick={() => setEscaneando(true)}>
              Escanear carnet
            </button>
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
            valor={String(conteo('sin-salida'))}
            parte={conteo('sin-salida')}
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
            valor={String(conteo('completos'))}
            parte={conteo('completos')}
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
            ariaLabel="Buscar operador por nombre o cédula"
          />
        </span>
        <label className="ocda-fecha">
          <span>Día</span>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
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

      {!esHoy && data && (
        <div className="banner" role="status">
          Está viendo un día pasado: solo consulta. La asistencia se marca únicamente el día de hoy.
        </div>
      )}
      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar la asistencia.')}
        </div>
      )}
      {data && filas.length === 0 && (
        <p className="muted">Aún no hay operadores. Impórtelos desde la pestaña Listado.</p>
      )}

      {data && filas.length > 0 && (
        <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Asistencia de operadores">
          <table>
            <caption className="sr-only">
              Asistencia del {fecha}: {visibles.length} operador(es) con el filtro actual
            </caption>
            <thead>
              <tr>
                <th scope="col">Operador</th>
                <th scope="col">Cédula</th>
                <th scope="col">Teléfono</th>
                <th scope="col">Entrada</th>
                <th scope="col">Salida</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const o = f.operador;
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
                        deshabilitado={!esHoy || (!!f.salidaEn && !!f.entradaEn)}
                        motivo={!esHoy ? 'Día pasado: solo consulta' : f.salidaEn ? 'Quite primero la salida' : undefined}
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
                        deshabilitado={!esHoy || !f.entradaEn}
                        motivo={!esHoy ? 'Día pasado: solo consulta' : !f.entradaEn ? 'Primero marque la entrada' : undefined}
                        ocupado={ocupados.has(`${o.id}-SALIDA`)}
                        onMarcar={() => marcar.mutate({ operadorId: o.id, tipo: 'SALIDA' })}
                        onQuitar={() => confirmarQuitar(f, 'SALIDA')}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length === 0 && <p className="ocda-pie">Ningún operador con este filtro.</p>}
          <p className="ocda-pie">
            Mostrando {visibles.length} de {total} operadores
            {esHoy ? ' · Los cambios se guardan automáticamente' : ' · Solo consulta'}
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
        <h1 id="masiva-titulo">Marcar {ETIQUETA[tipo]} a {filas.length} operador(es)</h1>
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
