const estimatePrice = ({ stars = 3, rating = 7.5, currency = "USD" }) => {
  const basePricesUSD = {
    5: { min: 200, max: 500 },
    4: { min: 100, max: 250 },
    3: { min: 50, max: 150 },
    2: { min: 30, max: 80 },
    1: { min: 20, max: 50 },
  };

  const exchangeRates = {
    USD: 1,
    EUR: 0.9,
    GBP: 0.8,
    NGN: 1400,
    AED: 3.67,
    INR: 83,
    JPY: 149,
    CAD: 1.36,
    AUD: 1.52,
  };

  const ratingMultiplier = 
    rating >= 9.5 ? 1.4 :
    rating >= 9.0 ? 1.3 :
    rating >= 8.5 ? 1.2 :
    rating >= 8.0 ? 1.1 :
    rating >= 7.5 ? 1.05 :
    rating >= 7.0 ? 1.0 :
    rating >= 6.5 ? 0.95 :
    rating >= 6.0 ? 0.9 :
    0.85;

    const starKey = Math.min(Math.max(Math.floor(stars), 1), 5);
    const priceRange = basePricesUSD[starKey];

    const randomFactor = 0.8 + (Math.random() * 0.4);
    const basePrice = priceRange.min + ((priceRange.max - priceRange.min) * randomFactor);

    const priceUSD = basePrice * ratingMultiplier;

    const finalPrice = priceUSD * (exchangeRates[currency.toUpperCase()] || 1);

  return Math.round(finalPrice);
};

export default estimatePrice;