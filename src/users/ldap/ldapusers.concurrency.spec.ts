import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import { Client as LdapClient } from 'ldapts';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LdapUsersService } from './ldapusers.service';

const mockClients: { generation: number; unbind: jest.Mock }[] = [];

jest.mock('ldapts', () => ({
  Client: jest.fn(() => {
    const client = {
      generation: 0,
      bind: jest.fn(async () => {
        const started = client.generation;
        await new Promise(setImmediate);
        if (client.generation !== started) {
          throw new Error('socket closed');
        }
      }),
      search: jest.fn(async () => {
        const started = client.generation;
        await new Promise(setImmediate);
        if (client.generation !== started) {
          throw new Error('socket closed');
        }
        return {
          searchEntries: [
            {
              dn: 'uid=jane,ou=people',
              LDAP_ATTRIBUTE_MAIL: 'jane@example.com',
              LDAP_ATTRIBUTE_FIRST_NAME: 'Jane',
              LDAP_ATTRIBUTE_LAST_NAME: 'Roe',
            },
          ],
          searchReferences: [],
        };
      }),
      unbind: jest.fn(async () => {
        client.generation++;
      }),
    };
    mockClients.push(client);
    return client;
  }),
}));

const user: User = {
  id: '1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Roe',
  apiKey: 'key',
  password: 'hash',
  isActive: true,
  role: Role.editor,
  updatedAt: new Date(),
  createdAt: new Date(),
};

describe('LdapUsersService concurrent logins', () => {
  let service: LdapUsersService;

  beforeEach(() => {
    mockClients.length = 0;
    (LdapClient as unknown as jest.Mock).mockClear();
    const configService = {
      get: jest.fn((_key: string, defaultValue?: string) => defaultValue),
      getOrThrow: jest.fn((key: string) => (key === 'LDAP_USERS_SEARCH_FILTER' ? '(mail={{email}})' : key)),
    };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const auth = { signToken: jest.fn().mockReturnValue('token') };
    service = new LdapUsersService(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
      auth as unknown as AuthService
    );
  });

  it("serves two concurrent logins without one closing the other's connection", async () => {
    await expect(
      Promise.all([
        service.login({ email: 'jane@example.com', password: 'a' }),
        service.login({ email: 'jane@example.com', password: 'b' }),
      ])
    ).resolves.toHaveLength(2);
  });

  it('opens a connection for the search and one for the user bind, and closes each', async () => {
    await Promise.all([
      service.login({ email: 'jane@example.com', password: 'a' }),
      service.login({ email: 'jane@example.com', password: 'b' }),
    ]);

    expect(LdapClient).toHaveBeenCalledTimes(4);
    for (const client of mockClients) {
      expect(client.unbind).toHaveBeenCalledTimes(1);
    }
  });
});
