import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
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
let mockUid='I';let mockGeneration=90;let mockFocused=true;let mockId='item';let mockReceiptArticle:Article|null=null;
let mockMenuOpener:()=>void=()=>undefined;
const mockRead=jest.fn(),mockListRead=jest.fn(),mockTrack=jest.fn();
jest.mock('expo-router',()=>({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
useLocalSearchParams:()=>({id:mockId}),useRouter:()=>({back:jest.fn(),replace:jest.fn(),push:jest.fn()}),useFocusEffect:(callback:()=>void|(()=>void))=>{const React=require('react');React.useEffect(()=>{if(mockFocused)return callback();},[callback,mockFocused]);}}));
jest.mock('@/store/authStore',()=>({getAuthSessionGeneration:()=>mockGeneration,useAuthStore:Object.assign((selector:(s:{user:{id:string};authenticatedUid:string})=>unknown)=>selector({user:{id:mockUid},authenticatedUid:mockUid}),{getState:()=>({user:{id:mockUid},authenticatedUid:mockUid})})}));
jest.mock('@/hooks/useAuthRequired',()=>({useRequireAuth:()=>({requireAuth:(f:()=>void)=>f()})}));
jest.mock('@/hooks/useFavorites',()=>({useFavorites:()=>({toggleFavorite:jest.fn(),isFavorite:()=>false}),favoritesKeys:{all:['favorites']}}));
jest.mock('@/services/articlesService',()=>({ArticlesService:{getArticleById:(...a:unknown[])=>mockRead(...a),getUserArticles:(...a:unknown[])=>mockListRead(...a)}}));
jest.mock('@/services/chatService',()=>({ChatService:{}}));
jest.mock('@/services/chat/offers',()=>({acknowledgeMeetupProposal:jest.fn()}));
jest.mock('@/services/swapService',()=>({GENERALIST_ZONE_ID:'zone'}));
jest.mock('@/services/guestPreferencesService',()=>({guestPreferencesService:{},toArticleMeta:jest.fn()}));
jest.mock('@/lib/analytics',()=>({track:(...a:unknown[])=>mockTrack(...a)}));
jest.mock('@/features/article',()=>{
 const React=require('react');const {View,Text,Pressable}=require('react-native');const actual=jest.requireActual<typeof import('@/features/article/hooks/useArticleActions')>('@/features/article/hooks/useArticleActions');return {useArticleActions:actual.useArticleActions,ArticleHero:View,ArticleCTABar:View,ArticleFloatingHeader:({onMoreOptions}:{onMoreOptions:()=>void})=>(mockMenuOpener=onMoreOptions,React.createElement(Pressable,{testID:'actual-owner-menu',onPress:onMoreOptions},React.createElement(Text,null,'Menu'))),ArticleDetails:({article}:{article:Article})=>React.createElement(View,null,React.createElement(Text,{testID:'actual-status'},article.isSold?'sold':'listed'),React.createElement(Text,{testID:'actual-price'},String(article.price))),LoadingState:View,ErrorState:View,articleStyles:{},buildTags:()=>[],getDiscountPercent:()=>0};
});
jest.mock('@/features/offers/components/MakeOfferModal',()=>{const React=require('react');return React.forwardRef(()=>null);});
jest.mock('@/components/ReportBottomSheet',()=>{const React=require('react');return React.forwardRef(()=>null);});
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})}));
jest.mock('@/features/sell/services/draftService',()=>({draftService:{}}));
jest.mock('@/components/ui',()=>{const {View,Text}=require('react-native');return {
  Button: jest.requireActual('@/components/ui/Button').Button,
Text,ScreenHeader:View,Skeleton:View};});
jest.mock('@shopify/flash-list',()=>{const React=require('react');const {View}=require('react-native');return {FlashList:({data,renderItem}:{data:Article[];renderItem:(value:{item:Article})=>React.ReactNode})=>React.createElement(View,null,data.map(item=>React.createElement(React.Fragment,{key:item.id},renderItem({item})) ))};});
jest.mock('react-native-gesture-handler',()=>{const React=require('react');const {View}=require('react-native');return {Swipeable:React.forwardRef(({children}:{children:React.ReactNode},ref:React.Ref<{close:()=>void}>)=>{React.useImperativeHandle(ref,()=>({close:jest.fn()}));return React.createElement(View,null,children);})};});
import MyArticlesScreen from '@/app/my-articles';
import ArticleDetailScreen from '@/app/article/[id]';
let revision=1;let sold=false;let dispatch:jest.Mock;let menu:jest.SpyInstance;let alerts:jest.SpyInstance;let client:QueryClient;
const article=():Article=>({id:mockId,sellerId:'I',title:'Produit de revue',price:40,isSold:sold,isActive:true,images:[{url:'https://example.test/image.jpg'}],createdAt:new Date('2026-10-12T00:00:00Z'),likes:0,views:0,isHandDelivery:true,isShipping:false,description:'Test',condition:'bon état',category:'top',categoryIds:['top'],sellerName:'I'});
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();mockGeneration++;mockUid='I';mockId='item';mockFocused=true;sold=false;revision=1;mockReceiptArticle=null;(auth as unknown as {currentUser:{uid:string}}).currentUser={uid:'I'};mockRead.mockImplementation(async()=>{const a=article();mockReceiptArticle=a;return a;});mockListRead.mockImplementation(async()=>[article()]);dispatch=jest.fn(async(input:Record<string,unknown>)=>{if(input.operation==='observe')return {data:{operation:'observe',articleId:input.articleId,isSold:sold,revision:String(revision).padStart(64,'0')}};if(input.operation==='set'){if(input.expectedRevision!==String(revision).padStart(64,'0'))throw Object.assign(new Error('stale'),{code:'functions/failed-precondition',details:{reason:'article_sold_observation_stale',action:'refreshArticle',articleId:input.articleId,requestId:input.requestId,currentIsSold:sold,currentRevision:String(revision).padStart(64,'0')}});sold=input.desiredIsSold as boolean;revision++;return {data:{success:true,operation:'set',outcome:'applied',articleId:input.articleId,requestId:input.requestId,isSold:sold,revision:null}};}sold=!sold;revision++;return {data:{success:true}};});(httpsCallable as jest.Mock).mockImplementation(()=>dispatch);menu=jest.spyOn(ActionSheetIOS,'showActionSheetWithOptions').mockImplementation(()=>undefined);alerts=jest.spyOn(Alert,'alert').mockImplementation(()=>undefined);});
afterEach(()=>{notifyManager.setScheduler(defaultScheduler);client?.clear();jest.restoreAllMocks();});
async function mount(structuralSharing?:false){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,...(structuralSharing===false?{structuralSharing}: {})}}});const screen=render(<QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>);await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));return screen;}
function choice(screen:ReturnType<typeof render>,label:string){fireEvent.press(screen.getByTestId('actual-owner-menu'));const [options,callback]=menu.mock.calls.at(-1)! as [{options:string[]},(i:number)=>void];act(()=>callback(options.options.findIndex(s=>s.includes(label))));}

const mutations=()=>dispatch.mock.calls.filter(([input])=>input.operation!=='observe');
async function confirmation(screen:ReturnType<typeof render>){choice(screen,'vendu');await waitFor(()=>expect(alerts.mock.calls.some(([title])=>title==='Marquer comme vendu ?')).toBe(true));const buttons=alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[];return buttons.find(b=>b.style!=='cancel')!.onPress!;}
async function refreshSold(screen:ReturnType<typeof render>){sold=true;revision++;await act(async()=>{await client.refetchQueries({queryKey:queryKeys.articles.detail('item')});});await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));}
it('V4-UI01 old actual Alert after same-id Query refetch cannot mutate or observe again',async()=>{const screen=await mount();const confirm=await confirmation(screen);await refreshSold(screen);const before=dispatch.mock.calls.length;await act(async()=>confirm());expect(mutations()).toHaveLength(0);expect(dispatch).toHaveBeenCalledTimes(before);expect(sold).toBe(true);});
it('V4-UI02 old actual owner menu after same-id Query refetch cannot open a new intention',async()=>{const screen=await mount();fireEvent.press(screen.getByTestId('actual-owner-menu'));const [options,run]=menu.mock.calls.at(-1)! as [{options:string[]},(i:number)=>void];await refreshSold(screen);await act(async()=>run(options.options.findIndex(s=>s.includes('vendu'))));expect(mutations()).toHaveLength(0);expect(dispatch).not.toHaveBeenCalled();expect(alerts.mock.calls.filter(([title])=>title==='Marquer comme vendu ?')).toEqual([]);});

it('V4-UI03 current confirmation observes before presentation; two opposite gestures each get a fresh revision and ACK',async()=>{
 const screen=await mount();const confirm=await confirmation(screen);expect(dispatch.mock.calls.map(([p])=>p.operation)).toEqual(['observe']);await act(async()=>confirm());await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));await waitFor(()=>expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1));choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));expect(mutations()).toHaveLength(2);const [first,second]=mutations().map(([p])=>p);expect(second.requestId).not.toBe(first.requestId);expect(second.expectedRevision).not.toBe(first.expectedRevision);expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(2);
});
it('V4-UI04 delayed observation after same-id refetch never presents stale confirmation and current action remains usable',async()=>{
 const screen=await mount();let release!:(v:unknown)=>void;dispatch.mockImplementationOnce(()=>new Promise(r=>{release=r;}));choice(screen,'vendu');await waitFor(()=>expect(release).toBeDefined());await refreshSold(screen);await act(async()=>release({data:{operation:'observe',articleId:'item',isSold:false,revision:'a'.repeat(64)}}));expect(mutations()).toHaveLength(0);expect(alerts.mock.calls.filter(([title])=>title==='Marquer comme vendu ?')).toEqual([]);choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));expect(mutations()).toHaveLength(1);
});
it('V4-UI05 cache replacement before subscription delivery rejects old Alert with zero additional callable IO',async()=>{
 const screen=await mount();const confirm=await confirmation(screen);const notifications:(()=>void)[]=[];notifyManager.setScheduler(cb=>notifications.push(cb));sold=true;revision++;client.setQueryData(client.getQueryCache().findAll({queryKey:queryKeys.articles.detail('item')}).find(q=>q.queryKey.includes('visit')&&q.getObserversCount()>0)!.queryKey,article());expect(screen.getByTestId('actual-status')).toHaveTextContent('listed');const count=dispatch.mock.calls.length;await act(async()=>confirm());expect(dispatch).toHaveBeenCalledTimes(count);expect(mutations()).toHaveLength(0);notifyManager.setScheduler(defaultScheduler);await act(async()=>notifications.splice(0).forEach(cb=>cb()));
});
it('V4-UI06 server stale after precheck reconciles actual article and emits no new sale event; current gesture works',async()=>{
 const screen=await mount();const confirm=await confirmation(screen);revision++;sold=true;await act(async()=>confirm());await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));expect(alerts).toHaveBeenCalledWith('État actualisé',expect.any(String));expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toEqual([]);expect(JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!).proof.kind).toBe('stale');await waitFor(()=>expect(client.isFetching()).toBe(0));choice(screen,'Remettre');await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1);
});
it('V4-UI07 cancel consumes the old Alert; the next actual confirmation remains usable',async()=>{
 const screen=await mount();const old=await confirmation(screen);const buttons=alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[];await act(async()=>buttons.find(b=>b.style==='cancel')!.onPress!());await act(async()=>old());expect(mutations()).toHaveLength(0);const fresh=await confirmation(screen);await act(async()=>fresh());await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));expect(mutations()).toHaveLength(1);
});
it.each(['generation','uid','focus','article-aba'] as const)('V4-UI08 old confirmation after %s cannot observe/set or adopt another context',async change=>{
 const screen=await mount();const confirm=await confirmation(screen);if(change==='generation')mockGeneration++;if(change==='uid'){mockUid='other';(auth as unknown as {currentUser:{uid:string}}).currentUser={uid:'other'};}if(change==='focus')mockFocused=false;if(change==='article-aba')mockId='other';await screen.rerenderAsync(<QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>);if(change==='article-aba'){mockId='item';await screen.rerenderAsync(<QueryClientProvider client={client}><ArticleDetailScreen/></QueryClientProvider>);}const count=dispatch.mock.calls.length;await act(async()=>confirm());expect(dispatch).toHaveBeenCalledTimes(count);expect(mutations()).toHaveLength(0);expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toEqual([]);
});
async function mountList(){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});const screen=render(<QueryClientProvider client={client}><MyArticlesScreen/></QueryClientProvider>);await waitFor(()=>expect(screen.getAllByText('En vente')).toHaveLength(2));return screen;}
function listChoice(screen:ReturnType<typeof render>,label:string){fireEvent.press(screen.getByTestId('icon-ellipsis-vertical'));const [options,callback]=menu.mock.calls.at(-1)! as [{options:string[]},(i:number)=>void];act(()=>callback(options.options.findIndex(s=>s.includes(label))));}
async function listConfirmation(screen:ReturnType<typeof render>){const count=alerts.mock.calls.length;listChoice(screen,'vendu');await waitFor(()=>expect(alerts.mock.calls.length).toBeGreaterThan(count));const buttons=alerts.mock.calls.at(-1)![2] as {style?:string;onPress?:()=>void}[];return buttons.find(b=>b.style!=='cancel')!.onPress!;}
async function refreshList(screen:ReturnType<typeof render>){sold=true;revision++;await act(async()=>{await client.refetchQueries({queryKey:queryKeys.articles.userList('I')});});await waitFor(()=>expect(screen.getByText('Vendu')).toBeTruthy());}
it('V4-LIST01 old Alert after actual list refetch same id does zero set and leaves current action usable',async()=>{
 const screen=await mountList();const old=await listConfirmation(screen);await refreshList(screen);const count=dispatch.mock.calls.length;await act(async()=>old());expect(dispatch).toHaveBeenCalledTimes(count);expect(mutations()).toHaveLength(0);listChoice(screen,'Remettre');await waitFor(()=>expect(screen.getAllByText('En vente')).toHaveLength(2));expect(mutations()).toHaveLength(1);expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1);
});
it('V4-LIST02 old menu after actual list refetch cannot open a fresh confirmation or dispatch',async()=>{
 const screen=await mountList();fireEvent.press(screen.getByTestId('icon-ellipsis-vertical'));const [options,callback]=menu.mock.calls.at(-1)! as [{options:string[]},(i:number)=>void];await refreshList(screen);await act(async()=>callback(options.options.findIndex(s=>s.includes('vendu'))));expect(dispatch).not.toHaveBeenCalled();expect(alerts).not.toHaveBeenCalled();
});
it('V4-LIST03 actual default list cache ACKs only committed reference; fresh opposite gesture observes and mutates',async()=>{
 const screen=await mountList();const confirm=await listConfirmation(screen);await act(async()=>confirm());await waitFor(()=>expect(screen.getByText('Vendu')).toBeTruthy());expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1);listChoice(screen,'Remettre');await waitFor(()=>expect(screen.getAllByText('En vente')).toHaveLength(2));expect(mutations()).toHaveLength(2);expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(2);
});
it('V4-LIST04 list replacement with identical id during final read refuses cache overwrite and adoption',async()=>{
 const screen=await mountList();let release!:(a:Article)=>void;mockRead.mockImplementationOnce(()=>new Promise(r=>{release=r;}));const confirm=await listConfirmation(screen);act(()=>confirm());await waitFor(()=>expect(release).toBeDefined());const received=article();await act(async()=>{client.setQueryData<Article[]>(queryKeys.articles.userList('I'),prior=>prior!.map(a=>({...a,price:99})));});await waitFor(()=>expect(screen.getByText('99 $')).toBeTruthy());await act(async()=>release(received));expect(client.getQueryData<Article[]>(queryKeys.articles.userList('I'))![0]).toMatchObject({price:99,isSold:false});expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toEqual([]);expect(JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!).proof.kind).toBe('applied');
});
it('V4-UI09 unavailable observe shows current error, releases slot, and a fresh confirmation succeeds',async()=>{
 const screen=await mount();dispatch.mockRejectedValueOnce(Object.assign(new Error('observation indisponible'),{code:'functions/unavailable'}));choice(screen,'vendu');await waitFor(()=>expect(alerts).toHaveBeenCalledWith('Erreur',expect.stringContaining('observation indisponible')));expect(mutations()).toHaveLength(0);const fresh=await confirmation(screen);await act(async()=>fresh());await waitFor(()=>expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));expect(mutations()).toHaveLength(1);
});
it('V4-UI10 applied commit followed by opposite current read displays reconciliation without new sale event',async()=>{
 const screen=await mount();const confirm=await confirmation(screen);mockRead.mockImplementation(async()=>({...article(),isSold:false}));await act(async()=>confirm());await waitFor(()=>expect(alerts).toHaveBeenCalledWith('État actualisé',expect.any(String)));expect(screen.getByTestId('actual-status')).toHaveTextContent('listed');expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toEqual([]);expect(JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:I:item')))!).proof).toMatchObject({kind:'applied',appliedIsSold:true});
});
it('V4-LIST05 delayed observe after actual list refetch never presents stale confirmation',async()=>{
 const screen=await mountList();let release!:(v:unknown)=>void;dispatch.mockImplementationOnce(()=>new Promise(r=>{release=r;}));listChoice(screen,'vendu');await waitFor(()=>expect(release).toBeDefined());await refreshList(screen);await act(async()=>release({data:{operation:'observe',articleId:'item',isSold:false,revision:'a'.repeat(64)}}));expect(mutations()).toHaveLength(0);expect(alerts).not.toHaveBeenCalled();listChoice(screen,'Remettre');await waitFor(()=>expect(screen.getAllByText('En vente')).toHaveLength(2));expect(mutations()).toHaveLength(1);
});
it('V4-LIST06 forced application render ACKs actual stored list even while Query notifications are deferred',async()=>{
 const screen=await mountList();const confirm=await listConfirmation(screen);const notifications:(()=>void)[]=[];notifyManager.setScheduler(cb=>notifications.push(cb));await act(async()=>confirm());expect(client.getQueryData<Article[]>(queryKeys.articles.userList('I'))![0].isSold).toBe(true);expect(screen.getByText('Vendu')).toBeTruthy();expect(mockTrack.mock.calls.filter(([n])=>n==='article_sold_toggled')).toHaveLength(1);expect(notifications.length).toBeGreaterThan(0);notifyManager.setScheduler(defaultScheduler);await act(async()=>notifications.splice(0).forEach(cb=>cb()));await waitFor(()=>expect(client.isFetching()).toBe(0));listChoice(screen,'Remettre');await waitFor(()=>expect(screen.getAllByText('En vente')).toHaveLength(2));expect(mutations()).toHaveLength(2);
});

it('V4-UI11 retained menu opener after same-id actual refetch presents no stale menu or callable',async()=>{
 const screen=await mount();const open=mockMenuOpener;await refreshSold(screen);await act(async()=>open());expect(menu).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(alerts).not.toHaveBeenCalled();
});

it('adopted detail sold receipt removes the Home card; relisting refreshes without inventing a new card', async () => {
  const screen = await mount();
  client.setQueryData(['home', 'new-arrivals'], [article()]);
  const confirm = await confirmation(screen);
  await act(async () => confirm());
  await waitFor(() => expect(screen.getByTestId('actual-status')).toHaveTextContent('sold'));
  await waitFor(() => expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([]));
  client.setQueryData(['home', 'new-arrivals'], []);
  expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(false);
  choice(screen, 'Remettre');
  await waitFor(() => expect(screen.getByTestId('actual-status')).toHaveTextContent('listed'));
  await waitFor(() => expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(true));
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([]);
  expect(mutations()).toHaveLength(2);
  expect(mockTrack.mock.calls.filter(([name]) => name === 'article_sold_toggled')).toHaveLength(2);
});

it('adopted owner-list sold receipt keeps its Vendu row but removes Home; relisting refreshes Home', async () => {
  const screen = await mountList();
  client.setQueryData(['home', 'new-arrivals'], [article()]);
  const confirm = await listConfirmation(screen);
  await act(async () => confirm());
  await waitFor(() => expect(screen.getByText('Vendu')).toBeTruthy());
  await waitFor(() => expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([]));
  expect(client.getQueryData<Article[]>(queryKeys.articles.userList('I'))?.[0].isSold).toBe(true);
  client.setQueryData(['home', 'new-arrivals'], []);
  listChoice(screen, 'Remettre');
  await waitFor(() => expect(screen.getAllByText('En vente')).toHaveLength(2));
  await waitFor(() => expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(true));
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([]);
  expect(mutations()).toHaveLength(2);
  expect(mockTrack.mock.calls.filter(([name]) => name === 'article_sold_toggled')).toHaveLength(2);
});
