import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, writeFileSync } from 'fs';
import { availableParallelism, tmpdir } from 'os';
import { join, relative, resolve } from 'path';
import { Client, ClientConfig } from 'pg';
import { getPgOptions, negotiatePreferredSsl, physicalCpuCount, PrismaService } from './prisma.service';

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

  it('hands out a client of its own, outside the pool, on every call', () => {
    const client = service.dedicatedClient();

    expect(client).toBeInstanceOf(Client);
    expect(service.dedicatedClient()).not.toBe(client);
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
  const noVerify = { rejectUnauthorized: false };
  const writeCa = (content: string) => {
    const ca = join(mkdtempSync(join(tmpdir(), 'vrt-ca-')), 'server-ca.pem');
    writeFileSync(ca, content);
    return ca;
  };

  it('keeps the Prisma 6 pool defaults when the URL sets none', () => {
    expect(getPgOptions(url)).toEqual({
      pool: {
        connectionString: url,
        max: defaultMax,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 300000,
        ssl: noVerify,
      },
      schema: undefined,
      unsupportedParams: [],
      preferSsl: true,
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

  describe('TLS, as Prisma 6 read the URL', () => {
    it.each([
      ['takes sslmode=prefer out of the URL for pg', '?sslmode=prefer&schema=vrt', true, '?schema=vrt'],
      ['insists on TLS under sslmode=require, unchecked', '?sslmode=require', false, ''],
      [
        'drops sslcert without sslaccept=strict (Prisma 6 accepted any certificate)',
        '?sslmode=require&sslcert=a.pem',
        false,
        '',
      ],
    ])('%s', (_, query, preferSsl, remainingQuery) => {
      const { pool, preferSsl: prefer } = getPgOptions(`${url}${query}`);

      expect(prefer).toBe(preferSsl);
      expect(pool.ssl).toEqual(noVerify);
      expect(pool.connectionString).toBe(`${url}${remainingQuery}`);
    });

    it('checks the certificate against the system CAs under sslaccept=strict', () => {
      expect(getPgOptions(`${url}?sslmode=require&sslaccept=strict`).pool.ssl).toEqual({});
    });

    it('checks it against sslcert, the server certificate to Prisma, under sslaccept=strict', () => {
      const ca = writeCa('ca-pem');

      const { pool } = getPgOptions(`${url}?sslmode=require&sslaccept=strict&sslcert=${encodeURIComponent(ca)}`);

      expect(pool.ssl).toEqual({ ca: Buffer.from('ca-pem') });
      expect(pool.connectionString).toBe(url);
    });

    it('resolves a relative sslcert from the prisma/ folder, as Prisma did', () => {
      const ca = writeCa('relative-ca');
      const fromPrismaFolder = relative(resolve('prisma'), ca);

      const { pool } = getPgOptions(`${url}?sslaccept=strict&sslcert=${encodeURIComponent(fromPrismaFolder)}`);

      expect(pool.ssl).toEqual({ ca: Buffer.from('relative-ca') });
    });

    it('connects without TLS under sslmode=disable', () => {
      expect(getPgOptions(`${url}?sslmode=disable`)).toMatchObject({ pool: { ssl: false }, preferSsl: false });
    });

    it.each([
      ['sslrootcert', `${url}?sslmode=require&sslrootcert=/ca.pem`],
      ['uselibpqcompat', `${url}?sslmode=require&uselibpqcompat=true`],
      ['sslmode=verify-full', `${url}?sslmode=verify-full`],
      ['sslmode=verify-ca', `${url}?sslmode=verify-ca`],
    ])('leaves a URL written for pg (%s) to pg as it is', (_, pgUrl) => {
      const { pool, preferSsl } = getPgOptions(pgUrl);

      expect(pool.connectionString).toBe(pgUrl);
      expect(pool).not.toHaveProperty('ssl');
      expect(preferSsl).toBe(false);
    });
  });

  it('reports the Prisma 6 parameters that no longer have an effect', () => {
    expect(
      getPgOptions(`${url}?pgbouncer=true&schema=vrt&socket_timeout=5&sslidentity=id.p12`).unsupportedParams
    ).toEqual(['pgbouncer', 'socket_timeout', 'sslidentity']);
  });

  it('falls back to the defaults for an unparsable or missing URL', () => {
    expect(getPgOptions(undefined).pool.max).toBe(defaultMax);
    expect(getPgOptions('not a url')).toMatchObject({ schema: undefined, unsupportedParams: [], preferSsl: false });
    expect(getPgOptions('not a url').pool).not.toHaveProperty('ssl');
  });
});

describe('negotiatePreferredSsl', () => {
  afterEach(() => jest.restoreAllMocks());

  const stubClient = (connect: () => Promise<void>) => {
    jest.spyOn(Client.prototype, 'connect').mockImplementation(connect);
    return jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);
  };

  const preferringConfig = () => ({ connectionString: 'postgresql://db/vrt', ssl: { rejectUnauthorized: false } });

  it('falls back to plaintext when the server has no TLS', async () => {
    const end = stubClient(() => Promise.reject(new Error('The server does not support SSL connections')));
    const log = jest.fn();
    const config: ClientConfig = preferringConfig();

    await negotiatePreferredSsl(config, { log } as unknown as Logger);

    expect(config.ssl).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('without it'));
    expect(end).toHaveBeenCalled();
  });

  it('keeps TLS when the trial connection succeeds', async () => {
    const end = stubClient(() => Promise.resolve());
    const config = preferringConfig();

    await negotiatePreferredSsl(config);

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(end).toHaveBeenCalled();
  });

  it('fails when the server cannot be reached, so TLS is not settled on a guess', async () => {
    const end = stubClient(() => Promise.reject(new Error('connect ECONNREFUSED 172.18.0.2:5432')));
    const config = preferringConfig();

    await expect(negotiatePreferredSsl(config)).rejects.toThrow('ECONNREFUSED');

    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(end).toHaveBeenCalled();
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

  it('settles TLS before it first connects when the URL prefers it', async () => {
    const end = jest.spyOn(Client.prototype, 'end').mockResolvedValue(undefined as never);
    jest
      .spyOn(Client.prototype, 'connect')
      .mockRejectedValue(new Error('The server does not support SSL connections') as never);
    process.env.DATABASE_URL = 'postgresql://user:secret@db:5432/vrt';
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(end).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect((service as unknown as { pgConfig: { ssl: unknown } }).pgConfig.ssl).toBe(false);
  });

  it('does not try TLS first when the URL settles it', async () => {
    const trial = jest.spyOn(Client.prototype, 'connect');
    process.env.DATABASE_URL = 'postgresql://user:secret@db:5432/vrt?sslmode=disable';
    const service = new PrismaService();
    jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(trial).not.toHaveBeenCalled();
  });

  it('stays quiet for a URL it fully understands', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.env.DATABASE_URL = 'postgresql://user:secret@db:5432/vrt?connection_limit=3';

    new PrismaService();

    expect(warn).not.toHaveBeenCalled();
  });
});
