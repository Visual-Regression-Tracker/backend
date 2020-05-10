import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { AuthService } from 'src/auth/auth.service';
import { UserLoginRequestDto } from './dto/user-login-request.dto';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService, private authService: AuthService) {
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

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    const user = {
      email: createUserDto.email.trim().toLowerCase(),
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      apiKey: this.authService.generateApiKey(),
      password: await this.authService.encryptPassword(createUserDto.password),
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

  async get(id: string): Promise<UserDto> {
    const user = await this.prismaService.user.findOne({ where: { id } })
    return new UserDto(user)
  }

  async update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        email: userDto.email,
        firstName: userDto.firstName,
        lastName: userDto.lastName,
      }
    })
    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  generateNewApiKey(user: User): string {
    const newApiKey = this.authService.generateApiKey()
    this.prismaService.user.update({
      where: { id: user.id },
      data: {
        apiKey: newApiKey
      }
    })
    return newApiKey;
  }

  async login(userLoginRequestDto: UserLoginRequestDto) {
    const user = await this.prismaService.user.findOne({
      where: { email: userLoginRequestDto.email }
    })
    if (!user) {
      throw new HttpException(
        'Invalid email or password.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isMatch = this.authService.compare(userLoginRequestDto.password, user.password);
    if (!isMatch) {
      throw new HttpException(
        'Invalid email or password.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }
}
