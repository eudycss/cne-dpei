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
          await this.prisma.bitacoraAuditoria.create({
            data: {
              usuarioId: userId ?? null,
              accion: match.accion,
              entidad: match.entidad ?? null,
              entidadId: match.entidadId?.(req, resBody) ?? null,
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
