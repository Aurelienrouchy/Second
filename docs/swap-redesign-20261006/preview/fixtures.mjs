const params = new URLSearchParams(location.search);
export const scenario = params.get('screen') || 'home';
export const state = params.get('state') || 'loaded';
export const guest = state === 'guest';
export const currentUser = guest ? null : {id:'preview-me', name:'Camille', displayName:'Camille', firstName:'Camille'};
export const activity = [];
export function record(type, data) {activity.push({type, data}); window.__swapPreviewActivity = activity;}
const image = (garment) => `/garments/${garment}.svg`;
const size = {value:'M', system:'letter', category:'clothing'};
export const own = [{articleId:'mine-1',title:'Chemise en lin',price:35,imageUrl:image('shirt'),brand:'Maison Lune',size},{articleId:'mine-2',title:'Sac en toile',price:20,imageUrl:image('bag'),size}];
export const theirs = [{articleId:'their-1',title:'Veste en denim',price:45,imageUrl:image('jacket'),brand:'Atelier Bleu',size},{articleId:'their-2',title:'Pull en laine',price:30,imageUrl:image('sweater'),brand:'Maison Lune',size}];
export const articles = [...own,...theirs].map(item=>({...item,id:item.articleId,sellerId:item.articleId.startsWith('mine')?'preview-me':'preview-other',images:[{url:item.imageUrl}],isActive:true,isSold:false}));
export const inventory = [...articles,{...articles[0],id:'mine-3',title:'Chemise rayée',price:25}];
export const stock = state === 'empty' ? [] : articles.map((a,i)=>({...a,id:`stock-${a.id}`,articleId:a.id,partyId:'generalist',sellerName:a.sellerId === 'preview-me'?'Camille':'Lou Martin',price:a.price,imageUrl:a.images[0].url,isSwapped:false,condition:'très bon état',addedAt:new Date('2026-10-05T12:00:00Z')}));
export const party = {id:'generalist',name:'Swap Zone',itemsCount:stock.length,isGeneralist:true};
export const swap = {id:'preview-swap',initiatorId:'preview-me',initiatorName:'Camille',receiverId:'preview-other',receiverName:'Lou Martin',initiatorItems:own,receiverItems:theirs,initiatorTotalValue:55,receiverTotalValue:75,status:params.get('status') || 'proposed',message:'Bonjour, votre veste me plaît beaucoup. Ces deux articles vous intéresseraient-ils ?',createdAt:new Date('2026-10-04T12:00:00Z'),updatedAt:new Date('2026-10-05T12:00:00Z'),chatId:'preview-chat',exchangeMode:params.get('mode') || undefined};
if(params.get('role')==='receiver') {currentUser && (currentUser.id='preview-other');}
if(params.get('confirmed')==='yes') {swap.initiatorReceivedAt=new Date();swap.receiverShippedAt=new Date();swap.initiatorShippedAt=new Date();}
if(params.get('legacy')==='yes') swap.cashTopUp={amount:500,payerId:'preview-other'};
export const swaps = state === 'empty' ? [] : [swap,{...swap,id:'preview-accepted',status:'accepted',receiverName:'Alex Bernard'},{...swap,id:'preview-completed',status:'completed',receiverName:'Noa Dubois'}];
export async function read(value) {if(state==='loading') return new Promise(()=>{});if(state==='error') throw new Error('Indisponibilité simulée');return value;}
window.__swapPreviewActivity=activity;
