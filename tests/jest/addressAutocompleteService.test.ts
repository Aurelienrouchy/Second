import { searchCanadianAddresses } from '@/services/addressAutocompleteService';

describe('searchCanadianAddresses', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('ne lance aucune requête avant trois caractères', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(searchCanadianAddresses('12')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('transforme les résultats canadiens Photon et ignore les autres pays', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-73.57, 45.51] },
            properties: {
              osm_id: 123,
              osm_type: 'W',
              housenumber: '4899',
              street: 'Avenue du Parc',
              city: 'Montréal',
              state: 'Québec',
              postcode: 'H2V 4E7',
              country: 'Canada',
              countrycode: 'CA',
            },
          },
          {
            properties: { name: 'Paris', countrycode: 'FR' },
          },
        ],
      }),
    } as Response);

    await expect(searchCanadianAddresses('4899 parc')).resolves.toEqual([
      {
        id: 'W-123',
        label: '4899 Avenue du Parc, Montréal, QC, H2V 4E7',
        street: '4899 Avenue du Parc',
        city: 'Montréal',
        province: 'QC',
        postalCode: 'H2V 4E7',
        country: 'Canada',
        longitude: -73.57,
        latitude: 45.51,
      },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('photon.komoot.io'),
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('remonte une erreur HTTP au composant afin qu’il conserve la saisie manuelle', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    await expect(searchCanadianAddresses('avenue du parc')).rejects.toThrow(
      'Address autocomplete failed: 429',
    );
  });
});
