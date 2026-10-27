/** Serialize local read/modify/write operations, never a network round trip. */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** A sync may acknowledge only the exact versions confirmed by its cloud snapshot. */
export function acknowledgeConfirmed<T extends { id: string; updatedAt: string; syncStatus: string }>(local: T[], cloud: T[]): T[] {
  const versions = new Map(cloud.map(row => [row.id, Date.parse(row.updatedAt)]));
  return local.map(row => Number.isFinite(versions.get(row.id)) && versions.get(row.id) === Date.parse(row.updatedAt) ? { ...row, syncStatus: "synced" } : row);
}
