import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { availableParallelism } from 'os';
import { getPgOptions, physicalCpuCount, PrismaService } from './prisma.service';

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

    await service.onApplicationShutdown();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('physicalCpuCount', () => {
  const processor = (id: number, physicalId: number, coreId: number) =>
    `processor\t: ${id}\nmodel name\t: x86\nphysical id\t: ${physicalId}\ncore id\t\t: ${coreId}\n`;

  it('counts each physical core once, however many hyper-threads it runs', () => {
    // two sockets, two cores each, two threads per core
    const cpuinfo = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((id) => processor(id, Math.floor(id / 4), Math.floor(id / 2) % 2))
      .join('\n');

    expect(physicalCpuCount(cpuinfo)).toBe(4);
  });

  it('tells apart cores with the same id on different sockets', () => {
    expect(physicalCpuCount([processor(0, 0, 0), processor(1, 1, 0)].join('\n'))).toBe(2);
  });

  it.each([
    [
      'cpuinfo without physical/core ids (ARM)',
      'processor\t: 0\nBogoMIPS\t: 48.00\n\nprocessor\t: 1\nBogoMIPS\t: 48.00\n',
    ],
    ['no cpuinfo at all (macOS)', ''],
  ])('falls back to the logical count for %s', (_, cpuinfo) => {
    expect(physicalCpuCount(cpuinfo)).toBe(availableParallelism());
  });
});

describe('getPgOptions', () => {
  const url = 'postgresql://user:secret@db:5432/vrt';
  const defaultMax = physicalCpuCount() * 2 + 1;

  it('keeps the Prisma 6 pool defaults when the URL sets none', () => {
    expect(getPgOptions(url)).toEqual({
      pool: { connectionString: url, max: defaultMax, connectionTimeoutMillis: 10000, idleTimeoutMillis: 300000 },
      schema: undefined,
      unsupportedParams: [],
    });
  });

  it('takes the pool size and timeouts from the Prisma URL parameters', () => {
    const tuned = `${url}?connection_limit=4&connect_timeout=20&pool_timeout=3`;

    expect(getPgOptions(tuned).pool).toMatchObject({ connectionString: tuned, max: 4, connectionTimeoutMillis: 20000 });
  });

  it.each([
    ['pool_timeout=0', 'waits for a free connection without limit'],
    ['connect_timeout=0', 'opens a connection without limit'],
    ['connect_timeout=0&pool_timeout=0', 'has no timeout at all'],
  ])('sets no timeout when %s, as Prisma 6 then %s', (query) => {
    expect(getPgOptions(`${url}?${query}`).pool.connectionTimeoutMillis).toBeUndefined();
  });

  it('falls back to the default for a timeout that is not a number of seconds', () => {
    expect(getPgOptions(`${url}?pool_timeout=-1&connect_timeout=soon`).pool.connectionTimeoutMillis).toBe(10000);
  });

  it('passes the schema parameter on to the adapter', () => {
    expect(getPgOptions(`${url}?schema=vrt`).schema).toBe('vrt');
  });

  it.each(['require', 'prefer'])(
    'encrypts without verifying the certificate under sslmode=%s, as Prisma 6 did by default',
    (sslmode) => {
      const { connectionString } = getPgOptions(`${url}?sslmode=${sslmode}`).pool;

      expect(new URL(connectionString).searchParams.get('uselibpqcompat')).toBe('true');
      expect(new URL(connectionString).searchParams.get('sslmode')).toBe(sslmode);
    }
  );

  it.each([
    ['sslaccept=strict asks for verification', `${url}?sslmode=require&sslaccept=strict`],
    ['verify-full always verifies', `${url}?sslmode=verify-full`],
    ['TLS is not asked for', url],
    ['the URL already chooses the libpq semantics', `${url}?sslmode=require&uselibpqcompat=false`],
  ])('leaves certificate checks to pg when %s', (_, databaseUrl) => {
    expect(getPgOptions(databaseUrl).pool.connectionString).toBe(databaseUrl);
  });

  it('reports the Prisma 6 parameters that no longer have an effect', () => {
    expect(getPgOptions(`${url}?pgbouncer=true&schema=vrt&socket_timeout=5&sslcert=ca.pem`).unsupportedParams).toEqual([
      'pgbouncer',
      'socket_timeout',
      'sslcert',
    ]);
  });

  it('falls back to the defaults for an unparsable or missing URL', () => {
    expect(getPgOptions(undefined).pool.max).toBe(defaultMax);
    expect(getPgOptions('not a url')).toMatchObject({ schema: undefined, unsupportedParams: [] });
  });
});

describe('PrismaService construction', () => {
  const databaseUrl = process.env.DATABASE_URL;
  afterEach(() => {
    process.env.DATABASE_URL = databaseUrl;
    jest.restoreAllMocks();
  });

  it('warns about DATABASE_URL parameters it ignores', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.env.DATABASE_URL = 'postgresql://user:secret@db:5432/vrt?pgbouncer=true';

    new PrismaService();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignored since Prisma 7: pgbouncer'));
  });

  it('stays quiet for a URL it fully understands', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.env.DATABASE_URL = 'postgresql://user:secret@db:5432/vrt?connection_limit=3';

    new PrismaService();

    expect(warn).not.toHaveBeenCalled();
  });
});
