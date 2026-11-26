import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { shippingItemProjection, shippingSourceFingerprint } from './shippingSourceIdentity';
const legacyItem = (article: any) => Object.fromEntries(['title','description','price','images','category','categoryIds','condition','size','brand','colors','materials','packageSize','shopId']
  .filter(k => article[k] !== undefined).map(k => [k,article[k]]));
const legacyHash = (v: any) => createHash('sha256').update(JSON.stringify({ articleId:v.articleId,sellerId:v.sellerId,buyerId:v.buyerId,
  origin:v.origin,destination:v.destination,parcel:v.parcel,parcelVersion:v.parcelVersion,item:v.item,amount:v.amount,fee:v.fee,tax:v.tax,reduction:v.reduction,
  buyerVersion:v.buyerVersion,sellerVersion:v.sellerVersion,accountId:v.accountId,stripeChargesEnabled:v.stripeChargesEnabled,proofIdentity:v.proofIdentity,shops:v.shops })).digest('hex');
it.each([{}, {title:'X',price:50,images:['a'],shopId:null,size:undefined}, {title:'X',price:0,materials:[],categoryIds:['A','B'],promotionActive:true}])('exact V4 item projection/key order including omitted/null values %j', article => {
  expect(JSON.stringify(shippingItemProjection(article))).toBe(JSON.stringify(legacyItem(article)));
});
it.each([null,'proof'])('18-key fingerprint matches exact archived expression and excludes separate observation fence (%s)', proofIdentity => {
  const value: any = { articleId:'a',sellerId:'s',buyerId:'b',origin:{country:'CA',province:'QC'},destination:{country:'CA',province:'QC'},parcel:{weight:{value:0.8,unit:'kilogram'}},parcelVersion:1,
    item:{title:'X',price:50},amount:50,fee:4,tax:0,reduction:0,buyerVersion:'bver',sellerVersion:'sver',accountId:'acct_x',stripeChargesEnabled:true,proofIdentity,shops:[{id:'shop',status:'approved',tier:'pro',paidUntil:123}] };
  expect(shippingSourceFingerprint(value)).toBe(legacyHash(value));
  expect(shippingSourceFingerprint({...value,observationRevision:999})).toBe(legacyHash(value));
  for(const key of Object.keys(value).filter(k => value[k] !== null)) expect(shippingSourceFingerprint({...value,[key]:null})).not.toBe(legacyHash(value));
});
