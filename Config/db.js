import mongoose from "mongoose";

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL, {
            serverSelectionTimeoutMS: 10000,
        });
        console.log("MongoDB connected Successfully");
    } catch (error) {
        console.error("Mongodb connection failed:", error.message);
        process.exit(1);
    }
};

export default connectDB;