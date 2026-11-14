import { useRef } from 'react';
import { NumeroAnimado } from '../../components/NumeroAnimado';
import { Tramo, useAnimarReorden } from '../operadores-cda/AvanceEvatics';
import { porcentaje, type GrupoAvance } from './estadisticas';

/**
 * Barras de avance por grupo (cantón o técnico), de la que más avanzó a la que
 * menos. Cada barra crece desde 0 y, si otro grupo la pasa, se desliza a su
 * nuevo lugar. Las cifras van en texto: el color nunca va solo.
 */
export function AvanceEtapas({
  titulo,
  grupos,
  vacio,
  etiquetaHecho,
}: {
  titulo: string;
  grupos: GrupoAvance[];
  vacio: string;
  /** "ya llegaron", "ya salieron"… para el nombre accesible de cada barra. */
  etiquetaHecho: string;
}) {
  const lista = useRef<HTMLUListElement>(null);
  useAnimarReorden(lista);

  return (
    <section className="evx-avance" aria-label={titulo}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>{titulo}</h3>
      {grupos.length === 0 ? (
        <p className="muted">{vacio}</p>
      ) : (
        <ul className="evx-barras" ref={lista}>
          {grupos.map((g) => (
            <li key={g.nombre} data-clave={g.nombre}>
              <div
                className="evx-fila"
                style={{ cursor: 'default' }}
                role="img"
                aria-label={`${g.nombre}: ${g.hechos} de ${g.total} ${etiquetaHecho} (${porcentaje(g.hechos, g.total)} %)`}
              >
                <span className="evx-nombre">{g.nombre}</span>
                <span className="evx-barra" aria-hidden="true">
                  <Tramo valor={g.hechos} clase="aprobado" atenuado={false} />
                  <Tramo valor={g.total - g.hechos} clase="sin-subir" atenuado={false} />
                </span>
                <span className="evx-cifra" aria-hidden="true">
                  <NumeroAnimado valor={g.hechos} />/{g.total} · <NumeroAnimado valor={porcentaje(g.hechos, g.total)} /> %
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
