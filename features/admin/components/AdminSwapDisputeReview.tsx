import {SwapDisputeReviewPanel} from '@/components/SwapDisputeReviewPanel';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
export function AdminSwapDisputeReview({uid}:{uid:string}){return <SwapDisputeReviewPanel uid={uid} ReauthenticationComponent={AdminFinancialReauthentication}/>;}
