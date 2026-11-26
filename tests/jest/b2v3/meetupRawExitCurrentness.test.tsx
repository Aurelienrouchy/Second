import {meetupFirestoreFixture} from '@/tests/jest/helpers/meetupFirestoreFixture';
const mockNativeRead = jest.fn();
jest.mock('firebase/firestore', () => ({
 Timestamp: class TimestampFixture {time: number; constructor(mockTime: number) {this.time = mockTime;} static fromDate(value: Date) {return new this(value.getTime());} toDate() {return new Date(this.time);} toMillis() {return this.time;}},
 doc: (_db: unknown, col: string, id: string) => ({col, id}), collection: (_db: unknown, name: string) => ({name}),
 getDoc: (...args: unknown[]) => mockNativeRead(...args), getDocFromServer: (...args: unknown[]) => mockNativeRead(...args),
 getDocsFromServer: jest.fn(async () => ({docs: [], size: 0})), getDocs: jest.fn(async () => ({docs: [], size: 0})),
}));
// The provider IO supplies current positive foundations; session/admission guards stay real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
import {act,renderHook,waitFor} from '@testing-library/react-native';
import {Alert} from 'react-native';
import * as Haptics from 'expo-haptics';
import {auth} from '@/config/firebaseConfig';
let mockUid='I';let mockGeneration=30;let mockFocus=true;
const mockIO=jest.fn(),mockTrack=jest.fn();
jest.mock('expo-router',()=>({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
useFocusEffect:(callback:()=>void|(()=>void))=>{const React=require('react');React.useEffect(()=>{if(mockFocus)return callback();},[callback,mockFocus]);}}));
jest.mock('@/store/authStore',()=>({getAuthSessionGeneration:()=>mockGeneration,
 useAuthStore:Object.assign((selector:(state:{authenticatedUid:string;user:{id:string};identityUser?:{id:string};identityError?:boolean;isLoading?:boolean})=>unknown)=>selector({identityUser: {id:mockUid}, identityError: false, isLoading: false, authenticatedUid:mockUid,user:{id:mockUid}}),{
  getState:()=>({identityUser: {id:mockUid}, identityError: false, isLoading: false, authenticatedUid:mockUid,user:{id:mockUid}}),
 }),
}));
jest.mock('@/lib/analytics',()=>({track:(...a:unknown[])=>mockTrack(...a)}));
import {useMeetupDialogs} from '@/features/offers/components/offer-bubble/useMeetupDialogs';
function hook(){return useMeetupDialogs({chatId:'ind-chat',articleId:'ind-article',messageId:'ind-message',amount:23,isSeller:false,transactionId:'old-tx',onConfirmMeetup:(id)=>mockIO('confirm',id),onCompleteMeetup:(id)=>mockIO('complete',id),onCancelMeetup:(id)=>mockIO('cancel',id),onReportNoShow:(id,r,d)=>mockIO('report',id,r,d)});}
const dialogCases = [
 {kind:'confirm',method:'handleConfirmMeetup',title:'Confirmer le rendez-vous',button:'Confirmer le rendez-vous',args:['confirm','ind-message']},
 {kind:'complete',method:'handleCompleteMeetup',title:'Terminer la transaction',button:'Terminer',args:['complete','ind-message']},
 {kind:'cancel',method:'handleCancelMeetup',title:'Annuler la rencontre',button:'Annuler la rencontre',args:['cancel','ind-message']},
] as const;
let native: ReturnType<typeof meetupFirestoreFixture>;
let alerts:jest.SpyInstance;
beforeEach(()=>{jest.clearAllMocks();mockIO.mockReset(); native=meetupFirestoreFixture({uid:'I',chatId:'ind-chat',messageId:'ind-message',articleId:'ind-article',amount:23});mockNativeRead.mockReset().mockImplementation(native.read);mockUid='I';mockGeneration++;mockFocus=true;(auth as unknown as{currentUser:{uid:string}}).currentUser={uid:'I'};mockIO.mockResolvedValue(undefined);alerts=jest.spyOn(Alert,'alert').mockImplementation(()=>undefined);});
afterEach(()=>jest.restoreAllMocks());
function buttons(index:number){return alerts.mock.calls[index][2] as {text:string;style?:string;onPress:()=>void|Promise<void>}[];}
it.each(dialogCases)('I-EXIT01 raw nonwrapping $kind consumer: cancellation then old callback cannot dispatch or free next dialog',async c=>{const {result}=renderHook(hook);let p1!:Promise<void>;act(()=>{p1=result.current[c.method]();});expect(alerts.mock.calls[0][0]).toBe(c.title);const old=buttons(0).find(b=>b.text===c.button)!;act(()=>buttons(0).find(b=>b.style==='cancel')!.onPress());await p1;expect(result.current.isExiting).toBe(false);let p2!:Promise<void>;act(()=>{p2=result.current[c.method]();});expect(alerts).toHaveBeenCalledTimes(2);await act(async()=>old.onPress());expect(mockIO).not.toHaveBeenCalled();expect(result.current.isExiting).toBe(true);await act(async()=>buttons(1).find(b=>b.text===c.button)!.onPress());await p2;expect(mockIO).toHaveBeenCalledTimes(1);expect(mockIO.mock.calls[0]).toEqual(c.args);expect(result.current.isExiting).toBe(false);});
it.each(dialogCases)('I-EXIT02 raw nonwrapping $kind consumer: dismiss then late old dismiss during new IO leaves current lock intact',async c=>{const {result}=renderHook(hook);let p1!:Promise<void>;act(()=>{p1=result.current[c.method]();});const dismiss=alerts.mock.calls[0][3].onDismiss as()=>void;act(()=>dismiss());await p1;let release!:()=>void;mockIO.mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));let p2!:Promise<void>;act(()=>{p2=result.current[c.method]();});const confirm=buttons(1).find(b=>b.text===c.button)!.onPress;let leaf!:void|Promise<void>;act(()=>{leaf=confirm();});await waitFor(()=>expect(mockIO).toHaveBeenCalledTimes(1));act(()=>dismiss());await act(async()=>confirm());expect(result.current.isExiting).toBe(true);expect(mockIO).toHaveBeenCalledTimes(1);expect(Haptics.notificationAsync).not.toHaveBeenCalled();await act(async()=>{release();await leaf;await p2;});expect(result.current.isExiting).toBe(false);expect(mockIO.mock.calls[0]).toEqual(c.args);});
it.each(dialogCases)('I-EXIT03 raw nonwrapping $kind consumer: current refusal releases lock and same current action then succeeds once',async c=>{mockIO.mockRejectedValueOnce(new Error('refus courant'));const {result}=renderHook(hook);let p1!:Promise<void>;act(()=>{p1=result.current[c.method]();});await act(async()=>{await buttons(0).find(b=>b.text===c.button)!.onPress();await p1;});expect(alerts.mock.calls.at(-1)![1]).toBe('refus courant');expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(result.current.isExiting).toBe(false);const nextIndex=alerts.mock.calls.length;let p2!:Promise<void>;act(()=>{p2=result.current[c.method]();});await act(async()=>{await buttons(nextIndex).find(b=>b.text===c.button)!.onPress();await p2;});expect(mockIO).toHaveBeenCalledTimes(2);expect(mockIO.mock.calls[1]).toEqual(c.args);expect(result.current.isExiting).toBe(false);});
it('I-EXIT04 raw nonwrapping consumer same UID generation changed without render keeps old opener and callback silent',async()=>{const {result,rerender}=renderHook(hook);const opener=result.current.handleConfirmMeetup;let p!:Promise<void>;act(()=>{p=opener();});const old=buttons(0).find(b=>b.text==='Confirmer le rendez-vous')!.onPress;mockGeneration++;await act(async()=>{await old();await p;});await opener();expect(mockIO).not.toHaveBeenCalled();expect(alerts).toHaveBeenCalledTimes(1);rerender({});let current!:Promise<void>;act(()=>{current=result.current.handleConfirmMeetup();});await act(async()=>{await buttons(1).find(b=>b.text==='Confirmer le rendez-vous')!.onPress();await current;});expect(mockIO).toHaveBeenCalledTimes(1);});


// Absence/contestation now require a factual form and fresh native readback,
// rather than the former prefilled Alert callbacks. Keep the same negative cases.
const reportCases = [{kind: 'noShow', method: 'handleReportNoShow'}, {kind: 'contest', method: 'handleContestNoShow'}] as const;
async function openReport(result: {current: ReturnType<typeof hook>}, item: typeof reportCases[number]) {
 if (item.kind === 'contest') native.initialByPeer();
 await act(async () => {await result.current[item.method]();});
 expect(result.current.reportSheetProps).not.toBeNull();
 return result.current.reportSheetProps!;
}
it.each(reportCases)('raw $kind form closed then reopened rejects the old submit before IO', async item => {
 mockIO.mockImplementation(async (_kind, _id, reason, details) => {native.commitStory(reason, details);});
 const {result} = renderHook(hook); const old = await openReport(result, item);
 act(() => old.onClose()); expect(result.current.reportSheetProps).toBeNull();
 const current = await openReport(result, item);
 await act(async () => {await old.onSubmit('other_party_no_show', 'Ancien récit annulé.');});
 expect(mockIO).not.toHaveBeenCalled(); expect(result.current.reportSheetProps).not.toBeNull();
 act(() => old.onClose()); expect(result.current.reportSheetProps).not.toBeNull();
 await act(async () => {await current.onSubmit('other_party_no_show', 'Récit confirmé explicitement.');});
 expect(mockIO).toHaveBeenCalledTimes(1); expect(alerts.mock.calls.at(-1)?.[0]).toBe('Récit enregistré');
});
it.each(reportCases)('raw $kind form keeps its busy lock through close and duplicate submit until native receipt', async item => {
 const {result} = renderHook(hook); const form = await openReport(result, item);
 let release!: () => void; mockIO.mockImplementationOnce((_kind, _id, reason, details) => new Promise<void>(resolve => {release = () => {native.commitStory(reason, details); resolve();};}));
 let pending!: Promise<void>; act(() => {pending = form.onSubmit('other_party_no_show', 'Récit en cours.');});
 await waitFor(() => expect(mockIO).toHaveBeenCalledTimes(1));
 act(() => form.onClose()); await act(async () => {await form.onSubmit('other_party_no_show', 'Doublon refusé.');});
 expect(result.current.reportSheetProps?.isSubmitting).toBe(true); expect(mockIO).toHaveBeenCalledTimes(1); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
 await act(async () => {release(); await pending;}); expect(result.current.reportSheetProps).toBeNull();
});
it.each(reportCases)('raw $kind current refusal retains the form and permits one explicit retry with fresh native readback', async item => {
 mockIO.mockImplementation(async (_kind, _id, reason, details) => {native.commitStory(reason, details);}); mockIO.mockRejectedValueOnce(new Error('refus courant'));
 const {result} = renderHook(hook); const form = await openReport(result, item);
 await act(async () => {await form.onSubmit('other_party_no_show', 'Récit conservé.');});
 expect(alerts.mock.calls.at(-1)?.[1]).toBe('refus courant'); expect(result.current.reportSheetProps?.isSubmitting).toBe(false); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
 await act(async () => {await result.current.reportSheetProps!.onSubmit('other_party_no_show', 'Récit conservé.');});
 expect(mockIO).toHaveBeenCalledTimes(2); expect(alerts.mock.calls.at(-1)?.[0]).toBe('Récit enregistré');
});
