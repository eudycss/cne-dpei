const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DIEZ_A_VEINTINUEVE = [
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function menorQueCien(n: number): string {
  if (n < 10) return UNIDADES[n];
  if (n < 30) return DIEZ_A_VEINTINUEVE[n - 10];
  const unidad = n % 10;
  const decena = DECENAS[Math.floor(n / 10)];
  return unidad === 0 ? decena : `${decena} y ${UNIDADES[unidad]}`;
}

/**
 * Número de 0 a 999 en letras, como se escribe en el acta: "Sesenta y dos",
 * "Cero", "Ciento uno", "Cien". Primera letra en mayúscula.
 */
export function numeroEnLetras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new RangeError(`Fuera de rango: ${n}`);
  const centena = Math.floor(n / 100);
  const resto = n % 100;
  let texto: string;
  if (centena === 0) texto = menorQueCien(resto);
  else if (n === 100) texto = 'cien';
  else texto = resto === 0 ? CENTENAS[centena] : `${CENTENAS[centena]} ${menorQueCien(resto)}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Los tres casilleros del acta: 62 → "062". */
export const enCasilleros = (n: number) => String(n).padStart(3, '0');
