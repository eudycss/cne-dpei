import { Module } from '@nestjs/common';
import { OperadoresCdaController } from './operadores-cda.controller';
import { OperadoresCdaService } from './operadores-cda.service';
import { AsistenciaCdaController } from './asistencia-cda.controller';
import { AsistenciaCdaService } from './asistencia-cda.service';

@Module({
  controllers: [OperadoresCdaController, AsistenciaCdaController],
  providers: [OperadoresCdaService, AsistenciaCdaService],
})
export class OperadoresCdaModule {}
