import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { DispositivoCda, PersonaParejaCda } from '@cne/shared-types';
import { cambiarDispositivoOperadorCda } from '../../lib/queries/operadores-cda';
import { mensajeError } from './utils';

const TEXTO: Record<DispositivoCda, string> = { ANDROID: 'Android', IPHONE: 'iPhone' };

/**
 * Celular de una persona de la pareja. El administrador lo cambia aquí mismo
 * (se guarda en la persona, vale para todas las listas); los demás lo leen.
 */
export function DispositivoPersona({ rol, persona, editable }: { rol: string; persona: PersonaParejaCda | null; editable: boolean }) {
  const qc = useQueryClient();
  const cambiar = useMutation({
    mutationFn: (d: DispositivoCda | null) => cambiarDispositivoOperadorCda((persona as PersonaParejaCda).id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parejas-cda'] }),
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar el dispositivo') }),
  });
  const valor = persona?.dispositivo ?? null;

  if (!persona || !editable) {
    return (
      <div>
        {rol}: {valor ? TEXTO[valor] : '—'}
      </div>
    );
  }
  return (
    <label className="ocda-dispositivo" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: '0.15rem 0' }}>
      <span>{rol}:</span>
      <select
        value={valor ?? ''}
        onChange={(e) => cambiar.mutate((e.target.value || null) as DispositivoCda | null)}
        disabled={cambiar.isPending}
        aria-label={`${rol}: dispositivo de ${persona.apellidosNombres}`}
      >
        <option value="">—</option>
        <option value="ANDROID">Android</option>
        <option value="IPHONE">iPhone</option>
      </select>
    </label>
  );
}
