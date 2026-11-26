import {TransportContactPanel} from '@/components/TransportContactPanel';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
export function AdminTransportContactReview({uid,transactionId,sourceKey,assertSelection}:{uid:string;transactionId:string;sourceKey:string;assertSelection?:()=>void}){
  return <TransportContactPanel uid={uid} transactionId={transactionId} sourceKey={sourceKey} assertSelection={assertSelection} scope="admin" ReauthenticationComponent={AdminFinancialReauthentication}/>;
}
