/**
 * Conservation quotidienne des images placées sous le préfixe de brouillon.
 *
 * Le parcours de vente téléverse les photos sous `drafts/{uid}/{draftId}/`
 * pendant l'analyse IA, et la publication réutilise ces URL telles quelles :
 * les photos d'un article publié VIVENT sous `drafts/`. L'âge d'un fichier ne
 * dit donc pas qu'il est abandonné. Une absence de référence dans les articles
 * ne qualifie pas non plus la fin des obligations de conservation : commandes,
 * conversations, litiges et demandes de confidentialité restent distincts.
 * Aucune politique de suppression cross-service ni autorité juridique n'est
 * qualifiée. La suppression automatique reste fermée pour tous les objets.
 * Une lecture Firestore suivie d'un DELETE Storage ne serait pas atomique et
 * ne permettrait pas, à elle seule, de lever cette conservation.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';

export const cleanupExpiredDrafts = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Toronto',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    logger.info('Draft images retained: disposal authority is unqualified', {
      reason: 'cross_service_retention_authority_unqualified',
      automaticDeletionAuthorized: false,
      deleted: 0,
    });
  }
);
