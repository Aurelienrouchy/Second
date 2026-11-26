import { describe, expect, it } from 'vitest';

import { isObject, isStringArray, parseRouteParam, serializeRouteParam } from './routeParams';
import { resolveHref } from 'expo-router/build/link/href';

type Fields = { title: string };

describe('parseRouteParam — un paramètre de route ne doit jamais faire tomber l’écran', () => {
  it('rend le repli quand le paramètre est absent', () => {
    expect(parseRouteParam(undefined, [] as string[], isStringArray)).toEqual([]);
  });

  it('lit un paramètre bien formé', () => {
    expect(parseRouteParam('["a","b"]', [] as string[], isStringArray)).toEqual(['a', 'b']);
  });

  it('ne lève pas sur du JSON malformé (lien profond bricolé)', () => {
    expect(() => parseRouteParam('{oops', [] as string[], isStringArray)).not.toThrow();
    expect(parseRouteParam('{oops', [] as string[], isStringArray)).toEqual([]);
  });

  it('ne lève pas quand la clé est répétée (expo-router rend un tableau)', () => {
    expect(() => parseRouteParam(['["a"]', '["b"]'], [] as string[], isStringArray)).not.toThrow();
    expect(parseRouteParam(['["a"]', '["b"]'], [] as string[], isStringArray)).toEqual(['a']);
  });

  it('refuse un JSON valide de mauvaise forme plutôt que de le laisser filer', () => {
    expect(parseRouteParam('0', [] as string[], isStringArray)).toEqual([]);
    expect(parseRouteParam('null', [] as string[], isStringArray)).toEqual([]);
    expect(parseRouteParam('[1,2]', [] as string[], isStringArray)).toEqual([]);
  });

  it('rend le repli pour un objet attendu mais reçu en tableau', () => {
    const fallback: Fields | null = null;
    expect(parseRouteParam('[]', fallback, isObject<Fields>)).toBeNull();
    expect(parseRouteParam('{"title":"Robe"}', fallback, isObject<Fields>)).toEqual({ title: 'Robe' });
  });

  it('traite la chaîne vide comme une absence', () => {
    expect(parseRouteParam('', [] as string[], isStringArray)).toEqual([]);
  });
});

describe('photo media route transport', () => {
  it('preserves exact file and private-media escapes through the installed Router query and local-param decoding', () => {
    const photos = ['file:///Documents/draft_images/development%3Adev/owner/image%252Fone.jpg', 'private-storage://bucket/photos/object%2Ftwo'];
    const href = resolveHref({ pathname: '/sell/photos-review', params: { photos: serializeRouteParam(photos) } });
    const queryValue = new URL(href, 'https://navigation.invalid').searchParams.get('photos')!;
    const localValue = decodeURIComponent(queryValue);
    expect(parseRouteParam(localValue, [] as string[], isStringArray)).toEqual(photos);
    // The old emitter loses the namespace escape in the same real pipeline.
    const oldHref = resolveHref({ pathname: '/sell/photos-review', params: { photos: JSON.stringify(photos) } });
    const oldQuery = new URL(oldHref, 'https://navigation.invalid').searchParams.get('photos')!;
    expect(JSON.parse(decodeURIComponent(oldQuery))).not.toEqual(photos);
  });

  it('keeps ordinary legacy JSON readable and refuses an unserializable payload', () => {
    expect(parseRouteParam(JSON.stringify(['file:///a%3Ab.jpg']), [] as string[], isStringArray)).toEqual(['file:///a%3Ab.jpg']);
    expect(() => serializeRouteParam(undefined)).toThrow('Paramètre de navigation invalide.');
  });
});
