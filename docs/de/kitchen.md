# Rezepte, Zusammenfassung, Wochenplan und Einkauf

[← Übersicht](../../README.de.md) · [🇬🇧 English](../en/kitchen.md)

[Rezepte](#rezepte) · [Tägliche Zusammenfassung](#tägliche-zusammenfassung) · [Wochenplan](#wochenplan) · [Einkaufsliste](#einkaufsliste) · [MHD im Kalender](#mhd-im-kalender)

## Rezepte

Alle Rezeptfunktionen nutzen die Home-Assistant-Integration **AI Task** (dieselbe wie für die [KI-Schätzung](best-before.md#ki-optional)); der Schätzmodus spielt keine Rolle. Je nach Anbieter kann jede Anfrage einen kleinen Betrag kosten, und ohne Knopfdruck oder Automation wird nichts gesendet.

### Rezeptideen

Die KI schlägt Gerichte vor, die aufbrauchen, was bald abläuft.

**Im Dashboard** (Administratoren): auf der Seite **Rezepte** auf **✨ Aus Resten** tippen. Darüber wählst du den Zeitraum (die Vorgabe kommt aus **Konfigurieren** → *Zeitraum für Rezeptideen*, ab Werk 3 Tage; eine feste Zahl von Tagen; oder **Alle Dosen**, dann zählen auch Dosen ohne MHD) und optional die Zahl der Personen. Du bekommst bis zu drei Rezepte mit den verwendeten Dosen, zusätzlichen Zutaten (nur gängige Vorräte), Dauer und kurzen Schritten und kannst gelungene ins [Rezeptbuch](#rezeptbuch) **speichern**. Abgelaufene Dosen und Dosen ohne Inhalt werden nie verwendet.

**In Automationen:** Der Service `larder.suggest_recipes` liefert dasselbe.

```yaml
action: larder.suggest_recipes
data:
  days: 3        # Dosen, die innerhalb von 3 Tagen ablaufen (weglassen = Zeitraum aus den Einstellungen)
  # all_containers: true   # kein Zeitraum: alle befüllten Dosen
  # containers: [device_id, …]   # genau diese Dosen
  servings: 2    # optional, Standard 2 Personen
  max_recipes: 3 # 1 bis 5
response_variable: ideas
# ideas.recipes (title, minutes, uses, extra_ingredients, steps), ideas.summary (Text),
# ideas.ingredients (die verwendeten Dosen), ideas.count
```

**In der täglichen Benachrichtigung:** Das [Blueprint](#tägliche-zusammenfassung) hat den Schalter **Add recipe ideas** („Rezeptideen anhängen“). Die Rezepte werden an die Nachricht angehängt; fällt die KI aus, kommt die normale Nachricht trotzdem. Importiere das Blueprint neu, um den Schalter zu bekommen.

An den gewählten KI-Dienst gehen nur Inhalt, Menge mit Einheit, Resttage und Lagerort (Bereichsname), nie Dosennamen, IDs oder anderes. Die Vorschläge sind Ideen eines Sprachmodells, keine getesteten Rezepte: Prüfe, ob das Essen noch bedenkenlos genießbar ist, besonders bei Aufgetautem oder Älterem.

**Aus gewählten Dosen:** Dosen auswählen und **✨ Rezeptideen** drücken, siehe [Mehrere Dosen auswählen](dashboard.md#mehrere-dosen-auswählen). In Automationen dient dazu `containers` mit den Geräte-IDs.

### Rezeptbuch

Die Seite **Rezepte** ist dein eigenes Rezeptbuch (liegt in Home Assistant unter `.storage/larder.recipes`). Alle dürfen es lesen, Administratoren legen Rezepte an (**＋**), ändern und löschen sie. Sortierung nach neueste oder Name; Antippen zeigt Zutaten und Schritte.

**Rezept aus Foto oder Datei** (📷, Administratoren): Fotografiere ein Rezept aus einem Kochbuch oder von einer Karte, wähle bis zu vier Fotos (z. B. zwei Seiten) oder ein PDF. Die KI liest das Rezept, übersetzt es bei Bedarf in deine Sprache und öffnet es zum **Prüfen**; gespeichert wird erst, wenn du auf *Speichern* tippst. Dafür muss die gewählte KI-Aufgabe Anhänge unterstützen (z. B. Anthropic, OpenAI, Google). Fotos werden vor dem Hochladen verkleinert, liegen nur während des Lesens kurz im Medienordner von Home Assistant (`media/larder/recipe_photos`) und werden danach gelöscht. Gesendet wird nur das Foto bzw. die Datei, an den KI-Dienst, den du gewählt hast.

## Tägliche Zusammenfassung

Das mitgelieferte Blueprint schickt eine **tägliche Zusammenfassung** dessen, was bald abläuft. Läuft nichts ab, kommt nichts. Abgelaufene Dosen werden mit ihrem Dosennamen und dem Hinweis **sollte geleert werden** genannt, damit du weißt, welche du ausräumen musst. Dosen, die für ein [geplantes Gericht](#wochenplan) aufgetaut werden müssen, kommen zuerst, mit dem Knopf **Aufgetaut**. Für diesen Knopf das Blueprint neu importieren.

[![Blueprint importieren](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fyan14%2Fha-larder%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Flarder%2Fexpiry_notification.yaml)

| Option | Wirkung |
|---|---|
| **Push notification** | Eine oder mehrere notify-Aktionen, durch Komma getrennt (`notify.mobile_app_dein_iphone, notify.mobile_app_partner`), oder eine notify-Gruppe. Leer lassen für nur Sprache. |
| **Buttons in the push** | **Rezepte** öffnet die Rezeptseite des Dashboards, **Dashboard** öffnet Larder. Antippen der Benachrichtigung selbst öffnet ebenfalls das Dashboard. |
| **Voice output** | notify-Aktionen, die die Zusammenfassung vorlesen, z. B. `notify.alexa_media_kueche` (Alexa Media Player) oder eine Gruppe von Lautsprechern. Der Sprechtext ist zum Zuhören gemacht: „Heute läuft Lachs ab. Morgen läuft Gouda ab. Pizza in Dose 3 ist abgelaufen und sollte geleert werden.“ (höchstens sechs Dosen, der Rest wird gezählt). Mit Rezeptideen kommt „Idee: …“ dazu. |
| **Voice options** | Zusatzdaten für die Sprachausgabe. Alexa Media Player braucht den Typ, z. B. `type: announce` (mit Gong) oder `type: tts`. |
| **Speak only when someone is home** | Personen, Gruppen oder Zonen; ist niemand zu Hause, entfällt die Sprachausgabe. Der Push kommt immer. |
| **Time** und **Motion sensors** | Ohne Bewegungsmelder kommt die Zusammenfassung zur Uhrzeit. Mit Bewegungsmeldern (z. B. Küche) kommt sie bei der **ersten Bewegung nach dieser Uhrzeit**, einmal am Tag, und spätestens zur **Latest time**, falls niemand vorbeikam. |
| **Days ahead**, **Include expired**, **Add recipe ideas** | Wie bisher. Rezeptideen brauchen die Integration *AI Task*; fällt die KI aus, kommt die Nachricht trotzdem. |

Bestehende Automationen laufen weiter; importiere das Blueprint neu, um die neuen Optionen zu bekommen. Die Namen der Optionen sind englisch, die Nachrichten kommen in der Sprache von Home Assistant.

**Ohne Blueprint:** Der Service `larder.get_expiring` liefert dieselben Daten für eigene Automationen:

```yaml
action: larder.get_expiring
data:
  days: 3               # Dosen, die innerhalb von 3 Tagen ablaufen (Standard: „Läuft bald ab“ aus den Einstellungen)
  include_expired: true
response_variable: result
# result.count, result.expired, result.summary (Text mit Aufzählung für den Push),
# result.speech (Sätze zum Vorlesen), result.labels (Texte der Knöpfe),
# result.items (name, content, quantity, unit, area, best_before, days_left, status)
```

Auch `larder.suggest_recipes` liefert `speech` („Idee: …“). Für eigene Dashboards gibt es außerdem den Sensor **Tage bis MHD** an jeder Dose.

### Monatsbericht

Ein zweiter Blueprint schickt am gewählten Tag einen **Monatsbericht** für den Vormonat: befüllte und geleerte Dosen, gegessen und weggeworfen, der Anteil Weggeworfenes im Vergleich zum Vormonat was am häufigsten weggeworfen wurde und – bei Packungen mit Preis – ca. wie viel Euro. Als Push (Antippen öffnet die Statistik) und optional als Sprachausgabe. Für einen Monat ohne Bewegung wird nichts geschickt. Derselbe Bericht steht oben in der [Statistik](dashboard.md#statistik) und kommt vom Dienst `larder.get_monthly_report` (`month`: `JJJJ-MM`, Standard: Vormonat).

[![Blueprint importieren](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fyan14%2Fha-larder%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Flarder%2Fmonthly_report.yaml)

### Bald leer und Rückrufe

Ein dritter Blueprint schickt einen Push, wenn ein Produkt [bald leer](containers.md#vorrat) ist und wenn eine [Rückrufwarnung](containers.md#rückrufwarnungen) zu etwas im Vorrat passt; beides lässt sich einzeln ein- und ausschalten. Antippen öffnet die Startseite von Larder. Die Ereignisse `larder_running_low` (`name`, `count`, `min`, `lasts_days`, `message`) und `larder_recall` (`title`, `reason`, `link`, `products`, `places`, `message`) gehen auch für eigene Automationen.

[![Blueprint importieren](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fyan14%2Fha-larder%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Flarder%2Fstock_alerts.yaml)

## Wochenplan

Ein Gericht für einen Tag einplanen: **📅 Einplanen** an einer Rezeptidee oder einem Rezept aus dem Buch (auch für Nicht-Administratoren). Der Dialog fragt das Gericht, den Tag (vorbelegt: morgen) und die **Dosen**, die dafür gebraucht werden; Dosen, deren Inhalt im Rezept vorkommt, sind schon angehakt.

- Die **Startseite** zeigt, was in den nächsten sieben Tagen geplant ist, die **Rezeptseite** alle Pläne (✕ nimmt einen heraus).
- Mit einem **Kalender für den Wochenplan** in den [Einstellungen](reference.md#einstellungen) wird jeder Plan zusätzlich ein ganztägiger Termin „🍽 Spaghetti Bolognese“; wird der Plan gelöscht, verschwindet auch der Termin.
- **✓ Gekocht** an einem Plan nimmt aus jeder seiner Dosen eine Portion (wenn sie mehr als eine hat) oder leert sie als gegessen und nimmt den Plan aus der Liste.
- **Fehlende Zutaten:** Der Dialog übernimmt auch die Zutaten des Rezepts. Was in keiner deiner Dosen steckt, steht am Plan; **🛒 n fehlen → Einkaufsliste** setzt es auf die [Einkaufsliste](#einkaufsliste) (was dort schon offen ist, kommt nicht doppelt).

**Auftau-Erinnerung.** Steht eine Dose, die ein geplantes Gericht braucht, im **Gefrierschrank** (nach Name oder Label des Bereichs), erinnert Larder rechtzeitig daran, sie in den Kühlschrank zu stellen, standardmäßig am Vortag (Einstellung **Auftauen: Tage vorher**, 0–3):

- auf der Startseite unter **🧊 Zum Auftauen in den Kühlschrank**, mit dem Knopf **✓ Aufgetaut**,
- in der [täglichen Zusammenfassung](#tägliche-zusammenfassung) als erste Zeilen („🧊 Bolognese-Sauce (Dose 4) für Spaghetti Bolognese, morgen“) und in der Sprachausgabe; die Push-Nachricht bekommt den Knopf **Aufgetaut**. Dafür wird die Zusammenfassung auch geschickt, wenn nichts abläuft.

**Aufgetaut** wirkt wie der Knopf **Aufgetaut** auf der Karte (kürzt das MHD) und stellt [variable Dosen](containers.md#dosen-befüllen) in den Kühlschrank, wenn es genau einen Kühlschrank-Bereich gibt.

## Einkaufsliste

**Mal wieder …?** Die Startseite schlägt vor, was du in den letzten 90 Tagen mindestens dreimal gegessen hast, aber gerade in keiner Dose und keiner Packung ist („Bolognese, 4× gegessen …“). **🛒 Einkaufsliste** setzt es auf die Liste, **✕** blendet den Vorschlag 30 Tage aus.

Unter Einstellungen → Geräte & Dienste → **Larder** → **Konfigurieren** kannst du eine **To-do-Liste** von Home Assistant wählen, z. B. die eingebaute *Einkaufsliste*, Todoist oder Bring!. Jede Dose hat dann ein Häkchen **Beim Leeren auf die Einkaufsliste** (der Schalter `Einkaufsliste`, standardmäßig aus). Drückst du bei einer Dose mit gesetztem Häkchen **Behälter leeren**, wird ihr Inhalt auf die Liste gesetzt, z. B. „Basmati“.

- **Marke und Packung:** Sind sie bekannt (z. B. nach einem [Strichcode-Scan](containers.md#dosen-befüllen)), kommen sie mit auf die Liste: „Haferflocken (Kölln, 500 g)“. Ein offenes „Haferflocken“ gilt als derselbe Eintrag und kommt nicht doppelt. Abschaltbar in den Einstellungen; bei mehreren Inhalten („Salami, Leberwurst“) kommen nur die Namen.
- Nicht alles gehört auf die Liste: Reste wie „Pizza-Reste“ lässt du einfach ohne Häkchen, sie werden nie eingetragen. Die Einstellung gehört zur Dose und bleibt beim Leeren erhalten. So wird Reis immer nachgekauft und Pizza nie.
- Steht ein Eintrag schon offen auf der Liste, wird er nicht doppelt angelegt. Bereits abgehakte Einträge zählen nicht, du kannst dasselbe also erneut einkaufen.
- Ohne gewählte Liste passiert nichts, und das Häkchen ist ausgeblendet. Ist die Liste nicht erreichbar, wird die Dose trotzdem geleert.
- Geplant: mehrere Ziel-Listen (z. B. Metzger und Supermarkt) und auch abgelaufene Dosen einzutragen.

## MHD im Kalender

Unter Einstellungen → Geräte & Dienste → **Larder** → **Konfigurieren** kannst du einen vorhandenen **Kalender** wählen (Google, CalDAV, *Lokaler Kalender* …). Jede Dose bekommt dann einen Ganztags-Termin „MHD: Pizza“ am Tag des MHD. Der Termin wird angelegt, sobald ein Datum gesetzt ist, verschoben, wenn sich Datum oder Inhalt ändern, und gelöscht, wenn das Datum gelöscht, die Dose geleert oder entfernt oder ein anderer Kalender gewählt wird. Eigene Termine werden an einer Kennung in der Beschreibung erkannt, andere Termine werden nie angefasst.

**Aufräumen.** Bei jedem Start und beim Speichern der Einstellungen prüft Larder den ganzen Kalender, behält pro Dose genau einen Termin und entfernt Doppelte. Der Dienst `larder.rebuild_calendar` macht das auf Knopfdruck und entfernt zusätzlich Termine von Dosen, die es nicht mehr gibt. Mit `include_unmarked: true` werden außerdem Termine „MHD: …“ / „Best before: …“ ohne Larder-Kennung entfernt (für Kalender, die die Beschreibung verwerfen) und neu angelegt.

Der Kalender muss Termine anlegen **und** löschen können. Reine Lese-Kalender (z. B. ein iCal-Link) gehen nicht und werden beim Speichern der Einstellungen abgelehnt; die Integration *Lokaler Kalender* ist eine gute Wahl, wenn du keinen anderen hast. **CalDAV** (iCloud, Nextcloud …) funktioniert: Der CalDAV-Kalender von Home Assistant kann von sich aus nur Termine anlegen, deshalb liest und löscht Larder seine eigenen Termine direkt über die CalDAV-Verbindung.
