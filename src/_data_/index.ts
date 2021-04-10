import { Project } from '@prisma/client';

export const TEST_PROJECT: Project = {
  id: '1',
  name: 'Test Project',
  buildsCounter: 2,
  mainBranchName: 'master',
  createdAt: new Date(),
  updatedAt: new Date(),
};
