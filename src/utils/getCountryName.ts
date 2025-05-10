import { parsePhoneNumberFromString } from 'libphonenumber-js'
import countries from 'i18n-iso-countries';

const getCountryName = (phoneNumber: string) => {
    const parsed = parsePhoneNumberFromString(phoneNumber);
    
    if(parsed?.country) {
        const countryName = countries.getName(parsed.country, "en");
        return countryName
    } else {
        return 'English'
    }
}

export default getCountryName