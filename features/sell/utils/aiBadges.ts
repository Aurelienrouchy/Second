import type { AIAnalysisResult } from '@/types/ai';

/**
 * Fields the analysis actually FILLED — the only ones that get the « IA »
 * badge. The details screen tested the mere presence of a confidence level,
 * which every field has, manual entry included: six badges lit up on empty
 * fields right after the seller declined the analysis.
 */
export function aiFilledFields(ai: AIAnalysisResult | null) {
  return {
    title: !!ai?.title,
    description: !!ai?.description,
    category: !!ai?.category?.categoryId,
    condition: !!ai?.condition?.conditionId && (ai?.condition?.confidence?.value ?? 0) > 0,
    colors: (ai?.colors?.colorIds?.length ?? 0) > 0 || !!ai?.colors?.primaryColorId,
    materials: (ai?.materials?.materialIds?.length ?? 0) > 0 || !!ai?.materials?.primaryMaterialId,
    size: !!(ai?.size?.normalized || ai?.size?.detected),
    brand: !!ai?.brand?.detected,
  };
}
