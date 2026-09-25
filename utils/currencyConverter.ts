// Currency module — split into two deliberately separate paths:
//
// 1. Display-rate table (getDisplayRates / startRateRefreshSchedule):
//    scheduled fetch, cached in memory, refreshed periodically. This is
//    what powers the multi-currency dropdown on both hotel and flight
//    pages — browsing only, never what gets charged.
//
// 2. Checkout conversion (convertForCheckout): always hits the API fresh,
//    never reads the cache above. Only for the amount actually sent to
//    Paystack — right now that's the Duffel GBP->NGN flight charge (see
//    the TODO below; hotels never need this, LiteAPI already returns NGN
//    directly).
//
// Source: open.er-api.com (no API key, free, updates once daily). Their
// own guidance is to not poll more than once an hour, ideally once a day,
// since the underlying data doesn't change more often than that anyway —
// see CACHE_REFRESH_INTERVAL_MS below.

const OPEN_ER_API_BASE_URL = "https://open.er-api.com/v6/latest";
const DISPLAY_TABLE_BASE = "USD";

// Comfortably inside both "don't poll more than once an hour" and the 24h
// window the source itself refreshes on.
const CACHE_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

interface OpenErApiResponse {
    result: string;
    base_code: string;
    rates: Record<string, number>;
    time_last_update_unix: number;
    time_next_update_unix: number;
}

export interface ExchangeRateTable {
    baseCode: string;
    rates: Record<string, number>;
    fetchedAt: number;
}

let cachedTable: ExchangeRateTable | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const fetchRateTable = async (base: string): Promise<ExchangeRateTable> => {
    const response = await fetch(`${OPEN_ER_API_BASE_URL}/${base.toUpperCase()}`);

    if (!response.ok) {
        throw new Error(`open.er-api.com request failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenErApiResponse;

    if(data.result !== "success" || !data.rates) {
        throw new Error("open.er-api.com returned an unsuccessful response");
    }

    return {
        baseCode: data.base_code,
        rates: data.rates,
        fetchedAt: Date.now(),
    };
};

// Cross-rate math from a single-base table. If `rates` gives base->X for
// every X, then 1 unit of `from` is worth (1 / rates[from]) units of base,
// which is worth (1 / rates[from]) * rates[to] units of `to`. Returns null
// rather than NaN/Infinity when either currency isn't in the table, or the
// table itself is malformed for `from` (rate of 0).
export const deriveRate = (rates: Record<string, number>, from: string, to: string): number | null => {
    const fromRate = rates[from.toUpperCase()];
    const toRate = rates[to.toUpperCase()];

    if (fromRate == null || toRate == null || fromRate === 0) return null;

    return toRate / fromRate;
};

// TODO: Wire cached NGN-based display rates to the frontend currency selector.
// Frontend handles display conversion; hotel/flight source prices remain NGN.
export const getDisplayRates = async (): Promise<ExchangeRateTable> => {
    if (!cachedTable) {
        cachedTable = await fetchRateTable(DISPLAY_TABLE_BASE);
    }
    return cachedTable;
};

// Starts the periodic background refresh of the cached display table.
// Call once at process startup. A failed refresh logs and keeps serving
// the last known-good table rather than throwing and leaving the dropdown
// with nothing — a stale table beats no table.
export const startRateRefreshSchedule = (): void => {
    if (refreshTimer) return;

    fetchRateTable(DISPLAY_TABLE_BASE)
        .then((table) => {
            cachedTable = table;
        })
        .catch((error: Error) => {
            console.error("Initial exchange rate fetch failed, display dropdown will retry on first request:", error.message);
        });
    
    refreshTimer = setInterval(() => {
        fetchRateTable(DISPLAY_TABLE_BASE)
            .then((table) => {
                cachedTable = table;
            })
            .catch((error: Error) => {
                console.error("Exchange rate refresh failed, keeping last known rates:", error.message);
            });
    }, CACHE_REFRESH_INTERVAL_MS)
};

// Only exported so tests can stop the interval between runs; not meant to
// be called from application code.
export const stopRateRefreshSchedule = (): void => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
};

// TODO(batch-7-flight): wire this into the flight checkout path. Duffel
// bills this account in GBP and Paystack can't charge GBP directly, so the
// amount actually sent to Paystack needs a real NGN figure. This
// deliberately does NOT read the cached display table above — it hits the
// API fresh with `from` as the base, so the charge is based on the rate at
// the moment of checkout, not whatever the display dropdown showed however
// long ago the user opened the page. Flight controller/route work itself
// is still parked pending the flight batch.
export const convertForCheckout = async (amount: number, from: string, to: string): Promise<number> => {
    const table = await fetchRateTable(from);
    const rate = table.rates[to.toUpperCase()];

    if(rate == null) {
        throw new Error(`No exchange rate available from ${from} to ${to}`);
    }

    return Math.round(amount * rate * 100) / 100;
};