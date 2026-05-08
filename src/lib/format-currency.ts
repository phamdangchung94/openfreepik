/**
 * Currency display helpers.
 *
 * Internal accounting (DB columns named *Eur, orchestrator pricing,
 * Magnific bills) stays in EUR — no schema migration. Display layer
 * converts to VND at a fixed rate: customers see VND only, admins see
 * VND primary + EUR secondary so they can reconcile with the Magnific
 * dashboard.
 *
 * Rate: 1 EUR = 1,000 VND. Adjust EUR_TO_VND when the conversion
 * floor moves; nothing else needs to change.
 */

export const EUR_TO_VND = 1000;

/**
 * "1,500 đ" — thousand-separator dots (Vietnamese locale convention),
 * trailing currency mark. Always integer; fractional EUR rounds to
 * nearest VND so a 1.96 EUR cost shows as 1,960 đ.
 */
export function formatVnd(eur: number): string {
  const vnd = Math.round(eur * EUR_TO_VND);
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(vnd) + " đ";
}

/**
 * "1.96 €" — two-decimal EUR. Only shown to admins or in audit-style
 * log lines; customers should never see this.
 */
export function formatEur(eur: number): string {
  return `${eur.toFixed(2)} €`;
}

/**
 * Admin combo: "1,960 đ (1.96 €)" — VND primary so the customer-facing
 * number is unambiguous, EUR in parens so the admin can reconcile
 * against the upstream provider's dashboard.
 */
export function formatVndWithEur(eur: number): string {
  return `${formatVnd(eur)} (${formatEur(eur)})`;
}

/**
 * Numeric VND value, no formatting. Use when feeding into another
 * formatter (e.g. CSV export wants a raw number, not "1,960 đ").
 */
export function eurToVnd(eur: number): number {
  return Math.round(eur * EUR_TO_VND);
}
