import { Module } from '@nestjs/common';
import { PermisosModulosModule } from '../permisos-modulos/permisos-modulos.module';
import { SimuladorController, SimuladorPublicoController } from './simulador.controller';
import { PracticasDigitacionService } from './practicas-digitacion.service';
import { SimuladorPublicoService } from './simulador-publico.service';

@Module({
  imports: [PermisosModulosModule],
  controllers: [SimuladorController, SimuladorPublicoController],
  providers: [PracticasDigitacionService, SimuladorPublicoService],
})
export class SimuladorModule {}
