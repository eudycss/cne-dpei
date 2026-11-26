import { useQuery } from '@tanstack/react-query';
import type { Paginated, Recinto } from '@cne/shared-types';
import { api } from '../../lib/api';

// ─── Ficha expandible por CDA ────────────────────────────────────────────────

const SECTION_CDA     = { bg: 'rgba(59,130,246,0.08)',  border: '#3b82f6', label: 'Unidad Educativa CDA' };
const SECTION_NOCDA   = { bg: 'rgba(34,197,94,0.08)',   border: '#22c55e', label: 'Unidades Educativas NO CDA' };
const SECTION_CONTING = { bg: 'rgba(245,158,11,0.08)',  border: '#f59e0b', label: 'En caso de problema con el kit, dirigirse a' };

const sectionStyle = (s: typeof SECTION_CDA): React.CSSProperties => ({
  borderLeft: `4px solid ${s.border}`,
  background: s.bg,
  borderRadius: '0 4px 4px 0',
  padding: '0.6rem 0.75rem',
  marginTop: '0.6rem',
});

function jt(r: Recinto) {
  return r.juntasFemeninas != null || r.juntasMasculinas != null
    ? (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0)
    : null;
}

export function FichaSubtable({
  cda,
  onEdit,
  resaltarIds,
}: {
  cda: Recinto;
  onEdit?: (r: Recinto) => void;
  /** NO-CDAs que coinciden con la búsqueda. */
  resaltarIds?: string[];
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['recintos-origenes', cda.id],
    queryFn: async () => {
      const res = await api.get<Paginated<Recinto>>(`/recintos?cdaDestinoId=${cda.id}&pageSize=100`);
      return res.data.items;
    },
  });

  const cdaJt = jt(cda);
  const noCdaTotalJt = data?.reduce((acc, nc) => acc + (jt(nc) ?? 0), 0) ?? 0;
  const totalGeneral = (cdaJt ?? 0) + noCdaTotalJt;

  const thStyle: React.CSSProperties = { fontWeight: 600, fontSize: '0.78rem', padding: '0.3rem 0.5rem', textAlign: 'left' };
  const tdStyle: React.CSSProperties = { fontSize: '0.82rem', padding: '0.25rem 0.5rem' };

  return (
    <div style={{ paddingTop: '0.25rem' }}>

      {/* — Sección CDA — */}
      <div style={sectionStyle(SECTION_CDA)}>
        <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.8rem', color: '#3b82f6' }}>{SECTION_CDA.label}</p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <table style={{ flex: 1 }}>
            <thead><tr>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Nombre</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JF</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JM</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JT</th>
            </tr></thead>
            <tbody><tr>
              <td style={tdStyle}>{cda.codigoRecinto}</td>
              <td style={tdStyle}>{cda.nombre}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{cda.juntasFemeninas ?? '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{cda.juntasMasculinas ?? '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{cdaJt != null ? <strong>{cdaJt}</strong> : '—'}</td>
            </tr></tbody>
          </table>
          <div style={{ textAlign: 'center', border: '2px solid #3b82f6', borderRadius: 6, padding: '0.3rem 0.9rem', minWidth: 80 }}>
            <div style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 600 }}>Nro Juntas Total</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#3b82f6', lineHeight: 1.1 }}>{totalGeneral}</div>
          </div>
        </div>
      </div>

      {/* — Sección NO-CDAs — */}
      <div style={sectionStyle(SECTION_NOCDA)}>
        <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.8rem', color: '#16a34a' }}>{SECTION_NOCDA.label}</p>
        {isLoading ? (
          <p className="muted" style={{ fontSize: '0.82rem' }}>Cargando…</p>
        ) : !data || data.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.82rem' }}>Sin No CDAs asignados.</p>
        ) : (
          <table style={{ width: '100%' }}>
            <thead><tr>
              <th style={thStyle}>Cantón</th>
              <th style={thStyle}>Parroquia</th>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Nombre</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JF</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JM</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JT</th>
              {onEdit && <th style={{ width: 28 }}></th>}
            </tr></thead>
            <tbody>
              {data.map((nc) => {
                const ncJt = jt(nc);
                const coincide = resaltarIds?.includes(nc.id) ?? false;
                return (
                  <tr key={nc.id} style={coincide ? { background: 'rgba(34,197,94,0.22)' } : undefined}>
                    <td style={tdStyle}>{nc.cantonNombre ?? '—'}</td>
                    <td style={tdStyle}>{nc.parroquia ?? '—'}</td>
                    <td style={tdStyle}>{nc.codigoRecinto}</td>
                    <td style={tdStyle}>
                      {nc.nombre}
                      {coincide && (
                        <span className="badge" style={{ marginLeft: '0.4rem', fontSize: '0.7rem' }}>Coincide</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{nc.juntasFemeninas ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{nc.juntasMasculinas ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{ncJt != null ? <strong>{ncJt}</strong> : '—'}</td>
                    {onEdit && (
                      <td style={{ padding: '0.15rem 0.25rem' }}>
                        <button
                          onClick={() => onEdit(nc)}
                          title="Editar juntas"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#16a34a', padding: '0.1rem 0.2rem' }}
                        >✏</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* — Sección Contingencia — */}
      <div style={sectionStyle(SECTION_CONTING)}>
        <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.8rem', color: '#d97706' }}>{SECTION_CONTING.label}</p>
        {cda.contingenciaNombre ? (
          <>
            <p style={{ fontSize: '0.85rem', margin: 0, fontWeight: 600 }}>{cda.contingenciaNombre}</p>
            {cda.contingenciaDireccion && (
              <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>{cda.contingenciaDireccion}</p>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>Sin unidad de contingencia configurada.</p>
        )}
      </div>

    </div>
  );
}
