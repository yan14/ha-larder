# Best-before estimate

[← Overview](../../README.md) · [🇩🇪 Deutsch](../de/best-before.md)

[The table](#the-table) · [AI (optional)](#ai-optional) · [Using it](#using-it) · [Managing remembered estimates](#managing-remembered-estimates)

The integration can suggest a best-before date. There are two sources, and you decide which one is used (Settings → Devices & services → **Larder** → **Configure**):

| Mode | What happens |
|---|---|
| **Off** | No estimates, the button is hidden. |
| **Table only** (default) | A built-in shelf-life table. Works offline, needs no AI service, costs nothing. |
| **Table, otherwise AI** | Table first. If the table has no entry for the contents or cannot place the area, the AI is asked. |
| **AI only** | Always the AI (needs the *AI Task* integration, see below). |

Values you corrected yourself always come first (see "Remembering").

## The table

More than 50 entries for common food: dishes and leftovers, soups, raw meat, fish, cold cuts, dairy, cheese, eggs, fruit and vegetables, bread and cake, pasta, rice, flour, nuts, coffee, tea, spices and more. For each entry it knows the shelf life in **fridge**, **0 °C compartment**, **freezer** and **pantry**. Where a food does not belong in a place (for example lettuce in the freezer or raw meat in the pantry) it says so and does **not** make up a date.

How a container is matched:

- **Contents** are matched by keywords in German and English, e.g. "Tomatensuppe", "Penne", "leftover chicken curry". The most specific match wins ("boiled eggs" beats "eggs"), the order of the words does not matter ("Eier gekocht" = "gekochte Eier"), and in compound words the last part counts ("Butterkekse" are cookies, "Lachsfilet" is fish). When the table gets better, remembered table values are recalculated on their next use; your own corrections stay. Dates already set on a container are not changed: estimate again (with *overwrite*) if needed.
- **Storage place** comes from the area: a temperature sensor on the area first, then the `Storage` or `Temperature` line of the [area label](containers.md#template-for-the-area-label), then a temperature in a label or the area name (for example "about -18 °C"), then words such as *fridge*, *0 °C compartment*, *freezer*, *freezer compartment* (a bit less cold, so shorter), *pantry*, *cellar*. If it cannot place the area, it tells you instead of guessing.
- **Vacuum** extends the time (about +30 % cold, +50 % in the freezer and pantry). Perishable food in the fridge (minced meat, fish, cold cuts, leftovers, soft cheese, …) gets **no** bonus, because vacuum does not make it safer.

**After opening (since 5.5).** For bought products the table also knows how long they keep **once opened**, taken from the **USDA FoodKeeper** (*refrigerated after opening* / *pantry after opening*; where it gives a range, the lower value): ketchup, chili and cocktail sauce 6 months in the fridge (1 month in the pantry), mustard 1 year, mayonnaise 2 months, soy sauce 1 month, Worcestershire 1 year, barbecue sauce 4 months, hot sauce 6 months, bottled dressing 1 month, horseradish 3 months, hoisin and oyster sauce 3 months, olives 2 weeks, pickles 1 month, jam 6 months, peanut butter 3 months, canned fish 3 days, milk, juice, yogurt and soft cheese 1 week, hard cheese 3 weeks, cold cuts 3 days. **Opened** on a card and **Open** on a pack use these values for the place (counted from today, never longer than the printed date); the tip names the source. Without a value the AI is asked explicitly for the time *after opening* (mode table + AI or AI), and only then *shelf life after opening* from the settings applies. Products that must be kept cold once opened (e.g. mayonnaise) are not given a date in the pantry. Fresh food and leftovers use the normal values.

**From the pack (since 5.7).** Many packs print *once opened, use within 4 weeks*. In the [product view](dashboard.md#product-history) **🔓 Once opened, use within … days** stores it for **exactly this product** (e.g. only *Heinz Ketchup Zero*, never for *Heinz Ketchup* as well); **📷** lets the AI read it from a photo of the label. **Opened** and **Open** then use this value before the table, and the tip says *from the pack*.

**Own storage time (since 5.8).** For things you make or keep your own way (homemade jam, preserves), the product view has **📦 Own storage time (days)** for fridge, freezer and pantry – also for things that are only in containers. It applies to **exactly this product** at that kind of place (the 0 °C compartment uses the fridge value), before the table; the tip says *own storage time*.

**Sources (since 5.6).** Every row names where its values come from, and the tip and the [remembered estimates](#managing-remembered-estimates) show it: the **USDA-FSIS Cold Food Storage Chart** (dishes and leftovers, soups, prepared salads, meat, poultry, fish, cold cuts, raw sausage, bacon, eggs), the **USDA FoodKeeper** (milk, yogurt, cream, butter, cheese, juice, lettuce, mushrooms, condiments and jam) and **USDA-based extension charts** (berries, citrus, apples, potatoes and onions, dried pulses, game). Since 5.7 also German consumer advice: cooked rice 1 day in the fridge (Verbraucherzentrale / DGE, because of *Bacillus cereus*), eggs as FSIS and Verbraucherzentrale (best before 28 days after laying, keep them cold once they were). For a range the lower value is used, e.g. steaks 3 days in the fridge (FSIS: 3 to 5) and 4 months in the freezer (4 to 12). Rows without a confirmed source (e.g. bread, cake, pasta, coffee, spices) say so: *no confirmed source – Larder's cautious estimate*. The 0 °C compartment has no source of its own and gets a little more than the fridge.

The values are deliberately cautious. They are rules of thumb for the home, **not a food-safety guarantee**. For bought products the printed best-before date is more reliable. Write "cooked" or "opened" into the contents if it matters. Spotted a value that is off or a food that is missing? Entries are listed in `custom_components/larder/shelf_life.py`; issues and pull requests are welcome.

### Which row counts

Since 6.3, in this order: **your choice** for exactly this product (data care *Unknown to the shelf-life table* or **🧭 Kind for the shelf life** in the product view) → the **categories and labels of Open Food Facts** of a scanned product (*meat analogues*, *plant milks*, *jams* …; a *vegan* label makes a "salami" plant-based) → the **name** (keywords). Similar products never share a choice.

## AI (optional)

The AI mode uses the **AI Task** feature of Home Assistant, so it works with whichever AI service you have set up there (for example Anthropic, OpenAI, Google or a local Ollama).

1. Set up an AI service with an *AI Task* in Home Assistant (Settings → Devices & services). This needs a Home Assistant version that includes the AI Task integration.
2. Choose **Table, otherwise AI** or **AI only** in the settings. The field "AI task" is only needed if you have more than one.

The AI receives the area name, so it understands "0 °C compartment" or "Freezer" on its own. You can give it more precise hints:

- **Temperature sensor of the area:** in the area settings you can assign a temperature sensor. If it has a valid value, it is passed on (for example a real freezer temperature). The table uses it as well.
- **Label with description:** assign a label to the area and write a hint in its description, for example "about -18 °C, meat and fish", or use the [template](containers.md#template-for-the-area-label). Name and description are passed on.

Only the contents text, the area name with its hints, vacuum yes/no and the filling date are sent, to the AI service you chose. Depending on the provider this may cost a small amount. Nothing is sent in the table-only mode.

## Using it

Set **Vacuum** per container and assign each container to an **area** that describes where it is stored, e.g. "Fridge", "0 °C compartment", "Freezer" or "Pantry". Without an area the estimate is refused with a hint.

On the dashboard the button **Estimate best before** appears once contents are entered and the best-before date is empty. It shows where the value came from: *table*, *AI*, or *table, corrected by you* / *AI, corrected by you* if you changed the date afterwards. You can also call the service (in automations, scripts or Developer tools):

```yaml
action: larder.estimate_best_before
target:
  entity_id: date.dose_34ol_best_before
data:
  apply: true       # false: only return the suggestion
  overwrite: false  # true: also estimate when a date is already set
response_variable: result
```

The result contains `best_before`, `days`, `tip` (a short storage tip), `source` (`table`, `ai` or `learned`), `basis` (for the table: matched food and place), `cached` and `applied`. The date is counted from **Filled on** (or from today if that is empty). **An existing best-before date is never overwritten** unless you set `overwrite`.

**Remembering.** Each result is stored for the combination of *contents + area + vacuum* and is not calculated or asked again. If you change a suggested date afterwards, your value is remembered for the same combination and wins over table and AI. The data lives in Home Assistant's `.storage/larder.estimator`.

**Limits for AI values.** A pure AI estimate is capped per storage place (fridge 60 days, 0 °C drawer 90 days, freezer 18 months, pantry 3 years, unknown place 1 year); the tip says when a value was capped. AI estimates you never corrected are asked again after 12 months (if the AI cannot be reached, the old value stays). Table values and your own corrections are never capped or refreshed by these defaults. Your own limit per area comes from the [area label](containers.md#template-for-the-area-label) (`Max storage: 3 years`) and applies to table and AI values.

## Managing remembered estimates

Administrators open the list with **⚙ → Remembered estimates** in the dashboard. It lists everything that is remembered for a combination of contents, area and vacuum, with its source (table, AI, or corrected by you with the original source). There you can

- **change** the days and the tip of an entry (it then counts as corrected by you),
- **delete** an entry; the next estimate for that combination is calculated anew (table or AI),
- **add** your own entry for a combination of contents, area and vacuum.

**Suggestions from the history.** Larder compares the remembered estimates with what really happened (last 12 months, from the [history](dashboard.md#export-and-import)):

- thrown away **before** the best-before date at least twice (and never eaten late) → it suggests a **shorter** value, how long it really kept (median, rounded down),
- eaten **well after** the best-before date (2 days or more) at least twice and never thrown away early → it suggests a **longer** value, the shortest of those storage times, at most twice the current value.

The suggestions appear at the top of the list with **Accept** or **Ignore**; nothing is changed by itself. An ignored suggestion comes back only when the suggested value changes. Emptyings without an answer (eaten / thrown away) do not count.

The built-in table itself is not edited here. Entries you add or change simply take precedence over it for that exact combination.

**Upgrading from 0.5:** "Estimate with AI" switched on becomes **AI only** (as before); switched off becomes **Table only**.
