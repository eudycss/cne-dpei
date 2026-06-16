interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export function SearchInput({ value, onChange, placeholder, style }: Props) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ position: 'absolute', left: '0.6rem', pointerEvents: 'none', flexShrink: 0, stroke: 'var(--icon)' }}
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '0.5rem 0.5rem 0.5rem 2rem',
          border: '1px solid var(--border-input)',
          borderRadius: 6,
          fontSize: '0.9rem',
          background: 'var(--bg-card)',
          color: 'var(--text)',
        }}
      />
    </div>
  );
}
