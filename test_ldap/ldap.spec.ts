import axios from 'axios';
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';

axios.defaults.baseURL = 'http://localhost:4200';

const loginData: UserLoginRequestDto = {
  email: `developer.one@ldapmock.local`,
  password: 'password',
};
const wrongLoginData: UserLoginRequestDto = {
  email: loginData.email,
  password: 'wrongpassword',
};

describe('Ldap', () => {
  test('Sucessful login', async () => {
    const response = await axios.post<UserLoginResponseDto>('/users/login', loginData);

    expect(response.status).toBe(201);
    expect(response.data.token).toBeDefined();
  });

  test('Unsucessful login', async () => {
    await axios.post<UserLoginResponseDto>('/users/login', wrongLoginData).catch((error) => {
      expect(error.response.status).toBe(400);
      expect(error.response.data.message).toContain('Invalid email or password.');
    });
  });
});
