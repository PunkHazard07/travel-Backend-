export class BookingError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: Record<string, any>;

    constructor(statusCode: number, code: string, message: string, details?: Record<string, any>) {
        super(message);
        this.name = "BookingError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}