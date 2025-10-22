import express from "express";
import cors from "cors";
import dotenv from 'dotenv';
//load dotenv 
 dotenv.config();

const app = express();
const PORT = process.env.PORT

//....Middleware....
app.use(cors());
app.use(express.json());

//....Routes....
app.get('/', (req,res) => {
   res.send('Server is running Successfully')
})
app.listen(()=> {
    console.log(`Server is running on http://localhost:${PORT}`);
});
