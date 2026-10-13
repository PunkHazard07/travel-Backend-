import type { CorsOptions } from "cors";

export const buildCorsOptions = (env: NodeJS.ProcessEnv = process.env): CorsOptions => {
    const raw = env.CORS_ORIGINS || env.VITE_FRONTEND_URL || "";
    const allowed = raw
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean);

    if (allowed.length === 0) {
        console.warn("CORS_ORIGINS / VITE_FRONTEND_URL not set: allowing requests from any origin");
        return {};
    }

    return {
        origin: (origin, callback) => {
            // No Origin header = server-to-server (Paystack webhook) or curl.
            if (!origin || allowed.includes(origin.replace(/\/$/, ""))) return callback(null, true);
            callback(null, false);
        },
    };
};