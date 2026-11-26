import {getDoc, getDocs, updateDoc} from 'firebase/firestore';
import {FavoritesService} from '@/features/favorites/services/favoritesService';

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({collection, id}),
  collection: (_db: unknown, name: string) => ({name}), query: (...values: unknown[]) => values,
  where: (...values: unknown[]) => values, arrayRemove: (...ids: string[]) => ({remove: ids}), arrayUnion: (...ids: string[]) => ({add: ids}),
  getDoc: jest.fn(), getDocs: jest.fn(), updateDoc: jest.fn(async () => undefined), setDoc: jest.fn(),
}));
jest.mock('@/config/firebaseConfig', () => ({firestore: {}}));

function nativeFavorites(ids: string[], articles: Record<string, Record<string, unknown>>) {
  (getDoc as jest.Mock).mockResolvedValue({exists: () => true, data: () => ({articleIds: ids})});
  (getDocs as jest.Mock).mockResolvedValue({forEach: (visit: (doc: unknown) => void) => {
    for (const [id, data] of Object.entries(articles)) visit({id, exists: () => true, data: () => data});
  }});
}

it('conserve le favori réservé et sa place dans la page sans effacer son appartenance', async () => {
  nativeFavorites(['available', 'reserved'], {
    available: {isActive: true, isSold: false},
    reserved: {isActive: true, isSold: true, inventoryAvailability: {protocol: 'inventory_article_availability_v1', state: 'engaged'}},
  });
  const page = await FavoritesService.getUserFavoriteArticlesPaginated('alice');
  expect(page.articles.map(article => article.id)).toEqual(['reserved', 'available']);
  expect(page.orphanedCount).toBe(0); expect(updateDoc).not.toHaveBeenCalled();
});

it('ne déduit pas une vente définitive du seul verrou historique isSold', async () => {
  nativeFavorites(['unknown'], {unknown: {isActive: true, isSold: true}});
  const page = await FavoritesService.getUserFavoriteArticlesPaginated('alice');
  expect(page.articles.map(article => article.id)).toEqual(['unknown']);
  expect(page.orphanedCount).toBe(0); expect(updateDoc).not.toHaveBeenCalled();
});

it('nettoie seulement les annonces absentes ou retirées et conserve la réservation active', async () => {
  nativeFavorites(['missing', 'inactive', 'reserved'], {
    inactive: {isActive: false, isSold: true}, reserved: {isActive: true, isSold: true},
  });
  const page = await FavoritesService.getUserFavoriteArticlesPaginated('alice');
  expect(page.articles.map(article => article.id)).toEqual(['reserved']); expect(page.orphanedCount).toBe(2);
  expect(updateDoc).toHaveBeenCalledWith({collection: 'favorites', id: 'alice'}, {articleIds: {remove: ['inactive', 'missing']}, updatedAt: expect.any(Date)});
});

it('ne supprime aucun favori si la lecture des articles échoue', async () => {
  nativeFavorites(['reserved'], {}); (getDocs as jest.Mock).mockRejectedValue(new Error('permission-denied'));
  await expect(FavoritesService.getUserFavoriteArticlesPaginated('alice')).rejects.toThrow('permission-denied');
  expect(updateDoc).not.toHaveBeenCalled();
});
