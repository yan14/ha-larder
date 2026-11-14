# Home Assistant Larder

**Food storage tracker** · formerly *Zwilling Food Storage*

<img src="assets/icon.svg" width="96" align="right" alt="Icon">

[🇩🇪 Deutsch](README.de.md) · 🇬🇧 English

Home Assistant integration for reusable food storage containers: note what is inside and until when it keeps, get reminded before it expires, and find any container with a scan.

## Highlights

- 🖥️ **[Own dashboard](docs/en/dashboard.md#dashboard-larder)** in the sidebar, made for the phone: start page, containers as tiles, list or cards with every detail, areas, categories and a recipe book; updates itself
- 🔖 **[Zwilling Fresh & Save QR codes](docs/en/scanning.md#scanning-in-the-app)**: the original codes on the lids keep working, with the 📷 scanner in the app (iOS and Android) or an [iOS Shortcut](docs/en/scanning.md#ios-shortcut-for-the-original-zwilling-codes)
- 🏷️ **[Your own QR code](docs/en/scanning.md#your-own-qr-codes)** and **[NFC tags](docs/en/scanning.md#nfc-tags)** for any container: scanning opens the container in the dashboard; QR codes print as an [A4 label sheet](docs/en/scanning.md#label-sheet)
- 🛍 **[Bags and packs](docs/en/containers.md#bags-and-packs)**: single-use vacuum bags with an NFC sticker or QR code that disappear after emptying, and stock without a container (cans, jars) by barcode, receipt photo or by hand, with a stock view, minimum stock that fills the shopping list, and taking packs by barcode, oldest first
- ✏️ **[Quick filling](docs/en/containers.md#filling-containers)**: contents, quantity, best-before date and vacuum in a few taps, also for several containers at once and with a [serial scan](docs/en/dashboard.md#selecting-several-containers)
- 🧮 **[Best-before estimate](docs/en/best-before.md#best-before-estimate)**: built-in shelf-life table, optionally with AI, with limits per storage place
- 🍳 **[Recipes](docs/en/kitchen.md#recipes)**: ideas from what expires soon or from selected containers, a recipe book, and recipes read from a photo
- 🔔 **[Daily summary](docs/en/kitchen.md#daily-summary)**: push with buttons to several phones and read out on Alexa or other speakers, optionally at the first motion in the kitchen
- 🛒 **[Shopping list](docs/en/kitchen.md#shopping-list)**: on request, the contents of an emptied container go onto a to-do list, never leftovers
- 🗓 **[Meal plan](docs/en/kitchen.md#meal-plan)** with thaw reminder, **[nutrition and allergens](docs/en/containers.md#nutrition)** from the barcode, **[statistics](docs/en/dashboard.md#statistics)** of what was eaten and thrown away
- 📅 **[Calendar entries](docs/en/kitchen.md#best-before-dates-in-your-calendar)**: best-before dates in your calendar (Local Calendar, Google, CalDAV …)
- 🌍 Available in English and German

<p align="center">
<img src="docs/images/dashboard-start-en.png" width="250" alt="Start page (demo data)">
<img src="docs/images/dashboard-containers-en.png" width="250" alt="Containers as tiles">
<img src="docs/images/dashboard-cards-en.png" width="250" alt="Cards with all details">
</p>

> **New in 3.0:** besides reusable containers there are now **single-use bags** (e.g. vacuum bags, with an NFC sticker or QR code) and **packs** (stock without a container). The optional *Larder experimental* view is gone. See the [changelog](CHANGELOG.md).

## Documentation

The details live on their own pages:

| Page | What is in it |
|---|---|
| [Containers, bags and packs](docs/en/containers.md) | Adding containers, single-use bags and packs, areas and labels, filling, nutrition and allergens |
| [Dashboard, statistics and data](docs/en/dashboard.md) | The Larder dashboard, selecting several containers, the Lovelace card, statistics, export and import |
| [Best-before estimate](docs/en/best-before.md) | How the best-before date is estimated: table, AI, remembered values |
| [Recipes, daily summary, meal plan and shopping](docs/en/kitchen.md) | Recipe ideas and recipe book, daily summary (blueprint), meal plan with thaw reminder, shopping list, calendar |
| [Scanning](docs/en/scanning.md) | Scanning in the app, your own QR codes and label sheets, NFC tags, iOS Shortcut for Zwilling codes |
| [Settings, repairs and reference](docs/en/reference.md) | All settings, repair hints, entities, services, events and the webhook |
| [Changelog](CHANGELOG.md) | Release notes of every version |

## Why this project?

It all started with buying the Zwilling Fresh & Save Family Box. I noticed the QR code on the lids, which links each box to the management system in the Zwilling app. Then I found out that the app and its functions will be discontinued on 31 December 2026.

So I needed a replacement, and since I already run Home Assistant, building an integration there was the obvious choice.

Then came a second idea: why not give ordinary boxes a QR code too? Printing those is tedious, though, and I still had a few NFC stickers lying around. That is how the NFC tag integration was born.

## Installation

Since Home Assistant 2026.11 the community store HACS is built in as the **Marketplace**. Larder is not in the default catalogue yet, so you add it as a custom repository:

1. **Settings → Marketplace** → **Add from link**
2. URL: `https://github.com/yan14/ha-larder`, category **Integration**
3. Download "Larder" (adding a custom repository needs a GitHub connection; Home Assistant shows a code to enter on GitHub).
4. Set it up under **Settings → Devices & services → Add integration → Larder** (see below).

<details>
<summary>Home Assistant before 2026.11 (classic HACS)</summary>

1. HACS → three-dot menu → **Custom repositories**
2. URL: `https://github.com/yan14/ha-larder`, category **Integration**
3. Install "Larder" and restart Home Assistant.

</details>

> **Coming from the old "Zwilling Food Storage" (up to 0.10)?** Larder is a new integration (domain `larder`). Remove the old one, add Larder and add your containers again.

## Getting started

1. **Add your first container** under Settings → Devices & services → Add integration → Larder (see [Adding a container](docs/en/containers.md#adding-a-container)). From then on the **Larder** dashboard is in the sidebar and adding more containers is quicker there (**＋** on the containers page).
2. **Give each container an area** that says where it is stored, for example "Fridge", "Freezer" or "Pantry". The estimate needs it. Optionally add a `Larder: …` label with the [template](docs/en/containers.md#template-for-the-area-label) to the areas.
3. **Fill the containers** in the dashboard: contents, quantity, best-before date (or let Larder estimate it).
4. **Check the [settings](docs/en/reference.md#settings)** once: estimate mode, periods, calendar, shopping list.
5. **Import the [blueprint](docs/en/kitchen.md#daily-summary)** for a daily summary of what expires soon (push and/or voice).
6. **Put a code on the boxes:** print [your own QR code](docs/en/scanning.md#your-own-qr-codes), stick on an [NFC tag](docs/en/scanning.md#nfc-tags), or keep the original Zwilling codes and scan them with [📷 in the app](docs/en/scanning.md#scanning-in-the-app) or the [iOS Shortcut](docs/en/scanning.md#ios-shortcut-for-the-original-zwilling-codes).

## Alternatives

This integration tracks the **physical, reusable container** (one device per container with its own QR code). If you would rather manage **products and stock**, these projects may fit better:

- [Fridge Assistant](https://github.com/MaxGramser/fridge_assistant): inventory for fridge, freezer and pantry with barcode scanning, AI shelf-life estimates and printed labels.
- [Grocy](https://github.com/custom-components/grocy): the Home Assistant integration for the self-hosted Grocy server (stock, best-before dates, shopping lists, chores).

## Development

Releases are created automatically: when `version` in `manifest.json` is new on `main`, a GitHub workflow creates the tag `v<version>` and a release. Its text is the section `## <version>` of [CHANGELOG.md](CHANGELOG.md) (write it together with the version bump, a test checks that it exists), followed by the automatically generated comparison link.

```
pip install -r requirements_test.txt
pytest
ruff check .    # linter, also runs in CI

npm install
npm test        # tests for the frontend (jsdom)
```

The frontend lives in `custom_components/larder/frontend/`: `larder-dashboard.js` (pages and navigation) with its texts, stylesheet and the bag/pack dialogs in separate modules, `larder-panel.js` (cards and the add/fill dialogs) and `larder-card.js` (Lovelace card).

The screenshots come from the real code with demo data: serve the repository (`python -m http.server`) and open `docs/demo/dashboard.html?lang=en&view=containers` (options in the file) or, for the dialogs, `docs/demo/index.html?lang=en&dialog=scan`.
