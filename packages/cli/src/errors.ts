export class StructuredCliError extends Error {
  constructor(readonly details: unknown) {
    super("The daemon rejected the command");
    this.name = "StructuredCliError";
  }
}

export function formatCliError(error: unknown): string {
  if (error instanceof StructuredCliError) {
    return JSON.stringify(error.details, null, 2);
  }
  return error instanceof Error ? error.message : String(error);
}
