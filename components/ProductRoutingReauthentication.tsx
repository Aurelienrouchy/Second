import type { ReactNode } from 'react';
export interface RoutingReauthenticationProps {uid:string;sourceKey:string;disabled:boolean;onVerified:()=>void;parcel?:boolean}
export type RoutingReauthentication=(props:RoutingReauthenticationProps)=>ReactNode;
/** Keep the verification callback an event prop, never a render-time guard. */
export function ProductRoutingReauthentication({render,...props}:RoutingReauthenticationProps&{render?:RoutingReauthentication}){
  return render?.(props)??null;
}
