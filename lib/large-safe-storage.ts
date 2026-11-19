/**
 * Stores large JSON documents in small, SQLite-inline AsyncStorage values on
 * iOS. AsyncStorage's iOS implementation writes large entries to separate
 * files; one of those native file writes triggered an uncaught ObjC exception
 * in the 3.0.6 TestFlight crash log.
 *
 * Two-phase commit:
 * 1. Keep the previous value/manifest untouched.
 * 2. Write every new chunk under unique keys.
 * 3. Switch the primary key to a small manifest ONLY after all chunks exist.
 * Interrupted writes never replace the last committed document.
 *
 * This module deliberately does not delete old chunks automatically: a
 * corrupt/missing chunk must not cause removal of the only good backup.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const MAGIC = "__tacoplan_chunked_v1__";
const MAX_CHUNK_BYTES = 900;
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
  const result: string[] = [];
  let chunk = "";
  let length = 0;
  for (const char of value) {
    const bytes = utf8Bytes(char);
    if (length + bytes > maxBytes && chunk) {
      result.push(chunk);
      chunk = "";
      length = 0;
    }
    chunk += char;
    length += bytes;
  }
  if (chunk) result.push(chunk);
  return result;
}

function readManifest(raw: string | null): Manifest | null {
  if (!raw || !raw.startsWith('{"' + MAGIC + '":')) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.[MAGIC] !== true ||
        typeof value.prefix !== "string" ||
        !Number.isInteger(value.count) || value.count < 1 || value.count > 200_000) return null;
    return value as Manifest;
  } catch {
    return null;
  }
}

export async function getLargeSafeItem(key: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key);
  const manifest = readManifest(raw);
  if (!manifest) return raw; // backwards-compatible with all existing values
  const keys = Array.from({ length: manifest.count }, (_, i) => `${manifest.prefix}:${i}`);
  const entries: [string, string | null][] = [];
  for (let i = 0; i < keys.length; i += 40) {
    entries.push(...await AsyncStorage.multiGet(keys.slice(i, i + 40)));
  }
  if (entries.length !== manifest.count || entries.some(([_, value]) => value === null)) {
    // Never mistake incomplete storage for an empty history.
    throw new Error("Tacoplan: incomplete local storage document; cloud data preserved");
  }
  return entries.map(([_, value]) => value!).join("");
}

const pending = new Map<string, Promise<void>>();
function serialize(key: string, work: () => Promise<void>): Promise<void> {
  const previous = pending.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(work);
  pending.set(key, operation);
  void operation.finally(() => {
    if (pending.get(key) === operation) pending.delete(key);
  }).catch(() => {});
  return operation;
}

export function setLargeSafeItem(key: string, value: string): Promise<void> {
  return serialize(key, async () => {
    if (Platform.OS !== "ios" || utf8Bytes(value) <= MAX_CHUNK_BYTES) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    const chunks = splitUtf8Chunks(value);
    // The key is intentionally never reused so that a power loss or failed
    // write cannot overwrite the previously committed document.
    const prefix = `${key}:tacoplan-chunk:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < chunks.length; i += 40) {
      const slice = chunks.slice(i, i + 40).map((part, j): [string, string] => [
        `${prefix}:${i + j}`, part,
      ]);
      await AsyncStorage.multiSet(slice);
    }
    const manifest: Manifest = { [MAGIC]: true, prefix, count: chunks.length };
    await AsyncStorage.setItem(key, JSON.stringify(manifest));
  });
}

export function removeLargeSafeItem(key: string): Promise<void> {
  return serialize(key, () => AsyncStorage.removeItem(key));
}
