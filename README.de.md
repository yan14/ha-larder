# Zwilling Food Storage

<img src="assets/icon.svg" width="96" align="right" alt="Icon">

🇩🇪 Deutsch · [🇬🇧 English](README.md)

Home-Assistant-Integration für Zwilling-Frischhaltedosen mit QR-Code. Pro Dose entsteht ein Gerät (eindeutig über den Parameter `cc` im QR-Code) mit:

| Entität | Typ | Zweck |
| --- | --- | --- |
| **Befüllt am** | `datetime` | Wann wurde die Dose befüllt? |
| **MHD** | `date` | Mindesthaltbarkeitsdatum |
| **Inhalt** | `text` | Was ist in der Dose? |
| **Behälter leeren** | `button` | Setzt die Dose komplett zurück: **Inhalt** wird leer, **MHD** und **Befüllt am** werden gelöscht. **Vakuum** bleibt bewusst erhalten, es ist eine Eigenschaft der Dose und nicht des Inhalts |
| **Vakuum** | `switch` | Ist die Dose vakuumiert? Standardmäßig an. Für eine normale Box ausschalten. Wird für die KI-Schätzung verwendet |
| **QR-Code** | `image` | QR-Code der Dose als Bild: Scannen mit der Kamera-App öffnet direkt das Gerät in der Home-Assistant-App |

Die Werte bleiben über Neustarts erhalten. „Behälter leeren“ ist eine normale Button-Entität, lässt sich also auf Dashboards und in Automationen über `button.press` verwenden.

Zusätzlich gibt es:

- ein **Dashboard** „Zwilling Dosen“ in der Seitenleiste (siehe [unten](#dashboard-zwilling-dosen)), das alle Dosen zeigt, mit dem du Dosen hinzufügen und alles bearbeiten kannst und das sich selbst aktualisiert,
- einen **Scan-Webhook** für die originalen Zwilling-QR-Codes (iOS-Kurzbefehl, siehe unten).

<p align="center"><img src="docs/images/dashboard-de.png" width="720" alt="Dashboard Zwilling Dosen (Demo-Daten)"></p>

## Installation über HACS

1. HACS → Drei-Punkte-Menü → **Benutzerdefinierte Repositories**
2. URL: `https://github.com/yan14/ha-zwilling-storage`, Kategorie **Integration**
3. „Zwilling Food Storage“ installieren, Home Assistant neu starten.

## Dose anlegen

Einstellungen → Geräte & Dienste → **Integration hinzufügen** → „Zwilling Food Storage“. Dann gibt es zwei Wege:

**Neuen QR Code erstellen**

Für Dosen ohne (lesbaren) Zwilling-Code. Die Integration erzeugt eine neue, eindeutige ID im Format `HA-XXXXXXXX` (8 Zeichen ohne die leicht verwechselbaren 0/O und 1/I). Das Präfix `HA-` hält sie klar von den Zwilling-IDs getrennt (z. B. `34OL`), eine Überschneidung ist damit ausgeschlossen. Du kannst optional einen Namen vergeben. Den QR-Code findest du danach als Bild am Gerät (siehe „QR-Code direkt scannen“).

**Zwilling QR Code einlesen**

Für vorhandene Zwilling-Dosen. Dort den Inhalt des QR-Codes einfügen, z. B.

```
zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL
```

Es reicht auch nur die ID (`cc`, hier `34OL`). Optional kannst du einen Namen vergeben. Jede Dose lässt sich nur einmal anlegen.

Home Assistant bietet im Dialog keine Kamera zum Scannen. Den Text liest du unter iOS mit dem Kurzbefehl aus (nächster Abschnitt) und fügst ihn ein.

Dosen lassen sich auch im Dashboard in der Seitenleiste hinzufügen (Button **+ Dose hinzufügen**), siehe [unten](#dose-im-dashboard-hinzufügen). Das ist der schnellste Weg, sobald die erste Dose existiert.

## QR-Code direkt scannen

Jede Dose hat die Bild-Entität **QR-Code**. Sie enthält einen Link, der die Home-Assistant-App direkt auf die Geräteseite der Dose springen lässt (`homeassistant://navigate/config/devices/device/<Geräte-ID>`). Dafür brauchst du keinen Kurzbefehl.

1. Öffne das Gerät der Dose in Home Assistant (oder das Panel „Zwilling Dosen“, dort ist der QR-Code klein zu sehen) und öffne die Entität **QR-Code**. Bild speichern oder ausdrucken und auf die Dose kleben. Der Inhalt des Codes steht auch im Attribut `qr_content` der Entität.
2. Scanne den Aufkleber mit der Kamera-App. iOS bietet an, den Link in der Home-Assistant-App zu öffnen, und die App zeigt die Dose.

Der Code verweist auf die Geräte-ID in Home Assistant. Wird die Dose gelöscht und neu angelegt, bekommt sie eine neue Geräte-ID, und der Aufkleber muss neu gedruckt werden. Hast du mehrere Home-Assistant-Server in der App, fragt sie beim Öffnen, welcher gemeint ist.

## Dashboard „Zwilling Dosen“

Sobald mindestens eine Dose angelegt ist, erscheint in der Seitenleiste der Eintrag **Zwilling Dosen**. Er braucht keine Konfiguration und zeigt jede Dose auf einer Karte (Screenshot ganz oben):

*Die Screenshots zeigen Demo-Daten. Das Panel passt sich an Theme und Sprache von Home Assistant an (Deutsch und Englisch).*

- Alle Dosen der Integration, gruppiert nach **Bereich** (Area des Geräts) und sortiert nach Name.
- Pro Dose: Bereich, **Inhalt**, **MHD** (mit Hinweis „abgelaufen“ oder „noch n Tage“ ab 3 Tagen davor), **Eingelagert am** (= „Befüllt am“), der Button **Behälter leeren** und der QR-Code als kleines Bild.
- Inhalt, MHD und Datum lassen sich direkt im Panel ändern. „Jetzt“ setzt „Eingelagert am“ auf die aktuelle Zeit.
- Den **Bereich** einer Dose änderst du über das Auswahlfeld auf ihrer Karte, ohne Umweg über die Geräteseite.
- Das Häkchen **Vakuum** schaltet die Vakuum-Eigenschaft der Dose um.
- Ist die [KI-Schätzung](#mhd-schätzen-mit-ki-optional) aktiviert, erscheint unter dem Datum der Button **MHD schätzen**, sobald ein Inhalt eingetragen und noch kein MHD gesetzt ist.
- **+ Dose hinzufügen** (oben rechts) legt eine Dose an: entweder *Neuen QR-Code erstellen* oder *Zwilling-QR-Code einlesen*, mit optionalem Namen und Bereich. Es ist derselbe Ablauf wie unter Einstellungen → Geräte & Dienste.
- Neue Dosen, geänderte Werte und geänderte Bereiche erscheinen sofort, ohne dass du etwas neu laden musst.

Das Panel ist für alle Nutzer sichtbar, aber nur **Administratoren** können Dosen hinzufügen und Bereiche ändern (dieselbe Einschränkung wie in den Einstellungen). Andere Nutzer sehen den Bereich als Text. Es ist kein klassisches Lovelace-Dashboard und lässt sich nicht mit dem Karten-Editor bearbeiten. Dafür aktualisiert es sich selbst.

### Dose im Dashboard hinzufügen

**+ Dose hinzufügen** öffnet einen Dialog:

<p align="center"><img src="docs/images/add-dialog-de.png" width="560" alt="Dialog Dose hinzufügen"></p>

- **Neuen QR-Code erstellen** erzeugt eine neue eindeutige ID. Danach die Karte (oder das Gerät) öffnen und den QR-Code ausdrucken.
- **Zwilling-QR-Code einlesen** braucht den Inhalt des originalen Codes oder nur die ID. Kommst du vom iOS-Kurzbefehl, ist das Feld schon ausgefüllt.
- Name und Bereich sind optional. Beides lässt sich später ändern (den Bereich direkt auf der Karte).

## MHD schätzen mit KI (optional)

Die Integration kann dir ein Mindesthaltbarkeitsdatum vorschlagen. Sie nutzt dafür die Funktion **AI Task** von Home Assistant und arbeitet deshalb mit dem KI-Dienst, den du dort eingerichtet hast (zum Beispiel Anthropic, OpenAI, Google oder ein lokales Ollama). Die Funktion ist **standardmäßig aus**.

**Einrichten**

1. Richte in Home Assistant einen KI-Dienst mit einer *AI Task* ein (Einstellungen → Geräte & Dienste). Dafür braucht es eine Home-Assistant-Version, die die Integration AI Task enthält.
2. Einstellungen → Geräte & Dienste → **Zwilling Food Storage** → bei einer beliebigen Dose **Konfigurieren** → **MHD per KI schätzen** einschalten. Das Feld „KI-Aufgabe“ brauchst du nur, wenn du mehrere eingerichtet hast.
3. Weise jede Dose einem **Bereich** zu, der den Lagerort beschreibt, z. B. „Kühlschrank“, „0-Grad-Fach“, „Gefrierschrank“ oder „Vorratskammer“, und stelle **Vakuum** pro Dose ein.

**Der Lagerort ist der Bereich.** Die KI bekommt den Bereichsnamen und versteht deshalb „0-Grad-Fach“ oder „Gefrierschrank“ von selbst, ebenso Trockenlager wie Nudeln oder Kaffeebohnen in der Vorratskammer. Genauere Hinweise kannst du so mitgeben:

- **Temperatursensor am Bereich:** In den Bereichseinstellungen lässt sich ein Temperatursensor zuweisen. Hat er einen gültigen Wert, wird er mitgegeben (z. B. die echte Temperatur im Gefrierschrank).
- **Label mit Beschreibung:** Weise dem Bereich ein Label zu und schreibe in dessen Beschreibung einen Hinweis, z. B. „ca. -18 °C, Fleisch und Fisch“. Name und Beschreibung werden mitgegeben.

**Benutzen**

Im Dashboard erscheint der Button **MHD schätzen**, sobald ein Inhalt eingetragen und das MHD leer ist. Den Service kannst du auch in Automationen, Skripten oder den Entwicklerwerkzeugen aufrufen:

```yaml
action: zwilling_storage.estimate_best_before
target:
  entity_id: date.dose_34ol_best_before
data:
  apply: true       # false: nur den Vorschlag zurückgeben
  overwrite: false  # true: auch schätzen, wenn schon ein Datum gesetzt ist
response_variable: result
```

Das Ergebnis enthält `best_before`, `days`, `tip` (ein kurzer Lagertipp), `cached` und `applied`. Gezählt wird ab **Befüllt am** (oder ab heute, wenn das leer ist). **Ein bereits gesetztes MHD wird nie überschrieben**, außer du setzt `overwrite`.

**Merken.** Jede Antwort wird für die Kombination *Inhalt + Bereich + Vakuum* gespeichert und nicht erneut abgefragt. Änderst du ein vorgeschlagenes Datum danach selbst, merkt sich die Integration deinen Wert für dieselbe Kombination. Die Daten liegen in `.storage/zwilling_storage.estimator` von Home Assistant.

**Gut zu wissen**

- Gesendet werden nur der Inhaltstext, der Bereichsname mit seinen Hinweisen, Vakuum Ja/Nein und das Befüll-Datum, und zwar an den KI-Dienst, den du gewählt hast. Je nach Anbieter kann das einen kleinen Betrag kosten.
- Die Antwort ist eine vorsichtige **Schätzung, keine Garantie für Lebensmittelsicherheit**. Bei gekauften Produkten ist das aufgedruckte MHD verlässlicher. Gedacht ist die Schätzung vor allem für Selbstgekochtes und Umgefülltes. Schreibe „gekocht“, „geöffnet“ oder „geröstet am …“ in den Inhalt, wenn es darauf ankommt.
- Ohne Bereich wird die Schätzung mit einem Hinweis abgelehnt, sonst würde die KI nur raten.

## iOS-Kurzbefehl für die originalen Zwilling-Codes

Dieser Weg ist für die **aufgedruckten Zwilling-QR-Codes** gedacht. Für selbst erstellte Codes brauchst du ihn nicht, dort scannst du einfach mit der Kamera-App.

Der QR-Code enthält einen Link mit dem Schema `zwilling://`, der zur eingestellten Zwilling-App gehört. Die **Kamera-App ist dafür ungeeignet**: Sie will den Link in der Zwilling-App öffnen und liefert den Text nicht zum Kopieren. Der Kurzbefehl liest dagegen nur den Text aus und öffnet den Link nicht.

### 1. Webhook-URL herausfinden

Einstellungen → Geräte & Dienste → **Zwilling Food Storage** → bei einer Dose **Konfigurieren**. Der Dialog zeigt die Webhook-URL, die nach dem Muster `https://<deine-HA-URL>/api/webhook/<lange-geheime-ID>` aufgebaut ist. Die URL gilt für alle Dosen, du brauchst sie nur einmal. Das Konfigurieren-Fenster kannst du danach mit „Senden“ schließen, es ändert nichts.

Die lange ID ist der Zugriffsschutz, behandle die URL also wie ein Passwort. Welche Adresse vorne steht (intern oder extern), richtet sich nach deiner Home-Assistant-Konfiguration. Unterwegs funktioniert der Kurzbefehl nur mit einer von außen erreichbaren Adresse.

### 2. Kurzbefehl anlegen (einmalig)

App **Kurzbefehle** → neuer Kurzbefehl mit diesen Aktionen, in dieser Reihenfolge:

1. **„QR-/Barcode scannen“** (*Scan QR/Bar Code*)
2. **„Inhalt von URL abrufen“** (*Get Contents of URL*):
   - URL: deine Webhook-URL aus Schritt 1
   - „Mehr anzeigen“ antippen, Methode **POST**, Anfragetext **JSON**
   - „Neues Feld hinzufügen“: Typ **Text**, Schlüssel `code`, Wert: das Ergebnis aus Aktion 1 (die Variable „QR-/Barcode“ aus der Variablenleiste wählen)
3. **„Wörterbuchwert abrufen“** (*Get Dictionary Value*, in der Suche nach „Wörterbuch“ suchen): Schlüssel `app_url`, aus „Inhalt von URL“. Nicht zu verwechseln mit „Gespeicherten Inhalt abrufen“, das ist eine andere Aktion.
4. **„URLs öffnen“** (*Open URLs*): öffnet den Wert aus Aktion 3

Namen vergeben, z. B. „Dose scannen“. Über das Teilen-Symbol lässt er sich zum Home-Bildschirm hinzufügen oder auf die Aktionstaste legen. Beim ersten Lauf fragt iOS nach dem Kamerazugriff und ob der Kurzbefehl die URL aufrufen darf.

### 3. Benutzen

Kurzbefehl starten, QR-Code auf der Dose scannen. Die Home-Assistant-App öffnet sich dann:

- **Dose bekannt:** direkt auf der **Geräteseite** dieser Dose (mit Befüllt am, Inhalt und Behälter leeren).
- **Dose neu:** im Dashboard „Zwilling Dosen“. Dort öffnet sich der Dialog **Dose hinzufügen** mit bereits eingetragenem Code. Optional Name und Bereich eingeben und **Hinzufügen** tippen. Das geht nur mit einem Administrator-Konto, andere Nutzer sehen einen Hinweis mit dem gescannten Code.

Hast du mehrere Home-Assistant-Server in der App, fragt sie beim Öffnen, welcher gemeint ist.

## Webhook-Schnittstelle

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
  "path": "/config/devices/device/0a1b2c…",
  "app_url": "homeassistant://navigate/config/devices/device/0a1b2c…"
}
```

Bei unbekannter Dose ist `known` gleich `false`, `path` und `app_url` zeigen auf das Dashboard mit dem Hinzufügen-Dialog (`/zwilling-storage?add=<ID>`). Enthält die Anfrage keine gültige ID, antwortet der Webhook mit `400` und `{"error": "invalid_code"}`. Der Webhook liest nur und ändert keine Werte.

## Alternativen

Diese Integration verwaltet den **physischen, wiederverwendbaren Behälter** (ein Gerät pro Dose mit eigenem QR-Code). Wenn du lieber **Produkte und Bestände** verwalten möchtest, passen vielleicht diese Projekte besser:

- [Fridge Assistant](https://github.com/MaxGramser/fridge_assistant): Inventar für Kühlschrank, Gefrierschrank und Vorrat mit Barcode-Scan, KI-Haltbarkeitsschätzung und gedruckten Etiketten.
- [Grocy](https://github.com/custom-components/grocy): die Home-Assistant-Integration für den selbst gehosteten Grocy-Server (Bestand, MHD, Einkaufslisten, Aufgaben).

## Entwicklung

```
pip install -r requirements_test.txt
pytest

npm install
npm test        # Tests für das Panel (jsdom)
```

Die Screenshots stammen aus dem echten Panel-Code mit Demo-Daten: Repository per `python -m http.server` bereitstellen, `docs/demo/index.html?lang=de` (oder `en`, mit `&dialog=scan` für den Dialog) öffnen und einen Screenshot machen.
