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
pnpm db:seed --email du@example.com --demo              # Account mit Beispieldaten
pnpm dev                                                   # http://localhost:4200
```

| Befehl                                        | Zweck                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                    | Web (4200) und API (8787) parallel, `/api` per Proxy                                                              |
| `pnpm test`                                   | Unit-Tests (shared, web) und Integrationstests der API mit lokaler D1                                             |
| `pnpm test:e2e`                               | Playwright gegen eigene lokale D1 (einmalig: `pnpm --filter @financeanchor/web exec playwright install chromium`) |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Qualität und Build                                                                                                |
| `pnpm db:generate --name <name>`              | neue Migration aus dem Drizzle-Schema                                                                             |

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
pnpm db:seed --email du@example.com --remote
```

### Automatisches Deployment über GitHub

Jeder Push auf `main` deployt automatisch, **nachdem** Lint, Tests und E2E in der CI grün sind (Job `deploy` in `.github/workflows/ci.yml`, führt `pnpm run deploy` aus).

Einmalig einrichten:

1. **API-Token** im Cloudflare-Dashboard: Mein Profil → API-Tokens → Token erstellen → Vorlage „Cloudflare Workers bearbeiten“, zusätzlich Berechtigung **Konto → D1 → Bearbeiten**; auf das eigene Konto beschränken.
2. In GitHub unter Settings → Secrets and variables → Actions:
   - Secret `CLOUDFLARE_API_TOKEN` = der Token aus Schritt 1
   - Secret `CLOUDFLARE_ACCOUNT_ID` = Konto-ID (`wrangler whoami`)
   - Variable `APP_URL` = öffentliche Adresse, z. B. `https://financeanchor.alexander-122.workers.dev`
3. Eine direkte GitHub-Verbindung im Cloudflare-Dashboard (Workers Builds) wieder trennen, damit nicht zusätzlich ohne Tests deployt wird.

Von Hand geht es weiterhin mit `APP_URL=… pnpm run deploy`.

### Anmelden mit Google, Microsoft oder Apple (optional)

Ein Anbieter erscheint auf der Login-Seite, sobald seine Zugangsdaten als Secrets gesetzt sind (lokal in `apps/backend/.dev.vars`). Neue Konten entstehen darüber nicht: Man meldet sich einmal mit E-Mail und Passwort an und verbindet den Anbieter unter **Einstellungen → Konto → Anmelden mit**. Eine automatische Verknüpfung über die gleiche E-Mail-Adresse gibt es bewusst nicht.

Rücksprung-Adresse beim Anbieter: `<APP_URL>/api/auth/callback/<google|microsoft|apple>`, lokal `http://localhost:8787/api/auth/callback/<…>`.

- **Google:** [Google Cloud Console](https://console.cloud.google.com/) → APIs & Dienste → OAuth-Zustimmungsbildschirm (Extern; im Testmodus die eigene Adresse als Testnutzer eintragen) → Anmeldedaten → OAuth-Client-ID (Webanwendung) mit obiger Rücksprung-Adresse. Secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **Microsoft:** [Microsoft Entra](https://entra.microsoft.com/) → App-Registrierungen → Neue Registrierung, Kontotyp „Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“, Plattform „Web“ mit obiger Rücksprung-Adresse → Zertifikate & Geheimnisse → neuer geheimer Clientschlüssel (läuft ab, rechtzeitig erneuern). Secrets `MICROSOFT_CLIENT_ID` (Anwendungs-ID), `MICROSOFT_CLIENT_SECRET` (Wert des Schlüssels).
- **Apple:** braucht das Apple Developer Program (99 $/Jahr) und eine HTTPS-Domain – lokal nicht testbar. Im [Developer-Portal](https://developer.apple.com/account/resources/identifiers/list): App-ID mit „Sign in with Apple“, dazu eine **Services-ID** (= `APPLE_CLIENT_ID`) mit Domain (ohne `https://`) und obiger Rücksprung-Adresse; unter Keys einen Schlüssel mit „Sign in with Apple“ anlegen und die `.p8`-Datei herunterladen (nur einmal möglich). Secrets `APPLE_CLIENT_ID`, `APPLE_TEAM_ID` (oben rechts im Portal), `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (Inhalt der `.p8`-Datei; in `.dev.vars` Zeilenumbrüche als `\n`).

Secrets setzen, z. B.:

```sh
cd apps/backend
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put APPLE_PRIVATE_KEY < AuthKey_ABC123.p8
```

### Datensicherung

- In der App: Vermögen → Daten → „Sicherung herunterladen“ (alle Daten als JSON) bzw. „Sicherung einlesen“.
- Zusätzlich hält D1 mit Time Travel die letzten 30 Tage vor (`wrangler d1 time-travel`).

## CI

GitHub Actions führt bei jedem Push Lint, Typecheck, alle Tests und den Build aus, danach die E2E-Tests.
