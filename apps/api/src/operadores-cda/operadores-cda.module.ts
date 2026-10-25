import { Module } from '@nestjs/common';
import { OperadoresCdaController } from './operadores-cda.controller';
import { OperadoresCdaService } from './operadores-cda.service';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { AsistenciaCdaService } from './asistencia-cda.service';
import { FotoCdaController, FotoCdaPublicoController } from './foto-cda.controller';
import { FotoCdaService } from './foto-cda.service';
import { ActasCdaController } from './actas-cda.controller';
import { ActasCdaService } from './actas-cda.service';
import { AtrasosCdaController } from './atrasos-cda.controller';
import { AtrasosCdaService } from './atrasos-cda.service';
import { CredencialQrCdaController } from './credencial-qr-cda.controller';
import { CredencialQrCdaService } from './credencial-qr-cda.service';
import { PermisosModulosModule } from '../permisos-modulos/permisos-modulos.module';

@Module({
  imports: [PermisosModulosModule],
  controllers: [AtrasosCdaController, OperadoresCdaController, AsistenciaCdaController, FotoCdaController, FotoCdaPublicoController, ActasCdaController, CredencialQrCdaController],
  providers: [AtrasosCdaService, OperadoresCdaService, AsistenciaCdaService, FotoCdaService, ActasCdaService, CredencialQrCdaService],
})
export class OperadoresCdaModule {}
