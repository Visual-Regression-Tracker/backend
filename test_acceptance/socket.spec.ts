import axios from 'axios';
import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';

const BASE_URL = 'http://localhost:4200';

const connect = (auth?: { token: string | null }): Promise<Socket> => {
  const socket = io(BASE_URL, { transports: ['websocket'], reconnection: false, auth });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket did not connect within 10s')), 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
};

describe('Socket.io (acceptance)', () => {
  let socket: Socket | undefined;

  afterEach(() => {
    socket?.disconnect();
  });

  test('client with a token connects to the socket.io server', async () => {
    const user = { email: `${randomUUID()}@example.com`, password: '123456', firstName: 'f', lastName: 'l' };
    await axios.post(`${BASE_URL}/users/register`, user);
    const { data } = await axios.post<UserLoginResponseDto>(`${BASE_URL}/users/login`, {
      email: user.email,
      password: user.password,
    });

    socket = await connect({ token: data.token });

    expect(socket.connected).toBe(true);
  });

  test('client without a token is refused by default', async () => {
    await expect(connect()).rejects.toThrow('unauthorized');
  });
});
