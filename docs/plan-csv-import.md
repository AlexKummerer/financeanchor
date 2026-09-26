# Plan: CSV-Import von Konto- und Kartenumsätzen

Wunsch (26.09.2026): Umsätze der Banken und Karten einlesen statt abtippen – Sparkasse, Volksbank, DKB, ING, Comdirect, Amex und andere Kreditkarten; Girokonto und Karten. PDF vorerst nicht.

## Grundsätze

- **Nichts wird automatisch übernommen.** Jede Zeile wird in einer Vorschau geprüft; Name, Kategorie, Datum und Betrag lassen sich anpassen, übernommen wird nur, was man anhakt (wie bei „Fällige übernehmen“, nichts vorausgewählt).
- **Die Datei bleibt im Browser.** Gelesen und ausgewertet wird im Browser; an den Server gehen nur die bestätigten Buchungen.
- **Keine Doppelten.** Jede eingelesene Zeile bekommt einen Fingerabdruck (Konto + Datum + Betrag + Text). Schon importierte Zeilen erscheinen als „bereits übernommen“. Zeilen, die zu einer vorhandenen Buchung passen (gleicher Betrag, Datum ±3 Tage, z. B. Miete oder Kreditrate aus „Fällige übernehmen“), werden als „wahrscheinlich schon gebucht“ markiert; man kann sie mit dieser Buchung verknüpfen statt neu anzulegen.
- **Kartenabbuchungen auf dem Girokonto** (z. B. „American Express“) werden erkannt und nicht als Ausgabe vorgeschlagen – die Abbuchung läuft über „Fällige übernehmen“ und die Käufe über den Import der Karte.

## Formate

- Einlesen: Trennzeichen (`;` `,` Tab) und Zeichensatz (UTF-8, sonst Windows-1252) automatisch; Vorspann-Zeilen (Kontoname, IBAN, Zeitraum, Kontostand) werden übersprungen, die Kopfzeile wird gesucht.
- Voreinstellungen je Bank (Kopfzeilen-Erkennung): welche Spalte Datum, Betrag, Empfänger/Auftraggeber, Verwendungszweck ist, Datumsformat, Vorzeichen (Amex: Belastungen positiv), vorgemerkte Umsätze und Saldo-Zeilen ignorieren.
- Unbekanntes Format: Spalten einmal selbst zuordnen; die Zuordnung wird je Konto gespeichert und beim nächsten Mal wiederverwendet.

## Kategorien und Text

- Vorschlag des Buchungstexts: Empfänger/Auftraggeber (sonst Verwendungszweck gekürzt).
- Kategorie: aus früheren Buchungen mit gleichem oder ähnlichem Namen (wie beim Erfassen); sonst leer und muss gewählt werden.

## Datenmodell

- `transactions.import_key`: Fingerabdruck der eingelesenen Zeile, eindeutig je Nutzer (verhindert doppelten Import, auch über zwei Geräte).
- `accounts.import_profile`: gespeicherte Spaltenzuordnung je Konto (JSON).
- Käufe beim Karten-Import bekommen „bezahlt mit“ = Karte; beim Girokonto bleibt es leer.

## Schritte

1. Fachlogik (`shared`): CSV lesen, Kopfzeile und Bank erkennen, Zeilen normalisieren (Datum, Betrag, Text), Fingerabdruck, Abgleich mit vorhandenen Buchungen – mit Testdateien je Bank.
2. Backend: Migration, `POST /api/transactions/import/check` (welche Fingerabdrücke/ähnlichen Buchungen gibt es schon), `POST /api/transactions/import` (bestätigte Zeilen atomar anlegen, Doppelte ablehnen), Import-Profil am Konto; Export/Import der Sicherung.
3. Oberfläche: Buchungen → „Umsätze einlesen“: Konto wählen, Datei wählen, Vorschau mit Bearbeiten, Filter (neu / schon gebucht / übersprungen), Übernehmen.

## Umgesetzt (26.09.2026)

- Unterstützt und an echten, anonymisierten Exporten geprüft (nicht im Repo): Sparkasse (CAMT V2/V8, MT940), Volksbank/Raiffeisenbank, DKB (Giro; Visa nach Doku), ING (mit und ohne Saldo), Comdirect (mehrere Abschnitte), American Express. Im Repo liegen eigene Testdaten mit denselben Kopfzeilen (`packages/shared/test/statement.test.ts`).
- Nicht per CSV: Barclays (nur Excel), Hanseatic und Advanzia (nur PDF) – später.
- Oberfläche: Buchungen → „Umsätze aus CSV einlesen“ (`/buchungen/einlesen`). Kartenabbuchungen auf dem Girokonto lassen sich nicht als Ausgabe übernehmen; ist die Abbuchung schon gebucht, erscheint sie unter „Schon gebucht?“ zum Verknüpfen.
- Unbekanntes Format: Spalten selbst zuordnen; die Zuordnung wird beim Übernehmen am Konto gespeichert.

## Nachtrag (26.09.2026): Lernen und Karten-Abos

- **Lernen:** Jede übernommene oder verknüpfte Zeile speichert ein Merkmal des Bank-Texts ohne Nummern (`transactions.import_label`, z. B. „paypal *disneyplus“). Beim nächsten Import werden Name und Kategorie der jüngsten Buchung mit gleichem Merkmal vorbelegt („wie beim letzten Mal“). Übernommen wird weiterhin nur Angehaktes.
- **Fixkosten „Bezahlt mit“** (`recurring_items.account_id`, Migration 0010): „Fällige übernehmen“ bucht solche Posten auf die Karte; sie zählen zu Kartenstand und Abrechnung.
- **Verknüpfen beim Karten-Import** trägt die Karte bei eigenen Buchungen ohne Karte nach.
- **Zahlung an die Karte** („ZAHLUNG/ÜBERWEISUNG ERHALTEN …“) wird beim Karten-Import erkannt und nicht als Einnahme angeboten.
