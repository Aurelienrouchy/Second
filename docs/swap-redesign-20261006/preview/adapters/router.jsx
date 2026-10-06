import React from 'react';
import {record,theirs,scenario} from '../fixtures.mjs';
export const router={push:data=>record('push',data),replace:data=>record('replace',data),back:()=>record('back'),canGoBack:()=>true};
export function useLocalSearchParams(){return {id:'preview-swap',partyId:'generalist',receiverId:'preview-other',receiverName:'Lou Martin',receiverItems:JSON.stringify(theirs.slice(0,1)),source:scenario==='detail'?'my_swaps':'home'};}
export const Stack=Object.assign(()=>null,{Screen:()=>null});
export function Redirect({href}){router.replace(href);return null;}
export function useFocusEffect(fn){React.useEffect(()=>fn(),[fn]);}
