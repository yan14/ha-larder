# Zwilling Food Storage

Home-Assistant-Integration für Zwilling-Frischhaltedosen mit QR-Code. Pro Dose entsteht ein Gerät (eindeutig über den Parameter `cc` im QR-Code) mit:

| Entität | Typ | Zweck |
| --- | --- | --- |
| **Befüllt am** | `datetime` | Wann wurde die Dose befüllt? |
| **Inhalt** | `text` | Was ist in der Dose? |
| **Behälter leeren** | `button` | Setzt den **Inhalt** auf leer (das Datum „Befüllt am“ bleibt unverändert) |

Die Werte bleiben über Neustarts erhalten. „Behälter leeren“ ist eine normale Button-Entität, lässt sich also auf Dashboards und in Automationen über `button.press` verwenden.

## Installation über HACS

1. HACS → Drei-Punkte-Menü → **Benutzerdefinierte Repositories**
2. URL: `https://github.com/yan14/ha-zwilling-storage`, Kategorie **Integration**
3. „Zwilling Food Storage“ installieren, Home Assistant neu starten.

## Dose anlegen

Einstellungen → Geräte & Dienste → **Integration hinzufügen** → „Zwilling Food Storage“. Dort den Inhalt des QR-Codes einfügen, z. B.

```
zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL
```

Es reicht auch nur die ID (`cc`, hier `34OL`). Optional kannst du einen Namen vergeben. Jede Dose lässt sich nur einmal anlegen.

Der QR-Code lässt sich im Dialog nicht direkt scannen, weil Home Assistant dafür keine Kamera-Funktion anbietet. Unter iOS gehst du so vor:

## QR-Code unter iOS scannen

Der Code enthält einen Link mit dem Schema `zwilling://`, der zur (eingestellten) Zwilling-App gehört. Die **Kamera-App ist dafür ungeeignet**: Sie will den Link in der Zwilling-App öffnen und liefert den Text nicht zum Kopieren. Stattdessen liest ein Kurzbefehl den Text aus und legt ihn in die Zwischenablage.

**Kurzbefehl einmalig anlegen** (App „Kurzbefehle“):

1. Neuer Kurzbefehl, Aktion **„QR-/Barcode scannen“** (englisch *Scan QR/Bar Code*) hinzufügen.
2. Aktion **„In Zwischenablage kopieren“** (*Copy to Clipboard*) hinzufügen.
3. Optional als dritte Aktion **„App öffnen“** mit der **Home Assistant** Companion App.
4. Namen vergeben, z. B. „Dose scannen“. Über das Teilen-Symbol lässt er sich zum Home-Bildschirm hinzufügen oder auf die Aktionstaste legen.

**Dose anlegen:**

1. Kurzbefehl starten und den QR-Code auf der Dose scannen. Beim ersten Start fragt iOS nach dem Kamerazugriff.
2. In der Home Assistant App: **Einstellungen → Geräte & Dienste → Integration hinzufügen → „Zwilling Food Storage“**. Als Abkürzung öffnet der Link [Integration hinzufügen](https://my.home-assistant.io/redirect/config_flow_start?domain=zwilling_storage) den Dialog direkt, sofern „My Home Assistant“ bei dir aktiv ist.
3. Ins Feld **QR-Code-Inhalt oder ID** lange tippen und **Einsetzen** wählen. Fragt iOS „Einsetzen erlauben?“, bestätige mit **Erlauben**.
4. Optional einen Namen eingeben, absenden. Das Gerät mit seinen drei Entitäten ist angelegt.

Der Kurzbefehl liest nur den Text und öffnet den Link nicht, die Zwilling-App wird dafür nicht benötigt.

## Entwicklung

```
pip install -r requirements_test.txt
pytest
```
