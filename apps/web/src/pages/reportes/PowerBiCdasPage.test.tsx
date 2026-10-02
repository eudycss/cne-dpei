import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PowerBiCdasPage, resolverUrlPowerBi } from './PowerBiCdasPage';

describe('resolverUrlPowerBi', () => {
  it('usa el reporte por defecto cuando la variable no está definida', () => {
    expect(resolverUrlPowerBi(undefined)).toContain(
      'reportId=06565169-ca93-4da8-8949-b31c13064b2c',
    );
  });

  it.each(['', '   '])('usa el reporte por defecto cuando la variable es "%s"', (valor) => {
    expect(resolverUrlPowerBi(valor)).toContain('reportId=06565169');
  });

  it('acepta una URL https de app.powerbi.com', () => {
    const url = 'https://app.powerbi.com/reportEmbed?reportId=abc&autoAuth=true';
    expect(resolverUrlPowerBi(url)).toBe(url);
  });

  it.each([
    'http://app.powerbi.com/reportEmbed?reportId=abc',
    'https://evil.example.com/reportEmbed',
    'https://app.powerbi.com.evil.example.com/x',
    'https://user:pw@app.powerbi.com/reportEmbed',
    'https://app.powerbi.com:444/reportEmbed',
    'javascript:alert(1)',
    'no es una url',
  ])('rechaza %s', (valor) => {
    expect(resolverUrlPowerBi(valor)).toBeNull();
  });
});

describe('PowerBiCdasPage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('incrusta el reporte con un título accesible y enlace de respaldo', () => {
    vi.stubEnv('VITE_POWERBI_CDAS_URL', '');
    render(<PowerBiCdasPage />);

    const iframe = screen.getByTitle('Reporte Power BI: Proyecto CDAS');
    expect(iframe.getAttribute('src')).toMatch(/^https:\/\/app\.powerbi\.com\/reportEmbed/);

    const enlace = screen.getByRole('link', { name: /abrir el reporte en power bi/i });
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('muestra un error y no incrusta nada si la URL configurada no es de Power BI', () => {
    vi.stubEnv('VITE_POWERBI_CDAS_URL', 'https://evil.example.com/');
    render(<PowerBiCdasPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('VITE_POWERBI_CDAS_URL');
    expect(screen.queryByTitle('Reporte Power BI: Proyecto CDAS')).toBeNull();
  });
});
