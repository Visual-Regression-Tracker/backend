import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { ApiGuard } from './api.guard';
import { JwtAuthGuard } from './auth.guard';

@Injectable()
export class MixedGuard implements CanActivate {
  constructor(
    private readonly apiGuard: ApiGuard,
    private readonly authGuard: JwtAuthGuard
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      if (await this.authGuard.canActivate(context)) {
        return true;
      }
    } catch {
      // not a valid JWT: the api key is tried next
    }
    try {
      return await this.apiGuard.canActivate(context);
    } catch {
      return false;
    }
  }
}
