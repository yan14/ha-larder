# Zwilling Food Storage

Home-Assistant-Integration für Zwilling-Frischhaltedosen mit QR-Code. Pro Dose entsteht ein Gerät (eindeutig über den Parameter `cc` im QR-Code) mit:

- `datetime` **Befüllt am**
- `text` **Inhalt**

Beide Werte bleiben über Neustarts erhalten.

## Installation über HACS

1. HACS → Drei-Punkte-Menü → **Benutzerdefinierte Repositories**
2. URL: `https://github.com/yan14/ha-zwilling-storage`, Kategorie **Integration**
3. „Zwilling Food Storage“ installieren, Home Assistant neu starten.

## Dose anlegen

Einstellungen → Geräte & Dienste → **Integration hinzufügen** → „Zwilling Food Storage“. Den QR-Code-Inhalt einfügen, z. B. `zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL`, oder nur die ID (`cc`). Optional einen Namen vergeben.

Der QR-Code lässt sich nicht direkt im Dialog scannen (HA bietet das im Config Flow nicht). Den Text einfach per Kurzbefehl/Kamera kopieren und einfügen.

## Entwicklung

```
pip install -r requirements_test.txt
pytest
```
