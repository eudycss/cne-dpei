import type {
  CambiarOperadorRequest,
  CorregirMilitarRequest,
  EntregaCustodio,
  FilaInformeCustodia,
  KitCustodiaResponse,
  MilitarResumen,
  OperadorResumen,
  RegistrarEntregaRequest,
  ResumenCustodia,
} from '@cne/shared-types';
import type { OpcionesActaMilitar } from '@cne/shared-validation';
import { api } from '../api';

export interface FiltrosCustodia {
  cantonId?: number;
  recintoId?: string;
}

function params(f: FiltrosCustodia): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.cantonId) p.cantonId = String(f.cantonId);
  if (f.recintoId) p.recintoId = f.recintoId;
  return p;
}

// Entrega de kits a militares desde el navegador (Asistente Transversal con iPhone):
// los mismos endpoints que usa la app móvil.

/** Kits entregados a militares del evento activo, de cuántos hay que entregar. */
export const getResumenCustodia = () => api.get<ResumenCustodia>('/custodia/resumen').then((r) => r.data);

export const validarKitCustodia = (codigo: string) =>
  api.post<KitCustodiaResponse>('/custodia/validar-kit', { codigo }).then((r) => r.data);

export const registrarEntrega = (body: RegistrarEntregaRequest) =>
  api.post<EntregaCustodio>('/custodia/entregas', body).then((r) => r.data);

export const corregirMilitar = (kitId: string, body: CorregirMilitarRequest) =>
  api.patch<EntregaCustodio>(`/custodia/entregas/${kitId}/militar`, body).then((r) => r.data);

export const cambiarOperador = (kitId: string, body: CambiarOperadorRequest) =>
  api.patch<OperadorResumen>(`/custodia/kits/${kitId}/operador`, body).then((r) => r.data);

export const buscarMilitares = (buscar: string) =>
  api.get<MilitarResumen[]>('/custodia/militares', { params: { buscar } }).then((r) => r.data);

export const buscarOperadores = (buscar: string) =>
  api.get<OperadorResumen[]>('/custodia/operadores', { params: { buscar } }).then((r) => r.data);

export const getInformeCustodia = () => api.get<FilaInformeCustodia[]>('/custodia/informe');

export const descargarActaKit = (kitId: string) =>
  api.get<Blob>(`/custodia/kits/${kitId}/acta`, { responseType: 'blob' });

export const descargarActas = (filtros: FiltrosCustodia) =>
  api.get<Blob>('/custodia/actas', { params: params(filtros), responseType: 'blob' });

/** Formato, responsable (Asistente Transversal) y fecha impresa del acta militar. */
export type { OpcionesActaMilitar };

/** Acta de Constancia y Custodia que firma el militar (PDF o Word, formato oficial). */
export const descargarActaMilitarKit = (kitId: string, opciones: OpcionesActaMilitar = { formato: 'docx' }) =>
  api.get<Blob>(`/custodia/kits/${kitId}/acta-militar`, { params: opciones, responseType: 'blob' });

/** Actas militares de los kits elegidos: un solo PDF (una página por kit) o un .zip con un Word por kit. */
export const descargarActasMilitares = (kitIds: string[], opciones: OpcionesActaMilitar = { formato: 'docx' }) =>
  api.post<Blob>('/custodia/actas-militares/seleccion', { kitIds, ...opciones }, { responseType: 'blob' });

export interface ResponsableActa {
  id: string;
  nombre: string;
}

/** Asistentes Transversales activos que pueden firmar como responsables del acta militar. */
export async function getResponsablesActa(): Promise<ResponsableActa[]> {
  const { data } = await api.get<ResponsableActa[]>('/custodia/responsables-acta');
  return data;
}

/** Guarda un blob como archivo (mismo patrón que la descarga de QR de kits). */
export function guardarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
