export type RoleName =
  | 'ADMINISTRADOR'
  | 'TECNICO_SUPERVISOR'
  | 'OPERADOR_CDA'
  | 'LECTOR'
  | 'ASISTENTE_TRANSVERSAL';

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

// Tokens frescos (ya con debeCambiarPwd=false) para reemplazar los que el
// cliente tenía guardados — sin esto, el access token viejo sigue firmado
// con debeCambiarPwd=true hasta que expire y el servidor rechaza al usuario
// justo después de haber cambiado su contraseña con éxito.
export interface ChangePasswordResponse {
  accessToken: string;
  refreshToken: string;
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
  esDificilAcceso: boolean;
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
  esDificilAcceso?: boolean;
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
  esDificilAcceso?: boolean;
}

// --- Sincronización de recintos desde el Google Sheet ---

export type AccionSyncRecinto = 'CREAR' | 'ACTUALIZAR' | 'REACTIVAR' | 'OCULTAR';

export interface CambioCampoRecinto {
  campo: string;
  antes: string;
  despues: string;
}

export interface CambioSyncRecinto {
  codigoRecinto: string;
  nombre: string;
  accion: AccionSyncRecinto;
  cambios: CambioCampoRecinto[];
  /** Aclaración, p. ej. que el CDA destino se tomó del CDA que reemplazó al anterior. */
  nota?: string;
}

export interface ErrorSyncRecinto {
  codigoRecinto: string;
  nombre: string;
  error: string;
}

export interface SyncRecintosPreview {
  leidos: { cda: number; noCda: number };
  sinCambios: number;
  cambios: CambioSyncRecinto[];
  /** Recintos que no se tocarán hasta que se corrija el Sheet o el sistema. */
  errores: ErrorSyncRecinto[];
  /** Jornada electoral en curso: se puede ver la vista previa, pero no aplicar. */
  congelado: boolean;
  /** Se ocultarían demasiados recintos de una vez (¿Sheet incompleto?): no se puede aplicar. */
  ocultamientoMasivo: boolean;
}

export interface SyncRecintosResultado {
  aplicados: number;
  creados: number;
  actualizados: number;
  ocultados: number;
  errores: ErrorSyncRecinto[];
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

export type TipoEventoElectoral = string;

export interface TipoEventoCatalog {
  id: string;
  codigo: string;
  etiqueta: string;
  activo: boolean;
}

export interface ItemKitCatalog {
  id: string;
  codigo: string;
  etiqueta: string;
  activo: boolean;
}

export type EstadoEvento = 'BORRADOR' | 'ACTIVO' | 'CERRADO';

export interface ConfigAlertas {
  umbralLlegadaRecintoMin: number;
  umbralLlegadaDpiMin: number;
  umbralSinSyncMin: number;
  margenLlegadaMetros: number;
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
  /** Fecha en que un evento cerrado se reabrió solo para consulta; null en uso normal. */
  reabiertoEn: string | null;
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

export type EstadoItemKit = 'BUENO' | 'REGULAR' | 'MALO';

/** Un artículo del kit con su serie y estado (null = sin serie, "S/N"). */
export interface KitItemDetalle {
  itemId: string;
  etiqueta: string;
  serie: string | null;
  estado: EstadoItemKit;
}

export interface KitItemDetalleInput {
  itemId: string;
  serie?: string | null;
  estado?: EstadoItemKit;
}

export interface Kit {
  id: string;
  eventoId: string;
  codigoUnico: string;
  qrPayload: string;
  nombre: string;
  contenidos: string | null; // legacy: solo tiene valor en kits creados antes del catálogo de ítems
  items: string[]; // etiquetas de ItemKitCatalog vinculadas al kit vía KitItemContenido
  itemIds: string[]; // ids de ItemKitCatalog vinculados al kit vía KitItemContenido
  detalleItems: KitItemDetalle[];
  recintoId: string | null;
  operadorId: string | null;
  estado: EstadoKit;
  esPrueba: boolean;
  creadoEn: string;
}

export interface CreateKitRequest {
  eventoId: string;
  nombre: string;
  contenidos?: string | null;
  esPrueba?: boolean;
  itemIds?: string[];
  detalleItems?: KitItemDetalleInput[];
  recintoId: string;
}

export interface EditKitRequest {
  recintoId?: string;
  itemIds?: string[];
  detalleItems?: KitItemDetalleInput[];
  justificacion?: string;
}

export interface PdfQrRequest {
  kitIds: string[];
}

export interface AsignarKitRequest {
  operadorId: string;
  justificacion?: string;
}

export interface DesasignarKitRequest {
  justificacion?: string;
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
  latitud: number | null;
  longitud: number | null;
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
  contenidos: string | null; // legacy
  items: string[];
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
  /** El operador ya confirmó que el recinto tiene conexión (después de la llegada). */
  yaRegistroPruebaConexion: boolean;
  yaRegistroSalidaRecinto: boolean;
  yaRegistroLlegadaDpi: boolean;
  fotoMilitarUrl: string | null;
  margenLlegadaMetros: number;
  delegacion: { latitud: number; longitud: number } | null;
  margenLlegadaDpiMetros: number;
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
  contenidos: string | null; // legacy
  items: string[];
  yaRecibido: boolean;
}

export interface RecepcionKitRequest {
  kitId: string;
  fotoMilitarUrl: string;
  militarId: string | null;
  latitud: number;
  longitud: number;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
}

export interface RecepcionKitResponse {
  id: string;
  kitId: string;
  confirmadoEn: string;
}

// Verificación de kits al retorno al DPI (rol ASISTENTE_TRANSVERSAL)
export interface ItemChecklist {
  texto: string;
  marcado: boolean;
  // Solo en kits con ítems del catálogo (los legacy de texto libre no los traen).
  itemId?: string;
  serie?: string | null;
  estado?: EstadoItemKit;
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
  precisionMetros?: number | null;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
}

export interface LlegadaRecintoResponse {
  id: string;
  ocurridoEn: string;
}

export interface LlegadaNoCdaRequest {
  recintoId: string;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
}

export interface LlegadaNoCdaResponse {
  id: string;
  recintoId: string;
  ocurridoEn: string;
}

export interface LlegadaRecintoManualRequest {
  recintoId: string;
}

export interface LlegadaRecintoManualResponse {
  id: string;
  ocurridoEn: string;
}

export interface SalidaDpiRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
}

export interface SalidaDpiResponse {
  id: string;
  ocurridoEn: string;
}

// Prueba de conexión (después de la llegada al recinto)

export interface PruebaConexionRequest {
  ocurridoEn: string;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
}

export interface PruebaConexionResponse {
  id: string;
  ocurridoEn: string;
}

// HU4 — Salida del recinto y rastreo continuo

export interface SalidaRecintoRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
  actaInstalacionUrl: string;
  actaEscrutinioUrl: string;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
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
  estado: EstadoOperadorCda;
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
  /** ISO de la última prueba de conexión del evento activo; null si aún no la hizo. */
  pruebaConexionEn: string | null;
  tieneActaInstalacion: boolean;
  tieneActaEscrutinio: boolean;
}

export interface RecintoDificilAccesoDto {
  recintoId: string;
  codigoRecinto: string;
  nombreRecinto: string;
  operadorId: string;
  operadorNombre: string;
  estado: EstadoOperadorCda;
}

// HU5 — Llegada al DPI

export interface LlegadaDpiRequest {
  latitud: number;
  longitud: number;
  ocurridoEn: string;
  precisionMetros?: number | null;
  /** true si la acción se reenvió desde la cola offline del móvil. */
  desdeOffline?: boolean;
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
  cantonId: number | null;
  cantonNombre: string;
  operadorId: string;
  operadorNombre: string;
  operadorCedula: string;
  kitsCodigos: string[];
  salidaDpiEn: string | null;
  llegadaRecintoEn: string | null;
  pruebaConexionEn: string | null;
  salidaRecintoEn: string | null;
  llegadaDpiEn: string | null;
}

/** Usuario que puede firmar el Informe del Operador CDA como responsable. */
export interface ResponsableInforme {
  id: string;
  nombre: string;
  cedula: string;
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

// ===================================================================
// HU18 — Alertas
// ===================================================================

export type TipoAlerta =
  | 'NO_LLEGO_RECINTO'
  | 'NO_LLEGO_DPI'
  | 'SIN_SINCRONIZAR'
  | 'KIT_NO_CORRESPONDE'
  | 'ENTREGA_MILITAR_NO_REGISTRADA'
  | 'LLEGADA_RECINTO_FUERA_DE_RANGO'
  | 'LLEGADA_DPI_FUERA_DE_RANGO';

export type EstadoAlerta = 'GENERADA' | 'VISTA' | 'ATENDIDA';

export interface Alerta {
  id: string;
  eventoId: string;
  operadorId: string | null;
  operadorNombre?: string | null;
  kitId: string | null;
  tipo: TipoAlerta;
  mensaje: string;
  estado: EstadoAlerta;
  generadaEn: string;
}

export interface UpdateEstadoAlertaRequest {
  estado: 'VISTA' | 'ATENDIDA';
}

// ===================================================================
// Alertas de enlaces caídos (CDAs Imbabura)
// ===================================================================

export type EstadoEnlace = 'ACTIVO' | 'FALLO';

export interface EnlaceRecinto {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string;
  estado: EstadoEnlace;
  actualizadoEn: string;
}

export interface ConfigEnlacesResponse {
  correos: string[];
  /** Minutos caído antes del primer aviso por Telegram. */
  minutosPrimerAviso: number;
  /** Minutos entre un aviso y el siguiente mientras siga caído. */
  minutosRepetirAviso: number;
}

export interface AvisosEnlacesRequest {
  minutosPrimerAviso: number;
  minutosRepetirAviso: number;
}

export interface AddCorreoEnlaceRequest {
  correo: string;
}

/** Período de calendario (hora de Ecuador): día, semana lunes-domingo o mes. */
export type PeriodoEstadisticasEnlaces = 'dia' | 'semana' | 'mes';

export interface EstadisticaEnlace {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string;
  /** Caídas que empezaron dentro del período. */
  caidas: number;
  /** Minutos caído dentro del período (incluye caídas que venían de antes). */
  minutosCaido: number;
  /** % del tiempo observado del período en que estuvo ACTIVO (0-100, 1 decimal). */
  disponibilidad: number;
  sigueCaido: boolean;
}

export interface EstadisticasEnlacesResponse {
  periodo: PeriodoEstadisticasEnlaces;
  desde: string;
  hasta: string;
  /** Desde cuándo hay historial; si es posterior a `desde`, el período está incompleto. */
  historialDesde: string;
  datosParciales: boolean;
  totalRecintos: number;
  /** Recintos con caídas o tiempo caído en el período, de más a menos caídas. */
  ranking: EstadisticaEnlace[];
  /** Recintos monitoreados sin ninguna caída en el período. */
  sinCaidas: { codigoRecinto: string; nombreRecinto: string; canton: string }[];
}

// --- Cadena de custodia del kit (rol ASISTENTE_TRANSVERSAL) ---
export interface MilitarResumen {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
  recintoId: string;
  recintoNombre: string;
}

export interface OperadorResumen {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
}

export interface EntregaCustodio {
  militar: MilitarResumen;
  entregadoEn: string;
  entregadoPorNombre: string;
  militarDeOtroRecinto: boolean;
}

/** Ficha del kit escaneado por el asistente para entregarlo a un militar. */
export interface KitCustodiaResponse {
  kitId: string;
  codigoUnico: string;
  nombre: string;
  estado: EstadoKit;
  recinto: { id: string; codigo: string; nombre: string } | null;
  operador: OperadorResumen | null;
  /** Militares asignados al recinto del kit (la opción por defecto). */
  militaresRecinto: MilitarResumen[];
  entrega: EntregaCustodio | null;
  /** Hasta que el CDA reciba el kit (estado ASIGNADO) se puede entregar o corregir. */
  editable: boolean;
}

/** Avance de entregas a militares del evento activo (kits asignados, sin los de prueba). */
export interface ResumenCustodia {
  entregados: number;
  total: number;
}

export interface RegistrarEntregaRequest {
  kitId: string;
  militarId: string;
}

export interface CorregirMilitarRequest {
  militarId: string;
  motivo: string;
}

export interface CambiarOperadorRequest {
  operadorId: string;
  motivo: string;
}

/** Una fila del informe consolidado de cadena de custodia (un kit). */
export interface FilaInformeCustodia {
  kitId: string;
  codigoUnico: string;
  recintoId: string | null;
  recintoCodigo: string | null;
  recintoNombre: string | null;
  cantonId: number | null;
  cantonNombre: string | null;
  operadorNombre: string | null;
  operadorCedula: string | null;
  /** Paso 1: Asistente → militar en el DPEI. */
  entrega: {
    militarNombre: string;
    militarCedula: string;
    entregadoEn: string;
    entregadoPorNombre: string;
    militarDeOtroRecinto: boolean;
  } | null;
  /** Paso 2: militar → operador CDA (con foto del militar). */
  recepcion: { confirmadoEn: string; tieneFoto: boolean } | null;
  /** Paso 3: operador CDA → Asistente al retorno. */
  devolucion: {
    confirmadoEn: string;
    verificadoPorNombre: string;
    completo: boolean;
    observaciones: string | null;
  } | null;
  correcciones: number;
}

// --- Operadores CDA (personal de los Centros de Digitalización de Actas) ---
export interface OperadorCda {
  id: string;
  numero: number | null;
  apellidosNombres: string;
  cedula: string;
  telefono: string | null;
  cargo: string;
  unidad: string | null;
  /** AAAA-MM-DD */
  fechaInicio: string | null;
  tieneFoto: boolean;
  activo: boolean;
  creadoEn: string;
}

/** Fila del Excel ya leída y normalizada. */
export interface OperadorCdaFila {
  fila: number;
  numero?: number;
  apellidosNombres: string;
  cedula: string;
  telefono?: string;
  cargo: string;
  unidad?: string;
  fechaInicio?: string;
  /** NUEVO si la cédula no existe; ACTUALIZAR si ya estaba registrada. */
  accion: 'NUEVO' | 'ACTUALIZAR';
}

/** Alta manual de un operador (los mismos campos que una fila del Excel). */
export interface CrearOperadorCdaRequest {
  apellidosNombres: string;
  cedula: string;
  telefono?: string;
  cargo: string;
  unidad?: string;
  /** AAAA-MM-DD */
  fechaInicio?: string;
}

/** Edición: todo menos la cédula. Un opcional ausente se guarda vacío. */
export type EditarOperadorCdaRequest = Omit<CrearOperadorCdaRequest, 'cedula'>;

export interface ImportOperadoresCdaResult {
  /** true = solo vista previa, no se guardó nada. */
  vistaPrevia: boolean;
  nuevos: number;
  actualizados: number;
  filas: OperadorCdaFila[];
  errores: BulkUploadRow[];
}

export type TipoMarcaAsistenciaCda = 'ENTRADA' | 'SALIDA';

/** Asistencia de un operador en un día (marcas en null = pendientes). */
export interface AsistenciaCdaFila {
  operador: OperadorCda;
  /** ISO 8601 */
  entradaEn: string | null;
  /** Nombre de quien marcó la entrada. */
  entradaPor: string | null;
  salidaEn: string | null;
  salidaPor: string | null;
}

export interface AsistenciaCdaDia {
  /** AAAA-MM-DD (calendario de Ecuador). */
  fecha: string;
  /** Solo el día de hoy se puede marcar. */
  esHoy: boolean;
  filas: AsistenciaCdaFila[];
}

export interface MarcarAsistenciaCdaRequest {
  tipo: TipoMarcaAsistenciaCda;
}

export interface MarcarAsistenciaCdaMasivaRequest {
  tipo: TipoMarcaAsistenciaCda;
  operadorIds: string[];
}

export interface MarcarAsistenciaCdaMasivaResult {
  marcados: number;
  /** Ya tenían la marca, o (salida) aún no tenían entrada. */
  omitidos: number;
  /** Ids que no corresponden a un operador activo. */
  ignorados: number;
}

// Enlace personal para que el operador CDA suba su foto (sin sesión).

/** Lo que devuelve la API al crear el enlace. El token se muestra una sola vez. */
export interface EnlaceFotoCdaCreado {
  token: string;
  /** ISO 8601 */
  expiraEn: string;
}

/** Lo que ve el operador al abrir su enlace. Datos enmascarados. */
export type EnlaceFotoCdaPublico =
  | {
      estado: 'ACTIVO';
      apellidosNombres: string;
      /** Cédula enmascarada (p. ej. 1050xxxx12). */
      cedula: string;
      /** Teléfono enmascarado o null. */
      telefono: string | null;
      cargo: string;
      expiraEn: string;
    }
  /** Caducó, ya se usó, se generó otro, superó los intentos o no existe. */
  | { estado: 'INACTIVO' };

// Actas de entrega de indumentaria y credencial (peto, credencial y cordón).

export type EstadoPrenda = 'NUEVO' | 'BUENO' | 'REGULAR' | 'MALO';
/** GENERADA se puede corregir; FIRMADA queda bloqueada (solo un administrador la reabre). */
export type EstadoActaCda = 'GENERADA' | 'FIRMADA';

export interface ActaEntregaCda {
  id: string;
  operadorId: string;
  entregaUsuarioId: string | null;
  entregaNombre: string;
  entregaCedula: string;
  entregaCargo: string;
  lugar: string;
  /** AAAA-MM-DD */
  fecha: string;
  estadoPeto: EstadoPrenda;
  estadoCredencial: EstadoPrenda;
  estadoCordon: EstadoPrenda;
  estado: EstadoActaCda;
  /** ISO 8601 */
  firmadaEn: string | null;
  actualizadoEn: string;
}

/** Operador con su acta vigente (null = aún no se genera). */
export interface ActaCdaFila {
  operador: OperadorCda;
  acta: ActaEntregaCda | null;
}

/** Quien puede entregar (usuario del sistema), con el cargo que se sugiere en el acta. */
export interface PersonaEntregaCda {
  usuarioId: string;
  nombre: string;
  cedula: string;
  cargoSugerido: string;
}

export interface GenerarActasCdaRequest {
  operadorIds: string[];
  entregaUsuarioId?: string;
  entregaNombre: string;
  entregaCedula: string;
  entregaCargo: string;
  /** AAAA-MM-DD */
  fecha: string;
  lugar: string;
  estadoPeto: EstadoPrenda;
  estadoCredencial: EstadoPrenda;
  estadoCordon: EstadoPrenda;
}

export interface GenerarActasCdaResult {
  generadas: number;
  actualizadas: number;
  /** Ya estaban firmadas: no se tocaron. */
  omitidasFirmadas: number;
  /** Ids que no corresponden a un operador activo. */
  ignorados: number;
}

// ---- Módulos de la web por rol (los ids y el catálogo viven en @cne/shared-validation) ----

export interface ModulosRol {
  rol: RoleName;
  modulos: string[];
}

export interface PermisosModulosResponse {
  roles: ModulosRol[];
}

export interface MisModulosResponse {
  modulos: string[];
}
