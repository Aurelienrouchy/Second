import {LabelDepositDeadlinePanel} from '@/components/LabelDepositDeadlinePanel';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
import {AdminTransportReviewDecision} from './AdminTransportReviewDecision';
import {AdminPurchaseRefundEntry} from './AdminPurchaseRefundEntry';
export function AdminLabelDepositDeadlineReview({uid, transactionId}: {uid: string; transactionId: string}) {
  return <LabelDepositDeadlinePanel uid={uid} transactionId={transactionId} sourceKey={transactionId} scope="admin"
    ReauthenticationComponent={AdminFinancialReauthentication}
    AgreementComponent={AdminPurchaseRefundEntry}
    OperatorComponent={AdminTransportReviewDecision} />;
}
