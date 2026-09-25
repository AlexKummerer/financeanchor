# FinanceAnchor

Persönliche Finanz-App: Haushaltsbuch, Fixkosten mit Rücklage, Kredite, Vermögen.
Phase 1: produktionsreif für einen Nutzer, aber mandantenfähig (siehe `docs/plan-phase-1.md`).

- Fachliche Referenz: `prototype/index.html` (nicht kopieren, Verhalten nachbauen)
- Entscheidungen: `docs/konzept.md`, `docs/plan-phase-1.md` (Abschnitt „Entscheidungen“)

## Struktur

```
apps/web         Angular-PWA (noch nicht angelegt)
apps/api         Cloudflare Worker, Hono, D1, Drizzle (noch nicht angelegt)
packages/shared  Typen, Zod-Schemas, gesamte Fachlogik (reines TS, Vitest)
```

## Befehle

Node 24 (`.nvmrc`), pnpm 12.

| Befehl           | Zweck                       |
| ---------------- | --------------------------- |
| `pnpm install`   | Abhängigkeiten              |
| `pnpm test`      | alle Tests                  |
| `pnpm typecheck` | TypeScript in allen Paketen |
| `pnpm lint`      | ESLint + Prettier-Check     |
| `pnpm format`    | Prettier schreiben          |

## Konventionen

- Beträge immer als ganze Cent-Werte (`number`, Integer), Zinsen in Basispunkten. Formatierung nur in der Oberfläche.
- Monate als `YearMonth` (`'YYYY-MM'`), Tage als `'YYYY-MM-DD'`. „Heute“ wird der Fachlogik als Parameter übergeben.
- Fachlogik gehört nach `packages/shared`, ohne Framework-Abhängigkeiten und mit Tests.
- Jede fachliche Tabelle hat `id`, `user_id`, `created_at`, `updated_at`; jeder Datenzugriff ist auf die `user_id` der Session beschränkt.
- Versionen: TypeScript bleibt auf 6.0.x (Angular 22), Vitest auf 4.1.x (vitest-pool-workers).
- Commits klein, mit aussagekräftiger Nachricht auf Deutsch; vor jedem Commit `pnpm lint && pnpm typecheck && pnpm test`.
- Texte in der Oberfläche auf Deutsch (i18n-Schlüssel), Englisch vorbereitet.
