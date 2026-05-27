import { useCategoryNavigation } from '@/hooks/useCategoryNavigation';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';

interface CategoryBottomSheetProps {
  onSelect: (categoryIds: string[]) => void;
  selectedCategoryIds?: string[];
  suggestedCategoryId?: string;
}

export interface CategoryBottomSheetRef {
  show: () => void;
  hide: () => void;
}

const CategoryBottomSheet = forwardRef<CategoryBottomSheetRef, CategoryBottomSheetProps>(
  ({ onSelect, selectedCategoryIds, suggestedCategoryId }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['85%'], []);

    // Use shared category navigation hook
    const categoryNav = useCategoryNavigation({
      onSelect: (categoryIds) => {
        onSelect(categoryIds);
        bottomSheetRef.current?.close();
        categoryNav.goToRoot();
      },
    });

    useImperativeHandle(ref, () => ({
      show: () => {
        categoryNav.goToRoot();
        bottomSheetRef.current?.expand();
      },
      hide: () => bottomSheetRef.current?.close(),
    }));

    const handleBack = () => {
      if (categoryNav.isAtRoot) {
        bottomSheetRef.current?.close();
      } else {
        categoryNav.goBack();
      }
    };

    const handleSelectCurrent = () => {
      if (!categoryNav.isAtRoot) {
        categoryNav.selectCurrent();
        bottomSheetRef.current?.close();
        categoryNav.goToRoot();
      }
    };

    const renderBackdrop = useCallback(
      (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
      []
    );

    // Build breadcrumb from navigation path
    const breadcrumb = categoryNav.navigationPath?.length > 0
      ? categoryNav.navigationPath.map((p: any) => p.label || p.name).join(' > ')
      : null;

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        enableDynamicSizing={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
            <Ionicons
              name={categoryNav.isAtRoot ? 'close' : 'chevron-back'}
              size={22}
              color={colors.charcoal}
            />
          </TouchableOpacity>

          <View style={styles.titleContainer}>
            <Text style={styles.title}>
              {categoryNav.isAtRoot ? 'Catégorie' : categoryNav.currentTitle}
            </Text>
            {breadcrumb && !categoryNav.isAtRoot && (
              <Text style={styles.breadcrumb} numberOfLines={1}>
                {breadcrumb}
              </Text>
            )}
          </View>

          <View style={styles.headerButton}>
            {!categoryNav.isAtRoot && (
              <TouchableOpacity onPress={handleSelectCurrent}>
                <Text style={styles.selectButtonText}>Choisir</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <BottomSheetScrollView
          contentContainerStyle={styles.scrollViewContent}
          showsVerticalScrollIndicator={false}
        >
          {categoryNav.currentList.map((item: any) => {
            const isSuggested = suggestedCategoryId && item.id === suggestedCategoryId;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.categoryItem}
                onPress={() => categoryNav.selectCategory(item)}
              >
                <View style={styles.itemContent}>
                  <Text style={styles.categoryItemText}>{item.label}</Text>
                  {isSuggested && (
                    <View style={styles.suggestedBadge}>
                      <Text style={styles.suggestedBadgeText}>Suggéré</Text>
                    </View>
                  )}
                </View>

                {item.children && item.children.length > 0 && (
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                )}
              </TouchableOpacity>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
  },
  handleIndicator: {
    backgroundColor: colors.borderStrong,
    width: 40,
    height: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerButton: {
    minWidth: 40,
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    color: colors.charcoal,
  },
  breadcrumb: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    letterSpacing: 0.66,
  },
  selectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.rust,
    textAlign: 'right',
  },
  scrollViewContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  categoryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryItemText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  suggestedBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  suggestedBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
});

export default CategoryBottomSheet;
