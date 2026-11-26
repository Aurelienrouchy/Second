interface AccountAccessAdminRecord {
  protocol: 'account_access_intake_v1'; reference: string; requestId: string; payloadHash: string; recordedAt: string;
  contactVerified: false; identityVerified: false; recoveryGranted: false;
}
export type AccountAccessAdminItem = AccountAccessAdminRecord & (
  | {state: 'received'; command: {replyEmail: string; narrative: string}}
  | {state: 'neutralized'; command: null}
);
export interface AccountAccessAdminList {
  protocol: 'account_access_intake_v1'; scope: 'admin'; items: AccountAccessAdminItem[];
  hasMore: boolean; cursor: string | null; accountSearchPerformed: false; recoveryGranted: false;
}
export interface AccountAccessAdminDetail {
  protocol: 'account_access_intake_v1'; scope: 'admin'; item: AccountAccessAdminItem;
  accountSearchPerformed: false; recoveryGranted: false;
}
