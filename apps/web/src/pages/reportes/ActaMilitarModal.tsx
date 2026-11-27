import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FECHA_ACTA_MILITAR_POR_DEFECTO, coincideBusqueda } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { useAuth } from '../../auth/AuthContext';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import {
  descargarActaMilitarKit,
  descargarActasMilitares,
  getResponsablesActa,
  type OpcionesActaMilitar,
} from '../../lib/queries/custodia';

/** Responsable que sale por defecto en las actas militares. */
export const RESPONSABLE_POR_DEFECTO = 'Jairo Leal';

type Formato = OpcionesActaMilitar['formato'];

/**
 * Antes de descargar actas militares (una o varias): el Asistente Transversal
 * responsable (por defecto Jairo Leal), la fecha impresa (por defecto
 * 28/11/2026) y el formato. Varias en PDF salen en un solo archivo, una página
 * por kit; en Word, un .zip con un acta por kit. Queda abierta tras descargar.
 */
export function ActaMilitarModal({
  kits,
  onClose,
}: {
  kits: { kitId: string; codigoUnico: string }[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data: responsables, isLoading, error } = useQuery({
    queryKey: ['custodia-responsables-acta'],
    queryFn: getResponsablesActa,
    staleTime: 5 * 60_000,
  });
  const [responsableId, setResponsableId] = useState('');
  const [fecha, setFecha] = useState(FECHA_ACTA_MILITAR_POR_DEFECTO);
  const [formato, setFormato] = useState<Formato>('pdf');
  const [aviso, setAviso] = useState<{ campo: 'responsable' | 'fecha'; texto: string } | null>(null);
  const { descargando, descargar } = useDescargaPdf('No se pudo generar el acta militar');
  const iniciado = useRef(false);

  // Por defecto Jairo Leal; si no está, quien descarga (si es Asistente Transversal).
  useEffect(() => {
    if (iniciado.current || !responsables) return;
    iniciado.current = true;
    const jairo = responsables.find((r) => coincideBusqueda([r.nombre], RESPONSABLE_POR_DEFECTO));
    const yo = responsables.find((r) => r.id === user?.id);
    setResponsableId((jairo ?? yo ?? responsables[0])?.id ?? '');
  }, [responsables, user?.id]);

  const una = kits.length === 1;

  function enviar(e: FormEvent) {
    e.preventDefault();
    const error = !responsableId
      ? ({ campo: 'responsable', texto: 'Elija el responsable.' } as const)
      : !fecha
        ? ({ campo: 'fecha', texto: 'Elija la fecha del acta.' } as const)
        : null;
    setAviso(error);
    if (error) {
      // El foco va al campo con el error; el mensaje queda enlazado con aria-describedby.
      document.getElementById(`acta-militar-${error.campo}`)?.focus();
      return;
    }
    const opciones: OpcionesActaMilitar = { formato, responsableId, fecha };
    if (una) {
      const [k] = kits;
      void descargar('acta', () => descargarActaMilitarKit(k.kitId, opciones), `acta_militar_${k.codigoUnico}.${formato}`);
    } else {
      void descargar(
        'acta',
        () => descargarActasMilitares(kits.map((k) => k.kitId), opciones),
        formato === 'pdf' ? 'actas_militares.pdf' : 'actas_militares.zip',
      );
    }
  }

  const ocupado = descargando !== null;

  return (
    <Modal labelledBy="acta-militar-titulo" onClose={onClose} maxWidth={520}>
      <form className="ocda-modal" onSubmit={enviar} noValidate aria-busy={ocupado}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="acta-militar-titulo">{una ? `Acta militar del kit ${kits[0].codigoUnico}` : `Actas militares (${kits.length} kits)`}</h2>
            <p className="muted">
              {una ? 'Acta de Constancia y Custodia.' : 'En PDF salen en un solo archivo, una página por kit.'}
            </p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {isLoading && <p className="muted">Cargando responsables…</p>}
        {error && (
          <p className="banner error" role="alert">
            No se pudo cargar la lista de responsables.
          </p>
        )}

        <div className="ocda-form">
          <div className="field">
            <label htmlFor="acta-militar-responsable">Responsable (Asistente Transversal)</label>
            <select
              id="acta-militar-responsable"
              value={responsableId}
              onChange={(e) => setResponsableId(e.target.value)}
              disabled={!responsables?.length}
              aria-invalid={aviso?.campo === 'responsable' || undefined}
              aria-describedby={aviso?.campo === 'responsable' ? 'acta-militar-aviso' : undefined}
            >
              {!responsables?.length && <option value="">Sin Asistentes Transversales activos</option>}
              {responsables?.map((r) => (
                <option key={r.id} value={r.id}>
                  Ing. {r.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="acta-militar-fecha">Fecha del acta</label>
            <input
              id="acta-militar-fecha"
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value);
                setAviso(null);
              }}
              required
              aria-invalid={aviso?.campo === 'fecha' || undefined}
              aria-describedby={aviso?.campo === 'fecha' ? 'acta-militar-aviso' : undefined}
            />
          </div>
          <fieldset className="ocda-opciones ancho">
            <legend>Formato</legend>
            {(
              [
                ['pdf', 'PDF', una ? 'Listo para imprimir' : 'Un solo archivo para imprimir'],
                ['docx', 'Word', una ? 'Para editar' : 'Un .zip con un Word por kit'],
              ] as const
            ).map(([valor, etiqueta, detalle]) => (
              <label key={valor} className="ocda-opcion">
                <input
                  type="radio"
                  name="acta-militar-formato"
                  checked={formato === valor}
                  onChange={() => setFormato(valor)}
                  aria-labelledby={`acta-militar-${valor}`}
                  aria-describedby={`acta-militar-${valor}-detalle`}
                />
                <span>
                  <strong id={`acta-militar-${valor}`}>{etiqueta}</strong>
                  <span id={`acta-militar-${valor}-detalle`} className="ocda-form-ayuda">
                    {detalle}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <p id="acta-militar-aviso" role="alert" className={aviso ? 'banner error' : 'sr-only'}>
          {aviso?.texto ?? ''}
        </p>
        <p role="status" className="sr-only">
          {ocupado ? 'Generando acta…' : ''}
        </p>

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="submit" className="btn" disabled={ocupado || !responsables?.length}>
            {ocupado ? 'Generando…' : `Descargar ${formato === 'pdf' ? 'PDF' : una ? 'Word' : '.zip (Word)'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
