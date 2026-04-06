export interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    log(...args: unknown[]): void {
      console.log(prefix, ...args);
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...args);
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...args);
    },
  };
}
