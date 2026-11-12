export const PENDING_ATTEMPT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export const INITIATING_ATTEMPT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// The sweep re-checks a pending/unknown attempt with Paystack at most this often.
export const ATTEMPT_RECHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// How often the background sweep runs, and how many attempts one run handles.
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const RECONCILE_BATCH_SIZE = 50;

type AgedAttempt = { createdAt?: Date | string | null };

const ageMs = (attempt: AgedAttempt, now: Date): number | null => {
    if (!attempt.createdAt) return null;
    const created = new Date(attempt.createdAt).getTime();
    if (Number.isNaN(created)) return null;
    return now.getTime() - created;
};

// Unknown age is treated as NOT stale: we only close what we can prove is old.
export const isPendingAttemptExpired = (attempt: AgedAttempt, now: Date = new Date()): boolean => {
    const age = ageMs(attempt, now);
    return age !== null && age >= PENDING_ATTEMPT_MAX_AGE_MS;
};

export const isInitiatingAttemptStale = (attempt: AgedAttempt, now: Date = new Date()): boolean => {
    const age = ageMs(attempt, now);
    return age !== null && age >= INITIATING_ATTEMPT_MAX_AGE_MS;
};