import type { FileMetadata, FileOps } from "../../src/services/file-ops.js";

export interface MockFileOps extends FileOps {
  files: Map<string, string>;
  metadata: Map<string, FileMetadata>;
  calls: Array<{ method: string; args: string[] }>;
}

export function createMockFileOps(initialFiles?: Record<string, string>): MockFileOps {
  const files = new Map<string, string>(initialFiles ? Object.entries(initialFiles) : []);
  const metadata = new Map<string, FileMetadata>();
  const calls: Array<{ method: string; args: string[] }> = [];
  let clock = 1n;
  let inode = 1n;
  const nextMetadata = (content: string): FileMetadata => {
    const tick = clock++;
    return {
      dev: 1n,
      ino: inode++,
      size: BigInt(Buffer.byteLength(content)),
      mtimeNs: tick,
      ctimeNs: tick,
      isFile: true,
    };
  };
  for (const [filePath, content] of files) metadata.set(filePath, nextMetadata(content));

  return {
    files,
    metadata,
    calls,

    readFile(filePath: string): Promise<string> {
      calls.push({ method: "readFile", args: [filePath] });
      const content = files.get(filePath);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, open '${filePath}'`));
      }
      return Promise.resolve(content);
    },

    stat(filePath: string): Promise<FileMetadata> {
      calls.push({ method: "stat", args: [filePath] });
      const value = metadata.get(filePath);
      if (!files.has(filePath) || !value) {
        const error = Object.assign(new Error("missing file"), { code: "ENOENT" });
        return Promise.reject(error);
      }
      return Promise.resolve({ ...value });
    },

    writeFile(filePath: string, content: string): Promise<void> {
      calls.push({ method: "writeFile", args: [filePath] });
      files.set(filePath, content);
      metadata.set(filePath, nextMetadata(content));
      return Promise.resolve();
    },

    writeFileExclusive(filePath: string, content: string): Promise<boolean> {
      calls.push({ method: "writeFileExclusive", args: [filePath] });
      if (files.has(filePath)) return Promise.resolve(false);
      files.set(filePath, content);
      metadata.set(filePath, nextMetadata(content));
      return Promise.resolve(true);
    },

    rename(oldPath: string, newPath: string): Promise<void> {
      calls.push({ method: "rename", args: [oldPath, newPath] });
      const content = files.get(oldPath);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file or directory, rename '${oldPath}'`));
      }
      files.set(newPath, content);
      files.delete(oldPath);
      const temporaryMetadata = metadata.get(oldPath);
      metadata.delete(oldPath);
      metadata.set(
        newPath,
        temporaryMetadata ? { ...temporaryMetadata, ctimeNs: clock++ } : nextMetadata(content),
      );
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

    listFiles(dirPath: string): Promise<string[]> {
      calls.push({ method: "listFiles", args: [dirPath] });
      const prefix = `${dirPath}/`;
      return Promise.resolve(
        [...files.keys()]
          .filter((filePath) => filePath.startsWith(prefix))
          .map((filePath) => filePath.slice(prefix.length))
          .filter((fileName) => !fileName.includes("/")),
      );
    },

    unlink(filePath: string): Promise<void> {
      calls.push({ method: "unlink", args: [filePath] });
      // ENOENT is swallowed in production; mirror that here.
      files.delete(filePath);
      metadata.delete(filePath);
      return Promise.resolve();
    },
  };
}
