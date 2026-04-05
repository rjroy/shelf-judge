import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface FileOps {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dirPath: string): Promise<void>;
}

export function createFileOps(): FileOps {
  return {
    async readFile(filePath: string): Promise<string> {
      return fs.readFile(filePath, "utf-8");
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await fs.writeFile(filePath, content, "utf-8");
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
  };
}

export function getTempPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `.${base}.tmp`);
}
