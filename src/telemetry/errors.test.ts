import { describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createLogger } from './logger';
import { installErrorHandlers } from './errors';

const blankApp = () => createApp({ render: () => null });

function fakeWindow() {
  const handlers: Record<string, (e: unknown) => void> = {};
  return {
    handlers,
    target: { addEventListener: (type: string, fn: (e: unknown) => void) => void (handlers[type] = fn) },
  };
}

describe('installErrorHandlers', () => {
  it('logs an error thrown inside a component, with where it happened, and keeps the page up', () => {
    const logger = createLogger();
    const app = blankApp();
    installErrorHandlers(app, logger, fakeWindow().target);
    app.config.errorHandler!(new Error('render blew up'), null, 'setup function');
    expect(logger.entries()).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'a component failed',
        context: { reason: 'render blew up', where: 'setup function' },
      }),
    ]);
  });

  it('logs a failure that is not an Error object', () => {
    const logger = createLogger();
    const app = blankApp();
    installErrorHandlers(app, logger, fakeWindow().target);
    app.config.errorHandler!('just a string', null, 'x');
    expect(logger.entries()[0]!.context).toMatchObject({ reason: 'just a string' });
  });

  it('logs a promise that failed with nobody waiting, and an error the page raised', () => {
    const logger = createLogger();
    const w = fakeWindow();
    installErrorHandlers(blankApp(), logger, w.target);
    w.handlers.unhandledrejection!({ reason: new Error('nobody caught this') });
    w.handlers.error!({ message: 'Script error' });
    expect(logger.entries().map((e) => [e.message, e.context])).toEqual([
      ['a promise failed and nothing handled it', { reason: 'nobody caught this' }],
      ['the page raised an error', { reason: 'Script error' }],
    ]);
  });

  it('listens on the real window by default', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    installErrorHandlers(blankApp(), createLogger());
    expect(spy).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('error', expect.any(Function));
    spy.mockRestore();
  });
});
