const round2 = (n: number): number => Math.round(n * 100) / 100;

export class FlightPriceError extends Error {
    readonly code: "offer_price_invalid" | "invalid_service" | "unknown_service" | "service_currency_mismatch";

    constructor(code: FlightPriceError["code"], message: string) {
        super(message);
        this.name = "FlightPriceError";
        this.code = code;
    }
}

export interface ServicePrice {
    amount: number;
    currency: string;
}

export const collectServicePrices = (...sources: unknown[]): Map<string, ServicePrice> => {
    const prices = new Map<string, ServicePrice>();

    const walk = (node: any, depth: number): void => {
        if (!node || typeof node !== "object" || depth > 12) return;

        if (Array.isArray(node)) {
            for (const item of node) walk(item, depth + 1);
            return;
        }

        if (Array.isArray(node.available_services)) {
            for (const svc of node.available_services) {
                const amount = Number.parseFloat(svc?.total_amount);
                if (typeof svc?.id === "string" && Number.isFinite(amount) && typeof svc?.total_currency === "string") {
                    prices.set(svc.id, { amount, currency: svc.total_currency });
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === "available_services") continue;
            walk(node[key], depth + 1);
        }
    };

    for (const source of sources) walk(source, 0);
    return prices;
};

export interface SelectedServiceInput {
    id: string;
    quantity?: number;
}

export interface FlightTotal {
    currency: string;
    offerTotal: number;
    servicesTotal: number;
    total: number;
    services: { id: string; quantity: number; amount: number }[];
}

// The amount to charge for a flight, derived ONLY from Duffel's own data:
// the offer's total plus the price of each selected extra as Duffel lists it.
// Nothing the client says about price is used.
export const computeFlightTotal = (offer: any, selectedServices: SelectedServiceInput[], prices: Map<string, ServicePrice>): FlightTotal => {
    const offerTotal = Number.parseFloat(offer?.total_amount);
    const currency = offer?.total_currency;

    if (!Number.isFinite(offerTotal) || offerTotal <= 0 || typeof currency !== "string" || !currency) {
        throw new FlightPriceError("offer_price_invalid", "Duffel offer has no usable price");
    }

    const services: FlightTotal["services"] = [];
    let servicesTotal = 0;

    for (const selected of selectedServices) {
        if (!selected || typeof selected.id !== "string" || !selected.id) {
            throw new FlightPriceError("invalid_service", "Each selected service needs an id");
        }

        const quantity = selected.quantity === undefined ? 1 : selected.quantity;
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
            throw new FlightPriceError("invalid_service", `Invalid quantity for service ${selected.id}`);
        }

        const price = prices.get(selected.id);
        if (!price) {
            throw new FlightPriceError("unknown_service", `Service ${selected.id} is not available for this offer`);
        }
        if (price.currency !== currency) {
            throw new FlightPriceError("service_currency_mismatch", `Service ${selected.id} is priced in ${price.currency}, offer in ${currency}`);
        }

        servicesTotal += price.amount * quantity;
        services.push({ id: selected.id, quantity, amount: round2(price.amount * quantity) });
    }

    servicesTotal = round2(servicesTotal);

    return {
        currency,
        offerTotal: round2(offerTotal),
        servicesTotal,
        total: round2(offerTotal + servicesTotal),
        services,
    };
};