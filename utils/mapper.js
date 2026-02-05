export const mapAmadeusFlightOffer = (amadeusData) => ({
  offerId: amadeusData.id,
  validatingAirlineCodes: amadeusData.validatingAirlineCodes,
  itineraries: amadeusData.itineraries,

  price: {
    currency: amadeusData.price?.currency ?? null,
    total: Number(amadeusData.price.total),
    base: Number(amadeusData.price.base),
  },

  numberOfBookableSeats: amadeusData.numberOfBookableSeats,
});
