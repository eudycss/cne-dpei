import { useEffect, useState } from 'react';
import LatticeLoader from './micro/LatticeLoader/LatticeLoader';

/**
 * Indicador de carga. LatticeLoader anuncia en inglés ("…, in progress"), así
 * que queda oculto para el lector de pantalla y el anuncio va en español.
 * La región role="status" nace vacía y el texto se inserta después: muchos
 * lectores no anuncian una región live que ya aparece con contenido.
 */
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  const [anuncio, setAnuncio] = useState('');
  useEffect(() => {
    setAnuncio(texto);
  }, [texto]);

  return (
    <span className="cargando">
      <span aria-hidden="true">
        <LatticeLoader
          label={texto}
          showTimer={false}
          color="var(--primary)"
          fontSize={13}
          pattern="orbit"
        />
      </span>
      <span role="status" className="sr-only">
        {anuncio}
      </span>
    </span>
  );
}
