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
  latitud: number;
  longitud: number;
  tieneInternet: boolean;
  coberturaMovil: boolean;
  numeroElectores: number | null;
  juntasFemeninas: number | null;
  juntasMasculinas: number | null;
  noCdasCount?: number;
}

export interface CreateRecintoRequest {
  codigoRecinto: string;
  nombre: string;
  direccion?: string | null;
  cantonId: number;
  parroquia?: string | null;
  zona?: string | null;
  tipo: TipoRecinto;
  latitud: number;
  longitud: number;
  tieneInternet?: boolean;
  coberturaMovil?: boolean;
  numeroElectores?: number | null;
  juntasFemeninas?: number | null;
  juntasMasculinas?: number | null;
}

export interface UpdateRecintoRequest {
  codigoRecinto?: string;
  nombre?: string;
  direccion?: string | null;
  cantonId?: number;
  parroquia?: string | null;
  zona?: string | null;
  tipo?: TipoRecinto;
  latitud?: number;
  longitud?: number;
  tieneInternet?: boolean;
  coberturaMovil?: boolean;
  numeroElectores?: number | null;
  juntasFemeninas?: number | null;
  juntasMasculinas?: number | null;
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
  | 'ELECCIONES_SECCIONALES'
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

export interface AsignarKitRequest {
  operadorId: string;
  recintoId: string;
}

// ===================================================================
// FASE 4 — Tracking del operador (HU2)
// ===================================================================

export interface MiAsignacionRecinto {
  id: string;
  codigoRecinto: string;
  nombre: string;
  direccion: string | null;
  cantonNombre: string | null;
  parroquia: string | null;
  juntasFemeninas: number | null;
  juntasMasculinas: number | null;
  llegadaRegistradaEn: string | null;
}

export interface MiAsignacionMilitar {
  id: string;
  nombres: string;
  apellidos: string;
  cedula: string;
}

export interface MiAsignacionKit {
  id: string;
  codigoUnico: string;
  nombre: string;
  contenidos: string | null;
  recibido: boolean;
}

export interface MiAsignacionResponse {
  eventoId: string;
  eventoNombre: string;
  recinto: MiAsignacionRecinto;
  noCdas: MiAsignacionRecinto[];
  militar: MiAsignacionMilitar | null;
  kits: MiAsignacionKit[];
  yaRegistroSalida: boolean;
  yaRegistroLlegada: boolean;
  yaRegistroSalidaRecinto: boolean;
  yaRegistroLlegadaDpi: boolean;
  fotoMilitarUrl: string | null;
}

// HU3 — Llegada al recinto y recepción de kits

export interface FotoMilitarResponse {
  fotoUrl: string;
}

export interface ValidarKitRequest {
  codigo: string;
}

export interface ValidarKitResponse {
  id: string;
  codigoUnico: string;
  nombre: string;
  contenidos: string | null;
  yaRecibido: boolean;
}

export interface RecepcionKitRequest {
  kitId: string;
  fotoMilitarUrl: string;
  militarId: string | null;
  latitud: number;
  longitud: number;
}

export interface RecepcionKitResponse {
  id: string;
  kitId: string;
  confirmadoEn: string;
}

// Verificación de kits al retorno al DPI (rol TECNICO_SUPERVISOR)
export interface ItemChecklist {
  texto: string;
  marcado: boolean;
}

export interface ValidarKitRetornoResponse {
  id: string;
  codigoUnico: string;
  nombre: string;
  operadorNombre: string;
  items: ItemChecklist[];
  yaVerificado: boolean;
}

export interface VerificarKitRetornoRequest {
  kitId: string;
  items: ItemChecklist[];
  observaciones?: string | null;
}

export interface VerificarKitRetornoResponse {
  id: string;
  kitId: string;
  confirmadoEn: string;
}

export interface KitVerificadoRetorno {
  kitId: string;
  codigoUnico: string;
  nombre: string;
  operadorId: string;
  operadorNombre: string;
  confirmadoEn: string;
}

export interface KitsVerificadosRetornoResponse {
  total: number;
  items: KitVerificadoRetorno[];
}

export interface LlegadaRecintoRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
}

export interface LlegadaRecintoResponse {
  id: string;
  ocurridoEn: string;
}

export interface LlegadaNoCdaRequest {
  recintoId: string;
}

export interface LlegadaNoCdaResponse {
  id: string;
  recintoId: string;
  ocurridoEn: string;
}

export interface SalidaDpiRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
}

export interface SalidaDpiResponse {
  id: string;
  ocurridoEn: string;
}

// HU4 — Salida del recinto y rastreo continuo

export interface SalidaRecintoRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
}

export interface SalidaRecintoResponse {
  id: string;
  ocurridoEn: string;
}

export interface PosicionGpsPunto {
  latitud: number;
  longitud: number;
  capturadoEn: string;
}

export interface IngestaPosicionesRequest {
  posiciones: PosicionGpsPunto[];
}

export interface IngestaPosicionesResponse {
  recibidas: number;
}

// Lectura para monitoreo en tiempo real (HU4-CA4, HU6)
export interface OperadorEnRetornoKit {
  id: string;
  codigoUnico: string;
  nombre: string;
}

export interface OperadorEnRetorno {
  operadorId: string;
  operadorNombre: string;
  latitud: number;
  longitud: number;
  capturadoEn: string;
  kits: OperadorEnRetornoKit[];
}

// Estado en vivo de los CDAs (pantalla de monitoreo)
export type EstadoOperadorCda = 'EN_DPI' | 'EN_TRANSITO' | 'EN_RECINTO' | 'EN_RETORNO' | 'RETORNADO';

export interface CdaUbicacion {
  latitud: number;
  longitud: number;
  capturadoEn: string;
}

export interface CdaEstadoDto {
  recintoId: string;
  codigoRecinto: string;
  nombreRecinto: string;
  cantonId: number;
  cantonNombre: string | null;
  operadorId: string;
  operadorNombre: string;
  estado: EstadoOperadorCda;
  ubicacion: CdaUbicacion | null;
  tieneFotoMilitar: boolean;
}

// HU5 — Llegada al DPI

export interface LlegadaDpiRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
}

export interface LlegadaDpiResponse {
  id: string;
  ocurridoEn: string;
}

// Reporte admin de NO-CDAs pendientes (impresión)

export interface ReporteNoCdaDetalle {
  id: string;
  codigoRecinto: string;
  nombre: string;
  llegado: boolean;
}

export interface ReporteNoCdaItem {
  cdaId: string;
  cdaCodigo: string;
  cdaNombre: string;
  operadorNombre: string;
  operadorCedula: string;
  kitsCodigos: string[];
  totalNoCdas: number;
  totalLlegados: number;
  noCdas: ReporteNoCdaDetalle[];
}

export interface ReporteFlujoItem {
  cdaId: string;
  cdaCodigo: string;
  cdaNombre: string;
  operadorNombre: string;
  operadorCedula: string;
  kitsCodigos: string[];
  salidaDpiEn: string | null;
  llegadaRecintoEn: string | null;
  salidaRecintoEn: string | null;
  llegadaDpiEn: string | null;
}

// ===================================================================
// FASE 4 — Notificaciones in-app (HU2-CA3, base para HU19)
// ===================================================================

export type CanalNotificacion = 'PUSH' | 'EMAIL';

export interface NotificacionItem {
  id: string;
  tipoEvento: string;
  canal: CanalNotificacion;
  payload: Record<string, unknown> | null;
  creadoEn: string;
  leidaEn: string | null;
}

// ===================================================================
// FASE 5 — Incidencias (HU14)
// ===================================================================

export type TipoIncidencia =
  | 'KIT_DANADO'
  | 'KIT_FALTANTE'
  | 'PROBLEMA_RECINTO'
  | 'RETRASO'
  | 'PROBLEMA_SEGURIDAD'
  | 'OTRO';

export type EstadoIncidencia = 'ABIERTA' | 'ATENDIDA' | 'CERRADA';

export interface Incidencia {
  id: string;
  eventoId: string;
  operadorId: string;
  operadorNombre: string | null;
  recintoId: string | null;
  recintoNombre: string | null;
  kitId: string | null;
  kitCodigo: string | null;
  tipo: TipoIncidencia;
  descripcion: string | null;
  fotoUrl: string | null;
  latitud: number | null;
  longitud: number | null;
  estado: EstadoIncidencia;
  reportadoEn: string;
  desdeOffline: boolean;
}

export interface IncidenciaComentario {
  id: string;
  incidenciaId: string;
  usuarioId: string;
  usuarioNombre: string | null;
  comentario: string;
  creadoEn: string;
}

export interface IncidenciaDetalle extends Incidencia {
  comentarios: IncidenciaComentario[];
}

export interface CreateIncidenciaRequest {
  tipo: TipoIncidencia;
  descripcion?: string | null;
  fotoBase64?: string | null;
  lat?: number | null;
  lng?: number | null;
  recintoId?: string | null;
  kitId?: string | null;
  desdeOffline?: boolean;
}

export interface UpdateEstadoIncidenciaRequest {
  estado: 'ATENDIDA' | 'CERRADA';
  comentario?: string | null;
}
