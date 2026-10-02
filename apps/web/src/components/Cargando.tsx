import LatticeLoader from './micro/LatticeLoader/LatticeLoader';

/**
 * Indicador de carga. LatticeLoader anuncia en inglés ("…, in progress"), así
 * que queda oculto para el lector de pantalla y el anuncio va en español.
 */
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
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
        {texto}
      </span>
    </span>
  );
}
