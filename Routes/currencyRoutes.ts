import express from "express";
import { getExchangeRates } from '../Controller/currencyController.js';

const router = express.Router()

// Shared by hotel and flight pages' multi-currency display dropdown.
router.get('/currency/rates', getExchangeRates);

export default router;