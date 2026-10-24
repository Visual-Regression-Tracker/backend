import { HttpException, HttpStatus } from '@nestjs/common';
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

  it('passes a failure to list models through', async () => {
    ollamaService.listModels.mockRejectedValue(new Error('Connection refused'));

    await expect(controller.listModels()).rejects.toThrow('Connection refused');
  });

  it.each([
    ['no images', undefined],
    ['one image', [image('a')]],
    ['three images', [image('a'), image('b'), image('c')]],
  ])('rejects compare with %s as a 400', async (_, files) => {
    await expect(controller.compareImages(files, 'gemma3:12b', 'prompt', '0.1')).rejects.toThrow(
      new HttpException('Two images required', HttpStatus.BAD_REQUEST)
    );
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

  it('passes a missing temperature on as NaN', async () => {
    // NOTE: current behavior — the query value is not validated, so leaving it
    // out reaches the provider as NaN rather than its default temperature.
    ollamaService.generate.mockResolvedValue({});

    await controller.compareImages([image('a'), image('b')], 'gemma3:12b', 'prompt', undefined);

    expect(ollamaService.generate.mock.calls[0][0].temperature).toBeNaN();
  });
});
