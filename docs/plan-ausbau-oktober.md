# Plan: Ausbau Oktober 2026

Wunsch (02.10.2026) nach den ersten Wochen im Einsatz. Reihenfolge = Umsetzung, je Punkt ein Commit.

1. **Verknüpfung lösen**: Bei gebuchten Fälligkeiten „Lösen“: Wirkung auf Rücklage/Restschuld zurück, Markierung (und Teile) entfernt, die Buchungen bleiben als eigene Buchungen („normal“, ohne Herkunft). Die Fälligkeit ist wieder offen.
2. **Vorlagen-Betrag aus dem Import**: Weicht der Betrag einer mit Fixkosten verknüpften Zeile wiederholt (mind. zweimal in Folge) von der Vorlage ab, Vorschlag „Betrag der Fixkosten auf … ändern“.
3. **Abos erkennen**: Gleicher Bank-Text in mehreren Monaten (mind. 2 von 3), ähnlicher Betrag, nicht als Fixkosten geführt → Hinweis „Sieht nach einem Abo aus – als Fixkosten anlegen?“ (vorbelegt).
4. **Prognose Monatsende**: Ein Girokonto als Hauptkonto markieren. Übersicht: Stand heute → voraussichtlich am Monatsende (offene Fälligkeiten, Kartenabbuchungen, Rücklage, Umbuchung).
5. **Budgets je Kategorie**: Monatsbetrag je Kategorie, jeder Monat neu (kein Übertrag). Anzeige ausgegeben/übrig, Hinweis bei Überschreitung.
6. **Monatsabschluss**: Checkliste für einen Monat – alles Fällige übernommen, Karten abgeglichen, Umbuchung gebucht, Budgets, Vermögensstand festgehalten.
7. **Buchungsliste**: Suche (Name, Kategorie, Betrag) und Mehrfach-Löschen.
8. **Erinnerungen (Web Push)**: fällige Posten (morgens), Kartenabrechnung (Stichtag), Monatsabschluss (letzter Tag), Budget überschritten. Worker-Cron, VAPID-Schlüssel als Secret, Abo je Gerät in den Einstellungen.

Entscheidungen des Nutzers: Prognose für ein wählbares Hauptkonto; Budgets ohne Übertrag; alle vier Erinnerungsarten.
