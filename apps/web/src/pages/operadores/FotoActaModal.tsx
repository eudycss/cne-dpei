import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cargando } from '../../components/Cargando';
import { getFotoActa, type TipoFotoCda } from '../../lib/queries/monitoreo';

const TITULO_ACTA: Record<TipoFotoCda, string> = {
  instalacion: 'Reporte de instalación',
  escrutinio: 'Reporte de escrutinio',
  conexion: 'Foto de la prueba de conexión',
};

/** Foto de un reporte (instalación/escrutinio) o de la computadora de la prueba de conexión de un CDA. */
export function FotoActaModal({
  cda,
  tipo,
  onClose,
}: {
  cda: { recintoId: string; nombreRecinto: string; operadorNombre: string };
  tipo: TipoFotoCda;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['foto-acta', cda.recintoId, tipo],
    queryFn: () => getFotoActa(cda.recintoId, tipo),
  });

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const objectUrl = URL.createObjectURL(data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, padding: '2rem 0' }}
    >
      <div
        className="login-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="foto-acta-titulo"
        style={{ maxWidth: 480, width: '100%', padding: 0, overflow: 'hidden' }}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
          <h2 id="foto-acta-titulo" style={{ margin: 0 }}>
            {TITULO_ACTA[tipo]}
          </h2>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            {cda.nombreRecinto} · {cda.operadorNombre}
          </p>
        </div>
        <div
          style={{ padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}
        >
          {isLoading ? (
            <Cargando texto={tipo === 'conexion' ? 'Cargando foto…' : 'Cargando reporte…'} />
          ) : isError ? (
            <p role="alert" style={{ color: 'var(--error)' }}>
              No se pudo cargar la foto.
            </p>
          ) : url ? (
            <img src={url} alt={TITULO_ACTA[tipo]} style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }} />
          ) : null}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '1rem' }}>
          <button className="btn secondary" onClick={onClose} autoFocus>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
