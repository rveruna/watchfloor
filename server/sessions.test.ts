import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memorySessions, signedSessions } from './sessions';

const operator = { name: 'Operator', role: 'operator' } as const;

describe('memory sessions', () => {
  it('remembers who signed in, and forgets them when told to', () => {
    const s = memorySessions();
    const token = s.issue(operator);
    expect(s.resolve(token)).toEqual(operator);
    s.revoke(token);
    expect(s.resolve(token)).toBeNull();
  });

  it('does not know a token it did not issue, or none at all', () => {
    const s = memorySessions();
    expect(s.resolve('made-up')).toBeNull();
    expect(s.resolve(undefined)).toBeNull();
  });
});

describe('signed sessions', () => {
  it('can be read by any copy that knows the secret, with nothing shared between them', () => {
    const token = signedSessions('secret').issue(operator);
    expect(signedSessions('secret').resolve(token)).toEqual(operator);
  });

  it('is not accepted with anything added after the signature', () => {
    const s = signedSessions('secret');
    const token = s.issue(operator);
    expect(s.resolve(token)).toEqual(operator);
    expect(s.resolve(`${token}.extra`)).toBeNull();
  });

  it('is not accepted by a copy with a different secret', () => {
    expect(signedSessions('other').resolve(signedSessions('secret').issue(operator))).toBeNull();
  });

  it('is not accepted if the user inside it was changed, even to something valid', () => {
    const s = signedSessions('secret');
    const [, signature] = s.issue({ name: 'Viewer', role: 'viewer' }).split('.');
    const forged = Buffer.from(
      JSON.stringify({ name: 'Operator', role: 'operator', exp: Date.now() + 1e9 }),
    ).toString('base64url');
    expect(s.resolve(`${forged}.${signature}`)).toBeNull();
  });

  it('runs out after eight hours', () => {
    let now = 1_000_000;
    const s = signedSessions('secret', () => now);
    const token = s.issue(operator);
    now += 8 * 3_600_000 - 1;
    expect(s.resolve(token)).toEqual(operator);
    now += 1;
    expect(s.resolve(token)).toBeNull();
  });

  it.each([undefined, '', 'nodot', 'a.b.c', '.sig', 'body.', 'not-base64.also-not'])(
    'refuses %j',
    (token) => {
      expect(signedSessions('secret').resolve(token)).toBeNull();
    },
  );

  it('refuses a correctly signed token whose content is not a user', () => {
    const body = Buffer.from('{"hello":1}').toString('base64url');
    const sig = createHmac('sha256', 'secret').update(body).digest('base64url');
    expect(signedSessions('secret').resolve(`${body}.${sig}`)).toBeNull();
    const junk = Buffer.from('not json').toString('base64url');
    expect(
      signedSessions('secret').resolve(
        `${junk}.${createHmac('sha256', 'secret').update(junk).digest('base64url')}`,
      ),
    ).toBeNull();
  });

  it('cannot be taken back before it runs out, and says so by doing nothing', () => {
    const s = signedSessions('secret');
    const token = s.issue(operator);
    s.revoke(token);
    expect(s.resolve(token)).toEqual(operator);
  });
});
