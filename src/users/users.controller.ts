import { Controller, Post, Body, Get, UseGuards, Put, Delete, Patch } from '@nestjs/common';
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
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../shared/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { Logger } from '@nestjs/common';

@Controller('users')
@ApiTags('users')
export class UsersController {
  private readonly logger: Logger = new Logger(UsersController.name);

  constructor(
    private usersService: UsersService,
    private prismaService: PrismaService
  ) {}

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
  @ApiOkResponse({ type: UserDto, isArray: true })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async userList(): Promise<UserDto[]> {
    const users = await this.prismaService.user.findMany();
    return users.map((user) => new UserDto(user));
  }

  @Delete()
  @ApiOkResponse({ type: Boolean })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async delete(@Body() ids: string[]): Promise<void> {
    this.logger.debug(`Going to remove User: ${ids}`);
    for (const id of ids) {
      await this.usersService.delete(id);
    }
  }

  @Patch('assignRole')
  @ApiOkResponse({ type: UserDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(Role.admin)
  async assignRole(@Body() data: AssignRoleDto): Promise<UserDto> {
    this.logger.debug(`Going to assign role ${data.role} to User: ${data.id}`);
    return this.usersService.assignRole(data);
  }
}
