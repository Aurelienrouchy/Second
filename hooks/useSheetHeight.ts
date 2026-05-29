/**
 * useSheetHeight — borne explicitement la hauteur d'un sheet @expo/ui au détent.
 *
 * Le host natif @expo/ui (mode snapPoints + enableDynamicSizing={false}) propose
 * une hauteur INFINIE à l'arbre RN/Yoga (RNHostView matchContents=false →
 * `.frame(maxHeight: .infinity)`). Le `flex:1` du wrapper interne se résout donc
 * contre l'infini, jamais contre le détent : la colonne prend la hauteur du
 * contenu, le ScrollView ne scrolle pas et le footer passe sous la ligne de clip.
 *
 * On reconstitue donc côté JS la hauteur réelle du détent et on la passe en
 * `height` fixe au conteneur racine du sheet. Une fois la colonne bornée, les
 * `flex:1` internes (ScrollView/FlatList) redeviennent corrects : ils prennent
 * l'espace restant, scrollent nativement et atteignent le bas, le footer (dernier
 * enfant flex) reste visible.
 *
 * Accepte :
 *  - un pourcentage en string ('85%') → fraction de la hauteur d'écran.
 *  - une valeur pixel (number) → utilisée telle quelle (ex: SCREEN_HEIGHT - insets.top - 50).
 */

import { useWindowDimensions } from 'react-native';

export function useSheetHeight(snap: string | number): number {
  const { height } = useWindowDimensions();

  if (typeof snap === 'number') {
    return snap;
  }

  const fraction = parseFloat(snap) / 100;
  if (Number.isNaN(fraction) || fraction <= 0) {
    return height;
  }
  return height * fraction;
}
