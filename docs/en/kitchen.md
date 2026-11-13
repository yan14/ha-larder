# Recipes, daily summary, meal plan and shopping

[← Overview](../../README.md) · [🇩🇪 Deutsch](../de/kitchen.md)

[Recipes](#recipes) · [Daily summary](#daily-summary) · [Meal plan](#meal-plan) · [Shopping list](#shopping-list) · [Best-before dates in your calendar](#best-before-dates-in-your-calendar)

## Recipes

All recipe features use the Home Assistant **AI Task** integration (the same one as for the [AI estimate](best-before.md#ai-optional)); the estimate mode does not matter. Depending on the provider each request may cost a small amount, and nothing is sent without you pressing a button or running an automation.

### Recipe ideas

The AI suggests dishes that use up what expires soon.

**In the dashboard** (administrators): on the **Recipes** page press **✨ From leftovers**. Next to it choose the period (the default comes from **Configure** → *Period for recipe ideas*, 3 days out of the box; a fixed number of days; or **All containers**, which also includes containers without a best-before date) and optionally the number of people. You get up to three recipes with the containers they use, extra ingredients (only common staples), time and short steps, and you can **save** the ones you like to the [recipe book](#recipe-book). Expired containers and containers without contents are never used.

**In automations:** the service `larder.suggest_recipes` returns the same.

```yaml
action: larder.suggest_recipes
data:
  days: 3        # containers expiring within 3 days (omit to use the period from the settings)
  # all_containers: true   # no period: every filled container
  # containers: [device_id, …]   # exactly these containers
  servings: 2    # optional, default 2 people
  max_recipes: 3 # 1 to 5
response_variable: ideas
# ideas.recipes (title, minutes, uses, extra_ingredients, steps), ideas.summary (text),
# ideas.ingredients (the containers used), ideas.count
```

**In the daily notification:** the [blueprint](#daily-summary) has the switch **Add recipe ideas**. The recipes are appended to the message; if the AI fails, the normal message is still sent. Re-import the blueprint to get the new switch.

Only the contents, quantity with unit, remaining days and storage place (area name) are sent to the AI service you chose, never container names, IDs or anything else. The suggestions are ideas from a language model, not tested recipes: check that food is safe to eat, especially thawed or older food.

**From selected containers:** select containers and press **✨ Recipe ideas**, see [Selecting several containers](dashboard.md#selecting-several-containers). In automations use `containers` with the device IDs.

### Recipe book

The **Recipes** page is your own recipe book (stored in Home Assistant, `.storage/larder.recipes`). Everyone can read it; administrators add (**＋**), edit and delete recipes. Sort by newest or by name; tap a recipe to see ingredients and steps.

**Recipe from a photo or file** (📷, administrators): take a photo of a recipe from a cookbook or a card, pick up to four photos (for example two pages) or a PDF. The AI reads the recipe, translates it into your language if needed and opens it for you to **check**; nothing is saved until you tap *Save*. The selected AI task must support attachments (for example Anthropic, OpenAI, Google). Photos are shrunk before uploading, are kept in Home Assistant's media folder (`media/larder/recipe_photos`) only while they are read and are deleted afterwards. Only the photo or file is sent, to the AI service you chose.

## Daily summary

The included blueprint sends a **daily summary** of what expires soon. Nothing is sent when nothing expires. Expired containers are named with their container and the note **should be emptied**, so you know which one to clear out. Containers to [thaw for a planned dish](#meal-plan) come first, with a **Thawed** button. Re-import the blueprint to get that button.

[![Import blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fyan14%2Fha-larder%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Flarder%2Fexpiry_notification.yaml)

| Option | What it does |
|---|---|
| **Push notification** | One or more notify actions, separated by commas (`notify.mobile_app_your_iphone, notify.mobile_app_partner`), or a notify group. Empty for voice only. |
| **Buttons in the push** | **Recipes** opens the recipe page of the dashboard, **Dashboard** opens Larder. Tapping the notification itself opens the dashboard as well. |
| **Voice output** | Notify actions that read the summary out loud, for example `notify.alexa_media_kitchen` (Alexa Media Player) or a group of speakers. The spoken text is made for listening: "Salmon expires today. Gouda expires tomorrow. Pizza in Box 3 has expired and should be emptied." (at most six containers, the rest is counted). With recipe ideas it adds "Idea: …". |
| **Voice options** | Extra data for the voice action. Alexa Media Player needs the type, for example `type: announce` (with chime) or `type: tts`. |
| **Speak only when someone is home** | Persons, groups or zones; the voice output is skipped when nobody is home. The push is always sent. |
| **Time** and **motion sensors** | Without motion sensors the summary is sent at the time. With motion sensors (for example the kitchen) it is sent at the **first motion after that time**, once per day, and at the **latest time** at the latest if nobody came by. |
| **Days ahead**, **include expired**, **add recipe ideas** | As before. Recipe ideas need the *AI Task* integration; if the AI fails, the message is still sent. |

Existing automations keep working; re-import the blueprint to get the new options.

**Without the blueprint:** the service `larder.get_expiring` returns the same data for your own automations:

```yaml
action: larder.get_expiring
data:
  days: 3               # containers expiring within 3 days (default: "Expiring soon" from the settings)
  include_expired: true
response_variable: result
# result.count, result.expired, result.summary (text with bullets for a push),
# result.speech (sentences to read out), result.labels (button titles),
# result.items (name, content, quantity, unit, area, best_before, days_left, status)
```

`larder.suggest_recipes` also returns `speech` ("Idea: …"). For your own dashboards there is the sensor **Days until best before** on every container.

## Meal plan

Plan a dish for a day: **📅 Plan** on a recipe idea or a recipe from the book (also for non-administrators). The dialog takes the dish, the day (preset: tomorrow) and the **containers** it needs; the containers whose contents appear in the recipe are already ticked.

- The **start page** shows what is planned for the next seven days, the **recipe page** all plans (✕ removes one).
- With a **calendar for the meal plan** in the [settings](reference.md#settings), every plan also becomes an all-day event "🍽 Spaghetti Bolognese"; removing the plan removes the event.
- **✓ Cooked** on a plan takes one portion from each of its containers (if they have more than one) or empties them as eaten, and removes the plan from the list.
- **Missing ingredients:** the dialog also takes the ingredients of the recipe. Those that are in none of your containers are shown on the plan; **🛒 n missing → shopping list** puts them on the [shopping list](#shopping-list) (items already open there are not added twice).

**Thaw reminder.** If a container needed for a planned dish stands in the **freezer** (by the area's name or label), Larder reminds you in time to move it to the fridge, by default the day before (setting **Thawing: days ahead**, 0–3):

- on the start page under **🧊 Move to the fridge to thaw**, with a button **✓ Thawed**,
- in the [daily summary](#daily-summary) as the first lines ("🧊 Bolognese sauce (Box 4) for Spaghetti Bolognese, tomorrow") and in the voice output; the push gets a button **Thawed**. The summary is sent for this even when nothing expires.

**Thawed** works like the **Thawed** button on the card (shortens the best-before date) and moves [flexible containers](containers.md#filling-containers) to the fridge if there is exactly one fridge area.

## Shopping list

Under Settings → Devices & services → **Larder** → **Configure** you can pick a **to-do list** of Home Assistant, for example the built-in *Shopping list*, Todoist or Bring!. Each container then has a checkbox **Add to shopping list when emptied** (the `Shopping list` switch, off by default). When you press **Empty container** on a container with the checkbox on, its contents are added to the list, for example "Basmati".

- **Brand and package:** if they are known (e.g. after a [barcode scan](containers.md#filling-containers)), they go onto the list too: "Oats (Kölln, 500 g)". An open "Oats" counts as the same item and is not added twice. Can be switched off in the settings; with several contents ("Salami, liver sausage") only the names are added.
- Not everything belongs on the list: leftovers like "pizza leftovers" simply stay unchecked and are never added. The setting belongs to the container and is kept when you empty it, so rice is always bought again and pizza never.
- An item that is already open on the list is not added twice. Items that are already checked off do not count, so you can buy the same thing again.
- Without a chosen list nothing happens and the checkbox is hidden. If the list is unavailable, the container is still emptied.
- Planned: several target lists (for example butcher and supermarket), and adding expired containers as well.

## Best-before dates in your calendar

Under Settings → Devices & services → **Larder** → **Configure** you can pick an existing **calendar** (Google, CalDAV, *Local Calendar* …). Every container then gets an all-day event "Best before: Pizza" on its best-before date. The event is created when a date is set, moved when the date or the contents change, and deleted when the date is cleared, the container is emptied or removed, or you pick another calendar. Your own events are recognised by a tag in the description and never touched otherwise.

**Clean-up.** On every start and whenever you save the settings, Larder checks the whole calendar, keeps exactly one event per container and removes duplicates. The service `larder.rebuild_calendar` does the same on demand and also removes events of containers that no longer exist. With `include_unmarked: true` it additionally removes events titled "Best before: …" / "MHD: …" that carry no Larder tag (for calendars that drop the description) and creates them anew.

The calendar must be able to create **and** delete events. Read-only calendars (for example an iCal link) cannot be used and are rejected when you save the settings; the *Local Calendar* integration is a good choice if you have no other one. **CalDAV** (iCloud, Nextcloud …) works: Home Assistant's CalDAV calendar can only create events by itself, so Larder reads and deletes its own events directly through the CalDAV connection.
