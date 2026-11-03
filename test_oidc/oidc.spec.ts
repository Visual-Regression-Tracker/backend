import axios from 'axios';
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';

axios.defaults.baseURL = 'http://localhost:4200';
// host.docker.internal names the issuer inside compose; the test host reaches the mock on its published port
const MOCK_IDP = 'http://127.0.0.1:8090';
const noRedirect = { maxRedirects: 0, validateStatus: () => true };

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

  test('signs in through the identity provider and maps its groups to the admin role', async () => {
    const login = await axios.get('/users/oidc/login', noRedirect);
    const cookie = (login.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; ');
    const authorize = new URL(login.headers.location);

    const signIn = await axios.post(
      `${MOCK_IDP}${authorize.pathname}${authorize.search}`,
      new URLSearchParams({ username: 'admin', claims: '' }),
      { ...noRedirect, headers: { Host: authorize.host } }
    );
    const callback = await axios.get(`/users/oidc/callback${new URL(signIn.headers.location).search}`, {
      ...noRedirect,
      headers: { cookie },
    });
    const token = new URLSearchParams(new URL(callback.headers.location).hash.slice(1)).get('token');
    const me = await axios.get('/users/me', { headers: { Authorization: `Bearer ${token}` } });

    expect(me.data).toMatchObject({ email: 'admin@oidcmock.local', firstName: 'Ada', role: 'admin' });
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

    const response = await axios.post('/users/login', loginData, { validateStatus: () => true });

    expect(response.status).toBe(400);
    expect(response.data.message).toContain('Password login is disabled.');
  });

  test('GET /users/me requires authentication', async () => {
    const response = await axios.get('/users/me', { validateStatus: () => true });

    expect(response.status).toBe(401);
  });
});
