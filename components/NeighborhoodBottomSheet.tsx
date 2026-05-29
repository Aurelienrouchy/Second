import BottomSheet, { BottomSheetBackdrop, BottomSheetSectionList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NEIGHBORHOODS_BY_BOROUGH, searchNeighborhoods } from '@/data/neighborhoods';
import { MeetupNeighborhood } from '@/types';
import { colors } from '@/constants/theme';

interface NeighborhoodBottomSheetProps {
  selectedNeighborhood?: MeetupNeighborhood | null;
  selectedNeighborhoods?: MeetupNeighborhood[];
  onSelect: (neighborhood: MeetupNeighborhood) => void;
  multiSelect?: boolean;
}

export interface NeighborhoodBottomSheetRef {
  show: () => void;
  hide: () => void;
}

interface SectionData {
  title: string;
  data: MeetupNeighborhood[];
}

const NeighborhoodBottomSheet = forwardRef<NeighborhoodBottomSheetRef, NeighborhoodBottomSheetProps>(
  ({ selectedNeighborhood, selectedNeighborhoods = [], onSelect, multiSelect = false }, ref) => {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['75%', '90%'], []);
    const bottomSheetRef = React.useRef<BottomSheet>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useImperativeHandle(ref, () => ({
      show: () => {
        setSearchQuery('');
        bottomSheetRef.current?.expand();
      },
      hide: () => bottomSheetRef.current?.close(),
    }));

    const handleSelect = useCallback((neighborhood: MeetupNeighborhood) => {
      onSelect(neighborhood);
      if (!multiSelect) {
        bottomSheetRef.current?.close();
      }
    }, [onSelect, multiSelect]);

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      []
    );

    // Build sections from neighborhoods grouped by borough
    const sections = useMemo((): SectionData[] => {
      if (searchQuery.trim()) {
        const results = searchNeighborhoods(searchQuery);
        if (results.length === 0) return [];
        return [{
          title: 'Résultats de recherche',
          data: results,
        }];
      }

      return Object.entries(NEIGHBORHOODS_BY_BOROUGH).map(([borough, neighborhoods]) => ({
        title: borough,
        data: neighborhoods,
      }));
    }, [searchQuery]);

    const renderSectionHeader = useCallback(({ section }: { section: SectionData }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
      </View>
    ), []);

    const renderItem = useCallback(({ item }: { item: MeetupNeighborhood }) => {
      const isSelected = multiSelect
        ? selectedNeighborhoods.some((n) => n.id === item.id)
        : selectedNeighborhood?.id === item.id;

      return (
        <Pressable
          style={[styles.neighborhoodItem, isSelected && styles.selectedItem]}
          onPress={() => handleSelect(item)}
        >
          <View style={styles.itemContent}>
            <Text style={[styles.neighborhoodName, isSelected && styles.selectedText]}>
              {item.name}
            </Text>
            <Text style={styles.neighborhoodBorough}>{item.borough}</Text>
          </View>
          {isSelected && (
            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          )}
        </Pressable>
      );
    }, [selectedNeighborhood, selectedNeighborhoods, multiSelect, handleSelect]);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        topInset={insets.top}
        enableDynamicSizing={false}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Zone de meetup</Text>
            <Pressable onPress={() => bottomSheetRef.current?.close()}>
              <Ionicons name="close" size={24} color="#666" />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Sélectionnez le quartier où vous pouvez rencontrer l'acheteur
          </Text>

          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher un quartier..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor={colors.muted}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {sections.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={48} color="#C7C7CC" />
              <Text style={styles.emptyText}>Aucun quartier trouvé</Text>
            </View>
          ) : (
            <BottomSheetSectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              renderSectionHeader={renderSectionHeader}
              stickySectionHeadersEnabled
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.foreground,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.foreground,
  },
  list: {
    flex: 1,
  },
  listContent: {
    // paddingBottom appliqué inline (inset fiable + marge) — voir contentContainerStyle.
  },
  sectionHeader: {
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  neighborhoodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  selectedItem: {
    backgroundColor: '#FFF8F0',
  },
  itemContent: {
    flex: 1,
  },
  neighborhoodName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.foreground,
    marginBottom: 2,
  },
  neighborhoodBorough: {
    fontSize: 13,
    color: colors.muted,
  },
  selectedText: {
    color: colors.primary,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  emptyText: {
    fontSize: 16,
    color: colors.muted,
    marginTop: 12,
  },
});

export default NeighborhoodBottomSheet;
