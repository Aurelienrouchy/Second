import { act, renderHook } from '@testing-library/react-native';
import { usePrivateMediaSource } from '@/hooks/usePrivateMediaSource';

const mockAuth = { currentUser: null as { uid: string } | null };
const mockGetBytes = jest.fn();
const mockRef = jest.fn((_storage: unknown, path: string) => ({ fullPath: path }));
const mockUnsubscribe = jest.fn();
let mockAuthListener: ((user: { uid: string } | null) => void) | undefined;

jest.mock('@/config/firebaseConfig', () => ({
  get auth() { return mockAuth; },
  storage: { app: { options: { storageBucket: 'demo-second.appspot.com' } } },
}));
jest.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => {
    mockAuthListener = listener;
    listener(mockAuth.currentUser);
    return mockUnsubscribe;
  },
}));
jest.mock('firebase/storage', () => ({
  getBytes: (...args: unknown[]) => mockGetBytes(...args),
  ref: (storage: unknown, path: string) => mockRef(storage, path),
}));

const uri = 'https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/chat_images%2Fc1%2Fx.jpg?alt=media';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'u1' };
  mockGetBytes.mockResolvedValue(Uint8Array.from([255, 216, 255]).buffer);
  mockAuthListener = undefined;
});

async function mount(input = uri) {
  const view = renderHook(({ value }: { value: string }) => usePrivateMediaSource(value), { initialProps: { value: input } });
  await act(async () => { await Promise.resolve(); });
  return view;
}

describe('authenticated private image source', () => {
  it('downloads through authenticated SDK path with a size cap; returns bytes only', async () => {
    const view = await mount(`${uri}&token=legacy-test-token`);
    expect(mockRef).toHaveBeenCalledWith(expect.anything(), 'chat_images/c1/x.jpg');
    expect(mockGetBytes).toHaveBeenCalledWith({ fullPath: 'chat_images/c1/x.jpg' }, 10 * 1024 * 1024);
    expect(view.result.current).toEqual({ uri: 'data:image/jpeg;base64,/9j/' });
    expect(JSON.stringify(view.result.current)).not.toContain('token');
  });
  it('ignores arbitrary hosts without requesting bytes or credentials', async () => {
    const view = await mount('https://example.test/private.jpg');
    expect(mockGetBytes).not.toHaveBeenCalled();
    expect(view.result.current).toBeUndefined();
  });
  it('does not download or render while signed out', async () => {
    mockAuth.currentUser = null;
    const view = await mount();
    expect(mockGetBytes).not.toHaveBeenCalled();
    expect(view.result.current).toBeUndefined();
  });
  it('clears image bytes on logout and ignores an earlier pending download', async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    mockGetBytes.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    const view = await mount();
    await act(async () => {
      mockAuth.currentUser = null;
      mockAuthListener?.(null);
      finish(Uint8Array.from([255, 216, 255]).buffer);
      await Promise.resolve();
    });
    expect(view.result.current).toBeUndefined();
  });
  it('refreshes authorization when the SDK ID token changes and clears denied media', async () => {
    const view = await mount();
    expect(view.result.current).toBeDefined();
    mockGetBytes.mockRejectedValue(new Error('storage/unauthorized'));
    await act(async () => { mockAuthListener?.({ uid: 'u1' }); await Promise.resolve(); });
    expect(mockGetBytes).toHaveBeenCalledTimes(2);
    expect(view.result.current).toBeUndefined();
  });
  it('hides a previous source synchronously on UID change before the auth callback', async () => {
    const view = await mount();
    expect(view.result.current).toBeDefined();
    mockAuth.currentUser = { uid: 'u2' };
    view.rerender({ value: uri });
    expect(view.result.current).toBeUndefined();
  });

  it('never shows a former account download after switching accounts', async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    mockGetBytes.mockReturnValueOnce(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    const view = await mount();
    mockGetBytes.mockRejectedValueOnce(new Error('storage/unauthorized'));
    await act(async () => {
      mockAuth.currentUser = { uid: 'u2' };
      mockAuthListener?.(mockAuth.currentUser);
      finish(Uint8Array.from([255, 216, 255]).buffer);
      await Promise.resolve();
    });
    expect(view.result.current).toBeUndefined();
  });
  it('unsubscribes and ignores late downloads on unmount', async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    mockGetBytes.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    const view = await mount();
    view.unmount();
    finish(Uint8Array.from([255, 216, 255]).buffer);
    await act(async () => { await Promise.resolve(); });
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
