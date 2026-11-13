# Changelog

Release notes for every version, newest first. They are also used as the text of the GitHub releases
(the workflow `release.yml` takes the section of the version in `manifest.json`).

## 2.11.0

- **Product data from the barcode:** brand, package size and EAN are kept along with the name.
- **Nutrition per container:** kcal per 100 g and per portion, Nutri-Score, allergens and nutrients as free text. Filled from Open Food Facts after a scan (credited as source), otherwise entered by hand in the new fold-out **Nutrition** section of the card. kcal on tiles and in the list; attributes of the **Contents** entity; in the CSV and the history; cleared when emptying.

## 2.10.0

- **Add container with options:** the add dialog now also sets **Vacuum**, **Add to shopping list when emptied** and **Flexible storage place** with **After emptying, back to** (also for the NFC ways).
- **Compartment** within an area (new entity, e.g. "drawer 2"): on the card, on tiles and in the list, searchable, sorted with the area, in the CSV and the history; asked in the fill dialog for flexible containers and cleared when they go back after emptying.
- **Barcode of bought food:** **EAN** in the fill dialog (Home Assistant app) scans the package and fills in the product name from Open Food Facts.
- **Labels:** choose what is printed (QR code, container name, contents and best-before date; at least one), four designs (plain, frame, notched corners, vintage) and label printers (62 × 29, 54 × 25, 89 × 36 mm, one label per page). The menu entry is now **🖨 Print labels**.

## 2.9.1

- Fix: translations of the fixable repair hints (hassfest check of 2.9.0 failed); no change in behaviour.

## 2.9.0

- **Meal plan:** **📅 Plan** on a recipe idea or a saved recipe puts a dish on a day, with the containers it needs (pre-ticked from the recipe). The start page shows the next seven days, the recipe page all plans. Optional calendar for the meal plan (all-day event "🍽 …", removed with the plan).
- **Thaw reminder:** containers from the freezer needed for a planned dish appear on the start page and at the top of the daily summary (default one day ahead, setting **Thawing: days ahead**), with a **Thawed** button in the push and in the dashboard; flexible containers then move to the fridge.
- **Inventory after a serial scan:** lists the filled containers that were not scanned; new **🗑 Empty (n)** in the selection (asks eaten / thrown away).
- **Temperature warning:** freezer, fridge or 0 °C drawer with a temperature sensor too warm for too long → repair hint and event `larder_temperature_warning` (setting **Temperature warning**).
- **Repairs:** hints can now be fixed in place (assign areas, estimate dates, empty expired containers); **Learn more** opens the affected containers in the dashboard.
- **Menu:** **⋮** instead of ⚙; statistics and QR labels also for non-administrators. The selection bar now always sits at the bottom of the screen.
- Docs: menu entries were wrongly described as ☰ → … in 2.4.0–2.8.0.

## 2.8.0

- **Statistics** (dashboard **⋮ → 📊 Statistics**): current stock (filled, empty, expiring soon, expired), eaten vs. thrown away with the share thrown away, average storage time until eaten, the contents thrown away and eaten most often, thrown away by area, and the last six months as bars. Period 30 / 90 days, one year or everything.
- New service `larder.get_statistics` with the same data, e.g. for template sensors (example in the README).

## 2.7.0

- **History per container:** every emptying is recorded (contents, quantity, area, filled on, best before, emptied on, days stored, expired or not). The card asks **😋 Eaten / 🗑 Thrown away** before emptying (after **−1** on the last portion it counts as eaten) and shows the last ten fillings under **History**. The whole history can be downloaded as CSV under **⋮ → 📦 Export and import**. Groundwork for statistics.

## 2.6.0

- **Export and import** (dashboard **⋮ → 📦 Export and import**, administrators): the inventory as a CSV table (semicolons in German, for Excel), the remembered estimates as a JSON backup, and importing such a file (own corrections are kept; optionally replace everything).
- **Diagnostics:** "Download diagnostics" on a container's entry (without the webhook ID and without the estimates themselves).
- **Rename a container** with **Reconfigure**; the ID, printed QR codes and NFC tags stay valid.

## 2.5.0

- **Several contents in one container:** separate them with commas, e.g. `Salami, Kochschinken, Leberwurst`. The table estimate looks up each item and takes the shortest best-before date (the tip names the item that decides it); the AI is told to answer for the item that spoils first. The shopping list gets one entry per item, and containers with items of different kinds get the new category **Mixed** 🍱. Remembered table estimates are recalculated once.

## 2.4.0

- **QR label sheet (A4):** **⋮ → 🖨 Print QR labels** (all containers) or **🖨 Labels** in the selection creates a PDF with the QR codes: 3 × 8, 3 × 7 or 2 × 4 labels per sheet, skip labels already used, optionally contents and best-before date, optionally cutting lines for plain paper. The PDF opens via a signed link (valid for five minutes), also in the Home Assistant app.
- **Take one (−1):** on the card of a container, **−1** next to the quantity takes one portion, piece or slice. At the last one it asks whether to empty the container. Not shown for grams and milliliters.

## 2.3.0

- **Daily summary:** expired containers are named with their container and the note *should be emptied*, in the push ("Pizza (Box 3, Fridge): expired 2 days ago, should be emptied") and in the voice output ("Pizza in Box 3 has expired and should be emptied."). Replaces the planned "remind again tomorrow".
- **Manage areas in the dashboard** (administrators): on the **Areas** page **＋** adds an area and **✏️** switches to editing, where you rename areas and set their storage kind (`Larder: …` label, other labels are kept). **New label …** creates a `Larder: …` label right away. Areas with a Larder label are listed even without containers.
- **Repairs:** hints under Settings → System → Repairs for containers without an area, filled containers without a best-before date and containers expired more than 7 days ago. They disappear by themselves; new setting **Repair hints** (on by default) to switch them off.

## 2.2.0

- **📷 Scan container** in the dashboard (Home Assistant app on iOS and **Android**): opens the app's QR scanner for a single scan. Your own codes and the original Zwilling codes both work: a known container opens (an empty one with the fill dialog), a Zwilling code that has not been added yet opens **Add container** with the code filled in. The button is on the start page and next to **＋**. Android users can now use the Zwilling codes without the iOS Shortcut, which stays available.
- README: the section **Adding a container** now lists all four ways, including the NFC ones, and a new section **Scanning in the app**.

## 2.1.0

- **Flexible storage place** for containers that move around (for example vacuum boxes: fridge one day, 0 °C drawer the next): new switch **Flexible storage place** per container (off by default). When it is on, the fill dialog also asks for the **area** (administrators; also when filling several containers at once), so the estimate uses the right place.
- New selection **Storage place after emptying**: the area a flexible container goes back to when it is emptied (or *stays where it is*). The area is remembered by its ID, renaming it does no harm; if the area is deleted the selection goes back to *stays where it is*.
- Both are on the card of the container (the selection only appears while the switch is on) and are kept when the container is emptied.

## 2.0.0

**The new dashboard.** The tile-based dashboard that was tried out as *Larder experimental* is now the normal **Larder** dashboard in the sidebar. The old dashboard is gone as a page of its own; everything it could do is in the new one:

- **Containers** page: search (name, contents, area), filter (expiring soon, expired, filled, empty), sort (best-before date, area, alphabet, category), the number of containers shown, and three views: tiles, list and **cards with all details**. The cards are the ones of the old dashboard with every field to edit (area, contents, quantity and unit, dates with +1 day / Opened / Thawed, estimate, vacuum, shopping list, NFC tag, open device, empty container).
- **⚙** (administrators) opens the **remembered estimates** (the old *Estimates* tab) and the integration settings.
- **Recipes** page: recipe ideas with period and **number of people** (like the old recipe dialog), recipe book, recipes from a photo.
- Scanning an NFC tag while the dashboard is open opens the container (an empty one with the fill dialog); scans and notifications open the new dashboard with the container, the fill dialog or the add dialog (the links `/larder?open=…`, `?add=…` stay the same; `?view=recipes` opens the recipe page).
- Start page, areas, categories, selection of several containers, serial scan with QR codes and NFC tags as before.

**Your own QR codes now work like NFC tags:** scanning one with the camera app opens the container in the Larder dashboard (an empty one with the fill dialog) and fires `larder_dose_scanned` (with `source: qr`). The code contains the ID of the container (`homeassistant://navigate/larder?cc=<ID>`) instead of the device ID, so it stays valid if a container is deleted and added again. **Codes printed before 2.0 still open the device page; print them again for the new behaviour.**

**Larder experimental** stays as an optional second sidebar entry for trying new features; at the moment it is the same as the new dashboard.

Also:

- New WebSocket command `larder/report_scan` (the dashboard reports QR scans).
- Blueprint: the **Recipes** button opens the recipe page of the dashboard by default.
- README rewritten for the new dashboard, with new screenshots.

## 1.11.0

- **Better recognition of contents** (table and category icons): the order of the words no longer matters ("Eier gekocht" are boiled eggs, not raw eggs), compound words count by their last part ("Butterkekse" are cookies, "Zwiebelkuchen" is cake), and fish/meat cuts go by the animal ("Lachsfilet" is fish, not raw meat). "Gehackt" no longer means minced meat ("Spinat gehackt" is spinach, "Gehackte Tomaten" are vegetables). New entries: peas, beans, edamame, corn and more vegetables, flour types (Dinkelmehl Typ 630 …), milk rice, semolina pudding, mashed potatoes, pancakes, more fish.
- Remembered table values from older versions are recalculated on their next use, so wrong values (for example raw eggs for boiled eggs) disappear by themselves. Your own corrections stay. Dates already set on containers are not changed.
- **Daily summary** (blueprint, re-import it): push to several notify actions at once, with **Recipes** and **Dashboard** buttons; optional **voice output** on Alexa (Alexa Media Player, `type: announce`) or other speakers with a notify action, only when someone is home; optionally sent at the **first motion** after a time (for example in the kitchen) with a latest time as fallback, once per day. Closes #11.
- `larder.get_expiring` returns `speech` (sentences to read out) and `labels`; `larder.suggest_recipes` returns `speech` ("Idea: …").
- Links: `/larder-experimental?view=recipes` opens a view of Larder experimental, `/larder?recipes=1` the recipe ideas dialog.

## 1.10.2

- **Serial scan:** a switch **📷 QR code | 📶 NFC** at the top of the containers page changes the scan method; tap or swipe it. NFC closes the app's QR scanner, QR code opens it again. Inside the QR scanner, **Switch to NFC** does the same.

## 1.10.1

- **Serial scan with NFC tags:** closing the QR scanner no longer ends the serial scan, so NFC tags can be scanned afterwards (while the camera is in use the iPhone does not read NFC tags). **📷 Open QR scanner** opens it again, **⏹ Stop scanning** ends the scan. The page explains how NFC works on the iPhone (tap the "Open in Home Assistant" banner).
- While a serial scan is running, an NFC scan no longer sends the Larder notification to the phone (tapping it would have left the page); the scan goes straight to the dashboard (new WebSocket subscription `larder/scan_session`). The `larder_dose_scanned` event still fires.

## 1.10.0

- **Select several containers** (Larder experimental, containers page, **☑ Select**): tap containers to select them, then **Fill (n)** fills all selected empty containers at once with the same contents, dates and vacuum (quantity per container, each gets its own estimate), or **✨ Recipe ideas** asks for recipes from exactly the selected containers. Closes #3.
- **Serial scan** during the selection (**📡 Scan**, administrators): every scanned container is selected, via NFC tags or via the QR scanner of the Home Assistant app, which stays open for one code after the other and confirms each hit. Good for an inventory or after shopping. Closes #9.
- **Recipe ideas from selected containers:** new option `containers` (device IDs) for `larder.suggest_recipes`; the recipe page has a **☑** button to pick containers. Expired and empty containers are still left out. Closes #15.
- The fill dialog of the normal dashboard can fill several containers at once (used by the selection).
- New WebSocket command `larder/resolve_code` (QR content → container).
- **README restructured:** contents, getting started, a table of all settings, areas and labels in one place, scanning and a reference of entities, services and events.

## 1.9.0

- **Recipe from a photo or file** (Larder experimental, recipe page, 📷): take or pick up to four photos of a recipe, or a PDF. The AI reads it through *AI Task*, translates it into your language if needed and opens it as a draft for you to check before it is saved to the recipe book (marked *From a photo*). Photos are shrunk on the device before uploading, stored only briefly in Home Assistant's media folder while the AI reads them, and deleted right after. Needs an AI task that supports attachments. Closes #12.

## 1.8.1

- **Larder experimental:** the page stayed empty after reloading the browser on it. Home Assistant could create the dashboard before its code had finished loading; the values it handed over were then lost. They are now picked up when the dashboard starts.
- **Larder experimental:** the bottom bar now sits at the bottom of the screen also when a page has little content.

## 1.8.0

- **Recipe ideas, period:** the number of days to look ahead is now a setting (*Configure* → *Period for recipe ideas*, default 3). The dashboard dialog starts with it, and the service `larder.suggest_recipes` uses it when `days` is omitted (`days` now accepts up to 365).
- **Larder experimental:** the recipe page has a period selector next to *From leftovers*: the default from the settings, a fixed number of days, or **All containers (no period)**. The last one uses every filled container, also those without a best-before date (service option `all_containers`). The choice is remembered per device.
- Recipe ideas never use expired containers, and now also skip containers that have a date but no contents (their name was sent to the AI as an ingredient before). At most 40 containers are sent, the most urgent first, and over-long AI answers are trimmed so every suggestion can be saved to the recipe book.
- **Calendar:** fixed duplicate and stale events. The cause on **CalDAV** calendars (iCloud, Nextcloud …): Home Assistant's CalDAV calendar can create events but not delete them, so every changed date or content added another event and nothing was ever removed. Larder now reads and deletes its own events directly through the CalDAV connection. Calendars that can neither delete nor be handled this way get no events at all any more and are rejected in the settings.
- The calendar sync is self-healing: it searches the whole calendar for the events of a container, keeps exactly one matching event, deletes all others and only creates a new one if none fits. Each container remembers the ID of its event, so two containers with the same contents on the same day keep one event each, also in calendars that drop the description.
- Only real value changes trigger the calendar sync (no more reactions to attribute-only changes), and a container that is temporarily *unavailable* (for example while Home Assistant starts) no longer removes its event.
- Existing duplicates are cleaned up automatically on the next start or when you save the settings. New service **`larder.rebuild_calendar`** (*Clean up calendar*) re-syncs everything on demand and removes events of containers that no longer exist; with `include_unmarked` it also removes untagged "MHD: …" / "Best before: …" events.
- **"Expiring soon" is a setting** (*Configure* → *"Expiring soon" from*, default 3 days): it drives the hint and the filter in both dashboards, the `status` attribute of the sensor and the default of `larder.get_expiring`.
- **AI estimates:** a pure AI value is capped per storage place (fridge 60 days, 0 °C drawer 90 days, freezer 18 months, pantry 3 years, unknown 1 year) and the tip says so. AI values you never corrected are asked again after 12 months; if the AI cannot be reached, the old value stays. Table values and your own corrections are not affected.
- **Template for the area label:** the description of an area label can follow a fixed template (`Storage: freezer`, `Temperature: -18 °C`, `Max storage: 18 months`, `Notes: …`; German keys work too). `Max storage` sets an upper limit for table and AI estimates in that area, also for remembered ones (your own corrections stay as they are); `Storage` places the area for the table even if its name does not say it. Free text in the description keeps working as before.
- Labels named `Larder: …` (for example `Larder: Freezer`) also mark an area as a storage place for the area picker in the dashboard, so one label per area is enough.
- Internal: settings are handled in one place now, and the calendar sync, the NFC handler and the recipe book are now created exactly once even when Home Assistant sets up all containers at the same time (a second instance could have reacted to every change twice).

## 1.7.1

- **Larder experimental:** fixed the old dashboard showing up below the new one when the browser or the app still had an older copy of the dashboard loaded. The embedded card now comes with its own element name and is always loaded together with the matching version.

## 1.7.0

- **Larder experimental:** a second, optional dashboard (turn it on under *Configure*, it then appears as a second sidebar entry; the normal dashboard is unchanged). Tile-based, made for the phone, with a bottom bar: **Start** (greeting, what to use up soon, shortcuts), **Containers** (tiles or list, sort by best-before date, area, alphabet or category), **Areas**, **Categories** and **Recipes**.
- **Recipe book:** save your own recipes (administrators add, edit and delete, everyone can read) and keep the ones you like from the AI suggestions "from leftovers".
- The **Contents** entity has a new attribute `category` (fish, meat, dairy, dishes, …) taken from the built-in shelf-life table.
- The normal dashboard can show the card of a single container (used by the experimental dashboard for details); nothing changes for you there.

## 1.6.2

- Dashboard header: the two-row layout on narrow screens now follows the screen width (a plain media query) instead of a container query, which is safer on iOS.

## 1.6.1

- Dashboard on phones: the header bar now wraps into two rows on narrow screens (title and **Add container** on top, tabs and **Recipe ideas** below), so nothing sticks out of the screen any more.

## 1.6.0

- **Shopping list:** pick a to-do list (e.g. Shopping list, Todoist, Bring!) under *Configure*. Every container gets a new **Shopping list** switch (off by default) that is also shown in the dashboard and in the fill dialog as "Add to shopping list when emptied". When you empty a container with the switch on, its contents are added to the list. Leftovers such as "pizza leftovers" stay off and are never added. Already open items are not added twice.
- The switch belongs to the container and is kept when it is emptied. Without a chosen list it has no effect and is hidden in the dashboard.

## 1.5.2

- Release notes are now written by hand in `CHANGELOG.md` and shown on every GitHub release (and in the update dialog of Home Assistant). No functional changes.

## 1.5.1

- After adding a new container in the dashboard (any way, including writing an NFC tag), the **Fill container** dialog opens right away, as if you had scanned an empty container.

## 1.5.0

- The area dropdown in the dashboard (container cards and the add dialog) lists only areas that carry the label **Larder**. If no area has it, all areas are shown as before. A container's current area always stays selectable.

## 1.4.0

- **Quantity and unit** per container: portions, pieces, slices, grams or milliliters (new entities *Quantity* and *Unit*, shown on the card, in the fill dialog and in `larder.get_expiring`). Existing portion values are kept.
- **Recipe ideas with AI** (needs the *AI Task* integration): a **Recipe ideas** button in the dashboard, the service `larder.suggest_recipes`, and an **Add recipe ideas** switch in the expiry notification blueprint (re-import the blueprint to get it). Only contents, quantity, remaining days and storage place are sent.

## 1.3.0

- **Thawed** button on every card and the service `larder.mark_thawed`: shortens the best-before date to a few days from today (default 2, setting *Time after thawing*). Never extends a date.
- **Portions** per container (replaced by quantity and unit in 1.4.0).

## 1.2.0

- **Write a new NFC tag** directly when adding a container (Home Assistant Companion app): creates the container, a new tag in Home Assistant and the link in one step, then opens the app's tag writer.

## 1.1.0

- New setting **Vacuum preset for new containers**. Existing containers keep their value.

## 1.0.4

- Docs: highlights list and the story behind the project.

## 1.0.3

- Docs: installation via the Home Assistant 2026.11 Marketplace (HACS is built in there).

## 1.0.2

- Removed the takeover from the old "Zwilling Food Storage" integration, it did not work reliably. Add your containers again after switching.

## 1.0.1

- Docs: screenshot of the iOS Shortcut.

## 1.0.0

- **Renamed to Larder** (domain `larder`, "Home Assistant Larder – Food storage tracker"). This is a new integration: remove the old "Zwilling Food Storage", add Larder and re-add your containers. Update the iOS Shortcut URL and re-import the blueprint.

## 0.10.1

- Docs: new screenshots.

## 0.10.0

- **Quick fill dialog**: an empty container opens a dialog for contents (with suggestions from earlier contents), vacuum, filled-on date and best-before date, optionally with automatic estimate. Also opens after a scan.

## 0.9.0

- **NFC tags**: link a tag to a container and scan it to open the dashboard on that container (notification on the phone, event `larder_dose_scanned` for automations).

## 0.8.0

- **Expiry notifications**: service `get_expiring` and a blueprint for a daily notification.
- Dashboard search, filter and sort.
- Best-before dates can be mirrored to a calendar.
- GitHub releases are created automatically.

## 0.7.0

- Dashboard tab **Estimates**: manage remembered estimates, with their source (table, AI, corrected by you).

## 0.6.0

- Built-in **shelf-life table** as an alternative to the AI estimate (modes: off, table, table then AI, AI).

## 0.5.1

- Fix: clearing the best-before and filled-on dates (dashboard and clear services).

## 0.5.0

- **Vacuum** switch and optional **AI best-before estimate** with a dashboard button.

## 0.4.0

- Dashboard: add containers and change the area. The scan webhook opens the dashboard for unknown containers.

## 0.3.3 – 0.3.1

- Original integration icon, English README, **Empty container** resets contents, best-before and filled-on.

## 0.3.0

- Best-before date, QR code image, flow to create new QR codes, live dashboard in the sidebar.
