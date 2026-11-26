/**
 * Sell feature — barrel exports.
 * Sub-components extracted from sell flow screens.
 */

// Shared
export { SellFooter } from './components/shared/SellFooter';
export { PhotoStripPreview } from './components/shared/PhotoStripPreview';
export { AiBadge } from './components/shared/AiBadge';

// Details
export { TextareaField } from './components/details/TextareaField';
export { ChipSelector } from './components/details/ChipSelector';
export { FieldRow } from './components/details/FieldRow';

// Pricing
export { PriceCard } from './components/pricing/PriceCard';
export { HandDeliveryCard } from './components/pricing/HandDeliveryCard';
export { ShippingCard } from './components/pricing/ShippingCard';
export { FormErrors } from './components/pricing/FormErrors';

// Analysis
export { AnalysisCard } from './components/analysis/AnalysisCard';
export { ProgressStepsList } from './components/analysis/ProgressStepsList';
export { AnalysisFooter } from './components/analysis/AnalysisFooter';

// Capture
export { PermissionDenied } from './components/capture/PermissionDenied';
export { TopControls } from './components/capture/TopControls';
export { ThumbnailStrip } from './components/capture/ThumbnailStrip';
export { CameraControlsRow } from './components/capture/CameraControlsRow';
export { SellOverlayCapture } from './components/capture/SellOverlayCapture';

// — modules rattachés lors du regroupement par feature —
export { default as CategoryDisplay } from './components/details/CategoryDisplay';
export { default as ConditionSelector } from './components/details/ConditionSelector';
export { ConditionValue } from './components/details/ConditionSelector';
export { default as EditableField } from './components/details/EditableField';
export { default as NeighborhoodBottomSheet } from './components/pricing/NeighborhoodBottomSheet';
export { NeighborhoodBottomSheetRef } from './components/pricing/NeighborhoodBottomSheet';
export { default as BlurOverlay } from './components/shared/BlurOverlay';
export { default as CameraGuides } from './components/shared/CameraGuides';
export { default as DraftResumeModal } from './components/shared/DraftResumeModal';
export { default as FormFieldGroup } from './components/shared/FormFieldGroup';
export { default as FormSectionTitle } from './components/shared/FormSectionTitle';
export { default as PhotoCarousel } from './components/shared/PhotoCarousel';
export { default as SuccessModal } from './components/shared/SuccessModal';

export { PhotoOrderControls } from './components/shared/PhotoOrderControls';
export { DraggablePhotoGrid } from './components/photos-review/DraggablePhotoGrid';
