/**
 * Tiny tagged logger. Replaces ad-hoc `console.log('[tag] …')` calls with a
 * consistent, env-gated API while keeping output byte-identical:
 *
 *   log('lit-search-poll').info('polling', { id })
 *   // → [lit-search-poll] polling { id }
 *
 * Level mapping from the old call sites: console.log → info, console.warn →
 * warn, console.error → error. `debug` and `info` are silenced in production;
 * `warn` and `error` always emit.
 *
 * Gated on `process.env.NODE_ENV` directly (Next inlines it in both server and
 * client bundles) rather than the server-only `@/env` object, so this module is
 * safe to import from client components.
 *
 * Note: this is for stdout/console diagnostics only. Domain pipeline events that
 * must persist for in-product observability go through
 * `src/lib/workflows/lib/events.ts`, which is a separate concern.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, tag: string, args: unknown[]) {
  if (process.env.NODE_ENV === 'production' && (level === 'debug' || level === 'info')) {
    return;
  }
  const prefix = `[${tag}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export function log(tag: string): Logger {
  return {
    debug: (...args) => emit('debug', tag, args),
    info: (...args) => emit('info', tag, args),
    warn: (...args) => emit('warn', tag, args),
    error: (...args) => emit('error', tag, args),
  };
}
