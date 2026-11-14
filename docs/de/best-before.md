# MHD-Schätzung

[← Übersicht](../../README.de.md) · [🇬🇧 English](../en/best-before.md)

[Die Tabelle](#die-tabelle) · [KI (optional)](#ki-optional) · [Benutzen](#benutzen) · [Gemerkte Schätzungen verwalten](#gemerkte-schätzungen-verwalten)

Die Integration kann dir ein Mindesthaltbarkeitsdatum vorschlagen. Es gibt zwei Quellen, und du entscheidest, welche genutzt wird (Einstellungen → Geräte & Dienste → **Larder** → **Konfigurieren**):

| Modus | Was passiert |
|---|---|
| **Aus** | Keine Schätzung, der Button ist ausgeblendet. |
| **Nur Tabelle** (Standard) | Eine eingebaute Haltbarkeits-Tabelle. Funktioniert offline, braucht keinen KI-Dienst und kostet nichts. |
| **Tabelle, sonst KI** | Zuerst die Tabelle. Hat sie zum Inhalt keinen Eintrag oder kann den Bereich nicht einordnen, wird die KI gefragt. |
| **Nur KI** | Immer die KI (braucht die Integration *AI Task*, siehe unten). |

Von dir korrigierte Werte haben immer Vorrang (siehe „Merken“).

## Die Tabelle

Über 50 Einträge für gängige Lebensmittel: Gerichte und Reste, Suppen, rohes Fleisch, Fisch, Wurst, Milchprodukte, Käse, Eier, Obst und Gemüse, Brot und Kuchen, Nudeln, Reis, Mehl, Nüsse, Kaffee, Tee, Gewürze und mehr. Zu jedem Eintrag kennt sie die Haltbarkeit im **Kühlschrank**, im **0-Grad-Fach**, im **Gefrierschrank** und im **Vorrat**. Gehört ein Lebensmittel nicht an einen Ort (z. B. Salat in den Gefrierschrank oder rohes Fleisch in den Vorrat), sagt sie das und denkt sich **kein** Datum aus.

So wird eine Dose zugeordnet:

- **Inhalt:** über Stichwörter auf Deutsch und Englisch, z. B. „Tomatensuppe“, „Penne“, „leftover chicken curry“. Der genaueste Treffer gewinnt („gekochte Eier“ schlägt „Eier“), die Reihenfolge der Wörter ist egal („Eier gekocht“ = „gekochte Eier“), und bei zusammengesetzten Wörtern zählt das Grundwort („Butterkekse“ sind Kekse, „Lachsfilet“ ist Fisch). Wird die Tabelle verbessert, werden gemerkte Tabellenwerte beim nächsten Gebrauch neu berechnet; deine eigenen Korrekturen bleiben. Bereits gesetzte MHDs an den Dosen ändern sich nicht: bei Bedarf neu schätzen (mit *Überschreiben*).
- **Lagerort:** aus dem Bereich. Zuerst ein Temperatursensor am Bereich, dann die Zeile `Storage` oder `Temperature` im [Bereichs-Label](containers.md#vorlage-für-das-bereichs-label), dann eine Temperatur im Label oder im Bereichsnamen (z. B. „ca. -18 °C“), dann Wörter wie *Kühlschrank*, *0-Grad-Fach*, *Gefrierschrank*, *Gefrierfach* (etwas weniger kalt, daher kürzer), *Vorrat*, *Keller*. Kann sie den Bereich nicht einordnen, sagt sie es, statt zu raten.
- **Vakuum** verlängert die Zeit (rund +30 % gekühlt, +50 % im Gefrierschrank und im Vorrat). Leicht verderbliche Speisen im Kühlschrank (Hack, Fisch, Wurst, Reste, Weichkäse, …) bekommen **keinen** Bonus, denn Vakuum macht sie nicht sicherer.

Die Werte sind bewusst vorsichtig gewählt und orientieren sich an gängigen Empfehlungen (etwa der USDA/FSIS-Kühllagertabelle und den Verbraucherzentralen). Es sind Faustwerte für zu Hause, **keine Garantie für Lebensmittelsicherheit**. Bei gekauften Produkten ist das aufgedruckte MHD verlässlicher. Schreibe „gekocht“ oder „geöffnet“ in den Inhalt, wenn es darauf ankommt. Ein Wert passt nicht oder ein Lebensmittel fehlt? Die Einträge stehen in `custom_components/larder/shelf_life.py`; Issues und Pull Requests sind willkommen.

## KI (optional)

Der KI-Modus nutzt die Funktion **AI Task** von Home Assistant und arbeitet deshalb mit dem KI-Dienst, den du dort eingerichtet hast (zum Beispiel Anthropic, OpenAI, Google oder ein lokales Ollama).

1. Richte in Home Assistant einen KI-Dienst mit einer *AI Task* ein (Einstellungen → Geräte & Dienste). Dafür braucht es eine Home-Assistant-Version, die die Integration AI Task enthält.
2. Wähle in den Einstellungen **Tabelle, sonst KI** oder **Nur KI**. Das Feld „KI-Aufgabe“ brauchst du nur, wenn du mehrere eingerichtet hast.

Die KI bekommt den Bereichsnamen und versteht deshalb „0-Grad-Fach“ oder „Gefrierschrank“ von selbst. Genauere Hinweise kannst du so mitgeben:

- **Temperatursensor am Bereich:** In den Bereichseinstellungen lässt sich ein Temperatursensor zuweisen. Hat er einen gültigen Wert, wird er mitgegeben (z. B. die echte Temperatur im Gefrierschrank). Auch die Tabelle nutzt ihn.
- **Label mit Beschreibung:** Weise dem Bereich ein Label zu und schreibe einen Hinweis in seine Beschreibung, z. B. „ca. -18 °C, Fleisch und Fisch“, oder nutze die [Vorlage](containers.md#vorlage-für-das-bereichs-label). Name und Beschreibung werden mitgegeben.

Gesendet werden nur der Inhaltstext, der Bereichsname mit seinen Hinweisen, Vakuum Ja/Nein und das Befüll-Datum, und zwar an den KI-Dienst, den du gewählt hast. Je nach Anbieter kann das einen kleinen Betrag kosten. Im Modus „Nur Tabelle“ wird nichts gesendet.

## Benutzen

Stelle **Vakuum** pro Dose ein und weise jede Dose einem **Bereich** zu, der den Lagerort beschreibt, z. B. „Kühlschrank“, „0-Grad-Fach“, „Gefrierschrank“ oder „Vorratskammer“. Ohne Bereich wird die Schätzung mit einem Hinweis abgelehnt.

Im Dashboard erscheint der Button **MHD schätzen**, sobald ein Inhalt eingetragen und das MHD leer ist. Er zeigt an, woher der Wert stammt: *Tabelle*, *KI* oder *Tabelle, von dir korrigiert* bzw. *KI, von dir korrigiert*, wenn du das Datum danach geändert hast. Den Service kannst du auch in Automationen, Skripten oder den Entwicklerwerkzeugen aufrufen:

```yaml
action: larder.estimate_best_before
target:
  entity_id: date.dose_34ol_best_before
data:
  apply: true       # false: nur den Vorschlag zurückgeben
  overwrite: false  # true: auch schätzen, wenn schon ein Datum gesetzt ist
response_variable: result
```

Das Ergebnis enthält `best_before`, `days`, `tip` (ein kurzer Lagertipp), `source` (`table`, `ai` oder `learned`), `basis` (bei der Tabelle: erkanntes Lebensmittel und Ort), `cached` und `applied`. Gezählt wird ab **Befüllt am** (oder ab heute, wenn das leer ist). **Ein bereits gesetztes MHD wird nie überschrieben**, außer du setzt `overwrite`.

**Merken.** Jedes Ergebnis wird für die Kombination *Inhalt + Bereich + Vakuum* gespeichert und nicht erneut berechnet oder abgefragt. Änderst du ein vorgeschlagenes Datum danach selbst, merkt sich die Integration deinen Wert für dieselbe Kombination, und er gewinnt gegen Tabelle und KI. Die Daten liegen in `.storage/larder.estimator` von Home Assistant.

**Grenzen für KI-Werte.** Eine reine KI-Schätzung wird je Lagerort begrenzt (Kühlschrank 60 Tage, 0-°C-Fach 90 Tage, Gefrierschrank 18 Monate, Vorrat 3 Jahre, unbekannter Ort 1 Jahr); der Tipp nennt die Begrenzung. KI-Schätzungen, die du nie korrigiert hast, werden nach 12 Monaten neu abgefragt (ist die KI nicht erreichbar, gilt der alte Wert weiter). Tabellenwerte und deine eigenen Korrekturen werden durch diese Vorgaben nie begrenzt oder erneuert. Eine eigene Grenze pro Bereich setzt du im [Bereichs-Label](containers.md#vorlage-für-das-bereichs-label) (`Max storage: 3 years`); sie gilt für Tabellen- und KI-Werte.

## Gemerkte Schätzungen verwalten

Administratoren öffnen die Liste im Dashboard über **⚙ → Gemerkte Schätzungen**. Sie listet alles, was für eine Kombination aus Inhalt, Bereich und Vakuum gemerkt ist, samt Quelle (Tabelle, KI oder von dir korrigiert mit ursprünglicher Quelle). Dort kannst du

- **Tage und Tipp** eines Eintrags ändern (er gilt dann als von dir korrigiert),
- einen Eintrag **löschen**; die nächste Schätzung für diese Kombination wird dann neu berechnet (Tabelle oder KI),
- einen **eigenen Eintrag** für eine Kombination aus Inhalt, Bereich und Vakuum hinzufügen.

**Vorschläge aus dem Verlauf.** Larder vergleicht die gemerkten Schätzungen mit dem, was wirklich passiert ist (letzte 12 Monate, aus dem [Verlauf](dashboard.md#export-und-import)):

- mindestens zweimal **vor** dem MHD weggeworfen (und nie spät noch gegessen) → Vorschlag **kürzer**, so lange es wirklich gehalten hat (Median, abgerundet),
- mindestens zweimal **deutlich nach** dem MHD (2 Tage oder mehr) noch gegessen und nie vorher weggeworfen → Vorschlag **länger**, die kürzeste dieser Lagerzeiten, höchstens das Doppelte des bisherigen Werts.

Die Vorschläge stehen oben in der Liste mit **Übernehmen** oder **Ignorieren**; nichts wird von selbst geändert. Ein ignorierter Vorschlag kommt erst wieder, wenn sich der vorgeschlagene Wert ändert. Leerungen ohne Antwort (gegessen / weggeworfen) zählen nicht.

Die eingebaute Tabelle selbst wird hier nicht bearbeitet. Eigene und geänderte Einträge haben nur für genau diese Kombination Vorrang vor ihr.

**Update von 0.5:** War „Per KI schätzen“ an, wird daraus **Nur KI** (wie bisher); war es aus, wird es **Nur Tabelle**.
