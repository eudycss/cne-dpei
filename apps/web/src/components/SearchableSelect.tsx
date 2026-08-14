import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface Props {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  required?: boolean;
}

const MAX_RESULTS = 12;

/**
 * Selector con apariencia de <select> nativo que, al hacer clic, se convierte
 * en un input de búsqueda con dropdown filtrado. Reutiliza el mismo mecanismo
 * de filtrado + onMouseDown (para no perder foco antes del click) que ya usa
 * el selector de recinto en MilitaresPage.tsx.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  required,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.sublabel ? o.sublabel.toLowerCase().includes(q) : false),
        )
      : options;
    return base.slice(0, MAX_RESULTS);
  }, [options, search]);

  // El filtrado puede reducir la lista por debajo del índice resaltado previo.
  const activeIndex = filtered.length === 0 ? -1 : Math.min(highlightedIndex, filtered.length - 1);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function openEditing() {
    setSearch('');
    setHighlightedIndex(0);
    setEditing(true);
  }

  function selectOption(o: SearchableSelectOption) {
    onChange(o.value);
    setSearch('');
    setEditing(false);
  }

  function closeEditing() {
    setSearch('');
    setEditing(false);
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    setHighlightedIndex(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Evita que Enter dispare el submit del <form> contenedor cuando el
      // usuario está navegando el dropdown con teclado.
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) selectOption(opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeEditing();
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEditing}
        aria-haspopup="listbox"
        aria-expanded={false}
        aria-required={required}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.5rem 0.65rem',
          border: '1px solid var(--border-input)',
          borderRadius: 6,
          fontSize: '0.9rem',
          background: 'var(--bg-card)',
          color: selected ? 'var(--text)' : 'var(--text-muted)',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} style={{ flexShrink: 0, color: 'var(--icon)' }} />
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-required={required}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        value={search}
        onChange={(e) => handleSearchChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={closeEditing}
        placeholder={searchPlaceholder ?? placeholder}
        autoComplete="off"
        style={{
          width: '100%',
          padding: '0.5rem 0.65rem',
          border: '1px solid var(--border-input)',
          borderRadius: 6,
          fontSize: '0.9rem',
          background: 'var(--bg-card)',
          color: 'var(--text)',
        }}
      />
      {filtered.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 2,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            maxHeight: 220,
            overflowY: 'auto',
            zIndex: 20,
            boxShadow: 'var(--shadow-dropdown)',
          }}
        >
          {filtered.map((o, i) => (
            <div
              key={o.value}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => selectOption(o)}
              onMouseEnter={() => setHighlightedIndex(i)}
              style={{
                padding: '0.45rem 0.7rem',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: '0.85rem',
                color: 'var(--text)',
                background: i === activeIndex ? 'var(--notif-item-hover)' : undefined,
              }}
            >
              {o.label}
              {o.sublabel && <span className="muted"> · {o.sublabel}</span>}
            </div>
          ))}
        </div>
      )}
      {filtered.length === 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 2,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '0.5rem 0.7rem',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            zIndex: 20,
            boxShadow: 'var(--shadow-dropdown)',
          }}
        >
          Sin resultados
        </div>
      )}
    </div>
  );
}
