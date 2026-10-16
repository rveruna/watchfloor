import { startTicker, World } from '@shared/world';
import { createDemoApi } from '@/net/demoApi';
import { createHttpApi } from '@/net/http';
import { createDemoSocketFactory, streamUrl, webSocketFactory, type SocketFactory } from '@/net/socket';
import type { Api } from '@/net/api';
import { createLogger, type Logger } from '@/telemetry/logger';

/**
 * What the app talks to. There are two kinds, and everything above this file is the same for both: a real deployment
 * over HTTP and a websocket, or a demo that runs the same rules in the page. Stores ask for the services they need
 * here instead of building them, which is also how tests give them something else.
 */
export interface Services {
  mode: 'demo' | 'server';
  api: Api;
  socketFactory: SocketFactory;
  logger: Logger;
  now: () => number;
}

let current: Services | null = null;

export function setServices(services: Services | null): void {
  current = services;
}

export function services(): Services {
  if (!current) throw new Error('The app has not been given its services yet');
  return current;
}

export interface DemoServicesOptions {
  world?: World;
  logger?: Logger;
  /** Keep events happening on their own. Tests turn this off and make them happen by hand. */
  ticker?: boolean;
  latencyMs?: number;
  heartbeatMs?: number;
}

export function createDemoServices({
  world,
  logger = createLogger(),
  ticker = true,
  latencyMs,
  heartbeatMs,
}: DemoServicesOptions = {}): Services & { world: World } {
  const w = world ?? new World({ start: Date.now() - 40 * 3_000 });
  if (ticker) startTicker(w);
  return {
    mode: 'demo',
    world: w,
    api: createDemoApi(w, latencyMs === undefined ? {} : { latencyMs }),
    socketFactory: createDemoSocketFactory(w, heartbeatMs === undefined ? {} : { heartbeatMs }),
    logger,
    now: Date.now,
  };
}

export function createServerServices(
  location: Pick<Location, 'protocol' | 'host'> = window.location,
  logger: Logger = createLogger(),
): Services {
  return {
    mode: 'server',
    api: createHttpApi(),
    socketFactory: webSocketFactory(streamUrl(location)),
    logger,
    now: Date.now,
  };
}
