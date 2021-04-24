import { Build, Project } from '@prisma/client';

export const TEST_PROJECT: Project = {
  id: '1',
  name: 'Test Project',
  buildsCounter: 2,
  mainBranchName: 'master',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const TEST_BUILD: Build = {
  id: 'a9385fc1-884d-4f9f-915e-40da0e7773d5',
  ciBuildId: 'ciBuildId',
  number: 2345,
  branchName: 'develop',
  status: 'new',
  projectId: 'e0a37894-6f29-478d-b13e-6182fecc715e',
  updatedAt: new Date(),
  createdAt: new Date(),
  userId: '2341235',
  isRunning: true,
};
