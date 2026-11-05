import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ConfigEnlacesResponse } from '@cne/shared-types';
import { MINUTOS_RESUMEN_JORNADA } from '@cne/shared-validation';
import { guardarResumenJornada } from '../../lib/queries/enlaces';
import { textoMinutos } from './FrecuenciaAvisosTelegram';

interface Props {
  config: ConfigEnlacesResponse | undefined;
}

/**
 * Cada cuánto manda el bot el resumen automático al grupo Jornada (también se
 * cambia desde el bot con "⏱ Frecuencia del resumen"). Aplica en el siguiente minuto.
 */
export function FrecuenciaResumenJornada({ config }: Props) {
  const qc = useQueryClient();
  const [minutos, setMinutos] = useState<number | null>(null);

  useEffect(() => {
    if (config) setMinutos(config.minutosResumenJornada);
  }, [config?.minutosResumenJornada]);

  const guardar = useMutation({
    mutationFn: guardarResumenJornada,
    onSuccess: (guardado) => {
      qc.setQueryData(['enlaces-config'], guardado);
      sileo.success({ title: `Resumen de la Jornada: cada ${textoMinutos(guardado.minutosResumenJornada)}` });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo guardar la frecuencia del resumen' });
    },
  });

  const cambiado = config !== undefined && minutos !== null && minutos !== config.minutosResumenJornada;

  return (
    <section aria-labelledby="frecuencia-resumen-titulo" style={{ marginBottom: '1.25rem' }}>
      <h2 id="frecuencia-resumen-titulo" style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
        Resumen de la Jornada
      </h2>
      <label htmlFor="minutos-resumen-jornada" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
        Enviar el resumen cada
      </label>
      <select
        id="minutos-resumen-jornada"
        value={minutos ?? ''}
        disabled={minutos === null || guardar.isPending}
        onChange={(e) => setMinutos(Number(e.target.value))}
        style={{
          padding: '0.5rem 0.65rem',
          border: '1px solid var(--border-input)',
          borderRadius: 6,
          fontSize: '0.9rem',
          width: '100%',
        }}
      >
        {MINUTOS_RESUMEN_JORNADA.map((m) => (
          <option key={m} value={m}>
            {textoMinutos(m)}
          </option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0 0.5rem' }}>
        Sin sonido y solo si algo cambió; el cierre de la jornada llega apenas todos vuelven. Aplica en el siguiente
        minuto.
      </p>
      <button
        type="button"
        className="btn"
        disabled={!cambiado || guardar.isPending}
        onClick={() => minutos !== null && guardar.mutate({ minutosResumenJornada: minutos })}
      >
        {guardar.isPending ? 'Guardando…' : 'Guardar frecuencia del resumen'}
      </button>
    </section>
  );
}
