const getRate = () => {
  const rate = parseFloat(process.env.USD_TO_NGN_RATE);
  if (!rate || isNaN(rate)) {
    console.warn("USD_TO_NGN_RATE not set in .env — defaulting to 1600");
    return 1600;
  }
  return rate;
};

export const usdToNgn = (amountUSD, rate) => {
  if (typeof amountUSD !== "number" || isNaN(amountUSD)) return 0;
  const exchangeRate = rate ?? getRate();
  return Math.round(amountUSD * exchangeRate);
};

export const attachNgnPrice = (hotel) => {
  const validPrice = typeof hotel.pricePerNight === "number" && !isNaN(hotel.pricePerNight);
  const rate = validPrice ? getRate() : null;
  const pricePerNightNGN = validPrice ? usdToNgn(hotel.pricePerNight, rate) : null;

  return {
    ...hotel,
    pricePerNightNGN,
    displayCurrency: validPrice ? "NGN" : null,
    exchangeRate: rate,
  };
};

export const attachNgnPrices = (hotels) => hotels.map(attachNgnPrice);