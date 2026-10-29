import { describe, it, expect } from 'vitest';
import type { GrupoCda } from '@cne/shared-types';
import { GRUPOS_CDA } from '@cne/shared-validation';

import { nombreReporteCda } from './operadores-cda';

describe('nombreReporteCda', () => {
  const o = { desde: '2026-10-01', hasta: '2026-10-31', modo: 'GENERAL', formato: 'xlsx' } as const;

  it('los cargos CDA llevan _cda y los CPE _cpe, igual que la API', () => {
    expect(nombreReporteCda('asistencia', o)).toBe('asistencia_operadores_cda_2026-10-01_2026-10-31.xlsx');
    expect(nombreReporteCda('asistencia', { ...o, grupo: 'DIGITADOR' })).toBe(
      'asistencia_digitadores_cpe_2026-10-01_2026-10-31.xlsx',
    );
    expect(nombreReporteCda('atrasos', { ...o, grupo: 'ARCHIVADOR_ACTAS' })).toBe(
      'atrasos_archivadores_actas_cpe_2026-10-01_2026-10-31.xlsx',
    );
  });

  it('cada cargo tiene el mismo nombre de archivo que TEXTOS_GRUPO[].archivo en la API', () => {
    const esperado: Record<GrupoCda, string> = {
      OPERADOR: 'operadores_cda',
      ASISTENTE: 'asistentes_cda',
      DIGITADOR: 'digitadores_cpe',
      ASISTENTE_ARCHIVOS: 'asistentes_archivos_cpe',
      ASISTENTE_FIRMAS: 'asistentes_firmas_cpe',
      RECEPTOR_ACTAS: 'receptores_actas_cpe',
      ARCHIVADOR_ACTAS: 'archivadores_actas_cpe',
      SUPERVISOR: 'supervisores_cpe',
      OPERADOR_ESCANER_CPE: 'operadores_escaner_cpe',
    };
    for (const grupo of GRUPOS_CDA) {
      expect(nombreReporteCda('asistencia', { ...o, grupo })).toBe(`asistencia_${esperado[grupo]}_2026-10-01_2026-10-31.xlsx`);
    }
  });
});
