import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateUserDto } from './dto/user-create.dto';
import { UserLoginResponseDto } from './dto/user-login-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/user-update.dto';
import { AuthService } from '../auth/auth.service';
import { UserLoginRequestDto } from './dto/user-login-request.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { Logger } from '@nestjs/common';
import { Entry as LdapEntry, Client as LdapClient } from 'ldapts';
import { UsersService } from './users.service';

@Injectable()
export class LdapUsersService implements UsersService {
  private readonly ldapClient: LdapClient;
  private readonly logger: Logger = new Logger(LdapUsersService.name);
  private readonly assertRequiredEnvVarsAreSet = () => {
    const requiredEnvVars = [
      'LDAP_URL',
      'LDAP_BIND_USER',
      'LDAP_BIND_PASSWORD',
      'LDAP_SEARCH_DN',
      'LDAP_USERS_SEARCH_FILTER',
      'LDAP_ATTRIBUTE_MAIL',
      'LDAP_ATTRIBUTE_FIRST_NAME',
      'LDAP_ATTRIBUTE_LAST_NAME',
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`${envVar} is required.`);
      }
    }
  };

  constructor(
    private prismaService: PrismaService,
    private authService: AuthService
  ) {
    this.assertRequiredEnvVarsAreSet();
    this.ldapClient = new LdapClient({
      url: process.env.LDAP_URL,
      tlsOptions: {
        rejectUnauthorized: process.env.LDAP_TLS_NO_VERIFY !== 'true',
      },
    });
  }

  private async findUserInLdap(email: string): Promise<LdapEntry> {
    //escape the email address for LDAP search
    email = this.escapeLdap(email.trim());
    this.logger.verbose(`search '${email}' in LDAP`);
    try {
      await this.ldapClient.bind(process.env.LDAP_BIND_USER, process.env.LDAP_BIND_PASSWORD);
      const attributes = [
        'dn',
        process.env.LDAP_ATTRIBUTE_MAIL,
        process.env.LDAP_ATTRIBUTE_FIRST_NAME,
        process.env.LDAP_ATTRIBUTE_LAST_NAME,
      ];

      const { searchEntries } = await this.ldapClient.search(process.env.LDAP_SEARCH_DN, {
        filter: process.env.LDAP_USERS_SEARCH_FILTER.replaceAll('{{email}}', email),
        sizeLimit: 1,
        attributes: attributes,
      });
      if (searchEntries.length === 0) {
        this.logger.log('User not found in LDAP.');
        throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
      }
      for (const attribute of attributes) {
        if (searchEntries[0][attribute] == null) {
          this.logger.warn(`Attribute '${attribute}' not found in LDAP entry found for '${email}'`);
          throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
        }
      }
      return searchEntries[0];
    } finally {
      await this.ldapClient.unbind();
    }
  }

  private async createUserFromLdapEntry(ldapEntry: LdapEntry): Promise<User> {
    const userForVRTDb = {
      email: ldapEntry[process.env.LDAP_ATTRIBUTE_MAIL].toString().trim().toLowerCase(),
      firstName: ldapEntry[process.env.LDAP_ATTRIBUTE_FIRST_NAME].toString(),
      lastName: ldapEntry[process.env.LDAP_ATTRIBUTE_LAST_NAME].toString(),
      apiKey: this.authService.generateApiKey(),
      password: await this.authService.encryptPassword(Math.random().toString(36).slice(-8)),
      role: Role.editor,
    };

    return this.prismaService.user.create({
      data: userForVRTDb,
    });
  }

  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    throw new HttpException('User creation is disabled. Use your LDAP-Credentials to login.', HttpStatus.BAD_REQUEST);
  }

  async findOne(id: string): Promise<User> {
    return this.prismaService.user.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<User> {
    this.logger.debug(`Removing User: ${id}`);
    return this.prismaService.user.delete({ where: { id } });
  }

  async get(id: string): Promise<UserDto> {
    const user = await this.findOne(id);
    return new UserDto(user);
  }

  async assignRole(data: AssignRoleDto): Promise<UserDto> {
    const { id, role } = data;
    this.logger.debug(`Assigning role ${role} to User: ${id}`);

    const user = await this.prismaService.user.update({
      where: { id },
      data: { role },
    });
    return new UserDto(user);
  }

  async update(id: string, userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    const userFromLdap = await this.findUserInLdap(userDto.email);
    const user = await this.prismaService.user.update({
      where: { id },
      data: {
        email: userFromLdap.mail.toString().trim().toLowerCase(),
        firstName: userFromLdap.givenName.toString(),
        lastName: userFromLdap.sn.toString(),
      },
    });
    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  async generateNewApiKey(user: User): Promise<string> {
    const newApiKey = this.authService.generateApiKey();
    await this.prismaService.user.update({
      where: { id: user.id },
      data: {
        apiKey: newApiKey,
      },
    });
    return newApiKey;
  }

  async changePassword(user: User, newPassword: string): Promise<boolean> {
    this.logger.warn(`${user.email} tied to change password - this is not supported for LDAP users`);
    return true;
  }

  async login(userLoginRequestDto: UserLoginRequestDto) {
    const userFromLdap = await this.findUserInLdap(userLoginRequestDto.email);
    if (!userFromLdap) {
      throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
    }

    // check if user password is correct using ldap
    try {
      await this.ldapClient.bind(userFromLdap.dn, userLoginRequestDto.password);
    } catch (e) {
      throw new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);
    } finally {
      await this.ldapClient.unbind();
    }

    const userEmailFromLdap = userFromLdap[process.env.LDAP_ATTRIBUTE_MAIL].toString().trim().toLowerCase();

    let user = await this.prismaService.user.findUnique({
      where: { email: userEmailFromLdap },
    });

    if (!user) {
      // create user if not found in VRT database
      this.logger.log(
        `'${userLoginRequestDto.email}' (found in ldap as '${userEmailFromLdap}') successfully ` +
          'authenticated via LDAP, but not found in VRT database. Creating user.'
      );
      user = await this.createUserFromLdapEntry(userFromLdap);
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

  /**
   * RFC 2254 Escaping of filter strings
   * Raw                     Escaped
   * (o=Parens (R Us))       (o=Parens \28R Us\29)
   * (cn=star*)              (cn=star\2A)
   * (filename=C:\MyFile)    (filename=C:\5cMyFile)
   */
  private escapeLdap(input: string): string {
    let escapedResult = '';
    for (const inputChar of input) {
      switch (inputChar) {
        case '*':
          escapedResult += '\\2a';
          break;
        case '(':
          escapedResult += '\\28';
          break;
        case ')':
          escapedResult += '\\29';
          break;
        case '\\':
          escapedResult += '\\5c';
          break;
        case '\0':
          escapedResult += '\\00';
          break;
        default:
          escapedResult += inputChar;
          break;
      }
    }
    return escapedResult;
  }
}
