import type { App } from 'vue';
import type { Logger } from './logger';

/**
 * Catches what nobody else did: an error thrown while a component renders or runs, a promise that failed with no one
 * waiting, any error the page itself raised. Each goes to the log with enough to find it, and the page stays up.
 */
export function installErrorHandlers(
  app: App,
  logger: Logger,
  target: Pick<Window, 'addEventListener'> = window,
): void {
  app.config.errorHandler = (error, _instance, info) => {
    logger.error('a component failed', { reason: describe(error), where: info });
  };
  target.addEventListener('unhandledrejection', (e) => {
    logger.error('a promise failed and nothing handled it', {
      reason: describe((e as PromiseRejectionEvent).reason),
    });
  });
  target.addEventListener('error', (e) => {
    logger.error('the page raised an error', { reason: (e as ErrorEvent).message });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
