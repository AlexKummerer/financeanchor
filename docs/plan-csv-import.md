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

## Nachtrag (28.09.2026): Besserer Abgleich mit vorhandenen Buchungen

Anlass: Von Hand gebuchte Posten wurden beim Einlesen nicht erkannt – „Rate OLB“ (82 €) gegen den Bank-Text „Oldenburgische Landesbank“, eine Sparrate von 50 € als 5 × 10 € abgebucht, 20 € als 2 × ca. 10 €.

- **Abgleich** (`reconcile` in `shared/src/import/reconcile.ts`), jede Buchung höchstens einmal automatisch:
  1. sicher: gelernte Herkunft (Bank-Text war schon einmal mit dieser Fixkosten-/Kreditbuchung verknüpft, bis 15 Tage, Betrag bis 5 %, mind. 2 €) oder gleicher Betrag bis 3 Tage; möglich: gleicher Betrag einer Buchung aus „Fällige übernehmen“ bis 10 Tage
  2. Gruppe: mehrere Zeilen mit gleichem Bank-Text, deren Summe zu einer Buchung passt (bis 15 Tage) – sicher bei genau gleicher Summe, sonst möglich
  3. möglich: Betrag bis 5 % daneben, bis 7 Tage, ein gemeinsames Wort im Namen
- **Oberfläche:** „Schon gebucht“ bzw. „Möglicherweise schon gebucht – bitte prüfen“, bei Gruppen Anzahl und Summe; „Nicht dieselbe“ löst die Verknüpfung. Neue Zeilen: „Ist schon gebucht als …“ zum Verknüpfen von Hand (auch mehrere Zeilen mit einer Buchung). Weicht die Summe ab, kann man den Betrag der Buchung angleichen – nur, wenn er nicht schon in Kontostand oder Restschuld steckt (wie beim Bearbeiten).
- **Gegenprobe:** Buchungen der App im Zeitraum der Datei ohne passende Zeile (Kartenimport: Käufe mit der Karte; sonst Buchungen ohne Karte außer Rücklagen und Umbuchungen).
- **Datenmodell:** Verknüpfungen in `import_links` (Migration 0014; Fingerabdruck eindeutig je Nutzer, mehrere je Buchung, gelöscht mit der Buchung, Teil der Sicherung). `transactions.import_key` bleibt für neu angelegte Buchungen.

## Nachtrag (28.09.2026): Fällige mit Buchungen von Hand verknüpfen

- „Diesen Monat fällig“ schlägt vor, wenn eine offene Fälligkeit schon von Hand gebucht aussieht (gleicher Abgleich wie beim Import: gleicher Betrag bis 3 Tage oder ähnlicher Name mit etwas anderem Betrag): „Schon von Hand gebucht? … Verknüpfen“. Im Bearbeiten (✎) lässt sich jede eigene Buchung des Monats wählen.
- Beim Übernehmen wird nichts neu angelegt: die Buchung bekommt Art, Herkunft und Kategorie der Fälligkeit (Name bleibt), Tag und Betrag der Buchung gelten – auch für Restschuld, Rücklage und das Stand-Datum (`applyDueLinks`, `POST /api/due/:month/book` mit `links`). Nur Buchungen der Art „normal“ ohne Herkunft, jede einmal. Löschen der Buchung macht es wie gewohnt rückgängig.
- **In mehreren Teilen** (28.09.2026): Eine Fälligkeit kann mit mehreren eigenen Buchungen verknüpft werden (z. B. Strato 72 € als 2 × 36 €). Vorschlag bei ähnlichem Namen, wenn die Summe passt (`suggestDueLinks`), sonst die Buchung mit dem nächsten Betrag – auch wenn er abweicht. Die erste Buchung steht in `booked_items`, die weiteren in `booked_item_parts` (Migration 0015); als gebucht gilt die Summe. Wird ein Teil gelöscht, wird die ganze Verknüpfung gelöst (Wirkung auf Restschuld/Rücklage zurück, die übrigen Teile sind wieder eigene Buchungen).
- **Eine Buchung für mehrere Fälligkeiten** (28.09.2026): z. B. 72 € von Hand gebucht, in den Fixkosten 30 € und 42 €. Dieselbe Buchung kann bei mehreren Fälligkeiten stehen (jeweils allein); sie wird aufgeteilt: die weiteren Fälligkeiten bekommen eine neue Buchung mit ihrem geplanten Betrag (Tag und „Bezahlt mit“ der eigenen Buchung), die erste behält die eigene Buchung mit dem Rest (72 − 42 = 30 €). Vorschlag, wenn der Betrag die Summe mehrerer Fälligkeiten mit ähnlichem Namen ist; „Verknüpfen“ übernimmt ihn bei allen.
