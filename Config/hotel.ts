import https from "https";
import dotenv from 'dotenv';
//load dotenv
dotenv.config();

export const liteApiConfig = {
    baseUrl: 'https://api.liteapi.travel/v3.0',
    apiKey: process.env.LITE_KEY as string,
    endpoint: {
        hotels: '/data/hotels',
        rates: '/hotels/rates'
    }
};

export const fetchHotelsFromAPI = (countryCode: string, cityName: string, limit = 60): Promise<any> => {
    return new Promise((resolve, reject) => {
    const url = `${liteApiConfig.baseUrl}${liteApiConfig.endpoint.hotels}?countryCode=${countryCode}&cityName=${cityName}&limit=${limit}`;

        const options: https.RequestOptions = {
            headers: {
                "X-API-Key": liteApiConfig.apiKey,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
        };

        https.get(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('API Response Status:', res.statusCode); 

                try {
                        if (res.statusCode !== 200) {
                        reject(new Error(`API returned status  ${res.statusCode}: ${data}`))
                        return
                    }

                    const parsedData = JSON.parse(data);
                    resolve(parsedData);
                } catch (error) {
                    reject(new Error('Failed to parse API response' + error.message)); 
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
};

export interface HotelRatesParams {
    countryCode: string;
    cityName: string;
    hotelIds?: string[];
    checkin: string;
    checkout: string;
    currency?: string;
    guestNationality?: string;
    adults?: number;
}

export const fetchHotelRates = (params: HotelRatesParams): Promise<any> => {
        return new Promise((resolve, reject) => {
            const payload: Record<string, unknown> = {
                checkin: params.checkin,
                checkout: params.checkout,
                currency: params.currency ?? "NGN",
                guestNationality: params.guestNationality,
                occupancies: [{ adults: params.adults ?? 2 }],
            };

            if (params.hotelIds && params.hotelIds.length > 0) {
                payload.hotelIds = params.hotelIds;
            } else {
                payload.cityName = params.cityName;
                payload.countryCode = params.countryCode;
            }

            const body = JSON.stringify(payload);

    const options: https.RequestOptions = {
        method: "POST",
        timeout: 30_000,
        headers: {
            "X-API-Key": liteApiConfig.apiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
    };

    const req = https.request(
        `${liteApiConfig.baseUrl}${liteApiConfig.endpoint.rates}`,
        options,
        (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on ("end", () => {
                try {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Rates API returned status ${res.statusCode}: ${data}`));
                        return
                    }
                    resolve(JSON.parse(data));
                } catch (error: any) {
                    reject(new Error("Failed to parse rates API response: " + error.message));
                }
            });
        }
    );

        req.on("timeout", () => req.destroy(new Error("Rates request timed out")));
        req.on("error", (error) => reject(error));
        req.write(body);
        req.end();
    });
};