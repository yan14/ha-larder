# Gut zu wissen

[← Übersicht](../../README.de.md) · [🇬🇧 English](../en/good-to-know.md)

Kurze Antworten auf die häufigsten Fragen und die Regeln, nach denen Larder überall arbeitet. Die Details stehen auf den verlinkten Seiten.

[Wo ist was?](#wo-ist-was) · [Einlagern](#einlagern-überall-dieselben-regeln) · [Entnehmen](#entnehmen) · [Unbekannte Produkte](#unbekannte-produkte) · [Nachkaufen](#nachkaufen-was-wann) · [MHD](#mhd) · [QR-Codes und NFC-Tags](#qr-codes-und-nfc-tags) · [Wer darf was?](#wer-darf-was) · [Lebensmittel, Haushalt, Apotheke, Gutscheine](#lebensmittel-haushalt-apotheke-gutscheine) · [Benachrichtigungen](#benachrichtigungen-welcher-blueprint-wofür) · [Deine Daten](#deine-daten)

## Wo ist was?

| Ich möchte … | Dort |
|---|---|
| sehen, was bald abläuft | **Start** (Kacheln oben), die [tägliche Zusammenfassung](kitchen.md#tägliche-zusammenfassung) oder die Karte [Larder](dashboard.md#karte-für-deine-dashboards) |
| ein Produkt finden | **🔍** oben auf jeder Seite: jeder Ort mit Anzahl und MHD |
| irgendetwas scannen | **📷** oben auf jeder Seite (Home Assistant App): Strichcode, Dosen-Code oder Fach-Etikett |
| den Einkauf einräumen | **📥 Einräumen** (Startseite) – oder beim Einkaufen im **🛒 Einkaufsmodus** abhaken |
| einen Kassenbon lesen | **🧾 Kassenbon** (Startseite, Mehr, Einkaufsmodus) |
| sehen, was mit einem Produkt passiert ist | **📜 Verlauf** – in der Bestands-Ansicht, im Strichcode-Dialog oder **📜 Verlauf von …** auf einer Karte |
| den Bestand mit Mindestbestand und Preisen sehen | **Mehr → 🗃️ Bestand** |
| zählen, was wirklich da ist | **Mehr → 📋 Inventur** oder **📋 Inventur** in einem Fach |
| einem Fach einen Tag geben oder ein Etikett drucken | neuen Tag direkt am Fach scannen oder **Mehr → 🏷 Fächer & Tags** |
| Bereiche, Abteilungen, Größen, Export, Einstellungen ändern | **Mehr → Einrichtung** (Administratoren) |

Alles, was früher im Menü ⋮ war, steht seit 5.0 unter **Mehr**; *Bereiche* und *Kategorien* sind Reiter oben auf der Seite **Vorrat**.

## Einlagern: überall dieselben Regeln

Egal wie ein Produkt hereinkommt – **📥 Einräumen**, Abhaken im **Einkaufsmodus**, **🧾 Kassenbon**, **Eingekauft – in den Vorrat?** auf der Startseite, **＋ Neue Packung hinzufügen** im Strichcode-Dialog oder ein Chip **zuletzt verwendet** unter ＋ –, Larder macht dasselbe:

1. Ein **bekanntes** Produkt kommt an seinen **üblichen Ort** (wo das meiste davon liegt). Es **zählt zu einem Eintrag ohne MHD** dort dazu; sonst entsteht ein neuer Eintrag.
2. **Preis und MHD** lassen sich gleich eintragen (**Preis/MHD**, 📷 liest das MHD vom Foto). Eine Packung mit eigenem MHD bekommt einen **eigenen Eintrag**, damit die älteste zuerst verbraucht wird.
3. Der **Preis** kommt in den Preisverlauf des Produkts.
4. Der passende Eintrag auf der **Einkaufsliste wird abgehakt**, und *Eingekauft – in den Vorrat?* bietet ihn nicht noch einmal an.
5. **＋1** legt eine weitere Packung desselben Produkts dazu, ohne erneut zu scannen; Preis und MHD gelten dann für alle.

Nur **unbekannte** Produkte öffnen einen Dialog (siehe unten). Details: [Bestand](containers.md#bestand), [Einkaufsmodus](kitchen.md#einkaufsmodus).

## Entnehmen

- **−1** nimmt eine Packung (Haushaltsartikel: ein Stück). Überall – auf der Karte, in der Fach-Ansicht, im Strichcode-Dialog und in einer Push – fragt es **Verbraucht** oder **🗑 Weggeworfen**.
- **Weggeworfen** zählt im Verlauf, in der [Statistik](dashboard.md#statistik), im Monatsbericht und bei *ca. X € weggeworfen*; verbraucht zählt als Verbrauch (für *reicht noch …* und *nach Verbrauch nachkaufen*).
- Die **letzte** Packung eines Eintrags entfernt den Eintrag; eine Dose wird **geleert** (sie behält ihren Code und lässt sich wieder befüllen), ein Beutel verschwindet.
- **Anbrechen** (Packungen) markiert eine Packung als angebrochen, auf Wunsch an einem anderen Ort (z. B. im Kühlschrank), und verkürzt ihr MHD. **In Dose umfüllen** füllt eine Packung in eine leere Dose um – oder in eine **neue**, die gleich dort angelegt wird.

## Unbekannte Produkte

Einen Strichcode, den Larder noch nicht kennt, sucht es in Open Food Facts (Lebensmittel), Open Beauty Facts, Open Products Facts und Open Pet Food Facts. Unbekannte Produkte werden beim Einräumen, Einkaufen oder Scannen **gesammelt** und **am Ende gemeinsam** angelegt: Lebensmittel als **Packungen**, alles andere als **Haushaltsartikel**. Der Kassenbon markiert Haushaltswaren mit 🧻. Wurde ein Produkt umbenannt, merkt sich Larder seinen Strichcode; Packungen ohne Strichcode lassen sich mit **🔗 Mit Produkt im Vorrat verknüpfen** zuordnen.

## Nachkaufen: was wann?

| Funktion | Wann es etwas auf die Liste setzt | Einrichten |
|---|---|---|
| **Beim Leeren auf die Einkaufsliste** | wenn eine Dose geleert wird | Schalter auf der Karte einer Dose |
| **Mindestbestand** | sobald weniger Packungen da sind als der Mindestbestand | Bestands-Ansicht oder Karte einer Packung |
| **⏳ Bald leer** | wenn ein Produkt mit Mindestbestand laut Prognose nur noch bis zum nächsten Einkauf reicht – auf der Startseite, auf Wunsch gleich auf die Liste | Einstellung *Bald leer: gleich auf die Einkaufsliste* |
| **🔁 Nach Verbrauch nachkaufen** | wenn es laut Verbrauch nicht bis zum nächsten Einkauf reicht – auch ohne Mindestbestand, einmal pro Einkauf | Bestands-Ansicht, je Produkt |
| **Wiederkehrende Einkäufe** | an festen Wochentagen oder alle n Tage (Brot, Wasser) | **🔁 Wiederkehrend** im Einkaufsmodus |
| **Wechselintervall** | Haushaltsartikel, die gewechselt werden müssen (Wasserfilter) | Karte eines Haushaltsartikels |

Jeder Listeneintrag von Larder merkt sich Produkt, Marke, Packung und Ort, damit Abhaken es [in den Vorrat](#einlagern-überall-dieselben-regeln) legt. Details: [Einkaufsliste](kitchen.md#einkaufsliste).

## MHD

- **Aufgedruckt oder geschätzt:** Bei Packungen trägst du das aufgedruckte MHD ein (oder 📷 liest es vom Foto); bei Dosen und Beuteln [schätzt](best-before.md#mhd-schätzung) Larder es aus Inhalt und Lagerort (Tabelle, optional KI) – die Schätzung ersetzt nie ein Datum, das du eingetragen hast.
- **Geöffnet / Aufgetaut** verkürzen das MHD (verlängern nie); eine angebrochene Packung zeigt **🫙 offen seit …**, damit klar ist, warum das Datum kürzer ist als aufgedruckt.
- **+1 Tag** verschiebt ein Datum von Hand; **+2 Tage** in einer Push macht dasselbe aus der Benachrichtigung.
- Abgelaufenes zeigt **abgelaufen (3 T)** und seit wann; lange Haltbarkeiten stehen in Monaten oder Jahren.

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
| Beutel, Packungen, Haushaltsartikel, Medikamente, Gutscheine anlegen | ✓ | |
| Dosen anlegen, einer Dose einen Tag geben | | ✓ |
| Fächer mit Tags verknüpfen, Etiketten drucken | ✓ | |
| Auswahl und Serien-Scan, gemerkte Schätzungen, Export und Import, Einstellungen | | ✓ |
| KI-Funktionen (Rezeptideen, Kassenbon, MHD und Gutschein vom Foto) | | ✓ (mit *AI Task*) |
| Gutschein-Codes | | ✓ |

## Lebensmittel, Haushalt, Apotheke, Gutscheine

Der Umschalter oben auf der Seite **Vorrat** zeigt jeweils eine Seite. Bereiche gehören zu einer Seite (z. B. *Bad* → Haushalt) oder zu beiden; siehe [Lebensmittel, Haushalt oder Apotheke](containers.md#lebensmittel-haushalt-oder-apotheke). Haushaltsartikel und Medikamente haben eigene, längere Vorwarnungen und gehören nicht in die tägliche Zusammenfassung der Lebensmittel; Medikamente haben eine [eigene Erinnerung](kitchen.md#ablaufende-medikamente). *Gutscheine* erscheint erst, sobald es einen gibt.

## Benachrichtigungen: welcher Blueprint wofür?

| Blueprint | Schickt |
|---|---|
| [Tägliche Zusammenfassung](kitchen.md#tägliche-zusammenfassung) | was bald abläuft, auf Wunsch eine Push je Eintrag mit den Knöpfen **Verbraucht · Weggeworfen · +2 Tage · Auf die Liste**, Rezeptideen, Sprachausgabe |
| [Wochenrückblick](kitchen.md#wochenrückblick) | letzte Woche gegessen / weggeworfen (Wert), was nächste Woche abläuft, eine Rezeptidee |
| [Angebrochenes](kitchen.md#angebrochenes) | einmal pro Woche alles Angebrochene, das bald abläuft, mit „seit … offen“ |
| [Monatsbericht](kitchen.md#monatsbericht) | den Vormonat im Vergleich zum Monat davor |
| [Ablaufende Medikamente](kitchen.md#ablaufende-medikamente) | Medikamente, Haushaltsartikel mit Datum und Gutscheine an gewählten Wochentagen |
| [Bald leer und Rückrufe](kitchen.md#bald-leer-und-rückrufe) | bald leer, Rückrufwarnungen, Wechsel fällig |
| [Am Kühlschrank und an den Fächern](kitchen.md#am-kühlschrank-und-an-den-fächern) | eine Ansage, wenn die Kühlschranktür aufgeht und heute etwas abläuft; was in einem gescannten Fach liegt |

Daneben bekommt das scannende Handy nach einem NFC-Scan eine Benachrichtigung (Einstellung *NFC: Handy benachrichtigen*), und die [Übersichts-Sensoren](reference.md#übersichts-sensoren) gehen in eigenen Automationen.

## Deine Daten

Alles liegt lokal in Home Assistant (`.storage/larder.*` und die Entitäten). Online geht Larder nur für: Strichcodes (Open Food Facts und seine Schwester-Datenbanken), Preisschätzungen ([Open Prices](https://prices.openfoodfacts.org)) und Rückrufwarnungen (lebensmittelwarnung.de). Die **KI** ist optional und läuft über die Integration *AI Task* von Home Assistant mit dem Anbieter, den du gewählt hast: Rezeptideen bekommen Inhalte, Mengen, Resttage und Lagerorte; Fotos (Rezept, Kassenbon, MHD, Gutschein) werden einmal geschickt und gleich wieder gelöscht. **Mehr → 📦 Export und Import** exportiert Bestand und Verlauf als CSV und sichert die gemerkten Schätzungen.
