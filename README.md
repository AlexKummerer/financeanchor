# FinanceAnchor

Deine Finanzen an einem Ort – Haushaltsbuch, Fixkosten mit Rücklagen, Kredite und Vermögen in einer App.

## Status

Phase 1 im Aufbau, siehe `docs/plan-phase-1.md`.
Prototyp (Einzeldatei, speichert lokal im Browser): `prototype/index.html`.

## Entwicklung

Voraussetzungen: Node 24 (`nvm use`), pnpm 12.

```sh
pnpm install
pnpm test
pnpm lint
```

## Struktur

```
apps/
  web/        Angular-PWA, später mit Capacitor als iOS- und Android-App
  backend/    Cloudflare Worker (TypeScript, Hono) mit D1
packages/
  shared/     Gemeinsame Typen, Schemas und Fachlogik (Umlage, Rücklage, Tilgung)
prototype/    Klickbarer Prototyp als Referenz
docs/         Konzept, Auftrag und Plan
```
