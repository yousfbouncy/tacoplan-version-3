/**
 * Storage engine with two-phase, backwards-compatible writes.
 * Native iOS AsyncStorage writes large values to separate files. Keeping
 * chunks below 900 UTF-8 bytes avoids that file-backed path for new values.
 * The existing primary value remains untouched until all chunks are saved.
 */
export const CHUNK_MAGIC = "__tacoplan_chunked_v1__";
export const MAX_CHUNK_BYTES = 900;
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(entries: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}
type Manifest = { __tacoplan_chunked_v1__: true; prefix: string; count: number };

export function utf8Bytes(value: string): number {
  let size = 0;
  for (const codepoint of value) {
    const n = codepoint.codePointAt(0)!;
    size += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
  }
  return size;
}

export function splitUtf8Chunks(value: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 4) throw new Error("Invalid chunk size");
  const chunks: string[] = [];
  let chunk = "", size = 0;
  for (const char of value) {
    const bytes = utf8Bytes(char);
    if (chunk && size + bytes > maxBytes) {
      chunks.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += char;
    size += bytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function manifestFrom(raw: string | null): Manifest | null {
  if (!raw || !raw.startsWith('{"' + CHUNK_MAGIC + '":')) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.[CHUNK_MAGIC] !== true ||
      typeof data.prefix !== "string" ||
      !Number.isInteger(data.count) || data.count < 1 || data.count > 200_000) return null;
    return data as Manifest;
  } catch {
    return null;
  }
}

function chunkKeys(manifest: Manifest): string[] {
  return Array.from({ length: manifest.count }, (_, i) => `${manifest.prefix}:${i}`);
}

/**
 * The main value acts as the commit pointer. A failed or interrupted write
 * leaves that pointer and its previous data unchanged.
 */
export function createLargeSafeStorage(adapter: StorageAdapter, chunkLargeWrites: boolean) {
  const pending = new Map<string, Promise<unknown>>();
  const serialize = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = pending.get(key) ?? Promise.resolve();
    const op = previous.catch(() => {}).then(work);
    pending.set(key, op);
    void op.finally(() => {
      if (pending.get(key) === op) pending.delete(key);
    }).catch(() => {});
    return op;
  };

  // Reads must share the per-key queue. Otherwise a reader holding the old
  // manifest could race a writer that has committed and reclaimed old chunks.
  const read = (key: string): Promise<string | null> => serialize(key, async () => {
    const raw = await adapter.getItem(key);
    const manifest = manifestFrom(raw);
    if (!manifest) return raw; // legacy key: never discard existing user data
    const keys = chunkKeys(manifest);
    const pairs: (readonly [string, string | null])[] = [];
    for (let i = 0; i < keys.length; i += 40) {
      pairs.push(...await adapter.multiGet(keys.slice(i, i + 40)));
    }
    if (pairs.length !== manifest.count || pairs.some(([, value]) => value === null)) {
      // Report corruption, never treat an incomplete journal as an empty one.
      throw new Error("Tacoplan: incomplete local storage document; do not overwrite");
    }
    return pairs.map(([, value]) => value!).join("");
  });

  const write = (key: string, value: string) => serialize(key, async () => {
    if (!chunkLargeWrites || utf8Bytes(value) <= MAX_CHUNK_BYTES) {
      const old = manifestFrom(await adapter.getItem(key));
      await adapter.setItem(key, value);
      if (old) {
        const keys = chunkKeys(old);
        for (let i = 0; i < keys.length; i += 40) {
          await adapter.multiRemove(keys.slice(i, i + 40)).catch(() => {});
        }
      }
      return;
    }

    const previous = manifestFrom(await adapter.getItem(key));
    const chunks = splitUtf8Chunks(value);
    const prefix = `${key}:tacoplan-chunk:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < chunks.length; i += 40) {
      const entries = chunks.slice(i, i + 40).map((part, j): [string, string] => [
        `${prefix}:${i + j}`, part,
      ]);
      await adapter.multiSet(entries);
    }
    const next: Manifest = { [CHUNK_MAGIC]: true, prefix, count: chunks.length };
    await adapter.setItem(key, JSON.stringify(next));
    if (previous) {
      // Cleanup only AFTER commit. Never delete the data used by the
      // current manifest or the legacy value before its replacement.
      const keys = chunkKeys(previous);
      for (let i = 0; i < keys.length; i += 40) {
        await adapter.multiRemove(keys.slice(i, i + 40)).catch(() => {});
      }
    }
  });

  const remove = (key: string) => serialize(key, async () => {
    const previous = manifestFrom(await adapter.getItem(key));
    await adapter.removeItem(key);
    if (previous) {
      const keys = chunkKeys(previous);
      for (let i = 0; i < keys.length; i += 40) {
        await adapter.multiRemove(keys.slice(i, i + 40)).catch(() => {});
      }
    }
  });
  return { read, write, remove };
}
