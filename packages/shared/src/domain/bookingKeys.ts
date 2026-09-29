/** Schlüssel, unter denen eine Fälligkeit pro Monat höchstens einmal gebucht wird. */
export const bookingKeys = {
  reserve: (potId: string) => `reserve:${potId}`,
  item: (itemId: string) => `item:${itemId}`,
  /** Früher: Umbuchung je Posten aus der Rücklage (nur noch für schon gebuchte Monate) */
  transfer: (itemId: string) => `transfer:${itemId}`,
  /** Gesammelte Umbuchung aus der Rücklage im Monat, je Topf */
  withdraw: (potId: string) => `withdraw:${potId}`,
  loan: (loanId: string) => `loan:${loanId}`,
  extra: (loanId: string) => `extra:${loanId}`,
  /** Ansparen für eine Einmalzahlung */
  save: (loanId: string) => `save:${loanId}`,
  /** Abbuchung einer Kreditkarte */
  card: (accountId: string) => `card:${accountId}`,
} as const;
