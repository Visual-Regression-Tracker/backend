import { HttpException, HttpStatus } from '@nestjs/common';
import { CreateUserDto } from '../dto/user-create.dto';
import { UserLoginResponseDto } from '../dto/user-login-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import { UpdateUserDto } from '../dto/user-update.dto';
import { AuthService } from '../../auth/auth.service';
import { UserLoginRequestDto } from '../dto/user-login-request.dto';
import { Logger } from '@nestjs/common';
import { Entry as LdapEntry, Client as LdapClient } from 'ldapts';
import { Users } from '../users.interface';
import { ConfigService } from '@nestjs/config';

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
export class LdapUsersService implements Users {
  private readonly ldapClient: LdapClient;
  private readonly logger: Logger = new Logger(LdapUsersService.name);
  private readonly ldapConfig: LDAPConfig;

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
    private authService: AuthService
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
      tlsNoVerify: this.configService.get<boolean>('LDAP_TLS_NO_VERIFY', false),
    };
    this.ldapClient = new LdapClient({
      url: this.ldapConfig.url,
      tlsOptions: {
        rejectUnauthorized: !this.ldapConfig.tlsNoVerify,
      },
    });
  }

  private async findUserInLdap(email: string): Promise<LdapEntry> {
    //escape the email address for LDAP search
    email = this.escapeLdap(email.trim());
    this.logger.verbose(`search '${email}' in LDAP`);
    try {
      await this.ldapClient.bind(this.ldapConfig.bindUser, this.ldapConfig.bindPassword);
      const attributes = [
        'dn',
        this.ldapConfig.attributeMail,
        this.ldapConfig.attributeFirstName,
        this.ldapConfig.attributeLastName,
      ];

      const { searchEntries } = await this.ldapClient.search(this.ldapConfig.searchDN, {
        filter: this.ldapConfig.usersSearchFilter.replaceAll('{{email}}', email),
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
      email: ldapEntry[this.ldapConfig.attributeMail].toString().trim().toLowerCase(),
      firstName: ldapEntry[this.ldapConfig.attributeFirstName].toString(),
      lastName: ldapEntry[this.ldapConfig.attributeLastName].toString(),
      apiKey: this.authService.generateApiKey(),
      password: await this.authService.encryptPassword(Math.random().toString(36).slice(-8)),
      role: Role.editor,
    };

    return this.prismaService.user.create({
      data: userForVRTDb,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(createUserDto: CreateUserDto): Promise<UserLoginResponseDto> {
    throw new HttpException('User creation is disabled. Use your LDAP-Credentials to login.', HttpStatus.BAD_REQUEST);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    const userEmailFromLdap = userFromLdap[this.ldapConfig.attributeMail].toString().trim().toLowerCase();

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
