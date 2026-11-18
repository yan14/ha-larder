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

### Ablaufende Medikamente

Medikamente und Haushaltsartikel mit Datum (z. B. Sonnencreme) warnen viel früher als Lebensmittel (standardmäßig 60 Tage) und stehen deshalb nicht in der täglichen Zusammenfassung. Ein eigener Blueprint erinnert an den gewählten Wochentagen (z. B. jeden Montag um 9:00): Push an ein oder mehrere Handys und optional als Ansage auf Alexa (Alexa Media Player, z. B. `notify.alexa_media_kitchen` mit `type: announce`). Abgelaufene werden mit *entsorgen* genannt. Seit 4.8 nennt er auch [Gutscheine](containers.md#gutscheine), die bald ablaufen, mit ihrem Wert (Schalter *Include vouchers*; abgelaufene Gutscheine nie). Ist nichts fällig, kommt nichts; von Hand ausgeführt kommt die Nachricht trotzdem, als Test.

[![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fyan14%2Fha-larder%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Flarder%2Fmedicine_reminder.yaml)

Für eigene Automationen: `larder.get_expiring_medicines` (optional `days`, `include_expired`, `include_vouchers`) liefert `count`, `expired`, `items`, `summary` und `speech`.

### Bald leer und Rückrufe

Ein dritter Blueprint schickt einen Push, wenn ein Produkt [bald leer](containers.md#bestand) ist und wenn eine [Rückrufwarnung](containers.md#rückrufwarnungen) zu etwas im Vorrat passt; beides lässt sich einzeln ein- und ausschalten. Seit 4.6 erinnert er auf Wunsch auch, wenn ein Haushaltsartikel [gewechselt werden sollte](containers.md#haushaltsartikel) (Ereignis `larder_replace_due` mit `name`, `due`, `weeks`, `title`, `message`). Antippen öffnet die Startseite von Larder. Die Ereignisse `larder_running_low` (`name`, `count`, `min`, `lasts_days`, `message`) und `larder_recall` (`title`, `reason`, `link`, `products`, `places`, `message`) gehen auch für eigene Automationen. Von Hand ausgeführt, schickt die Automation eine Test-Benachrichtigung.

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

### Wochenvorschlag

<p align="center"><img src="../images/dashboard-week-de.png" width="250" alt="Wochenvorschlag"></p>

**🪄 Woche vorschlagen** auf der Rezeptseite schlägt Gerichte für die nächsten Tage vor (Einstellung *Wochenplan-Vorschlag: Tage*, Standard 5), die zuerst die Dosen verbrauchen, die bald ablaufen. Tage, für die schon etwas geplant ist, werden übersprungen, schon eingeplante Dosen bleiben außen vor. Woher die Gerichte kommen, ist eine Einstellung wie bei der MHD-Schätzung: *nur Rezeptbuch*, *nur KI*, *Rezeptbuch, sonst KI* (Standard) oder *Rezeptbuch und KI zusammen*. Ein Rezept aus dem Buch passt, wenn eine seiner Zutatenzeilen den Inhalt einer Dose nennt. Je Tag siehst du das Gericht und die Dosen, die es verbraucht; **↻ Anderes** tauscht das Gericht, **Entfernen** nimmt den Tag heraus, **Übernehmen** schreibt alles in den Wochenplan (mit Auftau-Erinnerung und fehlenden Zutaten wie gewohnt).

## Einkaufsliste

**Mal wieder …?** Die Startseite schlägt vor, was du in den letzten 90 Tagen mindestens dreimal gegessen hast, aber gerade in keiner Dose und keiner Packung ist („Bolognese, 4× gegessen …“). **🛒 Einkaufsliste** setzt es auf die Liste, **✕** blendet den Vorschlag 30 Tage aus.

Unter Einstellungen → Geräte & Dienste → **Larder** → **Konfigurieren** kannst du eine **To-do-Liste** von Home Assistant wählen, z. B. die eingebaute *Einkaufsliste*, Todoist oder Bring!. Jede Dose hat dann ein Häkchen **Beim Leeren auf die Einkaufsliste** (der Schalter `Einkaufsliste`, standardmäßig aus). Drückst du bei einer Dose mit gesetztem Häkchen **Behälter leeren**, wird ihr Inhalt auf die Liste gesetzt, z. B. „Basmati“.

- **Marke und Packung:** Sind sie bekannt (z. B. nach einem [Strichcode-Scan](containers.md#dosen-befüllen)), kommen sie mit auf die Liste: „Haferflocken (Kölln, 500 g)“. Ein offenes „Haferflocken“ gilt als derselbe Eintrag und kommt nicht doppelt. Abschaltbar in den Einstellungen; bei mehreren Inhalten („Salami, Leberwurst“) kommen nur die Namen.
- Nicht alles gehört auf die Liste: Reste wie „Pizza-Reste“ lässt du einfach ohne Häkchen, sie werden nie eingetragen. Die Einstellung gehört zur Dose und bleibt beim Leeren erhalten. So wird Reis immer nachgekauft und Pizza nie.
- Steht ein Eintrag schon offen auf der Liste, wird er nicht doppelt angelegt. Bereits abgehakte Einträge zählen nicht, du kannst dasselbe also erneut einkaufen.
- Ohne gewählte Liste passiert nichts, und das Häkchen ist ausgeblendet. Ist die Liste nicht erreichbar, wird die Dose trotzdem geleert.
- Geplant: auch abgelaufene Dosen einzutragen.

**Mehrere Listen (seit 4.1).** Alles, was Larder auf eine Liste setzt (geleerte Dosen, Mindestbestand, bald leer, Zutaten aus dem Wochenplan, *Mal wieder …?*, 🛒), kommt auf eine dieser Listen:

| Welche Liste | Wo einstellen | Wofür |
|---|---|---|
| **Einkaufsliste (Lebensmittel)** | Konfigurieren | Lebensmittel und Haushaltsartikel ohne eigene Liste |
| **Einkaufsliste für Haushaltsartikel** | Konfigurieren (optional) | Haushaltsartikel; leer = die Lebensmittel-Liste |
| **Einkaufsliste für Medikamente** (seit 4.4) | Konfigurieren (optional) | Medikamente; leer = die Lebensmittel-Liste |
| **Liste je Produkt** | auf der Karte (**Einkaufsliste**) oder im Anlegen-Dialog | dieses Produkt, z. B. *Metzger* für Leberkäse oder *Apotheke* für Pflaster; gemerkt nach Produktname, die nächste Packung landet also auch dort. **Standardliste** stellt zurück |

*Eingekauft – in den Vorrat?* beobachtet jede Liste, auf die Larder geschrieben hat, und *Marke und Packung mit auf die Einkaufsliste* gilt für alle. Wird eine gewählte Liste aus Home Assistant entfernt, nimmt das Produkt wieder die Standardliste.

### Abteilungen im Laden

Seit 4.7 gehört jedes Produkt zu einer **Abteilung**: 🥦 Obst & Gemüse, 🥖 Brot & Backwaren, 🥩 Fleisch, Wurst & Fisch, 🧀 Kühlregal, 🍝 Nudeln, Reis & Konserven, ☕ Frühstück, Kaffee & Süßes, 🥤 Getränke, 🧊 Tiefkühl, 🧴 Drogerie & Haushalt, 💊 Apotheke, 🛒 Sonstiges. Larder schlägt sie nach Art und Kategorie vor (Haushaltsartikel → Drogerie, Medikamente → Apotheke, *TK-* → Tiefkühl, Wasser und Saft → Getränke); **Abteilung** auf der Karte eines Produkts überschreibt das, gemerkt nach Produktname, **Automatisch** stellt zurück.

Setzt Larder etwas auf eine Liste, schiebt es den neuen Eintrag hinter den letzten offenen Eintrag derselben oder einer früheren Abteilung – die Liste folgt so deinem Weg durch den Laden. Die Reihenfolge stellst du einmal unter **⋮ → 🏪 Abteilungen** (Administratoren) mit ↑ und ↓ ein. Selbst eingetippte Einträge werden nach ihrem Namen mit einsortiert. Das braucht eine Liste, die Einträge verschieben kann, z. B. die eingebaute *Einkaufsliste* oder *Lokale To-do-Liste*; Listen, die das nicht können (manche Cloud-Listen), behalten die Reihenfolge des Hinzufügens.

## Notvorrat

**⋮ → 🛟 Notvorrat** vergleicht den Bestand mit dem Beispielvorrat des Bundesamts für Bevölkerungsschutz und Katastrophenhilfe (BBK) für 10 Tage: pro Person 20 l Getränke, 3,5 kg Getreide, Brot, Kartoffeln, Nudeln und Reis, 4 kg Gemüse und Hülsenfrüchte, 2,5 kg Obst und Nüsse, 2,6 kg Milch und Milchprodukte, 1,5 kg Fisch, Fleisch und Eier sowie 0,36 kg Fette und Öle. Darunter prüft er am Namen Kerzen oder Taschenlampe, Batterien, Radio, Klopapier, Seife, Verbandskasten, Schmerzmittel, Fieberthermometer und Desinfektionsmittel.

- **Personen** und **Tage** sind Einstellungen (Standard 2 Personen, 10 Tage); die Mengen rechnen sich mit. Der Check lässt sich ausschalten.
- Gezählt wird, was eine Mengenangabe hat: eine Packungsgröße wie *500 g* oder *6 x 1,5 l* (mal Anzahl Packungen), Dosen in Gramm oder Millilitern, Portionen mit 300 g. Einträge ohne Menge stehen als *+ n ohne Mengenangabe* dabei, das Ergebnis ist also eine Untergrenze.
- Die Seite sagt, für wie viele Tage der Vorrat reicht (die schwächste Gruppe entscheidet), und bietet für jede Lücke **🛒**: *Mineralwasser*, *Gemüsekonserven*, *Kerzen* … kommen auf die Lebensmittel-, Haushalts- oder Apotheken-Liste.

<p align="center">
<img src="../images/dashboard-supply-de.png" width="250" alt="Notvorrat">
<img src="../images/dashboard-sections-de.png" width="250" alt="Abteilungen im Laden">
</p>

## MHD im Kalender

Unter Einstellungen → Geräte & Dienste → **Larder** → **Konfigurieren** kannst du einen vorhandenen **Kalender** wählen (Google, CalDAV, *Lokaler Kalender* …). Jede Dose bekommt dann einen Ganztags-Termin „MHD: Pizza“ am Tag des MHD. Der Termin wird angelegt, sobald ein Datum gesetzt ist, verschoben, wenn sich Datum oder Inhalt ändern, und gelöscht, wenn das Datum gelöscht, die Dose geleert oder entfernt oder ein anderer Kalender gewählt wird. Eigene Termine werden an einer Kennung in der Beschreibung erkannt, andere Termine werden nie angefasst.

**Aufräumen.** Bei jedem Start und beim Speichern der Einstellungen prüft Larder den ganzen Kalender, behält pro Dose genau einen Termin und entfernt Doppelte. Der Dienst `larder.rebuild_calendar` macht das auf Knopfdruck und entfernt zusätzlich Termine von Dosen, die es nicht mehr gibt. Mit `include_unmarked: true` werden außerdem Termine „MHD: …“ / „Best before: …“ ohne Larder-Kennung entfernt (für Kalender, die die Beschreibung verwerfen) und neu angelegt.

Der Kalender muss Termine anlegen **und** löschen können. Reine Lese-Kalender (z. B. ein iCal-Link) gehen nicht und werden beim Speichern der Einstellungen abgelehnt; die Integration *Lokaler Kalender* ist eine gute Wahl, wenn du keinen anderen hast. **CalDAV** (iCloud, Nextcloud …) funktioniert: Der CalDAV-Kalender von Home Assistant kann von sich aus nur Termine anlegen, deshalb liest und löscht Larder seine eigenen Termine direkt über die CalDAV-Verbindung.
