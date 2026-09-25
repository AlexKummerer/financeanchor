# Auftrag: FinanceAnchor – Phase 1 aufbauen

Du arbeitest im Repo `financeanchor`. Lies zuerst vollständig:

- `docs/konzept.md` – alle fachlichen und technischen Entscheidungen
- `prototype/index.html` – lauffähiger Prototyp. Er ist die **fachliche Referenz**: Berechnungen, Buchungslogik und Bildschirme sollen sich genauso verhalten. Code daraus nicht kopieren, sondern sauber neu umsetzen.

Ziel ist **Phase 1**: eine produktionsreife App für einen einzelnen Nutzer, aber von Anfang an mandantenfähig, damit später andere Nutzer, Abos und iOS/Android-Apps ohne Umbau dazukommen.

## Arbeitsweise

1. Erstelle zuerst einen **Plan** (Struktur, Datenmodell, Endpunkte, Reihenfolge der Schritte) und warte auf mein OK, bevor du Code schreibst.
2. Arbeite danach in kleinen Schritten. Nach jedem Schritt: Tests laufen lassen, einen Commit mit aussagekräftiger Nachricht anlegen, kurz berichten.
3. Wenn etwas fachlich unklar ist, frag nach statt zu raten.
4. Nutze jeweils die aktuellen stabilen Versionen der Pakete und prüfe die offizielle Doku, statt Versionen oder APIs aus dem Gedächtnis zu übernehmen.
5. Lege eine `CLAUDE.md` an mit Projektüberblick, Befehlen und Konventionen, und halte sie aktuell.

## Struktur (Monorepo mit pnpm Workspaces)

```
apps/web        Angular-PWA
apps/api        Cloudflare Worker (TypeScript, Hono), D1, Drizzle
packages/shared Gemeinsame Typen, Zod-Schemas und die komplette Fachlogik
```

Root-Skripte: `dev` (Web und API parallel, lokale D1), `test`, `lint`, `build`, `db:migrate`, `db:seed`, `deploy`.

## Fachlogik in `packages/shared`

Reines TypeScript ohne Framework-Abhängigkeiten, vollständig mit Vitest getestet. Die Tests sollen das Verhalten des Prototyps nachbilden.

- **Beträge immer als ganze Cent-Werte** (Integer), Zinsen als Basispunkte. Formatierung erst in der Oberfläche.
- **Monatsumlage**: Betrag geteilt durch Rhythmus in Monaten (1, 2, 3, 6, 12).
- **Fälligkeit**: Posten mit Startmonat und Rhythmus, fällig wenn `(monat − startmonat) mod rhythmus = 0`.
- **Rücklage** (Kernfunktion):
  - Alle ausgehenden Posten (Fixkosten und Sparen) mit Rhythmus > 1 Monat laufen über die Rücklage. Einnahmen nie.
  - Monatlicher Rücklagenbetrag = eigener Betrag des Nutzers oder, wenn nicht gesetzt, die aufgerundete Summe der Umlagen.
  - Monatlich entsteht eine Ausgabe „Rücklage“ an das Rücklagenkonto.
  - Bei Fälligkeit eines solchen Postens entstehen zwei Buchungen: die Ausgabe des Postens und eine gleich hohe Einnahme „Umbuchung aus Rücklage“.
  - Der Stand des verknüpften Rücklagenkontos wird dabei automatisch erhöht bzw. verringert.
  - 12-Monats-Vorschau des Rücklagenstands, Warnung bei negativem Stand oder wenn der eigene Betrag unter dem Bedarf liegt.
  - Datenmodell so anlegen, dass später **mehrere Rücklagentöpfe** (z. B. Urlaub, Weiterbildung) mit eigenem Konto möglich sind. In Phase 1 reicht ein Standardtopf in der Oberfläche.
- **Monatsübersicht**: Aufteilung der festen Einnahmen in Fixkosten, Rücklage, Kreditraten (inkl. Extra-Tilgung), Sparen und frei verfügbar.
- **Kredite**: Gemeinsame Tilgungssimulation aller Kredite mit Mindestraten plus Extra-Tilgung. Frei werdende Raten rollen weiter. Strategien „höchster Zins zuerst“ und „kleinste Schuld zuerst“. Ergebnis: Monate bis schuldenfrei, Datum je Kredit, Zinsen gesamt, Erkennung „nicht absehbar“ wenn Raten die Zinsen nicht decken.
- **Fällige übernehmen**: Erzeugt alle fälligen Buchungen eines Monats (Fixkosten, Einnahmen, Rücklage, Umbuchungen, Kreditraten mit Reduzierung der Restschuld um Tilgungsanteil). **Idempotent**: jeder Posten höchstens einmal pro Monat.
- **Nettovermögen**: Summe der Konten und Depots minus Restschulden. Snapshots mit Datum für den Verlauf.

## Datenmodell (D1 mit Drizzle, Migrationen versioniert)

Jede fachliche Tabelle hat `id` (UUID oder ULID), `user_id`, `created_at`, `updated_at`. Mindestens:

- `accounts` – Konten und Depots (Name, Art: Konto, Tagesgeld, Depot, Sonstiges; Stand in Cent)
- `reserve_pots` – Rücklagentöpfe (Name, verknüpftes Konto, eigener Monatsbetrag optional)
- `categories` – vom Nutzer pflegbar, plus Systemkategorien (Rücklage, Umbuchung, Kredite), die nicht umbenannt oder gelöscht werden können
- `recurring_items` – wiederkehrende Posten (Name, Betrag, Rhythmus, Startmonat, Art: Fixkosten, Sparen, Einnahme, Kategorie)
- `transactions` – Buchungen (Datum, Name, Kategorie, Betrag mit Vorzeichen, Art: normal, Rücklage, Umbuchung, Kreditrate, optionale Herkunft aus Posten oder Kredit)
- `booked_items` – welche Posten in welchem Monat schon gebucht wurden (eindeutig je Nutzer, Herkunft, Monat)
- `loans` – Kredite (Name, Restschuld, Ursprungsbetrag, Zins in Basispunkten, Rate)
- `net_worth_snapshots` – Datum, Vermögen, Schulden, netto
- `user_settings` – Extra-Tilgung, Strategie, Sprache, Währung
- `entitlements` – Tarif, Ende der Testphase, freigeschaltete Funktionen

Kategorien umbenennen ändert alle Verweise. Löschen einer verwendeten Kategorie verlangt eine Zielkategorie.

## API (`apps/api`)

- Hono auf Cloudflare Workers, alle Routen unter `/api`, Eingaben mit den Zod-Schemas aus `shared` validieren.
- **Auth mit Better Auth** (E-Mail und Passwort, Sessions per sicherem Cookie). Registrierung per Umgebungsvariable abschaltbar (`ALLOW_SIGNUP=false` in Phase 1) und ein Seed-Befehl, der meinen Account anlegt.
- Middleware erzwingt Login; **jede Abfrage ist auf `user_id` der Session beschränkt**. Schreibe Tests, die sicherstellen, dass ein Nutzer keine fremden Daten lesen oder ändern kann.
- Mehrschrittige Vorgänge (Fällige übernehmen, Kategorie umbenennen/verschieben) atomar per D1-Batch.
- Middleware für Funktionsfreigaben: prüft `entitlements` (Testphase aktiv oder Abo aktiv). In Phase 1 ist für mich alles freigeschaltet, Stripe und RevenueCat werden noch **nicht** eingebaut, nur die Stelle dafür vorbereitet.
- Export und Import aller Nutzerdaten als JSON.
- Sicherheit: CORS nur für eigene Origins, Rate-Limit für Login, keine Secrets im Repo (`.dev.vars`, Wrangler-Secrets). D1 wenn möglich mit EU-Datenstandort anlegen.

## Web-App (`apps/web`)

- Angular mit Standalone Components, Signals, strikter TypeScript-Konfiguration, Reactive Forms.
- Seiten wie im Prototyp: Übersicht, Buchungen (inkl. Kategorien verwalten), Fixkosten mit Rücklage und Vorschau, Kredite, Vermögen mit Verlauf und Datensicherung, dazu Login.
- **Mobile first** mit unterer Navigation, sichere Bereiche (`env(safe-area-inset-*)`) beachten, Hell- und Dunkelmodus, zugänglich (Kontraste, Fokus, Beschriftungen).
- Beträge und Daten im deutschen Format, **i18n für Deutsch und Englisch** von Anfang an vorbereiten (Deutsch zuerst befüllen).
- Als **PWA** installierbar. **Capacitor-tauglich** bauen: keine reinen Web-APIs ohne Fallback, API-Basis-URL konfigurierbar, Auth so gestaltet, dass sie später auch in der nativen App funktioniert.
- Optik: ruhig und klar, an den Prototyp angelehnt (Tannengrün als Akzent, eigene Farben für Fixkosten, Rücklage, Kredite, Sparen). Keine UI-Bibliothek erzwingen; schlage im Plan vor, ob Ionic sinnvoll ist.

## Qualität und Auslieferung

- Unit-Tests für die gesamte Fachlogik, Integrationstests für die API mit lokaler D1, ein paar E2E-Tests (Playwright) für Login, Buchung erfassen und Fällige übernehmen.
- ESLint und Prettier, GitHub Actions für Lint und Tests bei jedem Push.
- Seed-Skript mit den Beispieldaten aus dem Prototyp.
- Deployment auf Cloudflare (Worker für die API, Frontend als statische Assets) mit Anleitung in der README.

## Nicht in Phase 1

Stripe, RevenueCat, native App-Builds, Bankanbindung, offene Registrierung.
