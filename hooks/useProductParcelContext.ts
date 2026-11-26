import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';

/** Keep legacy admission unchanged; P reads and NEW also lose their epoch on activity changes. */
export function useProductParcelContext(dossier: string, uid: string | null, parcel: boolean) {
  const legacy = useShippingPurchaseContext(dossier, uid), activity = useLabelLifecycleContext(dossier, uid);
  type Operation = {kind: 'legacy'; value: ReturnType<typeof legacy.capture>} | {kind: 'parcel'; value: ReturnType<typeof activity.capture>};
  const capture = (): Operation => parcel ? {kind: 'parcel', value: activity.capture()} : {kind: 'legacy', value: legacy.capture()};
  const start = (): Operation | null => {
    if (parcel) {const value = activity.start(); return value ? {kind: 'parcel', value} : null;}
    const value = legacy.start(); return value ? {kind: 'legacy', value} : null;
  };
  const assertCurrent = (operation: Operation) => {if (operation.kind === 'parcel') activity.assertCurrent(operation.value); else legacy.assertCurrent(operation.value);};
  const isCurrent = (operation: Operation) => {try {assertCurrent(operation); return true;} catch {return false;}};
  return {frame: parcel ? activity.frame : legacy.frame, focused: parcel ? activity.focused : legacy.focused,
    focusRevision: parcel ? activity.focusRevision : legacy.focusRevision, capture, start, assertCurrent, isCurrent,
    finish: (operation: Operation) => {if (operation.kind === 'parcel') activity.finish(operation.value); else legacy.finish(operation.value);}};
}
