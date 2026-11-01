import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateRandomKey } from '../utils/random-key';
import { compare, genSalt, hash } from 'bcryptjs';
import { JwtPayload } from './jwt-payload.model';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async encryptPassword(password: string): Promise<string> {
    const salt = await genSalt(10);
    return hash(password, salt);
  }

  generateApiKey(): string {
    return generateRandomKey();
  }

  compare(password: string, hashedPassword: string): Promise<boolean> {
    return compare(password, hashedPassword);
  }

  signToken(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwtService.sign(payload);
  }
}
