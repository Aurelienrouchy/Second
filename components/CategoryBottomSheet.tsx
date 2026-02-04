import { useCategoryNavigation } from '@/hooks/useCategoryNavigation';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CategoryBottomSheetProps {
  onSelect: (categoryIds: string[]) => void;
  selectedCategoryIds?: string[];
}

export interface CategoryBottomSheetRef {
  show: () => void;
  hide: () => void;
}

const CategoryBottomSheet = forwardRef<CategoryBottomSheetRef, CategoryBottomSheetProps>(
  ({ onSelect, selectedCategoryIds }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['80%'], []);

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

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        topInset={insets.top}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.headerButton}>
            <Text style={styles.backButtonText}>
              {categoryNav.isAtRoot ? '✕' : '←'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.title}>
            {categoryNav.isAtRoot ? 'Catégorie' : categoryNav.currentTitle}
          </Text>

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
          {categoryNav.currentList.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.categoryItem}
              onPress={() => categoryNav.selectCategory(item)}
            >
              <View style={styles.itemContent}>
                <Text style={styles.categoryItemText}>{item.label}</Text>
              </View>

              {item.children && item.children.length > 0 && (
                <Text style={styles.categoryArrow}>›</Text>
              )}
            </TouchableOpacity>
          ))}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#FFFFFF',
  },
  headerButton: {
    minWidth: 40,
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 20,
    color: '#333',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  selectButtonText: {
    fontSize: 16,
    color: '#F79F24',
    fontWeight: '600',
  },
  scrollViewContent: {
    paddingBottom: 20,
  },
  categoryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#FFFFFF',
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryItemText: {
    fontSize: 16,
    color: '#333',
  },
  categoryArrow: {
    fontSize: 18,
    color: '#ccc',
  },
});

export default CategoryBottomSheet;
