export const CLOUD_PAGE_SIZE = 1000;

export type CloudPage<T> = {
  data: T[] | null;
  error: unknown | null;
};

/**
 * Collects every row from a PostgREST query. Supabase caps a response at
 * 1,000 rows by default, so sync code must keep requesting ranges until the
 * final short page is reached.
 */
export async function collectCloudPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<CloudPage<T>>,
  pageSize = CLOUD_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("pageSize debe ser un entero positivo");
  }

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;

    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
