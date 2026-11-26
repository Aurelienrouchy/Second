/** Independent documentary guard. No report/instruction certifies possession
 * or clears this marker; absence is the only automatic progress permission. */
export function returnToSenderBlocksProgress(order: FirebaseFirestore.DocumentData): boolean {
  return Object.prototype.hasOwnProperty.call(order, 'returnToSenderGuard');
}
