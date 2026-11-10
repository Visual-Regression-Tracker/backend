import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../../../../auth/guards/auth.guard';
import { RoleGuard } from '../../../../../auth/guards/role.guard';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { OllamaController } from './ollama.controller';
import { OllamaService } from './ollama.service';

describe('OllamaController', () => {
  let controller: OllamaController;
  let ollamaService: { listModels: jest.Mock };

  beforeEach(async () => {
    ollamaService = { listModels: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OllamaController],
      providers: [
        { provide: OllamaService, useValue: ollamaService },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<OllamaController>(OllamaController);
  });

  describe('listModels', () => {
    const handler = OllamaController.prototype.listModels;
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
});
