/**
 * Unveränderte Berechnungen aus `prototype/index.html` (Gleitkomma, Euro), nur als Vergleichsmaßstab
 * für Tests. Nicht in der App verwenden.
 */
interface ProtoLoan {
  id: string;
  balance: number;
  rate: number;
  payment: number;
}

export function prototypeSimulate(loansIn: ProtoLoan[], extra: number, strat: string) {
  const loans = loansIn.map((l) => ({
    id: l.id,
    bal: l.balance,
    r: l.rate / 1200,
    pay: l.payment,
    done: null as number | null,
  }));
  if (!loans.length) return null;
  const budget = loans.reduce((a, l) => a + l.pay, 0) + extra;
  let month = 0;
  let interest = 0;
  while (loans.some((l) => l.bal > 0.005) && month < 600) {
    month++;
    loans.forEach((l) => {
      if (l.bal > 0) {
        const i = l.bal * l.r;
        interest += i;
        l.bal += i;
      }
    });
    let avail = budget;
    loans.forEach((l) => {
      if (l.bal > 0) {
        const p = Math.min(l.pay, l.bal);
        l.bal -= p;
        avail -= p;
      }
    });
    const order = loans
      .filter((l) => l.bal > 0)
      .sort((a, b) => (strat === 'snowball' ? a.bal - b.bal : b.r - a.r));
    for (const l of order) {
      if (avail <= 0) break;
      const p = Math.min(avail, l.bal);
      l.bal -= p;
      avail -= p;
    }
    loans.forEach((l) => {
      if (l.bal <= 0.005 && l.done == null) {
        l.bal = 0;
        l.done = month;
      }
    });
  }
  const per: Record<string, number | null> = {};
  loans.forEach((l) => (per[l.id] = l.done));
  return { months: month, interest, per, stuck: month >= 600 };
}
