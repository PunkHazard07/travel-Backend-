import { safeParseFloat } from "./safeParseFloat.js";

export const mapDuffelFlightOffer = (offer) => {
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

  const itineraries = (offer.slices || []).map((slice) => ({
    duration: slice.duration,
    segments: (slice.segments || []).map((seg) => ({
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