import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from 'dotenv';
//load dotenv 
dotenv.config();
import connectDB from "./Config/db.js";

//Import routes...
import flightRoutes from './Routes/flightRoutes.js'
import hotelRoutes from './Routes/hotelRoutes.js'
import userRoutes from './Routes/userRoutes.js'
import bookingRoutes from './Routes/bookingRoutes.js'
import currencyRoutes from './Routes/currencyRoutes.js'
import paymentRoutes from  './Routes/paymentRoutes.js'
import { startRateRefreshSchedule } from './utils/currencyConverter.js'

const PORT = process.env.PORT 
const app = express();

//....Middleware....
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

//....Routes....
app.get('/', (req,res) => {
    res.send('Server is running Successfully')
});

app.get('/health', (req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({
        status: dbUp ? 'ok' : 'degraded',
        db: dbUp ? 'up' : 'down',
        uptime: process.uptime(),
    });
});

//mount routes...
app.use ('/api', flightRoutes);
app.use('/api', hotelRoutes);
app.use('/api', userRoutes);
app.use('/api', bookingRoutes);
app.use('/api', currencyRoutes);
app.use('/api', paymentRoutes);

const start = async () => {
    await connectDB();
    startRateRefreshSchedule();

    const server = app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${signal} received, shutting down...`);

        // Safety net if connections refuse to drain
        setTimeout(() => {
            console.error('Forced exit after timeout');
            process.exit(1);
        }, 10_000).unref();

        server.close(async (err) => {
            try {
                await mongoose.connection.close();
            } finally {
                process.exit(err ? 1 : 0);
            }
        });
    };

    process.on('SIGTERM', () => shutdown('sigterm'));
    process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
});