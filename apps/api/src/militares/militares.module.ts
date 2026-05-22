import { Module } from '@nestjs/common';
import { MilitaresController } from './militares.controller';
import { MilitaresService } from './militares.service';

@Module({
  controllers: [MilitaresController],
  providers: [MilitaresService],
})
export class MilitaresModule {}
