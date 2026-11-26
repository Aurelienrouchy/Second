import type { RelationshipReauthentication, RelationshipReauthenticationProps } from '@/types/accountRelationshipReview';

export function AccountRelationshipReauthentication({render, ...props}: RelationshipReauthenticationProps & {render?: RelationshipReauthentication}) {
  return render?.(props) ?? null;
}
