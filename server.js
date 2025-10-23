import express from "express";
import cors from "cors";
import dotenv from 'dotenv';
import connectDB from "./Config/db";


//Import routes...

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

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
