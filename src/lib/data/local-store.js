import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createEmptyJsonStore, normalizeJsonStore } from "./schema.js";

export const LOCAL_STORE_FILE_NAME = "attention-regain-store.json";

const storeOperationLocks = new Map();

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
    return this.readUnlocked();
  }

  async readUnlocked({ lockOnMissing = true } = {}) {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeJsonStore(JSON.parse(raw));
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        const empty = createEmptyJsonStore();
        if (lockOnMissing) {
          await this.write(empty);
        } else {
          await this.writeUnlocked(empty);
        }
        return empty;
      }

      throw error;
    }
  }

  async write(nextStore) {
    return withStoreOperationLock(this.filePath, () => this.writeUnlocked(nextStore));
  }

  async writeUnlocked(nextStore) {
    const normalized = normalizeJsonStore(nextStore);
    await mkdir(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
    return normalized;
  }

  async update(mutator) {
    return withStoreOperationLock(this.filePath, async () => {
      const current = await this.readUnlocked({ lockOnMissing: false });
      const next = await mutator(current);
      return this.writeUnlocked(next || current);
    });
  }

  async reset(seed = createEmptyJsonStore()) {
    return this.write(seed);
  }
}

export function createLocalJsonStore(options) {
  return new LocalJsonStore(options);
}

async function withStoreOperationLock(filePath, operation) {
  const previous = storeOperationLocks.get(filePath) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const nextLock = previous.then(() => current, () => current);
  storeOperationLocks.set(filePath, nextLock);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (storeOperationLocks.get(filePath) === nextLock) {
      storeOperationLocks.delete(filePath);
    }
  }
}
