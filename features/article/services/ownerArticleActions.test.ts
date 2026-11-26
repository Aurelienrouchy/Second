import { describe, expect, it } from 'vitest';

import {
  MARK_AS_SOLD_ALERT,
  buildOwnerActionSheetIOS,
  ownerArticleActions,
  removeArticleAlert,
} from './ownerArticleActions';

describe('ownerArticleActions', () => {
  it('une annonce en vente propose modifier, marquer vendu, supprimer', () => {
    expect(ownerArticleActions(false).map((e) => e.label)).toEqual([
      'Modifier',
      'Marquer comme vendu',
      'Supprimer',
    ]);
  });

  it('une annonce vendue ne propose plus la modification', () => {
    expect(ownerArticleActions(true).map((e) => e.label)).toEqual([
      'Remettre en vente',
      'Supprimer',
    ]);
  });
});

describe('buildOwnerActionSheetIOS', () => {
  it('« Annuler » ferme la feuille en dernier, comme sur la fiche article', () => {
    const sheet = buildOwnerActionSheetIOS('Robe fleurie', false);
    expect(sheet.cancelButtonIndex).toBe(sheet.options.length - 1);
    expect(sheet.options[sheet.cancelButtonIndex]).toBe('Annuler');
  });

  it('le bouton destructeur désigne « Supprimer »', () => {
    const sheet = buildOwnerActionSheetIOS('Robe fleurie', true);
    expect(sheet.options[sheet.destructiveButtonIndex]).toBe('Supprimer');
    expect(sheet.actions[sheet.destructiveButtonIndex]).toBe('delete');
  });

  it("chaque index porte l'action de son libellé", () => {
    const sheet = buildOwnerActionSheetIOS('Robe fleurie', false);
    expect(sheet.actions[sheet.options.indexOf('Modifier')]).toBe('edit');
    expect(sheet.actions[sheet.cancelButtonIndex]).toBeNull();
  });
});

describe('copie des alertes', () => {
  it('« Retirer de la vente » ne promet ni suppression définitive ni irréversibilité', () => {
    const alert = removeArticleAlert('Robe fleurie');
    expect(alert.title).toBe('Retirer de la vente');
    expect(alert.message).toContain('« Robe fleurie »');
    expect(alert.message).not.toMatch(/définitiv|irréversible/i);
  });

  it('« Marquer comme vendu » prévient de la perte des favoris et des offres', () => {
    expect(MARK_AS_SOLD_ALERT.message).toContain('favori');
    expect(MARK_AS_SOLD_ALERT.message).toContain('offres en attente');
  });
});
