export interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function serializeDiagnostic(value: object): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) return "[Circular]";
        seen.add(nestedValue);
      }
      if (nestedValue instanceof Error) {
        return {
          ...nestedValue,
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
          cause: nestedValue.cause,
        };
      }
      if (typeof nestedValue === "bigint") return nestedValue.toString();
      return nestedValue;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[Unable to serialize diagnostic: ${message}]`;
  }
}

function formatArguments(args: unknown[]): unknown[] {
  return args.map((arg) =>
    typeof arg === "object" && arg !== null ? serializeDiagnostic(arg) : arg,
  );
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    log(...args: unknown[]): void {
      console.log(prefix, ...formatArguments(args));
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...formatArguments(args));
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...formatArguments(args));
    },
  };
}
