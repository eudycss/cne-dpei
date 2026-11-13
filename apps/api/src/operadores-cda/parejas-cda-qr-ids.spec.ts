import { BadRequestException } from '@nestjs/common';

import { MAX_IDS_PAREJAS_QR, parsearIdsParejas } from './parejas-cda.controller';

const ID1 = '3f2b8c1e-4d5a-4b6c-8d7e-9a0b1c2d3e4f';
const ID2 = '7a1b2c3d-4e5f-4a6b-9c8d-0e1f2a3b4c5d';

describe('parsearIdsParejas (?parejas= del QR de parejas)', () => {
  it('sin el parámetro devuelve undefined (todas las parejas de la lista)', () => {
    expect(parsearIdsParejas(undefined)).toBeUndefined();
  });

  it('un id suelto se envuelve en arreglo y varios pasan tal cual', () => {
    expect(parsearIdsParejas(ID1)).toEqual([ID1]);
    expect(parsearIdsParejas([ID1, ID2])).toEqual([ID1, ID2]);
  });

  it('rechaza ids que no son UUID (incluido el vacío)', () => {
    expect(() => parsearIdsParejas('no-es-uuid')).toThrow(BadRequestException);
    expect(() => parsearIdsParejas('')).toThrow(BadRequestException);
    expect(() => parsearIdsParejas([ID1, "x'; DROP TABLE"])).toThrow(BadRequestException);
  });

  it('rechaza más ids del máximo (largo de URL)', () => {
    const muchos = Array.from({ length: MAX_IDS_PAREJAS_QR + 1 }, () => ID1);
    expect(() => parsearIdsParejas(muchos)).toThrow(BadRequestException);
    expect(parsearIdsParejas(muchos.slice(1))).toHaveLength(MAX_IDS_PAREJAS_QR);
  });
});
