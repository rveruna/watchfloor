import { z } from 'zod';

/**
 * The contract between the app and whatever feeds it: the REST responses and the messages on the stream. The
 * browser, the mock server and the tests all read and write through these schemas, so none of them can drift.
 */

export const severitySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof severitySchema>;

export const deviceKindSchema = z.enum(['camera', 'door', 'sensor']);
export const deviceStatusSchema = z.enum(['online', 'degraded', 'offline']);

export const deviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: deviceKindSchema,
  site: z.string().min(1),
  status: deviceStatusSchema,
});
export type Device = z.infer<typeof deviceSchema>;

export const eventKindSchema = z.enum([
  'motion',
  'door_open',
  'tamper',
  'went_offline',
  'came_online',
  'alarm',
]);

export const ackSchema = z.object({ by: z.string().min(1), at: z.string() });
export type Ack = z.infer<typeof ackSchema>;

export const eventSchema = z.object({
  id: z.string().min(1),
  /** A number that goes up by one for every event the server produces, so a client can tell it missed some. */
  seq: z.number().int().positive(),
  at: z.string(),
  deviceId: z.string().min(1),
  kind: eventKindSchema,
  severity: severitySchema,
  message: z.string().min(1),
  ack: ackSchema.optional(),
});
export type MonitorEvent = z.infer<typeof eventSchema>;

export const roleSchema = z.enum(['viewer', 'operator']);
export type Role = z.infer<typeof roleSchema>;

/** What a deployment says about itself, so the app can switch features on and off to match. */
export const aboutSchema = z.object({
  version: z.string(),
  product: z.literal('monitor'),
  features: z.array(z.string()),
});
export type About = z.infer<typeof aboutSchema>;

export const userSchema = z.object({ name: z.string().min(1), role: roleSchema });
export type User = z.infer<typeof userSchema>;

export const devicesResponseSchema = z.object({ devices: z.array(deviceSchema) });
export const eventsResponseSchema = z.object({
  events: z.array(eventSchema),
  /** The highest sequence number the server has produced, even if it is not in this page. */
  lastSeq: z.number().int().nonnegative(),
  /** True if there are more events after the last one in this page. */
  more: z.boolean(),
});
export type EventsResponse = z.infer<typeof eventsResponseSchema>;

export const loginRequestSchema = z.object({ email: z.string().min(1), password: z.string().min(1) });

// ---- the stream -----------------------------------------------------------------------------------------------

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    serverTime: z.string(),
    lastSeq: z.number().int().nonnegative(),
    heartbeatMs: z.number().int().positive(),
  }),
  z.object({ type: z.literal('event'), event: eventSchema }),
  z.object({ type: z.literal('ack'), eventId: z.string(), ack: ackSchema }),
  z.object({ type: z.literal('device'), device: deviceSchema }),
  z.object({ type: z.literal('ping'), at: z.string() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), sinceSeq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('pong'), at: z.string() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Turns text from the wire into a message, or says why it could not. Never throws. */
export function parseServerMessage(
  text: string,
): { ok: true; message: ServerMessage } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const result = serverMessageSchema.safeParse(json);
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, reason: result.error.issues[0]?.message ?? 'invalid' };
}

export function parseClientMessage(text: string): ClientMessage | null {
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
