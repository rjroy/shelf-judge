import { describe, expect, test } from "bun:test";
import { atomicWrite } from "../../src/services/file-ops.js";
import { createMockFileOps } from "../helpers/mock-file-ops.js";

describe("atomicWrite", () => {
  test("claims unique temp paths when concurrent writers choose the same first candidate", async () => {
    const target = "/test/data/collection.json";
    const fileOps = createMockFileOps();
    const temporaryPath = (_filePath: string, attempt: number): string =>
      `/test/data/.collection.json.${attempt}.tmp`;

    await Promise.all([
      atomicWrite(target, "first", fileOps, temporaryPath),
      atomicWrite(target, "second", fileOps, temporaryPath),
    ]);

    const claimed = fileOps.calls.filter((call) => call.method === "writeFileExclusive");
    expect(claimed.map((call) => call.args[0])).toEqual([
      "/test/data/.collection.json.0.tmp",
      "/test/data/.collection.json.0.tmp",
      "/test/data/.collection.json.1.tmp",
    ]);
    expect(fileOps.files.has("/test/data/.collection.json.0.tmp")).toBe(false);
    expect(fileOps.files.has("/test/data/.collection.json.1.tmp")).toBe(false);
    expect(new Set(["first", "second"]).has(fileOps.files.get(target) ?? "")).toBe(true);
  });

  test("removes a claimed temp file when rename fails", async () => {
    const target = "/test/data/wishlist.json";
    const temp = "/test/data/.wishlist.json.deterministic.tmp";
    const fileOps = createMockFileOps();
    fileOps.rename = () => Promise.reject(new Error("injected rename failure"));

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(atomicWrite(target, "content", fileOps, () => temp)).rejects.toThrow(
      "injected rename failure",
    );

    expect(fileOps.files.has(temp)).toBe(false);
    expect(fileOps.files.has(target)).toBe(false);
  });

  test("cleans a partial unique temp file when exclusive writing fails", async () => {
    const target = "/test/data/profile.json";
    const temp = "/test/data/.profile.json.partial.tmp";
    const fileOps = createMockFileOps();
    fileOps.writeFileExclusive = (filePath, content) => {
      fileOps.files.set(filePath, content.slice(0, 3));
      return Promise.reject(new Error("injected exclusive write failure"));
    };

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects is thenable
    await expect(atomicWrite(target, "content", fileOps, () => temp)).rejects.toThrow(
      "injected exclusive write failure",
    );

    expect(fileOps.files.has(temp)).toBe(false);
    expect(fileOps.files.has(target)).toBe(false);
  });
});
