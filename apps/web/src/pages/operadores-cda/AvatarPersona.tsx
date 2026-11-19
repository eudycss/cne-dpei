import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { getIdsConFoto } from '../../lib/queries/operadores-cda';
import { useFotoOperadorUrl } from './useFotoOperador';
import { cargoCorto, iniciales } from './utils';

/** true cuando el elemento entra (o está por entrar) en pantalla; luego se queda en true. */
export function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);
  return { ref, visible };
}

/**
 * Quiénes tienen foto, para los listados cuya respuesta no trae `tieneFoto`.
 * Una sola consulta liviana (solo ids) compartida por toda la página.
 */
export function useTieneFoto(operadorId: string | null, conocido?: boolean): boolean {
  const { data } = useQuery({
    queryKey: ['operadores-cda', 'con-foto'],
    queryFn: getIdsConFoto,
    enabled: conocido === undefined && operadorId !== null,
    staleTime: 5 * 60_000,
    retry: false,
    select: (ids) => new Set(ids),
  });
  if (operadorId === null) return false;
  return conocido ?? data?.has(operadorId) ?? false;
}

export interface PersonaAvatar {
  /** Id del personal CDA/CPE; null = persona externa (sin foto). */
  operadorId: string | null;
  nombre: string;
  cedula?: string;
  cargo?: string;
  /** Si el listado ya lo sabe; si no, se consulta una vez para toda la página. */
  tieneFoto?: boolean;
}

/**
 * Foto descifrada o, mientras no haya, las iniciales. Solo se pide al acercarse
 * a la pantalla y queda en caché: cada foto se descifra en la API (Render, 0.1
 * vCPU). Al pulsarla se ve en grande.
 */
export function AvatarPersona({
  persona: p,
  tamano = 'normal',
  ampliable = true,
}: {
  persona: PersonaAvatar;
  tamano?: 'chico' | 'normal' | 'grande';
  /** false en listas de selección: la foto se ve pero no se pulsa (sin parada de tabulación extra). */
  ampliable?: boolean;
}) {
  const { ref, visible } = useVisible<HTMLSpanElement>();
  const tieneFoto = useTieneFoto(p.operadorId, p.tieneFoto);
  const url = useFotoOperadorUrl({ id: p.operadorId ?? '', tieneFoto }, visible && p.operadorId !== null);
  const [ampliada, setAmpliada] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const clase = `ocda-avatar${tamano === 'normal' ? '' : ` ${tamano}`}${tieneFoto ? ' con-foto' : ''}`;

  return (
    <span ref={ref} className={clase}>
      {url && !ampliable ? (
        <img src={url} alt="" />
      ) : url ? (
        <button ref={boton} type="button" className="ocda-avatar-boton" aria-label={`Ver foto ampliada: ${p.nombre}`} onClick={() => setAmpliada(true)}>
          <img src={url} alt="" />
        </button>
      ) : (
        <span aria-hidden="true">{iniciales(p.nombre)}</span>
      )}
      {ampliada && url && (
        <FotoAmpliadaModal
          persona={p}
          url={url}
          onClose={() => {
            setAmpliada(false);
            boton.current?.focus();
          }}
        />
      )}
    </span>
  );
}

/** La foto en grande, para revisar que sea la persona. */
function FotoAmpliadaModal({ persona: p, url, onClose }: { persona: PersonaAvatar; url: string; onClose: () => void }) {
  const id = `foto-ampliada-${p.operadorId}`;
  // Al body: una tarjeta animada (transform) encerraría el fondo fijo del modal.
  return createPortal(
    <Modal labelledBy={id} onClose={onClose} maxWidth={560}>
      <div className="ocda-modal">
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id={id}>{p.nombre}</h2>
            {(p.cedula || p.cargo) && (
              <p className="muted">
                {p.cedula && <span className="mono">{p.cedula}</span>}
                {p.cedula && p.cargo && ' · '}
                {p.cargo && cargoCorto(p.cargo)}
              </p>
            )}
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <img className="ocda-foto-ampliada" src={url} alt={`Foto de ${p.nombre}`} />
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * Miniatura chica junto al nombre, para celdas de tablas y listas. No se pulsa
 * (ampliable=false por defecto): dentro de un <th> o junto a casillas, un botón
 * duplicaría el nombre para el lector de pantalla y sumaría una parada de Tab.
 */
export function ConFoto({ persona, ampliable = false, children }: { persona: PersonaAvatar; ampliable?: boolean; children: ReactNode }) {
  return (
    <span className="ocda-con-foto">
      <AvatarPersona persona={persona} tamano="chico" ampliable={ampliable} />
      <span>{children}</span>
    </span>
  );
}
