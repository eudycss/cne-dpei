import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createItemKitSchema, updateItemKitSchema } from '@cne/shared-validation';
import type { CreateItemKitInput, UpdateItemKitInput } from '@cne/shared-validation';
import { ItemsKitService } from './items-kit.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('items-kit')
@ApiBearerAuth()
@Controller('items-kit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ItemsKitController {
  constructor(private readonly itemsKit: ItemsKitService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'OPERADOR_CDA', 'LECTOR')
  @ApiOperation({ summary: 'Listar ítems de kit activos (checklist de contenidos)' })
  list() {
    return this.itemsKit.list();
  }

  @Get('admin')
  @Roles('ADMINISTRADOR', 'LECTOR')
  @ApiOperation({ summary: 'Listar todos los ítems de kit (incluye inactivos)' })
  listAdmin() {
    return this.itemsKit.listAll();
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Crear ítem de kit' })
  create(@Body(new ZodValidationPipe(createItemKitSchema)) body: CreateItemKitInput) {
    return this.itemsKit.create(body.codigo, body.etiqueta);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Actualizar ítem de kit' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateItemKitSchema)) body: UpdateItemKitInput,
  ) {
    return this.itemsKit.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Eliminar ítem de kit (falla si algún kit lo tiene asociado)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsKit.remove(id);
  }
}
