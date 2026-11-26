import { LateTransportRecoveryPanel } from '@/components/LateTransportRecoveryPanel';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminLateTransportRecoveryDecision } from './AdminLateTransportRecoveryDecision';
export function AdminLateTransportRecoveryReview({ uid, transactionId, incidentId, assertSelection }: {
    uid: string;
    transactionId: string;
    incidentId: string;
    assertSelection?: () => void;
}) {
    return <LateTransportRecoveryPanel uid={uid} transactionId={transactionId} incidentId={incidentId} scope="admin" assertSelection={assertSelection} renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="commercial" parcel/>} renderDecision={props => <AdminLateTransportRecoveryDecision {...props}/>}/>;
}
