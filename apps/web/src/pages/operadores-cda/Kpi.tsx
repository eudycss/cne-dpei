/** Indicador del resumen: valor, barra de avance y detalle. */
export function Kpi({
  etiqueta,
  valor,
  parte,
  total,
  detalle,
}: {
  etiqueta: string;
  valor: string;
  parte: number;
  total: number;
  detalle: string;
}) {
  const pct = total > 0 ? Math.round((parte / total) * 100) : 0;
  return (
    <div className="ocda-kpi">
      <span className="ocda-kpi-etiqueta">{etiqueta}</span>
      <span className="ocda-kpi-valor">{valor}</span>
      <span className="ocda-kpi-barra" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="ocda-kpi-detalle">{detalle}</span>
    </div>
  );
}
