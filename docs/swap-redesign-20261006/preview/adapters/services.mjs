import {read,party,stock,articles,inventory,swap,swaps,record,state} from '../fixtures.mjs';
export const GENERALIST_ZONE_ID='generalist';
export const functions={};export const storage={};
export const getSwapParty=()=>read(party);
export const getPartyItemsExtended=()=>read(stock);
export const getRecentPartyItems=()=>read(stock);
export const getUserSwaps=()=>read(swaps);
export const getSwapItems=(s,side)=>s[`${side}Items`] || [s[`${side}Item`]].filter(Boolean);
export function subscribeToSwap(id,callback){if(state==='loading')return()=>{};const timeout=setTimeout(()=>callback(state==='missing'?null:swap),50);return()=>clearTimeout(timeout);}
const mutate=async(...args)=>{record('mutation',args);await new Promise(resolve=>setTimeout(resolve,300));return {swapId:'preview-created',chatId:'preview-chat',success:true};};
export const proposeSwap=async(...args)=>{await mutate(...args);return 'preview-created';};
export const acceptSwap=mutate,declineSwap=mutate,cancelSwap=mutate,setExchangeMode=mutate,uploadSwapPhotos=mutate,confirmShipping=mutate,confirmReception=mutate,rateSwap=mutate,openSwapDispute=mutate,addItemToParty=mutate,removeItemFromParty=mutate;
export const createSwapTopUpCheckout=async()=>{throw new Error('Aucun paiement autorisé dans l’aperçu');};
export const ArticlesService={getUserArticles:id=>state==='inventory-loading'?new Promise(()=>{}):state==='inventory-error'?Promise.reject(new Error('Inventaire indisponible simulé')):read(state==='no-inventory'?[]:inventory.filter(a=>a.sellerId===id)),getArticleById:id=>read(articles.find(a=>a.id===id))};
export const ModerationService={areUsersBlocked:async()=>false,isBlocked:async()=>false,hasBlockedUser:async()=>false,isUserBlocked:async()=>false};
export const ChatService={createOrGetChat:async()=>({id:'preview-chat'}),getOrCreateChat:async()=>({id:'preview-chat'}),createChat:async()=>({id:'preview-chat'})};
export const track=()=>{};
export const privateMediaUrl=()=>{throw new Error('Aucun média distant dans l’aperçu');};export const PRIVATE_IMAGE_UPLOAD_METADATA={};
export const prepareImageForUpload=async()=>{throw new Error('Aucun téléversement dans l’aperçu');};
