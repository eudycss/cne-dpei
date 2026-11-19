import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { PersonaDistribucionDias } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { editarPersonaDistribucion } from '../../lib/queries/distribucion-dias';
import { diaCorto } from './distribucionDias';
import { mensajeError } from './utils';

/** Cambia el día, el cantón o el encargado de una fila (vacío = sin dato). */
export function EditarPersonaDistribucionModal({
  distribucionId,
  persona,
  fechas,
  sugerencias,
  onClose,
}: {
  distribucionId: string;
  persona: PersonaDistribucionDias;
  fechas: string[];
  sugerencias: { cantones: string[]; encargados: string[] };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(persona.fecha);
  const [canton, setCanton] = useState(persona.canton ?? '');
  const [encargado, setEncargado] = useState(persona.encargado ?? '');
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () => editarPersonaDistribucion(distribucionId, persona.id, { fecha, canton, encargado }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['distribuciones-dias'] });
      sileo.success({ title: 'Cambios guardados', description: persona.nombres });
      onClose();
    },
    onError: (e) => setError(mensajeError(e, 'No se pudieron guardar los cambios')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    guardar.mutate();
  }

  return (
    <Modal labelledBy="editar-distribucion-titulo" onClose={onClose} maxWidth={520}>
      <form className="login-card" style={{ width: '100%', maxWidth: 'none' }} onSubmit={enviar} noValidate>
        <h1 id="editar-distribucion-titulo">Editar</h1>
        <p className="muted">
          {persona.nombres} · {persona.cedula} · {persona.cargo}
        </p>
        <label className="ocda-campo">
          <span>Día</span>
          <select value={fecha} onChange={(e) => setFecha(e.target.value)}>
            {fechas.map((f) => (
              <option key={f} value={f}>
                {diaCorto(f)}
              </option>
            ))}
          </select>
        </label>
        <label className="ocda-campo" style={{ marginTop: '0.75rem' }}>
          <span>Cantón</span>
          <input value={canton} onChange={(e) => setCanton(e.target.value)} maxLength={100} list="editar-cantones" />
        </label>
        <label className="ocda-campo" style={{ marginTop: '0.75rem' }}>
          <span>Encargado</span>
          <input value={encargado} onChange={(e) => setEncargado(e.target.value)} maxLength={200} list="editar-encargados" />
        </label>
        <datalist id="editar-cantones">
          {sugerencias.cantones.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="editar-encargados">
          {sugerencias.encargados.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="submit" className="btn" disabled={guardar.isPending} aria-busy={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
