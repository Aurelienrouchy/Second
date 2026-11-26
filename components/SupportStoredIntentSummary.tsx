import {Text,StyleSheet} from 'react-native';
import type {SupportJournalEntry} from '@/types/supportRequest';
import {colors,typography} from '@/constants/theme';
/** The local command remains exact; its potentially sensitive prose is not repeated in the journal UI. */
export function SupportStoredIntentSummary({attempt}:{attempt:SupportJournalEntry}){return <Text selectable style={styles.caption}>Intention privée {attempt.requestId}. {attempt.version===2?'Le journal contient une référence opaque protégée ; aucun corps n’y est conservé. Le dépôt ou l’exécution du récit reste à qualifier par son propre reçu.':'Son texte et ses renseignements ne sont pas réaffichés ici.'} La référence conserve le lien avec le reçu exact ; une lecture inconnue ne prouve ni dépôt ni confinement.</Text>;}
const styles=StyleSheet.create({caption:{...typography.caption,color:colors.muted}});
