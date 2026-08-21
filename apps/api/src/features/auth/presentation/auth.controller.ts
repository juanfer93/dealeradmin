import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { LoginSchema } from '@dealeradmin/contracts';
import { parseEnvironment } from '@dealeradmin/config';
import { AuthService } from '../application/auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response): Promise<{ ok: true }> {
    const credentials = LoginSchema.parse(body);
    const token = await this.authService.authenticate(credentials.username, credentials.password);
    const env = parseEnvironment();
    response.cookie('dealeradmin_session', token, {
      httpOnly: true,
      secure: env.NODE_ENV !== 'development',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });
    return { ok: true };
  }

  @Get('session')
  session(@Req() request: Request): { authenticated: boolean } {
    return { authenticated: this.authService.verifySession(request.cookies?.dealeradmin_session) };
  }
}
