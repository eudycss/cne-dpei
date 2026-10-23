import { Module } from '@nestjs/common';
import { OperadoresCdaController } from './operadores-cda.controller';
import { OperadoresCdaService } from './operadores-cda.service';

@Module({
  controllers: [OperadoresCdaController],
  providers: [OperadoresCdaService],
})
export class OperadoresCdaModule {}
