// Exploration script — NOT part of the app's runtime code.
// Run once with: npx tsx scripts/testHotelList.ts
// Purpose: see whether LiteAPI's /data/hotels response reliably includes
// `stars` and `rating` on each hotel, so we know whether the
// Math.random() fallback in hotelController.ts is still needed.

import { fetchHotelsFromAPI } from "../Config/hotel.js";

const run = async () => {
  const response = await fetchHotelsFromAPI("GB", "London", 10);

  const hotels = response?.data ?? [];
  console.log(`Got ${hotels.length} hotels\n`);

  for (const hotel of hotels) {
    console.log({
      id: hotel.id,
      name: hotel.name,
      stars: hotel.stars,
      rating: hotel.rating,
    });
  }
};

run().catch((err) => console.error("Request failed:", err.message));