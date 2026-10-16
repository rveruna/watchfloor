import { startTicker, World } from '../shared/world.js';
import { worldDeployment } from './deployment.js';
import { createDeploymentServer, type RunningServer } from './core.js';
import { memorySessions } from './sessions.js';

/**
 * A stand-in for a real deployment, so the app can be developed and tested against something that speaks HTTP and a
 * websocket. It runs the same World the in-page demo runs, kept in this process's memory.
 */

export interface MockServerOptions {
  world?: World;
  /** Where the built app is, to serve it from the same address. */
  staticDir?: string;
  heartbeatMs?: number;
  /** Keep events happening on their own. Tests turn this off. */
  ticker?: boolean;
}

export interface MockServer extends RunningServer {
  world: World;
}

export function createMockServer({
  world = new World({ start: Date.now() - 40 * 3_000 }),
  staticDir,
  heartbeatMs = 10_000,
  ticker = true,
}: MockServerOptions = {}): MockServer {
  const stopTicker = ticker ? startTicker(world) : () => {};
  const running = createDeploymentServer({
    deployment: worldDeployment(world),
    sessions: memorySessions(),
    ...(staticDir ? { staticDir } : {}),
    heartbeatMs,
  });
  return {
    ...running,
    world,
    close: () => {
      stopTicker();
      return running.close();
    },
  };
}
