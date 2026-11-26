import { readScopedQuery } from '@/utils/readScopedQuery';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getSwapAgreementPreview } from '@/services/swapService';
import { staleTradeOperation } from '@/services/tradeOperation';
import { getAuthSessionGeneration } from '@/store/authStore';
import type { SwapAgreementPreview, SwapExchangePreviewInput, SwapProposalPreviewInput } from '@/types/swap';
type ObservedAgreement = Pick<SwapAgreementPreview, 'protocol' | 'scope' | 'sourceHash' | 'termsVersion' | 'termsText' | 'exchangeMode' | 'arrangements'>;
const agreementIdentity = (value: ObservedAgreement | null) => value === null ? null : JSON.stringify([value.protocol, value.scope, value.sourceHash,
  value.termsVersion, value.termsText, value.exchangeMode, value.arrangements]);

function createAgreementInteraction() {
  let value = { key: '', revision: 0, preview: null as SwapAgreementPreview | null, accepted: false };
  let observedIdentity: string | null = null;
  return {
    prepare: (key: string, observed: ObservedAgreement | null) => {
      const next = agreementIdentity(observed);
      // The first legacy acknowledgement stores exactly the source already
      // reviewed. Its own commit must not revoke that in-flight confirmation.
      const sameFirstCommit = observedIdentity === null && next !== null && value.preview !== null && agreementIdentity(value.preview) === next;
      if (value.key !== key || observedIdentity !== next && !sameFirstCommit) value = {key, revision: value.revision + 1, preview: null, accepted: false};
      observedIdentity = next;
      return value;
    },
    get: () => value,
    invalidate: (key: string) => {
      if (value.key !== key) throw staleTradeOperation();
      value = {key, revision: value.revision + 1, preview: null, accepted: false}; return value;
    },
  };
}

/** Consent belongs to one exact source, SDK session, foreground and navigation frame. */
export function useSwapAgreement(uid: string | null, sourceKey: string, observedAgreement: ObservedAgreement | null = null) {
  const client = useQueryClient();
  const context = useLabelLifecycleContext(sourceKey, uid);
  const key = JSON.stringify([sourceKey, uid, getAuthSessionGeneration(), context.focusRevision]);
  const [interaction] = useState(createAgreementInteraction);
  const readGate = useRef({key: '', token: null as symbol | null});
  const renderState = interaction.prepare(key, observedAgreement);
  const [view, setView] = useState<{ key: string; revision: number; preview: SwapAgreementPreview | null; accepted: boolean }>({ key, revision: 0, preview: null, accepted: false });
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const visible = view.key === key && view.revision === renderState.revision ? view : null;
  const invalidate = () => {
    setView({ ...interaction.invalidate(key) });
  };
  const show = (preview: SwapAgreementPreview) => {
    context.capture(); invalidate(); interaction.get().preview = preview; setView({ ...interaction.get() });
  };
  const read = async (input: SwapProposalPreviewInput | SwapExchangePreviewInput) => {
    if (readGate.current.key === key && readGate.current.token) return;
    invalidate(); const revision = interaction.get().revision; const operation = context.capture();
    const readToken = Symbol(); readGate.current.key = key; readGate.current.token = readToken;
    const readKey = JSON.stringify([key, revision]); setReadingKey(readKey);
    try {
      const preview = await client.fetchQuery({ queryKey: ['swap-agreement-preview', uid, key, revision],
        queryFn: ({signal}) => readScopedQuery(signal, () => () => {
          context.assertCurrent(operation);
          if (interaction.get().key !== key || interaction.get().revision !== revision) throw staleTradeOperation();
        }, async assertCurrent => {assertCurrent(); const result = await getSwapAgreementPreview(input); assertCurrent(); return result;}), staleTime: 0, gcTime: 0, retry: false });
      context.assertCurrent(operation);
      if (interaction.get().key !== key || interaction.get().revision !== revision) throw staleTradeOperation();
      interaction.get().preview = preview; setView({ ...interaction.get() });
    } finally {if (readGate.current.token === readToken) readGate.current.token = null; setReadingKey(value => value === readKey ? null : value);}
  };
  const toggle = () => {
    context.capture();
    if (!visible?.preview || visible.preview !== interaction.get().preview || visible.revision !== interaction.get().revision) throw staleTradeOperation();
    interaction.get().accepted = !interaction.get().accepted; setView({ ...interaction.get() });
  };
  const captureConsent = () => {
    const operation = context.capture(); const revision = interaction.get().revision; const preview = visible?.preview;
    if (!uid || !preview || !visible.accepted || !interaction.get().accepted || preview !== interaction.get().preview) throw staleTradeOperation();
    const assertCurrent = () => {
      context.assertCurrent(operation);
      if (interaction.get().key !== key || interaction.get().revision !== revision || !interaction.get().accepted || interaction.get().preview !== preview) throw staleTradeOperation();
    };
    assertCurrent();
    return { preview, assertCurrent, acknowledgement: { expectedUid: uid,
      agreementProtocol: preview.protocol, expectedSourceHash: preview.sourceHash } };
  };
  return { context, preview: visible?.preview ?? null, accepted: visible?.accepted ?? false,
    reading: readingKey === JSON.stringify([key, renderState.revision]),
    invalidate, show, read, toggle, captureConsent };
}
