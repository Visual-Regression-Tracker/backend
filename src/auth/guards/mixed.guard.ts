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
    let jwtAuth = false;
    try {
      jwtAuth = (await this.authGuard.canActivate(context)) as boolean;
    } catch (err) {}

    let apiAuth = false;
    try {
      apiAuth = await this.apiGuard.canActivate(context);
    } catch (err) {}
    return jwtAuth || apiAuth;
  }
}
