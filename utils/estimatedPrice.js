const PRICE_RANGES_USD = {
  1: { min: 15, max: 25 },
  2: { min: 22, max: 35 },
  3: { min: 35, max: 48 },
  4: { min: 48, max: 58 },
  5: { min: 55, max: 62 },
};

const estimatePrice = ({ stars = 3 } = {}) => {
  // Clamp stars to a valid key
  const starKey = Math.min(Math.max(Math.floor(stars), 1), 5);
  const { min, max } = PRICE_RANGES_USD[starKey];

  // Random price within the range
  const priceUSD = min + Math.random() * (max - min);

  return Math.round(priceUSD * 100) / 100; // 2 decimal places
};

export default estimatePrice;
