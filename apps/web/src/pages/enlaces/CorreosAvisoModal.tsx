import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import {
  addCorreoEnlace,
  getConfigEnlaces,
  reenviarListaTelegram,
  removeCorreoEnlace,
} from '../../lib/queries/enlaces';

interface Props {
  onClose: () => void;
}

/**
 * Gestión de correos y Telegram en un modal separado: antes vivía como una
 * tarjeta fija arriba de la página, empujando la tabla de recintos fuera de
 * la vista cuando había varios correos registrados.
 */
export function CorreosAvisoModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [nuevoCorreo, setNuevoCorreo] = useState('');
  const cerrarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cerrarRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const { data: config } = useQuery({
    queryKey: ['enlaces-config'],
    queryFn: getConfigEnlaces,
  });

  const agregar = useMutation({
    mutationFn: (correo: string) => addCorreoEnlace(correo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enlaces-config'] });
      setNuevoCorreo('');
      sileo.success({ title: 'Correo agregado' });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo agregar el correo' });
    },
  });

  const quitar = useMutation({
    mutationFn: (correo: string) => removeCorreoEnlace(correo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enlaces-config'] });
      sileo.success({ title: 'Correo eliminado' });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo eliminar el correo' });
    },
  });

  const reenviarTelegram = useMutation({
    mutationFn: reenviarListaTelegram,
    onSuccess: ({ enviados }) => {
      sileo.success({
        title: enviados > 0 ? `Lista reenviada a Telegram (${enviados} caídos)` : 'Reenviado: no hay enlaces caídos',
      });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo reenviar la lista a Telegram' });
    },
  });

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
      onClick={onClose}
    >
      <div
        className="login-card"
        style={{ maxWidth: 480, width: '100%' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="correos-aviso-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <h1 id="correos-aviso-titulo">Correos que reciben el aviso de enlace caído</h1>
        <ul style={{ paddingLeft: '1.1rem' }}>
          {(config?.correos ?? []).map((correo) => (
            <li key={correo} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              {correo}
              <button
                className="btn secondary"
                aria-label={`Quitar ${correo}`}
                disabled={quitar.isPending}
                onClick={() => quitar.mutate(correo)}
              >
                Quitar
              </button>
            </li>
          ))}
          {(config?.correos ?? []).length === 0 && (
            <li className="muted" style={{ listStyle: 'none', marginLeft: '-1.1rem' }}>
              Ningún correo registrado todavía.
            </li>
          )}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <label style={{ display: 'none' }} htmlFor="nuevo-correo-enlace">Nuevo correo</label>
          <input
            id="nuevo-correo-enlace"
            aria-label="Nuevo correo"
            type="email"
            value={nuevoCorreo}
            onChange={(e) => setNuevoCorreo(e.target.value)}
            placeholder="correo@cne.gob.ec"
            style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', flex: 1 }}
          />
          <button
            className="btn"
            disabled={!nuevoCorreo || agregar.isPending}
            onClick={() => agregar.mutate(nuevoCorreo)}
          >
            Agregar
          </button>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <button
            className="btn secondary"
            disabled={reenviarTelegram.isPending}
            onClick={() => reenviarTelegram.mutate()}
          >
            Reenviar lista a Telegram
          </button>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
            Manda al grupo de Telegram configurado el estado actual completo — útil después de agregar gente nueva al grupo.
            También puedes escribir <code>/caidos</code> directamente en el grupo para consultarlo en cualquier momento.
          </p>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button ref={cerrarRef} className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
