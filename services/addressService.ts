export interface AddressSuggestion {
  id: string;
  label: string;
  city: string;
  postcode: string;
  context: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

export const AddressService = {
  async searchCity(query: string): Promise<AddressSuggestion[]> {
    if (!query || query.length < 3) return [];

    // Si une clé API Google est présente, on utilise Google Places
    if (GOOGLE_PLACES_API_KEY) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=(cities)&components=country:ca&key=${GOOGLE_PLACES_API_KEY}&language=fr`
        );
        
        const data = await response.json();
        
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.error('Google Places Error:', data.status, data.error_message);
          return [];
        }

        if (!data.predictions) return [];

        return data.predictions.map((item: any) => {
          const mainText = item.structured_formatting?.main_text || '';
          const secondaryText = item.structured_formatting?.secondary_text || '';
          
          return {
            id: item.place_id,
            label: item.description,
            city: mainText,
            postcode: '', // Google Autocomplete ne retourne pas le code postal directement
            context: secondaryText,
            // Les coordonnées seront récupérées via getPlaceDetails
          };
        });
      } catch (error) {
        console.error('Error searching address with Google:', error);
        return [];
      }
    }

    // Sinon, fallback sur Open-Meteo (gratuit, sans clé)
    try {
      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=fr&format=json`
      );
      
      const data = await response.json();
      
      if (!data.results || !Array.isArray(data.results)) return [];

      // Filtrer pour ne garder que le Canada
      const canadianResults = data.results.filter((item: any) => item.country_code === 'CA');

      return canadianResults.map((item: any) => {
        const city = item.name;
        const region = item.admin1 || ''; // Province (ex: Quebec)
        const country = item.country;
        
        const context = region ? `${region}, ${country}` : country;
        const label = region ? `${city}, ${region}` : city;

        return {
          id: String(item.id),
          label: label,
          city: city,
          postcode: item.postcodes?.[0] || '',
          context: context,
          coordinates: {
            longitude: item.longitude,
            latitude: item.latitude,
          },
        };
      });
    } catch (error) {
      console.error('Error searching address with Open-Meteo:', error);
      return [];
    }
  },

  async getPlaceDetails(placeId: string): Promise<{ latitude: number; longitude: number } | null> {
    // Si c'est un ID Open-Meteo (numérique), on ne peut pas vraiment refaire un appel details simple
    // car on a déjà les coordonnées. Mais normalement on ne passe ici que pour Google.
    
    if (GOOGLE_PLACES_API_KEY) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${GOOGLE_PLACES_API_KEY}`
        );
        
        const data = await response.json();
        
        if (data.status === 'OK' && data.result?.geometry?.location) {
          return {
            latitude: data.result.geometry.location.lat,
            longitude: data.result.geometry.location.lng,
          };
        }
      } catch (error) {
        console.error('Error fetching place details:', error);
      }
    }
    
    return null;
  }
};
