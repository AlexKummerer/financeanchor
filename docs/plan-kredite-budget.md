# Plan: Kreditbudget, Fristen, Beispielrechnungen, Tilgungsplan

Stand: 25.09.2026, freigegeben und umgesetzt.

## Entscheidungen (aus der Rückfrage)

1. **„Tilgen bis Datum“** ist eine eigene Kreditart für Schulden ohne feste Rate, aber mit Frist: Betrag, Frist (Datum), Zins optional (meist 0 %), dazu die Zahlweise:
   - **Teilzahlungen** (z. B. Kredit „bis März zurückzahlen“): Die Verteilung plant jeden Monat die nötige Rate ein, damit die Schuld bis zur Frist getilgt ist.
   - **Einmalzahlung** (PayPal/Klarna „in 30 Tagen“): kein vorzeitiges Tilgen; im Fälligkeitsmonat erscheint der ganze Betrag unter „Diesen Monat fällig“ und wird am Fälligkeitstag gebucht.
     Beide zählen als Schuld.
2. **Zieldatum** (Monat) je Ratenkredit wird als Frist eingeplant: Kredite mit Ziel bekommen vorrangig so viel, dass sie rechtzeitig getilgt sind; reicht das Budget nicht, gibt es eine Warnung mit dem fehlenden Betrag pro Monat.
3. **Budget** als Gesamtbetrag pro Monat („Für Kredite insgesamt“) ersetzt die bisherige Extra-Tilgung.
4. **„Fällige übernehmen“** bucht die vorgeschlagene Aufteilung des Monats (wie heute die Extra-Tilgung), anpassbar wie gewohnt.

## Verteilung pro Monat (Fachlogik in `shared`)

Reihenfolge, in der das Monatsbudget verteilt wird:

1. **Einmalzahlungen im Fälligkeitsmonat:** voller Betrag (harte Frist).
2. **Mindestraten** aller Ratenkredite (letzte Rate höchstens Restschuld plus Zins).
3. **Fristen:** Kredite „Tilgen bis Datum“ mit Teilzahlungen und Ratenkredite mit Zieldatum bekommen die Rate, die sie bis zur Frist tilgt (Annuität über die verbleibenden Monate; bei 0 % Restschuld geteilt durch Monate). Frühestes Ziel zuerst.
4. **Rest nach Strategie** (höchster Zins / kleinste Schuld) auf Ratenkredite und Teilzahlungs-Kredite. Einmalzahlungen werden nicht vorzeitig getilgt.

Das Budget bleibt konstant; frei werdende Raten rollen weiter. Reicht es nicht für Schritt 1 bis 3, wird das als Unterdeckung mit fehlendem Betrag pro Monat ausgewiesen. Ohne eigenes Budget gilt die Summe aus Mindestraten und Frist-Raten; Einmalzahlungen kommen im Fälligkeitsmonat obendrauf.

**Beispielrechnungen je Kredit** („Was wäre, wenn“): Tabelle mit Monatsbetrag → getilgt im Monat → Zinsen gesamt. Erste Zeile ist die nötige Rate für die Frist (bzw. die aktuelle Rate), darunter zwei bis drei höhere, gerundete Beträge; dazu ein Feld für einen eigenen Betrag. Die Rechnung betrachtet den Kredit für sich allein.

Ergebnis der Simulation: je Monat und Kredit Zins, Mindestrate, Frist-Anteil, Extra, Restschuld; je Kredit Tilgungsmonat und ob das Ziel erreicht wird (sonst nötiger Mehrbetrag); Gesamtzinsen, schuldenfrei, „nicht absehbar“.

## Datenmodell (neue Migration)

- `loans`: `kind` (`installment` | `deadline`), `target_month` (optional, Ratenkredit), `due_date` und `payment_mode` (`spread` | `lump`, Pflicht bei „Tilgen bis Datum“). Die Monatsrate entfällt bei „Tilgen bis Datum“ (Spalte wird nullable; Tabelle wird von Drizzle neu aufgebaut, Daten bleiben).
- `user_settings`: `loan_budget_cents` (optional) ersetzt `extra_payment_cents`. Umrechnung bei der Migration: Budget = Summe der Raten offener Kredite + bisherige Extra-Tilgung (nur wo Extra > 0 war).
- Export-Format Version 2; Sicherungen der Version 1 werden beim Einlesen umgerechnet.

## Oberfläche (Kredite)

- **Budget:** Feld „Für Kredite pro Monat insgesamt“ mit Aufschlüsselung „Mindestraten · für Ziele · Extra“ und Warnung bei Unterdeckung.
- **Formular:** Art wählen. Ratenkredit wie bisher plus optional „Getilgt bis (Monat)“. „Tilgen bis Datum“ mit Name, Betrag, Frist, Zins (optional), Teilzahlungen oder Einmalzahlung.
- **Kreditkarte:** Ziel erreicht bzw. nicht erreichbar (+ fehlender Betrag), nötige Monatsrate; bei Fristen die verbleibende Zeit; aufklappbar die Beispielrechnungen.
- **Tilgungsplan:** je Kredit aufklappbare Tabelle (Monat, Rate, Zins, Tilgung, Restschuld) und eine Gesamtaufteilung pro Monat (Spalte je Kredit, Summe); zuerst 12 Monate, „alle Monate anzeigen“.
- **Übersicht und Fälligkeiten:** Kreditraten der Monatsübersicht = Aufteilung des laufenden Monats; die Fälligkeitsliste zeigt je Kredit Rate und Extra aus der Aufteilung sowie Einmalzahlungen am Fälligkeitstag.

## Schritte

1. `shared`: neue Verteilung und Simulation mit Tests (Fristen, Unterdeckung, Teil- und Einmalzahlung, Beispielrechnungen, Vergleich mit bisherigem Verhalten ohne Ziele).
2. `shared`: Fälligkeiten auf die Aufteilung umstellen; Schemas und Export v2.
3. `backend`: Migration mit Datenumrechnung, Routen, Import v1 → v2, Tests.
4. `web`: Budget, Formular, Kreditkarten, Tilgungsplan-Tabellen, Anpassungen in Übersicht; Tests.
5. E2E um „Tilgen bis Datum“, Beispielrechnung und Budget ergänzen; Doku.

## Umsetzungshinweise

- Migrationen `0001_loan_kinds_and_budget` (neue Spalten, Umrechnung Extra → Budget) und `0002_drop_extra_payment`. Die von drizzle-kit erzeugten `INSERT … SELECT` wurden von Hand korrigiert (sie lasen neue Spalten aus der alten Tabelle), `PRAGMA foreign_keys` durch `defer_foreign_keys` ersetzt; ein Test prüft die Umrechnung an einer D1 im alten Stand.
- Bei Teilzahlungen wird die Monatsrate am Tag der Frist gebucht (z. B. am 31. bzw. Monatsletzten).
- Bereits im laufenden Monat gebuchte Raten werden im Plan als „gebucht“ gezeigt und nicht doppelt eingeplant; das restliche Budget verteilt sich weiter.

## Nachtrag 25.09.2026 (Rückmeldung aus dem ersten Test)

- **Fehler behoben:** Gebuchte Raten inzwischen gelöschter Kredite minderten das Budget (Postbank bekam dadurch weniger als ihre feste Rate).
- **Reihenfolge geändert:** Die vereinbarten Raten der Bank werden immer zuerst eingeplant; Einmalzahlungen haben keinen Vorrang mehr davor.
- **Ansparen für Einmalzahlungen:** Bis zur Fälligkeit wird monatlich zurückgelegt (Buchung „Rücklage für …“, Stand im Kredit als `saved_cents`, Migration 0003); im Fälligkeitsmonat wird der ganze Betrag gezahlt und das Angesparte verbraucht. Schon Zurückgelegtes lässt sich im Formular eintragen.
- **Anzeige Zieldatum:** „Für dein Ziel …: X €/Monat (Rate Y + Z)“ statt „Nötig“.

## Nachtrag 2 (25.09.2026): Plan = tatsächliche Zahlungen, Budget nur für Vorschläge

Rückmeldung: Ein Budget, das automatisch verteilt wird („Diesen Monat 600 €“ bei 364,99 € Rate), ist irritierend.

- Der Plan enthält nur, was tatsächlich gezahlt wird: Raten, bei „Tilgen bis Datum“ die nötige Teilzahlung bzw. das Zurücklegen, und die **selbst festgelegte Extra-Tilgung je Kredit** (`extra_monthly_cents`, Migration 0004).
- Ein **Zieldatum** beim Ratenkredit wird nur geprüft („Ziel wird erreicht“ bzw. „es fehlen X €/Monat“), nicht automatisch aufgestockt.
- **„Verfügbar für Kredite“** (bisher „Budget“, gleiche Spalte `loan_budget_cents`) ändert keinen Plan, sondern erzeugt Vorschläge: Ziel erreichen, alles Verfügbare nutzen (Kredit nach Strategie) – jeweils mit Tilgungsmonat und Zinsersparnis. **„Übernehmen“** setzt die Extra-Tilgung des Kredits; ändern oder auf 0 setzen im Formular. Auch Zeilen der Beispielrechnung lassen sich übernehmen.
- Frei werdende Raten rollen nicht mehr automatisch weiter; das bleibt eine bewusste Entscheidung.

## Nachtrag 3 (25.09.2026): Vorschläge ohne Strategie-Auswahl

Rückmeldung: Die Auswahl „Welcher Kredit bekommt im Vorschlag das Extra?“ war unverständlich, und die Vorschläge passten nicht zur Lage (z. B. Ziel-Vorschläge „mehr als verfügbar“).

- **Reicht das Geld nicht:** keine Vorschläge für zusätzliche Tilgung, sondern die Aufstellung der geplanten Zahlungen (Rate, Frist-Rate, Zurücklegen, eigene Extra-Tilgung je Kredit) und wie viel fehlt.
- **Ist Geld übrig:** zwei fertige Vorschläge nebeneinander – „Spart am meisten Zinsen“ (höchster Zins zuerst) und „Schnellste Entlastung“ (kleinste Schuld zuerst, danach fällt die Rate weg), je mit Tilgungsmonat, Monaten früher, Zinsersparnis und „Übernehmen“. Wählen beide denselben Kredit, erscheint er nur einmal. Ein Vorschlag ist nie höher als das, was den Kredit ablöst.
- **Ziel-Vorschläge** nur, wenn sie ins Übrige passen; sonst bleibt der Hinweis auf der Kreditkarte.
- Die Strategie-Auswahl ist entfallen (die Einstellung `strategy` bleibt im Schema und im Export, wird aber nicht mehr genutzt).

## Nachtrag 4 (25.09.2026): Übriges der Reihe nach verteilen

Rückmeldung: Bei 857,77 € übrig kamen nur Ziel-Vorschläge. Ursache: Der jeweils erste Kredit der Reihenfolge (Refurbed mit höchstem Zins, Amazon mit kleinster Schuld) war durch die eigene Extra-Tilgung schon abgedeckt, und der Vorschlag entfiel, statt zum nächsten Kredit weiterzugehen.

- „Spart am meisten Zinsen“ und „Schnellste Entlastung“ verteilen das Übrige jetzt der Reihe nach: Jeder Kredit bekommt höchstens, was ihn in diesem Monat ablöst, der Rest geht an den nächsten. Ein Vorschlag besteht daher aus mehreren Teilen (`parts`), „Übernehmen“ setzt die Extra-Tilgung bei allen.
- Angezeigt werden je Kredit der Betrag und die Wirkung („diesen Monat abgelöst“ bzw. „fertig im …“), die dadurch wegfallenden Raten und die Zinsersparnis insgesamt.
- Frei werdende Raten erscheinen im Folgemonat als zusätzlich übriges Geld und damit in neuen Vorschlägen; sie werden weiterhin nicht automatisch umverteilt.
- Überschriften nennen den Monat („Geplant im …“, „Vorschläge für …“); jeder Vorschlag hat „Verlauf ansehen“ mit der Aufteilung pro Monat, als wäre er übernommen (`LoanPlanner.planWith`).

## Nachtrag 5 (25.09.2026): Planungsmonat nach dem Buchen

Rückmeldung: Ist der September schon gebucht, ergeben Vorschläge „für September“ keinen Sinn.

- Sind im laufenden Monat alle Kreditzahlungen gebucht (Raten, Rücklagen, Extra-Tilgungen), plant und schlägt die App für den nächsten Monat vor (`LoanPlanner.adviceMonth`): „Geplant im …“, „Vorschläge für …“, Ziel-Lücken und nötige Raten auf der Kreditkarte beziehen sich dann darauf.
- Neue Spalte `loans.extra_from_month` (Migration 0006): Eine übernommene oder im Formular geänderte Extra-Tilgung gilt erst ab dem Planungsmonat, damit sie im schon gebuchten Monat nicht nachträglich fällig wird. Die Kreditkarte zeigt dann „… ab Okt. 2026“.

## Nachtrag 6 (25.09.2026): Kennzahlen und Verlauf im Dialog

- Oben auf der Kredit-Seite: Nettoschulden (Restschuld minus Zurückgelegtes), getilgter Anteil (über die laufenden Kredite, `loanTotals`), Zinsen bis schuldenfrei laut Plan und Zinsen im Planungsmonat.
- „Verlauf ansehen“ öffnet einen Dialog mit der Aufteilung pro Monat, als wäre der Vorschlag übernommen; dort lässt er sich auch direkt übernehmen.
