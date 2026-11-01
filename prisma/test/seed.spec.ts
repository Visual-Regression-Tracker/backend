import { compareSync } from 'bcryptjs';

import { createDefaultProject, createDefaultUser, generateApiKey, seed } from '../seed';
import { prismaMock } from './client.mock';

const mockDefaultProject = {
  id: '09',
  name: 'Default project',
  mainBranchName: 'main',
  buildsCounter: 0,
  maxBuildAllowed: 100,
  maxBranchLifetime: 30,
  updatedAt: new Date(),
  createdAt: new Date(),
  autoApproveFeature: true,
  imageComparison: 'pixelmatch',
  imageComparisonConfig: '{ "threshold": 0.1, "ignoreAntialiasing": true, "allowDiffDimensions": false }',
  bulkApproveVariations: false,
  bulkApproveGroupBy: 'customTags',
} as const;

const mockDefaultUser = {
  id: '0',
  email: 'visual-regression-tracker@example.com',
  firstName: 'fname',
  lastName: 'lname',
  role: 'admin',
  apiKey: 'DEFAULTUSERAPIKEYTOBECHANGED',
  password: 'password.hashed',
  isActive: true,
  updatedAt: new Date(),
  createdAt: new Date(),
} as const;

const API_KEY_FORMAT = /^[0-9A-HJKMNP-TV-Z]{28}$/;

const ENV_KEYS = ['DEFAULT_USER_EMAIL', 'DEFAULT_USER_PASSWORD', 'DEFAULT_USER_API_KEY'] as const;

describe('seed', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    log = jest.spyOn(console, 'log').mockImplementation();
    warn = jest.spyOn(console, 'warn').mockImplementation();
    prismaMock.user.create.mockResolvedValue(mockDefaultUser);
    prismaMock.project.create.mockResolvedValue(mockDefaultProject);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    log.mockRestore();
    warn.mockRestore();
  });

  const noAdmin = (existing: object | null = null) => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(existing as never);
  };

  const loggedText = () => JSON.stringify([...log.mock.calls, ...warn.mock.calls]);

  describe('seed()', () => {
    test('creates the default user and project in an empty database', async () => {
      noAdmin();
      prismaMock.project.count.mockResolvedValue(0);

      await seed();

      expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.project.create).toHaveBeenCalledTimes(1);
    });

    test('rejects when the database cannot be read', async () => {
      prismaMock.user.findFirst.mockRejectedValue(new Error('"user" table does not exist'));
      prismaMock.project.count.mockRejectedValue(new Error('"project" table does not exist'));

      await expect(seed()).rejects.toThrow();
    });
  });

  describe('createDefaultUser', () => {
    test('active admin exists: nothing is created or changed', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ id: 'admin' } as never);

      await createDefaultUser();

      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });

    test('never logs user rows, password hashes or api keys of existing users', async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: 'admin',
        apiKey: 'EXISTINGKEY',
        password: 'hash',
      } as never);

      await createDefaultUser();

      expect(loggedText()).not.toContain('EXISTINGKEY');
      expect(loggedText()).not.toContain('hash');
    });

    test('fresh database with env values: uses them and does not print the password or key', async () => {
      process.env.DEFAULT_USER_EMAIL = 'admin@corp.test';
      process.env.DEFAULT_USER_PASSWORD = 'env-password-value';
      process.env.DEFAULT_USER_API_KEY = 'ENVAPIKEYVALUE';
      noAdmin();

      await createDefaultUser();

      expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
      const { data } = prismaMock.user.create.mock.calls[0][0];
      expect(data.email).toBe('admin@corp.test');
      expect(data.role).toBe('admin');
      expect(data.apiKey).toBe('ENVAPIKEYVALUE');
      expect(compareSync('env-password-value', data.password)).toBe(true);
      expect(loggedText()).not.toContain('env-password-value');
      expect(loggedText()).not.toContain('ENVAPIKEYVALUE');
    });

    test('fresh database without env values: generates the secrets and prints each exactly once', async () => {
      noAdmin();

      await createDefaultUser();

      const { data } = prismaMock.user.create.mock.calls[0][0];
      expect(data.email).toBe('visual-regression-tracker@example.com');
      expect(data.apiKey).toMatch(API_KEY_FORMAT);
      const printed = log.mock.calls.map((args) => args.join(' '));
      const passwordLine = printed.find((line) => line.startsWith('Password (generated, shown once): '));
      const password = passwordLine?.replace('Password (generated, shown once): ', '');
      expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(compareSync(password as string, data.password)).toBe(true);
      expect(printed.filter((line) => line.includes(password as string))).toHaveLength(1);
      expect(printed.filter((line) => line.includes(data.apiKey))).toHaveLength(1);
    });

    test('empty env values count as unset', async () => {
      process.env.DEFAULT_USER_EMAIL = '';
      process.env.DEFAULT_USER_PASSWORD = '';
      process.env.DEFAULT_USER_API_KEY = '';
      noAdmin();

      await createDefaultUser();

      const { data } = prismaMock.user.create.mock.calls[0][0];
      expect(data.email).toBe('visual-regression-tracker@example.com');
      expect(data.apiKey).toMatch(API_KEY_FORMAT);
      expect(compareSync('', data.password)).toBe(false);
      expect(loggedText()).toContain('generated, shown once');
    });

    test('no active admin, email taken by an editor: not promoted', async () => {
      noAdmin({ role: 'editor', isActive: true });

      await createDefaultUser();

      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.user.upsert).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    test('warns about the public defaults', async () => {
      process.env.DEFAULT_USER_PASSWORD = '123456';
      noAdmin();

      await createDefaultUser();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('publicly known default'));
    });

    test('does not warn about values that are not the public defaults', async () => {
      process.env.DEFAULT_USER_PASSWORD = 'something-private';
      noAdmin();

      await createDefaultUser();

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('createDefaultProject', () => {
    test('creates it when there are no projects', async () => {
      prismaMock.project.count.mockResolvedValue(0);

      await createDefaultProject();

      expect(prismaMock.project.create).toHaveBeenCalledTimes(1);
    });

    test('does nothing when a project exists', async () => {
      prismaMock.project.count.mockResolvedValue(1);

      await createDefaultProject();

      expect(prismaMock.project.create).not.toHaveBeenCalled();
    });
  });

  describe('generateApiKey', () => {
    test('has the format of the API keys generated by the backend', () => {
      expect(generateApiKey()).toMatch(API_KEY_FORMAT);
    });

    test('differs between calls', () => {
      expect(generateApiKey()).not.toBe(generateApiKey());
    });
  });
});
