import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { PrismaService } from '../db/prisma.service';

/**
 * Mapeo: método+ruta -> { accion, entidad }
 * Preparación de HU17. Las HU posteriores extenderán esta tabla.
 */
const AUDIT_TABLE: Array<{
  method: string;
  pathRegex: RegExp;
  accion: string;
  entidad?: string;
  entidadId?: (req: Request, res: unknown) => string | undefined;
  /** Campos cuyo VALOR se guarda (sin datos personales). Del resto solo queda el nombre. */
  campos?: readonly string[];
}> = [
  { method: 'POST',  pathRegex: /^\/auth\/login$/,           accion: 'LOGIN' },
  { method: 'POST',  pathRegex: /^\/auth\/logout$/,          accion: 'LOGOUT' },
  { method: 'POST',  pathRegex: /^\/auth\/change-password$/, accion: 'PASSWORD_CHANGE' },
  { method: 'POST',  pathRegex: /^\/auth\/forgot-password$/, accion: 'PASSWORD_RESET_REQUEST' },
  { method: 'POST',  pathRegex: /^\/auth\/reset-password$/,  accion: 'PASSWORD_RESET' },
  { method: 'POST',  pathRegex: /^\/users$/,                 accion: 'USER_CREATE', entidad: 'usuario' },
  { method: 'PATCH', pathRegex: /^\/users\/[^/]+$/,          accion: 'USER_UPDATE', entidad: 'usuario', campos: ['activo'] },
  { method: 'POST',  pathRegex: /^\/users\/[^/]+\/reset-password$/, accion: 'USER_PASSWORD_RESET', entidad: 'usuario' },
  { method: 'POST',  pathRegex: /^\/users\/bulk$/,           accion: 'BULK_USER_UPLOAD', entidad: 'usuario' },
  { method: 'POST',  pathRegex: /^\/users\/assign-roles$/,   accion: 'ROLE_ASSIGN', campos: ['userIds', 'roleIds'] },
  // Fase 2 — militares
  { method: 'POST',  pathRegex: /^\/militares$/,             accion: 'MILITAR_CREATE', entidad: 'militar' },
  { method: 'PATCH', pathRegex: /^\/militares\/[^/]+$/,      accion: 'MILITAR_UPDATE', entidad: 'militar' },
  { method: 'DELETE',pathRegex: /^\/militares\/[^/]+$/,      accion: 'MILITAR_DELETE', entidad: 'militar' },
  { method: 'POST',  pathRegex: /^\/militares\/bulk$/,       accion: 'BULK_MILITAR_UPLOAD', entidad: 'militar' },
  // Fase 2 — eventos electorales
  { method: 'POST',  pathRegex: /^\/eventos$/,               accion: 'EVENTO_CREATE', entidad: 'evento' },
  { method: 'PATCH', pathRegex: /^\/eventos\/[^/]+$/,        accion: 'EVENTO_UPDATE', entidad: 'evento', campos: ['tipo', 'fechaJornada'] },
  { method: 'POST',  pathRegex: /^\/eventos\/[^/]+\/activate$/, accion: 'EVENTO_ACTIVATE', entidad: 'evento' },
  { method: 'POST',  pathRegex: /^\/eventos\/[^/]+\/close$/, accion: 'EVENTO_CLOSE', entidad: 'evento', campos: ['confirmar', 'justificacion'] },
  { method: 'PATCH', pathRegex: /^\/eventos\/[^/]+\/config-alertas$/, accion: 'CONFIG_ALERTAS_UPDATE', entidad: 'evento', campos: ['umbralLlegadaRecintoMin', 'umbralLlegadaDpiMin', 'umbralSinSyncMin', 'margenLlegadaMetros', 'margenLlegadaDpiMetros'] },
  // Fase 2 — asignaciones operador ↔ supervisor
  { method: 'PUT',    pathRegex: /^\/asignaciones$/,         accion: 'ASIGNACION_UPSERT', entidad: 'asignacion', campos: ['eventoId', 'operadorId', 'supervisorId'] },
  { method: 'DELETE', pathRegex: /^\/asignaciones\/[^/]+$/, accion: 'ASIGNACION_DELETE', entidad: 'asignacion' },
  // Fase 3 — kits electorales (HU11)
  { method: 'POST', pathRegex: /^\/kits$/, accion: 'KIT_CREATE', entidad: 'kit' },
  { method: 'POST', pathRegex: /^\/kits\/pdf-qr$/, accion: 'KIT_PDF_QR_EXPORT', entidad: 'kit' },
  // Fase 5 — catálogo de ítems de kit (checklist de contenidos)
  { method: 'POST',   pathRegex: /^\/items-kit$/,        accion: 'ITEM_KIT_CREATE', entidad: 'item_kit' },
  { method: 'PATCH',  pathRegex: /^\/items-kit\/[^/]+$/, accion: 'ITEM_KIT_UPDATE', entidad: 'item_kit' },
  { method: 'DELETE', pathRegex: /^\/items-kit\/[^/]+$/, accion: 'ITEM_KIT_DELETE', entidad: 'item_kit' },
  // Recintos sincronizados desde el Google Sheet
  { method: 'POST', pathRegex: /^\/recintos\/sync$/, accion: 'RECINTOS_SYNC', entidad: 'recinto' },
  // HU12 — asignación de kits a recintos/operadores (incluye freeze CA6)
  { method: 'PATCH', pathRegex: /^\/kits\/[^/]+\/asignar$/, accion: 'KIT_ASIGNAR', entidad: 'kit', campos: ['operadorId', 'recintoId', 'justificacion'] },
  { method: 'PATCH', pathRegex: /^\/kits\/[^/]+\/desasignar$/, accion: 'KIT_DESASIGNAR', entidad: 'kit', campos: ['justificacion'] },
  { method: 'POST', pathRegex: /^\/kits\/bulk$/, accion: 'KIT_BULK_UPLOAD', entidad: 'kit' },
  // Fase 4 — tracking del operador (HU2)
  { method: 'POST', pathRegex: /^\/tracking\/salida-dpi$/, accion: 'REGISTRO_SALIDA_DPI', entidad: 'eventos_tracking' },
  // Fase 4 — llegada al recinto y recepción de kits (HU3)
  { method: 'POST', pathRegex: /^\/tracking\/foto-militar$/, accion: 'FOTO_MILITAR_UPLOAD', entidad: 'recepciones_kit' },
  { method: 'POST', pathRegex: /^\/tracking\/recepcion-kit$/, accion: 'RECEPCION_KIT', entidad: 'recepciones_kit' },
  { method: 'POST', pathRegex: /^\/tracking\/llegada-recinto$/, accion: 'REGISTRO_LLEGADA_RECINTO', entidad: 'eventos_tracking' },
  // HU13 Parte B — registro manual de llegada por supervisor (recintos esDificilAcceso)
  { method: 'POST', pathRegex: /^\/tracking\/llegada-recinto-manual$/, accion: 'REGISTRO_LLEGADA_RECINTO_MANUAL', entidad: 'eventos_tracking', campos: ['recintoId', 'operadorId', 'ocurridoEn'] },
];

/**
 * La bitácora es inmutable: lo que entra no se borra nunca. Por eso los VALORES solo
 * se guardan de los campos de `campos` (lista blanca por ruta, sin datos personales);
 * del resto queda solo el nombre del campo, para saber qué se cambió.
 */
const CLAVE_SENSIBLE = /pass|clave|contrase|token|secret|hash|otp|pin|credencial|cookie|session|authoriz|jwt|apikey/i;
const NOMBRE_CAMPO = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const MAX_CAMPOS = 30;
const MAX_VALOR_CHARS = 500;

function valorAuditable(v: unknown): unknown {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'string') return v.slice(0, MAX_VALOR_CHARS);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
    return v.slice(0, 50);
  }
  return undefined; // objetos, archivos o base64 anidado: nunca
}

/** Qué se pidió cambiar: nombres de los campos enviados y el valor de los permitidos. */
export function datosDeLaPeticion(
  body: unknown,
  permitidos: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) return undefined;
  const claves = Object.keys(body)
    .filter((c) => NOMBRE_CAMPO.test(c) && !CLAVE_SENSIBLE.test(c))
    .slice(0, MAX_CAMPOS);
  if (claves.length === 0) return undefined;

  const datos: Record<string, unknown> = { campos: claves };
  for (const c of claves) {
    if (!permitidos.includes(c)) continue;
    const v = valorAuditable((body as Record<string, unknown>)[c]);
    if (v !== undefined) datos[c] = v;
  }
  return datos;
}

/** Id de la entidad afectada: el `:id` de la ruta o, al crear, el `id` de la respuesta. */
function idEntidad(req: Request, resBody: unknown): string | undefined {
  const deRuta = req.params?.id;
  const deRespuesta =
    resBody && typeof resBody === 'object' ? (resBody as { id?: unknown }).id : undefined;
  const id = typeof deRuta === 'string' ? deRuta : deRespuesta;
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 60) : undefined;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl?.split('?')[0] ?? req.url;
    const method = req.method;

    const match = AUDIT_TABLE.find(
      (e) => e.method === method && e.pathRegex.test(path),
    );

    return next.handle().pipe(
      tap(async (resBody) => {
        if (!match) return;
        try {
          const userId =
            (req as any).user?.sub ??
            (typeof resBody === 'object' && resBody && 'user' in resBody
              ? (resBody as any).user?.id
              : undefined);
          await this.prisma.bitacoraAuditoria.create({
            data: {
              usuarioId: userId ?? null,
              accion: match.accion,
              entidad: match.entidad ?? null,
              entidadId: match.entidadId?.(req, resBody) ?? idEntidad(req, resBody) ?? null,
              datosDespues: datosDeLaPeticion(req.body, match.campos) as any,
              dispositivo: req.headers['user-agent']?.slice(0, 160) ?? null,
              ip: req.ip ?? null,
            },
          });
        } catch (e: any) {
          // No bloquear la respuesta si la bitácora falla; solo loguear.
          this.log.warn(`Audit fallo para ${method} ${path}: ${e?.message}`);
        }
      }),
    );
  }
}
