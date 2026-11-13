# Settings, repairs and reference

[← Overview](../../README.md) · [🇩🇪 Deutsch](../de/reference.md)

[Settings](#settings) · [Repairs](#repairs) · [Reference](#reference)

## Settings

Settings → Devices & services → **Larder** → **Configure** (on any container; the settings apply to all containers):

| Setting | Default | What it does |
|---|---|---|
| Best-before estimate | Table only | Off, table only, table otherwise AI, AI only, see [Best-before estimate](best-before.md#best-before-estimate) |
| AI task | HA default | Which *AI Task* entity to use, only needed if you have several |
| Shelf life after opening | 3 days | The **Opened** button shortens the best-before date to this many days |
| Time after thawing | 2 days | The same for the **Thawed** button |
| Period for recipe ideas | 3 days | Containers that expire within this many days are used for [recipe ideas](kitchen.md#recipe-ideas) (0 = today only) |
| "Expiring soon" from | 3 days | When a container counts as expiring soon: hint and filter in the dashboards, sensor `status`, default of `larder.get_expiring` |
| Vacuum preset | on | Preset of the **Vacuum** switch for new containers |
| NFC: notify the phone | on | Notification on the scanning phone after an [NFC scan](scanning.md#nfc-tags) |
| Repair hints | on | Hints under Settings → System → Repairs, see [Repairs](#repairs) |
| Temperature warning | on | Warning when a freezer or fridge with a temperature sensor stays too warm, see [Repairs](#repairs) |
| Calendar | none | [Best-before dates in your calendar](kitchen.md#best-before-dates-in-your-calendar) |
| Shopping list | none | [Shopping list](kitchen.md#shopping-list) for emptied containers |
| Brand and package on the shopping list | on | "Oats (Kölln, 500 g)" instead of "Oats", see [Shopping list](kitchen.md#shopping-list) |
| Allergens in the household | none | Warning on containers and no such containers in recipe ideas, see [Allergens in the household](containers.md#allergens-in-the-household) |
| Calendar for the meal plan | none | Planned dishes as all-day events, see [Meal plan](kitchen.md#meal-plan) |
| Thawing: days ahead | 1 | Thaw reminder for frozen containers of a planned dish, see [Meal plan](kitchen.md#meal-plan) |

The dialog also shows the **webhook URL** for the [iOS Shortcut](scanning.md#ios-shortcut-for-the-original-zwilling-codes).

## Repairs

Larder shows hints under **Settings → System → Repairs** when containers need attention. There is one hint per kind (listing up to ten containers), not one per container:

| Hint | When |
|---|---|
| **Containers without an area** | A container has no area, so the estimate does not know where the food is stored. |
| **Filled containers without a best-before date** | A container has contents but no date. It then appears neither in the daily summary nor in the calendar. |
| **Containers expired more than 7 days ago** | Time to empty them. |

A hint disappears by itself as soon as no container is affected any more (checked on every change and once a day). You can switch the hints off in the [settings](#settings) ("Repair hints").

**Fix** opens a dialog right in the repairs:

- **without an area**: one area field per container, saving assigns them,
- **without a best-before date**: estimates the date for all of them (what the estimate does not know stays in the hint),
- **expired long ago**: tick containers and empty them; they go into the history as thrown away.

**Learn more** opens the Larder dashboard: one container directly, several on the containers page filtered to exactly these (`/larder?problem=noarea`, `nodate` or `longexpired`).

**Temperature warning.** If an area with a **temperature sensor** (Settings → Areas → area → temperature sensor) is a freezer, fridge or 0 °C drawer by its name or label, Larder warns when it stays too warm: freezer above −12 °C for 30 minutes, fridge above 8 °C or 0 °C drawer above 6 °C for 60 minutes. The repair hint lists the filled containers there; the event `larder_temperature_warning` (`area_id`, `area`, `temperature`, `limit`, `containers`) is for your own push or siren, `larder_temperature_ok` follows when it is cold again (1 °C below the limit). Switch it off with the setting **Temperature warning**.

## Reference

### Entities

Every container becomes a device (identified by its ID, the `cc` parameter of a Zwilling QR code) with:

| Entity | Type | Purpose |
| --- | --- | --- |
| **Filled on** | `datetime` | When was the container filled? |
| **Best before** | `date` | Best-before date (MHD) |
| **Contents** | `text` | What is in the container? Attributes: `category` and, if known, the [nutrition](containers.md#nutrition) (`kcal_100g`, `kcal_portion`, `nutri_score`, `allergens`, `nutrients`, `brand`, `package`, `ean`) |
| **Compartment** | `text` | Optional place inside the area, e.g. "drawer 2". Kept when emptying; cleared when a flexible container goes back to its storage place |
| **Empty container** | `button` | Resets the whole container: **Contents** become empty, **Best before** and **Filled on** are cleared. **Vacuum** is deliberately kept, it is a property of the container, not of its contents |
| **Quantity** | `number` | How much is in the container, e.g. 4 (0 = not specified). Reset by **Empty container** |
| **Unit** | `select` | Unit of the quantity: portions (default), pieces, slices, grams or milliliters. Reset to portions by **Empty container**. Both show up in the dashboard, the fill dialog, the `get_expiring` result and the recipe ideas. Tip: use *portions* for finished dishes (chili, soup) and *pieces* or *slices* for countable food (eggs, ham) |
| **Vacuum** | `switch` | Is the container vacuum-sealed? On by default for new containers; change the preset under **Configure** if most of your boxes are not vacuum-sealed. Used for the estimate |
| **Shopping list** | `switch` | Should the contents go onto your shopping list when the container is emptied? Off by default, per container, and kept by **Empty container**. Only has an effect once a list is chosen under **Configure**, see [Shopping list](kitchen.md#shopping-list) |
| **Flexible storage place** | `switch` | For containers that move around (fridge one day, 0 °C drawer the next). Off by default. When on, the fill dialog asks for the area, and **Empty container** puts the container back into the **storage place after emptying**. Kept by **Empty container** |
| **Storage place after emptying** | `select` | The area a flexible container goes back to when it is emptied (or *stays where it is*). Only used when **Flexible storage place** is on. The area ID is in the attribute `area_id`, so renaming the area does no harm |
| **Days until best before** | `sensor` | Days left until the best-before date (negative = expired). The attribute `status` is `ok`, `soon` (3 days or less, see [Settings](#settings)), `expired` or `none` |
| **QR code** | `image` | The container's QR code as an image: scanning it with the camera app opens the container in the Larder dashboard, see [Your own QR codes](scanning.md#your-own-qr-codes) |

[Bags](containers.md#bags-and-packs) have the same entities except **Shopping list**, **Flexible storage place** and **Storage place after emptying**; [packs](containers.md#bags-and-packs) only have **Contents**, **Compartment**, **Best before**, **Quantity**, **Unit**, **Days until best before** and **Empty container**. The attribute `kind` of **Contents** is `container`, `bag` or `pack`. Pressing **Empty container** on a bag or pack removes its device.

The values survive restarts. "Empty container" is a regular button entity, so you can use it on dashboards and in automations via `button.press`.

**Clearing a single field:** the date entities of Home Assistant itself cannot be cleared from the entity dialog (the picker's "Clear" button has no effect there). Use one of these instead: empty the field in the dashboard, press **Empty container** to reset everything, or call the services `larder.clear_best_before` / `larder.clear_filled_at` (for example in Developer tools or an automation).

### Services and events

| Service | What it does |
|---|---|
| `larder.estimate_best_before` | Estimate the best-before date of a container, see [Using it](best-before.md#using-it) |
| `larder.clear_best_before` / `larder.clear_filled_at` | Clear a single date |
| `larder.mark_opened` / `larder.mark_thawed` | Shorten the best-before date after opening or thawing (`days` optional) |
| `larder.get_expiring` | List what expires soon, with a ready-made text, see [Daily summary](kitchen.md#daily-summary) |
| `larder.suggest_recipes` | [Recipe ideas](kitchen.md#recipe-ideas) from what expires soon, from all or from selected containers |
| `larder.get_statistics` | Eaten / thrown away, most frequent contents, storage time and current stock, see [Statistics](dashboard.md#statistics) |
| `larder.rebuild_calendar` | Clean up the [calendar](kitchen.md#best-before-dates-in-your-calendar) |

Items of `larder.get_expiring` carry `kind` (`container`, `bag`, `pack`). If the sticker of a bag that was already emptied is scanned, `larder_dose_scanned` fires with `retired: true` and a `message` instead of `cc` and `device_id`.

The event `larder_dose_scanned` (`cc`, `device_id`, `name`, `scanned_by`) fires when a linked [NFC tag](scanning.md#nfc-tags) or one of [your own QR codes](scanning.md#your-own-qr-codes) is scanned (then with `source: qr`). `larder_temperature_warning` and `larder_temperature_ok` belong to the [temperature warning](#repairs).

### Webhook interface

The webhook is a regular Home Assistant webhook and accepts `POST` (and `GET`).

Request, in one of these forms:

```
POST /api/webhook/<ID>   {"code": "zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL"}
POST /api/webhook/<ID>   {"cc": "34OL"}
POST /api/webhook/<ID>   zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL   (plain text)
GET  /api/webhook/<ID>?code=34OL
```

Response (`200`, JSON):

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

For a known container `path` and `app_url` open the dashboard on that container (an empty one gets the fill dialog straight away); `device_path` and `device_app_url` point to the device page instead. For an unknown container `known` is `false`, and `path` and `app_url` point to the dashboard with the add dialog (`/larder?add=<ID>`). If the request contains no valid ID, the webhook answers with `400` and `{"error": "invalid_code"}`. The webhook only reads and never changes any values.

For the code of a [bag](containers.md#bags-and-packs) that was already emptied the response is `{"known": false, "retired": true, "message": "Bag 3 (Venison goulash) was emptied on …"}` with `path` and `app_url` of the dashboard.
