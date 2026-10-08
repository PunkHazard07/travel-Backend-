import mongoose, { Schema, type Document, type Types } from "mongoose";

export const BOOKING_TYPES = ["flight", "hotel"] as const;
export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "failed"] as const;
export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "processing", "flagged"] as const;

export type BookingType = (typeof BOOKING_TYPES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface FlightSegment {
    departure: { iataCode?: string; at?: Date };
    arrival: { iataCode?: string; at?: Date };
    carrierCode?: string;
    number?: string;
    duration?: string;
}

export interface FlightItinerary {
    duration?: string;
    segments: FlightSegment[];
}

export interface SelectedService {
    id?: string;
    quantity?: number;
    designator?: string;
    passengerId?: string;
}

export interface FlightData {
    offerId?: string;
    source: string;
    validatingAirlineCodes: string[];
    itineraries: FlightItinerary[];
    price?: {
        currency?: string;
        total?: number;
        base?: number;
    };
    numberOfBookableSeats?: number;
    selectedServices: SelectedService[];
}

export interface CurrencyConversion {
    from?: string;
    to?: string;
    originalAmount?: number;
    convertedAmount?: number;
}

export interface BookingDocument extends Document {
    userId: Types.ObjectId;
    bookingType: BookingType;
    flightData?: FlightData;
    hotelData: Record<string, any> | null;
    checkInDate?: Date;
    checkOutDate?: Date;
    bookingReference: string;
    provider: string;
    providerBookingId: string | null;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: "paystack" | null;
    paymentReference: string | null;
    authorizationUrl: string | null;
    accessCode: string | null;
    paymentInitiatedAt: Date | null;
    paymentMetadata: Record<string, any> | null;
    currencyConversion?: CurrencyConversion;
    totalPrice: number;
    // Managed by mongoose via `timestamps: true`.
    createdAt: Date;
    updatedAt: Date;
}

const bookingSchema = new Schema<BookingDocument>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: "User",
        },
        bookingType: {
            type: String,
            required: true,
            enum: BOOKING_TYPES,
        },
        flightData: {
            offerId: {
                type: String,
            },
            source: {
                type: String,
                default: "duffel",
            },
            validatingAirlineCodes: [String],
            itineraries: [
                {
                    duration: String,
                    segments: [
                        {
                            departure: {
                                iataCode: String,
                                at: Date,
                            },
                            arrival: {
                                iataCode: String,
                                at: Date,
                            },
                            carrierCode: String,
                            number: String,
                            duration: String,
                        },
                    ],
                },
            ],
            price: {
                currency: String,
                total: Number,
                base: Number,
            },
            numberOfBookableSeats: Number,
            selectedServices: [
                {
                    id: String,
                    quantity: Number,
                    designator: String,
                    passengerId: String,
                },
            ],
        },
        hotelData: {
            type: Schema.Types.Mixed,
            default: null,
        },
        checkInDate: {
            type: Date,
        },
        checkOutDate: {
            type: Date,
        },
        bookingReference: {
            type: String,
            required: true,
            unique: true,
        },
        provider: {
            type: String,
            default: "mock-provider",
        },
        providerBookingId: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            default: "pending",
            enum: BOOKING_STATUSES,
        },
        paymentStatus: {
            type: String,
            default: "unpaid",
            enum: PAYMENT_STATUSES,
        },
        paymentMethod: {
            type: String,
            enum: ["paystack"],
            default: null,
        },
        paymentReference: {
            type: String,
            default: null,
        },
        authorizationUrl: {
            type: String,
            default: null,
        },
        accessCode: {
            type: String,
            default: null,
        },
        paymentInitiatedAt: {
            type: Date,
            default: null,
        },
        paymentMetadata: {
            type: Schema.Types.Mixed,
            default: null,
        },
        currencyConversion: {
            from: String,
            to: String,
            originalAmount: Number,
            convertedAmount: Number,
        },
        totalPrice: {
            type: Number,
            required: true,
        },
    },
    { timestamps: true }
);

bookingSchema.pre("validate", function (next) {
    if (!this.bookingReference) {
        this.bookingReference =
            "BK-" + Math.random().toString(36).substring(2, 9).toUpperCase();
    }

    if (this.bookingType === "flight" && !this.flightData) {
        return next(new Error("Flight bookings require flightData"));
    }

    if (this.bookingType === "hotel" && !this.hotelData) {
        return next(new Error("Hotel bookings require hotelData"));
    }
    next();
});

const Booking = mongoose.model<BookingDocument>("Booking", bookingSchema);

export default Booking;