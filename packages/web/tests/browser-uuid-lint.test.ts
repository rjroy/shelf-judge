import { expect, test } from "bun:test";
import { ESLint } from "eslint";

const eslint = new ESLint({
  cwd: new URL("../../..", import.meta.url).pathname,
  overrideConfigFile: new URL("../../../eslint.config.js", import.meta.url).pathname,
});

async function messagesFor(source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages.map((message) => message.message) ?? [];
}

test(
  "web production code cannot call crypto.randomUUID directly",
  { timeout: 30_000 },
  async () => {
    for (const source of [
      "crypto.randomUUID();",
      "window.crypto.randomUUID();",
      "globalThis.crypto?.randomUUID();",
      'crypto["randomUUID"]();',
    ]) {
      const messages = await messagesFor(source, "packages/web/components/analyst-chat.tsx");
      expect(messages).toContain(
        "Browser UUIDs must use generateBrowserUuid() so non-secure HTTP contexts remain supported.",
      );
    }
  },
);

test("the UUID helper and Node server boundaries remain allowed", { timeout: 30_000 }, async () => {
  expect(await messagesFor("crypto.randomUUID();", "packages/web/lib/browser-uuid.ts")).toEqual([]);
  expect(
    await messagesFor("crypto.randomUUID();", "packages/daemon/src/services/file-ops.ts"),
  ).toEqual([]);
});
