# FinanceAnchor

Deine Finanzen an einem Ort – Haushaltsbuch, Fixkosten mit Rücklagen, Kredite und Vermögen in einer App.

## Status

Prototyp (Einzeldatei, speichert lokal im Browser): `prototype/index.html`
Zum Ausprobieren einfach im Browser öffnen.

## Geplante Struktur

```
apps/
  web/        Angular-PWA, später mit Capacitor als iOS- und Android-App
  api/        Cloudflare Worker (TypeScript, Hono) mit D1
packages/
  shared/     Gemeinsame Typen und Berechnungen (Umlage, Rücklage, Tilgung)
prototype/    Klickbarer Prototyp als Referenz
docs/         Konzept und Entscheidungen
```

Siehe `docs/konzept.md`.
