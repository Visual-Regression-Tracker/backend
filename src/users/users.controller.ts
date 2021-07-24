import { Controller, Post, Body, Get, UseGuards, Put, Delete, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiOkResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { CreateUserDto } from './dto/user-create.dto';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { CurrentUser } from '../shared/current-user.decorator';
import { Role, User } from '@prisma/client';
import { RoleGuard } from 'src/auth/guards/role.guard';
import { Roles } from 'src/shared/roles.decorator';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('users')
@ApiTags('users')
export class UsersController {
  constructor(private usersService: UsersService, private prismaService: PrismaService) {}

  @Post('register')
  @ApiOkResponse({ type: UserLoginResponseDto })
  register(@Body() createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    return this.usersService.create(createUserDto);
  }

  @Post('login')
  @ApiOkResponse({ type: UserLoginResponseDto })
  async login(@Body() userLoginRequestDto: UserLoginRequestDto): Promise<UserLoginResponseDto> {
    return this.usersService.login(userLoginRequestDto);
  }

  @Get('newApiKey')
  @ApiOkResponse({ type: String })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  generateNewApiKey(@CurrentUser() user: User): Promise<string> {
    return this.usersService.generateNewApiKey(user);
  }

  @Put('password')
  @ApiOkResponse({ type: Boolean })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(@CurrentUser() user: User, @Body('password') password: string): Promise<boolean> {
    return this.usersService.changePassword(user, password);
  }

  @Put()
  @ApiOkResponse({ type: UserLoginResponseDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: User, @Body() updateUserDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    return this.usersService.update(user.id, updateUserDto);
  }

  @Get('all')
  @ApiOkResponse({ type: [UserDto] })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async userList(): Promise<UserDto[]> {
    const users = await this.prismaService.user.findMany();
    return users.map((user) => new UserDto(user));
  }

  @Delete(':id')
  @ApiOkResponse({ type: Boolean })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async delete(@Param('id', new ParseUUIDPipe()) id: string): Promise<boolean> {
    const user = await this.prismaService.user.delete({ where: { id } });
    return !!user;
  }

  @Patch('assignRole/:id')
  @ApiOkResponse({ type: UserDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async assignRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: Pick<UpdateUserDto, 'role'>
  ): Promise<UserDto> {
    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        role: data.role,
      },
    });

    return new UserDto(user);
  }
}
