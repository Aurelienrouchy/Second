/**
 * Saisies en cours dans l'écran d'édition : tapées dans un `EditableField`,
 * pas encore « Confirmées ».
 *
 * La valeur n'atteignait le formulaire qu'au tap sur « Confirmer ». Taper
 * directement « Enregistrer les modifications » — ou fermer l'écran — perdait
 * la saisie sans un mot. Elle est désormais appliquée à l'enregistrement, et
 * compte comme une modification non enregistrée.
 */
export interface PendingEdits {
  title?: string;
  description?: string;
  price?: string;
  brand?: string;
}

interface EditableTextFields {
  title: string;
  description: string;
  price: number;
  brand: string;
}

/** Les champs, saisies en cours appliquées — nettoyées comme à la confirmation. */
export function applyPendingEdits<T extends EditableTextFields>(fields: T, pending: PendingEdits): T {
  return {
    ...fields,
    ...(pending.title !== undefined ? { title: pending.title.trim() } : {}),
    ...(pending.description !== undefined ? { description: pending.description.trim() } : {}),
    ...(pending.price !== undefined
      ? { price: parseFloat(pending.price.trim().replace(',', '.')) || 0 }
      : {}),
    ...(pending.brand !== undefined ? { brand: pending.brand.trim() } : {}),
  };
}
