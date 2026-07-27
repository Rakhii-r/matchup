import { isDev } from '@core/config/env';

/**
 * Structured, level-based logger. Never use console.* directly in feature code.
 * Sinks can be registered via registerLogSink (e.g. a Sentry sink once wired).
 * debug/info are suppressed unless running in development.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

type Sink = (level: LogLevel, message: string, context?: LogContext) => void;

const sinks: Sink[] = [];

export function registerLogSink(sink: Sink): void {
  sinks.push(sink);
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (isDev) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${level.toUpperCase()}] ${message}`, context ?? '');
  }
  for (const sink of sinks) {
    try {
      sink(level, message, context);
    } catch {
      // A failing sink must never break the app.
    }
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};
