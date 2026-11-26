import {Pressable, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Input, Text} from '@/components/ui';
import {colors, spacing, sizing, typography} from '@/constants/theme';
import type {SwapExchangeMode} from '@/types/swap';
interface Props {mode: SwapExchangeMode | null; arrangements: string; disabled?: boolean; fixedMode?: boolean; onMode: (mode: SwapExchangeMode) => void; onArrangements: (text: string) => void}
export function SwapArrangementFields({mode, arrangements, disabled, fixedMode, onMode, onArrangements}: Props) {
 return <View style={styles.section}><Text style={styles.title}>Organiser l’échange</Text>
  {(['hand_delivery', 'shipping'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: mode === value, disabled: !!disabled || !!fixedMode}} disabled={disabled || fixedMode} onPress={() => onMode(value)} style={({pressed}) => [styles.choice, pressed && styles.pressed]}>
    <Ionicons name={mode === value ? 'checkbox' : 'square-outline'} size={sizing.iconMD} color={mode === value ? colors.primary : colors.foregroundSecondary}/>
    <View style={styles.choiceText}><Text style={styles.label}>{value === 'hand_delivery' ? 'Remise en main propre' : 'Envoi postal'}</Text>
    <Text style={styles.body}>{value === 'shipping' ? 'Envoi et frais à organiser entre vous.' : 'Convenez du lieu et du moment ensemble.'}</Text></View>
  </Pressable>)}
  {mode ? <Input label={mode === 'shipping' ? 'Envoi et frais convenus' : 'Lieu et moment convenus'} value={arrangements} onChangeText={onArrangements} maxLength={2000} multiline disabled={disabled}/> : null}
 </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.md}, title: {...typography.h3, color: colors.foreground}, choice: {flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, minHeight: sizing.minTouchTarget, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border}, choiceText: {flex: 1, gap: spacing.xs}, label: {...typography.label, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foregroundSecondary}, pressed: {opacity: 0.7}});
