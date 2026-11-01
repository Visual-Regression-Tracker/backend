import { randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { genSalt, hash } from 'bcryptjs';

import prisma, { prepareConnection } from './client';

const DEFAULT_EMAIL = 'visual-regression-tracker@example.com';
const PUBLIC_DEFAULT_PASSWORD = '123456';
const PUBLIC_DEFAULT_API_KEY = 'DEFAULTUSERAPIKEYTOBECHANGED';
const CROCKFORD_DIGITS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export async function seed() {
  await prepareConnection();
  await prisma.$connect();
  console.log('Seeding default data...');
  await Promise.all([createDefaultUser(), createDefaultProject()]);
  await prisma.$disconnect();
}

if (require.main === module) {
  seed()
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

// same format as src/utils/random-key.ts; this package cannot import from src/
export function generateApiKey(): string {
  let key = '';
  for (const byte of randomBytes(28)) {
    key += CROCKFORD_DIGITS[byte & 31];
  }
  return key;
}

export async function createDefaultUser(): Promise<void> {
  const activeAdmin = await prisma.user.findFirst({
    where: { role: Role.admin, isActive: true },
    select: { id: true },
  });
  if (activeAdmin) {
    return;
  }
  const email = process.env.DEFAULT_USER_EMAIL?.trim() || DEFAULT_EMAIL;
  const existing = await prisma.user.findUnique({ where: { email }, select: { role: true, isActive: true } });
  if (existing) {
    // promoting it would hand admin to whoever registered this email
    console.warn(
      `No active admin exists, and ${email} is already a ${existing.isActive ? '' : 'deactivated '}${existing.role}; ` +
        'it is not promoted. Give a user the admin role in the database.'
    );
    return;
  }
  // an empty variable (compose passes unset ones as '') counts as not set
  const passwordFromEnv = process.env.DEFAULT_USER_PASSWORD || undefined;
  const apiKeyFromEnv = process.env.DEFAULT_USER_API_KEY?.trim() || undefined;
  const password = passwordFromEnv ?? randomBytes(18).toString('base64url');
  const apiKey = apiKeyFromEnv ?? generateApiKey();

  await prisma.user.create({
    data: {
      email,
      firstName: 'fname',
      lastName: 'lname',
      role: Role.admin,
      apiKey,
      password: await hash(password, await genSalt(10)),
    },
  });

  console.log('###########################');
  console.log('####### DEFAULT USER ######');
  console.log('###########################');
  console.log(`Created admin ${email}`);
  console.log(
    passwordFromEnv ? 'Password: from DEFAULT_USER_PASSWORD' : `Password (generated, shown once): ${password}`
  );
  console.log(apiKeyFromEnv ? 'API key: from DEFAULT_USER_API_KEY' : `API key (generated, shown once): ${apiKey}`);
  if (passwordFromEnv === PUBLIC_DEFAULT_PASSWORD || apiKeyFromEnv === PUBLIC_DEFAULT_API_KEY) {
    console.warn('The password or API key is the publicly known default: change both after the first login.');
  }
}

export async function createDefaultProject(): Promise<void> {
  if ((await prisma.project.count()) > 0) {
    return;
  }
  const project = await prisma.project.create({ data: { name: 'Default project' } });
  console.log(`Created the default project "${project.name}" (${project.id}), main branch ${project.mainBranchName}`);
}
