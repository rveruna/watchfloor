import type { About, Ack, Device, EventsResponse, User } from '@shared/protocol';

export type ApiErrorKind =
  'network' | 'timeout' | 'unauthorized' | 'forbidden' | 'not_found' | 'server' | 'invalid_response';

/** Every way a request can fail, sorted into a few kinds the app can decide what to do about. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Worth trying again: the server or the network had a problem, not the request. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
}

export interface AcknowledgeResult {
  ack: Ack;
  /** True if someone else had got there first, so `ack` is theirs. */
  already: boolean;
}

/** What the app needs from a deployment. The real one is HTTP; the demo one answers from memory. */
export interface Api {
  about(): Promise<About>;
  login(email: string, password: string): Promise<User>;
  /** The signed-in user, or null if nobody is. */
  me(): Promise<User | null>;
  logout(): Promise<void>;
  devices(): Promise<Device[]>;
  /** Events after a sequence number, oldest first. */
  events(sinceSeq: number, limit: number): Promise<EventsResponse>;
  /** The newest events, oldest first. */
  latest(limit: number): Promise<EventsResponse>;
  acknowledge(eventId: string): Promise<AcknowledgeResult>;
}
