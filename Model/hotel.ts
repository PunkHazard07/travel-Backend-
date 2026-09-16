import mongoose, { Schema, type Document } from "mongoose";

export interface HotelDocument extends Document {
  apiHotelId: string;
  name: string;
  location: {
    city: string;
    country: string;
  };
  rating: number;
  stars: number;
  main_photo?: string;
  thumbnail?: string;
  hotelDescription?: string;
  cachedAt: Date;
}

const hotelSchema = new Schema<HotelDocument>(
  {
      apiHotelId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true
    },
    location: {
      city: {
        type: String,
        required: true
      },
      country: {
        type: String,
        required: true,
      },
    },
    rating: {
      type: Number,
      default: 0,
    },
    stars: {
      type: Number,
      default: 0
    },
    main_photo: String,
    thumbnail: String,
    hotelDescription: String,
    cachedAt: {
      type: Date,
      default: Date.now,
      expires: 3600 * 6,
    }
  }, { timestamps: true }
);

hotelSchema.index({ "location.city": 1, "location.country": 1 });
hotelSchema.index({ rating: -1 });

const Hotel = mongoose.model<HotelDocument>("Hotel", hotelSchema);
export default Hotel;
