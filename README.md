# FinanceAnchor

Deine Finanzen an einem Ort – Haushaltsbuch, Fixkosten mit Rücklage, Kredite und Vermögen in einer App.

Phase 1: produktionsreif für einen Nutzer, von Anfang an mandantenfähig. Details und Entscheidungen: `docs/plan-phase-1.md`.

## Aufbau

```
apps/
  web/        Angular-PWA (später mit Capacitor als iOS- und Android-App)
  backend/    Cloudflare Worker (Hono, D1, Drizzle, Better Auth) – liefert auch die Web-App aus
packages/
  shared/     Typen, Zod-Schemas und die gesamte Fachlogik (Umlage, Rücklage, Tilgung, Fällige)
prototype/    Klickbarer Prototyp als fachliche Referenz
docs/         Konzept, Auftrag und Plan
```

Ein einziger Worker beantwortet `/api/*` und liefert alles andere als statische Dateien aus. App und API laufen dadurch auf derselben Adresse; die Session liegt in einem HttpOnly-Cookie.

## Lokale Entwicklung

Voraussetzungen: Node 24 (`nvm use`), pnpm 12.

```sh
pnpm install
cp apps/backend/.dev.vars.example apps/backend/.dev.vars   # Secret eintragen: openssl rand -base64 32
pnpm db:migrate                                            # lokale D1 anlegen
pnpm db:seed -- --email du@example.com --demo              # Account mit Beispieldaten
pnpm dev                                                   # http://localhost:4200
```

| Befehl                                        | Zweck                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                    | Web (4200) und API (8787) parallel, `/api` per Proxy                                                              |
| `pnpm test`                                   | Unit-Tests (shared, web) und Integrationstests der API mit lokaler D1                                             |
| `pnpm test:e2e`                               | Playwright gegen eigene lokale D1 (einmalig: `pnpm --filter @financeanchor/web exec playwright install chromium`) |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Qualität und Build                                                                                                |
| `pnpm db:generate -- --name <name>`           | neue Migration aus dem Drizzle-Schema                                                                             |

Die Registrierung ist abgeschaltet (`ALLOW_SIGNUP=false`). Accounts entstehen über `pnpm db:seed`.

## Deployment auf Cloudflare

Einmalig:

1. **Cloudflare-Konto** mit **Workers Paid** (5 $/Monat). Das Passwort-Hashing beim Login braucht mehr CPU-Zeit, als der kostenlose Tarif (10 ms) erlaubt.
2. **Anmelden:** `pnpm --filter @financeanchor/backend exec wrangler login`
3. **Datenbank in der EU anlegen:**
   ```sh
   pnpm --filter @financeanchor/backend exec wrangler d1 create financeanchor --jurisdiction eu
   ```
   Die ausgegebene `database_id` in `apps/backend/wrangler.jsonc` eintragen und committen.
4. **Secret setzen:**
   ```sh
   openssl rand -base64 32 | pnpm --filter @financeanchor/backend exec wrangler secret put BETTER_AUTH_SECRET
   ```
5. **Adresse festlegen:** entweder die `*.workers.dev`-Adresse des Workers oder eine eigene Domain (im Dashboard unter Workers → financeanchor → Settings → Domains & Routes → Custom Domain).
6. **Rate-Limit:** `namespace_id` in `wrangler.jsonc` (`4201`) muss im Konto eindeutig sein; bei Bedarf ändern.

Deployen (auch für jedes Update):

```sh
APP_URL=https://finanzen.example.de pnpm deploy
```

Das Skript baut die Web-App, wendet neue Migrationen auf die Remote-D1 an und deployt den Worker. `APP_URL` wird als `BETTER_AUTH_URL` und `ALLOWED_ORIGINS` gesetzt; ohne gültige HTTPS-Adresse oder mit Platzhalter-`database_id` bricht es ab.

Eigenen Account anlegen (einmalig):

```sh
pnpm db:seed -- --email du@example.com --remote
```

### Datensicherung

- In der App: Vermögen → Daten → „Sicherung herunterladen“ (alle Daten als JSON) bzw. „Sicherung einlesen“.
- Zusätzlich hält D1 mit Time Travel die letzten 30 Tage vor (`wrangler d1 time-travel`).

## CI

GitHub Actions führt bei jedem Push Lint, Typecheck, alle Tests und den Build aus, danach die E2E-Tests.
