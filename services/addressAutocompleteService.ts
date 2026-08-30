export interface AddressSuggestion {
  id: string;
  label: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number | string;
    osm_type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
}

const joinNonEmpty = (values: (string | undefined)[]): string =>
  values.filter((value): value is string => Boolean(value?.trim())).join(', ');

const CANADIAN_PROVINCE_CODES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  'colombie-britannique': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'nouveau-brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'terre-neuve-et-labrador': 'NL',
  'nova scotia': 'NS',
  'nouvelle-écosse': 'NS',
  ontario: 'ON',
  'prince edward island': 'PE',
  'île-du-prince-édouard': 'PE',
  quebec: 'QC',
  québec: 'QC',
  saskatchewan: 'SK',
  'northwest territories': 'NT',
  'territoires du nord-ouest': 'NT',
  nunavut: 'NU',
  yukon: 'YT',
};

const normalizeProvince = (province = ''): string =>
  CANADIAN_PROVINCE_CODES[province.trim().toLowerCase()] || province;

/**
 * Fallback d'autocomplétion sans clé pour la bêta. Photon utilise les données
 * OpenStreetMap et accepte la recherche interactive; la requête est limitée au
 * Canada et à cinq résultats pour rester légère.
 */
export async function searchCanadianAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 3) return [];

  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', normalized);
  url.searchParams.set('lang', 'fr');
  url.searchParams.set('limit', '5');

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) throw new Error(`Address autocomplete failed: ${response.status}`);

  const payload = await response.json() as { features?: PhotonFeature[] };
  return (payload.features || [])
    .filter((feature) => feature.properties?.countrycode?.toLowerCase() === 'ca')
    .map((feature, index) => {
      const properties = feature.properties || {};
      const street = [properties.housenumber, properties.street || properties.name]
        .filter(Boolean)
        .join(' ');
      const city = properties.city || properties.district || properties.county || '';
      const province = normalizeProvince(properties.state);
      const coordinates = feature.geometry?.coordinates;
      return {
        id: `${properties.osm_type || 'place'}-${properties.osm_id || index}`,
        label: joinNonEmpty([street, city, province, properties.postcode]),
        street,
        city,
        province,
        postalCode: properties.postcode || '',
        country: properties.country || 'Canada',
        longitude: coordinates?.[0],
        latitude: coordinates?.[1],
      };
    })
    .filter((suggestion) => suggestion.label.length > 0);
}
