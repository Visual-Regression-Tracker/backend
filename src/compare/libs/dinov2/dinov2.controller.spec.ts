import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../../auth/guards/auth.guard';
import { RoleGuard } from '../../../auth/guards/role.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { Dinov2Controller } from './dinov2.controller';
import { Dinov2Service } from './dinov2.service';

describe('Dinov2Controller', () => {
  let controller: Dinov2Controller;
  let dinov2Service: { status: jest.Mock };

  beforeEach(async () => {
    dinov2Service = { status: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [Dinov2Controller],
      providers: [
        { provide: Dinov2Service, useValue: dinov2Service },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<Dinov2Controller>(Dinov2Controller);
  });

  const guards = () => [
    ...(Reflect.getMetadata(GUARDS_METADATA, Dinov2Controller) ?? []),
    ...(Reflect.getMetadata(GUARDS_METADATA, Dinov2Controller.prototype.status) ?? []),
  ];

  it('requires an authenticated user', () => {
    expect(guards()).toContain(JwtAuthGuard);
  });

  it('is limited to admins and editors', () => {
    expect(guards()).toContain(RoleGuard);
    expect(new Reflector().getAllAndOverride('roles', [Dinov2Controller.prototype.status, Dinov2Controller])).toEqual([
      Role.admin,
      Role.editor,
    ]);
  });

  it("answers with the service's status", async () => {
    dinov2Service.status.mockResolvedValue({ configured: true, available: false });

    await expect(controller.status()).resolves.toEqual({ configured: true, available: false });
  });
});
