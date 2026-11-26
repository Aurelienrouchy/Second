import {ReturnDepositDeadlinePanel} from '@/components/ReturnDepositDeadlinePanel';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';

export function AdminReturnDepositDeadlinePanel({uid, transactionId, sourceKey, assertSelection, onRecorded}: {
  uid: string; transactionId: string; sourceKey: string; assertSelection?: () => void; onRecorded?: () => void;
}) {
  return <ReturnDepositDeadlinePanel uid={uid} transactionId={transactionId} scope="operator" sourceKey={sourceKey}
    assertSelection={assertSelection} onRecorded={onRecorded} ReauthenticationComponent={AdminFinancialReauthentication}/>;
}
