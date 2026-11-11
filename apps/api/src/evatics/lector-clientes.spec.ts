import { GeminiCertificadoClient, MODELO_GEMINI_POR_DEFECTO } from './gemini-certificado.client';
import { GroqCertificadoClient, MODELO_GROQ_POR_DEFECTO } from './groq-certificado.client';
import {
  INSTRUCCIONES_LECTOR,
  LectorNoConfigurado,
  LectorRespuestaInvalida,
  LectorTransitorio,
} from './lector-certificado';

const IMAGEN = Buffer.from('jpeg-de-prueba');
const LECTURA = {
  nombreLeido: 'Ana María Pérez López',
  esCertificadoEvatics: true,
  legible: true,
};

const respuesta = (status: number, cuerpo: unknown, headers: Record<string, string> = {}) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    json: async () => cuerpo,
  }) as unknown as Response;

/** Cuerpo de éxito de cada proveedor con `texto` como contenido del modelo. */
const CASOS = [
  {
    nombre: 'Gemini',
    variable: 'GEMINI_API_KEY',
    crear: () => new GeminiCertificadoClient(),
    exito: (texto: string) => ({
      candidates: [{ content: { parts: [{ text: texto }] } }],
    }),
  },
  {
    nombre: 'Groq',
    variable: 'GROQ_API_KEY',
    crear: () => new GroqCertificadoClient(),
    exito: (texto: string) => ({ choices: [{ message: { content: texto } }] }),
  },
] as const;

describe.each(CASOS)('cliente $nombre del certificado', ({ variable, crear, exito }) => {
  const fetchMock = jest.fn();
  const original = { ...process.env };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env = { ...original, [variable]: 'llave-de-prueba' };
    delete process.env.GEMINI_MODEL_EVATICS;
    delete process.env.GROQ_MODELO;
  });
  afterAll(() => {
    process.env = original;
  });

  it('éxito: devuelve la lectura validada', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(200, exito(JSON.stringify(LECTURA))));
    await expect(crear().leer(IMAGEN, 'image/jpeg')).resolves.toEqual(LECTURA);
  });

  it('limpia el nombre: solo letras, sin etiquetas ni código', async () => {
    const raro = {
      ...LECTURA,
      nombreLeido: '<script>Ana</script> Pérez {{x}}',
    };
    fetchMock.mockResolvedValueOnce(respuesta(200, exito(JSON.stringify(raro))));
    const r = await crear().leer(IMAGEN, 'image/jpeg');
    expect(r.nombreLeido).toBe('script Ana script Pérez x');
  });

  it('429: error pasajero con la espera que pide retry-after', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(429, {}, { 'retry-after': '30' }));
    const e = await crear()
      .leer(IMAGEN, 'image/jpeg')
      .catch((x) => x);
    expect(e).toBeInstanceOf(LectorTransitorio);
    expect(e).toMatchObject({ status: 429, retryAfterMs: 30_000 });
  });

  it('5xx y error de red: pasajeros', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(503, {}));
    await expect(crear().leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorTransitorio);
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(crear().leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorTransitorio);
  });

  it('401 o 400: no se arregla reintentando', async () => {
    fetchMock.mockResolvedValueOnce(respuesta(401, {}));
    await expect(crear().leer(IMAGEN, 'image/jpeg')).rejects.toMatchObject({
      status: 401,
    });
    fetchMock.mockResolvedValueOnce(respuesta(400, {}));
    await expect(crear().leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorRespuestaInvalida);
  });

  it.each([
    ['texto que no es JSON', 'Claro, la persona es Ana'],
    ['JSON sin las claves pedidas', JSON.stringify({ aprobado: true })],
    ['tipos equivocados', JSON.stringify({ ...LECTURA, legible: 'sí' })],
  ])('respuesta inválida: %s', async (_caso, texto) => {
    fetchMock.mockResolvedValueOnce(respuesta(200, exito(texto)));
    await expect(crear().leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorRespuestaInvalida);
  });

  it('sin llave: no llama al proveedor', async () => {
    delete process.env[variable];
    const c = crear();
    expect(c.disponible()).toBe(false);
    await expect(c.leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(LectorNoConfigurado);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('peticiones a cada proveedor', () => {
  const fetchMock = jest.fn();
  const original = { ...process.env };
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env = {
      ...original,
      GEMINI_API_KEY: 'g-llave',
      GROQ_API_KEY: 'q-llave',
    };
  });
  afterAll(() => {
    process.env = original;
  });

  it('Gemini: llave en cabecera (no en la URL), imagen en línea, esquema JSON y las instrucciones anti-inyección', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta(200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify(LECTURA) }] } }],
      }),
    );
    await new GeminiCertificadoClient().leer(IMAGEN, 'image/jpeg');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI_POR_DEFECTO}:generateContent`,
    );
    expect(url).not.toContain('g-llave');
    expect(init.headers['x-goog-api-key']).toBe('g-llave');
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.systemInstruction.parts[0].text).toBe(INSTRUCCIONES_LECTOR);
    expect(cuerpo.contents[0].parts[0].inlineData).toEqual({
      mimeType: 'image/jpeg',
      data: IMAGEN.toString('base64'),
    });
    expect(cuerpo.generationConfig.responseMimeType).toBe('application/json');
    expect(init.signal).toBeDefined();
  });

  it('Groq: Bearer, una imagen como data URL, modo JSON y modelo por defecto', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta(200, {
        choices: [{ message: { content: JSON.stringify(LECTURA) } }],
      }),
    );
    await new GroqCertificadoClient().leer(IMAGEN, 'image/jpeg');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer q-llave');
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.model).toBe(MODELO_GROQ_POR_DEFECTO);
    expect(cuerpo.response_format).toEqual({ type: 'json_object' });
    expect(cuerpo.messages[0]).toEqual({
      role: 'system',
      content: INSTRUCCIONES_LECTOR,
    });
    const imagenes = cuerpo.messages[1].content.filter((p: { type: string }) => p.type === 'image_url');
    expect(imagenes).toEqual([
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${IMAGEN.toString('base64')}`,
        },
      },
    ]);
  });

  it('un nombre de modelo raro en la configuración no se manda', async () => {
    process.env.GROQ_MODELO = 'x?key=1&y';
    await expect(new GroqCertificadoClient().leer(IMAGEN, 'image/jpeg')).rejects.toBeInstanceOf(
      LectorRespuestaInvalida,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
