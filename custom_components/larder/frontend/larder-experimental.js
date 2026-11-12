/**
 * Larder experimental: Spielwiese für neue Ideen, optional als zweiter Eintrag in der Seitenleiste.
 *
 * Seit 2.0 ist die frühere experimentelle Oberfläche das normale Larder-Dashboard (larder-dashboard.js).
 * Diese Ansicht erbt davon; neue Funktionen werden hier zuerst ausprobiert, indem Methoden überschrieben werden.
 */
// Mit derselben Versionsangabe laden wie dieses Modul, damit nie eine ältere Kopie aus dem Cache benutzt wird.
const { LarderDashboard } = await import(`./larder-dashboard.js${new URL(import.meta.url).search}`);

export class LarderExperimental extends LarderDashboard {
  static appTitle = "Larder experimental";
}

if (!customElements.get("larder-experimental")) {
  customElements.define("larder-experimental", LarderExperimental);
}
