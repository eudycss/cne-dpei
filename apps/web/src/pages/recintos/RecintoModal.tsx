import { FormEvent, useState } from 'react';
import type { Canton, Recinto, TipoRecinto } from '@cne/shared-types';
import { createRecintoSchema, updateRecintoSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { TIPOS, TIPO_LABELS } from './tipos-recinto';

// ─── Modal crear / editar ─────────────────────────────────────────────────────

interface FormState {
  codigoRecinto: string;
  nombre: string;
  direccion: string;
  cantonId: string;
  parroquia: string;
  zona: string;
  tipo: TipoRecinto;
  latitud: string;
  longitud: string;
  tieneInternet: boolean;
  coberturaMovil: boolean;
  numeroElectores: string;
  juntasFemeninas: string;
  juntasMasculinas: string;
  esDificilAcceso: boolean;
  contingenciaNombre: string;
  contingenciaDireccion: string;
}

type TextFieldKey = Exclude<keyof FormState, 'tipo' | 'tieneInternet' | 'coberturaMovil' | 'esDificilAcceso'>;

export function RecintoModal({
  recinto,
  cantones,
  onClose,
  onDone,
}: {
  recinto?: Recinto;
  cantones?: Canton[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    codigoRecinto: recinto?.codigoRecinto ?? '',
    nombre: recinto?.nombre ?? '',
    direccion: recinto?.direccion ?? '',
    cantonId: recinto ? String(recinto.cantonId) : '',
    parroquia: recinto?.parroquia ?? '',
    zona: recinto?.zona ?? '',
    tipo: recinto?.tipo ?? 'CDA',
    latitud: recinto ? String(recinto.latitud) : '',
    longitud: recinto ? String(recinto.longitud) : '',
    tieneInternet: recinto?.tieneInternet ?? false,
    coberturaMovil: recinto?.coberturaMovil ?? false,
    numeroElectores: recinto?.numeroElectores != null ? String(recinto.numeroElectores) : '',
    juntasFemeninas: recinto?.juntasFemeninas != null ? String(recinto.juntasFemeninas) : '',
    juntasMasculinas: recinto?.juntasMasculinas != null ? String(recinto.juntasMasculinas) : '',
    esDificilAcceso: recinto?.esDificilAcceso ?? false,
    contingenciaNombre: recinto?.contingenciaNombre ?? '',
    contingenciaDireccion: recinto?.contingenciaDireccion ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function textField(k: TextFieldKey) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function checkboxField(k: 'tieneInternet' | 'coberturaMovil' | 'esDificilAcceso') {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.checked }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      codigoRecinto: form.codigoRecinto,
      nombre: form.nombre,
      direccion: form.direccion || null,
      cantonId: form.cantonId ? Number(form.cantonId) : undefined,
      parroquia: form.parroquia || null,
      zona: form.zona || null,
      tipo: form.tipo,
      latitud: form.latitud !== '' ? Number(form.latitud) : undefined,
      longitud: form.longitud !== '' ? Number(form.longitud) : undefined,
      tieneInternet: form.tieneInternet,
      coberturaMovil: form.coberturaMovil,
      numeroElectores: form.numeroElectores !== '' ? Number(form.numeroElectores) : null,
      juntasFemeninas: form.juntasFemeninas !== '' ? Number(form.juntasFemeninas) : null,
      juntasMasculinas: form.juntasMasculinas !== '' ? Number(form.juntasMasculinas) : null,
      esDificilAcceso: form.esDificilAcceso,
      // Solo los CDA tienen unidad de contingencia.
      ...(form.tipo === 'CDA' && {
        contingenciaNombre: form.contingenciaNombre.trim() || null,
        contingenciaDireccion: form.contingenciaDireccion.trim() || null,
      }),
    };
    const schema = recinto ? updateRecintoSchema : createRecintoSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      if (recinto) {
        await api.patch(`/recintos/${recinto.id}`, parsed.data);
      } else {
        await api.post('/recintos', parsed.data);
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 520, width: '100%', margin: '0 auto' }}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <h1 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
          {recinto ? 'Editar recinto' : 'Nuevo recinto'}
        </h1>

        <div className="field">
          <label htmlFor="recintos-codigo-de-recinto">Código de recinto</label>
          <input id="recintos-codigo-de-recinto"
            value={form.codigoRecinto}
            onChange={textField('codigoRecinto')}
            required
            maxLength={20}
          />
        </div>

        <div className="field">
          <label htmlFor="recintos-nombre">Nombre</label>
          <input id="recintos-nombre" value={form.nombre} onChange={textField('nombre')} required maxLength={255} />
        </div>

        <div className="field">
          <label htmlFor="recintos-direccion-opcional">Dirección (opcional)</label>
          <input id="recintos-direccion-opcional" value={form.direccion} onChange={textField('direccion')} maxLength={255} />
        </div>

        <div className="field">
          <label htmlFor="recintos-canton">Cantón</label>
          <select id="recintos-canton" value={form.cantonId} onChange={textField('cantonId')} required>
            <option value="">Selecciona…</option>
            {cantones?.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="recintos-parroquia-opcional">Parroquia (opcional)</label>
            <input id="recintos-parroquia-opcional" value={form.parroquia} onChange={textField('parroquia')} maxLength={120} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="recintos-zona-opcional">Zona (opcional)</label>
            <input id="recintos-zona-opcional" value={form.zona} onChange={textField('zona')} maxLength={120} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="recintos-tipo">Tipo</label>
          <select id="recintos-tipo"
            value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoRecinto }))}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>{TIPO_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="recintos-latitud">Latitud</label>
            <input id="recintos-latitud"
              type="number"
              step="any"
              value={form.latitud}
              onChange={textField('latitud')}
              required
              placeholder="Ej.: 0.347627"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="recintos-longitud">Longitud</label>
            <input id="recintos-longitud"
              type="number"
              step="any"
              value={form.longitud}
              onChange={textField('longitud')}
              required
              placeholder="Ej.: -78.125852"
            />
          </div>
        </div>

        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="recintos-juntas-femeninas-jf">Juntas Femeninas (JF)</label>
            <input id="recintos-juntas-femeninas-jf"
              type="number"
              min={0}
              value={form.juntasFemeninas}
              onChange={textField('juntasFemeninas')}
              placeholder="0"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="recintos-juntas-masculinas-jm">Juntas Masculinas (JM)</label>
            <input id="recintos-juntas-masculinas-jm"
              type="number"
              min={0}
              value={form.juntasMasculinas}
              onChange={textField('juntasMasculinas')}
              placeholder="0"
            />
          </div>
        </div>

        {(form.juntasFemeninas !== '' || form.juntasMasculinas !== '') && (
          <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            JT (total) = {(Number(form.juntasFemeninas) || 0) + (Number(form.juntasMasculinas) || 0)}
          </p>
        )}

        {form.tipo === 'CDA' && (
          <>
            <div className="field">
              <label htmlFor="recinto-contingencia-nombre">Unidad de contingencia (problema con el kit)</label>
              <input
                id="recinto-contingencia-nombre"
                value={form.contingenciaNombre}
                onChange={textField('contingenciaNombre')}
                maxLength={255}
                placeholder="Ej.: UE Juan Montalvo"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="recinto-contingencia-direccion">Dirección de la unidad de contingencia</label>
              <input
                id="recinto-contingencia-direccion"
                value={form.contingenciaDireccion}
                onChange={textField('contingenciaDireccion')}
                maxLength={255}
                autoComplete="off"
              />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="recintos-numero-de-electores-opcional">Número de electores (opcional)</label>
          <input id="recintos-numero-de-electores-opcional"
            type="number"
            min={0}
            value={form.numeroElectores}
            onChange={textField('numeroElectores')}
          />
        </div>

        <div className="row" style={{ gap: '1.5rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={form.tieneInternet}
              onChange={checkboxField('tieneInternet')}
            />
            Tiene internet
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={form.coberturaMovil}
              onChange={checkboxField('coberturaMovil')}
            />
            Cobertura móvil
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={form.esDificilAcceso}
              onChange={checkboxField('esDificilAcceso')}
            />
            Recinto de difícil acceso
          </label>
        </div>

        {error && <div className="banner error" role="alert">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem', gap: '0.5rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : recinto ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
