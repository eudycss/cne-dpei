import { Module } from '@nestjs/common';
import { OperadoresCdaController } from './operadores-cda.controller';
import { OperadoresCdaService } from './operadores-cda.service';
import { CuentasCdaService } from './cuentas-cda.service';
import { CuentasCdaController } from './cuentas-cda.controller';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { AsistenciaCdaService } from './asistencia-cda.service';
import { FotoCdaController, FotoCdaPublicoController } from './foto-cda.controller';
import { FotoCdaService } from './foto-cda.service';
import { ActasCdaController } from './actas-cda.controller';
import { ActasCdaService } from './actas-cda.service';
import { AtrasosCdaController } from './atrasos-cda.controller';
import { AtrasosCdaService } from './atrasos-cda.service';
import { CredencialQrCdaController } from './credencial-qr-cda.controller';
import { CifradoTokenCarnet } from './cifrado-token-carnet';
import { CredencialQrCdaService } from './credencial-qr-cda.service';
import { PermisosModulosModule } from '../permisos-modulos/permisos-modulos.module';
import { KitsModule } from '../kits/kits.module';
import { ParejasCdaController } from './parejas-cda.controller';
import { ParejasCdaService } from './parejas-cda.service';

@Module({
  imports: [PermisosModulosModule, KitsModule],
  controllers: [AtrasosCdaController, CuentasCdaController, OperadoresCdaController, AsistenciaCdaController, FotoCdaController, FotoCdaPublicoController, ActasCdaController, CredencialQrCdaController, ParejasCdaController],
  providers: [AtrasosCdaService, OperadoresCdaService, CuentasCdaService, AsistenciaCdaService, FotoCdaService, ActasCdaService, CredencialQrCdaService, CifradoTokenCarnet, ParejasCdaService],
})
export class OperadoresCdaModule {}
