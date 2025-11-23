export const countryNameToCode = {
    'united states': 'US',
    'usa': 'US',
    'america': 'US',
    'united kingdom': 'GB',
    'uk': 'GB',
    'england': 'GB',
    'nigeria': 'NG',
    'canada': 'CA',
    'australia': 'AU',
    'germany': 'DE',
    'france': 'FR',
    'italy': 'IT',
    'spain': 'ES',
    'japan': 'JP',
    'china': 'CN',
    'india': 'IN',
    'brazil': 'BR',
    'mexico': 'MX',
    'south africa': 'ZA',
    'egypt': 'EG',
    'kenya': 'KE',
    'ghana': 'GH',
    'rwanda': 'RW',
    'greece': 'GR',
    'dubai': 'DB'
};


export const getCountryCode = (input) => {
    if (!input) return null;

    const normalized = input.trim().toLowerCase();

     if (/^[a-z]{2}$/i.test(input.trim())) {
        return input.trim().toUpperCase();
    }

    return countryNameToCode[normalized] || null;
}
