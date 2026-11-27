import { useEffect, useId, useRef, useState } from 'react';

export interface OpcionPersona {
  id: string;
  /** "Apellidos Nombres" */
  titulo: string;
  /** "C.I. 1002003004 · Escuela X" */
  detalle: string;
  /** p. ej. "De otro recinto" */
  aviso?: string;
}

export const ESPERA_BUSQUEDA_MS = 350;

/**
 * Elegir una persona (radio) entre las sugeridas o, si no está, buscarla en el
 * servidor (mínimo 2 caracteres, con espera para no consultar en cada tecla).
 * Mismo comportamiento que el selector de la app móvil.
 */
export function SelectorPersona({
  titulo,
  sugeridas,
  seleccionado,
  onSeleccionar,
  buscar,
  etiquetaBuscador,
  excluir,
}: {
  titulo: string;
  sugeridas: OpcionPersona[];
  seleccionado: OpcionPersona | null;
  onSeleccionar: (opcion: OpcionPersona) => void;
  buscar: (texto: string) => Promise<OpcionPersona[]>;
  etiquetaBuscador: string;
  /** Persona que no se ofrece (p. ej. el militar que ya tiene el kit). */
  excluir?: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<OpcionPersona[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consulta = useRef(0);
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  useEffect(() => {
    const q = texto.trim();
    const n = ++consulta.current;
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      setError(null);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarRef
        .current(q)
        .then((r) => {
          if (n !== consulta.current) return; // llegó una búsqueda más nueva
          setResultados(r);
          setError(null);
        })
        .catch(() => {
          if (n !== consulta.current) return;
          setResultados([]); // no mostrar resultados viejos junto al error
          setError('No se pudo buscar. Revise la conexión.');
        })
        .finally(() => {
          if (n === consulta.current) setBuscando(false);
        });
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(t);
  }, [texto]);

  // Una persona sugerida que también sale en la búsqueda se muestra una sola vez.
  const idsSugeridas = new Set(sugeridas.map((s) => s.id));
  const extra = resultados.filter((r) => !idsSugeridas.has(r.id) && r.id !== excluir);
  // La persona elegida sigue a la vista aunque se cambie la búsqueda: nunca se guarda a alguien que no se ve.
  const elegidaOculta = seleccionado && !idsSugeridas.has(seleccionado.id) && !extra.some((r) => r.id === seleccionado.id);
  const opciones = [...(elegidaOculta ? [seleccionado] : []), ...sugeridas, ...extra];
  const q = texto.trim();

  return (
    <fieldset className="cem-selector">
      <legend>{titulo}</legend>
      {opciones.length === 0 && q.length < 2 && <p className="muted">No hay sugeridos: busque por cédula o nombre.</p>}
      {opciones.length > 0 && (
        <ul className="cem-opciones">
          {opciones.map((o) => (
            <li key={o.id}>
              <label className={`cem-opcion${seleccionado?.id === o.id ? ' elegida' : ''}`}>
                <input
                  type="radio"
                  name={`persona-${id}`}
                  checked={seleccionado?.id === o.id}
                  onChange={() => onSeleccionar(o)}
                />
                <span>
                  <strong>{o.titulo}</strong>
                  <span className="cem-opcion-detalle">{o.detalle}</span>
                  {o.aviso && <span className="cem-opcion-aviso">{o.aviso}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="field" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        <label htmlFor={`buscar-${id}`}>{etiquetaBuscador}</label>
        <input
          id={`buscar-${id}`}
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>
      <p className="muted" role="status" aria-live="polite" style={{ margin: '0.35rem 0 0' }}>
        {buscando ? 'Buscando…' : q.length >= 2 && !error && resultados.length === 0 ? 'Sin resultados' : ''}
      </p>
      {error && (
        <p className="banner error" role="alert" style={{ margin: '0.35rem 0 0' }}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
