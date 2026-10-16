import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('./location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  class UbicacionNoDisponibleError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    UbicacionNoDisponibleError,
    obtenerUbicacionPuntual: jest.fn(),
  };
});

import { useProximidad } from './useProximidad';
import { obtenerUbicacionPuntual, LocationPermissionDeniedError, UbicacionNoDisponibleError } from './location';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

// No hay librería de testing de hooks instalada en el proyecto (ver comentario
// en los tests de pantallas); se monta un componente mínimo que expone el
// resultado del hook en una variable del módulo, actualizada en cada render.
let ultimoResultado: ReturnType<typeof useProximidad> | null = null;
function Harness({
  destino,
  margenMetros,
}: {
  destino: { latitud: number; longitud: number } | null;
  margenMetros: number;
}) {
  ultimoResultado = useProximidad(destino, margenMetros);
  return <Text>harness</Text>;
}

describe('useProximidad', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ultimoResultado = null;
  });

  it('marca dentro=true cuando la distancia está dentro del margen', async () => {
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });

    await act(async () => {
      create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={100} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });

    expect(ultimoResultado!.info?.dentro).toBe(true);
    expect(ultimoResultado!.error).toBeNull();
  });

  it('marca dentro=false cuando la distancia supera el margen', async () => {
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.40, longitud: -78.20, precisionMetros: 5 });

    await act(async () => {
      create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={100} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });

    expect(ultimoResultado!.info?.dentro).toBe(false);
  });

  it('expone un mensaje de error legible cuando falta el permiso de GPS', async () => {
    (obtenerUbicacionPuntual as jest.Mock).mockRejectedValue(new LocationPermissionDeniedError());

    await act(async () => {
      create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={100} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });

    expect(ultimoResultado!.info).toBeNull();
    expect(ultimoResultado!.error).toMatch(/permiso de ubicación/i);
  });

  it('recalcula "dentro" al cambiar el margen, sin volver a leer el GPS', async () => {
    // ~600 m al norte del destino.
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.3446, longitud: -78.12, precisionMetros: 5 });
    const destino = { latitud: -0.35, longitud: -78.12 };

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness destino={destino} margenMetros={150} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });
    expect(ultimoResultado!.info?.dentro).toBe(false);

    await act(async () => {
      renderer.update(<Harness destino={destino} margenMetros={700} />);
    });

    expect(ultimoResultado!.info?.dentro).toBe(true);
    expect(ultimoResultado!.info?.margenM).toBe(705);
    expect(obtenerUbicacionPuntual).toHaveBeenCalledTimes(1);
  });

  it('avisa que el GPS no respondió cuando la lectura vence sin posición', async () => {
    (obtenerUbicacionPuntual as jest.Mock).mockRejectedValue(new UbicacionNoDisponibleError());

    await act(async () => {
      create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={100} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });

    expect(ultimoResultado!.verificando).toBe(false);
    expect(ultimoResultado!.error).toMatch(/GPS no respondió/);
  });

  it('descarta una lectura vieja si el destino cambió mientras se medía', async () => {
    let resolverVieja!: (v: unknown) => void;
    (obtenerUbicacionPuntual as jest.Mock)
      .mockImplementationOnce(() => new Promise((r) => { resolverVieja = r; }))
      .mockResolvedValueOnce({ latitud: 0.3575, longitud: -78.5109, precisionMetros: 5 });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={150} />);
    });
    let vieja!: Promise<void>;
    act(() => {
      vieja = ultimoResultado!.verificar();
    });

    await act(async () => {
      renderer.update(<Harness destino={{ latitud: 0.3575, longitud: -78.5109 }} margenMetros={150} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });
    await act(async () => {
      // Llega tarde, medida contra las coordenadas anteriores (lejos del destino nuevo).
      resolverVieja({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });
      await vieja;
    });

    expect(ultimoResultado!.info?.dentro).toBe(true);
  });

  it('si el destino se pierde con una lectura en curso, la descarta y no queda en "Verificando…"', async () => {
    let resolver!: (v: unknown) => void;
    (obtenerUbicacionPuntual as jest.Mock).mockImplementationOnce(() => new Promise((r) => { resolver = r; }));

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={150} />);
    });
    let enCurso!: Promise<void>;
    act(() => {
      enCurso = ultimoResultado!.verificar();
    });
    expect(ultimoResultado!.verificando).toBe(true);

    await act(async () => {
      renderer.update(<Harness destino={null} margenMetros={150} />);
    });
    await act(async () => {
      resolver({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });
      await enCurso;
    });

    expect(ultimoResultado!.verificando).toBe(false);
    expect(ultimoResultado!.info).toBeNull();
  });

  it('pide la ubicación con respaldo de última posición conocida (gate informativo)', async () => {
    (obtenerUbicacionPuntual as jest.Mock).mockResolvedValue({ latitud: -0.35, longitud: -78.12, precisionMetros: 5 });
    await act(async () => {
      create(<Harness destino={{ latitud: -0.35, longitud: -78.12 }} margenMetros={100} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
    });
    expect(obtenerUbicacionPuntual).toHaveBeenCalledWith({ permitirUltimaConocida: true });
  });

  it('no llama al GPS si no hay destino', async () => {
    await act(async () => {
      create(<Harness destino={null} margenMetros={100} />);
    });
    await act(async () => {
      await ultimoResultado!.verificar();
      await flushPromises();
    });

    expect(obtenerUbicacionPuntual).not.toHaveBeenCalled();
  });
});
