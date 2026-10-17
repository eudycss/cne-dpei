import { Logger } from '@nestjs/common';
import { asistenteHabilitado, AsistenteNoDisponible, LlmClient, proveedoresConfigurados } from './llm.client';

const respuestaConConsulta = (name: string, args: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: args } }] } }] }),
});

describe('proveedoresConfigurados / asistenteHabilitado', () => {
  it('Groq primero y Gemini de respaldo, solo los que tienen llave', () => {
    expect(proveedoresConfigurados({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm' }).map((p) => p.nombre)).toEqual(['Groq', 'Gemini']);
    expect(proveedoresConfigurados({ GEMINI_API_KEY: 'm' }).map((p) => p.nombre)).toEqual(['Gemini']);
    expect(proveedoresConfigurados({ GROQ_API_KEY: '  ' })).toEqual([]);
  });

  it('el modelo se puede cambiar por variable', () => {
    expect(proveedoresConfigurados({ GROQ_API_KEY: 'g', GROQ_MODEL: 'llama-3.3-70b-versatile' })[0].modelo).toBe(
      'llama-3.3-70b-versatile',
    );
  });

  it('solo está habilitado con ASISTENTE_ENABLED=true y al menos una llave', () => {
    expect(asistenteHabilitado({ ASISTENTE_ENABLED: 'true', GROQ_API_KEY: 'g' })).toBe(true);
    expect(asistenteHabilitado({ ASISTENTE_ENABLED: 'true' })).toBe(false);
    expect(asistenteHabilitado({ GROQ_API_KEY: 'g' })).toBe(false);
    expect(asistenteHabilitado({ ASISTENTE_ENABLED: 'false', GROQ_API_KEY: 'g' })).toBe(false);
  });
});

describe('LlmClient', () => {
  const originalFetch = global.fetch;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_secreta';
    process.env.GEMINI_API_KEY = 'gem_secreta';
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    warn.mockRestore();
  });

  it('manda solo las instrucciones y la pregunta, con las herramientas, a Groq', async () => {
    global.fetch = jest.fn().mockResolvedValue(respuestaConConsulta('buscar_recinto', '{"texto":"colegio Ibarra"}'));

    const llamada = await new LlmClient().elegirConsulta('número del encargado del colegio Ibarra');

    expect(llamada).toEqual({ nombre: 'buscar_recinto', argumentos: { texto: 'colegio Ibarra' } });
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer gsk_secreta');
    const body = JSON.parse(opts.body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'número del encargado del colegio Ibarra' });
    expect(body.tools.map((t: any) => t.function.name)).toEqual(['buscar_recinto', 'recintos_caidos', 'recintos_de_tecnico', 'tecnicos_de_canton', 'recintos_de_canton']);
    expect(body.temperature).toBe(0);
  });

  it('si Groq falla (429), usa Gemini', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(respuestaConConsulta('recintos_caidos', '{}'));

    const llamada = await new LlmClient().elegirConsulta('qué está caído');

    expect(llamada).toEqual({ nombre: 'recintos_caidos', argumentos: {} });
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('generativelanguage.googleapis.com');
    expect((global.fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe('Bearer gem_secreta');
  });

  it('si Groq no responde a tiempo, usa Gemini', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    global.fetch = jest.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce(respuestaConConsulta('recintos_caidos', ''));

    await expect(new LlmClient().elegirConsulta('caídos')).resolves.toEqual({ nombre: 'recintos_caidos', argumentos: {} });
    expect(warn).toHaveBeenCalledWith('Groq no respondió (sin respuesta en 8 s)');
  });

  it('argumentos que no son JSON cuentan como fallo y pasan al siguiente proveedor', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respuestaConConsulta('buscar_recinto', '{texto:'))
      .mockResolvedValueOnce(respuestaConConsulta('buscar_recinto', '{"texto":"1008"}'));

    await expect(new LlmClient().elegirConsulta('1008')).resolves.toEqual({
      nombre: 'buscar_recinto',
      argumentos: { texto: '1008' },
    });
  });

  it('si el modelo contesta con texto (sin consulta), devuelve null y no prueba otro proveedor', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'La capital de Ecuador es Quito.' } }] }),
    });

    await expect(new LlmClient().elegirConsulta('capital de Ecuador')).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('si fallan todos, lanza AsistenteNoDisponible; los logs no llevan la pregunta ni las llaves', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(new LlmClient().elegirConsulta('teléfono de Juan Pérez')).rejects.toBeInstanceOf(AsistenteNoDisponible);

    const logs = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logs).toContain('Groq no respondió (HTTP 500)');
    expect(logs).toContain('Gemini no respondió (HTTP 500)');
    expect(logs).not.toMatch(/Juan|secreta/);
  });

  it('sin llaves, lanza AsistenteNoDisponible sin llamar a nadie', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    global.fetch = jest.fn();

    await expect(new LlmClient().elegirConsulta('caídos')).rejects.toBeInstanceOf(AsistenteNoDisponible);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
