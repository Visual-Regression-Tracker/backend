import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Project } from '@prisma/client';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { BuildsService } from '../src/builds/builds.service';
import { ProjectsService } from '../src/projects/projects.service';
import { UsersService } from '../src/users/users.service';
import { createE2eApp, haveProject, setEnv } from './api-helpers';
import { haveUserLogged, LoggedUser } from './preconditions';

const SETTLE_MS = 300;

describe('Socket.io (e2e)', () => {
  let app: INestApplication;
  let usersService: UsersService;
  let url: string;
  let user: LoggedUser;
  let restoreEnv: () => void;
  const sockets: Socket[] = [];

  const start = async (env: Record<string, string>) => {
    restoreEnv = setEnv(env);
    const created = await createE2eApp();
    app = created.app;
    usersService = created.get(UsersService);
    await app.listen(0);
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    user = await haveUserLogged(usersService);
  };

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await usersService.delete(user.id);
    await app.close();
    restoreEnv();
  });

  const connect = (auth?: Record<string, unknown>): Promise<Socket> => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, auth });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  };

  const refusalOf = (auth?: Record<string, unknown>): Promise<string> =>
    connect(auth).then(
      () => 'connected',
      (error: Error) => error.message
    );

  const expiredToken = () => app.get(JwtService).sign({ sub: user.id, email: user.email }, { expiresIn: -10 });

  describe('WS_AUTH_REQUIRED unset', () => {
    beforeEach(() => start({}));

    it('lets in a socket without a token, as the deployed frontend connects', async () => {
      await expect(refusalOf()).resolves.toBe('connected');
    });

    it('lets in a socket with a valid token', async () => {
      await expect(refusalOf({ token: user.token })).resolves.toBe('connected');
    });

    it('refuses an invalid or expired token as unauthorized', async () => {
      await expect(refusalOf({ token: 'not-a-jwt' })).resolves.toBe('unauthorized');
      await expect(refusalOf({ token: expiredToken() })).resolves.toBe('unauthorized');
    });
  });

  describe('WS_AUTH_REQUIRED=true', () => {
    beforeEach(() => start({ WS_AUTH_REQUIRED: 'true' }));

    it('refuses a socket without a token as unauthorized', async () => {
      await expect(refusalOf()).resolves.toBe('unauthorized');
    });

    it('lets in a socket with a valid token', async () => {
      await expect(refusalOf({ token: user.token })).resolves.toBe('connected');
    });
  });

  describe('rooms', () => {
    let project: Project;

    const collect = (socket: Socket, event: string): unknown[] => {
      const payloads: unknown[] = [];
      socket.on(event, (payload) => payloads.push(payload));
      return payloads;
    };
    const nextOf = (socket: Socket, event: string): Promise<unknown> =>
      new Promise((resolve) => socket.once(event, resolve));
    // the server sends one event to all its sockets at once, so others have had their chance by now
    const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const createBuild = () => app.get(BuildsService).findOrCreate({ projectId: project.id, branchName: 'master' });

    afterEach(async () => {
      await app.get(ProjectsService).remove(project.id);
    });

    it('with WS_BROADCAST=false only a socket that joined the project room gets its builds', async () => {
      await start({ WS_BROADCAST: 'false' });
      project = await haveProject(app.get(ProjectsService), 'Socket rooms');
      const member = await connect({ token: user.token });
      const outsider = await connect({ token: user.token });
      const left = await connect({ token: user.token });
      await expect(member.emitWithAck('join', { projectId: project.id })).resolves.toEqual([`project:${project.id}`]);
      await left.emitWithAck('join', { projectId: project.id });
      await expect(left.emitWithAck('leave', { projectId: project.id })).resolves.toEqual([`project:${project.id}`]);
      const toOutsider = collect(outsider, 'build_created');
      const toLeft = collect(left, 'build_created');
      const toMember = nextOf(member, 'build_created');

      const build = await createBuild();

      expect(await toMember).toEqual(expect.objectContaining({ id: build.id, projectId: project.id }));
      await settle();
      expect(toOutsider).toEqual([]);
      expect(toLeft).toEqual([]);
    });

    it('by default every socket gets every build, joined or not', async () => {
      await start({});
      project = await haveProject(app.get(ProjectsService), 'Socket broadcast');
      const member = await connect();
      const outsider = await connect();
      await member.emitWithAck('join', { projectId: project.id });
      const received = [nextOf(member, 'build_created'), nextOf(outsider, 'build_created')];

      const build = await createBuild();

      expect(await Promise.all(received)).toEqual([
        expect.objectContaining({ id: build.id }),
        expect.objectContaining({ id: build.id }),
      ]);
    });
  });
});
