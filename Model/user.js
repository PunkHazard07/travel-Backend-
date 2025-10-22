import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true,
    },
    email: {},
    password: {},
    phone: {
        type: String,
    },
    dateOfBirth: {
        type: Date
    },
    nationality: {
        type: String
    },
    verified: {
        type: Boolean,
        default: false, // for email verification in case i'm going to do something like that 
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model("User", userSchema);
export default User;