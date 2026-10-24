import {
  Controller,
  Get,
  Post,
  Query,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OllamaService } from './ollama.service';
import { JwtAuthGuard } from '../../../../../auth/guards/auth.guard';
import { RoleGuard } from '../../../../../auth/guards/role.guard';
import { Roles } from '../../../../../shared/roles.decorator';
import { VlmProviderResponse } from '../../vlm-provider.interface';
import { OllamaVlmConfig } from '../../vlm.types';

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

  @Post('compare')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Two images to compare (baseline and comparison)',
        },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('images', 2))
  async compareImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('model') model: string,
    @Query('prompt') prompt: string,
    @Query('temperature') temperature: string
  ): Promise<VlmProviderResponse> {
    if (files?.length !== 2) {
      throw new HttpException('Two images required', HttpStatus.BAD_REQUEST);
    }

    const config: OllamaVlmConfig = {
      provider: 'ollama',
      model,
      prompt,
      temperature: Number(temperature),
    };
    const images = files.map((f) => new Uint8Array(f.buffer));

    return this.ollamaService.generate(config, images);
  }
}
