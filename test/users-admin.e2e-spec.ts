import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Role, TestStatus } from '@prisma/client';
import request from 'supertest';
import { createHash, generateKeyPairSync, KeyObject, randomUUID, sign } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import uuidAPIKey from 'uuid-apikey';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';
import { BuildsService } from '../src/builds/builds.service';
import { TestRunsService } from '../src/test-runs/test-runs.service';
import { TEST_PROJECT } from '../src/_data_';
import { UserDto } from '../src/users/dto/user.dto';
import {
  generateUser,
  haveTestRunCreated,
  haveUserLogged,
  requestWithApiKey,
  requestWithAuth,
  LoggedUser,
} from './preconditions';

const FORBIDDEN = 'You do not have permission to perform this operation.';

describe('Users admin and RBAC (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let prismaService: PrismaService;
  const userIds: string[] = [];

  const haveUser = async (role: Role): Promise<LoggedUser> => {
    const user = await haveUserLogged(usersService, role);
    userIds.push(user.id);
    return user;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    usersService = moduleFixture.get(UsersService);
    prismaService = moduleFixture.get(PrismaService);
    await app.init();
  });

  afterEach(async () => {
    // some tests delete their users through the API already
    await prismaService.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users/me', () => {
    it('401 without a token', () => request(app.getHttpServer()).get('/users/me').expect(401));

    it.each([Role.admin, Role.editor, Role.guest])('returns the current %s without the password', async (role) => {
      const user = await haveUser(role);

      const res = await requestWithAuth(app, 'get', '/users/me', user.token).expect(200);

      expect(res.body).toEqual({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        apiKey: user.apiKey,
        role,
      });
    });
  });

  describe('GET /users/all', () => {
    it('401 without a token', () => request(app.getHttpServer()).get('/users/all').expect(401));

    it('401 with an admin api key only: the list needs a JWT', async () => {
      const admin = await haveUser(Role.admin);

      await requestWithApiKey(app, 'get', '/users/all', admin.apiKey).expect(401);
    });

    it.each([Role.editor, Role.guest])('403 for %s', async (role) => {
      const user = await haveUser(role);

      await requestWithAuth(app, 'get', '/users/all', user.token)
        .expect(403)
        .expect((res) => expect(res.body.message).toBe(FORBIDDEN));
    });

    it('200 for admin, listing every user without passwords', async () => {
      const admin = await haveUser(Role.admin);
      const guest = await haveUser(Role.guest);

      const res = await requestWithAuth(app, 'get', '/users/all', admin.token).expect(200);

      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: admin.id, email: admin.email, role: Role.admin }),
          {
            id: guest.id,
            email: guest.email,
            firstName: 'fName',
            lastName: 'lName',
            apiKey: guest.apiKey,
            role: 'guest',
          },
        ])
      );
      expect(res.body.every((user: UserDto) => !('password' in user))).toBe(true);
    });
  });

  describe('PATCH /users/assignRole', () => {
    it.each([Role.editor, Role.guest])('403 for %s, the role stays', async (role) => {
      const user = await haveUser(role);
      const target = await haveUser(Role.guest);

      await requestWithAuth(app, 'patch', '/users/assignRole', user.token)
        .send({ id: target.id, role: Role.admin })
        .expect(403);

      expect((await usersService.findOne(target.id))!.role).toBe(Role.guest);
    });

    it('admin changes the role, which takes effect on the next request with the same token', async () => {
      const admin = await haveUser(Role.admin);
      const target = await haveUser(Role.guest);
      await requestWithAuth(app, 'get', '/users/all', target.token).expect(403);

      const res = await requestWithAuth(app, 'patch', '/users/assignRole', admin.token)
        .send({ id: target.id, role: Role.admin })
        .expect(200);

      expect(res.body).toEqual(expect.objectContaining({ id: target.id, email: target.email, role: Role.admin }));
      expect((await usersService.findOne(target.id))!.role).toBe(Role.admin);
      // the role is read from the database on every request, not from the token
      await requestWithAuth(app, 'get', '/users/all', target.token).expect(200);
    });

    it('admin can demote itself and loses access right away', async () => {
      const admin = await haveUser(Role.admin);

      await requestWithAuth(app, 'patch', '/users/assignRole', admin.token)
        .send({ id: admin.id, role: Role.editor })
        .expect(200);

      await requestWithAuth(app, 'get', '/users/all', admin.token).expect(403);
    });

    it.each([
      ['an unknown role', { role: 'owner' }],
      ['an id that is not a UUID', { id: 'not-a-uuid' }],
    ])('400 for %s', async (_, override) => {
      const admin = await haveUser(Role.admin);
      const target = await haveUser(Role.guest);

      await requestWithAuth(app, 'patch', '/users/assignRole', admin.token)
        .send({ id: target.id, role: Role.editor, ...override })
        .expect(400);

      expect((await usersService.findOne(target.id))!.role).toBe(Role.guest);
    });

    it('404 for a user that does not exist', async () => {
      const admin = await haveUser(Role.admin);

      await requestWithAuth(app, 'patch', '/users/assignRole', admin.token)
        .send({ id: randomUUID(), role: Role.editor })
        .expect(404);
    });
  });

  describe('DELETE /users', () => {
    it.each([Role.editor, Role.guest])('403 for %s, nobody is deleted', async (role) => {
      const user = await haveUser(role);
      const target = await haveUser(Role.guest);

      await requestWithAuth(app, 'delete', '/users', user.token).send([target.id]).expect(403);

      expect(await usersService.findOne(target.id)).not.toBeNull();
    });

    it('admin deletes several users; their tokens stop working', async () => {
      const admin = await haveUser(Role.admin);
      const editor = await haveUser(Role.editor);
      const guest = await haveUser(Role.guest);

      await requestWithAuth(app, 'delete', '/users', admin.token).send([editor.id, guest.id]).expect(200);

      expect(await prismaService.user.findMany({ where: { id: { in: [editor.id, guest.id] } } })).toEqual([]);
      await requestWithAuth(app, 'get', '/users/me', editor.token).expect(401);
      await requestWithApiKey(app, 'post', '/builds', guest.apiKey).send({}).expect(403);
      await requestWithAuth(app, 'get', '/users/me', admin.token).expect(200);
    });

    it('admin can delete itself', async () => {
      const admin = await haveUser(Role.admin);

      await requestWithAuth(app, 'delete', '/users', admin.token).send([admin.id]).expect(200);

      await requestWithAuth(app, 'get', '/users/me', admin.token).expect(401);
    });

    it('404 for an unknown id, deleting nobody', async () => {
      const admin = await haveUser(Role.admin);
      const first = await haveUser(Role.guest);
      const last = await haveUser(Role.guest);
      const unknown = randomUUID();

      const res = await requestWithAuth(app, 'delete', '/users', admin.token)
        .send([first.id, unknown, last.id])
        .expect(404);

      expect(res.body.message).toBe(`User not found: ${unknown}`);
      expect(await usersService.findOne(first.id)).not.toBeNull();
      expect(await usersService.findOne(last.id)).not.toBeNull();
    });

    it('deletes every listed user', async () => {
      const admin = await haveUser(Role.admin);
      const first = await haveUser(Role.guest);
      const last = await haveUser(Role.editor);

      await requestWithAuth(app, 'delete', '/users', admin.token).send([first.id, last.id]).expect(200);

      expect(await usersService.findOne(first.id)).toBeNull();
      expect(await usersService.findOne(last.id)).toBeNull();
    });

    it('keeps the baselines a deleted user approved, without the user', async () => {
      const admin = await haveUser(Role.admin);
      const editor = await haveUser(Role.editor);
      const projectsService = app.get(ProjectsService);
      const project = await projectsService.create({
        ...TEST_PROJECT,
        name: `Users admin E2E ${uuidAPIKey.create().uuid}`,
      });
      try {
        const { testRun } = await haveTestRunCreated(
          app.get(BuildsService),
          app.get(TestRunsService),
          project.id,
          project.mainBranchName,
          './test/image.png'
        );
        await requestWithAuth(app, 'post', '/test-runs/approve?merge=false', editor.token)
          .send([testRun.id])
          .expect(201);
        const [baseline] = await prismaService.baseline.findMany({ where: { testRunId: testRun.id } });
        expect(baseline.userId).toBe(editor.id);

        await requestWithAuth(app, 'delete', '/users', admin.token).send([editor.id]).expect(200);

        const after = (await prismaService.baseline.findUnique({ where: { id: baseline.id } }))!;
        expect(after.userId).toBeNull();
        expect((await prismaService.testRun.findUnique({ where: { id: testRun.id } }))!.status).toBe(
          TestStatus.approved
        );
      } finally {
        await projectsService.remove(project.id);
      }
    });
  });

  describe('OIDC disabled (default DB users)', () => {
    it('GET /users/oidc/enabled is false', () =>
      request(app.getHttpServer())
        .get('/users/oidc/enabled')
        .expect(200)
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect((res) => expect(res.body).toBe(false)));

    it.each(['/users/oidc/login', '/users/oidc/callback?code=abc&state=xyz'])('GET %s is 404', (url) =>
      request(app.getHttpServer()).get(url).expect(404).expect('OIDC is not enabled.')
    );
  });
});

/**
 * OIDC needs an identity provider. Instead of a real one, a minimal in-process
 * provider serves discovery, JWKS and the token endpoint on 127.0.0.1, signs ID
 * tokens with an RSA key generated for the run and checks PKCE. The app runs
 * with the real UsersFactoryService/OidcUsersService and openid-client,
 * switched to OIDC through the same environment variables as in production.
 * The browser's visit to the provider's authorization page is simulated: the
 * test reads state and code_challenge from the redirect and registers a code.
 */
describe('Users OIDC (e2e)', () => {
  const CLIENT_ID = 'vrt-e2e';
  const CLIENT_SECRET = 'e2e-secret';
  const REDIRECT_URI = 'http://localhost:4200/users/oidc/callback';
  const FRONTEND_LOGIN = 'http://localhost:8080/login';
  const OIDC_ENV = ['OIDC_ENABLED', 'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'];

  let app: INestApplication;
  let prismaService: PrismaService;
  let idp: Server;
  let issuer: string;
  let privateKey: KeyObject;
  let discoveryDown = false;
  const tokenRequests: URLSearchParams[] = [];
  const codes = new Map<string, { challenge: string | null; claims: Record<string, unknown> }>();
  const emails: string[] = [];
  const previousEnv: Record<string, string | undefined> = {};

  const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

  const signIdToken = (claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'e2e' }));
    const payload = base64url(
      JSON.stringify({ iss: issuer, aud: CLIENT_ID, sub: randomUUID(), iat: now, exp: now + 300, ...claims })
    );
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey);
    return `${header}.${payload}.${base64url(signature)}`;
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });

  beforeAll(async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keys.privateKey;
    const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'e2e', alg: 'RS256', use: 'sig' };

    idp = createServer(async (req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/.well-known/openid-configuration') {
        if (discoveryDown) {
          return send(503, { error: 'unavailable' });
        }
        return send(200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      }
      if (req.url === '/jwks') {
        return send(200, { keys: [jwk] });
      }
      if (req.url === '/token' && req.method === 'POST') {
        const params = new URLSearchParams(await readBody(req));
        tokenRequests.push(params);
        const issued = codes.get(params.get('code') ?? '');
        codes.delete(params.get('code') ?? '');
        const challenge = base64url(
          createHash('sha256')
            .update(params.get('code_verifier') ?? '')
            .digest()
        );
        const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
        if (!issued || issued.challenge !== challenge || req.headers.authorization !== basic) {
          return send(400, { error: 'invalid_grant' });
        }
        return send(200, {
          access_token: randomUUID(),
          token_type: 'Bearer',
          expires_in: 300,
          id_token: signIdToken(issued.claims),
        });
      }
      send(404, { error: 'not_found' });
    });
    await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve));
    issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`;

    const env: Record<string, string> = {
      OIDC_ENABLED: 'true',
      OIDC_ISSUER_URL: issuer,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_REDIRECT_URI: REDIRECT_URI,
    };
    for (const key of OIDC_ENV) {
      previousEnv[key] = process.env[key];
      process.env[key] = env[key];
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    prismaService = moduleFixture.get(PrismaService);
    await app.init();
  });

  afterEach(async () => {
    discoveryDown = false;
    tokenRequests.splice(0);
    codes.clear();
    await prismaService.user.deleteMany({ where: { email: { in: emails.splice(0) } } });
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => idp.close(resolve));
    for (const key of OIDC_ENV) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  });

  const newEmail = () => {
    const email = `oidc+${uuidAPIKey.create().apiKey.toLowerCase()}@example.com`;
    emails.push(email);
    return email;
  };

  // GET /users/oidc/login, then the "browser" at the provider: returns what the callback needs
  const startLogin = async (claims: Record<string, unknown>) => {
    const res = await request(app.getHttpServer()).get('/users/oidc/login').expect(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(`${issuer}/authorize`);
    const state = location.searchParams.get('state');
    const code = randomUUID();
    codes.set(code, { challenge: location.searchParams.get('code_challenge'), claims });
    const [cookie] = res.headers['set-cookie'] as unknown as string[];
    return { state, code, cookie: cookie.split(';')[0], location, setCookie: cookie };
  };

  const callback = (query: string, cookie?: string) => {
    const req = request(app.getHttpServer()).get(`/users/oidc/callback?${query}`);
    if (cookie) {
      req.set('Cookie', cookie);
    }
    return req.expect(302);
  };

  const tokenFrom = (location: string): string => {
    expect(location.startsWith(`${FRONTEND_LOGIN}#token=`)).toBe(true);
    return decodeURIComponent(location.slice(`${FRONTEND_LOGIN}#token=`.length));
  };

  // first on purpose: openid-client's discovery result is cached once it succeeds
  it('GET /users/oidc/login sends the browser back to the login page when discovery fails', async () => {
    discoveryDown = true;

    await request(app.getHttpServer())
      .get('/users/oidc/login')
      .expect(302)
      .expect('Location', `${FRONTEND_LOGIN}#error=oidc_login_failed`)
      .expect((res) => expect(res.headers['set-cookie']).toBeUndefined());
  });

  it('GET /users/oidc/enabled is true', () =>
    request(app.getHttpServer())
      .get('/users/oidc/enabled')
      .expect(200)
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect((res) => expect(res.body).toBe(true)));

  it('GET /users/oidc/login redirects to the provider with PKCE and keeps state in a cookie', async () => {
    const { state, location, setCookie } = await startLogin({});

    expect(Object.fromEntries(location.searchParams)).toEqual({
      client_id: CLIENT_ID,
      scope: 'openid profile email',
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      state,
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: 'S256',
    });
    expect(setCookie).toMatch(
      new RegExp(`^oidc_state=${state}\\.[\\w-]+; Max-Age=600; Path=/; Expires=.+; HttpOnly; SameSite=Lax$`)
    );
  });

  it('first login creates the user with the role from the groups claim and signs them in', async () => {
    const email = newEmail();
    const { state, code, cookie } = await startLogin({
      email: email.toUpperCase(),
      email_verified: true,
      given_name: 'Ada',
      family_name: 'Lovelace',
      groups: ['staff', 'VRT-Admin'],
    });

    // other cookies of the site travel along with the state cookie
    const res = await callback(`code=${code}&state=${state}`, `theme=dark; ${cookie}; lang=en`);

    const token = tokenFrom(res.headers.location);
    expect(res.headers['set-cookie']).toEqual([
      expect.stringMatching(/^oidc_state=; Path=\/; Expires=Thu, 01 Jan 1970/),
    ]);
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].get('redirect_uri')).toBe(REDIRECT_URI);
    const me = await requestWithAuth(app, 'get', '/users/me', token).expect(200);
    expect(me.body).toEqual(
      expect.objectContaining({ email, firstName: 'Ada', lastName: 'Lovelace', role: Role.admin })
    );
    await requestWithAuth(app, 'get', '/users/all', token).expect(200);
  });

  it('a later login updates the role from the claim, or keeps it when the claim is missing', async () => {
    const email = newEmail();
    const first = await startLogin({ email, email_verified: true, groups: 'admin' });
    await callback(`code=${first.code}&state=${first.state}`, first.cookie);

    const second = await startLogin({ email, email_verified: 'true' });
    tokenFrom((await callback(`code=${second.code}&state=${second.state}`, second.cookie)).headers.location);
    expect((await prismaService.user.findUnique({ where: { email } }))!.role).toBe(Role.admin);

    const third = await startLogin({ email, email_verified: true, groups: ['developers'] });
    tokenFrom((await callback(`code=${third.code}&state=${third.state}`, third.cookie)).headers.location);
    // OIDC_DEFAULT_ROLE defaults to editor
    expect((await prismaService.user.findUnique({ where: { email } }))!.role).toBe(Role.editor);
  });

  it('rejects an email the provider has not verified', async () => {
    const email = newEmail();
    const { state, code, cookie } = await startLogin({ email, email_verified: false, groups: ['admin'] });

    await callback(`code=${code}&state=${state}`, cookie).expect(
      'Location',
      `${FRONTEND_LOGIN}#error=oidc_login_failed`
    );

    expect(await prismaService.user.findUnique({ where: { email } })).toBeNull();
  });

  // cookie: undefined = none, null = the one set by /users/oidc/login
  it.each<[string, { cookie?: string | null; state?: string }]>([
    ['without the state cookie', { cookie: undefined }],
    ['with only other cookies', { cookie: 'theme=dark; lang=en' }],
    ['with a malformed state cookie', { cookie: 'oidc_state=no-dot' }],
    ['with an undecodable state cookie', { cookie: 'oidc_state=%E0%A4%A' }],
    ['when the state does not match', { cookie: null, state: 'forged' }],
  ])('fails %s, without exchanging the code', async (_, arrange) => {
    const email = newEmail();
    const login = await startLogin({ email, email_verified: true });
    const { code } = login;
    const state = arrange.state ?? login.state;
    const cookie = arrange.cookie === null ? login.cookie : arrange.cookie;

    await callback(`code=${code}&state=${state}`, cookie).expect(
      'Location',
      `${FRONTEND_LOGIN}#error=oidc_login_failed`
    );

    expect(tokenRequests).toHaveLength(0);
    expect(await prismaService.user.findUnique({ where: { email } })).toBeNull();
  });

  it('fails when the provider refuses the code', async () => {
    const { state, cookie } = await startLogin({ email: newEmail(), email_verified: true });

    await callback(`code=unknown&state=${state}`, cookie).expect(
      'Location',
      `${FRONTEND_LOGIN}#error=oidc_login_failed`
    );

    expect(tokenRequests).toHaveLength(1);
  });

  it('only keeps scalar query parameters', async () => {
    const email = newEmail();
    const { state, code, cookie } = await startLogin({ email, email_verified: true });

    // a repeated code parameter is dropped, so openid-client sees no code at all
    await callback(`code=${code}&code=${code}&state=${state}`, cookie).expect(
      'Location',
      `${FRONTEND_LOGIN}#error=oidc_login_failed`
    );

    expect(tokenRequests).toHaveLength(0);
  });

  it.each([
    ['post', '/users/register', () => generateUser('123456'), 'User creation is disabled. Use SSO to login.'],
    [
      'post',
      '/users/login',
      () => ({ email: 'someone@example.com', password: '123456' }),
      'Password login is disabled. Use SSO to login.',
    ],
  ] as const)('%s %s is disabled', async (method, url, body, message) => {
    await request(app.getHttpServer())
      [method](url)
      .send(body())
      .expect(400)
      .expect((res) => expect(res.body.message).toBe(message));
  });

  it('PUT /users/password is disabled and PUT /users keeps the email', async () => {
    const email = newEmail();
    const { state, code, cookie } = await startLogin({ email, email_verified: true });
    const token = tokenFrom((await callback(`code=${code}&state=${state}`, cookie)).headers.location);

    await requestWithAuth(app, 'put', '/users/password', token)
      .send({ password: 'new-password' })
      .expect(400)
      .expect((res) =>
        expect(res.body.message).toBe('Password changes are disabled. Use SSO to change your password.')
      );
    const res = await requestWithAuth(app, 'put', '/users', token)
      .send({ email: 'changed@example.com', firstName: 'New', lastName: 'Name' })
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ email, firstName: 'New', lastName: 'Name' }));
  });
});
