import { safeParseFloat } from "./safeParseFloat.js";

interface DuffelCarrier {
  iata_code?: string | null;
  name?: string | null;
  logo_lockup_url?: string | null;
  logo_symbol_url?: string | null;
}

interface DuffelAirport {
  iata_code?: string | null;
}

interface DuffelBaggage {
  type: string;
  quantity: number;
}

interface DuffelPassengerSegment {
  cabin_class_marketing_name?: string | null;
  baggages?: DuffelBaggage[];
}

interface DuffelSegment {
  origin?: DuffelAirport;
  origin_terminal?: string | null;
  departing_at?: string;
  destination?: DuffelAirport;
  destination_terminal?: string | null;
  arriving_at?: string;
  marketing_carrier?: DuffelCarrier;
  operating_carrier?: DuffelCarrier;
  marketing_carrier_flight_number?: string | null;
  duration?: string | null;
  passengers?: DuffelPassengerSegment[];
}

interface DuffelSlice {
  duration?: string;
  segments?: DuffelSegment[];
}

export interface DuffelFlightOffer {
  id: string;
  slices?: DuffelSlice[];
  total_currency?: string;
  total_amount?: string;
  base_amount?: string;
  tax_amount?: string;
  available_services?: unknown[];
  passenger_count?: number;
  passengers?: unknown[];
  expires_at?: string | null;
}

interface MappedEndpoint {
  iataCode: string | null | undefined;
  terminal: string | null;
  at: string | undefined;
}

interface MappedSegment {
  departure: MappedEndpoint;
  arrival: MappedEndpoint;
  carrierCode: string | null;
  carrierName: string | null;
  operatingCarrierCode: string | null;
  number: string | null;
  duration: string | null;
  cabin: string | null;
  baggageAllowance: DuffelBaggage[];
}

interface MappedItinerary {
  duration: string | undefined;
  segments: MappedSegment[];
}

export interface MappedFlightOffer {
  offerId: string;
  source: "duffel";
  validatingAirlineCodes: string[];
  carrierCode: string | null;
  carrierName: string | null;
  logoLockupUrl: string | null;
  logoSymbolUrl: string | null;
  itineraries: MappedItinerary[];
  price: {
    currency: string | undefined;
    total: number;
    base: number;
    taxes: number;
  };
  numberOfBookableSeats: number | undefined;
  passengers: unknown[];
  expiresAt: string | null;
  sliceCount: number;
}

export const mapDuffelFlightOffer = (offer: DuffelFlightOffer): MappedFlightOffer => {
  const firstSegment = offer.slices?.[0]?.segments?.[0];

  const carrierCode =
    firstSegment?.marketing_carrier?.iata_code ??
    firstSegment?.operating_carrier?.iata_code ??
    null;

  const carrierName =
    firstSegment?.marketing_carrier?.name ??
    firstSegment?.operating_carrier?.name ??
    null;

  const logoLockupUrl =
    firstSegment?.marketing_carrier?.logo_lockup_url ??
    firstSegment?.operating_carrier?.logo_lockup_url ??
    null;

  const logoSymbolUrl =
    firstSegment?.marketing_carrier?.logo_symbol_url ??
    firstSegment?.operating_carrier?.logo_symbol_url ??
    null;

  const itineraries: MappedItinerary[] = (offer.slices || []).map((slice) => ({
    duration: slice.duration,
    segments: (slice.segments || []).map((seg): MappedSegment => ({
      departure: {
        iataCode: seg.origin?.iata_code,
        terminal: seg.origin_terminal ?? null,
        at: seg.departing_at,
      },
      arrival: {
        iataCode: seg.destination?.iata_code,
        terminal: seg.destination_terminal ?? null,
        at: seg.arriving_at,
      },
      carrierCode: seg.marketing_carrier?.iata_code ?? null,
      carrierName: seg.marketing_carrier?.name ?? null,
      operatingCarrierCode: seg.operating_carrier?.iata_code ?? null,
      number: seg.marketing_carrier_flight_number ?? null,
      duration: seg.duration ?? null,
      cabin: seg.passengers?.[0]?.cabin_class_marketing_name ?? null,
      baggageAllowance: seg.passengers?.[0]?.baggages ?? [],
    })),
  }));

  return {
    offerId: offer.id,
    source: "duffel",
    validatingAirlineCodes: carrierCode ? [carrierCode] : [],
    carrierCode,
    carrierName,
    logoLockupUrl,
    logoSymbolUrl,
    itineraries,
    price: {
      currency: offer.total_currency,
      total: safeParseFloat(offer.total_amount),
      base: safeParseFloat(offer.base_amount ?? offer.total_amount),
      taxes: safeParseFloat(offer.tax_amount ?? 0),
    },
    numberOfBookableSeats: offer.available_services
      ? undefined
      : offer.passenger_count,
    passengers: offer.passengers ?? [],
    expiresAt: offer.expires_at ?? null,
    sliceCount: (offer.slices ?? []).length,
  };
};