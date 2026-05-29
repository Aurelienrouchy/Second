/**
 * useSheetHeight — fournit le style de bornage du conteneur racine d'un sheet
 * @expo/ui, de façon PLATFORM-AWARE. Retourne un `ViewStyle` (pas un number).
 *
 * iOS — `{ height: <hauteur calculée> }`
 *   Le host natif @expo/ui (mode snapPoints + enableDynamicSizing={false}) propose
 *   une hauteur INFINIE à l'arbre RN/Yoga (RNHostView matchContents=false →
 *   `.frame(maxHeight: .infinity)`). Le `flex:1` du wrapper interne se résout donc
 *   contre l'infini, jamais contre le détent : la colonne prend la hauteur du
 *   contenu, le ScrollView ne scrolle pas et le footer passe sous la ligne de clip.
 *   On reconstitue donc côté JS la hauteur réelle du détent et on la passe en
 *   `height` fixe au conteneur racine. Une fois la colonne bornée, les `flex:1`
 *   internes (ScrollView/FlatList) redeviennent corrects : ils prennent l'espace
 *   restant, scrollent nativement et atteignent le bas, le footer (dernier enfant
 *   flex) reste visible.
 *
 * Android — `{ flex: 1 }`
 *   Le `ModalBottomSheet` Material3 BORNE déjà la detente côté natif : le conteneur
 *   reçoit une contrainte de hauteur finie. Forcer un `height = screenH * snap%`
 *   ferait alors prendre TOUTE la hauteur au sheet (la detente native + le height
 *   forcé se cumulent mal). On laisse donc la detente native piloter la hauteur et
 *   on demande simplement au conteneur de remplir l'espace borné avec `flex:1`.
 *
 * Accepte :
 *  - un pourcentage en string ('85%') → fraction de la hauteur d'écran (iOS).
 *  - une valeur pixel (number) → utilisée telle quelle (ex: SCREEN_HEIGHT - insets.top - 50) (iOS).
 */

import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

export function useSheetHeight(snap: string | number): ViewStyle {
  const { height } = useWindowDimensions();

  // Android : la detente Material3 borne déjà — ne PAS forcer de height.
  if (Platform.OS === 'android') {
    return { flex: 1 };
  }

  // iOS : reconstituer la hauteur du détent et la borner explicitement.
  if (typeof snap === 'number') {
    return { height: snap };
  }

  const fraction = parseFloat(snap) / 100;
  if (Number.isNaN(fraction) || fraction <= 0) {
    return { height };
  }
  return { height: height * fraction };
}
