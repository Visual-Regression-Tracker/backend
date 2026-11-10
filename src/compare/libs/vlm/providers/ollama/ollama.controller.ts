import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OllamaService } from './ollama.service';
import { JwtAuthGuard } from '../../../../../auth/guards/auth.guard';
import { RoleGuard } from '../../../../../auth/guards/role.guard';
import { Roles } from '../../../../../shared/roles.decorator';

@ApiTags('Ollama')
@Controller('ollama')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.admin, Role.editor)
export class OllamaController {
  constructor(private readonly ollamaService: OllamaService) {}

  @Get('models')
  async listModels() {
    return { models: await this.ollamaService.listModels() };
  }
}
