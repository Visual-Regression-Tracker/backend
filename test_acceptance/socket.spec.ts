import { io, Socket } from 'socket.io-client';

const BASE_URL = 'http://localhost:4200';

describe('Socket.io (acceptance)', () => {
  let socket: Socket;

  afterEach(() => {
    socket?.disconnect();
  });

  test('client connects to the socket.io server', async () => {
    socket = io(BASE_URL, { transports: ['websocket'], reconnection: false });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not connect within 10s')), 10000);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(socket.connected).toBe(true);
  });
});
