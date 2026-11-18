import { useQuery } from '@tanstack/react-query';
import type { CargoCda, CentroCda, ResumenSexoCargoCda } from '@cne/shared-types';
import { getResumenSexoCda } from '../../lib/queries/operadores-cda';
import { textoSexo, type ConteoSexo } from './sexo';

/** Suma el conteo de cada cargo en su centro (CDA o CPE), en el orden de la lista de cargos. */
export function sumarPorCentro(resumen: ResumenSexoCargoCda[], cargos: CargoCda[]): [CentroCda, ConteoSexo][] {
  const centroDe = new Map(cargos.map((c) => [c.clave, c.centro]));
  const porCentro = new Map<CentroCda, ConteoSexo>();
  for (const r of resumen) {
    const centro = centroDe.get(r.grupo);
    if (!centro) continue;
    const c = porCentro.get(centro) ?? { hombres: 0, mujeres: 0, sinRegistrar: 0 };
    c.hombres += r.hombres;
    c.mujeres += r.mujeres;
    c.sinRegistrar += r.sinRegistrar;
    porCentro.set(centro, c);
  }
  return [...porCentro.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** "CDA: 54 hombres · 71 mujeres — CPE: 20 hombres · 28 mujeres" (solo personal activo). */
export function ResumenSexo({ cargos }: { cargos: CargoCda[] }) {
  // Bajo la clave 'operadores-cda': se refresca solo al agregar, editar o importar personal.
  const { data } = useQuery({ queryKey: ['operadores-cda', 'resumen-sexo'], queryFn: getResumenSexoCda, staleTime: 60_000 });
  if (!Array.isArray(data)) return null;
  const centros = sumarPorCentro(data, cargos);
  if (centros.length === 0) return null;
  return (
    <p className="muted ocda-resumen-sexo" style={{ margin: '0 0 0.5rem' }}>
      <span className="sr-only">Personal activo por sexo. </span>
      {centros.map(([centro, c], i) => (
        <span key={centro}>
          {i > 0 && ' — '}
          <strong>{centro}:</strong> {textoSexo(c)}
        </span>
      ))}
    </p>
  );
}
