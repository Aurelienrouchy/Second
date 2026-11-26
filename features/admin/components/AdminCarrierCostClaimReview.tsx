import {CarrierCostClaimPanel} from '@/components/CarrierCostClaimPanel';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
export function AdminCarrierCostClaimReview({uid,transactionId,sourceKey,assertSelection}:{uid:string;transactionId:string;sourceKey:string;assertSelection?:()=>void}){return <CarrierCostClaimPanel uid={uid} transactionId={transactionId} sourceKey={sourceKey} assertSelection={assertSelection} scope="admin" ReauthenticationComponent={AdminFinancialReauthentication}/>;}
