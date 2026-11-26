import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {SellerTaxJournal, sellerTaxTerminal} from '@/services/sellerTaxJournal';
import {SELLER_TAX_ACTION_LABELS} from '@/components/SellerTaxDocumentCard';
import {colors, radius, spacing, typography} from '@/constants/theme';

export function SellerTaxCommandJournal({uid}: {uid: string}) {
  const context = useLabelLifecycleContext(`seller-tax-journal:${uid}`, uid), client = useQueryClient();
  const [work, setWork] = useState({frame: context.frame, focus: context.focusRevision, busy: false, message: ''});
  const currentWork = work.frame === context.frame && work.focus === context.focusRevision, busy = currentWork && work.busy;
  const key = ['seller-tax-local-command', uid, getAuthSessionGeneration(), context.focusRevision];
  const query = useQuery({queryKey: key, enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), guard = () => context.assertCurrent(op);
      const attempt = await SellerTaxJournal.read(uid, guard);
      if (!attempt) return {attempt: null, response: null};
      const response = await SellerTaxJournal.observe(attempt, guard); guard(); return {attempt, response};
    }});
  const ready = context.focused && query.isSuccess && !query.isFetching && !query.isError, data = ready ? query.data : null;
  const perform = async (action: 'observe' | 'resume' | 'neutralize' | 'acknowledge') => {
    if (busy || !context.focused) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    setWork({frame: context.frame, focus: context.focusRevision, busy: true, message: ''});
    const guard = () => context.assertCurrent(op);
    try {
      const attempt = await SellerTaxJournal.read(uid, guard);
      if (!attempt) {await query.refetch(); return;}
      await SellerTaxJournal[action](attempt, guard); guard();
      await query.refetch(); guard();
      if (action === 'acknowledge') await Promise.all([client.invalidateQueries({queryKey: ['seller-tax-dossier', uid]}),
        client.invalidateQueries({queryKey: ['seller-tax-journal-slot', uid]}), client.invalidateQueries({queryKey: ['seller-tax-page', uid]})]);
      guard(); setWork({frame: context.frame, focus: context.focusRevision, busy: true, message: action === 'acknowledge'
        ? 'Le reçu terminal exact a été relu avant de retirer cette intention locale.' : 'La commande exacte a été observée. Son état ne certifie aucun fait fiscal ni dépôt officiel.'});
    } catch {if (context.isCurrent(op)) {setWork({frame: context.frame, focus: context.focusRevision, busy: true,
      message: 'Le reçu ou les droits actuels ne peuvent pas être confirmés. La même intention reste conservée.'}); await query.refetch();}}
    finally {if (context.isCurrent(op)) setWork(previous => ({...previous, busy: false})); context.finish(op);}
  };
  return <View style={styles.card}>
    <Text style={styles.title}>Suivi de ma dernière commande fiscale</Text>
    {!context.focused ? <Text style={styles.body}>La session et la page doivent être actives pour relire ce suivi.</Text> : query.isError
      ? <Text style={styles.body}>Le journal ou son reçu ne peut pas être relu. Les données antérieures sont masquées et aucune intention n’est effacée.</Text>
      : !ready ? <Text style={styles.body}>Relecture du journal et du reçu natif…</Text>
        : !data?.attempt ? <Text style={styles.caption}>Aucune intention locale dans ce journal. Cela ne prouve pas l’absence de dossiers fiscaux.</Text> : <>
          <Text style={styles.body}>Année {data.attempt.scope.year} · {data.attempt.scope.subject === 'operator' ? 'dossier de l’exploitant' : 'dossier privé'} · {SELLER_TAX_ACTION_LABELS[data.attempt.command.action]}.</Text>
          <Text selectable style={styles.caption}>Commande : {data.attempt.requestId}</Text>
          <Text style={styles.body}>{data.response?.commandReceipt?.status === 'completed' ? 'Acte documentaire enregistré.'
            : data.response?.commandReceipt?.status === 'not_executed' ? 'Non-exécution qualifiée par le reçu natif.'
              : data.response?.commandReceipt ? 'Commande en attente ou de résultat inconnu.' : 'Aucun reçu de cette commande visible ; cela ne clôt pas l’intention.'}</Text>
          {data.response?.caseView.opaque ? <Text style={styles.caption}>Seul votre reçu est accessible avec les droits actuels. Le dossier privé et ses pages sont masqués.</Text> : null}
          {data.response && !sellerTaxTerminal(data.response) ? <>
            {!data.response.caseView.opaque ? <Button variant="secondary" disabled={busy} onPress={() => {void perform('resume');}}>Reprendre cette même commande fiscale</Button> : null}
            <Button variant="secondary" disabled={busy} onPress={() => {void perform('neutralize');}}>Neutraliser cette commande documentaire exacte</Button>
          </> : data.response ? <Button variant="secondary" disabled={busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu terminal et terminer ce suivi local</Button> : null}
        </>}
    {currentWork && work.message && context.focused ? <Text style={styles.caption}>{work.message}</Text> : null}
    <Button variant="ghost" disabled={busy || !context.focused || query.isFetching} onPress={() => {void perform('observe');}}>Relire ma commande fiscale exacte</Button>
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
