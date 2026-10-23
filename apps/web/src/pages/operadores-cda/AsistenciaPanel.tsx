import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AsistenciaCdaDia, AsistenciaCdaFila, TipoMarcaAsistenciaCda } from '@cne/shared-types';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import { Modal } from '../../components/Modal';
import {
  descargarAsistenciaCda,
  getAsistenciaCda,
  marcarAsistenciaCda,
  marcarAsistenciaCdaMasiva,
  quitarAsistenciaCda,
} from '../../lib/queries/operadores-cda';
import { CheckMarca } from './CheckMarca';
import { hoyEcuador, iniciales, normalizar } from './utils';

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
export function AsistenciaPanel() {
  const qc = useQueryClient();
  const hoy = hoyEcuador();
  const [fecha, setFecha] = useState(hoy);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [masiva, setMasiva] = useState<TipoMarcaAsistenciaCda | null>(null);
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

  async function exportar() {
    try {
      await descargarAsistenciaCda(fecha);
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo generar el Excel') });
    }
  }

  return (
    <>
      {data && (
        <div className="ocda-kpis" role="group" aria-label="Resumen del día">
          <Kpi etiqueta="Presentes" valor={`${filas.length - conteo('sin-entrada')} / ${filas.length}`} parte={filas.length - conteo('sin-entrada')} total={filas.length} />
          <Kpi etiqueta="Pendientes de salida" valor={String(conteo('sin-salida'))} parte={conteo('sin-salida')} total={filas.length} />
          <Kpi etiqueta="Sin entrada" valor={String(conteo('sin-entrada'))} parte={conteo('sin-entrada')} total={filas.length} />
          <Kpi etiqueta="Completos" valor={String(conteo('completos'))} parte={conteo('completos')} total={filas.length} />
        </div>
      )}

      <div className="row ocda-filtros">
        <SearchInput
          value={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar por nombre o cédula…"
          ariaLabel="Buscar operador por nombre o cédula"
          style={{ flex: '1 1 240px', maxWidth: 360 }}
        />
        <label className="ocda-fecha">
          <span>Día</span>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
          />
        </label>
        <button type="button" className="btn secondary" onClick={exportar}>
          Exportar Excel
        </button>
      </div>

      <div className="row ocda-chips" role="group" aria-label="Filtrar por estado">
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
        {esHoy && data && (
          <div className="ocda-masivas">
            <button
              type="button"
              className="btn secondary"
              disabled={pendientesEntrada.length === 0}
              onClick={() => setMasiva('ENTRADA')}
            >
              Marcar entrada a pendientes ({pendientesEntrada.length})
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={pendientesSalida.length === 0}
              onClick={() => setMasiva('SALIDA')}
            >
              Marcar salida a pendientes ({pendientesSalida.length})
            </button>
          </div>
        )}
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
                        <span>{o.apellidosNombres}</span>
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
          {visibles.length === 0 && <p className="muted" style={{ padding: '1rem' }}>Ningún operador con este filtro.</p>}
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
    </>
  );
}

function Kpi({ etiqueta, valor, parte, total }: { etiqueta: string; valor: string; parte: number; total: number }) {
  const pct = total > 0 ? Math.round((parte / total) * 100) : 0;
  return (
    <div className="ocda-kpi">
      <span className="ocda-kpi-etiqueta">{etiqueta}</span>
      <span className="ocda-kpi-valor">{valor}</span>
      <span className="ocda-kpi-barra" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
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
