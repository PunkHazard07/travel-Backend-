import axios from "axios";
import dotenv from "dotenv";
import { PAYSTACK_SESSION_TIMEOUT_SECONDS } from "../utils/paymentAttemptPolicy.js";

dotenv.config();

const URL = "https://api.paystack.co/integration/payment_session_timeout";
const headers = { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` };

const main = async () => {
    if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is not set");

    const [command, value] = process.argv.slice(2);

    if (command === "set" || command === "off") {
        const timeout = command === "off" ? 0 : Number(value ?? PAYSTACK_SESSION_TIMEOUT_SECONDS);
        if (!Number.isInteger(timeout) || timeout < 0) throw new Error("timeout must be a whole number of seconds");
        const response = await axios.put(URL, { timeout }, { headers, timeout: 15_000 });
        console.log("Updated:", JSON.stringify(response.data));
    }

    const current = await axios.get(URL, { headers, timeout: 15_000 });
    console.log("Current payment session timeout (seconds):", current.data?.data?.payment_session_timeout);
};

main().catch((error) => {
    console.error("Failed:", error.response?.data || error.message);
    process.exit(1);
});