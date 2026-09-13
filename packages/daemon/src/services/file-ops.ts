import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface FileOps {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  /** Write a new file without replacing an existing path. Returns false on collision. */
  writeFileExclusive(filePath: string, content: string): Promise<boolean>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
  listFiles(dirPath: string): Promise<string[]>;
  /** Delete a file. Resolves silently if the file does not exist (ENOENT is swallowed). */
  unlink(filePath: string): Promise<void>;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function createFileOps(): FileOps {
  return {
    async readFile(filePath: string): Promise<string> {
      return fs.readFile(filePath, "utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await fs.writeFile(filePath, content, "utf-8");
    },

    async writeFileExclusive(filePath: string, content: string): Promise<boolean> {
      try {
        await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
        return true;
      } catch (error) {
        if (hasErrorCode(error, "EEXIST")) return false;
        throw error;
      }
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      await fs.rename(oldPath, newPath);
    },

    async exists(filePath: string): Promise<boolean> {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    async mkdir(dirPath: string): Promise<void> {
      await fs.mkdir(dirPath, { recursive: true });
    },

    async listFiles(dirPath: string): Promise<string[]> {
      try {
        return await fs.readdir(dirPath);
      } catch (error) {
        if (hasErrorCode(error, "ENOENT")) return [];
        throw error;
      }
    },

    async unlink(filePath: string): Promise<void> {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        // ENOENT is the only acceptable failure: deleting a missing file is a no-op.
        if (!hasErrorCode(err, "ENOENT")) throw err;
      }
    },
  };
}

export function getTempPath(filePath: string, token: string = crypto.randomUUID()): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `.${base}.${token}.tmp`);
}

export type TemporaryPathForAttempt = (filePath: string, attempt: number) => string;

const defaultTemporaryPathForAttempt: TemporaryPathForAttempt = (filePath) => getTempPath(filePath);

export async function atomicWrite(
  filePath: string,
  content: string,
  fileOps: FileOps,
  temporaryPathForAttempt: TemporaryPathForAttempt = defaultTemporaryPathForAttempt,
): Promise<void> {
  let attempt = 0;
  let tmpPath: string;
  for (;;) {
    tmpPath = temporaryPathForAttempt(filePath, attempt);
    try {
      if (await fileOps.writeFileExclusive(tmpPath, content)) break;
    } catch (error) {
      try {
        await fileOps.unlink(tmpPath);
      } catch {
        // Preserve the exclusive-write failure.
      }
      throw error;
    }
    attempt += 1;
  }
  try {
    await fileOps.rename(tmpPath, filePath);
  } catch (error) {
    try {
      await fileOps.unlink(tmpPath);
    } catch {
      // Preserve the write failure. A uniquely named temp file is safe for later cleanup.
    }
    throw error;
  }
}
