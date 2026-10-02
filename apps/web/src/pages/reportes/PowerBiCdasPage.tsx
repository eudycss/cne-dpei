const URL_POR_DEFECTO =
  'https://app.powerbi.com/reportEmbed?reportId=06565169-ca93-4da8-8949-b31c13064b2c&autoAuth=true&ctid=3ed2c252-ec20-4422-b9a0-e37df87a1448';

/**
 * Solo se permite incrustar reportes servidos por Power BI por https: si la
 * variable de entorno queda mal configurada, no se carga un sitio arbitrario
 * dentro de la app.
 */
export function resolverUrlPowerBi(valor: string | undefined): string | null {
  const candidata = valor?.trim() || URL_POR_DEFECTO;
  try {
    const url = new URL(candidata);
    const esPowerBi = url.origin === 'https://app.powerbi.com' && !url.username && !url.password;
    return esPowerBi ? url.toString() : null;
  } catch {
    return null;
  }
}

export function PowerBiCdasPage() {
  const src = resolverUrlPowerBi(import.meta.env.VITE_POWERBI_CDAS_URL);

  return (
    <div className="card">
      <h2>Proyecto CDAS (Power BI)</h2>
      <p>
        Para ver el reporte debe iniciar sesión con su cuenta institucional de Microsoft que tenga
        acceso al informe en Power BI.
      </p>
      {src ? (
        <>
          {/* Sin sandbox a propósito: el login de Microsoft (autoAuth) necesita popups y cookies propias. */}
          <iframe
            title="Reporte Power BI: Proyecto CDAS"
            src={src}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{
              width: '100%',
              aspectRatio: '16 / 9',
              minHeight: '400px',
              border: 0,
              borderRadius: '0.75rem',
            }}
          />
          <p>
            <a href={src} target="_blank" rel="noopener noreferrer">
              Abrir el reporte en Power BI (nueva pestaña)
            </a>
          </p>
        </>
      ) : (
        <p role="alert" style={{ color: 'var(--error)' }}>
          La URL del reporte de Power BI no es válida. Revise la variable VITE_POWERBI_CDAS_URL.
        </p>
      )}
    </div>
  );
}
