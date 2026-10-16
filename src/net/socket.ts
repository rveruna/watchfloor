import { parseClientMessage, type ServerMessage } from '@shared/protocol';
import type { World } from '@shared/world';

export interface SocketHandlers {
  open(): void;
  message(text: string): void;
  close(info: { clean: boolean; code: number }): void;
}

export interface Socket {
  send(text: string): void;
  close(): void;
}

/** Makes a connection and reports what happens to it through the handlers. Real and demo versions both fit this. */
export type SocketFactory = (handlers: SocketHandlers) => Socket;

export function webSocketFactory(url: string, WebSocketImpl: typeof WebSocket = WebSocket): SocketFactory {
  return (handlers) => {
    const ws = new WebSocketImpl(url);
    ws.onopen = () => handlers.open();
    ws.onmessage = (e) => handlers.message(typeof e.data === 'string' ? e.data : '');
    // an error is always followed by a close, which is where it is handled
    ws.onclose = (e) => handlers.close({ clean: e.wasClean, code: e.code });
    return {
      send: (text) => ws.send(text),
      close: () => ws.close(),
    };
  };
}

/** The address of the stream on the same host as the page. */
export function streamUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/stream`;
}

export interface DemoSocketOptions {
  heartbeatMs?: number;
}

/**
 * A stand-in for the server's stream that runs in the page, against the same World the server would use. It follows the
 * same rules: say hello, wait to be asked for events, replay what was missed, then send each new thing as it happens.
 */
export function createDemoSocketFactory(
  world: World,
  { heartbeatMs = 10_000 }: DemoSocketOptions = {},
): SocketFactory {
  return (handlers) => {
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const send = (message: ServerMessage) => {
      if (!closed) handlers.message(JSON.stringify(message));
    };
    const finish = (clean: boolean, code: number) => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      setTimeout(() => handlers.close({ clean, code }), 0);
    };

    setTimeout(() => {
      if (closed) return;
      handlers.open();
      send({ type: 'hello', serverTime: new Date().toISOString(), lastSeq: world.lastSeq, heartbeatMs });
      heartbeat = setInterval(() => send({ type: 'ping', at: new Date().toISOString() }), heartbeatMs);
    }, 0);

    return {
      send(text) {
        const message = parseClientMessage(text);
        if (message?.type !== 'subscribe' || closed || unsubscribe) return;
        for (const event of world.eventsSince(message.sinceSeq, 10_000).events)
          send({ type: 'event', event });
        unsubscribe = world.subscribe(send);
      },
      close: () => finish(true, 1000),
    };
  };
}
