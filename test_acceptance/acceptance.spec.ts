import { User } from '@prisma/client';
import axios from 'axios'
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';
import uuidAPIKey from 'uuid-apikey';

axios.defaults.baseURL = 'http://localhost:4200';

let user: Partial<User> = {
    email: `${uuidAPIKey.create().uuid}@example.com`,
    password: '123456',
    firstName: 'fName',
    lastName: 'lName',
};
const loginData: UserLoginRequestDto = {
    email: user.email,
    password: user.password,
}

describe('Acceptance', () => {

    test('Register and login', async () => {
        await axios.post<User>('/users/register', user);

        const response = await axios.post<UserLoginResponseDto>('/users/login', loginData)

        expect(response.status).toBe(201)
        expect(response.data.token).toBeDefined()
    })
})