import { PrismaClient } from '@prisma/client';
import uuidAPIKey from 'uuid-apikey';
import { genSalt, hash } from 'bcryptjs';

const prisma = new PrismaClient({
  // log: ['query'],
});

async function seed() {
  await prisma.connect();
  console.log('Seeding default data...');
  await Promise.all([createDefaultUser(), createDefaultProject()]);
  await prisma.disconnect();
}

seed()
  .catch((e) => console.error('e', e))
  .finally(async () => await prisma.disconnect());

async function createDefaultUser() {
  const userList = await prisma.user.findMany();
  console.log(userList);
  if (userList.length === 0) {
    const defaultEmail = 'visual-regression-tracker@example.com';
    const defaultPassword = '123456';
    const salt = await genSalt(10);
    await prisma.user
      .create({
        data: {
          email: defaultEmail,
          firstName: 'fname',
          lastName: 'lname',
          apiKey: uuidAPIKey.create({ noDashes: true }).apiKey,
          password: await hash(defaultPassword, salt),
        },
      })
      .then((user) => {
        console.log('###########################');
        console.log('## CREATING DEFAULT USER ##');
        console.log('###########################');
        console.log('');
        console.log(`The user with the email "${defaultEmail}" and password "${defaultPassword}" was created`);
        console.log(`The Api key is: ${user.apiKey}`);
      });
  }
}

async function createDefaultProject() {
  const projectList = await prisma.project.findMany();
  console.log(projectList);
  if (projectList.length === 0) {
    await prisma.project
      .create({
        data: {
          name: 'Default project',
        },
      })
      .then((project) => {
        console.log('##############################');
        console.log('## CREATING DEFAULT PROJECT ##');
        console.log('##############################');
        console.log('');
        console.log(`Project key: ${project.id}`);
        console.log(`Project name ${project.name}`);
        console.log(`Project name ${project.mainBranchName}`);
      });
  }
}
