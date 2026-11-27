# Gut zu wissen

[← Übersicht](../../README.de.md) · [🇬🇧 English](../en/good-to-know.md)

Kurze Antworten auf die häufigsten Fragen und die Regeln, nach denen Larder überall arbeitet. Die Details stehen auf den verlinkten Seiten.

[Wo ist was?](#wo-ist-was) · [Einlagern](#einlagern-überall-dieselben-regeln) · [Entnehmen](#entnehmen) · [Umräumen](#umräumen) · [Unbekannte Produkte](#unbekannte-produkte) · [Einkaufsliste](#einkaufsliste-kurz-erklärt) · [Nachkaufen](#nachkaufen-was-wann) · [Weniger wegwerfen](#weniger-wegwerfen) · [MHD](#mhd) · [QR-Codes und NFC-Tags](#qr-codes-und-nfc-tags) · [Wer darf was?](#wer-darf-was) · [Lebensmittel, Haushalt, Apotheke, Gutscheine](#lebensmittel-haushalt-apotheke-gutscheine) · [Benachrichtigungen](#benachrichtigungen-welcher-blueprint-wofür) · [Deine Daten](#deine-daten)

## Wo ist was?

| Ich möchte … | Dort |
|---|---|
| sehen, was bald abläuft | **Start** (Kacheln oben), die [tägliche Zusammenfassung](kitchen.md#tägliche-zusammenfassung) oder die Karte [Larder](dashboard.md#karte-für-deine-dashboards) |
| ein Produkt finden | **🔍** oben auf jeder Seite: jeder Ort mit Anzahl und MHD |
| irgendetwas scannen | **📷** oben auf jeder Seite (Home Assistant App): Strichcode, Dosen-Code oder Fach-Etikett |
| den Einkauf einräumen | **📥 Einkauf einräumen** (Startseite, Vorrat, Einkaufen, Mehr): **📷 Scannen**, **🧾 Kassenbon oder Rechnung** oder **✍️ Von Hand** – oder beim Einkaufen im **🛒 Einkaufsmodus** abhaken |
| einen Kassenbon oder eine Rechnung lesen | **📥 Einkauf einräumen → 🧾 Kassenbon oder Rechnung** (Startseite, Vorrat, Einkaufen, Mehr) – erst Foto oder PDF wählen, dann prüfen |
| etwas auf die Einkaufsliste setzen | **🛒 Einkaufen → Auf die Liste …** oder ein Chip **Schnell dazu**; eine Liste aus dem Chat einfach dort einfügen ([kurz erklärt](#einkaufsliste-kurz-erklärt)) |
| eine Online-Bestellung vorbereiten | **🛒 Einkaufen → ⋯ Mehr → 📦 Bestellung vorbereiten** ([Online-Bestellung](kitchen.md#online-bestellung)) |
| sehen, was ich kochen kann | **📖 Rezepte**, Sortierung **Passt zum Vorrat**; **✨ KI-Ideen aus deinen Resten** mit KI |
| sehen, was diese Woche weg muss | **Mehr → ♻️ Retten diese Woche** |
| Dosen oder Packungen an einen anderen Ort bringen | **☑ Auswählen → 📍 Umräumen**, eine leere Dose auch über **Nur umräumen** im Befüll-Dialog ([Umräumen](#umräumen)) |
| sehen, was noch an Angaben fehlt | **Mehr → 🧹 Datenpflege**: je Produkt, was fehlt, alles in einem Dialog |
| sehen, was mit einem Produkt passiert ist | **📜 Verlauf** – in der Bestands-Ansicht, im Strichcode-Dialog oder **📜 Verlauf von …** auf einer Karte |
| den Bestand mit Mindestbestand und Preisen sehen | **Mehr → 🗃️ Bestand** |
| zählen, was wirklich da ist | **Mehr → 📋 Inventur** oder **📋 Inventur** in einem Fach |
| einem Fach einen Tag geben oder ein Etikett drucken | neuen Tag direkt am Fach scannen oder **Mehr → 🏷 Fächer & Tags** |
| Bereiche (mit ihrer Lagerart), Abteilungen (auch eigene), Größen, Export, Import aus Grocy, Einstellungen ändern | **Mehr → Einrichtung** (Administratoren) |

Alles, was früher im Menü ⋮ war, steht seit 5.0 unter **Mehr**; *Bereiche* und *Kategorien* sind Reiter oben auf der Seite **Vorrat**.

## Einlagern: überall dieselben Regeln

Egal wie ein Produkt hereinkommt – **📥 Einkauf einräumen** (Scannen, Kassenbon oder Rechnung, von Hand), Abhaken im **Einkaufsmodus**, **Eingekauft – in den Vorrat?** auf der Startseite, **＋ Neue Packung hinzufügen** im Strichcode-Dialog oder ein Chip **zuletzt verwendet** unter ＋ –, Larder macht dasselbe:

1. Ein **bekanntes** Produkt kommt an seinen **üblichen Ort** (wo das meiste davon liegt). Es **zählt zu einem Eintrag ohne MHD** dort dazu; sonst entsteht ein neuer Eintrag.
2. **Preis und MHD** lassen sich gleich eintragen (**Preis/MHD**, 📷 liest das MHD vom Foto). Eine Packung mit eigenem MHD bekommt einen **eigenen Eintrag**, damit die älteste zuerst verbraucht wird.
3. Der **Preis** kommt in den Preisverlauf des Produkts.
4. Der passende Eintrag auf der **Einkaufsliste wird abgehakt**, und *Eingekauft – in den Vorrat?* bietet ihn nicht noch einmal an.
5. **＋1** legt eine weitere Packung desselben Produkts dazu, ohne erneut zu scannen; Preis und MHD gelten dann für alle.
6. Seit 6.1 wird das **MHD vorgeschlagen**: aus früheren Käufen genau dieses Produkts (*die Milch hatte beim letzten Einräumen noch 9 Tage*), sonst – nur bei frischen Lebensmitteln – aus der Haltbarkeitstabelle. Ein Vorschlag hat einen gestrichelten Rahmen; prüfen und bei Bedarf ändern. Ähnliche Produkte teilen sich nie ihre Daten (*Heinz Ketchup* und *Heinz Ketchup Zero* bleiben getrennt).

### Nachtragen: zuletzt eingeräumt

Seit 6.1 öffnen **Fertig** nach dem Einräumen und **Anlegen** nach einem Kassenbon **📝 Eben eingeräumt**: eine Liste mit **Preis**, **MHD**, **Bereich** und **Fach** jeder Zeile, alles änderbar, einmal **Speichern**. Gespeichert wird nur, was sich geändert hat; ein MHD für die neuen Packungen gibt ihnen einen eigenen Eintrag. **Mehr → 📝 Zuletzt eingeräumt** zeigt dieselbe Liste für die letzten 7 Tage (*Nur Unvollständiges* ist voreingestellt), damit du nichts einzeln suchen musst.

**Ohne Strichcode** (Obst, Brot vom Bäcker) trägst du beim Scannen den Namen ins Feld **Ohne Strichcode: Name** ein. **✍️ Von Hand** fragt zuerst, was es ist: Einvakuumiertes vom Metzger wird ein **Beutel** und bekommt gleich seinen **NFC-Tag**; eine schon angelegte Lebensmittel-Packung wird auf ihrer Karte unter **Mehr → Umwandeln in … → Beutel** zum Beutel. Eine **Rechnung** als PDF (z. B. von REWE online) liest *Kassenbon oder Rechnung* genauso wie ein Foto vom Kassenbon.

Nur **unbekannte** Produkte öffnen einen Dialog (siehe unten). Details: [Bestand](containers.md#bestand), [Einkaufsmodus](kitchen.md#einkaufsmodus).

## Entnehmen

- **−1** nimmt eine Packung (Haushaltsartikel: ein Stück). Überall – auf der Karte, in der Fach-Ansicht, im Strichcode-Dialog und in einer Push – fragt es **Verbraucht** oder **🗑 Weggeworfen**.
- **Weggeworfen** zählt im Verlauf, in der [Statistik](dashboard.md#statistik), im Monatsbericht und bei *ca. X € weggeworfen*; verbraucht zählt als Verbrauch (für *reicht noch …* und *nach Verbrauch nachkaufen*).
- Die **letzte** Packung eines Eintrags entfernt den Eintrag; eine Dose wird **geleert** (sie behält ihren Code und lässt sich wieder befüllen), ein Beutel verschwindet.
- **Direkt auf der Startseite:** Unter jeder Kachel *bald verbrauchen* stehen **😋 Gegessen** (bei Abgelaufenem **🗑 Weggeworfen**) und, wenn es sich einfrieren lässt, **🧊 Einfrieren**. Auf der Karte einer Dose stehen **Gegessen** und **Weggeworfen** unten.
- **Gekocht:** *🍳 Gekocht* an einem Rezept oder im Wochenplan nimmt die Zutaten aus dem Vorrat (die Dose mit dem frühesten Datum zuerst) und bietet an, **Reste in eine leere Dose** zu füllen ([Rezeptbuch](kitchen.md#rezeptbuch)).
- **Anbrechen** (Packungen) markiert eine Packung als angebrochen, auf Wunsch an einem anderen Ort (z. B. im Kühlschrank), und verkürzt ihr MHD. **In Dose umfüllen** füllt eine Packung in eine leere Dose um – oder in eine **neue**, die gleich dort angelegt wird.

## Umräumen

Nur der Ort ändert sich – Inhalt, Menge und MHD bleiben, eine leere Dose bleibt leer:

- **Mehrere auf einmal:** **Vorrat → ☑ Auswählen** (oder lange auf eine Kachel drücken), Einträge antippen, **📍 Umräumen**, Bereich und Fach wählen. Die schon benutzten Fächer des Bereichs stehen als Chips darunter.
- **Eine leere Dose:** Antippen öffnet den Befüll-Dialog; unten steht **📍 Nur umräumen (bleibt leer)**.
- **Packungen teilen:** Auf der Karte einer Packung verschiebt **Verschieben** auch nur einen Teil (z. B. 2 von 6 in den Keller).
- Umräumen dürfen Administratoren, weil es den Bereich in Home Assistant ändert.

## Unbekannte Produkte

Einen Strichcode, den Larder noch nicht kennt, sucht es in Open Food Facts (Lebensmittel), Open Beauty Facts, Open Products Facts und Open Pet Food Facts. Unbekannte Produkte werden beim Einräumen, Einkaufen oder Scannen **gesammelt** und **am Ende gemeinsam** angelegt: Lebensmittel als **Packungen**, alles andere als **Haushaltsartikel**. Der Kassenbon markiert Haushaltswaren mit 🧻. Wurde ein Produkt umbenannt, merkt sich Larder seinen Strichcode; Packungen ohne Strichcode lassen sich mit **🔗 Mit Produkt im Vorrat verknüpfen** zuordnen.

## Einkaufsliste: kurz erklärt

Alles auf der Seite **🛒 Einkaufen** ([Einkaufsmodus](kitchen.md#einkaufsmodus)):

- **Liste aus dem Chat übernehmen:** Kopiere die Liste mit Zeilenumbrüchen (z. B. aus WhatsApp oder Notizen) und füge sie in **Auf die Liste …** ein (auf dem iPhone lange ins Feld drücken → *Einsetzen*). Mit mehr als einer Zeile öffnet sich eine Vorschau mit einem Eintrag je Zeile; wegklicken, was nicht drauf soll, dann **Auf die Liste**. Striche, Punkte und Nummern am Zeilenanfang fallen weg, Doppeltes kommt nicht auf die Liste, höchstens 50 Zeilen. Tippen mit der Eingabetaste setzt dagegen immer nur einen Eintrag.
- **Schnell dazu:** Die Chips unter dem Feld zeigen, was ihr oft kauft (in den letzten 60 Tagen eingeräumt) und was zuletzt gestrichen oder eingeräumt wurde – nie, was schon auf der Liste steht. Beim Tippen schlägt das Feld deine Produkte vor.
- **Menge und Notiz:** Eintrag antippen, z. B. **2×** und *laktosefrei*. **2×** legt beim Abhaken zwei Packungen in den Vorrat. Listen, die keine Beschreibung speichern können, bekommen die Notiz in Klammern hinter den Namen (*Milch (2× · fettarm)*); Larder erkennt das Produkt trotzdem.
- **Ähnliches bleibt getrennt:** *Milch* und *Fettarme Milch*, *Heinz Ketchup* und *Heinz Ketchup Zero* sind immer eigene Einträge.
- **Abhaken oder streichen:** **○ Abhaken** heißt gekauft – es kommt in den Vorrat (mit **Rückgängig** in der Meldung). **✕ Streichen** heißt nicht mehr nötig – es verschwindet von der Liste, nichts kommt in den Vorrat (auch mit **Rückgängig**). Hat ein Produkt einen Mindestbestand, kommt es wieder auf die Liste, sobald es knapp wird.
- **Summe:** oben *ca. 19,24 € offen · 5,37 € im Korb · 1 ohne Preis* – mit den Preisen des gewählten Ladens, sonst den zuletzt bezahlten.
- **Abteilungen:** Die Liste steht in der Reihenfolge deines Ladens (Nudeln & Reis, Konserven, Backen, Gewürze, Internationale Küche, Süßes & Snacks …). **Mehr → 🏪 Abteilungen** ändert die Reihenfolge und legt **eigene Abteilungen** an; auf der Karte eines Produkts wählst du seine Abteilung. **📍 Wo bist du?** filtert nach Laden, **＋ Geschäft** legt einen an.
- **Aktuell ohne Knopf:** Die Seite aktualisiert sich selbst, wenn jemand anderes etwas auf die Liste setzt. *Bestellung vorbereiten*, *Wiederkehrend* und *Aktualisieren* stehen unter **⋯ Mehr**.

## Nachkaufen: was wann?

| Funktion | Wann es etwas auf die Liste setzt | Einrichten |
|---|---|---|
| **Beim Leeren auf die Einkaufsliste** | wenn eine Dose geleert wird | Schalter auf der Karte einer Dose |
| **Mindestbestand** | sobald weniger Packungen da sind als der Mindestbestand | Bestands-Ansicht oder Karte einer Packung |
| **⏳ Bald leer** | wenn ein Produkt mit Mindestbestand laut Prognose nur noch bis zum nächsten Einkauf reicht – auf der Startseite, auf Wunsch gleich auf die Liste | Einstellung *Bald leer: gleich auf die Einkaufsliste* |
| **🔁 Nach Verbrauch nachkaufen** | wenn es laut Verbrauch nicht bis zum nächsten Einkauf reicht – auch ohne Mindestbestand, einmal pro Einkauf | Bestands-Ansicht, je Produkt |
| **Wiederkehrende Einkäufe** | an festen Wochentagen oder alle n Tage (Brot, Wasser) | **⋯ Mehr → 🔁 Wiederkehrend** im Einkaufsmodus |
| **Bestellung vorbereiten** | auf Knopfdruck: was bis zur übernächsten Lieferung ausgeht, zum Kopieren oder auf die Liste | **⋯ Mehr → 📦 Bestellung vorbereiten** im Einkaufsmodus |
| **Wechselintervall** | Haushaltsartikel, die gewechselt werden müssen (Wasserfilter) | Karte eines Haushaltsartikels |

Jeder Listeneintrag von Larder merkt sich Produkt, Marke, Packung und Ort, damit Abhaken es [in den Vorrat](#einlagern-überall-dieselben-regeln) legt. Details: [Einkaufsliste](kitchen.md#einkaufsliste).

## Weniger wegwerfen

- **🧊 Einfrieren statt wegwerfen:** Was im Kühlschrank in 2 Tagen abläuft und sich einfrieren lässt, bekommt **🧊 Einfrieren** – auf der Startseiten-Kachel, in der Push und in der Retten-Liste. Es wandert in den Gefrierschrank und bekommt das Tiefkühl-Datum.
- **♻️ Retten diese Woche:** **Mehr → ♻️ Retten diese Woche** (und auf Wunsch sonntags als Push) zeigt, was diese Woche weg muss und noch nicht eingeplant ist, mit **In den Wochenplan**.
- **Tiefkühl zuerst:** Eingefrorenes, dessen beste Qualität bald endet, kommt in Wochenvorschlag und Rezeptideen nach vorne (Einstellung *Tiefkühl vorziehen*).
- **Was ihr am meisten wegwerft:** steht in der [Statistik](dashboard.md#statistik), mit einem Tipp je Produkt.

## MHD

- **Aufgedruckt oder geschätzt:** Bei Packungen trägst du das aufgedruckte MHD ein (oder 📷 liest es vom Foto); bei Dosen und Beuteln [schätzt](best-before.md#mhd-schätzung) Larder es aus Inhalt und Lagerort (Tabelle, optional KI) – die Schätzung ersetzt nie ein Datum, das du eingetragen hast.
- **Geöffnet / Aufgetaut** verkürzen das MHD (verlängern nie); eine angebrochene Packung zeigt **🫙 offen seit …**, damit klar ist, warum das Datum kürzer ist als aufgedruckt.
- **+1 Tag** verschiebt ein Datum von Hand; **MHD +2 Tage** in einer Push macht dasselbe aus der Benachrichtigung.
- Die Tage stehen in Worten: **morgen**, **in 3 Tagen**, **in 2 Monaten**, **seit gestern abgelaufen**.
- **Wo etwas lagert, zählt:** Die Schätzung richtet sich nach der **Lagerart** des Bereichs (Kühlschrank, 0-°C-Fach, Gefrierschrank, Vorrat). **Mehr → 📍 Bereiche bearbeiten** zeigt, als was Larder jeden Bereich erkannt hat, und lässt dich die Lagerart wählen, wenn nichts erkannt wurde.
- **Unbekanntes Produkt:** Kennt die Haltbarkeitstabelle ein Produkt nicht, steht es in der **Datenpflege**; dort (oder in der Produktansicht unter **🧭 Art für die Haltbarkeit**) wählst du, wie Larder es behandeln soll.
- **Vakuum:** Beim ersten Befüllen fragt Larder, ob ihr ein Vakuumiergerät habt; ohne Gerät sind neue Dosen nicht als vakuumiert vorbelegt (das MHD wäre sonst zu lang).

## QR-Codes und NFC-Tags

- **Dosen** tragen ihren eigenen QR-Code (oder den originalen Zwilling-Code) oder einen NFC-Tag; **Fächer** (eine Schublade, eine Box, ein Regal) bekommen einen eigenen Tag oder ein QR-Etikett, damit ein Scan zeigt, was dort liegt.
- **Leere Sticker lassen sich nicht scannen** – das Handy liest nur beschriebene Tags. Wähle **Neuen NFC-Tag beschreiben** / **✍ Neuen Sticker beschreiben**: Ein eigener Schritt öffnet das Fenster der App (**Nochmal beschreiben**, falls keins aufging).
- **Einen neuen, schon beschriebenen Tag** kannst du einfach scannen: Larder fragt, ob er für ein Fach, eine Dose ist oder ignoriert werden soll.
- **Tags mit einem Namen unter Einstellungen → Tags** gehören zu etwas anderem und werden nie angefasst.
- Details: [Scannen](scanning.md).

## Wer darf was?

| | Alle im Haushalt | Nur Administratoren |
|---|---|---|
| Befüllen, leeren, −1, anbrechen, Packungen verschieben | ✓ | |
| Einkaufsliste: hinzufügen, abhaken, streichen, Menge und Notiz | ✓ | |
| Beutel, Packungen, Haushaltsartikel, Medikamente, Gutscheine anlegen | ✓ | |
| Dosen anlegen, einer Dose einen Tag geben | | ✓ |
| Fächer mit Tags verknüpfen, Etiketten drucken | ✓ | |
| Auswahl und Serien-Scan, Umräumen, gemerkte Schätzungen, Export und Import, Einstellungen | | ✓ |
| Lagerart der Bereiche, eigene Abteilungen, Einkaufsliste in den ersten Schritten wählen | | ✓ |
| KI-Funktionen (Rezeptideen, Kassenbon, MHD und Gutschein vom Foto) | | ✓ (mit *AI Task*) |
| Gutschein-Codes | | ✓ |

## Lebensmittel, Haushalt, Apotheke, Gutscheine

Der Umschalter oben auf der Seite **Vorrat** zeigt jeweils eine Seite. Bereiche gehören zu einer Seite (z. B. *Bad* → Haushalt) oder zu beiden; siehe [Lebensmittel, Haushalt oder Apotheke](containers.md#lebensmittel-haushalt-oder-apotheke). Haushaltsartikel und Medikamente haben eigene, längere Vorwarnungen und gehören nicht in die tägliche Zusammenfassung der Lebensmittel; Medikamente haben eine [eigene Erinnerung](kitchen.md#ablaufende-medikamente). *Gutscheine* erscheint erst, sobald es einen gibt.

## Benachrichtigungen: welcher Blueprint wofür?

| Blueprint | Schickt |
|---|---|
| [Tägliche Zusammenfassung](kitchen.md#tägliche-zusammenfassung) | was bald abläuft, auf Wunsch eine Push je Eintrag mit den Knöpfen **Verbraucht · Weggeworfen · MHD +2 Tage · Auf die Liste** (und **🧊 Einfrieren** für Einfrierbares), Rezeptideen, Sprachausgabe |
| [Wochenrückblick](kitchen.md#wochenrückblick) | letzte Woche gegessen / weggeworfen (Wert), was nächste Woche abläuft, eine Rezeptidee |
| [Angebrochenes](kitchen.md#angebrochenes) | einmal pro Woche alles Angebrochene, das bald abläuft, mit „seit … offen“ |
| [Liefertag](kitchen.md#online-bestellung) | am Liefertag deiner Online-Bestellung, mit **Einräumen** |
| [Retten-Liste der Woche](kitchen.md#retten-liste-der-woche) | einmal pro Woche, was diese Woche weg muss und nicht eingeplant ist, mit **In den Wochenplan** |
| [Monatsbericht](kitchen.md#monatsbericht) | den Vormonat im Vergleich zum Monat davor |
| [Ablaufende Medikamente](kitchen.md#ablaufende-medikamente) | Medikamente, Haushaltsartikel mit Datum und Gutscheine an gewählten Wochentagen |
| [Bald leer und Rückrufe](kitchen.md#bald-leer-und-rückrufe) | bald leer, Rückrufwarnungen, Wechsel fällig |
| [Am Kühlschrank und an den Fächern](kitchen.md#am-kühlschrank-und-an-den-fächern) | eine Ansage, wenn die Kühlschranktür aufgeht und heute etwas abläuft; was in einem gescannten Fach liegt |

Daneben bekommt das scannende Handy nach einem NFC-Scan eine Benachrichtigung (Einstellung *NFC: Handy benachrichtigen*), und die [Übersichts-Sensoren](reference.md#übersichts-sensoren) gehen in eigenen Automationen.

## Sprachen

Larder richtet sich nach der Sprache deines Home-Assistant-Benutzers: **Deutsch**, **Englisch**, **Französisch** und **Niederländisch** (seit 6.0) – Dashboard, Karten, Einstellungen, Benachrichtigungen und Sprachausgabe, Berichte und die Haltbarkeitstabelle (Lebensmittel und Bereichsnamen wie *réfrigérateur* oder *koelkast* werden erkannt). Andere Sprachen fallen auf Englisch zurück. Seit 6.2 schickt das Dashboard beim Schätzen **deine** Sprache mit (aus deinem Home-Assistant-Profil): die Wörter deiner Sprache zählen zuerst (*pommes* sind für Franzosen Äpfel, für Deutsche Pommes) und der Tipp kommt in deiner Sprache. Benachrichtigungen, Sensoren und Automationen haben keinen Benutzer und nutzen die Systemsprache. Bei Deutsch und Englisch werden französische und niederländische Wörter gar nicht verwendet.

Französisch und Niederländisch sind **Übersetzungen ohne Muttersprachler** (mit Hilfe einer KI erstellt und mit den Begriffen von Home Assistant abgeglichen). Manches klingt vielleicht hölzern. Korrekturen sind sehr willkommen – als [Issue](https://github.com/yan14/ha-larder/issues) oder Pull Request auf `translations/fr.json` / `nl.json` und die Texttabellen in `frontend/`.

## Deine Daten

Alles liegt lokal in Home Assistant (`.storage/larder.*` und die Entitäten). Online geht Larder nur für: Strichcodes (Open Food Facts und seine Schwester-Datenbanken), Preisschätzungen ([Open Prices](https://prices.openfoodfacts.org)) und Rückrufwarnungen (lebensmittelwarnung.de). Die **KI** ist optional und läuft über die Integration *AI Task* von Home Assistant mit dem Anbieter, den du gewählt hast: Rezeptideen bekommen Inhalte, Mengen, Resttage und Lagerorte; Fotos (Rezept, Kassenbon, MHD, Gutschein) werden einmal geschickt und gleich wieder gelöscht. **Mehr → 📦 Export und Import** exportiert Bestand und Verlauf als CSV und sichert die gemerkten Schätzungen.
