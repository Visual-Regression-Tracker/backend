import { Test, TestingModule } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

describe('PrismaModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret';
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('creates a single PrismaService for the whole app', () => {
    const instances = new Set<unknown>();
    const declaredIn: string[] = [];
    for (const module of moduleRef.get(ModulesContainer).values()) {
      const wrapper = module.providers.get(PrismaService);
      if (wrapper) {
        declaredIn.push(module.metatype.name);
        instances.add(wrapper.instance);
      }
    }

    expect(declaredIn).toEqual([PrismaModule.name]);
    expect(instances.size).toBe(1);
  });

  it('injects the same PrismaService into every consumer', () => {
    const modules = [...moduleRef.get(ModulesContainer).values()];
    const prisma = modules.find((module) => module.metatype === PrismaModule)!.providers.get(PrismaService)!.instance;
    const consumers = modules
      .flatMap((module) => [...module.providers.values(), ...module.controllers.values()])
      .map((wrapper) => (wrapper.instance as { prismaService?: unknown })?.prismaService)
      .filter(Boolean);

    expect(consumers.length).toBeGreaterThan(10);
    expect(new Set(consumers)).toEqual(new Set([prisma]));
  });
});
