import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('./location', () => {
  class LocationPermissionDeniedError extends Error {}
  class LocationServicesDisabledError extends Error {}
  return {
    LocationPermissionDeniedError,
    LocationServicesDisabledError,
    obtenerUbicacionPuntual: jest.fn(),
  };
});

import { useProximidad } from './useProximidad';
import { obtenerUbicacionPuntual, LocationPermissionDeniedError } from './location';

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
