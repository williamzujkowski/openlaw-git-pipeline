import { TIMEZONE } from './constants.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Minimal structured JSON logger */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /** Returns a function that, when called, logs elapsed ms */
  startTimer(label: string): () => void;
  /** Log current heap memory usage */
  logMemory(): void;
}

/** Create a structured console logger */
export function createLogger(
  component: string,
  minLevel: LogLevel = 'info'
): Logger {
  const minPriority = LEVEL_PRIORITY[minLevel];

  function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < minPriority) return;

    const entry: LogEntry = {
      timestamp: new Date().toLocaleString('en-US', { timeZone: TIMEZONE }),
      level,
      message,
      component,
      ...context,
    };
    const output = JSON.stringify(entry);

    if (level === 'error') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),

    startTimer(label: string): () => void {
      const start = performance.now();
      return () => {
        const elapsedMs = Math.round(performance.now() - start);
        emit('info', `${label} completed`, { elapsedMs });
      };
    },

    logMemory(): void {
      const usage = process.memoryUsage();
      emit('info', 'Memory usage', {
        heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
        rssMB: Math.round(usage.rss / 1024 / 1024),
      });
    },
  };
}
