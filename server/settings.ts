/** Storefront settings that come from the environment rather than the database. */

export interface TransferDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/** Bank transfer is offered only when all three account details are set. */
export function transferDetails(): TransferDetails | null {
  const bankName = process.env.TRANSFER_BANK_NAME?.trim();
  const accountNumber = process.env.TRANSFER_ACCOUNT_NUMBER?.trim();
  const accountName = process.env.TRANSFER_ACCOUNT_NAME?.trim();
  return bankName && accountNumber && accountName ? { bankName, accountNumber, accountName } : null;
}

/** Guest checkout is on unless GUEST_CHECKOUT=false. */
export function guestCheckoutEnabled(): boolean {
  return process.env.GUEST_CHECKOUT?.trim().toLowerCase() !== "false";
}

/** The number customers call about an order. Hidden on the tracker when unset. */
export function kitchenPhone(): string | null {
  return process.env.KITCHEN_PHONE?.trim() || null;
}
