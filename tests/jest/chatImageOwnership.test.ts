import {auth} from '@/config/firebaseConfig';
import {uploadBytes} from 'firebase/storage';
import {sendMessageWithType} from '@/services/chat/primitives';
import {sendImage} from '@/services/chat/messages';
import {PRIVATE_IMAGE_UPLOAD_METADATA} from '@/utils/privateMedia';

jest.mock('expo-crypto', () => ({randomUUID: () => 'synthetic-photo-id'}));
jest.mock('expo-image-manipulator', () => ({manipulateAsync: jest.fn(async (uri: string) => ({uri, width: 1024, height: 768})), SaveFormat: {JPEG: 'jpeg'}}));
jest.mock('firebase/storage', () => ({ref: (_storage: unknown, path: string) => ({bucket: 'demo-second.appspot.com', fullPath: path}), uploadBytes: jest.fn()}));
jest.mock('@/services/chat/primitives', () => ({sendMessageWithType: jest.fn(async () => 'synthetic-message')}));
jest.mock('@/services/tradeOperation', () => ({captureTradeSession: (uid: string) => ({uid}), assertTradeSessionCurrent: jest.fn()}));
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks(); Object.assign(auth, {currentUser: {uid: 'sender'}});
  global.fetch = jest.fn(async () => ({blob: async () => new Blob(['synthetic image'])})) as unknown as typeof fetch;
  jest.mocked(uploadBytes).mockImplementation(async target => ({metadata: {generation: target.fullPath.endsWith('_thumb.jpg') ? '100002' : '100001'}}) as never);
});
afterEach(() => {global.fetch = originalFetch;});
it('writes both exact upload generations and the sender-owned paths without distributing token metadata', async () => {
  await sendImage('chat1', 'sender', 'receiver', 'file:///synthetic.jpg');
  expect(jest.mocked(uploadBytes).mock.calls.map(call => call[0].fullPath)).toEqual([
    'chat_images/chat1/sender/synthetic-photo-id.jpg', 'chat_images/chat1/sender/synthetic-photo-id_thumb.jpg']);
  expect(PRIVATE_IMAGE_UPLOAD_METADATA).not.toHaveProperty('customMetadata.firebaseStorageDownloadTokens');
  expect(sendMessageWithType).toHaveBeenCalledWith('chat1', 'sender', 'receiver', 'image', 'Photo', {image: {
    url: expect.stringContaining('chat_images%2Fchat1%2Fsender%2Fsynthetic-photo-id.jpg?alt=media'),
    thumbnail: expect.stringContaining('chat_images%2Fchat1%2Fsender%2Fsynthetic-photo-id_thumb.jpg?alt=media'),
    generation: '100001', thumbnailGeneration: '100002', width: 1024, height: 768,
  }}, expect.any(Function));
});
it.each(['', 'unknown', undefined])('does not persist a message when a native upload generation is missing or invalid (%s)', async generation => {
  jest.mocked(uploadBytes).mockResolvedValue({metadata: {generation}} as never);
  await expect(sendImage('chat1', 'sender', 'receiver', 'file:///synthetic.jpg')).rejects.toThrow('version');
  expect(sendMessageWithType).not.toHaveBeenCalled();
});
it('never assigns another SDK user’s photo to the declared sender', async () => {
  Object.assign(auth, {currentUser: {uid: 'other'}});
  await expect(sendImage('chat1', 'sender', 'receiver', 'file:///synthetic.jpg')).rejects.toThrow('Session invalide');
  expect(uploadBytes).not.toHaveBeenCalled(); expect(sendMessageWithType).not.toHaveBeenCalled();
});
