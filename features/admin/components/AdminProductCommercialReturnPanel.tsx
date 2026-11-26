import { ProductCommercialReturnPanel, type ProductCommercialReauthenticationProps } from '@/components/ProductCommercialReturnPanel';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
const reauthenticate = (props: ProductCommercialReauthenticationProps) => <AdminFinancialReauthentication {...props} purpose="commercial" />;
export function AdminProductCommercialReturnPanel({uid, transactionId, nativeAdmission, onRecorded}: {uid: string; transactionId: string; nativeAdmission: ProductPhysicalDocumentaryAdmission | null; onRecorded?: () => void}) {
  return <ProductCommercialReturnPanel uid={uid} transactionId={transactionId} scope="admin" nativeAdmission={nativeAdmission} renderReauthentication={reauthenticate} onRecorded={onRecorded} />;
}
