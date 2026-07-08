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
}> = [
  { method: 'POST',  pathRegex: /^\/auth\/login$/,           accion: 'LOGIN' },
  { method: 'POST',  pathRegex: /^\/auth\/logout$/,          accion: 'LOGOUT' },
  { method: 'POST',  pathRegex: /^\/auth\/change-password$/, accion: 'PASSWORD_CHANGE' },
  { method: 'POST',  pathRegex: /^\/auth\/forgot-password$/, accion: 'PASSWORD_RESET_REQUEST' },
  { method: 'POST',  pathRegex: /^\/auth\/reset-password$/,  accion: 'PASSWORD_RESET' },
  { method: 'POST',  pathRegex: /^\/users$/,                 accion: 'USER_CREATE', entidad: 'usuario' },
  { method: 'PATCH', pathRegex: /^\/users\/[^/]+$/,          accion: 'USER_UPDATE', entidad: 'usuario' },
  { method: 'POST',  pathRegex: /^\/users\/[^/]+\/reset-password$/, accion: 'USER_PASSWORD_RESET', entidad: 'usuario' },
  { method: 'POST',  pathRegex: /^\/users\/bulk$/,           accion: 'BULK_USER_UPLOAD', entidad: 'usuario' },
  { method: 'POST',  pathRegex: /^\/users\/assign-roles$/,   accion: 'ROLE_ASSIGN' },
  // Fase 2 — militares
  { method: 'POST',  pathRegex: /^\/militares$/,             accion: 'MILITAR_CREATE', entidad: 'militar' },
  { method: 'PATCH', pathRegex: /^\/militares\/[^/]+$/,      accion: 'MILITAR_UPDATE', entidad: 'militar' },
  { method: 'DELETE',pathRegex: /^\/militares\/[^/]+$/,      accion: 'MILITAR_DELETE', entidad: 'militar' },
  { method: 'POST',  pathRegex: /^\/militares\/bulk$/,       accion: 'BULK_MILITAR_UPLOAD', entidad: 'militar' },
  // Fase 2 — eventos electorales
  { method: 'POST',  pathRegex: /^\/eventos$/,               accion: 'EVENTO_CREATE', entidad: 'evento' },
  { method: 'PATCH', pathRegex: /^\/eventos\/[^/]+$/,        accion: 'EVENTO_UPDATE', entidad: 'evento' },
  { method: 'POST',  pathRegex: /^\/eventos\/[^/]+\/activate$/, accion: 'EVENTO_ACTIVATE', entidad: 'evento' },
  { method: 'POST',  pathRegex: /^\/eventos\/[^/]+\/close$/, accion: 'EVENTO_CLOSE', entidad: 'evento' },
  { method: 'PATCH', pathRegex: /^\/eventos\/[^/]+\/config-alertas$/, accion: 'CONFIG_ALERTAS_UPDATE', entidad: 'evento' },
  // Fase 2 — asignaciones operador ↔ supervisor
  { method: 'PUT',    pathRegex: /^\/asignaciones$/,         accion: 'ASIGNACION_UPSERT', entidad: 'asignacion' },
  { method: 'DELETE', pathRegex: /^\/asignaciones\/[^/]+$/, accion: 'ASIGNACION_DELETE', entidad: 'asignacion' },
  // Fase 3 — kits electorales (HU11)
  { method: 'POST', pathRegex: /^\/kits$/, accion: 'KIT_CREATE', entidad: 'kit' },
  { method: 'POST', pathRegex: /^\/kits\/pdf-qr$/, accion: 'KIT_PDF_QR_EXPORT', entidad: 'kit' },
  // HU12 — asignación de kits a recintos/operadores (incluye freeze CA6)
  { method: 'PATCH', pathRegex: /^\/kits\/[^/]+\/asignar$/, accion: 'KIT_ASIGNAR', entidad: 'kit' },
  { method: 'PATCH', pathRegex: /^\/kits\/[^/]+\/desasignar$/, accion: 'KIT_DESASIGNAR', entidad: 'kit' },
  { method: 'POST', pathRegex: /^\/kits\/bulk$/, accion: 'KIT_BULK_UPLOAD', entidad: 'kit' },
  // Fase 4 — tracking del operador (HU2)
  { method: 'POST', pathRegex: /^\/tracking\/salida-dpi$/, accion: 'REGISTRO_SALIDA_DPI', entidad: 'eventos_tracking' },
  // Fase 4 — llegada al recinto y recepción de kits (HU3)
  { method: 'POST', pathRegex: /^\/tracking\/foto-militar$/, accion: 'FOTO_MILITAR_UPLOAD', entidad: 'recepciones_kit' },
  { method: 'POST', pathRegex: /^\/tracking\/recepcion-kit$/, accion: 'RECEPCION_KIT', entidad: 'recepciones_kit' },
  { method: 'POST', pathRegex: /^\/tracking\/llegada-recinto$/, accion: 'REGISTRO_LLEGADA_RECINTO', entidad: 'eventos_tracking' },
  // HU13 Parte B — registro manual de llegada por supervisor (recintos esDificilAcceso)
  { method: 'POST', pathRegex: /^\/tracking\/llegada-recinto-manual$/, accion: 'REGISTRO_LLEGADA_RECINTO_MANUAL', entidad: 'eventos_tracking' },
];

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
          const justificacion = (req.body as any)?.justificacion;
          await this.prisma.bitacoraAuditoria.create({
            data: {
              usuarioId: userId ?? null,
              accion: match.accion,
              entidad: match.entidad ?? null,
              entidadId: match.entidadId?.(req, resBody) ?? null,
              datosDespues: justificacion ? { justificacion } : undefined,
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
