import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('exposes the PrismaClient API', () => {
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$queryRaw).toBe('function');
    expect(service.user).toBeDefined();
    expect(service.testRun).toBeDefined();
  });

  it('connects when the module initialises', async () => {
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates a connection failure from onModuleInit', async () => {
    jest.spyOn(service, '$connect').mockRejectedValue(new Error('Can not reach database server'));

    await expect(service.onModuleInit()).rejects.toThrow('Can not reach database server');
  });

  it('disconnects when the module is destroyed', async () => {
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
