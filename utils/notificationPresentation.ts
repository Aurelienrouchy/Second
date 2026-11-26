import type {Notification} from '@/types/notification';
/** Presentation only: never mutate an old receipt or turn its free text into an official instruction. */
export function privateNotificationPresentation(notification: Pick<Notification, 'type' | 'title' | 'message'>): {title: string; message: string} {
  if (notification.type === 'support_deadline') return {title: 'Suivi du support à examiner', message: 'Consultez la file privée actuelle. Cet avis ne confirme ni lecture humaine, réponse complète ou prolongation d’une échéance.'};
  if (['chat', 'message', 'new_message'].includes(notification.type)) return {title: 'Message d’un membre', message: 'Un membre vous a envoyé un message. Consultez la conversation pour le lire.'};
  if (notification.type === 'order_moderation') return {title: 'Mise à jour concernant votre commande', message: 'Consultez le dossier privé de la commande pour examiner les informations et leur état actuel.'};
  if (notification.type === 'moderation_update') return {title:'Examen d’un contenu',message:'Consultez votre dossier privé pour examiner la décision exacte et les possibilités de contestation.'};
  return {title: notification.title, message: notification.message};
}
