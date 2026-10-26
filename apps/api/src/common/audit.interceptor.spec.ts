import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { AuditInterceptor, datosDeLaPeticion } from './audit.interceptor';

const flush = () => new Promise<void>((r) => setImmediate(r));

function contexto(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

async function auditar(req: Record<string, unknown>, resBody: unknown = {}, create = jest.fn().mockResolvedValue({})) {
  const interceptor = new AuditInterceptor({ bitacoraAuditoria: { create } } as never);
  const handler: CallHandler = { handle: () => of(resBody) };
  const respuesta = await firstValueFrom(
    interceptor.intercept(contexto({ headers: {}, ip: '127.0.0.1', params: {}, ...req }), handler),
  );
  await flush();
  return { create, respuesta, data: create.mock.calls[0]?.[0]?.data };
}

const ADMIN = { sub: '00000000-0000-0000-0000-0000000000ad' };
const OTRO = '11111111-2222-3333-4444-555555555555';

describe('AuditInterceptor', () => {
  it('al desactivar un usuario registra a QUIÉN afecta y QUÉ cambió', async () => {
    const { data } = await auditar({
      method: 'PATCH',
      originalUrl: `/users/${OTRO}`,
      params: { id: OTRO },
      body: { activo: false },
      user: ADMIN,
    });

    expect(data).toMatchObject({
      usuarioId: ADMIN.sub,
      accion: 'USER_UPDATE',
      entidad: 'usuario',
      entidadId: OTRO,
      datosDespues: { campos: ['activo'], activo: false },
    });
  });

  it('de los datos personales solo guarda el nombre del campo, nunca el valor', async () => {
    const { data } = await auditar({
      method: 'PATCH',
      originalUrl: `/users/${OTRO}`,
      params: { id: OTRO },
      body: { email: 'ana@cne.gob.ec', telefono: '0991234567', nombres: 'Ana', activo: true },
      user: ADMIN,
    });

    expect(data.datosDespues).toEqual({ campos: ['email', 'telefono', 'nombres', 'activo'], activo: true });
    expect(JSON.stringify(data)).not.toMatch(/ana@cne|0991234567/);
  });

  it('al cambiar la cédula de un usuario queda que se cambió, pero no el valor', async () => {
    const { data } = await auditar({
      method: 'PATCH',
      originalUrl: `/users/${OTRO}`,
      params: { id: OTRO },
      body: { cedula: '1710034065', nombres: 'Ana' },
      user: ADMIN,
    });

    expect(data).toMatchObject({ usuarioId: ADMIN.sub, accion: 'USER_UPDATE', entidadId: OTRO });
    expect(data.datosDespues).toEqual({ campos: ['cedula', 'nombres'] });
    expect(JSON.stringify(data)).not.toMatch(/1710034065/);
  });

  it('crear un usuario o militar no guarda cédula, email ni teléfono; el id sale de la respuesta', async () => {
    const { data } = await auditar(
      {
        method: 'POST',
        originalUrl: '/users',
        body: { cedula: '1712345675', email: 'a@cne.gob.ec', nombres: 'Ana', apellidos: 'Ruiz', telefono: '099' },
        user: ADMIN,
      },
      { id: OTRO, initialPassword: 'NoDebeGuardarse1!' },
    );

    expect(data.entidadId).toBe(OTRO);
    expect(data.datosDespues).toEqual({ campos: ['cedula', 'email', 'nombres', 'apellidos', 'telefono'] });
    expect(JSON.stringify(data)).not.toMatch(/1712345675|NoDebeGuardarse/);
  });

  it('cerrar un evento usa el id de la ruta y guarda la justificación', async () => {
    const { data } = await auditar({
      method: 'POST',
      originalUrl: `/eventos/${OTRO}/close`,
      params: { id: OTRO },
      body: { confirmar: true, justificacion: 'Ensayo terminado' },
      user: ADMIN,
    });

    expect(data).toMatchObject({
      accion: 'EVENTO_CLOSE',
      entidadId: OTRO,
      datosDespues: { campos: ['confirmar', 'justificacion'], confirmar: true, justificacion: 'Ensayo terminado' },
    });
  });

  it('reabrir un evento guarda el id de la ruta y la justificación', async () => {
    const { data } = await auditar({
      method: 'POST',
      originalUrl: `/eventos/${OTRO}/reopen`,
      params: { id: OTRO },
      body: { justificacion: 'Sacar informe de custodia' },
      user: ADMIN,
    });

    expect(data).toMatchObject({
      accion: 'EVENTO_REOPEN',
      entidad: 'evento',
      entidadId: OTRO,
      datosDespues: { campos: ['justificacion'], justificacion: 'Sacar informe de custodia' },
    });
  });

  it('un cambio de márgenes de alertas queda con sus valores (pasó el 16-oct con 200000 m)', async () => {
    const { data } = await auditar({
      method: 'PATCH',
      originalUrl: `/eventos/${OTRO}/config-alertas`,
      params: { id: OTRO },
      body: { margenLlegadaMetros: 200000, margenLlegadaDpiMetros: 200000 },
      user: ADMIN,
    });

    expect(data.datosDespues).toMatchObject({ margenLlegadaMetros: 200000, margenLlegadaDpiMetros: 200000 });
  });

  it.each([
    ['/auth/change-password', { currentPassword: 'Vieja*2026', newPassword: 'Nueva*2026' }],
    ['/auth/reset-password', { token: 'tok-123', newPassword: 'Nueva*2026' }],
    ['/auth/login', { email: 'a@cne.gob.ec', Password: 'Vieja*2026' }],
  ])('%s no guarda contraseñas, tokens ni sus nombres en mayúsculas', async (ruta, body) => {
    const { data } = await auditar({ method: 'POST', originalUrl: ruta, body, user: ADMIN });

    expect(JSON.stringify(data)).not.toMatch(/Vieja|Nueva|tok-123|a@cne/);
    expect(JSON.stringify(data.datosDespues ?? {})).not.toMatch(/pass|token/i);
  });

  it('claves sensibles con otros nombres (clave, contrasena, pinCode, TOKEN) tampoco aparecen', () => {
    const datos = datosDeLaPeticion(
      { clave: 'x', contrasena: 'y', pinCode: '1234', TOKEN: 'z', activo: true },
      ['clave', 'contrasena', 'pinCode', 'TOKEN', 'activo'],
    );
    expect(datos).toEqual({ campos: ['activo'], activo: true });
  });

  it('nunca guarda objetos anidados, Buffers ni base64 aunque el campo esté permitido', () => {
    const datos = datosDeLaPeticion(
      { recintoId: { $ne: 1 }, justificacion: Buffer.from('foto'), operadorId: [{ token: 'x' }] },
      ['recintoId', 'justificacion', 'operadorId'],
    );
    expect(datos).toEqual({ campos: ['recintoId', 'justificacion', 'operadorId'] });
  });

  it('acota textos largos, nombres de campo raros y bodies que no son objetos', () => {
    expect((datosDeLaPeticion({ justificacion: 'x'.repeat(5000) }, ['justificacion'])!.justificacion as string).length).toBe(500);
    expect(datosDeLaPeticion({ 'cédula 1712345675': 1, ok: 1 })).toEqual({ campos: ['ok'] });
    expect(datosDeLaPeticion([{ cedula: '1712345675' }])).toBeUndefined();
    expect(datosDeLaPeticion(Buffer.from('x'))).toBeUndefined();
    expect(datosDeLaPeticion({})).toBeUndefined();
  });

  it('el id debe ser texto: un id que no es string no se guarda y uno largo se corta a 60', async () => {
    const numerico = await auditar({ method: 'POST', originalUrl: '/militares', body: {}, user: ADMIN }, { id: 42 });
    expect(numerico.data.entidadId).toBeNull();

    const largo = 'a'.repeat(80);
    const conRuta = await auditar({ method: 'PATCH', originalUrl: `/users/${largo}`, params: { id: largo }, body: {}, user: ADMIN });
    expect(conRuta.data.entidadId).toHaveLength(60);
  });

  it('importar operadores CDA: audita solo al aplicar y guarda solo los conteos', async () => {
    const res = { vistaPrevia: false, nuevos: 3, actualizados: 53, filas: [{ cedula: '1710034065', apellidosNombres: 'PÉREZ ANA' }], errores: [] };
    const vista = await auditar({ method: 'POST', originalUrl: '/operadores-cda/importar', query: {}, body: {}, user: ADMIN }, res);
    expect(vista.create).not.toHaveBeenCalled();

    const { data } = await auditar(
      { method: 'POST', originalUrl: '/operadores-cda/importar?aplicar=true', query: { aplicar: 'true' }, body: {}, user: ADMIN },
      res,
    );
    expect(data).toMatchObject({
      accion: 'OPERADORES_CDA_IMPORT',
      entidad: 'operador_cda',
      datosDespues: { grupo: 'OPERADOR', nuevos: 3, actualizados: 53 },
    });
    expect(JSON.stringify(data)).not.toMatch(/1710034065|PÉREZ/);
  });

  it('asistencia CDA: corregir un día pasado guarda qué había, qué quedó y el motivo', async () => {
    const corregir = await auditar(
      {
        method: 'PUT',
        originalUrl: `/operadores-cda/${OTRO}/asistencia/2026-10-21`,
        params: { id: OTRO, fecha: '2026-10-21' },
        body: { entrada: '08:05', salida: null, motivo: '  Se olvidó marcar, lo confirmó el supervisor  ' },
        user: ADMIN,
      },
      {
        fila: { operador: { cedula: '1710034065' }, entradaEn: '2026-10-21T13:05:00.000Z', salidaEn: null },
        antes: { entradaEn: null, salidaEn: null },
      },
    );
    expect(corregir.data).toMatchObject({
      accion: 'ASISTENCIA_CDA_CORREGIR',
      entidad: 'operador_cda',
      entidadId: OTRO,
      datosDespues: {
        fecha: '2026-10-21',
        antes: { entradaEn: null, salidaEn: null },
        despues: { entradaEn: '2026-10-21T13:05:00.000Z', salidaEn: null },
        motivo: 'Se olvidó marcar, lo confirmó el supervisor',
      },
    });
    // Sin datos personales de la persona (la cédula de la respuesta no se guarda).
    expect(JSON.stringify(corregir.data.datosDespues)).not.toContain('1710034065');
  });

  it('asistencia CDA: el marcado masivo guarda tipo y conteos; quitar una marca guarda operador y tipo', async () => {
    const masiva = await auditar(
      { method: 'POST', originalUrl: '/operadores-cda/asistencia/masiva', body: { tipo: 'ENTRADA', operadorIds: [OTRO] }, user: ADMIN },
      { marcados: 40, omitidos: 16 },
    );
    expect(masiva.data).toMatchObject({ accion: 'ASISTENCIA_CDA_MASIVA', datosDespues: { tipo: 'ENTRADA', marcados: 40, omitidos: 16 } });

    const deshacer = await auditar(
      {
        method: 'DELETE',
        originalUrl: `/operadores-cda/${OTRO}/asistencia/SALIDA?marcaEn=2026-10-22T22%3A45%3A00.000Z`,
        params: { id: OTRO, tipo: 'SALIDA' },
        body: {},
        user: ADMIN,
      },
      { deshecho: true, marcaEn: '2026-10-22T22:45:00.000Z', marcadaPorId: ADMIN.sub },
    );
    // La fila ya no tiene la marca: la bitácora guarda qué hora se quitó y quién la había puesto.
    expect(deshacer.data).toMatchObject({
      accion: 'ASISTENCIA_CDA_DESHACER',
      entidad: 'operador_cda',
      entidadId: OTRO,
      datosDespues: { tipo: 'SALIDA', marcaEn: '2026-10-22T22:45:00.000Z', marcadaPorId: ADMIN.sub },
    });

    const exportar = await auditar({
      method: 'GET',
      originalUrl: '/operadores-cda/asistencia/exportar.xlsx?hasta=2026-10-22',
      query: { hasta: '2026-10-22', desde: ['x'] },
      body: {},
      user: ADMIN,
    });
    expect(exportar.data).toMatchObject({
      accion: 'ASISTENCIA_CDA_EXPORTAR',
      datosDespues: { grupo: 'OPERADOR', desde: null, hasta: '2026-10-22', modo: 'GENERAL', formato: 'xlsx' },
    });

    const pdf = await auditar({
      method: 'GET',
      originalUrl: '/operadores-cda/asistencia/atrasos.pdf?desde=2026-10-01&hasta=2026-10-22&modo=POR_DIA&grupo=ASISTENTE',
      query: { desde: '2026-10-01', hasta: '2026-10-22', modo: 'POR_DIA', grupo: 'ASISTENTE' },
      body: {},
      user: ADMIN,
    });
    expect(pdf.data).toMatchObject({
      accion: 'ASISTENCIA_CDA_ATRASOS_EXPORTAR',
      datosDespues: { grupo: 'ASISTENTE', desde: '2026-10-01', hasta: '2026-10-22', modo: 'POR_DIA', formato: 'pdf' },
    });
  });

  it('cambio de cargo: queda de qué cargo a cuál, sin datos personales', async () => {
    const { data } = await auditar(
      {
        method: 'PATCH',
        originalUrl: '/operadores-cda/o1/cargo',
        params: { id: 'o1' },
        body: { grupo: 'OPERADOR' },
        user: ADMIN,
      },
      { grupoAnterior: 'ASISTENTE', operador: { id: 'o1', grupo: 'OPERADOR', apellidosNombres: 'RUIZ MORA JUAN' } },
    );
    expect(data).toMatchObject({
      accion: 'OPERADOR_CDA_CARGO',
      entidad: 'operador_cda',
      entidadId: 'o1',
      datosDespues: { grupoAnterior: 'ASISTENTE', grupoNuevo: 'OPERADOR' },
    });
    expect(JSON.stringify(data)).not.toContain('RUIZ');
  });

  it('hora oficial de entrada: queda a qué grupo se le cambió y los valores guardados', async () => {
    const { data } = await auditar(
      {
        method: 'PUT',
        originalUrl: '/operadores-cda/asistencia/config?grupo=ASISTENTE',
        query: { grupo: 'ASISTENTE' },
        body: { horaEntrada: '09:00', minutosGracia: 15 },
        user: ADMIN,
      },
      { horaEntrada: '09:00', minutosGracia: 15 },
    );
    expect(data).toMatchObject({
      accion: 'ASISTENCIA_CDA_CONFIG',
      entidad: 'config_asistencia_cda',
      datosDespues: { grupo: 'ASISTENTE', horaEntrada: '09:00', minutosGracia: 15 },
    });

    // Los cargos nuevos quedan con su propio grupo, no como OPERADOR.
    const supervisores = await auditar(
      {
        method: 'PUT',
        originalUrl: '/operadores-cda/asistencia/config?grupo=SUPERVISOR',
        query: { grupo: 'SUPERVISOR' },
        body: {},
        user: ADMIN,
      },
      { horaEntrada: '07:30', minutosGracia: 5 },
    );
    expect(supervisores.data).toMatchObject({ datosDespues: { grupo: 'SUPERVISOR' } });

    // Un grupo desconocido no se copia tal cual a la bitácora (la API ya respondió 400).
    const sinGrupo = await auditar(
      { method: 'PUT', originalUrl: '/operadores-cda/asistencia/config', query: { grupo: '<x>' }, body: {}, user: ADMIN },
      { horaEntrada: '08:00', minutosGracia: 10 },
    );
    expect(sinGrupo.data.datosDespues.grupo).toBe('OPERADOR');
  });

  it('carnets QR: guarda a quiénes se emitió y las anulaciones', async () => {
    const emitir = await auditar({
      method: 'POST',
      originalUrl: '/operadores-cda/credenciales/carnets.pdf',
      body: { operadorIds: [OTRO, 42] },
      user: ADMIN,
    });
    expect(emitir.data).toMatchObject({
      accion: 'CREDENCIAL_QR_CDA_EMITIR',
      entidad: 'credencial_qr_cda',
      datosDespues: { cantidad: 1, operadorIds: [OTRO] },
    });

    const revocar = await auditar(
      { method: 'DELETE', originalUrl: `/operadores-cda/${OTRO}/credencial`, params: { id: OTRO }, body: {}, user: ADMIN },
      { revocada: true },
    );
    expect(revocar.data).toMatchObject({ accion: 'CREDENCIAL_QR_CDA_REVOCAR', entidadId: OTRO });
  });

  it('enlace de foto: guarda la vigencia pero nunca el token; la subida pública guarda operador y versión del aviso', async () => {
    const crear = await auditar(
      { method: 'POST', originalUrl: `/operadores-cda/${OTRO}/enlace-foto`, params: { id: OTRO }, body: {}, user: ADMIN },
      { token: 'secreto-que-no-debe-quedar', expiraEn: '2026-10-24T19:00:00.000Z' },
    );
    expect(crear.data).toMatchObject({
      usuarioId: ADMIN.sub,
      accion: 'ENLACE_FOTO_CDA_CREAR',
      entidadId: OTRO,
      datosDespues: { expiraEn: '2026-10-24T19:00:00.000Z' },
    });
    expect(JSON.stringify(crear.data)).not.toContain('secreto-que-no-debe-quedar');

    const subir = await auditar(
      {
        method: 'POST',
        originalUrl: '/publico/foto-cda/subir',
        body: { token: 'secreto-que-no-debe-quedar', consentimiento: 'true', version: 'LOPDP-2026-10' },
        operadorCdaId: OTRO,
      },
      { ok: true },
    );
    expect(subir.data).toMatchObject({
      usuarioId: null,
      accion: 'FOTO_CDA_SUBIR',
      entidad: 'operador_cda',
      entidadId: OTRO,
      datosDespues: { consentimientoVersion: 'LOPDP-2026-10' },
    });
    expect(JSON.stringify(subir.data)).not.toContain('secreto-que-no-debe-quedar');
  });

  it('CRUD de operadores CDA: no guarda nombres, cédulas ni teléfonos; de ocultar sí guarda el valor', async () => {
    const crear = await auditar(
      { method: 'POST', originalUrl: '/operadores-cda', body: { apellidosNombres: 'RUIZ MORA JUAN', cedula: '1710034065', telefono: '0987111222', cargo: 'X' }, user: ADMIN },
      { id: OTRO },
    );
    expect(crear.data).toMatchObject({ accion: 'OPERADOR_CDA_CREATE', entidad: 'operador_cda', entidadId: OTRO });
    expect(JSON.stringify(crear.data)).not.toMatch(/RUIZ|1710034065|0987111222/);

    const editar = await auditar({
      method: 'PATCH', originalUrl: `/operadores-cda/${OTRO}`, params: { id: OTRO }, body: { apellidosNombres: 'RUIZ', cargo: 'X' }, user: ADMIN,
    });
    expect(editar.data).toMatchObject({ accion: 'OPERADOR_CDA_UPDATE', entidadId: OTRO });
    expect(JSON.stringify(editar.data)).not.toContain('RUIZ');

    const ocultar = await auditar({
      method: 'PATCH', originalUrl: `/operadores-cda/${OTRO}/activo`, params: { id: OTRO }, body: { activo: false }, user: ADMIN,
    });
    expect(ocultar.data).toMatchObject({ accion: 'OPERADOR_CDA_ACTIVO', entidadId: OTRO, datosDespues: { activo: false } });
  });

  it('módulos por rol: guarda el rol, los módulos y las acciones que quedaron (los de la respuesta)', async () => {
    const { data } = await auditar(
      {
        method: 'PUT',
        originalUrl: '/permisos-modulos/ASISTENTE_TRANSVERSAL',
        params: { rol: 'ASISTENTE_TRANSVERSAL' },
        body: { modulos: ['operadores-cda', 'alertas'], permisos: ['cda.asistencia.qr'] },
        user: ADMIN,
      },
      { rol: 'ASISTENTE_TRANSVERSAL', modulos: ['operadores-cda'], permisos: ['cda.asistencia.qr'] },
    );
    expect(data).toMatchObject({
      usuarioId: ADMIN.sub,
      accion: 'MODULOS_ROL_UPDATE',
      entidad: 'rol_modulos',
      entidadId: 'ASISTENTE_TRANSVERSAL',
      datosDespues: { modulos: ['operadores-cda'], permisos: ['cda.asistencia.qr'] },
    });
  });

  it('si la bitácora falla, la respuesta sale igual; y las rutas no auditadas no escriben', async () => {
    const falla = jest.fn().mockRejectedValue(new Error('db caída'));
    const { respuesta } = await auditar(
      { method: 'PATCH', originalUrl: `/users/${OTRO}`, params: { id: OTRO }, body: { activo: false }, user: ADMIN },
      { id: OTRO },
      falla,
    );
    expect(respuesta).toEqual({ id: OTRO });

    const { create } = await auditar({ method: 'GET', originalUrl: '/users', body: {}, user: ADMIN });
    expect(create).not.toHaveBeenCalled();
  });
});
