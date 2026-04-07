import { safeParseFloat } from "./safeParseFloat.js";

export const mapDuffelFlightOffer = (offer) => {

    //map duffel slices 
    const itineraries = (offer.slices || []).map((slice) => ({
    duration: slice.duration, // ISO 8601, e.g. "PT10H30M"
    segments: (slice.segments || []).map((seg) => ({
      departure: {
        iataCode: seg.origin?.iata_code,
        terminal: seg.origin_terminal,
        at: seg.departing_at,  // ISO datetime string
      },
      arrival: {
        iataCode: seg.destination?.iata_code,
        terminal: seg.destination_terminal,
        at: seg.arriving_at,
      },
      carrierCode: seg.marketing_carrier?.iata_code,
      carrierName: seg.marketing_carrier?.name,
      operatingCarrierCode: seg.operating_carrier?.iata_code,
      number: seg.marketing_carrier_flight_number,
      duration: seg.duration,
      // Cabin / baggage info Duffel includes per-segment
      cabin: seg.passengers?.[0]?.cabin_class_marketing_name ?? null,
      baggageAllowance: seg.passengers?.[0]?.baggages ?? [],
    })),
  }));

  return {
    offerId: offer.id,
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
      taxes: safeParseFloat(offer.taxes_amount ?? 0),
    },
    numberOfBookableSeats: offer.available_services ? undefined : offer.passenger_count,  //seat come from seatMaps endpoint
    passengers: offer.passengers ?? [],
    expiresAt: offer.expires_at ?? null,
    sliceCount: (offer.slices ?? []).length
  };

};