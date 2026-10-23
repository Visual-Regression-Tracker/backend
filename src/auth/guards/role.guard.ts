import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly prismaService: PrismaService,
    private reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const user = await this.getUser(context);
    return !!user && requiredRoles.includes(user.role);
  }

  private getUser = async (context: ExecutionContext): Promise<User | null> => {
    const request: Request = context.switchToHttp().getRequest();

    if (request.user) {
      return request.user as User;
    }

    const apiKey = request.header('apiKey');
    if (!apiKey) {
      return null;
    }

    return this.prismaService.user.findUnique({
      where: { apiKey },
    });
  };
}
