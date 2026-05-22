export type RoleName = 'ADMINISTRADOR' | 'TECNICO_SUPERVISOR' | 'OPERADOR_CDA';

export interface Role {
  id: string;
  nombre: RoleName;
}

export interface User {
  id: string;
  cedula: string;
  email: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  activo: boolean;
  debeCambiarPwd: boolean;
  roles: RoleName[];
  creadoEn: string;
  actualizadoEn: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    nombres: string;
    apellidos: string;
    debeCambiarPwd: boolean;
    roles: RoleName[];
  };
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface CreateUserRequest {
  cedula: string;
  email: string;
  nombres: string;
  apellidos: string;
  telefono?: string | null;
}

export interface UpdateUserRequest {
  email?: string;
  nombres?: string;
  apellidos?: string;
  telefono?: string | null;
  activo?: boolean;
}

export interface BulkUploadRow {
  fila: number;
  error: string;
  datos?: Record<string, unknown>;
}

export interface BulkUploadResult {
  creados: number;
  errores: BulkUploadRow[];
}

export interface AssignRolesRequest {
  userIds: string[];
  roleIds: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ===================================================================
// FASE 2 — Catálogos y eventos
// ===================================================================

export type TipoRecinto = 'CDA' | 'NO_CDA';

export interface Canton {
  id: number;
  codigo: string;
  nombre: string;
}

export interface Recinto {
  id: string;
  codigoRecinto: string;
  nombre: string;
  direccion: string | null;
  cantonId: number;
  cantonNombre?: string;
  parroquia: string | null;
  zona: string | null;
  tipo: TipoRecinto;
  tieneInternet: boolean;
  coberturaMovil: boolean;
  numeroElectores: number | null;
}

export interface Militar {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
  recintoId: string;
  recintoNombre?: string;
  recintoCodigo?: string;
  creadoEn: string;
}

export interface CreateMilitarRequest {
  cedula: string;
  nombres: string;
  apellidos: string;
  recintoId: string;
}

export interface UpdateMilitarRequest {
  cedula?: string;
  nombres?: string;
  apellidos?: string;
  recintoId?: string;
}

export type TipoEventoElectoral =
  | 'ELECCION_GENERAL'
  | 'SEGUNDA_VUELTA'
  | 'CONSULTA_POPULAR'
  | 'REFERENDUM'
  | 'OTRO';

export type EstadoEvento = 'BORRADOR' | 'ACTIVO' | 'CERRADO';

export interface ConfigAlertas {
  umbralLlegadaRecintoMin: number;
  umbralLlegadaDpiMin: number;
  umbralSinSyncMin: number;
}

export interface EventoElectoral {
  id: string;
  nombre: string;
  tipo: TipoEventoElectoral;
  fechaJornada: string;
  descripcion: string | null;
  estado: EstadoEvento;
  creadoEn: string;
  cerradoEn: string | null;
  configAlertas?: ConfigAlertas;
}

export interface CreateEventoRequest {
  nombre: string;
  tipo: TipoEventoElectoral;
  fechaJornada: string;
  descripcion?: string | null;
}

export interface UpdateEventoRequest {
  nombre?: string;
  tipo?: TipoEventoElectoral;
  fechaJornada?: string;
  descripcion?: string | null;
}

export interface CloseEventoRequest {
  confirmar: boolean;
  justificacion?: string;
}

// ===================================================================
// FASE 2 — Asignaciones operador ↔ supervisor (HU10)
// ===================================================================

export interface Asignacion {
  id: string;
  eventoId: string;
  operadorId: string;
  operadorNombre: string;
  operadorCedula: string;
  supervisorId: string;
  supervisorNombre: string;
  creadoEn: string;
}

export interface UpsertAsignacionRequest {
  eventoId: string;
  operadorId: string;
  supervisorId: string;
}

// ===================================================================
// FASE 3 — Kits electorales (HU11)
// ===================================================================

export type EstadoKit =
  | 'EN_BODEGA'
  | 'ASIGNADO'
  | 'ENTREGADO'
  | 'EN_RECINTO'
  | 'EN_RETORNO'
  | 'RETORNADO';

export interface Kit {
  id: string;
  eventoId: string;
  codigoUnico: string;
  qrPayload: string;
  nombre: string;
  contenidos: string | null;
  recintoId: string | null;
  operadorId: string | null;
  estado: EstadoKit;
  creadoEn: string;
}

export interface CreateKitRequest {
  eventoId: string;
  nombre: string;
  contenidos?: string | null;
}

export interface PdfQrRequest {
  kitIds: string[];
}
