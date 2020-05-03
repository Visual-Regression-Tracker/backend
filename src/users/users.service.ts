import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { genSalt, hash } from 'bcryptjs';
import uuidAPIKey from 'uuid-apikey';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {
    // create default user if there are none in DB
    this.userList().then(userList => {
      if (userList.length === 0) {
        const defaultEmail = 'visual-regression-tracker@example.com';
        const defaultPassword = '123456';

        this.create({
          email: defaultEmail,
          password: defaultPassword,
          firstName: 'fname',
          lastName: 'lname'
        }).then(
          user => {
            console.log('#########################');
            console.log('## CREATING ADMIN USER ##');
            console.log('#########################');
            console.log('');
            console.log(
              `The user with the email "${defaultEmail}" and password "${defaultPassword}" was created`
            );
            console.log(`The Api key is: ${user.apiKey}`);
          }
        );
      }
    });
  }

  userList(): Promise<User[]> {
    return this.prismaService.user.findMany();
  }

  findOne(id: string): Promise<User> {
    return this.prismaService.user.findOne({ where: { id } });
  }

  async getUserByApiKey(apiKey: string): Promise<User> {
    return this.prismaService.user.findOne({
      where: { apiKey },
    });
  }

  async getUserByEmail(email: string): Promise<User> {
    return this.prismaService.user.findOne({
      where: { email },
    });
  }

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    const user = {
      email: createUserDto.email.trim().toLowerCase(),
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      apiKey: uuidAPIKey.create({ noDashes: true }).apiKey,
      password: await hash(createUserDto.password, await genSalt(10)),
    };

    try {
      const userData = await this.prismaService.user.create({
        data: user,
      });

      return new UserLoginResponseDto(userData, null);
    } catch (err) {
      if (err.original.constraint === 'user_email_key') {
        throw new HttpException(
          `User with email '${err.errors[0].value}' already exists`,
          HttpStatus.CONFLICT,
        );
      }

      throw new HttpException(err, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
