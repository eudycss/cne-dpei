import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { PracticaDigitacion } from '@cne/shared-types';
import { Pestanas } from '../../components/Pestanas';
import { mensajeError } from '../operadores-cda/utils';
import {
  CLAVE_PRACTICAS,
  cambiarActivaPracticaDigitacion,
  fechaHoraEcuador,
  getPracticasDigitacion,
} from '../../lib/queries/simulador';
import { PracticaModal } from './PracticaModal';
import { NovedadesPanel } from './NovedadesPanel';
import { ReportePractica } from './ReportePractica';

const SECCIONES = [
  { id: 'practicas', etiqueta: 'Prácticas' },
  { id: 'novedades', etiqueta: 'Novedades del SIER' },
] as const;

/** Simulador de digitación: prácticas tipo SIER para digitadores (o cualquier personal). */
export function SimuladorPage() {
  return (
    <div className="tema-futurista ocda">
      <div className="ocda-encabezado">
        <div>
          <p className="ocda-ruta">Personal / Simulador de digitación</p>
          <h2 className="ocda-titulo">Simulador de digitación</h2>
          <p className="ocda-subtitulo">
            Prácticas como la pantalla de Digitación del SIER: el personal entra con su cédula y digita actas con los
            números en letras.
          </p>
        </div>
      </div>
      <EnlacePublico />
      <Pestanas pestanas={SECCIONES} porDefecto="practicas" etiqueta="Secciones del simulador">
        {(seccion) => (seccion === 'practicas' ? <PracticasPanel /> : <NovedadesPanel />)}
      </Pestanas>
    </div>
  );
}

/** Dirección que se comparte con el personal (proyector, WhatsApp). */
export function EnlacePublico({ origen = window.location.origin }: { origen?: string }) {
  const url = `${origen}/simulador`;
  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      sileo.success({ title: 'Enlace copiado' });
    } catch {
      sileo.error({ title: 'No se pudo copiar; selecciónelo y cópielo a mano' });
    }
  }
  return (
    <div className="banner info sim-enlace">
      <span>
        Enlace para el personal: <strong className="mono">{url}</strong> (entran solo con su cédula)
      </span>
      <button type="button" className="btn secondary ocda-btn-chico" onClick={() => void copiar()}>
        Copiar enlace
      </button>
    </div>
  );
}

type Edicion = { practica?: PracticaDigitacion } | null;

function PracticasPanel() {
  const qc = useQueryClient();
  const { data: practicas, isLoading, error } = useQuery({ queryKey: CLAVE_PRACTICAS, queryFn: getPracticasDigitacion });
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [reporte, setReporte] = useState<PracticaDigitacion | null>(null);
  // Al volver del reporte, el foco regresa a su botón "Reporte".
  const volverA = useRef<string | null>(null);
  const botonesReporte = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (reporte || !volverA.current) return;
    botonesReporte.current.get(volverA.current)?.focus();
    volverA.current = null;
  }, [reporte, practicas]);
  const actualizar = () => qc.invalidateQueries({ queryKey: CLAVE_PRACTICAS });

  const cambiarActiva = useMutation({
    mutationFn: (p: PracticaDigitacion) => cambiarActivaPracticaDigitacion(p.id, !p.activa),
    onSuccess: (p) => {
      sileo.success({ title: p.activa ? 'Práctica activada' : 'Práctica desactivada', description: p.nombre });
      actualizar();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo cambiar el estado') }),
  });

  if (reporte)
    return (
      <ReportePractica
        practica={reporte}
        onVolver={() => {
          volverA.current = reporte.id;
          setReporte(null);
        }}
      />
    );

  return (
    <section aria-labelledby="sim-practicas-titulo">
      <div className="sim-barra">
        <h3 id="sim-practicas-titulo" className="sim-subtitulo">
          Prácticas
        </h3>
        <button type="button" className="btn primary ocda-btn-chico" onClick={() => setEdicion({})}>
          + Nueva práctica
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudieron cargar las prácticas')}
        </div>
      )}
      {isLoading && (
        <p className="muted" role="status">
          Cargando prácticas…
        </p>
      )}
      {practicas && practicas.length === 0 && <p className="muted">Todavía no hay prácticas. Cree la primera.</p>}

      {practicas && practicas.length > 0 && (
        <div className="ocda-tabla">
          <table aria-label="Prácticas de digitación">
            <thead>
              <tr>
                <th scope="col">Práctica</th>
                <th scope="col">Se puede empezar</th>
                <th scope="col">Meta y plazo</th>
                <th scope="col">Aplica a</th>
                <th scope="col">Intentos</th>
                <th scope="col">Estado</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {practicas.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    {p.nombre}
                    <div className="muted sim-detalle">
                      {p.filasPorActa} filas · votos {p.votoMin}–{p.votoMax} · {p.pctDigitosDistintos} % dígitos distintos
                    </div>
                  </th>
                  <td>
                    {fechaHoraEcuador(p.inicio)}
                    <div className="muted sim-detalle">hasta {fechaHoraEcuador(p.fin)}</div>
                  </td>
                  <td>
                    {p.metaActas} actas
                    <div className="muted sim-detalle">en {p.plazoMinutos} min</div>
                  </td>
                  <td>
                    {p.alcance} {p.alcance === 1 ? 'persona' : 'personas'}
                    <div className="muted sim-detalle">
                      {p.cargos.length} cargo(s)
                      {p.personas.length > 0 && ` · ${p.personas.length} excepción(es)`}
                    </div>
                  </td>
                  <td>
                    {p.intentos}
                    <div className="muted sim-detalle">máx. {p.intentosMax} por persona</div>
                  </td>
                  <td>
                    <span className={`ocda-estado ${p.activa ? 'ok' : 'vacio'}`}>{p.activa ? 'Activa' : 'Desactivada'}</span>
                  </td>
                  <td>
                    <div className="ocda-cargos-acciones">
                      <button
                        type="button"
                        className="ocda-btn-texto"
                        aria-label={`Reporte de ${p.nombre}`}
                        ref={(el) => {
                          if (el) botonesReporte.current.set(p.id, el);
                          else botonesReporte.current.delete(p.id);
                        }}
                        onClick={() => setReporte(p)}
                      >
                        Reporte
                      </button>
                      <button
                        type="button"
                        className="ocda-btn-texto"
                        aria-label={`Editar ${p.nombre}`}
                        onClick={() => setEdicion({ practica: p })}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="ocda-btn-texto"
                        aria-label={`${p.activa ? 'Desactivar' : 'Activar'} ${p.nombre}`}
                        aria-disabled={cambiarActiva.isPending && cambiarActiva.variables?.id === p.id}
                        onClick={() => !cambiarActiva.isPending && cambiarActiva.mutate(p)}
                      >
                        {p.activa ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edicion && (
        <PracticaModal
          practica={edicion.practica}
          onClose={() => setEdicion(null)}
          onGuardada={() => {
            setEdicion(null);
            actualizar();
          }}
        />
      )}
    </section>
  );
}
