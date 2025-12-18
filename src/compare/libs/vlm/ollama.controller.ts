import {
  Controller,
  Get,
  Post,
  Query,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { OllamaService } from './ollama.service';

@ApiTags('Ollama')
@Controller('ollama')
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
  ) {
    if (files?.length !== 2) {
      throw new HttpException('Two images required', HttpStatus.BAD_REQUEST);
    }

    return this.ollamaService.generate({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: files.map((f) => new Uint8Array(f.buffer)),
        },
      ],
      format: 'json',
      options: { temperature: Number(temperature) },
    });
  }
}
