import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { HttpError } from './httpError';

const SESSION_COOKIE = 'audit_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Session {
  userId: string;
  expiresAt: number;
}

/**
 * Single-account sign-in for the dashboard. Credentials come from DASHBOARD_USER_ID and
 * DASHBOARD_PASSWORD in the engine's .env; sessions live in memory, so a restart signs users out.
 */
export class Auth {
  private readonly sessions = new Map<string, Session>();
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  constructor(
    private readonly userId: string,
    private readonly password: string
  ) {}

  static fromEnv(): Auth {
    const userId = process.env.DASHBOARD_USER_ID?.trim();
    const password = process.env.DASHBOARD_PASSWORD;
    if (!userId || !password) {
      throw new Error('Set DASHBOARD_USER_ID and DASHBOARD_PASSWORD in the .env file before starting the backend.');
    }
    return new Auth(userId, password);
  }

  login(req: Request, res: Response): string {
    const client = req.ip ?? 'unknown';
    const failure = this.failures.get(client);
    if (failure && failure.count >= MAX_FAILED_ATTEMPTS && Date.now() - failure.firstAt < LOCKOUT_MS) {
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
    }

    const { userId, password } = (req.body ?? {}) as { userId?: unknown; password?: unknown };
    const valid =
      typeof userId === 'string' &&
      typeof password === 'string' &&
      // Evaluate both comparisons so timing does not reveal which field was wrong.
      [safeEqual(userId.trim(), this.userId), safeEqual(password, this.password)].every(Boolean);
    if (!valid) {
      const recent = failure && Date.now() - failure.firstAt < LOCKOUT_MS ? failure : { count: 0, firstAt: Date.now() };
      this.failures.set(client, { ...recent, count: recent.count + 1 });
      throw new HttpError(401, 'Incorrect ID or password.');
    }

    this.failures.delete(client);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { userId: this.userId, expiresAt: Date.now() + SESSION_TTL_MS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: SESSION_TTL_MS,
      path: '/'
    });
    return this.userId;
  }

  logout(req: Request, res: Response): void {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) this.sessions.delete(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  currentUser(req: Request): string | null {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token ? this.sessions.get(token) : undefined;
    if (!token || !session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session.userId;
  }

  /** Express middleware: rejects requests without a valid session. */
  readonly requireSession = (req: Request, _res: Response, next: NextFunction): void => {
    next(this.currentUser(req) ? undefined : new HttpError(401, 'Please sign in.'));
  };
}

function safeEqual(actual: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
