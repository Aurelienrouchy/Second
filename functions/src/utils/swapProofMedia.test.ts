import {beforeEach,describe,expect,it,vi} from 'vitest';
import {captureSwapProofObjects,swapProofObject,swapProofMetadataMatches} from './swapProofMedia';
const path='swaps/swap/photos/owner/photo.jpg',object={path,generation:'11',crc32c:'AAAAAA==',contentType:'image/jpeg',size:100};
let metadata:Record<string,any>,afterPatch:(()=>void)|null;
const assertCurrent=vi.fn(async()=>{}),patch=vi.fn(async(value:any,options:any)=>{
  expect(options).toEqual({ifGenerationMatch:'11',ifMetagenerationMatch:'2'});
  metadata={...metadata,...value,metadata:{}};afterPatch?.();
});
const bucket={file:vi.fn(()=>({getMetadata:async()=>[metadata],setMetadata:patch}))} as any;
beforeEach(()=>{metadata={...object,metageneration:'2',cacheControl:'private, no-store',metadata:{}};afterPatch=null;vi.clearAllMocks();assertCurrent.mockResolvedValue(undefined);});
describe('generation-bound private member postal proofs',()=>{
  it('captures the native generation without modifying already private metadata',async()=>{
    expect(await captureSwapProofObjects(bucket,'swap','owner',[path],assertCurrent)).toEqual([object]);expect(patch).not.toHaveBeenCalled();
  });
  it('revokes the bearer token and cache header by exact generation/metageneration, then rereads',async()=>{
    metadata.cacheControl='public';metadata.metadata={firebaseStorageDownloadTokens:'synthetic'};
    expect(await captureSwapProofObjects(bucket,'swap','owner',[path],assertCurrent)).toEqual([object]);
    expect(patch).toHaveBeenCalledOnce();expect(metadata.metadata).not.toHaveProperty('firebaseStorageDownloadTokens');
  });
  it.each(['generation','crc32c','contentType','size','cacheControl','token'])('refuses a changed %s after the metadata CAS',async field=>{
    metadata.cacheControl='public';afterPatch=()=>{if(field==='token')metadata.metadata.firebaseStorageDownloadTokens='synthetic';
      else metadata[field]=({generation:'12',crc32c:'BBBBBB==',contentType:'image/png',size:101,cacheControl:'public'} as any)[field];};
    await expect(captureSwapProofObjects(bucket,'swap','owner',[path],assertCurrent)).rejects.toMatchObject({code:'failed-precondition'});
  });
  it.each(['0','11.2','9007199254740993x'])('refuses invalid native generation %s before mutation',async generation=>{
    metadata.generation=generation;await expect(captureSwapProofObjects(bucket,'swap','owner',[path],assertCurrent)).rejects.toMatchObject({code:'failed-precondition'});
    expect(patch).not.toHaveBeenCalled();
  });
  it('does not read/mutate an object after the private session changed',async()=>{
    assertCurrent.mockRejectedValueOnce(Error('session changed'));
    await expect(captureSwapProofObjects(bucket,'swap','owner',[path],assertCurrent)).rejects.toThrow('session changed');expect(bucket.file).not.toHaveBeenCalled();
  });
  it('refuses a native CAS conflict without declaring a captured proof',async()=>{
    metadata.cacheControl='public';patch.mockRejectedValueOnce(Object.assign(Error('conflict'),{code:412}));
    await expect(captureSwapProofObjects(bucket,'swap','owner',[path],assertCurrent)).rejects.toMatchObject({code:412});
  });
  it.each(['swaps/swap/photos/peer/photo.jpg','swaps/other/photos/owner/photo.jpg','swaps/swap/photos/owner/nested/photo.jpg'])('refuses a foreign/noncanonical identity %s',value=>{
    expect(swapProofObject({...object,path:value},'swap','owner')).toBe(false);
  });
  it('refuses extra witness fields and a null bearer-token field',()=>{
    expect(swapProofObject({...object,authority:'financial'},'swap','owner')).toBe(false);
    expect(swapProofMetadataMatches({...metadata,metadata:{firebaseStorageDownloadTokens:null}},object)).toBe(false);
  });
});
