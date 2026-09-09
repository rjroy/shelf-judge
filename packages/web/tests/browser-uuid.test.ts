import { expect, test } from "bun:test";
import { generateBrowserUuid } from "@/lib/browser-uuid";

function replaceCryptoMethod(method: string, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, method);
  Object.defineProperty(globalThis.crypto, method, { configurable: true, value });
  return () => {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis.crypto, method);
    else Object.defineProperty(globalThis.crypto, method, descriptor);
  };
}

test("prefers the platform UUID implementation when available", () => {
  const restore = replaceCryptoMethod("randomUUID", () => "platform-uuid");
  try {
    expect(generateBrowserUuid()).toBe("platform-uuid");
  } finally {
    restore();
  }
});

test("uses cryptographic UUIDv4 bytes when randomUUID is unavailable", () => {
  const restoreUuid = replaceCryptoMethod("randomUUID", undefined);
  const restoreValues = replaceCryptoMethod("getRandomValues", <T extends ArrayBufferView | null>(array: T): T => {
    if (!(array instanceof Uint8Array)) throw new Error("Expected UUID bytes");
    array.fill(0);
    return array;
  });
  try {
    expect(generateBrowserUuid()).toBe("00000000-0000-4000-8000-000000000000");
  } finally {
    restoreValues();
    restoreUuid();
  }
});
