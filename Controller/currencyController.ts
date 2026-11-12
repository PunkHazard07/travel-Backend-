import type { Request, Response } from "express";
import { getDisplayRates } from "../utils/currencyConverter.js";

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
        console.error("getExchangeRates error:", error)
        res.status(500).json({
            success: false,
            message: "Failed to fetch exchange rates",
        });
    }
};