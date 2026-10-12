import type { Request, Response } from "express";
import { getDisplayRates } from "../utils/currencyConverter.js";

// Serves the cached display-rate table for the frontend's multi-currency
// dropdown. Shared by hotel and flight pages alike — this endpoint isn't
// specific to either. Never used for the amount actually charged; that's
// convertForCheckout in utils/currencyConverter.ts, used at the moment of
// payment (currently TODO — see that file — since flight checkout, the
// only path that needs it, is a parked batch).
export const getExchangeRates = async (req: Request, res: Response) => {
    try {
        const table = await getDisplayRates();
        res.status(200).json({
            success: true,
            baseCode: table.baseCode,
            rates: table.rates,
            fetchedAt: table.fetchedAt,
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};