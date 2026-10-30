import type {
  ActaCdaFila,
  AplicarParejasCdaResult,
  CrearParejaCdaRequest,
  DisponiblesParejasCda,
  EditarParejaCdaRequest,
  ImportParejasCdaResult,
  ParejasCdaDia,
  ActaEntregaCda,
  AsistenciaCdaDia,
  CambiarCargoOperadorCdaResult,
  ConfigAsistenciaCda,
  CorregirAsistenciaCdaRequest,
  CorregirAsistenciaCdaResult,
  ConsultaQrCda,
  CredencialQrCdaVigente,
  CrearOperadorCdaRequest,
  EditarOperadorCdaRequest,
  PersonaCdaEncontrada,
  GenerarActasCdaRequest,
  GenerarActasCdaResult,
  PersonaEntregaCda,
  EnlaceFotoCdaCreado,
  EnlaceFotoCdaPublico,
  AsistenciaCdaFila,
  CargoCda,
  CrearCargoCdaRequest,
  FormatoReporteCda,
  GrupoCda,
  ModoReporteCda,
  ImportOperadoresCdaResult,
  MarcarAsistenciaCdaMasivaResult,
  OperadorCda,
  ReporteAtrasosCda,
  ResultadoSincronizarCuentasCda,
  ResumenCuentasCda,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';
import { VERSION_AVISO_FOTO_CDA } from '@cne/shared-validation';
import { api } from '../api';

/** `incluirInactivos`: también los ocultos (la API solo lo respeta al administrador). */
export async function getOperadoresCda(incluirInactivos = false, grupo: GrupoCda = 'OPERADOR'): Promise<OperadorCda[]> {
  const { data } = await api.get<OperadorCda[]>(
    `/operadores-cda?grupo=${grupo}${incluirInactivos ? '&incluirInactivos=true' : ''}`,
  );
  return data;
}

/** Busca por nombre o cédula en todos los cargos (`q` de 3 caracteres o más). */
export async function buscarPersonasCda(q: string, incluirInactivos = false): Promise<PersonaCdaEncontrada[]> {
  const { data } = await api.get<PersonaCdaEncontrada[]>(
    `/operadores-cda/buscar?q=${encodeURIComponent(q)}${incluirInactivos ? '&incluirInactivos=true' : ''}`,
  );
  return data;
}

export async function crearOperadorCda(body: CrearOperadorCdaRequest): Promise<OperadorCda> {
  const { data } = await api.post<OperadorCda>('/operadores-cda', body);
  return data;
}

export async function editarOperadorCda(id: string, body: EditarOperadorCdaRequest): Promise<OperadorCda> {
  const { data } = await api.patch<OperadorCda>(`/operadores-cda/${id}`, body);
  return data;
}

/** Pasa a la persona a otro cargo CDA desde hoy (solo administrador). */
export async function cambiarCargoOperadorCda(id: string, grupo: GrupoCda): Promise<CambiarCargoOperadorCdaResult> {
  const { data } = await api.patch<CambiarCargoOperadorCdaResult>(`/operadores-cda/${id}/cargo`, { grupo });
  return data;
}

/** false = ocultar (baja lógica); true = reactivar. */
export async function cambiarActivoOperadorCda(id: string, activo: boolean): Promise<OperadorCda> {
  const { data } = await api.patch<OperadorCda>(`/operadores-cda/${id}/activo`, { activo });
  return data;
}

/** Sin `aplicar` solo devuelve la vista previa; con `aplicar` guarda. */
export async function importarOperadoresCda(
  file: File,
  aplicar: boolean,
  grupo: GrupoCda = 'OPERADOR',
): Promise<ImportOperadoresCdaResult> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<ImportOperadoresCdaResult>(
    `/operadores-cda/importar?grupo=${grupo}${aplicar ? '&aplicar=true' : ''}`,
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function getAsistenciaCda(fecha: string, grupo: GrupoCda = 'OPERADOR'): Promise<AsistenciaCdaDia> {
  const { data } = await api.get<AsistenciaCdaDia>(
    `/operadores-cda/asistencia?fecha=${encodeURIComponent(fecha)}&grupo=${grupo}`,
  );
  return data;
}

export async function marcarAsistenciaCda(operadorId: string, tipo: TipoMarcaAsistenciaCda): Promise<AsistenciaCdaFila> {
  const { data } = await api.post<AsistenciaCdaFila>(`/operadores-cda/${operadorId}/asistencia`, { tipo });
  return data;
}

/** Corrige un día pasado (AAAA-MM-DD): horas "HH:MM" de Ecuador o null, con motivo. */
export async function corregirAsistenciaCda(
  operadorId: string,
  fecha: string,
  body: CorregirAsistenciaCdaRequest,
): Promise<CorregirAsistenciaCdaResult> {
  const { data } = await api.put<CorregirAsistenciaCdaResult>(`/operadores-cda/${operadorId}/asistencia/${fecha}`, body);
  return data;
}

/** `marcaEn`: la marca que se vio; si otro técnico la cambió, la API no la quita (409). */
export async function quitarAsistenciaCda(
  operadorId: string,
  tipo: TipoMarcaAsistenciaCda,
  marcaEn: string,
): Promise<void> {
  await api.delete(`/operadores-cda/${operadorId}/asistencia/${tipo}?marcaEn=${encodeURIComponent(marcaEn)}`);
}

export async function marcarAsistenciaCdaMasiva(
  tipo: TipoMarcaAsistenciaCda,
  operadorIds: string[],
): Promise<MarcarAsistenciaCdaMasivaResult> {
  const { data } = await api.post<MarcarAsistenciaCdaMasivaResult>('/operadores-cda/asistencia/masiva', {
    tipo,
    operadorIds,
  });
  return data;
}

/** Genera el enlace de foto (anula el anterior). El token solo llega esta vez. */
export async function crearEnlaceFotoCda(operadorId: string): Promise<EnlaceFotoCdaCreado> {
  const { data } = await api.post<EnlaceFotoCdaCreado>(`/operadores-cda/${operadorId}/enlace-foto`);
  return data;
}

/** Foto descifrada del operador como blob (la API no la deja en caché). */
export async function getFotoOperadorCda(operadorId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/operadores-cda/${operadorId}/foto`, { responseType: 'blob' });
  return data;
}

// Carnet QR: escanear (consultar y luego confirmar la marca) y, solo el administrador, emitir o anular.

export async function consultarQrCda(token: string): Promise<ConsultaQrCda> {
  const { data } = await api.post<ConsultaQrCda>('/operadores-cda/asistencia/qr/consultar', { token });
  return data;
}

export async function marcarQrCda(token: string, tipo: TipoMarcaAsistenciaCda): Promise<AsistenciaCdaFila> {
  const { data } = await api.post<AsistenciaCdaFila>('/operadores-cda/asistencia/qr', { token, tipo });
  return data;
}

export async function getCredencialesVigentesCda(): Promise<CredencialQrCdaVigente[]> {
  const { data } = await api.get<CredencialQrCdaVigente[]>('/operadores-cda/credenciales');
  return data;
}

/** Emite carnets nuevos (anula los anteriores) y trae el PDF para imprimir. */
export function pedirCarnetsCda(operadorIds: string[]) {
  return api.post<Blob>('/operadores-cda/credenciales/carnets.pdf', { operadorIds }, { responseType: 'blob' });
}

/** Reimprime los carnets vigentes con el mismo código: no anula nada. */
export function reimprimirCarnetsCda(operadorIds: string[]) {
  return api.post<Blob>('/operadores-cda/credenciales/reimprimir.pdf', { operadorIds }, { responseType: 'blob' });
}

export async function anularCredencialCda(operadorId: string): Promise<void> {
  await api.delete(`/operadores-cda/${operadorId}/credencial`);
}

/** URL que se envía al operador. El token va en el fragmento (#): no llega a ningún servidor ni log. */
export function urlEnlaceFotoCda(token: string, origen = window.location.origin): string {
  return `${origen}/foto-cda#${token}`;
}

// Página pública (sin sesión). El token va en el cuerpo, nunca en la URL de la API.

export async function consultarEnlaceFotoCda(token: string): Promise<EnlaceFotoCdaPublico> {
  const { data } = await api.post<EnlaceFotoCdaPublico>('/publico/foto-cda/consultar', { token });
  return data;
}

export async function subirFotoCda(token: string, foto: Blob): Promise<void> {
  const fd = new FormData();
  fd.append('token', token);
  fd.append('consentimiento', 'true');
  fd.append('version', VERSION_AVISO_FOTO_CDA);
  fd.append('foto', foto, 'foto.jpg');
  await api.post('/publico/foto-cda/subir', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
}

// Actas de entrega de indumentaria y credencial.

export async function getActasCda(grupo: GrupoCda = 'OPERADOR'): Promise<ActaCdaFila[]> {
  const { data } = await api.get<ActaCdaFila[]>(`/operadores-cda/actas?grupo=${grupo}`);
  return data;
}

export async function getPersonasEntregaCda(): Promise<PersonaEntregaCda[]> {
  const { data } = await api.get<PersonaEntregaCda[]>('/operadores-cda/actas/entregan');
  return data;
}

export async function generarActasCda(body: GenerarActasCdaRequest): Promise<GenerarActasCdaResult> {
  const { data } = await api.post<GenerarActasCdaResult>('/operadores-cda/actas', body);
  return data;
}

export async function firmarActaCda(operadorId: string): Promise<ActaEntregaCda> {
  const { data } = await api.post<ActaEntregaCda>(`/operadores-cda/${operadorId}/acta/firmar`);
  return data;
}

export async function reabrirActaCda(operadorId: string): Promise<ActaEntregaCda> {
  const { data } = await api.post<ActaEntregaCda>(`/operadores-cda/${operadorId}/acta/reabrir`);
  return data;
}

/** Nombre del archivo que manda la API (Content-Disposition) o el de respaldo. */
export function nombreDeDescarga(cabecera: unknown, respaldo: string): string {
  const m = typeof cabecera === 'string' ? /filename="([^"]+)"/.exec(cabecera) : null;
  return m?.[1] ?? respaldo;
}

function guardar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el mismo instante hace fallar la descarga en algunos navegadores (Safari).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function descargarActaCda(operadorId: string, formato: 'docx' | 'pdf'): Promise<void> {
  const res = await api.get<Blob>(`/operadores-cda/${operadorId}/acta.${formato}`, { responseType: 'blob' });
  guardar(res.data, nombreDeDescarga(res.headers['content-disposition'], `acta-entrega.${formato}`));
}

/** ZIP con el Word y el PDF de los operadores elegidos que ya tienen acta. */
export async function descargarActasCdaZip(operadorIds: string[]): Promise<void> {
  const res = await api.post<Blob>('/operadores-cda/actas/zip', { operadorIds }, { responseType: 'blob' });
  guardar(res.data, nombreDeDescarga(res.headers['content-disposition'], 'actas-entrega-cda.zip'));
}

// Reporte de atrasos: hora oficial de entrada + minutos de gracia.

/** Cada grupo tiene su propia hora de entrada y gracia. */
export async function getConfigAsistenciaCda(grupo: GrupoCda = 'OPERADOR'): Promise<ConfigAsistenciaCda> {
  const { data } = await api.get<ConfigAsistenciaCda>(`/operadores-cda/asistencia/config?grupo=${grupo}`);
  return data;
}

export async function guardarConfigAsistenciaCda(
  body: ConfigAsistenciaCda,
  grupo: GrupoCda = 'OPERADOR',
): Promise<ConfigAsistenciaCda> {
  const { data } = await api.put<ConfigAsistenciaCda>(`/operadores-cda/asistencia/config?grupo=${grupo}`, body);
  return data;
}

const rango = (desde: string, hasta: string) =>
  `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;

export async function getAtrasosCda(desde: string, hasta: string, grupo: GrupoCda = 'OPERADOR'): Promise<ReporteAtrasosCda> {
  const { data } = await api.get<ReporteAtrasosCda>(
    `/operadores-cda/asistencia/atrasos?${rango(desde, hasta)}&grupo=${grupo}`,
  );
  return data;
}

// Reportes de asistencia y de atrasos en Excel o PDF: todo junto o una hoja/sección por día.

export type ReporteCda = 'asistencia' | 'atrasos';

export interface OpcionesReporteCda {
  desde: string;
  hasta: string;
  modo: ModoReporteCda;
  formato: FormatoReporteCda;
  /** Por defecto OPERADOR: un archivo por grupo. */
  grupo?: GrupoCda;
}

/** Igual que TEXTOS_GRUPO[].archivo en la API (los cargos nuevos: la clave en minúsculas). */
const ARCHIVO_GRUPO: Record<string, string> = {
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

const RUTA_REPORTE: Record<ReporteCda, string> = { asistencia: 'exportar', atrasos: 'atrasos' };

/** Mismo nombre que pone la API (respaldo si no llega Content-Disposition). */
export function nombreReporteCda(reporte: ReporteCda, o: OpcionesReporteCda): string {
  const grupo = o.grupo ?? 'OPERADOR';
  const archivo = ARCHIVO_GRUPO[grupo] ?? grupo.toLowerCase();
  return `${reporte}_${archivo}_${o.desde}_${o.hasta}${o.modo === 'POR_DIA' ? '_por_dia' : ''}.${o.formato}`;
}

export function pedirReporteCda(reporte: ReporteCda, o: OpcionesReporteCda) {
  return api.get<Blob>(
    `/operadores-cda/asistencia/${RUTA_REPORTE[reporte]}.${o.formato}?${rango(o.desde, o.hasta)}&modo=${o.modo}&grupo=${o.grupo ?? 'OPERADOR'}`,
    { responseType: 'blob' },
  );
}

export async function getResumenCuentasCda(): Promise<ResumenCuentasCda> {
  const { data } = await api.get<ResumenCuentasCda>('/operadores-cda/cuentas/resumen');
  return data;
}

/** Crea o vincula la cuenta de la app de cada operador/asistente activo que aún no tiene. */
export async function sincronizarCuentasCda(): Promise<ResultadoSincronizarCuentasCda> {
  const { data } = await api.post<ResultadoSincronizarCuentasCda>('/operadores-cda/cuentas/sincronizar');
  return data;
}

/** Desactiva las cuentas Operador CDA que no corresponden a nadie del listado. */
export async function desactivarCuentasSinVinculo(): Promise<{ desactivadas: number }> {
  const { data } = await api.post<{ desactivadas: number }>('/operadores-cda/cuentas/desactivar-sin-vinculo');
  return data;
}

// --- Parejas Operador CDA + Asistente CDA por día ---

export async function getParejasCda(fecha: string): Promise<ParejasCdaDia> {
  const { data } = await api.get<ParejasCdaDia>(`/parejas-cda?fecha=${fecha}`);
  return data;
}

export async function getFechasParejasCda(): Promise<string[]> {
  const { data } = await api.get<string[]>('/parejas-cda/fechas');
  return data;
}

/** `todos`: también quienes ya fueron otro día y los recintos ya usados. */
export async function getDisponiblesParejasCda(fecha: string, todos: boolean): Promise<DisponiblesParejasCda> {
  const { data } = await api.get<DisponiblesParejasCda>(`/parejas-cda/disponibles?fecha=${fecha}${todos ? '&todos=true' : ''}`);
  return data;
}

export async function crearParejaCda(body: CrearParejaCdaRequest): Promise<AplicarParejasCdaResult> {
  const { data } = await api.post<AplicarParejasCdaResult>('/parejas-cda', body);
  return data;
}

export async function editarParejaCda(id: string, body: EditarParejaCdaRequest): Promise<AplicarParejasCdaResult> {
  const { data } = await api.patch<AplicarParejasCdaResult>(`/parejas-cda/${id}`, body);
  return data;
}

/** `justificacion`: obligatoria si la jornada ya inició y la pareja tenía el kit. */
export async function quitarParejaCda(id: string, justificacion?: string): Promise<void> {
  if (justificacion) await api.delete(`/parejas-cda/${id}`, { data: { justificacion } });
  else await api.delete(`/parejas-cda/${id}`);
}

export async function aplicarParejasCda(fecha: string, justificacion?: string): Promise<AplicarParejasCdaResult> {
  const { data } = await api.post<AplicarParejasCdaResult>(`/parejas-cda/aplicar?fecha=${fecha}`, justificacion ? { justificacion } : {});
  return data;
}

/**
 * Sin `guardar` solo devuelve la vista previa. `app: false` guarda sin pasar
 * a la app (listas históricas de un evento que no debe tocarse).
 */
export async function importarParejasCda(
  file: File,
  fecha: string,
  guardar: boolean,
  opciones: { app?: boolean; justificacion?: string } = {},
): Promise<ImportParejasCdaResult> {
  const fd = new FormData();
  fd.append('file', file);
  const extra =
    (opciones.app === false ? '&app=false' : '') +
    (opciones.justificacion ? `&justificacion=${encodeURIComponent(opciones.justificacion)}` : '');
  const { data } = await api.post<ImportParejasCdaResult>(
    `/parejas-cda/importar?fecha=${fecha}${guardar ? '&guardar=true' : ''}${extra}`,
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function descargarPlantillaParejasCda(): Promise<void> {
  const res = await api.get<Blob>('/parejas-cda/plantilla.xlsx', { responseType: 'blob' });
  guardar(res.data, nombreDeDescarga(res.headers['content-disposition'], 'plantilla_parejas_cda.xlsx'));
}

export async function descargarQrParejasCda(fecha: string): Promise<void> {
  const res = await api.get<Blob>(`/parejas-cda/qr?fecha=${fecha}`, { responseType: 'blob' });
  guardar(res.data, nombreDeDescarga(res.headers['content-disposition'], `kits-qr-parejas_${fecha}.pdf`));
}

// Gestión de cargos (combo "Cargo"): todos ven la lista; crear, renombrar y desactivar, solo el administrador.

export async function getCargosCda(): Promise<CargoCda[]> {
  const { data } = await api.get<CargoCda[]>('/cargos-cda');
  return data;
}

export async function crearCargoCda(body: CrearCargoCdaRequest): Promise<CargoCda> {
  const { data } = await api.post<CargoCda>('/cargos-cda', body);
  return data;
}

export async function renombrarCargoCda(clave: GrupoCda, nombre: string): Promise<CargoCda> {
  const { data } = await api.patch<CargoCda>(`/cargos-cda/${encodeURIComponent(clave)}`, { nombre });
  return data;
}

export async function cambiarActivoCargoCda(clave: GrupoCda, activo: boolean): Promise<CargoCda> {
  const { data } = await api.patch<CargoCda>(`/cargos-cda/${encodeURIComponent(clave)}/activo`, { activo });
  return data;
}
