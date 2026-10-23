import type {
  ActaCdaFila,
  ActaEntregaCda,
  AsistenciaCdaDia,
  ConfigAsistenciaCda,
  CrearOperadorCdaRequest,
  EditarOperadorCdaRequest,
  GenerarActasCdaRequest,
  GenerarActasCdaResult,
  PersonaEntregaCda,
  EnlaceFotoCdaCreado,
  EnlaceFotoCdaPublico,
  AsistenciaCdaFila,
  ImportOperadoresCdaResult,
  MarcarAsistenciaCdaMasivaResult,
  OperadorCda,
  ReporteAtrasosCda,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';
import { VERSION_AVISO_FOTO_CDA } from '@cne/shared-validation';
import { api } from '../api';

/** `incluirInactivos`: también los ocultos (la API solo lo respeta al administrador). */
export async function getOperadoresCda(incluirInactivos = false): Promise<OperadorCda[]> {
  const { data } = await api.get<OperadorCda[]>(`/operadores-cda${incluirInactivos ? '?incluirInactivos=true' : ''}`);
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

/** false = ocultar (baja lógica); true = reactivar. */
export async function cambiarActivoOperadorCda(id: string, activo: boolean): Promise<OperadorCda> {
  const { data } = await api.patch<OperadorCda>(`/operadores-cda/${id}/activo`, { activo });
  return data;
}

/** Sin `aplicar` solo devuelve la vista previa; con `aplicar` guarda. */
export async function importarOperadoresCda(file: File, aplicar: boolean): Promise<ImportOperadoresCdaResult> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<ImportOperadoresCdaResult>(
    `/operadores-cda/importar${aplicar ? '?aplicar=true' : ''}`,
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function getAsistenciaCda(fecha: string): Promise<AsistenciaCdaDia> {
  const { data } = await api.get<AsistenciaCdaDia>(`/operadores-cda/asistencia?fecha=${encodeURIComponent(fecha)}`);
  return data;
}

export async function marcarAsistenciaCda(operadorId: string, tipo: TipoMarcaAsistenciaCda): Promise<AsistenciaCdaFila> {
  const { data } = await api.post<AsistenciaCdaFila>(`/operadores-cda/${operadorId}/asistencia`, { tipo });
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

/** Descarga el Excel de asistencia desde el primer día hasta `hasta`. */
export async function descargarAsistenciaCda(hasta: string): Promise<void> {
  const res = await api.get(`/operadores-cda/asistencia/exportar.xlsx?hasta=${encodeURIComponent(hasta)}`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asistencia_operadores_cda_${hasta}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
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

export async function getActasCda(): Promise<ActaCdaFila[]> {
  const { data } = await api.get<ActaCdaFila[]>('/operadores-cda/actas');
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
  guardar(res.data, nombreDeDescarga(res.headers['content-disposition'], 'actas-entrega-operadores-cda.zip'));
}

// Reporte de atrasos: hora oficial de entrada + minutos de gracia.

export async function getConfigAsistenciaCda(): Promise<ConfigAsistenciaCda> {
  const { data } = await api.get<ConfigAsistenciaCda>('/operadores-cda/asistencia/config');
  return data;
}

export async function guardarConfigAsistenciaCda(body: ConfigAsistenciaCda): Promise<ConfigAsistenciaCda> {
  const { data } = await api.put<ConfigAsistenciaCda>('/operadores-cda/asistencia/config', body);
  return data;
}

const rango = (desde: string, hasta: string) =>
  `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`;

export async function getAtrasosCda(desde: string, hasta: string): Promise<ReporteAtrasosCda> {
  const { data } = await api.get<ReporteAtrasosCda>(`/operadores-cda/asistencia/atrasos?${rango(desde, hasta)}`);
  return data;
}

export async function descargarAtrasosCda(desde: string, hasta: string): Promise<void> {
  const res = await api.get<Blob>(`/operadores-cda/asistencia/atrasos.xlsx?${rango(desde, hasta)}`, {
    responseType: 'blob',
  });
  guardar(res.data, `atrasos_operadores_cda_${desde}_${hasta}.xlsx`);
}
