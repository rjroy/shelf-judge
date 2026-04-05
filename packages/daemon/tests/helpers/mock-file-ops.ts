import type { FileOps } from "../../src/services/file-ops.js";

export interface MockFileOps extends FileOps {
  files: Map<string, string>;
  calls: Array<{ method: string; args: string[] }>;
}

export function createMockFileOps(initialFiles?: Record<string, string>): MockFileOps {
  const files = new Map<string, string>(
    initialFiles ? Object.entries(initialFiles) : [],
  );
  const calls: Array<{ method: string; args: string[] }> = [];

  return {
    files,
    calls,

    async readFile(filePath: string): Promise<string> {
      calls.push({ method: "readFile", args: [filePath] });
      const content = files.get(filePath);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }
      return content;
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      calls.push({ method: "writeFile", args: [filePath] });
      files.set(filePath, content);
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      calls.push({ method: "rename", args: [oldPath, newPath] });
      const content = files.get(oldPath);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
      }
      files.set(newPath, content);
      files.delete(oldPath);
    },

    async exists(filePath: string): Promise<boolean> {
      calls.push({ method: "exists", args: [filePath] });
      return files.has(filePath);
    },

    async mkdir(_dirPath: string): Promise<void> {
      calls.push({ method: "mkdir", args: [_dirPath] });
      // No-op for in-memory mock
    },
  };
}
