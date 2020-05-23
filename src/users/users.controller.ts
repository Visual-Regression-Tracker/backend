import { Controller, Post, Body, Get, UseGuards, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiOkResponse, ApiParam, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { CreateUserDto } from './dto/user-create.dto';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { CurrentUser } from '../shared/current-user.decorator'
import { User } from '@prisma/client';

@Controller('users')
@ApiTags('users')
export class UsersController {
    constructor(
        private usersService: UsersService,
    ) { }

    @Post('register')
    @ApiOkResponse({ type: UserLoginResponseDto })
    register(
        @Body() createUserDto: CreateUserDto,
    ): Promise<UserLoginResponseDto> {
        return this.usersService.create(createUserDto);
    }

    @Post('login')
    @ApiOkResponse({ type: UserLoginResponseDto })
    async login(
        @Body() userLoginRequestDto: UserLoginRequestDto,
    ): Promise<UserLoginResponseDto> {
        return this.usersService.login(userLoginRequestDto);
    }

    @Get('newApiKey')
    @ApiOkResponse({ type: String })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    generateNewApiKey(@CurrentUser() user: User): Promise<string> {
        return this.usersService.generateNewApiKey(user)
    }

    @Put('password')
    @ApiOkResponse({ type: Boolean })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    changePassword(@CurrentUser() user: User, @Body('password') password: string): Promise<boolean> {
        return this.usersService.changePassword(user, password)
    }

    @Get(':id')
    @ApiParam({ name: 'id', required: true })
    @ApiOkResponse({ type: UserDto })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    get(@Param('id', new ParseUUIDPipe()) id: string): Promise<UserDto> {
        return this.usersService.get(id);
    }

    @Put(':id')
    @ApiParam({ name: 'id', required: true })
    @ApiOkResponse({ type: UserLoginResponseDto })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    updated(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() updateUserDto: UpdateUserDto
    ): Promise<UserLoginResponseDto> {
        return this.usersService.update(id, updateUserDto);
    }
}
