import { ExecutionContext, Injectable, CanActivate, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiGuard implements CanActivate {
  constructor(private readonly prismaService: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const apiKey = request.header('apiKey');
    if (apiKey === undefined) {
      throw new UnauthorizedException();
    }
    // an empty header never matches a key: 403, not 401
    if (apiKey === '') {
      return false;
    }
    let user: User | null;
    try {
      user = await this.prismaService.user.findUnique({ where: { apiKey } });
    } catch {
      throw new UnauthorizedException();
    }
    if (!user) {
      return false;
    }
    request.user = user;
    return true;
  }
}
