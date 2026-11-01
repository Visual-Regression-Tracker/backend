import { HttpException, HttpStatus, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CreateUserDto } from '../dto/user-create.dto';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import { UpdateUserDto } from '../dto/user-update.dto';
import { AuthService } from '../../auth/auth.service';
import { UserLoginRequestDto } from '../dto/user-login-request.dto';
import { Entry as LdapEntry, Client as LdapClient } from 'ldapts';
import { Users } from '../users.interface';
import { ConfigService } from '@nestjs/config';
import { genSaltSync } from 'bcryptjs';

type LDAPConfig = {
  url: string;
  bindUser: string;
  bindPassword: string;
  searchDN: string;
  usersSearchFilter: string;
  attributeMail: string;
  attributeFirstName: string;
  attributeLastName: string;
  tlsNoVerify: boolean;
};

const invalidCredentials = () => new HttpException('Invalid email or password.', HttpStatus.BAD_REQUEST);

export class LdapUsersService implements Users {
  readonly allowsRegistration = false;
  private readonly logger: Logger = new Logger(LdapUsersService.name);
  private readonly ldapConfig: LDAPConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly authService: AuthService
  ) {
    this.ldapConfig = {
      url: this.configService.getOrThrow<string>('LDAP_URL'),
      bindUser: this.configService.getOrThrow<string>('LDAP_BIND_USER'),
      bindPassword: this.configService.getOrThrow<string>('LDAP_BIND_PASSWORD'),
      searchDN: this.configService.getOrThrow<string>('LDAP_SEARCH_DN'),
      usersSearchFilter: this.configService.getOrThrow<string>('LDAP_USERS_SEARCH_FILTER'),
      attributeMail: this.configService.getOrThrow<string>('LDAP_ATTRIBUTE_MAIL'),
      attributeFirstName: this.configService.getOrThrow<string>('LDAP_ATTRIBUTE_FIRST_NAME'),
      attributeLastName: this.configService.getOrThrow<string>('LDAP_ATTRIBUTE_LAST_NAME'),
      tlsNoVerify: this.configService.get<string>('LDAP_TLS_NO_VERIFY', 'false').toLowerCase() === 'true',
    };
  }

  // one connection per operation: ldapts' unbind() destroys the socket a concurrent login may still be using
  private createClient(): LdapClient {
    return new LdapClient({
      url: this.ldapConfig.url,
      timeout: 10_000,
      connectTimeout: 5_000,
      tlsOptions: { rejectUnauthorized: !this.ldapConfig.tlsNoVerify },
    });
  }

  private async findUserInLdap(email: string): Promise<LdapEntry> {
    email = this.escapeLdap(email.trim());
    this.logger.verbose(`search '${email}' in LDAP`);
    const client = this.createClient();
    try {
      await client.bind(this.ldapConfig.bindUser, this.ldapConfig.bindPassword);
      const attributes = [
        'dn',
        this.ldapConfig.attributeMail,
        this.ldapConfig.attributeFirstName,
        this.ldapConfig.attributeLastName,
      ];

      const { searchEntries } = await client.search(this.ldapConfig.searchDN, {
        filter: this.ldapConfig.usersSearchFilter.replaceAll('{{email}}', email),
        sizeLimit: 1,
        attributes: attributes,
      });
      if (searchEntries.length === 0) {
        this.logger.log('User not found in LDAP.');
        throw invalidCredentials();
      }
      for (const attribute of attributes) {
        if (searchEntries[0][attribute] == null) {
          this.logger.warn(`Attribute '${attribute}' not found in LDAP entry found for '${email}'`);
          throw invalidCredentials();
        }
      }
      return searchEntries[0];
    } catch (e) {
      if (e instanceof HttpException) {
        throw e;
      }
      this.logger.error(`LDAP search for '${email}' failed: ${e}`);
      throw new ServiceUnavailableException('Directory service is not available.');
    } finally {
      await client.unbind().catch((): undefined => undefined);
    }
  }

  private profileOf(entry: LdapEntry) {
    return {
      email: entry[this.ldapConfig.attributeMail].toString().trim().toLowerCase(),
      firstName: entry[this.ldapConfig.attributeFirstName].toString(),
      lastName: entry[this.ldapConfig.attributeLastName].toString(),
    };
  }

  private async createUserFromLdapEntry(ldapEntry: LdapEntry): Promise<User> {
    return this.prismaService.user.create({
      data: {
        ...this.profileOf(ldapEntry),
        apiKey: this.authService.generateApiKey(),
        password: await this.authService.encryptPassword(genSaltSync(1).slice(-12)),
        role: Role.editor,
      },
    });
  }

  async create(_createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    throw new HttpException('User creation is disabled. Use your LDAP-Credentials to login.', HttpStatus.BAD_REQUEST);
  }

  async update(id: string, _userDto: UpdateUserDto): Promise<UserLoginResponseDto> {
    // the directory owns the profile: refresh it from the caller's own entry, never from an email the client sent
    const current = await this.prismaService.user.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException(`User not found: ${id}`);
    }
    const entry = await this.findUserInLdap(current.email);
    const user = await this.prismaService.user.update({ where: { id }, data: this.profileOf(entry) });
    return new UserLoginResponseDto(user, this.authService.signToken(user));
  }

  changePassword(user: User, _newPassword: string): Promise<boolean> {
    this.logger.warn(`${user.email} tried to change password - this is not supported for LDAP users`);
    return Promise.reject(
      new HttpException('Password changes are disabled. Change your password in the directory.', HttpStatus.BAD_REQUEST)
    );
  }

  async login(userLoginRequestDto: UserLoginRequestDto) {
    // RFC 4513 5.1.2: a DN with an empty password is an unauthenticated bind, which AD answers with success
    if (!userLoginRequestDto.password) {
      throw invalidCredentials();
    }
    const userFromLdap = await this.findUserInLdap(userLoginRequestDto.email);

    const client = this.createClient();
    try {
      await client.bind(userFromLdap.dn, userLoginRequestDto.password);
    } catch {
      throw invalidCredentials();
    } finally {
      await client.unbind().catch((): undefined => undefined);
    }

    const userEmailFromLdap = this.profileOf(userFromLdap).email;

    let user = await this.prismaService.user.findUnique({ where: { email: userEmailFromLdap } });

    if (!user) {
      this.logger.log(
        `'${userLoginRequestDto.email}' (found in ldap as '${userEmailFromLdap}') successfully ` +
          'authenticated via LDAP, but not found in VRT database. Creating user.'
      );
      user = await this.createUserFromLdapEntry(userFromLdap);
    }

    const token = this.authService.signToken(user);
    return new UserLoginResponseDto(user, token);
  }

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
