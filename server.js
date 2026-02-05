import express from "express";
import cors from "cors";
import dotenv from 'dotenv';
import connectDB from "./Config/db.js";


//Import routes...
import flightRoutes from './Routes/flightRoutes.js'
import hotelRoutes from './Routes/hotelRoutes.js'
import userRoutes from './Routes/userRoutes.js'
import bookingRoutes from './Routes/bookingRoutes.js'

//load dotenv 
 dotenv.config();

 // connect to MongoDB
 connectDB();

const app = express();
const PORT = process.env.PORT 

//....Middleware....
app.use(cors());
app.use(express.json());

//....Routes....
app.get('/', (req,res) => {
    res.send('Server is running Successfully')
});

//mount routes...
app.use ('/api', flightRoutes);
app.use('/api', hotelRoutes);
app.use('/api', userRoutes);
app.use('/api/bookings', bookingRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
