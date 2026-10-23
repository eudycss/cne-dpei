import { Module } from '@nestjs/common';
import { OperadoresCdaController } from './operadores-cda.controller';
import { OperadoresCdaService } from './operadores-cda.service';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { AsistenciaCdaService } from './asistencia-cda.service';
import { FotoCdaController, FotoCdaPublicoController } from './foto-cda.controller';
import { FotoCdaService } from './foto-cda.service';

@Module({
  controllers: [OperadoresCdaController, AsistenciaCdaController, FotoCdaController, FotoCdaPublicoController],
  providers: [OperadoresCdaService, AsistenciaCdaService, FotoCdaService],
})
export class OperadoresCdaModule {}
