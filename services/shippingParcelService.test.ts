import {beforeEach, describe, expect, it, vi} from 'vitest';
import {httpsCallable} from 'firebase/functions';
import {ShippingParcelService} from './shippingParcelService';
import {automaticShippingEstimate} from '@/functions/src/shared/automaticShippingEstimate';
import {getCategoryPath} from '@/functions/src/shared/categories';

const {assertSession, captureSession} = vi.hoisted(() => ({assertSession: vi.fn(), captureSession: vi.fn(() => ({uid: 'seller', generation: 1}))}));
vi.mock('@/services/tradeOperation', () => ({assertTradeSessionCurrent: assertSession, captureTradeSession: captureSession}));

const parcel = {weight: {value: 1, unit: 'kilogram'}, dimensions: {length: 40, width: 30, height: 12, unit: 'centimeter'}};
const recommendation = {source: 'automatic_profile', profileSize: 'medium', profileVersion: 1, parcel, recommendationBasis: 'listing_package_size'};
const automatic = {articleId: 'article', version: 1, parcel, measurementVerified: false, source: 'automatic_profile', profileSize: 'medium', profileVersion: 1, recommendation};
const send = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(httpsCallable).mockReturnValue(send);
});

describe('automatic parcel RPC contract', () => {
  it('reads a server recommendation without any preparation write', async () => {
    send.mockResolvedValue({data: {...automatic, version: 0, status: 'missing', parcel: null, source: null, profileSize: null, profileVersion: null}});
    const result = await ShippingParcelService.read('seller', 'article', () => {});
    expect(result).toMatchObject({status: 'missing', parcel: null, recommendation: {profileSize: 'medium'}});
    expect(httpsCallable).toHaveBeenCalledTimes(1);
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getArticleShippingParcel');
  });

  it('sends only a profile choice, expected version and stable request identity', async () => {
    send.mockResolvedValue({data: {...automatic, replay: false}});
    expect(await ShippingParcelService.saveAutomatic('seller', 'article', 0, 'same_request', 'medium', () => {}))
      .toMatchObject({source: 'automatic_profile', profileSize: 'medium', measurementVerified: false});
    expect(send).toHaveBeenCalledWith({articleId: 'article', expectedVersion: 0, requestId: 'same_request', profileSize: 'medium'});
    expect(send.mock.calls[0][0]).not.toHaveProperty('parcel');
  });

  it('reads the exact estimated GET shape produced by the server', async () => {
    send.mockResolvedValue({data: {...automatic, version: 2, status: 'estimated', recommendation: {...recommendation, recommendationBasis: 'category'}}});
    expect(await ShippingParcelService.read('seller', 'article', () => {}))
      .toMatchObject({version: 2, status: 'estimated', source: 'automatic_profile', profileSize: 'medium', measurementVerified: false,
        recommendation: {recommendationBasis: 'category'}});
  });

  it('preserves an old declared parcel instead of relabeling it as an estimate', async () => {
    send.mockResolvedValue({data: {articleId: 'article', version: 4, parcel, status: 'declared', measurementVerified: false}});
    expect(await ShippingParcelService.read('seller', 'article', () => {}))
      .toMatchObject({version: 4, source: 'seller_declared', profileSize: null, recommendation: null, parcel});
  });

  it('rejects a contradictory preparation response instead of treating it as saved', async () => {
    send.mockResolvedValue({data: {...automatic, profileSize: 'large', replay: false}});
    await expect(ShippingParcelService.saveAutomatic('seller', 'article', 0, 'same_request', 'medium', () => {})).rejects.toThrow('format du colis');
  });

  it('does not accept a response once the session has changed', async () => {
    send.mockImplementationOnce(async () => {
      assertSession.mockImplementationOnce(() => {throw new Error('Ancienne session');});
      return {data: {...automatic, replay: false}};
    });
    await expect(ShippingParcelService.saveAutomatic('seller', 'article', 0, 'same_request', 'medium', () => {})).rejects.toThrow('Ancienne session');
  });

  it('reads a V2 product family without changing the saved V1 parcel', async () => {
    const estimate = automaticShippingEstimate({categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
    send.mockResolvedValue({data: {...automatic, status: 'estimated', recommendation: estimate}});
    expect(await ShippingParcelService.read('seller', 'article', () => {})).toMatchObject({
      profileVersion: 1, profileFamily: null, parcel, recommendation: {profileVersion: 2, profileFamily: 'light_clothing'},
    });
  });

  it('saves the exact V2 family identity without sending guessed measurements', async () => {
    const estimate = automaticShippingEstimate({categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
    send.mockResolvedValue({data: {...automatic, ...estimate, recommendation: estimate, replay: false}});
    const choice = {profileVersion: estimate.profileVersion, profileFamily: estimate.profileFamily, profileSize: estimate.profileSize};
    expect(await ShippingParcelService.saveAutomatic('seller', 'article', 1, 'same_v2_request', choice, () => {}))
      .toMatchObject({profileVersion: 2, profileFamily: 'light_clothing', parcel: estimate.parcel});
    expect(send).toHaveBeenCalledWith({articleId: 'article', expectedVersion: 1, requestId: 'same_v2_request', ...choice});
    expect(send.mock.calls[0][0]).not.toHaveProperty('parcel');
  });

  it('rejects a V2 parcel that does not belong to its recorded family', async () => {
    const estimate = automaticShippingEstimate({categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
    send.mockResolvedValue({data: {...automatic, ...estimate, status: 'estimated', parcel, recommendation: estimate}});
    await expect(ShippingParcelService.read('seller', 'article', () => {})).rejects.toThrow('format du colis');
  });
});
