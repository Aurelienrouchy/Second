import { CancelledError, isCancelledError, useQuery } from '@tanstack/react-query';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ArticlePrivacyService, articlePrivacySourceHash } from '@/services/articlePrivacyService';
import type { PrivateArticleAccess } from '@/types/articlePrivacy';

/** No stale/bearer fallback: a public reference requires its own fresh native permission. */
export function usePrivateArticleImage(access: PrivateArticleAccess | null, originalReference: string | null, privacyWithdrawalRecorded = false) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration();
  const context = useShippingPurchaseContext(JSON.stringify(['private-article-image', access, originalReference, privacyWithdrawalRecorded]), uid);
  const key = [uid, generation, access?.articleId, access?.transactionId, access?.swapId, originalReference, privacyWithdrawalRecorded, context.focusRevision];
  const readCurrent = async <T,>(signal: AbortSignal, read: (viewerId: string, assertCurrent: () => void) => Promise<T>): Promise<T> => {
    if (signal.aborted) throw new CancelledError({silent: true, revert: true});
    let operation: ReturnType<typeof context.capture>;
    // A capture refusal is itself a failed owner/focus/frame guard, before IO.
    try {operation = context.capture();} catch {throw new CancelledError({silent: true, revert: true});}
    const assertCurrent = () => {
      if (signal.aborted) throw new CancelledError({silent: true, revert: true});
      try {context.assertCurrent(operation);} catch {throw new CancelledError({silent: true, revert: true});}
    };
    try {
      const result = await read(operation.session.uid, assertCurrent);
      assertCurrent(); return result;
    } catch (error) {
      // Do not disguise a current permission, provider or malformed-proof error.
      // Only the independently checked request/source guard cancels the read.
      assertCurrent(); throw error;
    }
  };
  const evidence = useQuery({ queryKey: ['private-article-image-proof', ...key], enabled: !!uid && !!access && !!originalReference && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readCurrent(signal, async (viewerId, assertCurrent) => {
      const sourceReferenceHash = await articlePrivacySourceHash(originalReference!); assertCurrent();
      const proof = await ArticlePrivacyService.evidence(viewerId, { ...access!, sourceReferenceHashes: [sourceReferenceHash] }, assertCurrent); assertCurrent();
      return { proof, sourceReferenceHash };
    }),
  });
  const proof = evidence.isSuccess && !evidence.isFetching && context.focused && evidence.data.proof.viewerId === uid ? evidence.data : null;
  const mediaReference = proof?.proof.state === 'recorded' ? proof.proof.mediaRefs.find(media => media.sourceReferenceHash === proof.sourceReferenceHash) ?? null : null;
  const bytes = useQuery({ queryKey: ['private-article-image-bytes', ...key, mediaReference?.evidenceId, mediaReference?.mediaId, mediaReference?.generation],
    enabled: !!uid && !!access && !!mediaReference && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readCurrent(signal, (viewerId, assertCurrent) => ArticlePrivacyService.image(viewerId, access!, mediaReference!, assertCurrent)),
  });
  const privateImage = bytes.isSuccess && !bytes.isFetching && context.focused && bytes.data.viewerId === uid &&
    bytes.data.articleId === access?.articleId && bytes.data.evidenceId === mediaReference?.evidenceId && bytes.data.mediaId === mediaReference?.mediaId &&
    bytes.data.generation === mediaReference?.generation ? bytes.data.dataUrl : null;
  const publicImage = !privacyWithdrawalRecorded && proof?.proof.state === 'unrecorded' && proof.proof.publicReferenceUseAllowed &&
    proof.proof.publicReferenceHashes.includes(proof.sourceReferenceHash) ? originalReference : null;
  return { image: privateImage ?? publicImage, privateImage: !!privateImage,
    unavailable: evidence.isError && !isCancelledError(evidence.error) || bytes.isError && !isCancelledError(bytes.error) || !!proof && (proof.proof.state === 'recorded' ? !mediaReference
      : !proof.proof.publicReferenceUseAllowed || !proof.proof.publicReferenceHashes.includes(proof.sourceReferenceHash)),
    checking: evidence.isPending || evidence.isFetching || !!mediaReference && (bytes.isPending || bytes.isFetching),
    withdrawalRecorded: privacyWithdrawalRecorded || proof?.proof.state === 'recorded',
  };
}
