import {
  ExecutionContext,
  Injectable,
  CanActivate,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class ApiGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    try {
      const user = await this.usersService.getUserByApiKey(request.header('apiKey'));
      return !!user;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
