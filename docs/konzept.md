# Konzept und Entscheidungen

## Ziel

Mehrere Excel-Listen (Fixkosten, Haushaltsbuch, Vermögen) und eine separate Kredit-App durch eine App ersetzen, die weniger Pflege braucht. Zuerst für den Eigengebrauch, später als Abo für andere.

## Funktionen (aus dem Prototyp)

- **Übersicht**: Aufteilung des Monats in Fixkosten, Rücklage, Kreditraten, Sparen und frei verfügbar. Nettovermögen, Restschuld, laufender Monat, Datum der Schuldenfreiheit.
- **Buchungen**: Haushaltsbuch mit Name und Kategorie. Kategorien frei pflegbar (anlegen, umbenennen, löschen mit Verschieben).
- **Fixkosten**: Wiederkehrende Posten mit Rhythmus (monatlich bis jährlich) und automatischer Monatsumlage.
- **Rücklage**: Nicht-monatliche Ausgaben laufen über ein Rücklagenkonto.
  - Monatlich: Rücklage als Ausgabe aufs Tagesgeld.
  - Bei Fälligkeit: Ausgabe für den Posten plus gleich hohe Einnahme als Umbuchung aus der Rücklage.
  - Gilt auch für nicht-monatliche Sparposten.
  - 12-Monats-Vorschau des Rücklagenstands mit Warnung bei Unterdeckung.
- **Kredite**: Tilgungsplan mit Extra-Tilgung und Strategie (höchster Zins zuerst oder kleinste Schuld zuerst).
- **Vermögen**: Konten und Depots manuell gepflegt, Kredite automatisch abgezogen, Stand regelmäßig festhalten für den Verlauf.
- **Fällige übernehmen**: Alle fälligen Posten des Monats mit einem Klick als Buchungen anlegen.
- Keine Bankanbindung, alle Daten werden manuell erfasst.

## Mögliche Erweiterungen

- Mehrere Rücklagentöpfe (z. B. Urlaub, Weiterbildung) mit eigenem Konto und automatisch mitgeführtem Stand
- CSV-Import aus Excel und Kontoauszügen
- Monatsauswertung mit Soll/Ist-Vergleich

## Technik

- **Frontend**: Angular als PWA, Capacitor für iOS und Android
- **Backend**: Cloudflare Workers (TypeScript, Hono), Datenbank D1 mit Drizzle
- **Auth**: Better Auth im Worker (Alternative: Clerk). Für iOS zusätzlich „Sign in with Apple“, falls Google-Login angeboten wird
- **Mandantenfähig von Anfang an**: `user_id` in jeder Tabelle, API filtert konsequent
- **Beträge** als ganze Cent-Werte speichern
- **Funktionsfreigaben** über Tarif bzw. Feature-Liste pro Nutzer statt fest „bezahlt ja/nein“

## Geschäftsmodell

- 30 Tage kostenlos testen, danach Abo
- 2,99 € pro Monat oder 24,99 € pro Jahr
- Optional Gründerpreis für die ersten Nutzer (z. B. 19,99 € pro Jahr dauerhaft)
- Web über Stripe, Apps über In-App-Käufe, gebündelt mit RevenueCat

## Phasen

1. **Für mich**: PWA, Worker-API, D1, Auth mit geschlossener Registrierung
2. **Für andere**: Registrierung öffnen, Stripe, Rechtstexte (Impressum, Datenschutz, AV-Verträge, EU-Datenstandort)
3. **Als App**: Capacitor-Builds, In-App-Abos über RevenueCat

## Offene Punkte

- Marke „FinanceAnchor“ prüfen (DPMA, EUIPO, Klassen 9 und 36), Domains sichern, App Stores prüfen
- Steuerliche Fragen (Umsatzsteuer, OSS, Kleinunternehmerregelung) mit Steuerberater klären
