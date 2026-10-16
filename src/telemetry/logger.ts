export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /** The most recent entries, oldest first. */
  entries(): LogEntry[];
  /** Calls `listener` after every entry. Returns a function that stops it. */
  subscribe(listener: (entry: LogEntry) => void): () => void;
}

export interface LoggerOptions {
  /** How many entries to remember. */
  capacity?: number;
  now?: () => number;
  /** Where to send each entry as well, such as the console or a collector. */
  sink?: (entry: LogEntry) => void;
}

/**
 * A structured log that keeps its last few entries in memory, so the app can show what has been going on without anyone
 * opening the console, and so a bug report can include it. Each entry is data (a message and a context), not a string
 * somebody has to parse.
 */
export function createLogger({ capacity = 200, now = Date.now, sink }: LoggerOptions = {}): Logger {
  const buffer: LogEntry[] = [];
  const listeners = new Set<(entry: LogEntry) => void>();

  const write = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const entry: LogEntry = context ? { at: now(), level, message, context } : { at: now(), level, message };
    buffer.push(entry);
    if (buffer.length > capacity) buffer.shift();
    sink?.(entry);
    for (const listener of listeners) listener(entry);
  };

  return {
    debug: (m, c) => write('debug', m, c),
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
    entries: () => [...buffer],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const silentLogger: Logger = createLogger({ capacity: 1 });
