/**
 * Lógica pura del mapa de monitoreo: detecta operadores que dejaron de enviar
 * ubicación y separa los marcadores que caen casi en el mismo punto (p. ej. dos
 * operadores en el mismo recinto), que de otro modo se dibujan uno encima del otro.
 */

/** Minutos sin posiciones nuevas a partir de los cuales el operador se marca "sin señal". */
export const UMBRAL_SIN_SENAL_MIN = 10;

/** Distancia (m) bajo la cual dos operadores se consideran en el mismo punto. */
export const DISTANCIA_SUPERPUESTOS_M = 50;

/** Radio (px) del círculo en el que se reparten los marcadores superpuestos. */
export const RADIO_SEPARACION_PX = 14;

export function minutosDesde(iso: string, ahoraMs: number): number {
  return Math.max(0, Math.floor((ahoraMs - new Date(iso).getTime()) / 60_000));
}

/** Una fecha ilegible cuenta como sin señal: es preferible alertar de más que ocultar un corte. */
export function estaSinSenal(capturadoEn: string, ahoraMs: number): boolean {
  const minutos = minutosDesde(capturadoEn, ahoraMs);
  return Number.isNaN(minutos) || minutos >= UMBRAL_SIN_SENAL_MIN;
}

/** "27 min", "1 h 05 min" */
export function formatearDuracion(minutos: number): string {
  if (Number.isNaN(minutos)) return 'un tiempo desconocido';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Distancia aproximada en metros (equirectangular; suficiente para decenas de metros). */
export function distanciaMetros(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
  const y = (b[0] - a[0]) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

interface ConPosicion {
  operadorId: string;
  latitud: number;
  longitud: number;
}

/**
 * Devuelve el desplazamiento en píxeles [x, y] de cada marcador. Los que no
 * comparten punto con nadie quedan en [0, 0]; los de un grupo se reparten en
 * un círculo alrededor de su posición real, en orden estable por operadorId
 * para que no salten entre refrescos.
 */
export function desplazamientosMarcadores(
  operadores: ConPosicion[],
): Map<string, [number, number]> {
  const ordenados = [...operadores].sort((a, b) => a.operadorId.localeCompare(b.operadorId));
  const grupos: ConPosicion[][] = [];
  for (const op of ordenados) {
    const grupo = grupos.find((g) =>
      distanciaMetros([g[0].latitud, g[0].longitud], [op.latitud, op.longitud]) <=
      DISTANCIA_SUPERPUESTOS_M,
    );
    if (grupo) grupo.push(op);
    else grupos.push([op]);
  }

  const resultado = new Map<string, [number, number]>();
  for (const grupo of grupos) {
    grupo.forEach((op, i) => {
      if (grupo.length === 1) {
        resultado.set(op.operadorId, [0, 0]);
        return;
      }
      const angulo = (2 * Math.PI * i) / grupo.length - Math.PI / 2;
      resultado.set(op.operadorId, [
        Math.round(Math.cos(angulo) * RADIO_SEPARACION_PX),
        Math.round(Math.sin(angulo) * RADIO_SEPARACION_PX),
      ]);
    });
  }
  return resultado;
}
