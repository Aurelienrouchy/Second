import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import FormFieldGroup from '@/components/sell/FormFieldGroup';
import ConfidenceDots from '@/components/sell/ConfidenceDots';
import { AiBadge } from '../shared/AiBadge';
import { AIAnalysisResult, CONDITION_DISPLAY } from '@/types/ai';
import { colors, fonts } from '@/constants/theme';
import { getColorName } from '@/data/colors';
import { getMaterialName } from '@/data/materials';

interface ResultsSummaryProps {
  aiResult: AIAnalysisResult;
}

export const ResultsSummary = React.memo(function ResultsSummary({
  aiResult,
}: ResultsSummaryProps) {
  return (
    <Animated.View entering={FadeInDown.delay(200).duration(300)}>
      <View style={styles.sectionTitle}>
        <Text style={styles.sectionTitleText}>RÉSUMÉ DE L'ANALYSE</Text>
        <View style={styles.sectionTitleLine} />
      </View>
      <FormFieldGroup>
        {aiResult.title ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>TITRE</Text>
            <Text style={styles.resultValue} numberOfLines={1}>
              {aiResult.title}
            </Text>
            <ConfidenceDots level="high" />
          </View>
        ) : null}
        {aiResult.brand?.detected ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>MARQUE</Text>
            <Text style={styles.resultValue}>{aiResult.brand.detected}</Text>
            <AiBadge />
          </View>
        ) : null}
        {aiResult.category?.displayName ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>CATÉGORIE</Text>
            <Text style={styles.resultValue}>
              {aiResult.category.fullLabel
                ? aiResult.category.fullLabel
                    .split(' > ')
                    .slice(0, 2)
                    .join(' / ')
                : aiResult.category.displayName}
            </Text>
            <ConfidenceDots
              level={aiResult.category?.categoryId ? 'medium' : 'low'}
            />
          </View>
        ) : null}
        {aiResult.condition?.conditionId ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>ÉTAT</Text>
            <Text style={styles.resultValue}>
              {CONDITION_DISPLAY[aiResult.condition.conditionId] ||
                aiResult.condition.conditionId}
            </Text>
            <AiBadge />
          </View>
        ) : null}
        {aiResult.size?.normalized ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>TAILLE</Text>
            <Text style={styles.resultValue}>
              {aiResult.size.normalized}
            </Text>
            <AiBadge />
          </View>
        ) : null}
        {aiResult.colors?.primaryColorId ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>COULEUR</Text>
            <Text style={styles.resultValue}>
              {getColorName(aiResult.colors.primaryColorId)}
            </Text>
            <AiBadge />
          </View>
        ) : null}
        {aiResult.materials?.materialIds?.length || aiResult.materials?.primaryMaterialId ? (
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>MATIÈRE</Text>
            <Text style={styles.resultValue}>
              {(aiResult.materials.materialIds?.length
                ? aiResult.materials.materialIds
                : [aiResult.materials.primaryMaterialId]
              )
                .filter((id): id is string => Boolean(id))
                .map(getMaterialName)
                .join(', ')}
            </Text>
            <AiBadge />
          </View>
        ) : null}
      </FormFieldGroup>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  sectionTitleLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  resultLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    width: 80,
  },
  resultValue: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
});
