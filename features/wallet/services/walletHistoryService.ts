import { randomUUID } from 'expo-crypto';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { getWalletHistoryPage, validWalletHistoryPeriod } from '@/services/walletHistoryReader';
import type { WalletHistoryPeriod, WalletHistorySource } from '@/types/walletHistory';

export { getWalletHistoryPage, parseWalletHistoryPage, validWalletHistoryPeriod } from '@/services/walletHistoryReader';

const invalid = () => new Error('Cette page d’historique ne peut pas être qualifiée. Aucun export ne sera partagé.');

/** Stream every page of both sources to a temporary JSON; share only after both cursor chains end. */
export async function exportWalletHistory(expectedUid: string, period: WalletHistoryPeriod, assertContext: () => void,
  progress: (source: WalletHistorySource, pages: number, entries: number) => void): Promise<void> {
  const session = captureTradeSession(expectedUid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent(); if (!validWalletHistoryPeriod(period)) throw invalid();
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]); assertCurrent();
  const available = await Sharing.isAvailableAsync(); assertCurrent();
  if (!available) throw new Error('Le partage de fichiers n’est pas disponible sur cet appareil.');
  const file = new File(Paths.cache, `seconde-historique-${randomUUID()}.json`);
  try {
    assertCurrent(); file.create(); assertCurrent();
    const metadata = { protocol: 'wallet_history_export_v1', ownerId: session.uid, period, periodBoundary: '[fromMs,toMs)', startedAt: new Date().toISOString(),
      nature: 'Historique interne Seconde, compilation de lectures pouvant évoluer', accountingSnapshot: false, taxAttestation: false,
      bankArrivalProof: false, totalsProvided: false, sourcesMayDescribeSameMovement: true, undatedEntriesBelongToPeriod: false };
    file.write(JSON.stringify(metadata).slice(0, -1) + ',"sources":{'); assertCurrent();
    for (const [sourceIndex, source] of (['ledger', 'withdrawals'] as const).entries()) {
      assertCurrent(); file.write(`${sourceIndex ? ',' : ''}${JSON.stringify(source)}:{"pages":[`, { append: true });
      let cursor: string | null = null, pages = 0, entries = 0; const visited = new Set<string>();
      do {
        assertCurrent();
        const page = await getWalletHistoryPage(session.uid, { source, period, cursor, pageSize: 50 }, assertCurrent); assertCurrent();
        if (page.cursor !== null && visited.has(page.cursor)) throw invalid();
        if (page.cursor) visited.add(page.cursor);
        file.write(`${pages ? ',' : ''}${JSON.stringify(page)}`, { append: true }); assertCurrent();
        pages++; entries += page.entries.length; progress(source, pages, entries); assertCurrent();
        cursor = page.cursor;
      } while (cursor !== null);
      file.write(`],"traversalEnded":true,"pageCount":${pages},"entryCount":${entries}}`, { append: true }); assertCurrent();
    }
    file.write(`},"traversalEndedForBothSources":true,"finishedAt":${JSON.stringify(new Date().toISOString())}}`, { append: true }); assertCurrent();
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Historique financier interne Seconde' });
    assertCurrent();
  } finally {
    // Partial output and copies in this app's cache never outlive the operation.
    if (file.exists) file.delete();
  }
}
