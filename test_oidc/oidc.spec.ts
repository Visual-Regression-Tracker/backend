import axios from 'axios';
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';

axios.defaults.baseURL = 'http://localhost:4200';

// These tests run against a running api that was started with OIDC enabled
// (see docker-compose.oidc.yml). The full browser redirect flow cannot be
// automated here, so we verify the pieces the backend owns.
describe('Oidc', () => {
  test('reports OIDC as enabled', async () => {
    const response = await axios.get<boolean>('/users/oidc/enabled');

    expect(response.status).toBe(200);
    expect(response.data).toBe(true);
  });

  test('redirects to the identity provider and stores the PKCE state cookie', async () => {
    const response = await axios
      .get('/users/oidc/login', { maxRedirects: 0, validateStatus: () => true })
      .catch((error) => error.response);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/default/authorize');
    expect(response.headers.location).toContain('code_challenge_method=S256');
    expect(response.headers['set-cookie'].join(';')).toContain('oidc_state=');
  });

  test('redirects back to the frontend with an error when the state cookie is missing', async () => {
    const response = await axios
      .get('/users/oidc/callback?code=dummy&state=dummy', { maxRedirects: 0, validateStatus: () => true })
      .catch((error) => error.response);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('#error=oidc_login_failed');
  });

  test('password login is disabled', async () => {
    const loginData: UserLoginRequestDto = {
      email: 'editor@oidcmock.local',
      password: 'password',
    };

    await axios.post('/users/login', loginData).catch((error) => {
      expect(error.response.status).toBe(400);
      expect(error.response.data.message).toContain('Password login is disabled.');
    });
  });

  test('GET /users/me requires authentication', async () => {
    await axios.get('/users/me').catch((error) => {
      expect(error.response.status).toBe(401);
    });
  });
});
