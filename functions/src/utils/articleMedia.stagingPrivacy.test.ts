import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createFirestoreMock} from './testHelpers/firestoreMock';
const h=vi.hoisted(()=>({fs:null as any,files:new Map<string,any>(),copy:vi.fn(),patch:vi.fn(),refusePatch:false,leaveToken:false}));
vi.mock('../config/firebase',()=>({db:new Proxy({},{get:(_t,k)=>h.fs.db[k]}),storage:{bucket:()=>({name:'test-bucket',file:(path:string)=>({
  getMetadata:async()=>[{...h.files.get(path),metadata:{...h.files.get(path)?.metadata}}],
  setMetadata:async(p:any,pre:any)=>{h.patch(path,p,pre);if(h.refusePatch)throw {code:412};
    const old=h.files.get(path);if(String(pre.ifGenerationMatch)!==old.generation||String(pre.ifMetagenerationMatch)!==old.metageneration)throw {code:412};
    const metadata={...old.metadata,...p.metadata};if(metadata.firebaseStorageDownloadTokens===null){
      if(h.leaveToken)metadata.firebaseStorageDownloadTokens=old.metadata.firebaseStorageDownloadTokens;else delete metadata.firebaseStorageDownloadTokens;}
    h.files.set(path,{...old,...p,metadata,metageneration:String(Number(old.metageneration)+1)});},
  copy:async(target:any)=>{h.copy(path,target.name);h.files.set(target.name,{...h.files.get(path),generation:'200',metageneration:'1'});},
  name:path,
})})}}));
import {promoteArticleImages} from './articleMedia';
const staged='drafts/alice/request/photo.jpg',url='https://firebasestorage.googleapis.com/v0/b/test-bucket/o/'+encodeURIComponent(staged)+'?alt=media';
beforeEach(()=>{h.fs=createFirestoreMock({enforceReadBeforeWrite:true});h.files.clear();h.copy.mockClear();h.patch.mockClear();h.refusePatch=false;h.leaveToken=false;
  h.files.set(staged,{generation:'100',metageneration:'2',crc32c:'checksum',contentType:'image/jpeg',size:100,
    cacheControl:'private, no-store, max-age=0',metadata:{firebaseStorageDownloadTokens:'auto-generated-private-token'}});});
describe('publication retires the SDK draft bearer token',()=>{
  it('verifies private exact source before making a separately named public copy',async()=>{
    const [image]=await promoteArticleImages([{url}],'alice','article');
    expect(h.patch.mock.calls[0]).toEqual([staged,{cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}},
      {ifGenerationMatch:'100',ifMetagenerationMatch:'2'}]);
    expect(h.files.get(staged).metadata.firebaseStorageDownloadTokens).toBeUndefined();
    expect(h.files.get(staged).cacheControl).toBe('private, no-store');
    expect(h.copy).toHaveBeenCalledTimes(1);expect(image.url).toContain('&token=');
    expect(image.url).not.toContain('auto-generated-private-token');
    const destination=decodeURIComponent(new URL(image.url).pathname.split('/o/')[1]);
    expect(h.files.get(destination).metadata.firebaseStorageDownloadTokens).toBe(new URL(image.url).searchParams.get('token'));
  });
  it('refuses publication with zero copies when the source metadata races',async()=>{
    h.refusePatch=true;await expect(promoteArticleImages([{url}],'alice','article')).rejects.toMatchObject({code:'failed-precondition'});
    expect(h.copy).not.toHaveBeenCalled();expect(h.fs.writeOps).toHaveLength(0);
  });
  it('does not trust a successful patch when native metadata still exposes a token',async()=>{
    h.leaveToken=true;await expect(promoteArticleImages([{url}],'alice','article')).rejects.toMatchObject({code:'failed-precondition'});
    expect(h.copy).not.toHaveBeenCalled();expect(h.fs.writeOps).toHaveLength(0);
  });
  it('never retires a source from another UID',async()=>{
    await expect(promoteArticleImages([{url}],'bob','article')).rejects.toMatchObject({code:'permission-denied'});
    expect(h.patch).not.toHaveBeenCalled();expect(h.copy).not.toHaveBeenCalled();
  });
});
