import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserLoginRequestDto } from 'src/users/dto/user-login-request.dto';
import { UserLoginResponseDto } from 'src/users/dto/user-login-response.dto';
import { compare } from 'bcryptjs';
import { User } from 'src/users/user.entity';
import { JwtPayload } from './jwt-payload.model';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async login(userLoginRequestDto: UserLoginRequestDto) {
    const user = await this.usersService.getUserByEmail(
      userLoginRequestDto.email,
    );
    if (!user) {
      throw new HttpException(
        'Invalid email or password.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isMatch = await compare(userLoginRequestDto.password, user.password);
    if (!isMatch) {
      throw new HttpException(
        'Invalid email or password.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const token = await this.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  async signToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      email: user.email,
    };

    const token = this.jwtService.sign(payload);
    return token;
  }
}
