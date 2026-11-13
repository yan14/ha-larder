# Einstellungen, Reparaturhinweise und Referenz

[← Übersicht](../../README.de.md) · [🇬🇧 English](../en/reference.md)

[Einstellungen](#einstellungen) · [Reparaturhinweise](#reparaturhinweise) · [Referenz](#referenz)

## Einstellungen

Einstellungen → Geräte & Dienste → **Larder** → **Konfigurieren** (bei einer beliebigen Dose; die Einstellungen gelten für alle Dosen):

| Einstellung | Standard | Wirkung |
|---|---|---|
| MHD-Schätzung | Nur Tabelle | Aus, nur Tabelle, Tabelle sonst KI, nur KI, siehe [MHD-Schätzung](best-before.md#mhd-schätzung) |
| KI-Aufgabe | Standard von HA | Welche *AI-Task*-Entität genutzt wird, nur nötig bei mehreren |
| Haltbarkeit nach dem Öffnen | 3 Tage | Der Button **Geöffnet** kürzt das MHD auf so viele Tage |
| Haltbarkeit nach dem Auftauen | 2 Tage | Dasselbe für den Button **Aufgetaut** |
| Zeitraum für Rezeptideen | 3 Tage | Dosen, die in so vielen Tagen ablaufen, gehen in die [Rezeptideen](kitchen.md#rezeptideen) (0 = nur heute) |
| „Läuft bald ab“ ab | 3 Tage | Ab wann eine Dose als „läuft bald ab“ gilt: Hinweis und Filter in den Dashboards, `status` des Sensors, Vorgabe von `larder.get_expiring` |
| Vakuum-Vorbelegung | an | Vorbelegung des Schalters **Vakuum** bei neuen Dosen |
| NFC: Handy benachrichtigen | an | Benachrichtigung auf dem scannenden Handy nach einem [NFC-Scan](scanning.md#nfc-tags) |
| Reparaturhinweise | an | Hinweise unter Einstellungen → System → Reparaturen, siehe [Reparaturhinweise](#reparaturhinweise) |
| Temperaturwarnung | an | Warnung, wenn ein Gefrier- oder Kühlschrank mit Temperatursensor zu lange zu warm ist, siehe [Reparaturhinweise](#reparaturhinweise) |
| Kalender | keiner | [MHD im Kalender](kitchen.md#mhd-im-kalender) |
| Einkaufsliste | keine | [Einkaufsliste](kitchen.md#einkaufsliste) für geleerte Dosen |
| Marke und Packung mit auf die Einkaufsliste | an | „Haferflocken (Kölln, 500 g)“ statt „Haferflocken“, siehe [Einkaufsliste](kitchen.md#einkaufsliste) |
| Allergene im Haushalt | keine | Warnung an Dosen und keine solchen Dosen in Rezeptideen, siehe [Allergene im Haushalt](containers.md#allergene-im-haushalt) |
| Kalender für den Wochenplan | keiner | Geplante Gerichte als ganztägige Termine, siehe [Wochenplan](kitchen.md#wochenplan) |
| Auftauen: Tage vorher | 1 | Auftau-Erinnerung für Dosen im Gefrierschrank, siehe [Wochenplan](kitchen.md#wochenplan) |

Der Dialog zeigt außerdem die **Webhook-URL** für den [iOS-Kurzbefehl](scanning.md#ios-kurzbefehl-für-die-originalen-zwilling-codes).

## Reparaturhinweise

Larder zeigt unter **Einstellungen → System → Reparaturen** Hinweise, wenn Dosen Aufmerksamkeit brauchen. Es gibt einen Hinweis pro Art (mit bis zu zehn Dosen), nicht einen pro Dose:

| Hinweis | Wann |
|---|---|
| **Dosen ohne Bereich** | Eine Dose hat keinen Bereich, die Schätzung weiß also nicht, wo das Essen lagert. |
| **Gefüllte Dosen ohne MHD** | Eine Dose hat einen Inhalt, aber kein MHD. Sie taucht dann weder in der täglichen Zusammenfassung noch im Kalender auf. |
| **Dosen seit über 7 Tagen abgelaufen** | Zeit, sie zu leeren. |

Ein Hinweis verschwindet von selbst, sobald keine Dose mehr betroffen ist (geprüft bei jeder Änderung und einmal täglich). In den [Einstellungen](#einstellungen) lassen sich die Hinweise abschalten („Reparaturhinweise“).

**Beheben** öffnet einen Dialog direkt in den Reparaturen:

- **ohne Bereich**: ein Bereichsfeld pro Dose, Speichern weist sie zu,
- **ohne MHD**: schätzt das MHD für alle (was die Schätzung nicht kennt, bleibt im Hinweis),
- **lange abgelaufen**: Dosen ankreuzen und leeren; sie kommen als weggeworfen in den Verlauf.

**Mehr erfahren** öffnet das Larder-Dashboard: eine Dose direkt, mehrere auf der Behälter-Seite, gefiltert auf genau diese (`/larder?problem=noarea`, `nodate` oder `longexpired`).

**Temperaturwarnung.** Hat ein Bereich einen **Temperatursensor** (Einstellungen → Bereiche → Bereich → Temperatursensor) und ist er nach Name oder Label ein Gefrierschrank, Kühlschrank oder 0-°C-Fach, warnt Larder, wenn er zu lange zu warm ist: Gefrierschrank über −12 °C für 30 Minuten, Kühlschrank über 8 °C bzw. 0-°C-Fach über 6 °C für 60 Minuten. Der Reparaturhinweis nennt die gefüllten Dosen dort; das Ereignis `larder_temperature_warning` (`area_id`, `area`, `temperature`, `limit`, `containers`) ist für eigene Push-Nachrichten oder eine Sirene, `larder_temperature_ok` folgt, wenn es wieder kalt ist (1 °C unter der Grenze). Abschalten mit der Einstellung **Temperaturwarnung**.

## Referenz

### Entitäten

Pro Dose entsteht ein Gerät (eindeutig über die ID, den Parameter `cc` eines Zwilling-QR-Codes) mit:

| Entität | Typ | Zweck |
| --- | --- | --- |
| **Befüllt am** | `datetime` | Wann wurde die Dose befüllt? |
| **MHD** | `date` | Mindesthaltbarkeitsdatum |
| **Inhalt** | `text` | Was ist in der Dose? Attribute: `category` und, falls bekannt, die [Nährwerte](containers.md#nährwerte) (`kcal_100g`, `kcal_portion`, `nutri_score`, `allergens`, `nutrients`, `brand`, `package`, `ean`) |
| **Fach** | `text` | Optionaler Platz im Bereich, z. B. „Schublade 2“. Bleibt beim Leeren; wird geleert, wenn eine variable Dose an ihren Lagerort zurückkommt |
| **Behälter leeren** | `button` | Setzt die Dose komplett zurück: **Inhalt** wird leer, **MHD** und **Befüllt am** werden gelöscht. **Vakuum** bleibt bewusst erhalten, es ist eine Eigenschaft der Dose und nicht des Inhalts |
| **Menge** | `number` | Wie viel in der Dose ist, z. B. 4 (0 = nicht angegeben). Wird von **Behälter leeren** zurückgesetzt |
| **Einheit** | `select` | Einheit der Menge: Portionen (Standard), Stück, Scheiben, Gramm oder Milliliter. Wird von **Behälter leeren** auf Portionen zurückgesetzt. Beides steht im Dashboard, im Befüll-Dialog, im Ergebnis von `get_expiring` und fließt in die Rezeptideen ein. Tipp: *Portionen* für fertige Gerichte (Chili, Suppe), *Stück* oder *Scheiben* für Zählbares (Eier, Schinken) |
| **Vakuum** | `switch` | Ist die Dose vakuumiert? Bei neuen Dosen standardmäßig an; die Vorbelegung änderst du unter **Konfigurieren**, wenn die meisten deiner Boxen nicht vakuumiert sind. Wird für die Schätzung verwendet |
| **Einkaufsliste** | `switch` | Soll der Inhalt beim Leeren der Dose auf deine Einkaufsliste? Standardmäßig aus, pro Dose einstellbar und bleibt bei **Behälter leeren** erhalten. Wirkt erst, wenn unter **Konfigurieren** eine Liste gewählt ist, siehe [Einkaufsliste](kitchen.md#einkaufsliste) |
| **Variabler Lagerort** | `switch` | Für Dosen, die mal hier, mal dort stehen (heute Kühlschrank, morgen 0-Grad-Fach). Standardmäßig aus. Ist er an, fragt der Befüll-Dialog nach dem Bereich, und **Behälter leeren** stellt die Dose zurück in den **Lagerort nach dem Leeren**. Bleibt bei **Behälter leeren** erhalten |
| **Lagerort nach dem Leeren** | `select` | Bereich, in den eine variable Dose beim Leeren zurückkommt (oder *bleibt, wo sie ist*). Wirkt nur, wenn **Variabler Lagerort** an ist. Die Bereichs-ID steht im Attribut `area_id`, Umbenennen des Bereichs schadet also nicht |
| **Tage bis MHD** | `sensor` | Verbleibende Tage bis zum MHD (negativ = abgelaufen). Das Attribut `status` ist `ok`, `soon` (3 Tage oder weniger, siehe [Einstellungen](#einstellungen)), `expired` oder `none` |
| **QR-Code** | `image` | QR-Code der Dose als Bild: Scannen mit der Kamera-App öffnet die Dose im Larder-Dashboard, siehe [Eigene QR-Codes](scanning.md#eigene-qr-codes) |

[Beutel](containers.md#beutel-und-packungen) haben dieselben Entitäten außer **Einkaufsliste**, **Variabler Lagerort** und **Lagerort nach dem Leeren**; [Packungen](containers.md#beutel-und-packungen) haben nur **Inhalt**, **MHD**, **Menge**, **Einheit**, **Tage bis MHD** und **Behälter leeren**. Das Attribut `kind` von **Inhalt** ist `container`, `bag` oder `pack`. **Behälter leeren** entfernt bei einem Beutel oder einer Packung das Gerät.

Die Werte bleiben über Neustarts erhalten. „Behälter leeren“ ist eine normale Button-Entität, lässt sich also auf Dashboards und in Automationen über `button.press` verwenden.

**Einzelnes Feld leeren:** Die Datums-Entitäten von Home Assistant lassen sich im Entitäts-Dialog selbst nicht leeren (der Button „Löschen“ im Datumsfeld bewirkt dort nichts). Nutze stattdessen eines davon: das Feld im Dashboard leeren, **Behälter leeren** für alles zusammen, oder die Services `larder.clear_best_before` bzw. `larder.clear_filled_at` (z. B. in den Entwicklerwerkzeugen oder in einer Automation).

### Dienste und Ereignisse

| Dienst | Wirkung |
|---|---|
| `larder.estimate_best_before` | MHD einer Dose schätzen, siehe [Benutzen](best-before.md#benutzen) |
| `larder.clear_best_before` / `larder.clear_filled_at` | Ein einzelnes Datum leeren |
| `larder.mark_opened` / `larder.mark_thawed` | MHD nach dem Öffnen oder Auftauen kürzen (`days` optional) |
| `larder.get_expiring` | Liste, was bald abläuft, mit fertigem Text, siehe [Tägliche Zusammenfassung](kitchen.md#tägliche-zusammenfassung) |
| `larder.suggest_recipes` | [Rezeptideen](kitchen.md#rezeptideen) aus dem, was bald abläuft, aus allen oder aus gewählten Dosen |
| `larder.get_statistics` | Gegessen / weggeworfen, häufigste Inhalte, Lagerdauer und aktueller Bestand, siehe [Statistik](dashboard.md#statistik) |
| `larder.rebuild_calendar` | [Kalender](kitchen.md#mhd-im-kalender) aufräumen |

Die Einträge von `larder.get_expiring` tragen `kind` (`container`, `bag`, `pack`). Wird der Sticker eines schon geleerten Beutels gescannt, kommt `larder_dose_scanned` mit `retired: true` und einer `message` statt `cc` und `device_id`.

Das Ereignis `larder_dose_scanned` (`cc`, `device_id`, `name`, `scanned_by`) wird ausgelöst, wenn ein verknüpfter [NFC-Tag](scanning.md#nfc-tags) oder einer [deiner QR-Codes](scanning.md#eigene-qr-codes) gescannt wird (dann mit `source: qr`). `larder_temperature_warning` und `larder_temperature_ok` gehören zur [Temperaturwarnung](#reparaturhinweise).

### Webhook-Schnittstelle

Der Webhook ist ein normaler Home-Assistant-Webhook und akzeptiert `POST` (und `GET`).

Anfrage, eine der folgenden Formen:

```
POST /api/webhook/<ID>   {"code": "zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL"}
POST /api/webhook/<ID>   {"cc": "34OL"}
POST /api/webhook/<ID>   zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL   (Klartext)
GET  /api/webhook/<ID>?code=34OL
```

Antwort (`200`, JSON):

```json
{
  "known": true,
  "cc": "34OL",
  "name": "Dose 34OL",
  "device_id": "0a1b2c…",
  "path": "/larder?open=0a1b2c…",
  "app_url": "homeassistant://navigate/larder?open=0a1b2c…",
  "device_path": "/config/devices/device/0a1b2c…",
  "device_app_url": "homeassistant://navigate/config/devices/device/0a1b2c…"
}
```

Bei bekannter Dose öffnen `path` und `app_url` das Dashboard bei dieser Dose (eine leere Dose bekommt gleich den Befüll-Dialog); `device_path` und `device_app_url` zeigen stattdessen auf die Geräteseite. Bei unbekannter Dose ist `known` gleich `false`, `path` und `app_url` zeigen auf das Dashboard mit dem Hinzufügen-Dialog (`/larder?add=<ID>`). Enthält die Anfrage keine gültige ID, antwortet der Webhook mit `400` und `{"error": "invalid_code"}`. Der Webhook liest nur und ändert keine Werte.

Für den Code eines schon geleerten [Beutels](containers.md#beutel-und-packungen) lautet die Antwort `{"known": false, "retired": true, "message": "Beutel 3 (Rehgulasch) wurde am … geleert."}` mit `path` und `app_url` des Dashboards.
