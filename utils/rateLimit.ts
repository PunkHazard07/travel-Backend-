import type { Request, Response, NextFunction } from "express";

interface Options {
    windowMs: number;
    max: number;
    message?: string;
}

export const rateLimit = ({ windowMs, max, message = "oo many requests, please try again later."}: Options) => {
    const hits = new Map<string, { count: number; resetAt: number }>();

    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }, windowMs);
    sweep.unref();

    return (req: Request, res: Response, next:NextFunction) => {
        const key = req.ip || "unknown";
        const now = Date.now();
        let entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs};
            hits.set(key, entry);
        }
        entry.count += 1;

        if (entry.count > max) {
            res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ success: false, message });
        }
        next();
    };
};