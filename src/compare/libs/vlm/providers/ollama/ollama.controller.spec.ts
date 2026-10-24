import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../../../../auth/guards/auth.guard';
import { RoleGuard } from '../../../../../auth/guards/role.guard';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { OllamaController } from './ollama.controller';
import { OllamaService } from './ollama.service';

const image = (content: string) => ({ buffer: Buffer.from(content) }) as Express.Multer.File;

describe('OllamaController', () => {
  let controller: OllamaController;
  let ollamaService: { listModels: jest.Mock; generate: jest.Mock };

  beforeEach(async () => {
    ollamaService = { listModels: jest.fn(), generate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OllamaController],
      providers: [
        { provide: OllamaService, useValue: ollamaService },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<OllamaController>(OllamaController);
  });

  describe.each([
    ['listModels', OllamaController.prototype.listModels],
    ['compareImages', OllamaController.prototype.compareImages],
  ])('%s', (_, handler) => {
    const guards = () => [
      ...(Reflect.getMetadata(GUARDS_METADATA, OllamaController) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
    ];

    it('requires an authenticated user', () => {
      expect(guards()).toContain(JwtAuthGuard);
    });

    it('is limited to admins and editors', () => {
      expect(guards()).toContain(RoleGuard);
      expect(new Reflector().getAllAndOverride('roles', [handler, OllamaController])).toEqual([
        Role.admin,
        Role.editor,
      ]);
    });
  });

  it('lists models', async () => {
    ollamaService.listModels.mockResolvedValue([{ name: 'gemma3:12b' }]);

    await expect(controller.listModels()).resolves.toEqual({ models: [{ name: 'gemma3:12b' }] });
  });

  it('rejects compare without exactly two images', async () => {
    await expect(controller.compareImages([image('a')], 'gemma3:12b', 'prompt', '0.1')).rejects.toThrow(HttpException);
    expect(ollamaService.generate).not.toHaveBeenCalled();
  });

  it('compares two images with the given config', async () => {
    ollamaService.generate.mockResolvedValue({ content: '{}' });

    await expect(controller.compareImages([image('a'), image('b')], 'gemma3:12b', 'prompt', '0.1')).resolves.toEqual({
      content: '{}',
    });
    expect(ollamaService.generate).toHaveBeenCalledWith(
      { provider: 'ollama', model: 'gemma3:12b', prompt: 'prompt', temperature: 0.1 },
      [new Uint8Array(Buffer.from('a')), new Uint8Array(Buffer.from('b'))]
    );
  });
});
