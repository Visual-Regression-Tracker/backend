import { Test, TestingModule } from '@nestjs/testing';
import { availableParallelism } from 'os';
import { getPgOptions, PrismaService } from './prisma.service';

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

describe('getPgOptions', () => {
  const url = 'postgresql://user:secret@db:5432/vrt';

  it('keeps the Prisma 6 pool defaults when the URL sets none', () => {
    expect(getPgOptions(url)).toEqual({
      pool: { connectionString: url, max: availableParallelism() * 2 + 1, connectionTimeoutMillis: 10000 },
      schema: undefined,
    });
  });

  it('takes the pool size and timeouts from the Prisma URL parameters', () => {
    const tuned = `${url}?connection_limit=4&connect_timeout=20&pool_timeout=3`;

    expect(getPgOptions(tuned).pool).toEqual({ connectionString: tuned, max: 4, connectionTimeoutMillis: 20000 });
  });

  it('turns a zero timeout into no timeout, as Prisma 6 did', () => {
    expect(getPgOptions(`${url}?connect_timeout=0&pool_timeout=0`).pool.connectionTimeoutMillis).toBeUndefined();
  });

  it('passes the schema parameter on to the adapter', () => {
    expect(getPgOptions(`${url}?schema=vrt`).schema).toBe('vrt');
  });

  it('falls back to the defaults for an unparsable or missing URL', () => {
    expect(getPgOptions(undefined).pool.max).toBe(availableParallelism() * 2 + 1);
    expect(getPgOptions('not a url').schema).toBeUndefined();
  });
});
