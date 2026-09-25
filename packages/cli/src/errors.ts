import { toErrorMessage } from "@shelf-judge/shared";

export class StructuredCliError extends Error {
  constructor(readonly details: unknown) {
    super("The daemon rejected the command");
    this.name = "StructuredCliError";
  }
}

export function responseError(body: unknown, fallback: string): Error {
  const err = body as { error: string };
  return new Error(err.error ?? fallback);
}

export function formatCliError(error: unknown): string {
  if (error instanceof StructuredCliError) {
    return JSON.stringify(error.details, null, 2);
  }
  return toErrorMessage(error);
}
