/** Member postal evidence stays in its existing private namespace. An object
 * identity is native Storage metadata, never a client-supplied generation. */
import {HttpsError} from 'firebase-functions/v2/https';
import type {Bucket} from '@google-cloud/storage';
export type SwapProofObject={path:string;generation:string;crc32c:string;contentType:string;size:number};
const fail=():never=>{throw new HttpsError('failed-precondition','Les photos de cet échange doivent être qualifiées.');};
export function swapProofObject(value:unknown,swapId:string,ownerId:string):value is SwapProofObject {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,any>,parts=typeof v.path==='string'?v.path.split('/'):[];
  return Object.keys(v).sort().join(',')==='contentType,crc32c,generation,path,size'&&parts.length===5&&parts[0]==='swaps'&&
    parts[1]===swapId&&parts[2]==='photos'&&parts[3]===ownerId&&!!parts[4]&&!['.','..'].includes(parts[4])&&!parts[4].includes('\\')&&
    typeof v.generation==='string'&&/^[1-9]\d{0,24}$/.test(v.generation)&&typeof v.crc32c==='string'&&/^[A-Za-z0-9+/]{6}==$/.test(v.crc32c)&&
    typeof v.contentType==='string'&&/^image\/[a-z0-9.+-]+$/i.test(v.contentType)&&Number.isSafeInteger(v.size)&&v.size>0&&v.size<10*1024*1024;
}
export function swapProofMetadataMatches(metadata:Record<string,any>,object:SwapProofObject):boolean {
  return String(metadata.generation)===object.generation&&metadata.crc32c===object.crc32c&&metadata.contentType===object.contentType&&
    Number(metadata.size)===object.size&&metadata.cacheControl==='private, no-store'&&
    !Object.prototype.hasOwnProperty.call(metadata.metadata??{},'firebaseStorageDownloadTokens');
}
export async function captureSwapProofObjects(bucket:Bucket,swapId:string,ownerId:string,paths:string[],assertCurrent:()=>Promise<unknown>,beforeMutation=assertCurrent):Promise<SwapProofObject[]> {
  const objects:SwapProofObject[]=[];
  for(const path of paths){
    await assertCurrent();const file=bucket.file(path);let metadata;
    try{[metadata]=await file.getMetadata();}catch(error){if(Number((error as any)?.code)===404)return fail();throw error;}
    const size=Number(metadata.size);
    if(!metadata.contentType?.startsWith('image/')||!Number.isSafeInteger(size)||size<=0||size>=10*1024*1024)
      throw new HttpsError('invalid-argument','Photo de preuve invalide ou trop volumineuse');
    const object={path,generation:String(metadata.generation??''),crc32c:metadata.crc32c??'',contentType:metadata.contentType??'',size:Number(metadata.size)};
    if(!swapProofObject(object,swapId,ownerId))return fail();
    if(!swapProofMetadataMatches(metadata,object)){
      const metageneration=String(metadata.metageneration??'');if(!/^[1-9]\d{0,24}$/.test(metageneration))return fail();
      await beforeMutation();await file.setMetadata({cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}},
        {ifGenerationMatch:object.generation,ifMetagenerationMatch:metageneration});
    }
    await assertCurrent();[metadata]=await file.getMetadata();if(!swapProofMetadataMatches(metadata,object))return fail();objects.push(object);
  }
  return objects;
}
