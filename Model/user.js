import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        unique: true
    },
    password: {
        type: String,
        required: true,
    },
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

//hash password before saving
userSchema.pre('save', async function (next) {
    if(!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

//method to compare password during login
userSchema.method.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;