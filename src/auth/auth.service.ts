import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import uuidAPIKey from 'uuid-apikey';
import { compare, genSalt, hash } from 'bcryptjs';
import { JwtPayload } from './jwt-payload.model';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async encryptPassword(password): Promise<string> {
    const salt = await genSalt(10);
    return hash(password, salt);
  }

  generateApiKey(): string {
    return uuidAPIKey.create({ noDashes: true }).apiKey;
  }

  async compare(password: string, hashedPassword: string): Promise<boolean> {
    return await compare(password, hashedPassword);
  }

  signToken(user: User): string {
    const payload: JwtPayload = {
      email: user.email,
    };

    const token = this.jwtService.sign(payload);
    return token;
  }
}
