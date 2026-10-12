// TODO(flight-batch): replace with Duffel orders.create, then delete this file.
export const simulateBookingProcess = (_booking: unknown): Promise<{ success: boolean; providerBookingId: string; status: "confirmed" | "failed" }> => 
    new Promise((resolve) => {
        setTimeout(() => {
            const confirmed = Math.random() > 0.05;
            resolve({
                success: confirmed,
                providerBookingId: `PROV-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
                status: confirmed ? "confirmed" : "failed",
            });
        }, 2000);
    });
