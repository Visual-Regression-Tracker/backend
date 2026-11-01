import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();
    const user = request.user as User | undefined;
    return !!user && requiredRoles.includes(user.role);
  }
}
