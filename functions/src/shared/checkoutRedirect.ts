/** Pure helper shared by native SDK and server confirmation. A Dev 3DS return
 * must reopen the Dev binary even when production is also installed. */
export function getCheckoutReturnUrl(environment: 'development' | 'production'): string {
  return `${environment === 'production' ? 'seconde' : 'seconde-dev'}://checkout/success`;
}
