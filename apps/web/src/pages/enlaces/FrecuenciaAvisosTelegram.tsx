import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ConfigEnlacesResponse } from '@cne/shared-types';
import { MINUTOS_AVISO_ENLACES } from '@cne/shared-validation';
import { guardarAvisosEnlaces } from '../../lib/queries/enlaces';

/** 10 → "10 min", 120 → "2 h". */
export function textoMinutos(minutos: number): string {
  return minutos < 60 ? `${minutos} min` : `${minutos / 60} h`;
}

const estiloSelect = {
  padding: '0.5rem 0.65rem',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: '0.9rem',
  width: '100%',
} as const;

interface Props {
  config: ConfigEnlacesResponse | undefined;
}

/**
 * Cada cuánto avisa el bot de Telegram de los enlaces caídos. Aplica desde el
 * siguiente ciclo del bot (cada 5 min), sin deploy: p. ej. 2 h en días
 * normales y 10 min el día de votaciones.
 */
export function FrecuenciaAvisosTelegram({ config }: Props) {
  const qc = useQueryClient();
  const [primer, setPrimer] = useState<number | null>(null);
  const [repetir, setRepetir] = useState<number | null>(null);

  // Al llegar (o cambiar) la configuración del servidor, los selectores la reflejan.
  useEffect(() => {
    if (!config) return;
    setPrimer(config.minutosPrimerAviso);
    setRepetir(config.minutosRepetirAviso);
  }, [config?.minutosPrimerAviso, config?.minutosRepetirAviso]);

  const guardar = useMutation({
    mutationFn: guardarAvisosEnlaces,
    onSuccess: (guardado) => {
      qc.setQueryData(['enlaces-config'], guardado);
      sileo.success({
        title: `Avisos guardados: primero a ${textoMinutos(guardado.minutosPrimerAviso)}, luego cada ${textoMinutos(
          guardado.minutosRepetirAviso,
        )}`,
      });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo guardar la frecuencia de avisos' });
    },
  });

  const cambiado =
    config !== undefined &&
    primer !== null &&
    repetir !== null &&
    (primer !== config.minutosPrimerAviso || repetir !== config.minutosRepetirAviso);

  const selector = (id: string, etiqueta: string, valor: number | null, onChange: (m: number) => void) => (
    <div style={{ flex: 1, minWidth: 150 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
        {etiqueta}
      </label>
      <select
        id={id}
        value={valor ?? ''}
        disabled={valor === null || guardar.isPending}
        onChange={(e) => onChange(Number(e.target.value))}
        style={estiloSelect}
      >
        {MINUTOS_AVISO_ENLACES.map((m) => (
          <option key={m} value={m}>
            {textoMinutos(m)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section aria-labelledby="frecuencia-avisos-titulo" style={{ marginBottom: '1.25rem' }}>
      <h2 id="frecuencia-avisos-titulo" style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
        Avisos por Telegram
      </h2>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {selector('minutos-primer-aviso', 'Primer aviso a los', primer, setPrimer)}
        {selector('minutos-repetir-aviso', 'Repetir cada', repetir, setRepetir)}
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0 0.5rem' }}>
        Aplica en el siguiente ciclo del bot (máximo 5 min). Día de votaciones: 10 min.
      </p>
      <button
        type="button"
        className="btn"
        disabled={!cambiado || guardar.isPending}
        onClick={() => primer !== null && repetir !== null && guardar.mutate({ minutosPrimerAviso: primer, minutosRepetirAviso: repetir })}
      >
        {guardar.isPending ? 'Guardando…' : 'Guardar frecuencia'}
      </button>
    </section>
  );
}
