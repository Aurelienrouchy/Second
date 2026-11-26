import { act, renderHook } from '@testing-library/react-native';
import { auth } from '@/config/firebaseConfig';
let mockGeneration = 1;
const mockFocusCallbacks: (() => () => void)[] = [];
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
 useFocusEffect: (callback: () => () => void) => { mockFocusCallbacks.push(callback); } }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: {authenticatedUid: string; user: {id: string}}) => unknown) =>
    selector({authenticatedUid: 'A', user: {id: 'A'}}), {getState: () => ({authenticatedUid: 'A', user: {id: 'A'}})}),
}));
import { useTradeOperation } from '@/hooks/useTradeOperation';
beforeEach(() => { mockGeneration = 1; mockFocusCallbacks.length = 0; (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'A' }; });
it('leaving a still-mounted route invalidates the old operation and captured callback', () => {
  const { result } = renderHook(() => useTradeOperation('article-A', 'A'));
  let blur!: () => void; act(() => { blur = mockFocusCallbacks[0](); }); const operation = result.current.start()!;
  act(() => blur()); expect(result.current.isCurrent(operation)).toBe(false);
  expect(() => result.current.capture()).toThrow();
});
it('refocusing the same dossier never restores old operation validity or releases the new lock', () => {
  const { result } = renderHook(() => useTradeOperation('article-A', 'A'));
  let blur!: () => void; act(() => { blur = mockFocusCallbacks[0](); }); const old = result.current.start()!; act(() => { blur(); mockFocusCallbacks[0](); });
  expect(result.current.isCurrent(old)).toBe(false); const current = result.current.start()!;
  result.current.finish(old); expect(result.current.ownsLock(current)).toBe(true); expect(result.current.start()).toBeNull();
  result.current.finish(current); expect(result.current.start()).not.toBeNull();
});
it('different dossiers with identical presentation still have different operation frames', () => {
  const { result, rerender } = renderHook(({ id }: { id: string }) => useTradeOperation(id, 'A'), { initialProps: { id: 'same-price-title-A' } });
  act(() => { mockFocusCallbacks[0](); });
  const old = result.current.capture(); rerender({ id: 'same-price-title-B' });
  expect(result.current.isCurrent(old)).toBe(false); expect(result.current.capture().frame).not.toBe(old.frame);
});

import { useCounterOfferDialogs } from '@/features/offers/components/offer-bubble/useCounterOfferDialogs';
import { waitFor } from '@testing-library/react-native';
it('refocusing retains the same dossier input while dropping its abandoned busy indicator', async () => {
  let release: () => void = () => undefined;
  const submit = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const { result } = renderHook(() => useCounterOfferDialogs({ chatId: 'chat-A', messageId: 'm-A', amount: 40, onCounterPrice: submit }));
  let blur!: () => void; act(() => { blur = mockFocusCallbacks[0](); }); act(() => { result.current.setCounterPriceAmount('35'); result.current.setCounterMessage('À reprendre'); });
  let pending!: Promise<void>; act(() => { pending = result.current.handleCounterPrice(); }); await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  act(() => { blur(); mockFocusCallbacks[0](); });
  expect(result.current.counterPriceAmount).toBe('35'); expect(result.current.counterMessage).toBe('À reprendre');
  expect(result.current.isCountering).toBe(false);
  await act(async () => { release(); await pending; });
});
