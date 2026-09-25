# Plan: Kreditkarten

Wunsch (25.09.2026): Zwei Kreditkarten – eine rechnet bis zum 24. ab und wird dann abgebucht, die Amex wird am 4. für den Vormonat abgebucht. Überblick, was gerade auf jeder Karte offen ist, und Abgleich mit der Abrechnung („habe ich jeden Posten gebucht?“).

## Grundsatz

- Ausgaben zählen mit dem **Kaufdatum** im Monat, in dem gekauft wurde.
- Die **Abbuchung** vom Girokonto ist keine Ausgabe, sondern eine Umbuchung Girokonto → Karte (neue Buchungsart `card_payment`). Sie zählt weder in den Monatssummen noch in „Gebucht“ der Übersicht.

## Datenmodell

- Konto-Art `credit_card` mit `statement_day` (Abrechnungsstichtag, 1–31, Monatsende bei kürzeren Monaten), `debit_day` (Abbuchungstag) und `debit_account_id` (Konto, von dem abgebucht wird).
- Abbuchung: ist `debit_day >= statement_day`, im selben Monat wie der Stichtag, sonst im Folgemonat.
  - Karte 1: Stichtag 24, Abbuchung 24 → Käufe 25.08.–24.09. werden am 24.09. abgebucht.
  - Amex: Stichtag 31 (Monatsende), Abbuchung 4 → Käufe im September werden am 04.10. abgebucht.
- Buchungen bekommen optional `account_id` („bezahlt mit“). Nur Kreditkarten sind wählbar; ohne Angabe wie bisher.
- **Kartenstand wird berechnet**, nicht mitgeführt: `balance_cents` der Karte ist der Startstand, dazu kommen Käufe/Gutschriften mit dieser Karte und die gebuchten Abbuchungen. So kann nichts auseinanderlaufen; ändert man den Stand von Hand, wird der Startstand angepasst.

## Fällige übernehmen

- Neuer Eintrag „Abbuchung Amex“ (Schlüssel `card:<kartenId>`) im Abbuchungsmonat, Betrag = Summe der Kartenbuchungen im Abrechnungszeitraum. Betrag lässt sich wie gewohnt anpassen (z. B. auf den Betrag der Bankabrechnung).
- Wirkung: Girokonto −Betrag (wie die Rücklage), Karte +Betrag (über die Buchung selbst, da der Kartenstand berechnet wird).

## Abgleich

- Vermögen → Karte: „offen“ (aktueller Stand), laufender Zeitraum und letzte Abrechnung mit Summe und Anzahl der Buchungen und ob die Abbuchung gebucht ist.

## Migration

- `accounts` und `transactions` müssen wegen geänderter CHECKs neu aufgebaut werden. An `transactions` hängen `booked_items` mit ON DELETE CASCADE – die Migration sichert `booked_items` vorher und stellt sie danach wieder her; ein Migrationstest prüft das.

## Schritte

1. Fachlogik (`shared`): Konto-Felder, Buchungsart, Abrechnungszeiträume, Kartenstand, Fälligkeit, Ausschluss aus Summen – mit Tests.
2. Backend: Migration (+ Test), Konten-API mit berechnetem Kartenstand, Buchungen mit `accountId`, Fälligkeit, Export/Import.
3. Oberfläche: Karte anlegen/bearbeiten, „bezahlt mit“ bei Buchungen, Kartenübersicht mit Abgleich.
