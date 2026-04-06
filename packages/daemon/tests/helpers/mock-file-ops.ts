import type { FileOps } from "../../src/services/file-ops.js";

export interface MockFileOps extends FileOps {
  files: Map<string, string>;
  calls: Array<{ method: string; args: string[] }>;
}

export function createMockFileOps(initialFiles?: Record<string, string>): MockFileOps {
  const files = new Map<string, string>(initialFiles ? Object.entries(initialFiles) : []);
  const calls: Array<{ method: string; args: string[] }> = [];

  return {
    files,
    calls,

    readFile(filePath: string): Promise<string> {
      calls.push({ method: "readFile", args: [filePath] });
      const content = files.get(filePath);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, open '${filePath}'`));
      }
      return Promise.resolve(content);
    },

    writeFile(filePath: string, content: string): Promise<void> {
      calls.push({ method: "writeFile", args: [filePath] });
      files.set(filePath, content);
      return Promise.resolve();
    },

    rename(oldPath: string, newPath: string): Promise<void> {
      calls.push({ method: "rename", args: [oldPath, newPath] });
      const content = files.get(oldPath);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, rename '${oldPath}'`));
      }
      files.set(newPath, content);
      files.delete(oldPath);
      return Promise.resolve();
    },

    exists(filePath: string): Promise<boolean> {
      calls.push({ method: "exists", args: [filePath] });
      return Promise.resolve(files.has(filePath));
    },

    mkdir(_dirPath: string): Promise<void> {
      calls.push({ method: "mkdir", args: [_dirPath] });
      // No-op for in-memory mock
      return Promise.resolve();
    },
  };
}
