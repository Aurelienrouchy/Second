import {Timestamp} from 'firebase/firestore';
/** Synthetic native documents. Client tuple/session/receipt qualification stays real. */
export function meetupFirestoreFixture(input: {uid: string; chatId: string; messageId: string; articleId: string; transactionId?: string; amount: number; actorRole?: 'buyer' | 'seller'}) {
  const transactionId = input.transactionId ?? 'old-tx', peer = 'peer', location = {toArrange: true};
  const state: {initial: Record<string, unknown> | null; counter: Record<string, unknown> | null} = {initial: null, counter: null};
  const initialByPeer = () => {state.initial = {reportedBy: peer, disputeId: 'case-meetup', reason: 'other_party_no_show', details: 'Version initiale du pair.', reportedAt: Timestamp.fromDate(new Date('2026-11-25T18:00:00.000Z'))};};
  const commitStory = (reason: string, details: string) => {
    const story = {reportedBy: input.uid, disputeId: 'case-meetup', reason, details, reportedAt: Timestamp.fromDate(new Date('2026-11-25T18:01:00.000Z'))};
    if (state.initial && state.initial.reportedBy !== input.uid) state.counter = story; else state.initial = story;
  };
  const read = async ({col, id}: {col: string; id: string}) => {
    if (col === 'messages' && id === input.messageId) return {exists: () => true, data: () => ({chatId: input.chatId, type: 'offer', senderId: input.uid, receiverId: peer,
      offer: {status: 'accepted', amount: input.amount, transactionId, meetup: {location}}})};
    if (col === 'chats' && id === input.chatId) return {exists: () => true, data: () => ({participants: [input.uid, peer], articleId: input.articleId})};
    if (col === 'transactions' && id === transactionId) return {exists: () => true, data: () => ({chatId: input.chatId, articleId: input.articleId, offerMessageId: input.messageId,
      buyerId: input.actorRole === 'seller' ? peer : input.uid, sellerId: input.actorRole === 'seller' ? input.uid : peer, amount: input.amount, deliveryType: 'meetup', status: 'meetup_confirmed', meetupSpot: location, noShowReport: state.initial, counterReport: state.counter})};
    throw new Error(`Unexpected synthetic native document: ${col}/${id}`);
  };
  return {read, initialByPeer, commitStory, state};
}
