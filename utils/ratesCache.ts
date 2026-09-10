const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
    data: any;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const evictOldestIfFull = (): void => {
    if (cache.size < MAX_ENTRIES) return;
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
};

// Runs fetchFn only on a cache miss or expiry. Callers build the key
// from whatever uniquely identifies the search (city, dates, party size).
export const getCachedRates = async (key: string, fetchFn: () => Promise<any>): Promise<any> => {
    const existing = cache.get(key);
    const now = Date.now();

    if (existing && existing.expiresAt > now) {
        return existing.data;
    }

    const data = await fetchFn();
    evictOldestIfFull();
    cache.set(key, { data, expiresAt: now + TTL_MS });
    return data;
}
