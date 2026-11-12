import { Module } from '@nestjs/common';
import { EvaticsController, EvaticsPublicoController } from './evatics.controller';
import { EvaticsService } from './evatics.service';
import { GeminiCertificadoClient } from './gemini-certificado.client';
import { GroqCertificadoClient } from './groq-certificado.client';
import { LectorCertificadoService } from './lector-certificado.service';
import { PermisosModulosModule } from '../permisos-modulos/permisos-modulos.module';
import { EnlacesModule } from '../enlaces/enlaces.module';

/** Certificados Evatics: página pública de subida y revisión por los supervisores. */
@Module({
  imports: [PermisosModulosModule, EnlacesModule],
  controllers: [EvaticsController, EvaticsPublicoController],
  providers: [EvaticsService, LectorCertificadoService, GeminiCertificadoClient, GroqCertificadoClient],
})
export class EvaticsModule {}
