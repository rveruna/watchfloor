import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from './protocol';

const event = {
  id: 'evt-1',
  seq: 1,
  at: '2026-10-16T09:00:01.000Z',
  deviceId: 'cam-lobby',
  kind: 'motion',
  severity: 'info',
  message: 'Motion',
};

describe('parseServerMessage', () => {
  it('reads a good event', () => {
    const result = parseServerMessage(JSON.stringify({ type: 'event', event }));
    expect(result).toEqual({ ok: true, message: { type: 'event', event } });
  });

  it('reads hello, ack, device and ping', () => {
    expect(parseServerMessage('{"type":"hello","serverTime":"t","lastSeq":0,"heartbeatMs":1000}').ok).toBe(
      true,
    );
    expect(parseServerMessage('{"type":"ack","eventId":"e","ack":{"by":"a","at":"t"}}').ok).toBe(true);
    expect(
      parseServerMessage(
        '{"type":"device","device":{"id":"d","name":"n","kind":"door","site":"s","status":"offline"}}',
      ).ok,
    ).toBe(true);
    expect(parseServerMessage('{"type":"ping","at":"t"}').ok).toBe(true);
  });

  it.each([
    ['not JSON', 'hello there'],
    ['an unknown type', '{"type":"explode"}'],
    ['a missing field', '{"type":"event","event":{"id":"x"}}'],
    ['a bad severity', JSON.stringify({ type: 'event', event: { ...event, severity: 'urgent' } })],
    ['a sequence number of zero', JSON.stringify({ type: 'event', event: { ...event, seq: 0 } })],
    ['a bare number', '42'],
    ['null', 'null'],
  ])('says why it cannot read %s, and does not throw', (_name, text) => {
    const result = parseServerMessage(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('parseClientMessage', () => {
  it('reads subscribe and pong', () => {
    expect(parseClientMessage('{"type":"subscribe","sinceSeq":4}')).toEqual({
      type: 'subscribe',
      sinceSeq: 4,
    });
    expect(parseClientMessage('{"type":"pong","at":"t"}')).toEqual({ type: 'pong', at: 't' });
  });

  it.each(['', 'nope', '{"type":"subscribe","sinceSeq":-1}', '{"type":"x"}'])(
    'returns null for %j',
    (text) => {
      expect(parseClientMessage(text)).toBeNull();
    },
  );
});
