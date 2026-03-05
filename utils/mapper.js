export const mapAmadeusFlightOffer = (amadeusData, dictionaries = {}) => {
  const carrierCode =
    amadeusData.itineraries?.[0]?.segments?.[0]?.carrierCode ??
    amadeusData.validatingAirlineCodes?.[0] ??
    null;

  // Resolve human-readable airline name from dictionaries
  const carrierName = carrierCode && dictionaries.carriers
    ? dictionaries.carriers[carrierCode] ?? null
    : null;

  return {
    offerId: amadeusData.id,
    validatingAirlineCodes: amadeusData.validatingAirlineCodes,
    itineraries: amadeusData.itineraries,
    carrierCode,
    carrierName, 

    price: {
      currency: amadeusData.price?.currency ?? null,
      total: Number(amadeusData.price.total),
      base: Number(amadeusData.price.base),
    },

    numberOfBookableSeats: amadeusData.numberOfBookableSeats,
  };
};