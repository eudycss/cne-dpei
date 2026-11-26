import { FormEvent, useState } from 'react';
import type { EventoElectoral, TipoEventoCatalog } from '@cne/shared-types';
import { createEventoSchema, updateEventoSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';

// ─── Modal crear / editar evento ─────────────────────────────────────────────

export function EventoModal({
  evento,
  tiposEvento,
  onClose,
  onDone,
}: {
  evento?: EventoElectoral;
  tiposEvento: TipoEventoCatalog[];
  onClose: () => void;
  onDone: () => void;
}) {
  const defaultTipo = evento?.tipo ?? tiposEvento[0]?.codigo ?? '';
  const [form, setForm] = useState({
    nombre: evento?.nombre ?? '',
    tipo: defaultTipo,
    fechaJornada: evento?.fechaJornada ?? '',
    descripcion: evento?.descripcion ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field(k: keyof typeof form) {
    return (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      nombre: form.nombre,
      tipo: form.tipo,
      fechaJornada: form.fechaJornada,
      descripcion: form.descripcion || null,
    };
    const schema = evento ? updateEventoSchema : createEventoSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      if (evento) {
        await api.patch(`/eventos/${evento.id}`, parsed.data);
      } else {
        await api.post('/eventos', parsed.data);
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="evento-modal-titulo" onClose={onClose} maxWidth={540}>
      <form className="login-card" style={{ width: '100%' }} onSubmit={onSubmit}>
        <h1 id="evento-modal-titulo">{evento ? 'Editar evento' : 'Nuevo evento electoral'}</h1>

        <div className="field">
          <label htmlFor="eventos-nombre">Nombre</label>
          <input id="eventos-nombre"
            value={form.nombre}
            onChange={field('nombre')}
            required
            maxLength={160}
            placeholder="Ej.: Elecciones Generales 2025"
          />
        </div>

        <div className="field">
          <label htmlFor="eventos-tipo">Tipo</label>
          <select id="eventos-tipo" value={form.tipo} onChange={field('tipo')}>
            {tiposEvento.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="eventos-fecha-de-jornada">Fecha de jornada</label>
          <input id="eventos-fecha-de-jornada"
            type="date"
            value={form.fechaJornada}
            onChange={field('fechaJornada')}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="eventos-descripcion-opcional">Descripción (opcional)</label>
          <textarea id="eventos-descripcion-opcional"
            value={form.descripcion}
            onChange={field('descripcion')}
            rows={3}
            maxLength={2000}
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: '1px solid var(--border-input)',
              borderRadius: 6,
              fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : evento ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
