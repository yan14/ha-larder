# Changelog

Release notes for every version, newest first. They are also used as the text of the GitHub releases
(the workflow `release.yml` takes the section of the version in `manifest.json`).

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
