import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { User } from './user.entity';
import { InjectModel } from '@nestjs/sequelize';
import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { genSalt, hash } from 'bcryptjs';
import uuidAPIKey from 'uuid-apikey';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userModel.findAll();
  }

  findOne(id: string): Promise<User> {
    return this.userModel.findOne({
      where: {
        id,
      },
    });
  }

  async getUserByApiKey(apiKey: string): Promise<User> {
    return await this.userModel.findOne({
      where: { apiKey },
    });
  }

  async getUserByEmail(email: string): Promise<User> {
    return await this.userModel.findOne({
      where: { email },
    });
  }

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    try {
      const user = new User();
      user.email = createUserDto.email.trim().toLowerCase();
      user.firstName = createUserDto.firstName;
      user.lastName = createUserDto.lastName;
      user.apiKey = uuidAPIKey.create({ noDashes: true }).apiKey;

      const salt = await genSalt(10);
      user.password = await hash(createUserDto.password, salt);

      const userData = await user.save();

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
