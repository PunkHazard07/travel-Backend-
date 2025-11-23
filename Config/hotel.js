import https from "https";
import dotenv from 'dotenv';
//load dotenv
dotenv.config();
console.log('LITE_KEY from env:',process.env.LITE_KEY)

export const liteApiConfig = {
      baseUrl: 'https://api.liteapi.travel/v3.0',
      apiKey: process.env.LITE_KEY,
      endpoint: {
         hotels: '/data/hotels',
         hotelDetails: '/data/hotel',
      }
};

export const fetchHotelsFromAPI = (countryCode, cityName) => {
    return new Promise((resolve, reject) => {

        console.log('=== API Request Debug Info ===');
        console.log('API Key exists:', !!liteApiConfig.apiKey);
        console.log('API Key (first 10 chars):', liteApiConfig.apiKey?.substring(0, 10));
        console.log('Country Code:', countryCode);
        console.log('City Name:', cityName);

         const url = `${liteApiConfig.baseUrl}${liteApiConfig.endpoint.hotels}?countryCode=${countryCode}&cityName=${cityName}`;

         const options = {
            headers: {
                'X-API-Key': liteApiConfig.apiKey,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
         };

         console.log('making request to:', url)


         https.get(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                 console.log('API Response Status:', res.statusCode); 

                 console.log('API Response:', data);
                try {
                     if (res.statusCode !== 200) {
                        reject(new Error(`API returned status  ${res.statusCode}: ${data}`))
                    }

                    const parsedData = JSON.parse(data);
                    resolve(parsedData);
                } catch (error) {
                    reject(new Error('Failed to parse API response'+ error.message)); 
                }
            });
         }).on('error', (error) => {
            reject(error);
         });
    });
};