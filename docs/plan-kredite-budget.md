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
