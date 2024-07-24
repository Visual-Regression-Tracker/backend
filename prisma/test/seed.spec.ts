/**
 * @see https://www.prisma.io/docs/orm/prisma-client/testing/unit-testing
 */
import { seed } from '../seed';
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

describe('Defaults get created', () => {
  beforeEach(() => {
    prismaMock.user.upsert.mockResolvedValue(mockDefaultUser);
    prismaMock.project.create.mockResolvedValue(mockDefaultProject);
  });
  test('Default user and project are created for empty database', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.project.findMany.mockResolvedValue([]);

    await seed();

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.project.create).toHaveBeenCalled();
  });

  test('Default user and project are created on error', async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error('"user" table does not exist'));
    prismaMock.project.findMany.mockRejectedValue(new Error('"project" table does not exist'));

    await seed();

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.project.create).toHaveBeenCalled();
  });

  test('Default user is create if NO admin user exists', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ ...mockDefaultUser, email: 'foo@bar.com', role: 'editor' }]);
    prismaMock.project.findMany.mockResolvedValue([]);

    await seed();

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.project.create).toHaveBeenCalled();
  });

  test('Default user is create if the only admin user is inActive', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ ...mockDefaultUser, email: 'foo@bar.com', isActive: false }]);
    prismaMock.project.findMany.mockResolvedValue([]);

    await seed();

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.project.create).toHaveBeenCalled();
  });
});

describe('Defaults do NOT get created', () => {
  beforeEach(() => {
    prismaMock.user.upsert.mockResolvedValue(mockDefaultUser);
    prismaMock.project.create.mockResolvedValue(mockDefaultProject);
  });
  test('Default project is NOT create if any project exists', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.project.findMany.mockResolvedValue([mockDefaultProject]);

    await seed();

    expect(prismaMock.user.upsert).toHaveBeenCalled();
    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  test('Default user is NOT create if any active admin user exists', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ ...mockDefaultUser, email: 'foo@bar.com' }]);
    prismaMock.project.findMany.mockResolvedValue([]);

    await seed();

    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    expect(prismaMock.project.create).toHaveBeenCalled();
  });
});
