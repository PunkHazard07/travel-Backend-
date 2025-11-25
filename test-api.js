// test-api.js
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const testLiteAPI = () => {
    const apiKey = process.env.LITE_KEY;
    console.log('Testing with API Key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');
    
    const url = 'https://api.liteapi.travel/v3.0/data/hotels?countryCode=US&cityName=Miami';
    
    const options = {
        headers: {
            'X-API-Key': apiKey,
            'Accept': 'application/json'
        }
    };
    
    console.log('Making request to:', url);
    console.log('Headers:', options.headers);
    
    https.get(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('\nStatus Code:', res.statusCode);
            console.log('Response Headers:', res.headers);
            console.log('Response Body:', data);
        });
    }).on('error', (error) => {
        console.error('Request Error:', error);
    });
};

testLiteAPI();