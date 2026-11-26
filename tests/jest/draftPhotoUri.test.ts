import {resolveDraftPhotoUri} from '@/features/sell/utils/draftPhotoUri';

const sandbox = 'file:///sim/device/data/Containers/Data/Application/';
const oldId = '11111111-1111-4111-8111-111111111111';
const currentId = '22222222-2222-4222-8222-222222222222';
const documentDirectory = `${sandbox}${currentId}/Documents/`;
const cacheDirectory = 'draft_images/development%3Aseconde-dev';
const draftId = 'draft_1795650000000_abc123';
const filename = `${draftId}_0_1795650000001_abcd123.jpg`;
const own = `${cacheDirectory}/alice/${filename}`;
const resolve = (uri: string) => resolveDraftPhotoUri({uri, documentDirectory, cacheDirectory, ownerUid: 'alice', draftId});

it('resolves the same owned draft after only the iOS container UUID moves', () => {
  expect(resolve(`${sandbox}${oldId}/Documents/${own}`)).toBe(`${documentDirectory}${own}`);
  expect(resolve(`${documentDirectory}${own}`)).toBe(`${documentDirectory}${own}`);
});
it.each([
  `${cacheDirectory}/bob/${filename}`,
  `draft_images/production/alice/${filename}`,
  `draft_images/alice/${filename}`,
  `${cacheDirectory}/alice/draft_other_0_1795650000001_abcd123.jpg`,
  `${cacheDirectory}/alice/../bob/${filename}`,
  `${cacheDirectory}/alice/%2e%2e%2fbob/${filename}`,
  `${cacheDirectory}/alice/${filename}?token=foreign`,
])('refuses a moved cache outside the exact environment, owner and draft: %s', relative => {
  expect(() => resolve(`${sandbox}${oldId}/Documents/${relative}`)).toThrow();
});
it('does not adopt the same suffix from another device sandbox', () => {
  expect(() => resolve(`file:///other/data/Containers/Data/Application/${oldId}/Documents/${own}`)).toThrow();
});
it('refuses traversal in a current owned cache too', () => {
  expect(() => resolve(`${documentDirectory}${cacheDirectory}/alice/../bob/photo.jpg`)).toThrow();
});
it('leaves a newly selected non-cache image unchanged', () => {
  expect(resolve('file:///picker/selected.jpg')).toBe('file:///picker/selected.jpg');
});
