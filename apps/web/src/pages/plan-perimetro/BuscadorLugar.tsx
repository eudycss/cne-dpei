import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useMapInstance } from '../../components/map';
import { buscarLugares, leerCoordenadas, MAX_LARGO_BUSQUEDA, type LugarEncontrado } from './buscarLugar';

/** Zoom al llegar a un lugar: se ven las calles y el contorno del recinto. */
export const ZOOM_LUGAR = 18;

type Estado = { tipo: 'inactivo' } | { tipo: 'buscando' } | { tipo: 'resultados'; lista: LugarEncontrado[] } | { tipo: 'aviso'; texto: string };

/**
 * Buscador del lugar donde va el perímetro: un nombre (OpenStreetMap) o
 * coordenadas / enlace de Google Maps. Elegir un resultado lleva el mapa allí.
 */
export function BuscadorLugar() {
  const map = useMapInstance();
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'inactivo' });
  const [anuncio, setAnuncio] = useState('');
  const pedido = useRef<AbortController | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const idLista = useId();

  useEffect(() => () => pedido.current?.abort(), []);

  function irA(lat: number, lng: number, nombre: string) {
    const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), ZOOM_LUGAR), duration: sinMovimiento ? 0 : 1500 });
    setEstado({ tipo: 'inactivo' });
    setAnuncio(`Mapa en ${nombre}. Verifique que sea el lugar correcto.`);
  }

  async function buscar(e: FormEvent) {
    e.preventDefault();
    const q = texto.trim();
    if (!q) return;
    const coords = leerCoordenadas(q);
    if (coords) return irA(coords[0], coords[1], `${coords[0]}, ${coords[1]}`);

    pedido.current?.abort();
    const control = new AbortController();
    pedido.current = control;
    setEstado({ tipo: 'buscando' });
    setAnuncio('Buscando…');
    try {
      const lista = await buscarLugares(q, control.signal);
      if (control.signal.aborted) return;
      if (lista.length === 0) {
        const aviso = 'Sin resultados. Pruebe con menos palabras (p. ej. «Estadio Ibarra») o pegue las coordenadas (lat, lng).';
        setEstado({ tipo: 'aviso', texto: aviso });
        setAnuncio(aviso);
        return;
      }
      setEstado({ tipo: 'resultados', lista });
      setAnuncio(`${lista.length} ${lista.length === 1 ? 'resultado' : 'resultados'}`);
    } catch (err) {
      if (control.signal.aborted || (err as Error)?.name === 'AbortError') return;
      const aviso = 'No se pudo buscar. Revise su conexión o pegue las coordenadas (lat, lng).';
      setEstado({ tipo: 'aviso', texto: aviso });
      setAnuncio(aviso);
    }
  }

  function cerrar() {
    pedido.current?.abort();
    setEstado({ tipo: 'inactivo' });
    campo.current?.focus();
  }

  function alTecla(e: KeyboardEvent) {
    if (e.key === 'Escape' && estado.tipo !== 'inactivo') {
      e.stopPropagation();
      cerrar();
    }
  }

  const abierto = estado.tipo === 'resultados' || estado.tipo === 'aviso';
  return (
    <div className="pp-buscador" onKeyDown={alTecla}>
      <form role="search" aria-label="Buscar lugar" onSubmit={(e) => void buscar(e)}>
        <label className="sr-only" htmlFor={`${idLista}-campo`}>
          Lugar o coordenadas
        </label>
        <input
          id={`${idLista}-campo`}
          ref={campo}
          type="search"
          value={texto}
          maxLength={MAX_LARGO_BUSQUEDA}
          placeholder="Buscar lugar o pegar coordenadas"
          autoComplete="off"
          aria-controls={abierto ? idLista : undefined}
          aria-expanded={abierto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="pp-btn" aria-label="Buscar" title="Buscar" disabled={estado.tipo === 'buscando' || !texto.trim()}>
          <Search size={16} aria-hidden="true" />
        </button>
      </form>
      {abierto && (
        <div id={idLista} className="pp-buscador-resultados">
          <button type="button" className="pp-btn pp-buscador-cerrar" aria-label="Cerrar resultados" onClick={cerrar}>
            <X size={14} aria-hidden="true" />
          </button>
          {estado.tipo === 'aviso' ? (
            <p className="pp-ayuda">{estado.texto}</p>
          ) : (
            <ul>
              {estado.lista.map((l) => (
                <li key={`${l.lat},${l.lng},${l.nombre}`}>
                  <button type="button" onClick={() => irA(l.lat, l.lng, l.nombre)}>
                    <strong>{l.nombre}</strong>
                    {l.detalle && <span>{l.detalle}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {anuncio}
      </p>
    </div>
  );
}
