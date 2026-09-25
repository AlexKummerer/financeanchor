# FinanceAnchor

Persönliche Finanz-App: Haushaltsbuch, Fixkosten mit Rücklage, Kredite, Vermögen.
Phase 1: produktionsreif für einen Nutzer, aber mandantenfähig (siehe `docs/plan-phase-1.md`).

- Fachliche Referenz: `prototype/index.html` (nicht kopieren, Verhalten nachbauen)
- Entscheidungen: `docs/konzept.md`, `docs/plan-phase-1.md` (Abschnitt „Entscheidungen“)

## Struktur

```
apps/web         Angular-PWA (Standalone, Signals, zoneless, Transloco, CDK)
apps/backend     Cloudflare Worker, Hono, D1, Drizzle, Better Auth; liefert auch die Web-App aus
packages/shared  Typen, Zod-Schemas, gesamte Fachlogik (reines TS, Vitest)
```

## Befehle

Node 24 (`.nvmrc`), pnpm 12.

| Befehl                                                            | Zweck                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                                                    | Abhängigkeiten                                                                                                                                                               |
| `pnpm test`                                                       | alle Tests                                                                                                                                                                   |
| `pnpm test:e2e`                                                   | Playwright-E2E mit eigener lokaler D1 (`apps/backend/.wrangler/e2e`, Ports 4300/8790); Browser einmalig: `pnpm --filter @financeanchor/web exec playwright install chromium` |
| `pnpm typecheck`                                                  | TypeScript in allen Paketen                                                                                                                                                  |
| `pnpm lint`                                                       | ESLint + Prettier-Check                                                                                                                                                      |
| `pnpm format`                                                     | Prettier schreiben                                                                                                                                                           |
| `pnpm db:generate -- --name <name>`                               | Drizzle-Migration aus `apps/backend/src/db/schema.ts` erzeugen                                                                                                               |
| `pnpm db:migrate`                                                 | Migrationen auf die lokale D1 anwenden (`db:migrate:remote` für Produktion)                                                                                                  |
| `pnpm db:seed -- --email <mail> [--name <n>] [--demo] [--remote]` | Account mit vollen Freigaben anlegen, `--demo` mit Beispieldaten des Prototyps; Passwort über `SEED_PASSWORD` oder verdeckte Eingabe                                         |
| `pnpm dev`                                                        | API und Web parallel (Web: http://localhost:4200, `/api` per Proxy an Port 8787)                                                                                             |
| `pnpm dev:backend`                                                | API lokal (`wrangler dev`, Port 8787)                                                                                                                                        |
| `pnpm --filter @financeanchor/backend types`                      | `worker-configuration.d.ts` nach Änderungen an `wrangler.jsonc` neu erzeugen                                                                                                 |

## Einrichtung lokal

`cp apps/backend/.dev.vars.example apps/backend/.dev.vars` und ein eigenes Secret eintragen, dann `pnpm db:migrate` und `pnpm db:seed -- --email …`.

## Konventionen

- Beträge immer als ganze Cent-Werte (`number`, Integer), Zinsen in Basispunkten. Formatierung nur in der Oberfläche.
- Monate als `YearMonth` (`'YYYY-MM'`), Tage als `'YYYY-MM-DD'`. „Heute“ wird der Fachlogik als Parameter übergeben.
- Fachlogik gehört nach `packages/shared`, ohne Framework-Abhängigkeiten und mit Tests.
- Jede fachliche Tabelle hat `id`, `user_id`, `created_at`, `updated_at`; jeder Datenzugriff ist auf die `user_id` der Session beschränkt.
- Versionen: TypeScript bleibt auf 6.0.x (Angular 22), Vitest auf 4.1.x (`@cloudflare/vitest-plugin`). pnpm hält sehr neue Releases per `minimumReleaseAge` zurück – gewollt.
- API-Tests laufen im Workers-Runtime mit lokaler D1 (`apps/backend/test`, Migrationen werden im Setup angewendet). Integration über `exports.default.fetch` aus `cloudflare:workers`.
- Datenbank: Verweise zwischen fachlichen Tabellen als zusammengesetzte Fremdschlüssel `(user_id, x_id) → (user_id, id)`; Schemaänderungen nur über neue Migrationen, nie bestehende ändern.
- Commits klein, mit aussagekräftiger Nachricht auf Deutsch; vor jedem Commit `pnpm lint && pnpm typecheck && pnpm test`.
- Texte in der Oberfläche auf Deutsch (i18n-Schlüssel), Englisch vorbereitet.
- API: Routen hinter `requireAuth` und `requireEntitlement('core')`; `/api/me` nur hinter `requireAuth`. Fehler als `AppError` werfen (Format `{ error: { code, message, details? } }`).
- D1 erlaubt höchstens 100 Parameter pro Abfrage: Mehrzeilige Inserts über `chunkedInsert`, mehrschrittige Vorgänge über `runBatch` (atomar).
- Web: Dienste mit `@Service()`, Komponenten ohne `standalone`/`OnPush`-Angabe (Standard in Angular 22), `input()`/`output()`, native Control-Flow, Reactive Forms (typed). Texte nur über Transloco-Schlüssel (`public/i18n/de.json` und `en.json` gemeinsam pflegen). Beträge über `Formatter`/`money`-Pipe.
- Web ist Capacitor-tauglich zu halten: kein direkter Zugriff auf `localStorage`, Downloads usw., sondern über `core/platform/*`; API-URLs immer mit `/api/…` (Interceptor setzt Basis-URL, Cookies bzw. später Bearer-Token).
- Icons neu erzeugen: `node apps/web/scripts/icons.mjs` (aus `public/icons/icon.svg`).
- Kein Inline-SVG direkt in Layout-Templates vor einem `router-outlet` (Seiten entstanden sonst im SVG-Namensraum und blieben unsichtbar); Icons über `fa-icon`.
- Deployment: `APP_URL=https://… pnpm deploy` (siehe README). Sicherheits-Header der statischen Dateien in `apps/web/public/_headers`; CSP ohne Inline-Skripte, daher `inlineCritical: false`.
- Kredite: Arten `installment` (Rate, optional `targetMonth`) und `deadline` (`dueDate`, `paymentMode` spread/lump). Verteilung und Simulation nur über `allocateMonth`/`planLoans` in `shared` (`docs/plan-kredite-budget.md`); die Web-App liest den Plan über `LoanPlanner`.
- drizzle-kit fragt bei Spalten-Umbenennungen interaktiv – in solchen Fällen Hinzufügen und Entfernen auf zwei Migrationen aufteilen und das erzeugte SQL prüfen.
- `ng serve` bündelt `@financeanchor/shared` nicht vor (`prebundle.exclude` in `angular.json`), sonst werden Änderungen an der Fachlogik im Dev-Server nicht übernommen. Abhängigkeiten von `shared`, die im Web-Code landen (z. B. `zod`), müssen deshalb auch in `apps/web/package.json` stehen.
- Kredit-Plan: nur tatsächliche Zahlungen (Rate, Frist-Rate bzw. Zurücklegen, eigene `extraMonthlyCents`); Ziele werden nur geprüft. „Verfügbar für Kredite“ (`loanBudgetCents`) dient ausschließlich `loanAdvice` und ändert keinen Plan: fehlt Geld, nur Aufstellung des Geplanten; ist Geld übrig, Vorschläge „meiste Zinsersparnis“ und „schnellste Entlastung“ (keine Strategie-Auswahl mehr), Ziel-Vorschläge nur, wenn sie passen.
