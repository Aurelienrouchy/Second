import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
import React from 'react';
import {act,render,fireEvent,waitFor} from '@testing-library/react-native';
import {ActionSheetIOS,Alert,View,Text} from 'react-native';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {defaultScheduler,notifyManager} from '@tanstack/query-core';
import {httpsCallable} from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {auth} from '@/config/firebaseConfig';
import {queryKeys} from '@/lib/queryKeys';
import type {Article} from '@/types';
let mockUid='I';let mockGeneration=90;let mockFocused=true;let mockId='item';let mockReceiptArticle:Article|null=null;let mockRenderedArticle:Article|null=null;
const mockRead=jest.fn(),mockTrack=jest.fn();
jest.mock('expo-router',()=>({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
useLocalSearchParams:()=>({id:mockId}),useRouter:()=>({back:jest.fn(),replace:jest.fn(),push:jest.fn()}),useFocusEffect:(callback:()=>void|(()=>void))=>{const React=require('react');React.useEffect(()=>{if(mockFocused)return callback();},[callback,mockFocused]);}}));
jest.mock('@/store/authStore',()=>({getAuthSessionGeneration:()=>mockGeneration,useAuthStore:Object.assign((selector:(s:{user:{id:string};authenticatedUid:string})=>unknown)=>selector({user:{id:mockUid},authenticatedUid:mockUid}),{getState:()=>({user:{id:mockUid},authenticatedUid:mockUid})})}));
jest.mock('@/hooks/useAuthRequired',()=>({useRequireAuth:()=>({requireAuth:(f:()=>void)=>f()})}));
jest.mock('@/hooks/useFavorites',()=>({useFavorites:()=>({toggleFavorite:jest.fn(),isFavorite:()=>false}),favoritesKeys:{all:['favorites']}}));
jest.mock('@/services/articlesService',()=>({ArticlesService:{getArticleById:(...a:unknown[])=>mockRead(...a)}}));
jest.mock('@/services/chatService',()=>({ChatService:{}}));
jest.mock('@/services/chat/offers',()=>({acknowledgeMeetupProposal:jest.fn(),readMeetupProposalRecovery:jest.fn(async()=>null)}));
jest.mock('@/services/swapService',()=>({GENERALIST_ZONE_ID:'zone'}));
jest.mock('@/services/guestPreferencesService',()=>({guestPreferencesService:{},toArticleMeta:jest.fn()}));
jest.mock('@/lib/analytics',()=>({track:(...a:unknown[])=>mockTrack(...a)}));
jest.mock('@/features/article',()=>{
 const React=require('react');const {View,Text,Pressable}=require('react-native');const actual=jest.requireActual<typeof import('@/features/article/hooks/useArticleActions')>('@/features/article/hooks/useArticleActions');return {useArticleActions:actual.useArticleActions,ArticleHero:View,ArticleCTABar:View,ArticleFloatingHeader:({onMoreOptions}:{onMoreOptions:()=>void})=>React.createElement(Pressable,{testID:'actual-owner-menu',onPress:onMoreOptions},React.createElement(Text,null,'Menu')),ArticleDetails:({article}:{article:Article})=>(mockRenderedArticle=article,React.createElement(View,null,React.createElement(Text,{testID:'actual-status'},article.isSold?'sold':'listed'),React.createElement(Text,{testID:'actual-price'},String(article.price)))),LoadingState:View,ErrorState:View,articleStyles:{},buildTags:()=>[],getDiscountPercent:()=>0};
});
jest.mock('@/features/offers/components/MakeOfferModal',()=>{const React=require('react');return React.forwardRef(()=>null);});
jest.mock('@/components/ReportBottomSheet',()=>{const React=require('react');return React.forwardRef(()=>null);});
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
import ArticleDetailScreen from '@/app/article/[id]';
let sold=true;let dispatch:jest.Mock;let menu:jest.SpyInstance;let alerts:jest.SpyInstance;let client:QueryClient;
const article=():Article=>({id:mockId,sellerId:'I',title:'Produit de revue',price:40,isSold:sold,isActive:true,images:[{url:'https://example.test/image.jpg'}],createdAt:new Date('2026-10-12T00:00:00Z'),likes:0,views:0,isHandDelivery:true,isShipping:false,description:'Test',condition:'bon état',category:'top',categoryIds:['top'],sellerName:'I'});
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();mockGeneration++;mockUid='I';mockId='item';mockFocused=true;sold=true;mockReceiptArticle=null;(auth as unknown as {currentUser:{uid:string}}).currentUser={uid:'I'};mockRead.mockReset().mockImplementation(async()=>{const a=article();mockReceiptArticle=a;return a;});dispatch=jest.fn(async()=>{sold=!sold;return {data:{success:true}};});(httpsCallable as jest.Mock).mockImplementation(()=>async(p:Record<string,unknown>)=>{if(p.operation==='observe')return {data:{operation:'observe',articleId:p.articleId,isSold:sold,revision:'a'.repeat(64)}};const result=await dispatch(p);return {data:{...result.data,operation:'set',outcome:'applied',articleId:p.articleId,requestId:p.requestId,isSold:p.desiredIsSold,revision:null}};});menu=jest.spyOn(ActionSheetIOS,'showActionSheetWithOptions').mockImplementation(()=>undefined);alerts=jest.spyOn(Alert,'alert').mockImplementation(()=>undefined);});
afterEach(()=>{notifyManager.setScheduler(defaultScheduler);client?.clear();jest.restoreAllMocks();});
function articleVisitKey(id=mockId){const active=client.getQueryCache().findAll({queryKey:queryKeys.articles.detail(id)}).find(item=>item.queryKey.includes('visit')&&item.getObserversCount()>0);expect(active).toBeDefined();return active!.queryKey;}
async function mount(structuralSharing?:false){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,...(structuralSharing===false?{structuralSharing}: {})}}});const screen=render(<QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>);await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));return screen;}
async function choice(screen:ReturnType<typeof render>,label:string){await waitFor(()=>expect(mockRenderedArticle).toBe(client.getQueryData(articleVisitKey(mockId))));fireEvent.press(screen.getByTestId('actual-owner-menu'));const [options,callback]=menu.mock.calls.at(-1)! as [{options:string[]},(i:number)=>void];await act(async()=>callback(options.options.findIndex(s=>s.includes(label))));}
it('I-ARTICLE01 actual route and default QueryClient apply a sold result before its success event',async()=>{const screen=await mount();await choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));expect(dispatch).toHaveBeenCalledTimes(1);expect(client.getQueryData<Article>(articleVisitKey('item'))?.isSold).toBe(false);expect(mockReceiptArticle!.isSold).toBe(false);console.info('I-ARTICLE01 actual cache reference matches receipt',client.getQueryData(articleVisitKey('item'))===mockReceiptArticle);expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1);});
it('I-ARTICLE02 actual cache displays new result but reference differs; following mark sold must dispatch rather than reconcile forever',async()=>{const screen=await mount();await choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));expect(dispatch).toHaveBeenCalledTimes(1);expect(client.getQueryData(articleVisitKey('item'))).not.toBe(mockReceiptArticle);const oldReceipt=JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!);expect(oldReceipt.verifiedSold).toBe(false);expect(oldReceipt.receiptId).toBeTruthy();await choice(screen,'vendu');const confirm=(alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[]).find(b=>b.style!=='cancel')!.onPress!;act(()=>confirm());await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));await waitFor(()=>expect(client.isFetching()).toBe(0));expect(mockRead).toHaveBeenCalledTimes(5);expect(dispatch).toHaveBeenCalledTimes(2);});
it('I-ARTICLE03 qualified diagnostic control structuralSharing false allows actual receipt acknowledgement and second mutation',async()=>{const screen=await mount(false);await choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1);expect(client.getQueryData(articleVisitKey('item'))).toBe(mockReceiptArticle);await choice(screen,'vendu');const confirm=(alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[]).find(b=>b.style!=='cancel')!.onPress!;act(()=>confirm());await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));expect(dispatch).toHaveBeenCalledTimes(2);expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(2);});
it('V3-ARTICLE04 default sharing recognizes each current receipt and permits three deliberate alternating mutations',async()=>{
 const screen=await mount();await choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));const first=JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!);
 for(let n=0;n<3;n++){const expectedSold=n%2===0;await choice(screen,expectedSold?'vendu':'Remettre');if(expectedSold){const confirm=(alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[]).find(b=>b.style!=='cancel')!.onPress!;act(()=>confirm());}
 await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(2+n));await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent(expectedSold?'sold':'listed'));
 const current=JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!);expect(current.localId).not.toBe(first.localId);expect(current.receiptId).not.toBe(first.receiptId);expect(current.verifiedSold).toBe(expectedSold);}
expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(4);
});

async function confirmSold(screen:ReturnType<typeof render>){
 await choice(screen,'vendu');
 const buttons=alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[];
 if(buttons)await act(async()=>buttons.find(button=>button.style!=='cancel')!.onPress!());
}

it('V3-ARTICLE05 unchanged default cache reference acknowledges a read-only receipt without a Query data render',async()=>{
 const screen=await mount();sold=false;
 const stable={...article(),createdAt:new Date('2026-10-12T00:00:00Z')};
 await act(async()=>{client.setQueryData(articleVisitKey('item'),stable);});
 await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));
 const previous=client.getQueryData<Article>(articleVisitKey('item'))!;
 mockRead.mockImplementation(async()=>({...previous,images:previous.images,createdAt:previous.createdAt,categoryIds:previous.categoryIds}));
 await AsyncStorage.setItem(getEnvironmentStorageKey('article-sold:v1:I:item'),JSON.stringify({version:1,uid:'I',articleId:'item',localId:'unknown-existing'}));
 await confirmSold(screen);
 await waitFor(()=>expect(alerts).toHaveBeenCalledWith('État actualisé',expect.any(String)));
 expect(client.getQueryData(articleVisitKey('item'))).toBe(previous);
 expect(dispatch).not.toHaveBeenCalled();
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toEqual([]);
 await waitFor(()=>expect(client.isFetching()).toBe(0));
 mockRead.mockImplementation(async()=>({...previous,isSold:sold}));
 await confirmSold(screen);
 await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toHaveLength(1);
});

it('V3-ARTICLE06 forced application render recognizes default cache while Query subscription delivery is deferred',async()=>{
 const screen=await mount();const notifications:(()=>void)[]=[];
 notifyManager.setScheduler(callback=>notifications.push(callback));
 await choice(screen,'Remettre');
 expect(notifications.length).toBeGreaterThan(0);
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toHaveLength(1);
 expect(dispatch).toHaveBeenCalledTimes(1);
 notifyManager.setScheduler(defaultScheduler);
 await act(async()=>{notifications.splice(0).forEach(callback=>callback());});
 await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));
 await confirmSold(screen);
 await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toHaveLength(2);
});

it('V3-ARTICLE07 concurrent cache replacement refuses foreign adoption then a current reconciliation and fresh mutation succeed',async()=>{
 const screen=await mount();let release!:(value:Article)=>void;
 const visitKey=articleVisitKey();const cacheApplication=jest.spyOn(client,'setQueryData');
 mockRead.mockImplementationOnce(()=>new Promise<Article>(resolve=>{release=resolve;}));
 await choice(screen,'Remettre');await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(mockRead).toHaveBeenCalledTimes(2));
 const receipt=article();
 await act(async()=>{client.setQueryData<Article>(articleVisitKey('item'),previous=>({...previous!,price:99}));});
 await waitFor(()=>expect(client.getQueryData<Article>(articleVisitKey('item'))?.price).toBe(99));
 // Query notifies its observer asynchronously: the cache assertion alone does
 // not establish that the current route/menu have rendered the replacement.
 await waitFor(()=>expect(screen.getByTestId('actual-price')).toHaveTextContent('99'));
 expect(screen.getByTestId('actual-status')).toHaveTextContent('sold');
 await act(async()=>release(receipt));
 // V4 refuses the stale source before applying a cache receipt; its committed proof remains recoverable.
 await waitFor(()=>expect(cacheApplication.mock.calls.filter(([key])=>JSON.stringify(key)===JSON.stringify(visitKey))).toHaveLength(1));
 expect(client.getQueryData<Article>(articleVisitKey('item'))?.isSold).toBe(true);
 expect(client.getQueryData<Article>(articleVisitKey('item'))?.price).toBe(99);
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toEqual([]);
 expect(JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!).proof.kind).toBe('applied');
 mockRead.mockImplementation(async()=>({...article(),price:99}));
 await choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));
 expect(dispatch).toHaveBeenCalledTimes(1);
 expect(alerts).toHaveBeenCalledWith('État actualisé',expect.any(String));
 await confirmSold(screen);await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));
 expect(client.getQueryData<Article>(articleVisitKey('item'))?.price).toBe(99);
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toHaveLength(1);
});

it.each(['generation','uid','focus','article-aba'] as const)('V3-ARTICLE08 default cache late receipt after %s cannot acknowledge or emit success',async change=>{
 const screen=await mount();let release!:(value:Article)=>void;
 mockRead.mockImplementationOnce(()=>new Promise<Article>(resolve=>{release=resolve;}));
 await choice(screen,'Remettre');await waitFor(()=>expect(dispatch).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(mockRead).toHaveBeenCalledTimes(2));const oldVisit=articleVisitKey();const oldVisitData=client.getQueryData(oldVisit);const receipt=article();
 if(change==='generation')mockGeneration++;
 if(change==='uid'){mockUid='other';(auth as unknown as {currentUser:{uid:string}}).currentUser={uid:'other'};}
 if(change==='focus')mockFocused=false;
 if(change==='article-aba')mockId='other';
 await screen.rerenderAsync(<QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>);
 if(change==='article-aba'){mockId='item';await screen.rerenderAsync(<QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>);}
 await act(async()=>release(receipt));
 // The old query may remain until its GC timer, but its exact data may not be replaced by this late receipt.
 const retained=client.getQueryData(oldVisit);if(retained!==undefined)expect(retained).toBe(oldVisitData);
 expect(mockTrack.mock.calls.filter(([name])=>name==='article_sold_toggled')).toEqual([]);
 expect(alerts.mock.calls.filter(([title])=>title==='État actualisé'||title==='État à vérifier')).toEqual([]);
});
