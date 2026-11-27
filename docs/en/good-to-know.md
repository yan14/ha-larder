# Good to know

[← Overview](../../README.md) · [🇩🇪 Deutsch](../de/gut-zu-wissen.md)

Short answers to the questions that come up most, and the rules Larder follows everywhere. The details are on the linked pages.

[Where is what?](#where-is-what) · [Putting things into stock](#putting-things-into-stock-the-same-rules-everywhere) · [Taking things out](#taking-things-out) · [Unknown products](#unknown-products) · [Buying again](#buying-again-which-one-when) · [Best-before dates](#best-before-dates) · [QR codes and NFC tags](#qr-codes-and-nfc-tags) · [Who may do what](#who-may-do-what) · [Food, household, pharmacy, vouchers](#food-household-pharmacy-vouchers) · [Notifications](#notifications-which-blueprint-for-what) · [Your data](#your-data)

## Where is what?

| I want to … | There |
|---|---|
| see what expires soon | **Start** (tiles at the top), the [daily summary](kitchen.md#daily-summary) or the card [Larder](dashboard.md#card-for-your-dashboards) |
| find a product | **🔍** at the top of every page: every place with count and date |
| scan anything | **📷** at the top of every page (Home Assistant app): barcode, container code or compartment label |
| put the shopping away | **📥 Put away** (start page) – or tick it off in the **🛒 Shopping** mode while shopping |
| read a receipt | **🧾 Receipt** (start page, More, shopping mode) |
| see what a product did over time | **📜 History** – in the stock view, the barcode dialog, or **📜 History of …** on a card |
| see the stock with minimum stock and prices | **More → 🗃️ Stock** |
| count what is really there | **More → 📋 Stocktake**, or **📋 Stocktake** in a compartment |
| link a tag or print a label for a compartment | scan a new tag right at the compartment, or **More → 🏷 Compartments & tags** |
| change areas, store sections, sizes, export, settings | **More → Setup** (administrators) |

Everything that used to be in the ⋮ menu is under **More** since 5.0; *Areas* and *Categories* are tabs at the top of the **Larder** page.

## Putting things into stock: the same rules everywhere

No matter how a product comes in – **📥 Put away**, ticking off in the **shopping mode**, **🧾 Receipt**, **Bought – into stock?** on the start page, **＋ Add a new pack** in the barcode dialog or a **recently used** chip in ＋ – Larder does the same:

1. A product that is **already known** goes to its **usual place** (where most of it is). It **joins an entry without a best-before date** there; otherwise a new entry is made.
2. **Price and best-before date** can be entered right away (**Price/date**, 📷 reads the date from a photo). A pack with a date of its own gets an **entry of its own**, so the oldest one is still used first.
3. The **price** goes into the price history of the product.
4. The matching item on the **shopping list is ticked off**, and *Bought – into stock?* does not offer it again.
5. **＋1** adds another pack of the same product without scanning again; price and date then apply to all of them.
6. Since 6.1 the **best-before date is suggested**: from earlier purchases of exactly this product (*milk kept 9 days when it was put away last time*), else – fresh food only – from the shelf-life table. A suggestion has a dashed frame; check it and change it if needed. Similar products never share their history (*Heinz Ketchup* and *Heinz Ketchup Zero* stay separate).

### Finishing it afterwards: recently put away

Since 6.1, **Done** after putting away and **Add** after a receipt open **📝 Just put away**: one list with **price**, **best-before date**, **area** and **compartment** of every row, all editable, one **Save**. Only what changed is saved; a date entered for the new packs gives them an entry of their own. **More → 📝 Recently put away** shows the same list for the last 7 days (*Only incomplete ones* on by default), so nothing has to be searched one by one.

Only **unknown** products open a dialog (see below). Details: [Stock](containers.md#stock), [shopping mode](kitchen.md#shopping-mode).

## Taking things out

- **−1** takes one pack (household items: one piece). Everywhere – on the card, in the compartment view, in the barcode dialog and in a push – it asks **Used up** or **🗑 Thrown away**.
- **Thrown away** counts in the history, the [statistics](dashboard.md#statistics), the monthly report and *about €X thrown away*; used up counts as consumption (for *lasts about …* and *buy again by consumption*).
- The **last** pack of an entry removes the entry; a container is **emptied** (it keeps its code and can be filled again), a bag disappears.
- **Open** (packs) marks one pack as opened, optionally at another place (e.g. into the fridge), and shortens its date. **Into a container** transfers a pack into an empty container – or into a **new** one, created right there.

## Unknown products

A barcode Larder does not know yet is looked up in Open Food Facts (food), Open Beauty Facts, Open Products Facts and Open Pet Food Facts. Unknown products are **collected** while putting away, shopping or scanning and added **together at the end**: food as **packs**, everything else as **household items**. The receipt marks household goods with 🧻. If a product was renamed, Larder remembers its barcode; packs without a barcode can be linked with **🔗 Link to a product in stock**.

## Buying again: which one when?

| Feature | When it puts something on the list | Set up |
|---|---|---|
| **Add to shopping list when emptied** | when a container is emptied | switch on the card of a container |
| **Minimum stock** | as soon as there are fewer packs than the minimum | stock view or the card of a pack |
| **⏳ Running low** | when a product with a minimum stock will only last until the next shopping trip (forecast) – shown on the start page, optionally straight onto the list | setting *Running low: add to the shopping list right away* |
| **🔁 Buy again by consumption** | when it will not last until the next shopping trip by its consumption – also without a minimum stock, once per purchase | stock view, per product |
| **Recurring purchases** | on fixed weekdays or every n days (bread, water) | **🔁 Recurring** in the shopping mode |
| **Replacement interval** | household items due for replacement (water filter) | card of a household item |

Every list item Larder writes remembers the product, brand, package and place, so ticking it off puts it [into stock](#putting-things-into-stock-the-same-rules-everywhere). Details: [Shopping list](kitchen.md#shopping-list).

## Best-before dates

- **Printed or estimated:** for packs you enter the printed date (or 📷 reads it from a photo); for containers and bags Larder [estimates](best-before.md#best-before-estimate) it from the contents and the storage place (table, optionally AI) – the estimate never replaces a date you entered.
- **Opened / Thawed** shorten the date (never extend it); an opened pack shows **🫙 opened since …**, so it is clear why the date is shorter than printed.
- **+1 day** moves a date by hand; **+2 days** in a push does the same from the notification.
- Expired entries show **expired (3 d)** and how long ago; long shelf lives are shown in months or years.

## QR codes and NFC tags

- **Containers** carry their own QR code (or the original Zwilling code) or an NFC tag; **compartments** (a drawer, a box, a shelf) get a tag or QR label of their own, so a scan shows everything that is there.
- **Blank stickers cannot be scanned** – the phone only reads written tags. Choose **Write a new NFC tag** / **✍ Write a new sticker**: a step of its own opens the app's writer (**Write again** if no window opened).
- **A new tag that is already written** can simply be scanned: Larder asks whether it is for a compartment, a container or should be ignored.
- **Tags with a name in Settings → Tags** belong to something else and are never touched.
- Details: [Scanning](scanning.md).

## Who may do what

| | Everyone in the household | Administrators only |
|---|---|---|
| Fill, empty, −1, open, move packs | ✓ | |
| Add bags, packs, household items, medicines, vouchers | ✓ | |
| Add containers, link a tag to a container | | ✓ |
| Link compartments with tags, print labels | ✓ | |
| Selection and serial scan, remembered estimates, export and import, settings | | ✓ |
| AI features (recipe ideas, receipt, date and voucher from a photo) | | ✓ (with *AI Task*) |
| Voucher codes | | ✓ |

## Food, household, pharmacy, vouchers

The switch at the top of the **Larder** page shows one side at a time. Areas belong to one side (e.g. *Bathroom* → household) or both; see [Food, household or pharmacy](containers.md#food-household-or-pharmacy). Household items and medicines have their own, longer warnings and are not part of the daily summary of food; medicines have their [own reminder](kitchen.md#medicines-expiring). *Vouchers* only appears once there is one.

## Notifications: which blueprint for what?

| Blueprint | Sends |
|---|---|
| [Daily summary](kitchen.md#daily-summary) | what expires soon, optionally one push per entry with the buttons **Used up · Thrown away · +2 days · On the list** (and **🧊 Freeze** for what keeps in the freezer), recipe ideas, voice output |
| [Weekly review](kitchen.md#weekly-review) | last week eaten / thrown away (value), next week's expiring food, a recipe idea |
| [Opened items](kitchen.md#opened-items) | once a week everything opened that runs out soon, with how long it has been open |
| [Rescue list of the week](kitchen.md#rescue-list-of-the-week) | once a week what has to go this week and is not planned, with **Into the meal plan** |
| [Monthly report](kitchen.md#monthly-report) | the previous month compared with the month before |
| [Medicines expiring](kitchen.md#medicines-expiring) | medicines, dated household items and vouchers on chosen weekdays |
| [Running low and recalls](kitchen.md#running-low-and-recalls) | running low, recall warnings, replacement due |
| [At the fridge and the compartments](kitchen.md#at-the-fridge-and-the-compartments) | an announcement when the fridge door opens and something expires today; what is in a scanned compartment |

Besides that, the scanning phone gets a notification after an NFC scan (setting *NFC: notify the phone*), and the [overview sensors](reference.md#overview-sensors) work in your own automations.

## Languages

Larder follows the language of your Home Assistant user: **English**, **German**, **French** and **Dutch** (since 6.0) – the dashboard, the cards, the settings, the notifications and speech, the reports and the shelf-life table (food names and area names like *réfrigérateur* or *koelkast* are recognised). Other languages fall back to English. Since 6.2 the dashboard sends **your own** language (your Home Assistant profile) when it estimates a date: the words of your language come first (*pommes* are apples for a French user, chips for a German one) and the tip is in your language. Notifications, sensors and automations have no user and use the system language. For German and English, French and Dutch words are not used at all.

French and Dutch are **translations without a native speaker** (made with the help of an AI and checked against Home Assistant's own wording). Some phrases may sound stiff. Corrections are very welcome – as an [issue](https://github.com/yan14/ha-larder/issues) or a pull request on `translations/fr.json` / `nl.json` and the text tables in `frontend/`.

## Your data

Everything is stored locally in Home Assistant (`.storage/larder.*` and the entities). Larder only goes online for: barcodes (Open Food Facts and its sister databases), price estimates ([Open Prices](https://prices.openfoodfacts.org)) and recall warnings (lebensmittelwarnung.de). The **AI** is optional and goes through Home Assistant's *AI Task* integration with the provider you chose: recipe ideas get contents, quantities, days left and storage places; photos (recipe, receipt, date, voucher) are sent once and deleted right away. **More → 📦 Export and import** exports the inventory and the history as CSV and backs up the remembered estimates.
