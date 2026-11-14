/** Larder-Dashboard: Stylesheet (wird in das Shadow DOM eingefügt). */
export const STYLE = `
  :host { position: relative; display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; background: var(--primary-background-color);
    color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
  [hidden] { display: none !important; }
  header { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 56px; box-sizing: border-box;
    background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
    position: sticky; top: 0; z-index: 2; }
  header h1 { flex: 1; font-size: 20px; font-weight: 400; margin: 0; }
  header button { background: none; border: 0; color: inherit; font-size: 22px; cursor: pointer; padding: 4px 8px; }
  #menu { display: none; }
  :host([narrow]) #menu { display: inline-block; }
  main { flex: 1; padding: 12px 16px 16px; box-sizing: border-box; display: flex; flex-direction: column; }
  main > * { flex: 0 0 auto; }
  main > .selbar { margin-top: auto; }
  :host([classic-view]) main { flex: none; padding-bottom: 0; }
  :host([classic-view]) larder-panel-embedded { flex: 1; }
  .menu { position: absolute; top: 52px; right: 8px; z-index: 5; display: flex; flex-direction: column; min-width: 220px;
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .2); overflow: hidden; }
  .menu button { font: inherit; font-size: 15px; text-align: left; padding: 12px 16px; border: 0; background: none;
    color: var(--primary-text-color); cursor: pointer; }
  .menu button + button { border-top: 1px solid var(--divider-color); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
  .bar .grow { flex: 1; }
  .bar.ai select { flex: 1 1 40%; min-width: 0; }
  .bar.ai button { flex: 1 1 100%; }
  .bar.search input { flex: 1; min-width: 0; font: inherit; font-size: 15px; padding: 8px 14px; border-radius: 18px;
    border: 1px solid var(--divider-color); background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  .notice { margin: 12px 16px 0; padding: 10px 14px; border-radius: 12px; font-size: 14px; cursor: pointer;
    background: var(--warning-color, #ffa600); color: #000; }
  .notice button { font: inherit; font-size: 13px; margin-left: 8px; padding: 4px 10px; border-radius: 14px; cursor: pointer;
    border: 1px solid rgba(0, 0, 0, .4); background: rgba(255, 255, 255, .6); color: #000; }
  .dialog .choices { display: flex; flex-direction: column; gap: 8px; }
  .dialog button.choice { display: grid; grid-template-columns: 36px 1fr; column-gap: 10px; text-align: left; font: inherit; cursor: pointer;
    padding: 10px 12px; border-radius: 12px; border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  .dialog button.choice .ico { grid-row: 1 / 3; font-size: 26px; align-self: center; }
  .dialog button.choice .name { font-size: 16px; }
  .dialog button.choice .sub { font-size: 12px; color: var(--secondary-text-color); }
  .dialog .itemrows { display: flex; flex-direction: column; gap: 10px; max-height: 45vh; overflow: auto; }
  .dialog .itemrow { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--divider-color); }
  .dialog .itemmain, .dialog .itemsub { display: flex; gap: 6px; align-items: center; }
  .dialog .itemsub { flex-wrap: wrap; }
  .dialog .itemsub label.datelabel { flex: 1 1 100%; flex-direction: row; align-items: center; gap: 8px; font-size: 12px; }
  .dialog .itemmain input { flex: 1; min-width: 0; }
  .dialog .itemsub input[type="number"] { width: 72px; min-width: 0; }
  .dialog .itemsub select { min-width: 0; flex: 1; }
  .dialog .itemsub input[type="date"] { flex: 1; min-width: 0; }
  .dialog .itemsub label.times { flex-direction: row; align-items: center; gap: 4px; }
  .dialog .itemsub label.times input { width: 52px; }
  .dialog button.remove { font: inherit; border: 0; background: none; color: var(--secondary-text-color); cursor: pointer; padding: 6px; }
  .dialog ul.created { margin: 0; padding-left: 18px; font-size: 14px; max-height: 30vh; overflow: auto; }
  .dialog p.nfcitem { margin: 0; font-size: 17px; }
  .dialog .buttons { flex-wrap: wrap; }
  .tile .kindmark { position: absolute; top: 6px; left: 8px; font-size: 13px; opacity: .8; }
  p.count { margin: -4px 0 10px; font-size: 13px; color: var(--secondary-text-color); }
  .bar select, .bar button { font: inherit; font-size: 14px; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 18px; padding: 7px 12px; cursor: pointer; }
  .bar button.icon { padding: 6px 12px; font-size: 16px; line-height: 1.2; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; padding: 5px 6px 5px 12px; border-radius: 16px;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .chip button { background: none; border: 0; color: inherit; font-size: 15px; cursor: pointer; padding: 0 6px; }
  h2 { font-size: 15px; font-weight: 500; margin: 18px 0 8px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
  h2:first-child { margin-top: 0; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; }
  .tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; text-align: center;
    font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff); border: 1px solid var(--divider-color);
    border-radius: 14px; padding: 12px 6px 10px; min-height: 104px; cursor: pointer; box-sizing: border-box; min-width: 0; }
  .tile .ico { font-size: 30px; line-height: 1.1; }
  .tile .name { font-size: 14px; font-weight: 500; max-width: 100%; line-height: 1.2; overflow: hidden; overflow-wrap: anywhere; hyphens: auto;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .tile .sub { font-size: 11px; color: var(--secondary-text-color); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile .kcal { font-size: 10px; color: var(--secondary-text-color); margin-top: 2px; }
  .tile .allergen { font-size: 10px; color: var(--error-color, #c62828); font-weight: 600; margin-top: 2px; }
  .tile.empty { opacity: .65; border-style: dashed; }
  .tile.selected, .row.selected { outline: 3px solid var(--primary-color); outline-offset: -3px; opacity: 1; }
  .tile .check, .row .check { position: absolute; top: 6px; right: 8px; font-size: 16px; color: var(--primary-color); }
  .row { position: relative; }
  .selbar { position: sticky; bottom: calc(57px + env(safe-area-inset-bottom, 0px)); z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin: 12px -16px -16px; padding: 10px 16px; background: var(--card-background-color, #fff); border-top: 1px solid var(--divider-color); }
  .selbar .count { flex: 1; font-size: 14px; color: var(--secondary-text-color); min-width: 90px; }
  .selbar button { font: inherit; font-size: 14px; border-radius: 18px; padding: 7px 12px; cursor: pointer;
    background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  .selbar button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .bar button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; color: #fff; white-space: nowrap; background: var(--secondary-text-color); }
  .badge.soon { background: var(--warning-color, #ffa600); }
  .badge.expired { background: var(--error-color, #db4437); }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 12px; text-align: left; font: inherit; color: var(--primary-text-color);
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 12px; cursor: pointer; width: 100%; box-sizing: border-box; }
  .row .ico { font-size: 24px; }
  .row .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .row .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .sub { font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.empty { opacity: .65; }
  .note { color: var(--secondary-text-color); font-size: 14px; margin: 8px 0; }
  .scanpanel { margin: 0 0 12px; }
  .inventory { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 14px; }
  .inventory .lead { margin: 0 0 4px; }
  .inventory button { font: inherit; font-size: 14px; border-radius: 18px; padding: 6px 12px; cursor: pointer; margin: 6px 8px 0 0;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-color); }
  ul.missing { margin: 4px 0; padding-left: 20px; font-size: 14px; }
  .dialog .buttons.outcome { flex-wrap: wrap; }
  .scanpanel .note { margin: 6px 0 0; }
  .segment { display: flex; border: 1px solid var(--divider-color); border-radius: 20px; padding: 3px; background: var(--card-background-color, #fff); touch-action: pan-y; }
  .segment button { flex: 1; font: inherit; font-size: 14px; border: 0; border-radius: 16px; padding: 8px 10px; cursor: pointer;
    background: transparent; color: var(--primary-text-color); transition: background .15s; }
  .segment button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  div.note p { margin: 0 0 6px; }
  div.note button { font: inherit; font-size: 14px; border-radius: 18px; padding: 7px 12px; cursor: pointer; margin-top: 2px;
    background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  .hello { font-size: 26px; font-weight: 400; margin: 4px 0 14px; }
  .lead { font-size: 16px; margin: 0 0 12px; }
  .tiles + .lead { margin-top: 22px; }
  .help { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; max-width: 420px; }
  .help button, button.primary { font: inherit; font-size: 15px; padding: 11px 14px; border-radius: 10px; cursor: pointer; text-align: left;
    background: var(--card-background-color, #fff); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
  button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border: 0; text-align: center; }
  button:disabled { opacity: .5; cursor: default; }
  nav { position: sticky; bottom: 0; z-index: 2; display: flex; background: var(--card-background-color, #fff);
    border-top: 1px solid var(--divider-color); padding-bottom: env(safe-area-inset-bottom, 0); }
  nav button { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 2px 7px; font: inherit; font-size: 11px;
    background: none; border: 0; color: var(--secondary-text-color); cursor: pointer; min-width: 0; }
  nav button .ico { font-size: 20px; line-height: 1.1; }
  nav button.active { color: var(--primary-color); font-weight: 500; }
  nav button span:last-child { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recipe { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .recipe h3 { margin: 0; font-size: 16px; font-weight: 500; display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
  .recipe h3 .meta { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  .recipe .tag { font-size: 11px; color: var(--secondary-text-color); }
  .recipe .body { margin-top: 8px; font-size: 14px; }
  .recipe .body h4 { margin: 10px 0 4px; font-size: 13px; color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .04em; }
  .recipe ul, .recipe ol { margin: 0; padding-left: 20px; }
  .recipe .actions { display: flex; gap: 8px; margin-top: 12px; }
  .recipe .actions button { font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 8px; cursor: pointer; background: none;
    color: var(--primary-color); border: 1px solid var(--primary-color); }
  .recipe .actions button.danger { color: var(--error-color, #db4437); border-color: var(--error-color, #db4437); }
  .error { color: var(--error-color, #db4437); font-size: 14px; margin: 8px 0; }
  .overlay { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .5); padding: 16px; }
  .dialog { background: var(--card-background-color, #fff); color: var(--primary-text-color); border-radius: 14px; padding: 18px;
    width: 100%; max-width: 460px; max-height: 90vh; overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
  .dialog h2 { margin: 0; font-size: 18px; text-transform: none; letter-spacing: 0; color: var(--primary-text-color); }
  .dialog label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  .dialog input, .dialog textarea { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; color-scheme: light dark; }
  .dialog textarea { min-height: 96px; resize: vertical; }
  .dialog select { font: inherit; color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; }
  .dialog .hint { margin: 0; font-size: 12px; color: var(--secondary-text-color); }
  .dialog a.pdf { align-self: stretch; text-align: center; padding: 12px; border-radius: 10px; font-size: 16px; text-decoration: none;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .dialog .codelist { display: flex; flex-direction: column; gap: 6px; }
  .dialog .coderow { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--divider-color); border-radius: 10px; }
  .dialog .coderow.oldest { border-color: var(--primary-color); }
  .dialog .coderow .text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .dialog .coderow .sub { font-size: 12px; color: var(--secondary-text-color); }
  .dialog .coderow button, .boughtrow button { font: inherit; padding: 6px 14px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--primary-color); background: none; color: var(--primary-color); }
  .dialog .coderow button.primary, .boughtrow button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .dialog p.lead { margin: 0; font-size: 15px; }
  .placetag { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
  .placetag button { font: inherit; padding: 6px 12px; border-radius: 8px; cursor: pointer; border: 1px solid var(--divider-color); background: none; color: inherit; }
  .boughtrow { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--divider-color); }
  .boughtrow:first-of-type { border-top: 0; }
  .boughtrow .name { flex: 1; min-width: 0; }
  .boughtrow button[data-role="bought-dismiss"], .boughtrow button[data-role="again-dismiss"] { border: 0; color: var(--secondary-text-color); padding: 6px 8px; }
  .dialog .compchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .dialog .compchips[hidden] { display: none; }
  .dialog .compchip { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 14px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  .boughtrow .name .sub { display: block; font-size: 12px; color: var(--secondary-text-color); }
  .boughtrow button[data-role="low-dismiss"] { border: 0; color: var(--secondary-text-color); padding: 6px 8px; }
  .stat.recall { border: 2px solid var(--error-color, #db4437); }
  .stat.recall h3 { color: var(--error-color, #db4437); }
  .recallitem { padding: 8px 0; border-top: 1px solid var(--divider-color); }
  .recallitem:first-of-type { border-top: 0; }
  .recallitem .title { font-weight: 500; }
  .recallitem .sub { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; }
  .recallitem .actions { display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-top: 6px; }
  .recallitem .actions a { color: var(--primary-color); }
  .recallitem .actions button { font: inherit; padding: 6px 14px; border-radius: 8px; cursor: pointer; border: 0;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .stat.report p.line { margin: 2px 0; font-size: 14px; }
  .takeform { display: flex; flex-direction: column; gap: 10px; }
  .takeform label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  .takeform select, .takeform input { font: inherit; font-size: 15px; padding: 8px 10px; border-radius: 10px;
    border: 1px solid var(--divider-color); background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  .takeform .compchips, .stocklist .compchips { display: flex; flex-wrap: wrap; gap: 6px; }
  .takeform .compchip { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 14px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  .takeform button.primary, .help button.primary { font: inherit; padding: 10px 16px; border-radius: 10px; cursor: pointer; border: 0;
    background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .takeplace { font-size: 16px; font-weight: 500; }
  .takelist { display: flex; flex-direction: column; gap: 6px; }
  .takerow { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; flex-wrap: wrap;
    background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); }
  .takerow.ok, .takerow.changed { border-color: var(--success-color, #2e7d32); }
  .takerow.gone, .takerow.moved { opacity: .55; }
  .takerow .ico { font-size: 22px; }
  .takerow .text { flex: 1; min-width: 120px; display: flex; flex-direction: column; }
  .takerow .sub { font-size: 12px; color: var(--secondary-text-color); }
  .takerow .acts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .takerow .acts input { width: 60px; font: inherit; padding: 5px 6px; border-radius: 8px; border: 1px solid var(--divider-color);
    background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  .takerow .acts button { font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--primary-color); background: none; color: var(--primary-color); }
  .takerow .acts button.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .takerow .state { font-size: 13px; color: var(--secondary-text-color); }
  .takerow.ok .state, .takerow.changed .state { color: var(--success-color, #2e7d32); font-weight: 500; }
  .stockitem .usage { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
  .stockitem button.link { font: inherit; font-size: 13px; background: none; border: 0; padding: 4px 0; cursor: pointer; color: var(--primary-color); }
  .dialog .itemsub input.price { width: 72px; min-width: 0; }
  .stocklist { display: flex; flex-direction: column; gap: 8px; }
  .stockitem { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 10px 12px; }
  .stockitem.low { border-color: var(--error-color, #c62828); }
  .stockhead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .stockhead .name { flex: 1; font-size: 16px; min-width: 0; }
  .stockhead .count { font-size: 20px; font-weight: 500; }
  .stockhead .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--error-color, #c62828); color: #fff; }
  .stockhead label.stockmin { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--secondary-text-color); }
  .stockhead label.stockmin input { width: 56px; font: inherit; font-size: 15px; padding: 4px 6px; border-radius: 8px;
    border: 1px solid var(--divider-color); background: var(--card-background-color, #fff); color: var(--primary-text-color); }
  .stockitem .sub { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
  .stockitem .places { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .stockitem button.place { font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  p.note.warn { color: var(--error-color, #c62828); }
  .stat { background: var(--card-background-color, #fff); border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
  .stat h3 { margin: 0 0 8px; font-size: 14px; font-weight: 500; color: var(--secondary-text-color); }
  .stat .figs { display: flex; flex-wrap: wrap; gap: 8px 18px; }
  .stat .fig { display: flex; flex-direction: column; min-width: 64px; }
  .stat .fig .num { font-size: 26px; font-weight: 500; line-height: 1.1; }
  .stat .fig .lbl { font-size: 12px; color: var(--secondary-text-color); }
  .stat .fig.eaten .num { color: var(--success-color, #2e7d32); }
  .stat .fig.soon .num { color: var(--warning-color, #f57c00); }
  .stat .fig.expired .num { color: var(--error-color, #c62828); }
  .stat .lead { margin: 10px 0 0; }
  .stat .note { margin: 4px 0 0; }
  .stat ol.rank { margin: 0; padding-left: 20px; }
  .stat ol.rank li { margin: 2px 0; }
  .stat ol.rank .count { color: var(--secondary-text-color); margin-left: 8px; font-size: 13px; }
  .months { display: flex; align-items: flex-end; gap: 10px; height: 120px; }
  .month { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .month .stack { flex: 1; width: 100%; max-width: 34px; display: flex; flex-direction: column; justify-content: flex-end; }
  .month .seg.eaten { background: var(--success-color, #43a047); border-radius: 0 0 4px 4px; }
  .month .seg.thrown { background: var(--error-color, #e53935); border-radius: 4px 4px 0 0; }
  .month .lbl { font-size: 11px; color: var(--secondary-text-color); margin-top: 4px; }
  .dialog .checks { display: flex; flex-direction: column; gap: 6px; max-height: 40vh; overflow: auto; }
  .tiles + .stat, .lead + .stat { margin-top: 16px; }
  ul.plans { list-style: none; margin: 0; padding: 0; }
  ul.plans li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 4px 0; border-top: 1px solid var(--divider-color); }
  ul.plans li:first-child { border-top: 0; }
  ul.plans .day { font-size: 13px; color: var(--secondary-text-color); min-width: 64px; }
  ul.plans .title { font-weight: 500; flex: 1; }
  ul.plans .used { flex-basis: 100%; font-size: 13px; color: var(--secondary-text-color); padding-left: 74px; }
  ul.plans button { background: none; border: 0; cursor: pointer; color: var(--secondary-text-color); font-size: 15px; }
  ul.plans .planactions { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px; padding-left: 74px; }
  ul.plans button.act { font: inherit; font-size: 13px; border: 1px solid var(--divider-color); border-radius: 14px; padding: 3px 10px; color: var(--primary-color); }
  .stat.thaw button { font: inherit; font-size: 14px; border-radius: 18px; padding: 6px 12px; cursor: pointer; margin-top: 6px;
    border: 1px solid var(--primary-color); background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .dialog .download { display: flex; flex-direction: column; gap: 4px; }
  .dialog .download a.pdf { text-align: left; font-size: 15px; }
  .dialog input[type="file"] { font: inherit; font-size: 13px; }
  .dialog label.check { flex-direction: row; align-items: center; gap: 8px; font-size: 14px; color: var(--primary-text-color); }
  .dialog button.link { align-self: flex-start; font: inherit; font-size: 14px; background: none; border: 0; padding: 0;
    color: var(--primary-color); cursor: pointer; }
  .dialog .buttons { display: flex; justify-content: flex-end; gap: 8px; }
  .dialog .buttons button { font: inherit; padding: 8px 16px; border-radius: 8px; cursor: pointer; background: none; border: 0; color: var(--primary-color); }
  .dialog .buttons button.submit { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  larder-panel-embedded[only] { flex: 1; }
`;
