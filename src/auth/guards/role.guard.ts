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
    const roles = this.reflector.get<Role[]>('roles', context.getHandler());
    if (!roles) {
      return true;
    }

    const user = await this.getUser(context);
    return this.checkPermission(user);
  }

  checkPermission = (user: User): boolean => {
    switch (user.role) {
      case Role.admin: {
        return true;
      }
      case Role.editor: {
        // check project permissions later
        return true;
      }
      default:
        return false;
    }
  };

  getUser = async (context: ExecutionContext): Promise<User> => {
    const request: Request = context.switchToHttp().getRequest();

    if (request.user) {
      return request.user as User;
    }

    return this.prismaService.user.findUnique({
      where: { apiKey: request.header('apiKey') },
    });
  };
}
