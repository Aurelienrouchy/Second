export function formatPrice(amount: number): string {
  if (Number.isInteger(amount)) {
    return `${amount} $`;
  }
  return `${amount.toFixed(2).replace('.', ',')} $`;
}
