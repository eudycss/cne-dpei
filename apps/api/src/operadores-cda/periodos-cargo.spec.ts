import { enTramos, tramosEnCargo, type CambioCargo } from './periodos-cargo';

const cambio = (grupoAnterior: CambioCargo['grupoAnterior'], grupoNuevo: CambioCargo['grupoNuevo'], desde: string): CambioCargo => ({
  grupoAnterior,
  grupoNuevo,
  desde,
});

describe('periodos-cargo', () => {
  it('sin cambios: todo su tiempo es del cargo actual', () => {
    expect(tramosEnCargo('OPERADOR', [], 'OPERADOR')).toEqual([{ desde: null, hasta: null }]);
    expect(tramosEnCargo('OPERADOR', [], 'ASISTENTE')).toEqual([]);
  });

  it('un cambio: el cargo anterior hasta el día antes y el nuevo desde ese día', () => {
    const cambios = [cambio('ASISTENTE', 'OPERADOR', '2026-10-21')];
    expect(tramosEnCargo('OPERADOR', cambios, 'ASISTENTE')).toEqual([{ desde: null, hasta: '2026-10-20' }]);
    expect(tramosEnCargo('OPERADOR', cambios, 'OPERADOR')).toEqual([{ desde: '2026-10-21', hasta: null }]);
    expect(tramosEnCargo('OPERADOR', cambios, 'SUPERVISOR')).toEqual([]);
  });

  it('el día anterior cruza fin de mes', () => {
    expect(tramosEnCargo('OPERADOR', [cambio('ASISTENTE', 'OPERADOR', '2026-11-01')], 'ASISTENTE')).toEqual([
      { desde: null, hasta: '2026-10-31' },
    ]);
  });

  it('ida y vuelta: dos tramos en el cargo original', () => {
    const cambios = [cambio('ASISTENTE', 'OPERADOR', '2026-10-10'), cambio('OPERADOR', 'ASISTENTE', '2026-10-20')];
    const asistente = tramosEnCargo('ASISTENTE', cambios, 'ASISTENTE');
    expect(asistente).toEqual([
      { desde: null, hasta: '2026-10-09' },
      { desde: '2026-10-20', hasta: null },
    ]);
    expect(enTramos(asistente, '2026-10-09')).toBe(true);
    expect(enTramos(asistente, '2026-10-15')).toBe(false);
    expect(enTramos(asistente, '2026-10-20')).toBe(true);
    expect(tramosEnCargo('ASISTENTE', cambios, 'OPERADOR')).toEqual([{ desde: '2026-10-10', hasta: '2026-10-19' }]);
  });

  it('dos cambios el mismo día: el cargo intermedio no se queda con ningún día', () => {
    const cambios = [cambio('ASISTENTE', 'DIGITADOR', '2026-10-21'), cambio('DIGITADOR', 'OPERADOR', '2026-10-21')];
    expect(tramosEnCargo('OPERADOR', cambios, 'DIGITADOR')).toEqual([]);
    expect(tramosEnCargo('OPERADOR', cambios, 'OPERADOR')).toEqual([{ desde: '2026-10-21', hasta: null }]);
    expect(tramosEnCargo('OPERADOR', cambios, 'ASISTENTE')).toEqual([{ desde: null, hasta: '2026-10-20' }]);
  });
});
