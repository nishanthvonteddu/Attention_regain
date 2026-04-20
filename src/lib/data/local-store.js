import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { createEmptyJsonStore, normalizeJsonStore } from "./schema.js";

export const LOCAL_STORE_FILE_NAME = "attention-regain-store.json";

export function getLocalDataDir(env = process.env) {
  const configured = typeof env.ATTENTION_REGAIN_DATA_DIR === "string"
    ? env.ATTENTION_REGAIN_DATA_DIR.trim()
    : "";
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".data");
}

export class LocalJsonStore {
  constructor({ dataDir = getLocalDataDir(), fileName = LOCAL_STORE_FILE_NAME } = {}) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, fileName);
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeJsonStore(JSON.parse(raw));
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        const empty = createEmptyJsonStore();
        await this.write(empty);
        return empty;
      }

      throw error;
    }
  }

  async write(nextStore) {
    const normalized = normalizeJsonStore(nextStore);
    await mkdir(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
    return normalized;
  }

  async update(mutator) {
    const current = await this.read();
    const next = await mutator(current);
    return this.write(next || current);
  }

  async reset(seed = createEmptyJsonStore()) {
    return this.write(seed);
  }
}

export function createLocalJsonStore(options) {
  return new LocalJsonStore(options);
}
