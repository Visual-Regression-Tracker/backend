import { INestApplication } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';
import uuidAPIKey from 'uuid-apikey';
import request, { Test, CallbackHandler, Request } from 'supertest';
import { CreateUserDto } from 'src/users/dto/user-create.dto';

export const generateUser = (password: string): { email: string, password: string, firstName: string, lastName: string } => ({
    email: `${uuidAPIKey.create().uuid}@example.com'`,
    password,
    firstName: 'fName',
    lastName: 'lName',
})

export const requestWithAuth = (app: INestApplication, method: 'post' | 'get' | 'put' | 'delete', url: string, body = {}, token: string): Test =>
    request(app.getHttpServer())
    [method](url)
        .set('Authorization', 'Bearer ' + token)
        .send(body)

export const haveUserLogged = async (usersService: UsersService) => {
    const password = '123456'
    const user = await usersService.create(generateUser(password))

    return usersService.login({
        email: user.email,
        password
    })
}