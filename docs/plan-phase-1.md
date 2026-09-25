# Plan Phase 1

Stand: 25.09.2026, freigegeben. Grundlage: `docs/auftrag-phase-1.md`, `docs/konzept.md`, `prototype/index.html`.

## 1. Versionen und Werkzeuge

Geprüft per `npm view` am 25.09.2026. Vor jedem Schritt wird die offizielle Doku (Context7 bzw. Hersteller-Doku) zur jeweiligen API herangezogen.

| Paket                                       | Version                    | Anmerkung                                                                                                                               |
| ------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node                                        | **24 LTS** (neu: `.nvmrc`) | Lokal ist 22.22.0 installiert, Angular CLI 22 verlangt ≥ 22.22.3 → Update nötig                                                         |
| pnpm                                        | 12.x                       | `packageManager` im Root-`package.json`                                                                                                 |
| TypeScript                                  | **6.0.x**                  | 7.0 ist aktuell, aber Angular 22 und typescript-eslint erlauben nur `<6.1`                                                              |
| Angular / CDK                               | 22.2                       | Standalone, Signals, zoneless                                                                                                           |
| Hono                                        | 4.13                       |                                                                                                                                         |
| Drizzle ORM / Kit                           | 0.45 / 0.31                | 1.0 ist noch RC → stabile 0.45                                                                                                          |
| Better Auth                                 | 1.7                        |                                                                                                                                         |
| Wrangler                                    | 4.x                        |                                                                                                                                         |
| Zod                                         | 4.x                        |                                                                                                                                         |
| Vitest                                      | **4.1.x**                  | 5.0 ist aktuell, aber `@cloudflare/vitest-plugin` (Nachfolger von vitest-pool-workers) verlangt `^4.1` → einheitlich 4.1 im ganzen Repo |
| Playwright                                  | 1.63                       |                                                                                                                                         |
| ESLint / typescript-eslint / angular-eslint | 10 / 8.70 / 22             | Flat Config                                                                                                                             |
| Transloco                                   | 8.x                        | Laufzeit-i18n (siehe 6.)                                                                                                                |

## 2. Repo-Struktur

```
.github/workflows/ci.yml       Lint, Typecheck, Unit-, Integrations- und E2E-Tests
apps/
  backend/
    src/
      index.ts                 Hono-App, Export für den Worker (fetch + Static Assets)
      auth.ts                  Better-Auth-Instanz pro Request (D1-Binding aus env)
      db/schema.ts             Drizzle-Schema (fachliche Tabellen + Better-Auth-Tabellen)
      db/scoped.ts             Datenzugriff, der user_id erzwingt
      middleware/              session, requireAuth, entitlement, cors, rateLimit, error
      routes/                  eine Datei je Ressource
      services/                bookDue, categories, exportImport, snapshots
    migrations/                von drizzle-kit erzeugt, versioniert
    scripts/seed.ts            legt deinen Account + Beispieldaten an
    test/                      Integrationstests (@cloudflare/vitest-plugin, lokale D1)
    wrangler.jsonc
  web/
    src/app/
      core/                    ApiClient, AuthService, i18n, Theme, Formatierung (Cent → €)
      shared/ui/               eigene kleine Bausteine: Panel, Liste, Segmented Control, Betragsfeld, Dialog
      features/overview|transactions|recurring|loans|assets|auth
    public/i18n/de.json, en.json
    e2e/                       Playwright
packages/
  shared/
    src/money.ts               Cents, Parsing/Rundung
    src/month.ts               YearMonth ('YYYY-MM'), Monatsarithmetik
    src/schemas/               Zod-Schemas (Eingaben und Ausgaben der API, Export-Format)
    src/domain/                recurring, reserve, overview, loans, dueBooking, netWorth, categories
    test/                      Vitest, bildet das Verhalten des Prototyps nach
CLAUDE.md, README.md, docs/
```

Root-Skripte: `dev` (API via `wrangler dev` mit lokaler D1 + `ng serve` mit Proxy auf `/api`, parallel), `test`, `test:e2e`, `lint`, `format`, `typecheck`, `build`, `db:migrate` (lokal, `--remote` für Produktion), `db:seed`, `deploy`.

## 3. Fachlogik in `packages/shared`

Reine Funktionen ohne I/O und ohne Framework. Alle Beträge als ganze Cent-Werte, Zinsen in Basispunkten, Monate als `YearMonth`-String. „Heute“ wird immer als Parameter übergeben (testbar, zeitzonenunabhängig).

| Modul        | Funktionen                                                                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recurring`  | `monthlyShare(item)` (Betrag / Rhythmus, exakt als Bruch; gerundet erst für die Anzeige), `isDue(item, month)`, `viaReserve(item)`, `nextDueMonth(item, from)`                                                                                           |
| `reserve`    | `reserveNeed(items, potId)`, `reserveMonthlyAmount(pot, items)` (eigener Betrag oder aufgerundeter Bedarf), `reserveForecast(pot, items, balance, month, alreadyBookedThisMonth)` über 12 Monate, `reserveWarnings(...)` (unter Bedarf, negativer Stand) |
| `overview`   | `monthlyBreakdown(...)`: Einnahmen, Fixkosten, Rücklage, Kreditraten inkl. Extra-Tilgung, Sparen, frei                                                                                                                                                   |
| `loans`      | `simulatePayoff(loans, extra, strategy)`: gemeinsame Simulation, frei werdende Raten rollen weiter, `avalanche`/`snowball`, Ergebnis: Monate, Monat je Kredit, Zinsen gesamt, `stuck` (Abbruch nach 600 Monaten wie im Prototyp)                         |
| `dueBooking` | `planDueBookings(state, month, alreadyBookedKeys, date)` → Liste von Buchungen + Kontenänderungen + Restschuld-Änderungen + Buchungsschlüssel. Die API führt den Plan nur noch aus.                                                                      |
| `netWorth`   | `netWorth(accounts, loans)`, `createSnapshot(...)`                                                                                                                                                                                                       |
| `categories` | Systemkategorien, Validierung (reservierte Namen, Duplikate ohne Groß-/Kleinschreibung)                                                                                                                                                                  |

Buchungsschlüssel (für Idempotenz): `reserve:<potId>`, `item:<itemId>`, `transfer:<itemId>`, `loan:<loanId>`.

## 4. Datenmodell (D1, Drizzle)

Alle fachlichen Tabellen haben `id` (UUID v7, im Client oder Server erzeugbar – wichtig für spätere Offline-Nutzung), `user_id` (FK auf Better-Auth-`user`, `ON DELETE CASCADE`), `created_at`, `updated_at` (Unix-ms). Index auf `user_id` bzw. zusammengesetzte Indizes für die üblichen Abfragen.

| Tabelle               | Spalten (zusätzlich)                                                                                                                                                                                                | Regeln                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `accounts`            | `name`, `kind` (`checking`, `savings`, `depot`, `other`), `balance_cents`, `sort_order`                                                                                                                             |                                                                            |
| `reserve_pots`        | `name`, `account_id` (nullable, `SET NULL`), `monthly_amount_cents` (nullable = automatisch), `is_default`                                                                                                          | genau ein Standardtopf je Nutzer (partieller Unique-Index)                 |
| `categories`          | `name`, `system_key` (nullable: `reserve`, `transfer`, `loans`)                                                                                                                                                     | Unique `(user_id, lower(name))`; Systemkategorien nicht umbenenn-/löschbar |
| `recurring_items`     | `name`, `amount_cents` (> 0), `interval_months` (1, 2, 3, 6, 12), `start_month`, `kind` (`fixed`, `saving`, `income`), `category_id`, `reserve_pot_id` (nullable → Standardtopf)                                    |                                                                            |
| `transactions`        | `date` (`YYYY-MM-DD`), `name`, `category_id`, `amount_cents` (mit Vorzeichen), `kind` (`normal`, `reserve`, `transfer`, `loan_payment`), `source_type` (`recurring_item`, `loan`, `reserve_pot`, null), `source_id` | Index `(user_id, date)`                                                    |
| `booked_items`        | `month`, `booking_key`, `transaction_id`                                                                                                                                                                            | **Unique `(user_id, booking_key, month)`**                                 |
| `loans`               | `name`, `balance_cents`, `original_cents`, `rate_bp`, `payment_cents`                                                                                                                                               |                                                                            |
| `net_worth_snapshots` | `date`, `assets_cents`, `debt_cents`, `net_cents`                                                                                                                                                                   |                                                                            |
| `user_settings`       | `extra_payment_cents`, `strategy`, `locale`, `currency`                                                                                                                                                             | Unique `user_id`                                                           |
| `entitlements`        | `plan` (`trial`, `founder`, `monthly`, `yearly`, `internal`), `status`, `trial_ends_at`, `current_period_end`, `features` (JSON), `source` (`manual`, später `stripe`, `revenuecat`), `external_ref`                |                                                                            |

Dazu die Better-Auth-Tabellen (`user`, `session`, `account`, `verification`), erzeugt mit der Better-Auth-CLI und in die Drizzle-Migrationen übernommen.

**Atomarität und Idempotenz bei „Fällige übernehmen“**: Die API liest den Stand, lässt `planDueBookings` rechnen und schreibt alles in _einem_ `db.batch()` (Buchungen, `booked_items`, `UPDATE accounts SET balance_cents = balance_cents + ?`, `UPDATE loans ...`). Klickt jemand doppelt, verletzt der zweite Batch den Unique-Index, D1 rollt ihn komplett zurück, die API antwortet mit dem aktuellen Stand. Kategorie umbenennen ist durch die ID-Referenz trivial; Kategorie löschen mit Ziel = ein Batch (Buchungen und Posten umhängen, dann löschen).

## 5. API (`apps/backend`)

Alle Routen unter `/api`, Eingaben per `@hono/zod-validator` mit Schemas aus `shared`, einheitliches Fehlerformat `{ error: { code, message, details? } }`.

| Methode                | Pfad                                 | Zweck                                                                      |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| *                      | `/api/auth/*`                        | Better Auth (E-Mail + Passwort); Registrierung nur bei `ALLOW_SIGNUP=true` |
| GET                    | `/api/me`                            | Nutzer, Einstellungen, Freigaben                                           |
| PATCH                  | `/api/settings`                      | Extra-Tilgung, Strategie, Sprache                                          |
| GET/POST, PATCH/DELETE | `/api/accounts`, `/api/accounts/:id` | Konten und Depots                                                          |
| GET/POST, PATCH/DELETE | `/api/reserve-pots`, `/:id`          | Rücklagentöpfe (Oberfläche nutzt nur den Standardtopf)                     |
| GET/POST               | `/api/categories`                    |                                                                            |
| PATCH                  | `/api/categories/:id`                | umbenennen                                                                 |
| DELETE                 | `/api/categories/:id?moveTo=<id>`    | löschen; `moveTo` Pflicht, wenn verwendet (sonst 409)                      |
| GET/POST, PATCH/DELETE | `/api/recurring-items`, `/:id`       |                                                                            |
| GET                    | `/api/transactions?month=YYYY-MM`    |                                                                            |
| GET                    | `/api/transactions/months`           | Monate mit Buchungen (Monatsauswahl)                                       |
| POST, PATCH/DELETE     | `/api/transactions`, `/:id`          |                                                                            |
| GET/POST, PATCH/DELETE | `/api/loans`, `/:id`                 |                                                                            |
| GET                    | `/api/due/:month`                    | fällige Posten mit Status offen/gebucht                                    |
| POST                   | `/api/due/:month/book`               | Fällige übernehmen (atomar, idempotent)                                    |
| GET/POST, DELETE       | `/api/snapshots`, `/:id`             | POST nimmt den Stand serverseitig auf                                      |
| GET                    | `/api/export`                        | alle Nutzerdaten als JSON mit Formatversion                                |
| POST                   | `/api/import`                        | ersetzt alle Nutzerdaten atomar; Schema-Validierung                        |
| GET                    | `/api/health`                        | ohne Login                                                                 |

Middleware-Kette: Request-ID und Fehlerbehandlung → Security-Header → CORS (Allowlist aus `ALLOWED_ORIGINS`) → Session laden → `requireAuth` → `requireEntitlement(feature)` (Testphase aktiv _oder_ Abo aktiv; die Stelle für Stripe/RevenueCat ist ein Interface `EntitlementProvider`, in Phase 1 nur `manual`).

**Mandantentrennung**: Routen greifen nie direkt auf Tabellen zu, sondern nur über `scoped(db, userId)`, das jede Abfrage und jeden Schreibzugriff mit `user_id` versieht; fremde IDs führen zu 404. Fremdschlüssel innerhalb eines Requests (z. B. `category_id` in einer Buchung) werden ebenfalls auf Zugehörigkeit geprüft. Integrationstests mit zwei Nutzern prüfen für **jede** Route Lesen, Ändern und Löschen fremder Daten.

**Sicherheit**: Cookies `HttpOnly`, `Secure`, `SameSite=Lax`; Rate-Limit für Login über das Workers-Rate-Limiting-Binding plus Better-Auth-eigenes Limit; Secrets nur in `.dev.vars` (mit `.dev.vars.example` im Repo) und `wrangler secret`; D1 mit EU-Jurisdiktion angelegt (genaue Option prüfe ich in der aktuellen Cloudflare-Doku).

## 6. Web-App (`apps/web`)

- Angular 22, Standalone, Signals, zoneless, `strict` + strikte Templates, Reactive Forms (typed).
- Datenzugriff über einen `ApiClient` mit konfigurierbarer Basis-URL (`environment` bzw. Laufzeit-Config für Capacitor). Berechnungen (Übersicht, Vorschau, Tilgung) laufen im Client mit denselben Funktionen aus `shared` → sofortige Reaktion z. B. beim Ändern der Extra-Tilgung. Schreibende Vorgänge mit Fachwirkung (Fällige übernehmen, Kategorien) entscheidet der Server.
- **i18n**: Transloco (Laufzeit, eine Build-Variante, Sprachwechsel ohne Neuladen, passt zu Capacitor). Zahlen und Daten über `Intl` mit der gewählten Locale. Deutsch vollständig, Englisch als Datei angelegt.
- **Mobile first**: untere Navigation mit fünf Bereichen wie im Prototyp, `env(safe-area-inset-*)`, Hell/Dunkel/System, Farben des Prototyps als CSS-Variablen, sichtbarer Fokus, Kontrast AA, Beschriftungen für alle Eingaben, `prefers-reduced-motion`.
- **PWA** über `@angular/pwa` (Manifest, Service Worker für die App-Shell; API-Antworten werden nicht offline gecacht).
- **Capacitor-tauglich**: kein direkter Zugriff auf `localStorage`, Clipboard, Datei-Download usw., sondern über kleine Adapter (Web-Implementierung jetzt, native später). Auth-Service abstrahiert Cookie vs. Bearer-Token, damit in Phase 3 das Better-Auth-Bearer-Plugin genutzt werden kann.
- Die `prompt()`/`confirm()`-Dialoge des Prototyps werden zu zugänglichen Dialogen (Angular CDK Dialog).

**Ionic – Empfehlung: nein.** Capacitor funktioniert ohne Ionic. Die App besteht aus wenigen, einfachen Bildschirmen, deren Optik der Prototyp schon festlegt; Ionic würde eine eigene Designsprache, mehr Bundle-Größe und Umbau der Navigation mitbringen. Angular CDK (Dialog, A11y, Overlay) reicht als Unterbau. Falls später native Gesten oder iOS-Optik wichtig werden, lässt sich das gezielt nachrüsten.

## 7. Auslieferung

Ein einziger Worker liefert die Angular-App als **Static Assets** und beantwortet `/api/*`. Dadurch laufen Web und API auf derselben Origin: keine Third-Party-Cookies, CORS nur für lokale Entwicklung und später Capacitor. `pnpm deploy` = Build von `shared` und `web`, Remote-Migrationen, `wrangler deploy`. Anleitung (Cloudflare-Account, D1 in der EU anlegen, Secrets setzen, eigene Domain) in der README.

## 8. Reihenfolge der Schritte

Jeder Schritt endet mit grünen Tests, einem Commit und einem kurzen Bericht.

1. **Grundgerüst**: pnpm-Workspace, `.nvmrc`, TS-Basis-Config, ESLint, Prettier, Vitest, GitHub Actions, `CLAUDE.md`, README angepasst.
2. **shared: Grundlagen**: Cents, YearMonth, Zod-Schemas, Typen.
3. **shared: Posten, Rücklage, Monatsübersicht**, mit Tests anhand der Beispieldaten des Prototyps.
4. **shared: Tilgungssimulation**, mit Tests (beide Strategien, 0-%-Kredit, „nicht absehbar“, rollende Raten).
5. **shared: Fällige übernehmen (Plan) und Nettovermögen.**
6. **api: Worker, D1, Drizzle-Schema, erste Migration**, Testumgebung mit vitest-pool-workers.
7. **api: Better Auth, Session-, Auth-, Entitlement-Middleware, CORS, Rate-Limit, Seed-Befehl für deinen Account.**
8. **api: CRUD-Routen** für alle Ressourcen, inkl. Tests zur Mandantentrennung.
9. **api: Fällige übernehmen, Kategorien umbenennen/löschen, Export/Import, Beispieldaten-Seed.**
10. **web: Grundgerüst**: Angular-App, Theme, Layout mit unterer Navigation, i18n, ApiClient, Login, PWA.
11. **web: Übersicht.**
12. **web: Buchungen und Kategorien.**
13. **web: Fixkosten mit Rücklage und Vorschau.**
14. **web: Kredite.**
15. **web: Vermögen mit Verlauf und Datensicherung.**
16. **E2E-Tests** (Login, Buchung erfassen, Fällige übernehmen) und in CI aufnehmen.
17. **Deployment**: Worker mit Static Assets, `deploy`-Skript, Anleitung in der README.

## 9. Entscheidungen

1. **Startmonat** mit Jahr (`YYYY-MM`). Vor dem Startmonat ist ein Posten nie fällig.
2. **Fälligkeitstag**: Posten, Kredite und Rücklagentöpfe haben einen Tag im Monat (1–31, in kürzeren Monaten der letzte Tag; Standard 1). Die Buchung erhält dieses Datum, die Umbuchung aus der Rücklage denselben Tag wie ihr Posten. „Fällige übernehmen“ bucht im laufenden Monat nur, was bis heute fällig ist; in vergangenen Monaten alles Offene. Vor dem Übernehmen lassen sich Tag (innerhalb des Monats) und Betrag je Buchung anpassen; eine angepasste Posten-Ausgabe ändert die zugehörige Umbuchung mit.
3. **Letzte Kreditrate**: gebucht wird höchstens Restschuld plus Monatszins.
4. **Extra-Tilgung** wird bei „Fällige übernehmen“ als eigene Buchung auf den Kredit gebucht, den die Strategie gerade vorsieht, und senkt dessen Restschuld.
5. **Kategorien** sind für wiederkehrende Posten Pflicht. Kategorien sind frei pflegbar und erweiterbar; „Sparen“ ist nur eine Standardkategorie, die umbenannt oder ergänzt werden kann (z. B. „Urlaub“).
6. **Keine Rundung auf volle Euro**: Der automatische Rücklagenbetrag ist der exakte Bedarf (Summe der Umlagen), nur auf den nächsten ganzen Cent aufgerundet, weil Beträge ganze Cent sind.
7. **Stand festhalten**: höchstens ein Snapshot pro Tag, ein neuer ersetzt den des Tages.
8. **Kein Import des Prototyp-Formats**: Der Prototyp enthält nur Beispieldaten.
9. **Ordner `apps/backend`** statt `apps/api` (wie im Auftrag), weil Cloudflare mit dem Namen `api` Probleme macht. Paket `@financeanchor/backend`, Worker-Name bleibt `financeanchor`, Routen bleiben unter `/api`.
