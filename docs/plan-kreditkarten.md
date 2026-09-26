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

## Umgesetzt (26.09.2026)

- Alle drei Schritte. Zusätzlich: `/api/accounts/card-statements?today=` liefert laufende und letzte Abrechnung je Karte mit Buchungen und ob die Abbuchung gebucht ist; der Abgleich-Betrag der Bank wird nur im Browser verglichen, nicht gespeichert.
- Nebenbei behoben: Teiländerungen (PATCH) setzten fehlende Felder mit Standardwert zurück (`patchSchema` in `shared`).
- E2E-Tests nutzen eine Sitzung weiter (`login()` in `e2e/fixtures.ts`), damit die Login-Sperre (10/Minute) nicht greift.

## Nachtrag (26.09.2026): Stichtag genauer

- **Kauf am Stichtag:** Banken trennen am Stichtag nach Uhrzeit, die in keiner CSV steht. Käufe am Stichtag zählen zunächst zur alten Abrechnung; in der Kartenansicht lassen sie sich per „→ gehört zur nächsten Abrechnung“ verschieben (`transactions.statement_month`, Migration 0011). Die nächste Abrechnung wird angezeigt, sobald dort Käufe liegen.
- **Schwankender Stichtag:** Je Abrechnung lassen sich Stichtag und Abbuchung laut Bank eintragen (`card_statement_dates`, Migration 0012; `PUT/DELETE /api/accounts/:id/statements/:closeMonth`). Zeitraum, Summe, Abgleich und die Abbuchung unter „Fällige übernehmen“ rechnen damit; die Folgeabrechnung beginnt am Tag danach.
- **Datumsspalte beim Import:** Hat die Datei mehrere Datumsspalten (z. B. Buchungs- und Umsatztag), wird gewählt, welche gilt; die Wahl wird mit der Zuordnung gespeichert.
