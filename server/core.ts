import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { loginRequestSchema, parseClientMessage, type ServerMessage, type User } from '../shared/protocol.js';
import type { Deployment } from './deployment.js';
import type { Sessions } from './sessions.js';

/**
 * Puts a deployment behind the routes the app expects: cookie sign-in, REST for devices and events, an acknowledge call
 * that only operators may make, and a stream. What the deployment is, and how sessions are kept, are passed in.
 */

export interface ServerOptions {
  deployment: Deployment;
  sessions: Sessions;
  /** Where the built app is, to serve it from the same address. */
  staticDir?: string;
  heartbeatMs?: number;
  /** Mark the cookie Secure, for use over HTTPS. */
  secureCookies?: boolean;
}

export interface RunningServer {
  server: Server;
  /** Starts listening; resolves with the port. */
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  /** The number of streams currently open. */
  connections(): number;
  /** Cuts every stream without a goodbye, as a network failure would. */
  dropAll(): void;
}

const COOKIE = 'wf';
const MAX_BODY = 10_000;
const MAX_LIMIT = 1_000;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};

export function createDeploymentServer({
  deployment,
  sessions,
  staticDir,
  heartbeatMs = 10_000,
  secureCookies = false,
}: ServerOptions): RunningServer {
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const flags = `HttpOnly; SameSite=Lax; Path=/${secureCookies ? '; Secure' : ''}`;

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) send(res, 500, { error: 'server error' });
      else res.end();
      console.error(error);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const user = userFor(req);
    if (url.pathname !== '/api/v1/stream' || !user) {
      socket.write(
        `HTTP/1.1 ${user ? 404 : 401} ${user ? 'Not Found' : 'Unauthorized'}\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => stream(ws));
  });

  function stream(ws: WebSocket): void {
    sockets.add(ws);
    let unfollow: (() => void) | null = null;
    const write = (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    void deployment
      .lastSeq()
      .then((lastSeq) =>
        write({ type: 'hello', serverTime: new Date().toISOString(), lastSeq, heartbeatMs }),
      );
    const heartbeat = setInterval(() => write({ type: 'ping', at: new Date().toISOString() }), heartbeatMs);
    ws.on('message', (data) => {
      const message = parseClientMessage(data.toString());
      if (message?.type !== 'subscribe' || unfollow) return;
      unfollow = deployment.follow(message.sinceSeq, write);
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      unfollow?.();
      sockets.delete(ws);
    });
    ws.on('error', () => ws.terminate());
  }

  function tokenOf(req: IncomingMessage): string | undefined {
    return req.headers.cookie
      ?.split(';')
      .map((c) => c.trim().split('='))
      .find(([name]) => name === COOKIE)?.[1];
  }

  function userFor(req: IncomingMessage): User | null {
    return sessions.resolve(tokenOf(req));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (!path.startsWith('/api/')) return serveStatic(path, res);

    if (path === '/api/v1/about' && method === 'GET') return send(res, 200, deployment.about());

    if (path === '/api/v1/dologin' && method === 'POST') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      const parsed = loginRequestSchema.safeParse(body);
      const user = parsed.success ? deployment.authenticate(parsed.data.email, parsed.data.password) : null;
      if (!user) return send(res, 401, { error: 'wrong email or password' });
      return send(res, 200, user, { 'Set-Cookie': `${COOKIE}=${sessions.issue(user)}; ${flags}` });
    }

    if (path === '/api/v1/logout' && method === 'POST') {
      const token = tokenOf(req);
      if (token) sessions.revoke(token);
      return send(res, 200, {}, { 'Set-Cookie': `${COOKIE}=; ${flags}; Max-Age=0` });
    }

    const user = userFor(req);
    if (!user) return send(res, 401, { error: 'not signed in' });

    if (path === '/api/v1/me' && method === 'GET') return send(res, 200, user);
    if (path === '/api/v1/devices' && method === 'GET')
      return send(res, 200, { devices: await deployment.devices() });

    if (path === '/api/v1/events' && method === 'GET') {
      const sinceSeq = intParam(url, 'sinceSeq', 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = intParam(url, 'limit', 100, 1, MAX_LIMIT);
      if (sinceSeq === null || limit === null)
        return send(res, 400, { error: 'sinceSeq and limit must be whole numbers in range' });
      return send(res, 200, await deployment.eventsSince(sinceSeq, limit));
    }

    if (path === '/api/v1/events/latest' && method === 'GET') {
      const limit = intParam(url, 'limit', 100, 1, MAX_LIMIT);
      if (limit === null) return send(res, 400, { error: 'limit must be a whole number in range' });
      return send(res, 200, await deployment.latest(limit));
    }

    const ack = /^\/api\/v1\/events\/([^/]+)\/ack$/.exec(path);
    if (ack && method === 'POST') {
      const result = await deployment.acknowledge(decodeURIComponent(ack[1]!), user);
      if (result.status === 'forbidden') return send(res, 403, { error: 'only an operator can acknowledge' });
      if (result.status === 'missing') return send(res, 404, { error: 'no such event' });
      return send(res, 200, { ack: result.ack, already: result.status === 'already' });
    }

    return send(res, 404, { error: 'not found' });
  }

  function serveStatic(path: string, res: ServerResponse): void {
    if (!staticDir) return send(res, 404, { error: 'not found' });
    const root = resolve(staticDir);
    const wanted = resolve(join(root, normalize(decodeURIComponent(path))));
    // never serve anything outside the folder, whatever the path says
    const inside = wanted === root || wanted.startsWith(root + sep);
    const file =
      inside && existsSync(wanted) && statSync(wanted).isFile() ? wanted : join(root, 'index.html');
    if (!existsSync(file)) return send(res, 404, { error: 'not built' });
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }

  return {
    server,
    listen: (port = 0) =>
      new Promise((resolvePort) => {
        server.listen(port, () => {
          const address = server.address();
          resolvePort(typeof address === 'object' && address ? address.port : port);
        });
      }),
    close: () =>
      new Promise((resolveClose) => {
        for (const ws of sockets) ws.terminate();
        wss.close();
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
    connections: () => sockets.size,
    dropAll: () => {
      for (const ws of sockets) ws.terminate();
    },
  };
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/** A whole number from the query string, the default if absent, or null if present but not valid. */
function intParam(url: URL, name: string, fallback: number, min: number, max: number): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/** Reads a small JSON body. Answers with an error itself and returns undefined if it cannot. */
async function readJson(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      send(res, 413, { error: 'too large' });
      req.destroy();
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || 'null');
  } catch {
    send(res, 400, { error: 'not JSON' });
    return undefined;
  }
}
