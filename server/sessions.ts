import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { roleSchema, type User } from '../shared/protocol.js';
import { z } from 'zod';

/** How the server remembers who has signed in. */
export interface Sessions {
  /** Makes a token for this user, to be sent as the cookie value. */
  issue(user: User): string;
  /** The user for a token, or null if it is unknown, forged or out of date. */
  resolve(token: string | undefined): User | null;
  /** Forgets a token, if this kind of session can. */
  revoke(token: string): void;
}

/** Remembers sessions in memory. Fine for one process; useless when there are several. */
export function memorySessions(): Sessions {
  const sessions = new Map<string, User>();
  return {
    issue(user) {
      const token = randomUUID();
      sessions.set(token, user);
      return token;
    },
    resolve: (token) => (token ? (sessions.get(token) ?? null) : null),
    revoke: (token) => void sessions.delete(token),
  };
}

const payloadSchema = z.object({ name: z.string(), role: roleSchema, exp: z.number() });
const SESSION_MS = 8 * 3_600_000;

/**
 * Puts the user inside the token and signs it, so any instance can check it without sharing anything with the others.
 * The cost is that a token cannot be taken back before it runs out, so signing out only clears the cookie.
 */
export function signedSessions(secret: string, now: () => number = Date.now): Sessions {
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64url');
  return {
    issue(user) {
      const body = Buffer.from(
        JSON.stringify({ name: user.name, role: user.role, exp: now() + SESSION_MS }),
      ).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    resolve(token) {
      if (!token) return null;
      const [body, signature, ...extra] = token.split('.');
      if (!body || !signature || extra.length > 0) return null;
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString()));
        if (!parsed.success || parsed.data.exp <= now()) return null;
        return { name: parsed.data.name, role: parsed.data.role };
      } catch {
        return null;
      }
    },
    revoke: () => {},
  };
}
