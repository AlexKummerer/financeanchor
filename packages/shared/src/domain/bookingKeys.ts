/** Schlüssel, unter denen eine Fälligkeit pro Monat höchstens einmal gebucht wird. */
export const bookingKeys = {
  reserve: (potId: string) => `reserve:${potId}`,
  item: (itemId: string) => `item:${itemId}`,
  transfer: (itemId: string) => `transfer:${itemId}`,
  loan: (loanId: string) => `loan:${loanId}`,
  extra: (loanId: string) => `extra:${loanId}`,
} as const;
