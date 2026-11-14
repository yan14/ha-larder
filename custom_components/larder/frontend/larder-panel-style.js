/** Karten und Dialoge (larder-panel.js): Stylesheet (wird in das Shadow DOM eingefügt). */
export const STYLE = `
  :host { display: block; min-height: 100%; background: var(--primary-background-color);
    color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  header { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px;
    background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
    position: sticky; top: 0; z-index: 2; box-sizing: border-box; }
  header h1 { font-size: 20px; font-weight: 400; margin: 0; flex: 1; }
  header .count { opacity: .85; font-size: 14px; }
  #menu { display: none; background: none; border: 0; color: inherit; font-size: 24px; cursor: pointer; padding: 4px 8px; }
  :host([narrow]) #menu { display: inline-block; }
  main { padding: 16px; max-width: 1400px; margin: 0 auto; box-sizing: border-box; }
  h2.area { font-size: 15px; font-weight: 500; margin: 20px 4px 8px; color: var(--secondary-text-color);
    text-transform: uppercase; letter-spacing: .04em; }
  h2.area:first-child { margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .card { background: var(--card-background-color, #fff); border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .card .head { display: flex; align-items: baseline; gap: 8px; }
  .card .name { font-size: 18px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card a.open { font-size: 13px; color: var(--primary-color); cursor: pointer; text-decoration: none; white-space: nowrap; }
  .card .arealine { font-size: 13px; color: var(--secondary-text-color); margin-top: -6px; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; row-gap: 2px; column-gap: 0; }
  .row label { grid-column: 1 / -1; font-size: 13px; color: var(--secondary-text-color); }
  .row input { min-width: 0; font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; color-scheme: light dark; }
  .row input:disabled { opacity: .5; }
  .row .badge, .row button.now { margin-left: 8px; }
  .row button.now { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .badge { display: none; font-size: 12px; padding: 2px 8px; border-radius: 10px; color: #fff; white-space: nowrap; }
  .badge.expired { display: inline-block; background: var(--error-color, #db4437); }
  .badge.soon { display: inline-block; background: var(--warning-color, #ffa600); }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .actions .spacer { flex: 1; }
  button.empty { font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 0;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  button:disabled { opacity: .5; cursor: default; }
  .qr { width: 72px; height: 72px; border-radius: 6px; background: #fff; display: none; image-rendering: pixelated; }
  .qr.visible { display: block; }
  .row select { grid-column: 1 / -1; min-width: 0; font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; box-sizing: border-box; }
  .row.arearow { display: none; }
  .row.arearow.visible { display: grid; }
  .arealine.hidden { display: none; }
  header button.add, header button.ideas { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid currentColor; background: none; color: inherit; display: none; }
  header button.add.visible, header button.ideas.visible { display: inline-block; }
  header button.ideas { margin-right: 8px; }
  .dialog .hint { margin: 0; font-size: 13px; color: var(--secondary-text-color); }
  .dialog .recipeopts { display: flex; gap: 12px; }
  .dialog .recipeopts .field { flex: 1; }
  .dialog .recipelist { display: flex; flex-direction: column; gap: 12px; max-height: 45vh; overflow-y: auto; }
  .dialog .recipelist:empty { display: none; }
  .dialog .recipelist .msg { font-size: 14px; color: var(--secondary-text-color); }
  .dialog .recipe h3 { margin: 0 0 4px; font-size: 16px; font-weight: 500; }
  .dialog .recipe h3 .meta { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); margin-left: 6px; }
  .dialog .recipe .line { font-size: 13px; color: var(--secondary-text-color); }
  .dialog .recipe ol { margin: 6px 0 0; padding-left: 20px; font-size: 14px; }
  .notice { background: var(--card-background-color, #fff); border-left: 4px solid var(--warning-color, #ffa600);
    padding: 12px 16px; margin: 0 0 16px; border-radius: 6px; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center;
    justify-content: center; z-index: 10; padding: 16px; box-sizing: border-box; }
  .overlay[hidden] { display: none; }
  .dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 12px;
    padding: 20px; width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
  .dialog h2 { margin: 0; font-size: 20px; font-weight: 500; }
  .dialog .field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--secondary-text-color); }
  .dialog .field[hidden] { display: none; }
  .dialog input[type="text"], .dialog input[type="number"], .dialog input[type="date"], .dialog input[type="datetime-local"], .dialog select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px; box-sizing: border-box; }
  .dialog .modes { display: flex; flex-direction: column; gap: 6px; color: var(--primary-text-color); font-size: 15px; }
  .dialog .error { color: var(--error-color, #db4437); font-size: 14px; min-height: 1em; }
  .dialog .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  .dialog .buttons button { font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 0; }
  .dialog .buttons button.cancel { background: none; color: var(--primary-color); }
  .dialog .buttons button.submit { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .row.vacrow label.check, .row.shoprow label.check, .row.flexrow label.check { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; font-size: 14px;
    color: var(--primary-text-color); cursor: pointer; }
  .estimaterow { display: none; flex-direction: column; gap: 4px; margin-top: -4px; }
  .estimaterow.visible { display: flex; }
  .estimaterow button.estimate { align-self: flex-start; font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px;
    cursor: pointer; border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .estimaterow .tip { font-size: 13px; color: var(--secondary-text-color); }
  .estimaterow .tip.error { color: var(--error-color, #db4437); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .toolbar[hidden] { display: none; }
  .toolbar input, .toolbar select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; min-width: 0; }
  .toolbar input { flex: 1 1 180px; }
  .toolbar select { flex: 0 1 auto; }
  .qty { display: flex; gap: 8px; flex: 1; min-width: 0; }
  .qty input { flex: 1; min-width: 0; }
  .qty select { flex: 1; min-width: 0; }
  .qty button.take { flex: 0 0 auto; font: inherit; font-size: 15px; padding: 4px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .lastrow { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: -4px; }
  .lastrow[hidden] { display: none; }
  .lastrow .lasttext { flex: 1; }
  .allergen-warning { font-size: 13px; font-weight: 600; color: var(--error-color, #c62828); }
  .allergen-warning[hidden] { display: none; }
  .compchips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; grid-column: 1 / -1; }
  .compchips[hidden] { display: none; }
  .compchip { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 14px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  .olderhint { font-size: 13px; color: var(--warning-color, #f57c00); font-weight: 500; }
  .olderhint[hidden] { display: none; }
  details.nutrition { font-size: 13px; }
  details.nutrition[hidden] { display: none; }
  details.nutrition summary { cursor: pointer; color: var(--primary-color); }
  details.nutrition .nutgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  details.nutrition label { display: flex; flex-direction: column; gap: 2px; color: var(--secondary-text-color); min-width: 0; }
  details.nutrition label.wide { grid-column: 1 / -1; }
  details.nutrition input, details.nutrition select, details.nutrition textarea { font: inherit; font-size: 14px; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; min-width: 0; box-sizing: border-box; }
  details.nutrition .source { margin-top: 6px; color: var(--secondary-text-color); font-size: 12px; }
  .outcomerow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
  .outcomerow[hidden] { display: none; }
  .outcomerow .otext { flex: 1 1 100%; }
  .outcomerow button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  details.history { font-size: 13px; color: var(--secondary-text-color); }
  details.history summary { cursor: pointer; color: var(--primary-color); }
  details.history ul { margin: 6px 0 0; padding-left: 18px; }
  .lastrow button { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .lastrow button.lastempty { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .quickrow { display: none; gap: 8px; margin-top: -4px; }
  .quickrow.visible { display: flex; }
  .quickrow button { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .quickrow button:disabled { opacity: .5; cursor: default; }
  .nfcrow { display: none; align-items: center; gap: 8px; font-size: 13px; color: var(--secondary-text-color); }
  .nfcrow.visible { display: flex; }
  .nfcrow .nfcstate { flex: 1; }
  .nfcrow button { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .card.flash { animation: zwflash 3s ease-out; }
  @keyframes zwflash { 0%, 60% { box-shadow: 0 0 0 4px var(--primary-color); } 100% { box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); } }
  .dialog .check { flex-direction: row; align-items: center; gap: 8px; color: var(--primary-text-color); }
  .dialog .contentline { display: flex; gap: 8px; }
  .dialog .contentline input { flex: 1; min-width: 0; }
  .dialog button.photo { flex: 0 0 auto; font-size: 16px; padding: 0 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; }
  .dialog button.barcode { flex: 0 0 auto; font-size: 13px; font-weight: 500; padding: 0 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  .dialog .barcodestatus { font-size: 13px; color: var(--secondary-text-color); margin: -4px 0 0; }
  .dialog .check[hidden] { display: none; }
  .actions button.fill { display: none; }
  .actions button.fill.visible { display: inline-block; font: inherit; padding: 7px 14px; border-radius: 8px; cursor: pointer;
    background: none; color: var(--primary-color); border: 1px solid var(--primary-color); }
  .actions button.transfer { font: inherit; padding: 7px 14px; border-radius: 8px; cursor: pointer;
    background: none; color: var(--primary-color); border: 1px solid var(--primary-color); }
  .actions button.transfer[hidden] { display: none; }
  .actions button.move { font: inherit; padding: 7px 14px; border-radius: 8px; cursor: pointer;
    background: none; color: var(--primary-color); border: 1px solid var(--primary-color); }
  .actions button.openpack { font: inherit; padding: 7px 14px; border-radius: 8px; cursor: pointer;
    background: none; color: var(--primary-color); border: 1px solid var(--primary-color); }
  .actions button.openpack[hidden], .openedline[hidden] { display: none; }
  .openedline { font-size: 13px; font-weight: 500; color: var(--primary-color); }
  .actions button.move[hidden], .row.minrow[hidden] { display: none; }
  .actions { flex-wrap: wrap; }
  .row.minrow input { max-width: 90px; }
  .row.minrow .stockinfo { font-size: 13px; color: var(--secondary-text-color); }
  .dialog .nfcstatus { font-size: 14px; color: var(--secondary-text-color); }
  .dialog .nfcstatus[hidden] { display: none; }
  header .count { white-space: nowrap; }
  /* Eingebetteter Modus (im Dashboard): nur die Dialoge, oder mit Attribut "only" die Karte einer Dose. */
  #back { display: none; background: none; border: 0; color: inherit; font-size: 24px; cursor: pointer; padding: 4px 8px; }
  :host([embedded]) { min-height: 0; background: none; }
  :host([embedded]) header, :host([embedded]) .toolbar { display: none; }
  :host([embedded]:not([only]):not([show])) main { display: none; }
  :host([embedded][show]) main { padding-top: 4px; }
  :host([embedded][only]) header { display: flex; }
  :host([embedded][only]) #back { display: inline-block; }
  :host([embedded][only]) #menu, :host([embedded][only]) .count, :host([embedded][only]) .tabs,
  :host([embedded][only]) header button.ideas, :host([embedded][only]) header button.add { display: none !important; }
  /* Schmale Fenster (Handy, Tablet hochkant): zweizeilige Kopfleiste statt überstehender Schaltflächen.
     Zeile 1: Menü, Titel, Anzahl, "Dose hinzufügen"; Zeile 2: Reiter und "Rezeptideen". */
  @media (max-width: 960px) {
    header { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 0 10px;
      height: auto; min-height: 56px; padding: 8px 12px; }
    header #menu { grid-column: 1; grid-row: 1; padding: 4px 6px; }
    header h1 { grid-column: 2; grid-row: 1; flex: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    header .count { grid-column: 3; grid-row: 1; }
    header button.add { grid-column: 4; grid-row: 1; white-space: nowrap; }
    header .tabs { grid-column: 1 / 4; grid-row: 2; margin-top: 8px; }
    header button.ideas { grid-column: 4; grid-row: 2; margin: 8px 0 0; white-space: nowrap; }
    header .tabs button { padding: 6px 10px; }
  }
  header .tabs { display: none; gap: 4px; }
  header .tabs.visible { display: flex; }
  header .tabs button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid transparent; background: none; color: inherit; opacity: .8; }
  header .tabs button.active { border-color: currentColor; opacity: 1; }
  #estimates { display: flex; flex-direction: column; gap: 12px; }
  #estimates[hidden], #content[hidden] { display: none; }
  #estimates h2 { margin: 0; font-size: 20px; font-weight: 400; }
  #estimates .intro { margin: 0; font-size: 14px; color: var(--secondary-text-color); }
  .est { background: var(--card-background-color, #fff); border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.2)); padding: 12px 16px; display: grid; gap: 8px 12px;
    grid-template-columns: minmax(0, 1fr) 90px; align-items: end; }
  .est .what { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .est .what .name { font-size: 16px; font-weight: 500; }
  .est .what .meta { font-size: 13px; color: var(--secondary-text-color); }
  .est .f { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--secondary-text-color); min-width: 0; }
  .est input[type="text"], .est input[type="number"], .est select { font: inherit; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 6px;
    padding: 6px 8px; box-sizing: border-box; min-width: 0; width: 100%; }
  .est.suggest { border: 1px solid var(--primary-color); }
  .est.suggest h3 { grid-column: 1 / -1; margin: 0; }
  .est.suggest .intro { grid-column: 1 / -1; margin: 0; }
  .est .sugg { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--divider-color); }
  .est .sugg .btns { display: flex; gap: 8px; justify-content: flex-end; }
  .est .btns { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; }
  .est .btns button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer; border: 0; }
  .est .btns button.save { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .est .btns button.del { background: none; color: var(--error-color, #db4437); border: 1px solid var(--divider-color); }
  .est.new { border: 1px dashed var(--divider-color); box-shadow: none; }
  .est.new h3 { grid-column: 1 / -1; margin: 0; font-size: 15px; font-weight: 500; }
  .est .check { display: flex; align-items: center; gap: 6px; font-size: 14px; color: var(--primary-text-color); }
  .none { text-align: center; padding: 48px 16px; color: var(--secondary-text-color); }
  .none h2 { color: var(--primary-text-color); font-weight: 400; }
  .none a { color: var(--primary-color); cursor: pointer; }
`;
