import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConfigAlertas, EventoElectoral } from '@cne/shared-types';
import { MARGEN_LLEGADA_MAX_METROS, configAlertasSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';

// ─── Modal configurar alertas ─────────────────────────────────────────────────

export type ConfigAlertasTexto = Record<keyof ConfigAlertas, string>;

/** A partir de aquí se advierte que la geocerca de llegada queda casi sin efecto. */
const MARGEN_AVISO_METROS = 5_000;

const ETIQUETA_CONFIG: Record<keyof ConfigAlertas, string> = {
  umbralLlegadaRecintoMin: 'Umbral llegada al recinto (1 a 1440 min)',
  umbralLlegadaDpiMin: 'Umbral llegada a la DPEI (1 a 1440 min)',
  umbralSinSyncMin: 'Umbral sin sincronización (1 a 1440 min)',
  margenLlegadaMetros: `Margen de llegada (10 a ${MARGEN_LLEGADA_MAX_METROS.toLocaleString('es-EC')} m, número entero)`,
};

export function configATexto(c: ConfigAlertas): ConfigAlertasTexto {
  return {
    umbralLlegadaRecintoMin: String(c.umbralLlegadaRecintoMin),
    umbralLlegadaDpiMin: String(c.umbralLlegadaDpiMin),
    umbralSinSyncMin: String(c.umbralSinSyncMin),
    margenLlegadaMetros: String(c.margenLlegadaMetros),
  };
}

export function textoAConfig(t: ConfigAlertasTexto): ConfigAlertas {
  return {
    umbralLlegadaRecintoMin: Number(t.umbralLlegadaRecintoMin),
    umbralLlegadaDpiMin: Number(t.umbralLlegadaDpiMin),
    umbralSinSyncMin: Number(t.umbralSinSyncMin),
    margenLlegadaMetros: Number(t.margenLlegadaMetros),
  };
}

export function ConfigAlertasModal({
  evento,
  onClose,
  onDone,
}: {
  evento: EventoElectoral;
  onClose: () => void;
  onDone: () => void;
}) {
  // Cargar config actual del evento (incluye configAlertas)
  const { data: detalle } = useQuery({
    queryKey: ['evento-detalle', evento.id],
    queryFn: async () => (await api.get<EventoElectoral>(`/eventos/${evento.id}`)).data,
  });

  const cfg = detalle?.configAlertas;

  // Los valores se guardan como texto mientras se escriben: con Number('')
  // el campo se volvía "0" al borrarlo y no se podía escribir otro número.
  const [form, setForm] = useState<ConfigAlertasTexto>(() =>
    configATexto({
      umbralLlegadaRecintoMin: cfg?.umbralLlegadaRecintoMin ?? 120,
      umbralLlegadaDpiMin: cfg?.umbralLlegadaDpiMin ?? 120,
      umbralSinSyncMin: cfg?.umbralSinSyncMin ?? 30,
      margenLlegadaMetros: cfg?.margenLlegadaMetros ?? 150,
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [campoError, setCampoError] = useState<keyof ConfigAlertas | null>(null);
  const [saving, setSaving] = useState(false);

  // Sincronizar form cuando llegue el detalle
  const [synced, setSynced] = useState(false);
  if (cfg && !synced) {
    setForm(configATexto(cfg));
    setSynced(true);
  }

  function numField(k: keyof ConfigAlertas) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const valor = e.target.value;
      setForm((f) => ({ ...f, [k]: valor }));
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCampoError(null);
    const vacio = (Object.keys(form) as (keyof ConfigAlertas)[]).find((k) => form[k].trim() === '');
    if (vacio) {
      setCampoError(vacio);
      setError('Completa todos los campos.');
      return;
    }
    const parsed = configAlertasSchema.safeParse(textoAConfig(form));
    if (!parsed.success) {
      // Los mensajes de zod vienen en inglés: se indica el campo y su rango válido.
      const campo = parsed.error.issues[0]?.path[0] as keyof ConfigAlertas | undefined;
      setCampoError(campo ?? null);
      setError(campo ? `Valor no válido en: ${ETIQUETA_CONFIG[campo]}.` : 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/eventos/${evento.id}/config-alertas`, parsed.data);
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="config-alertas-titulo" onClose={onClose} maxWidth={480}>
      {/* noValidate: la validación propia da mensajes en español con el rango
          de cada campo, en vez de las burbujas nativas del navegador. */}
      <form className="login-card" style={{ width: '100%' }} onSubmit={onSubmit} noValidate>
        <h1 id="config-alertas-titulo">Configurar umbrales de alerta</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Evento: <strong>{evento.nombre}</strong>. Los valores se expresan en
          minutos.
        </p>

        <div className="field">
          <label htmlFor="cfg-umbral-recinto">Umbral llegada al recinto (min)</label>
          <input
            id="cfg-umbral-recinto"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={form.umbralLlegadaRecintoMin}
            onChange={numField('umbralLlegadaRecintoMin')}
            aria-invalid={campoError === 'umbralLlegadaRecintoMin' || undefined}
            aria-describedby="cfg-umbral-recinto-ayuda"
            required
          />
          <span id="cfg-umbral-recinto-ayuda" className="muted">
            Alerta si el operador no llega al recinto antes de X minutos de la
            jornada.
          </span>
        </div>

        <div className="field">
          <label htmlFor="cfg-umbral-dpi">Umbral llegada a la DPEI (min)</label>
          <input
            id="cfg-umbral-dpi"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={form.umbralLlegadaDpiMin}
            onChange={numField('umbralLlegadaDpiMin')}
            aria-invalid={campoError === 'umbralLlegadaDpiMin' || undefined}
            aria-describedby="cfg-umbral-dpi-ayuda"
            required
          />
          <span id="cfg-umbral-dpi-ayuda" className="muted">
            Alerta si el operador no registra llegada a la DPEI en X minutos.
          </span>
        </div>

        <div className="field">
          <label htmlFor="cfg-umbral-sync">Umbral sin sincronización (min)</label>
          <input
            id="cfg-umbral-sync"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={form.umbralSinSyncMin}
            onChange={numField('umbralSinSyncMin')}
            aria-invalid={campoError === 'umbralSinSyncMin' || undefined}
            aria-describedby="cfg-umbral-sync-ayuda"
            required
          />
          <span id="cfg-umbral-sync-ayuda" className="muted">
            Alerta si no se recibe ningún dato del operador en X minutos.
          </span>
        </div>

        <div className="field">
          <label htmlFor="cfg-margen-llegada">Margen de llegada al recinto (m)</label>
          <input
            id="cfg-margen-llegada"
            type="number"
            inputMode="numeric"
            min={10}
            max={MARGEN_LLEGADA_MAX_METROS}
            step={1}
            value={form.margenLlegadaMetros}
            onChange={numField('margenLlegadaMetros')}
            aria-invalid={campoError === 'margenLlegadaMetros' || undefined}
            aria-describedby="cfg-margen-llegada-ayuda"
            required
          />
          <span id="cfg-margen-llegada-ayuda" className="muted">
            Distancia máxima permitida para registrar "Llegada al Recinto" (de 10 m a{' '}
            {MARGEN_LLEGADA_MAX_METROS.toLocaleString('es-EC')} m). Sube este valor
            temporalmente en un evento de prueba para hacer una demo sin estar en el recinto real.
          </span>
          {Number(form.margenLlegadaMetros) > MARGEN_AVISO_METROS ? (
            <div className="banner" role="status" style={{ marginTop: '0.5rem' }}>
              Con más de {MARGEN_AVISO_METROS / 1000} km, la llegada al recinto prácticamente no se
              valida. Úsalo solo en eventos de prueba y vuelve al valor normal al terminar.
            </div>
          ) : null}
        </div>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
