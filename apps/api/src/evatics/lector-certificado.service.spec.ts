import { ENFRIAMIENTO_429_MS, LectorCertificadoService, ordenProveedores } from './lector-certificado.service';
import { LectorNoConfigurado, LectorRespuestaInvalida, LectorTransitorio } from './lector-certificado';
import type { GeminiCertificadoClient } from './gemini-certificado.client';
import type { GroqCertificadoClient } from './groq-certificado.client';

const IMAGEN = Buffer.from('x');
const LECTURA = {
  nombreLeido: 'Ana Pérez',
  esCertificadoEvatics: true,
  legible: true,
};

const lector = (nombre: string) => ({
  nombre,
  disponible: jest.fn(() => true),
  leer: jest.fn(),
});

describe('LectorCertificadoService: respaldo automático entre proveedores', () => {
  const original = process.env.VISION_PROVEEDOR;
  let gemini: ReturnType<typeof lector>;
  let groq: ReturnType<typeof lector>;
  let servicio: LectorCertificadoService;

  beforeEach(() => {
    delete process.env.VISION_PROVEEDOR;
    gemini = lector('Gemini');
    groq = lector('Groq');
    servicio = new LectorCertificadoService(
      gemini as unknown as GeminiCertificadoClient,
      groq as unknown as GroqCertificadoClient,
    );
  });
  afterAll(() => {
    process.env.VISION_PROVEEDOR = original;
  });

  it('VISION_PROVEEDOR solo da el orden: gemini primero por defecto', () => {
    expect(ordenProveedores(undefined)).toEqual(['gemini', 'groq']);
    expect(ordenProveedores('otra-cosa')).toEqual(['gemini', 'groq']);
    expect(ordenProveedores(' GROQ ')).toEqual(['groq', 'gemini']);
  });

  it('responde el primero y dice quién fue', async () => {
    gemini.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).resolves.toEqual({
      lectura: LECTURA,
      proveedor: 'Gemini',
    });
    expect(groq.leer).not.toHaveBeenCalled();
  });

  it('con VISION_PROVEEDOR=groq empieza por Groq', async () => {
    process.env.VISION_PROVEEDOR = 'groq';
    groq.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).resolves.toMatchObject({
      proveedor: 'Groq',
    });
    expect(gemini.leer).not.toHaveBeenCalled();
  });

  it('Gemini da 429 y responde Groq', async () => {
    gemini.leer.mockRejectedValueOnce(new LectorTransitorio('Gemini respondió 429', 429));
    groq.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).resolves.toMatchObject({
      proveedor: 'Groq',
    });
  });

  it('Gemini da JSON inválido y responde Groq', async () => {
    gemini.leer.mockRejectedValueOnce(new LectorRespuestaInvalida('La respuesta de Gemini no es JSON'));
    groq.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).resolves.toMatchObject({
      proveedor: 'Groq',
    });
  });

  it('llave inválida (401) también pasa al siguiente', async () => {
    gemini.leer.mockRejectedValueOnce(new LectorRespuestaInvalida('Gemini respondió 401', 401));
    groq.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).resolves.toMatchObject({
      proveedor: 'Groq',
    });
  });

  it('fallan los dos y alguno por algo pasajero: error pasajero (el certificado queda en cola)', async () => {
    gemini.leer.mockRejectedValueOnce(new LectorTransitorio('Gemini respondió 503', 503));
    groq.leer.mockRejectedValueOnce(new LectorRespuestaInvalida('Groq respondió 400', 400));
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorTransitorio);
  });

  it('fallan los dos sin remedio (llave inválida, formato): error permanente, no se reintenta', async () => {
    gemini.leer.mockRejectedValueOnce(new LectorRespuestaInvalida('Gemini respondió 401', 401));
    groq.leer.mockRejectedValueOnce(new LectorRespuestaInvalida('La respuesta de Groq no es JSON'));
    const e = await servicio.leer(IMAGEN, 'image/jpeg').catch((x) => x);
    expect(e).toBeInstanceOf(LectorRespuestaInvalida);
    expect(e).not.toBeInstanceOf(LectorTransitorio);
  });

  it('solo hay llave de uno: se usa ese; sin ninguna, no disponible', async () => {
    gemini.disponible.mockReturnValue(false);
    groq.leer.mockResolvedValueOnce(LECTURA);
    expect(servicio.disponible()).toBe(true);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).resolves.toMatchObject({
      proveedor: 'Groq',
    });
    expect(gemini.leer).not.toHaveBeenCalled();

    groq.disponible.mockReturnValue(false);
    expect(servicio.disponible()).toBe(false);
    await expect(servicio.leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorNoConfigurado);
  });

  it('enfriamiento: tras un 429, Gemini se salta 5 min y luego vuelve', async () => {
    const t0 = 1_000_000;
    gemini.leer.mockRejectedValueOnce(new LectorTransitorio('Gemini respondió 429', 429));
    groq.leer.mockResolvedValue(LECTURA);
    await servicio.leer(IMAGEN, 'image/jpeg', t0);

    gemini.leer.mockClear();
    await expect(servicio.leer(IMAGEN, 'image/jpeg', t0 + 60_000)).resolves.toMatchObject({ proveedor: 'Groq' });
    expect(gemini.leer).not.toHaveBeenCalled();

    gemini.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg', t0 + ENFRIAMIENTO_429_MS + 1)).resolves.toMatchObject({
      proveedor: 'Gemini',
    });
  });

  it('el enfriamiento respeta retry-after', async () => {
    const t0 = 1_000_000;
    gemini.leer.mockRejectedValueOnce(new LectorTransitorio('Gemini respondió 429', 429, 30_000));
    groq.leer.mockResolvedValue(LECTURA);
    await servicio.leer(IMAGEN, 'image/jpeg', t0);
    gemini.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg', t0 + 31_000)).resolves.toMatchObject({ proveedor: 'Gemini' });
  });

  it('si todos se están enfriando, se prueba igual el primero', async () => {
    const t0 = 1_000_000;
    gemini.leer.mockRejectedValueOnce(new LectorTransitorio('429', 429));
    groq.leer.mockRejectedValueOnce(new LectorTransitorio('429', 429));
    await expect(servicio.leer(IMAGEN, 'image/jpeg', t0)).rejects.toBeInstanceOf(LectorTransitorio);
    gemini.leer.mockResolvedValueOnce(LECTURA);
    await expect(servicio.leer(IMAGEN, 'image/jpeg', t0 + 1000)).resolves.toMatchObject({ proveedor: 'Gemini' });
  });
});
