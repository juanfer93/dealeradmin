import * as argon2 from 'argon2';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { parseEnvironment } from '@dealeradmin/config';

@Injectable()
export class AuthService {
  async authenticate(username: string, password: string): Promise<string> {
    const env = parseEnvironment();
    const matchesUsername = username === env.ADMIN_USERNAME;
    const matchesPassword = matchesUsername && await argon2.verify(env.ADMIN_PASSWORD_HASH, password);
    if (!matchesUsername || !matchesPassword) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return jwt.sign({ sub: env.ADMIN_USERNAME, role: 'admin' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
  }

  verifySession(token: string | undefined): boolean {
    if (!token) return false;
    try {
      const env = parseEnvironment();
      jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
      return true;
    } catch {
      return false;
    }
  }
}
