import {
  Controller,
  Request,
  Post,
  Get,
  UseGuards,
  Body,
} from '@nestjs/common';
import { AppService } from './app.service';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/guards/auth.guard';
import { ApiOkResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserLoginResponseDto } from './users/dto/user-login-response.dto';
import { UserLoginRequestDto } from './users/dto/user-login-request.dto';
import { CreateUserDto } from './users/dto/user-create.dto';
import { UsersService } from './users/users.service';

@Controller()
export class AppController {
  constructor(
    private appService: AppService,
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('auth/login')
  @ApiOkResponse({ type: UserLoginResponseDto })
  async login(
    @Body() userLoginRequestDto: UserLoginRequestDto,
  ): Promise<UserLoginResponseDto> {
    return this.authService.login(userLoginRequestDto);
  }

  @Post('register')
  @ApiOkResponse({ type: UserLoginResponseDto })
  register(
    @Body() createUserDto: CreateUserDto,
  ): Promise<UserLoginResponseDto> {
    return this.usersService.create(createUserDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiOkResponse({ type: String })
  @ApiBearerAuth()
  getProfile(@Request() req): string {
    return req.user;
  }
}
