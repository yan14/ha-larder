# Good to know

[← Overview](../../README.md) · [🇩🇪 Deutsch](../de/gut-zu-wissen.md)

Short answers to the questions that come up most, and the rules Larder follows everywhere. The details are on the linked pages.

[Where is what?](#where-is-what) · [Putting things into stock](#putting-things-into-stock-the-same-rules-everywhere) · [Taking things out](#taking-things-out) · [Moving](#moving) · [Unknown products](#unknown-products) · [Shopping list](#shopping-list-in-short) · [Buying again](#buying-again-which-one-when) · [Throwing away less](#throwing-away-less) · [Best-before dates](#best-before-dates) · [QR codes and NFC tags](#qr-codes-and-nfc-tags) · [Who may do what](#who-may-do-what) · [Food, household, pharmacy, vouchers](#food-household-pharmacy-vouchers) · [Notifications](#notifications-which-blueprint-for-what) · [Your data](#your-data)

## Where is what?

| I want to … | There |
|---|---|
| see what expires soon | **Start** (tiles at the top), the [daily summary](kitchen.md#daily-summary) or the card [Larder](dashboard.md#card-for-your-dashboards) |
| find a product | **🔍** at the top of every page: every place with count and date |
| scan anything | **📷** at the top of every page (Home Assistant app): barcode, container code or compartment label |
| put the shopping away | **📥 Put the shopping away** (start page, Larder, Shopping, More): **📷 Scan**, **🧾 Receipt or invoice** or **✍️ By hand** – or tick it off in the **🛒 Shopping** mode while shopping |
| read a receipt or invoice | **📥 Put the shopping away → 🧾 Receipt or invoice** (start page, Larder, Shopping, More) – choose photo or PDF first, then check |
| put something on the shopping list | **🛒 Shopping → Onto the list …** or a **Quick add** chip; paste a list from a chat right there ([in short](#shopping-list-in-short)) |
| prepare an online order | **🛒 Shopping → ⋯ More → 📦 Prepare the order** ([online order](kitchen.md#online-order)) |
| see what I can cook | **📖 Recipes**, sorted by **Fits the stock**; **✨ AI ideas from your leftovers** with an AI |
| see what has to go this week | **More → ♻️ Rescue this week** |
| bring containers or packs to another place | **☑ Select → 📍 Move**, an empty container also with **Only move** in the fill dialog ([Moving](#moving)) |
| see which details are still missing | **More → 🧹 Data care**: per product what is missing, all in one dialog |
| see what a product did over time | **📜 History** – in the stock view, the barcode dialog, or **📜 History of …** on a card |
| see the stock with minimum stock and prices | **More → 🗃️ Stock** |
| count what is really there | **More → 📋 Stocktake**, or **📋 Stocktake** in a compartment |
| link a tag or print a label for a compartment | scan a new tag right at the compartment, or **More → 🏷 Compartments & tags** |
| change areas (with their storage kind), store sections (own ones too), sizes, export, import from Grocy, settings | **More → Setup** (administrators) |

Everything that used to be in the ⋮ menu is under **More** since 5.0; *Areas* and *Categories* are tabs at the top of the **Larder** page.

## Putting things into stock: the same rules everywhere

No matter how a product comes in – **📥 Put the shopping away** (scan, receipt or invoice, by hand), ticking off in the **shopping mode**, **Bought – into stock?** on the start page, **＋ Add a new pack** in the barcode dialog or a **recently used** chip in ＋ – Larder does the same:

1. A product that is **already known** goes to its **usual place** (where most of it is). It **joins an entry without a best-before date** there; otherwise a new entry is made.
2. **Price and best-before date** can be entered right away (**Price/date**, 📷 reads the date from a photo). A pack with a date of its own gets an **entry of its own**, so the oldest one is still used first.
3. The **price** goes into the price history of the product.
4. The matching item on the **shopping list is ticked off**, and *Bought – into stock?* does not offer it again.
5. **＋1** adds another pack of the same product without scanning again; price and date then apply to all of them.
6. Since 6.1 the **best-before date is suggested**: from earlier purchases of exactly this product (*milk kept 9 days when it was put away last time*), else – fresh food only – from the shelf-life table. A suggestion has a dashed frame; check it and change it if needed. Similar products never share their history (*Heinz Ketchup* and *Heinz Ketchup Zero* stay separate).

### Finishing it afterwards: recently put away

Since 6.1, **Done** after putting away and **Add** after a receipt open **📝 Just put away**: one list with **price**, **best-before date**, **area** and **compartment** of every row, all editable, one **Save**. Only what changed is saved; a date entered for the new packs gives them an entry of their own. **More → 📝 Recently put away** shows the same list for the last 7 days (*Only incomplete ones* on by default), so nothing has to be searched one by one.

**Without a barcode** (fruit, bread from the bakery) type the name into **No barcode: name** while scanning. **✍️ By hand** first asks what it is: vacuum-packed meat from the butcher becomes a **bag** and gets its **NFC tag** right away; a food pack added before becomes a bag on its card under **More → Convert to … → Bag**. An **invoice** as PDF (e.g. from an online supermarket) is read by *Receipt or invoice* just like a photo of a receipt.

Only **unknown** products open a dialog (see below). Details: [Stock](containers.md#stock), [shopping mode](kitchen.md#shopping-mode).

## Taking things out

- **−1** takes one pack (household items: one piece). Everywhere – on the card, in the compartment view, in the barcode dialog and in a push – it asks **Used up** or **🗑 Thrown away**.
- **Thrown away** counts in the history, the [statistics](dashboard.md#statistics), the monthly report and *about €X thrown away*; used up counts as consumption (for *lasts about …* and *buy again by consumption*).
- The **last** pack of an entry removes the entry; a container is **emptied** (it keeps its code and can be filled again), a bag disappears.
- **Right on the start page:** below every *use soon* tile are **😋 Eaten** (for expired ones **🗑 Thrown away**) and, when it keeps in the freezer, **🧊 Freeze**. On the card of a container **Eaten** and **Thrown away** sit at the bottom.
- **Cooked:** *🍳 Cooked* on a recipe or in the meal plan takes the ingredients from the stock (the container with the earliest date first) and offers to put **leftovers into an empty container** ([recipe book](kitchen.md#recipe-book)).
- **Open** (packs) marks one pack as opened, optionally at another place (e.g. into the fridge), and shortens its date. **Into a container** transfers a pack into an empty container – or into a **new** one, created right there.

## Moving

Only the place changes – contents, amount and date stay, an empty container stays empty:

- **Several at once:** **Larder → ☑ Select** (or a long press on a tile), tap the entries, **📍 Move**, choose area and compartment. The compartments already used in the area show as chips below.
- **One empty container:** tapping it opens the fill dialog; at the bottom is **📍 Only move (stays empty)**.
- **Splitting packs:** on the card of a pack **Move** can move just a part (e.g. 2 of 6 into the basement).
- Moving is for administrators, because it changes the area in Home Assistant.

## Unknown products

A barcode Larder does not know yet is looked up in Open Food Facts (food), Open Beauty Facts, Open Products Facts and Open Pet Food Facts. Unknown products are **collected** while putting away, shopping or scanning and added **together at the end**: food as **packs**, everything else as **household items**. The receipt marks household goods with 🧻. If a product was renamed, Larder remembers its barcode; packs without a barcode can be linked with **🔗 Link to a product in stock**.

## Shopping list in short

Everything on the **🛒 Shopping** page ([shopping mode](kitchen.md#shopping-mode)):

- **Take over a list from a chat:** copy the list with line breaks (e.g. from WhatsApp or Notes) and paste it into **Onto the list …** (on an iPhone press and hold in the field → *Paste*). With more than one line a preview opens with one item per line; untick what should not go on the list, then **Onto the list**. Dashes, bullets and numbers at the start of a line are dropped, nothing is added twice, at most 50 lines. Typing and pressing Enter always adds just one item.
- **Quick add:** the chips below the field show what you buy often (put away in the last 60 days) and what was struck off or put away lately – never what is on the list already. Typing suggests your products.
- **Amount and note:** tap an item, e.g. **2×** and *lactose-free*. **2×** puts two packs into stock when ticked off. Lists that cannot keep a description get the note in brackets behind the name (*Milk (2× · low-fat)*); Larder still recognises the product.
- **Similar stays separate:** *milk* and *low-fat milk*, *Heinz Ketchup* and *Heinz Ketchup Zero* are always items of their own.
- **Tick off or strike off:** **○ Tick off** means bought – it goes into stock (with **Undo** in the notice). **✕ Strike off** means not needed any more – it leaves the list, nothing goes into stock (with **Undo** too). A product with a minimum stock comes back onto the list when it runs low.
- **Total:** on top *about €19.24 open · €5.37 in the basket · 1 without a price* – with the chosen store's prices, else the last paid ones.
- **Store sections:** the list follows your store (pasta & rice, canned food, baking, spices, international food, sweets & snacks …). **More → 🏪 Store sections** changes the order and adds **own sections**; on a product's card you choose its section. **📍 Where are you?** filters by store, **＋ Store** adds one.
- **Up to date without a button:** the page refreshes itself when someone else adds something. *Prepare the order*, *Recurring* and *Refresh* are under **⋯ More**.

## Buying again: which one when?

| Feature | When it puts something on the list | Set up |
|---|---|---|
| **Add to shopping list when emptied** | when a container is emptied | switch on the card of a container |
| **Minimum stock** | as soon as there are fewer packs than the minimum | stock view or the card of a pack |
| **⏳ Running low** | when a product with a minimum stock will only last until the next shopping trip (forecast) – shown on the start page, optionally straight onto the list | setting *Running low: add to the shopping list right away* |
| **🔁 Buy again by consumption** | when it will not last until the next shopping trip by its consumption – also without a minimum stock, once per purchase | stock view, per product |
| **Recurring purchases** | on fixed weekdays or every n days (bread, water) | **⋯ More → 🔁 Recurring** in the shopping mode |
| **Prepare the order** | on request: what runs out before the delivery after next, to copy or onto the list | **⋯ More → 📦 Prepare the order** in the shopping mode |
| **Replacement interval** | household items due for replacement (water filter) | card of a household item |

Every list item Larder writes remembers the product, brand, package and place, so ticking it off puts it [into stock](#putting-things-into-stock-the-same-rules-everywhere). Details: [Shopping list](kitchen.md#shopping-list).

## Throwing away less

- **🧊 Freeze instead of throwing away:** what in the fridge expires within 2 days and keeps in the freezer gets **🧊 Freeze** – on the start page tile, in the push and in the rescue list. It moves to the freezer and gets the freezer date.
- **♻️ Rescue this week:** **More → ♻️ Rescue this week** (and, if you like, as a push on Sundays) shows what has to go this week and is not planned yet, with **Into the meal plan**.
- **Freezer first:** frozen food near the end of its best quality comes first in the week suggestion and recipe ideas (setting *Freezer first*).
- **What you throw away most:** in the [statistics](dashboard.md#statistics), with a tip per product.

## Best-before dates

- **Printed or estimated:** for packs you enter the printed date (or 📷 reads it from a photo); for containers and bags Larder [estimates](best-before.md#best-before-estimate) it from the contents and the storage place (table, optionally AI) – the estimate never replaces a date you entered.
- **Opened / Thawed** shorten the date (never extend it); an opened pack shows **🫙 opened since …**, so it is clear why the date is shorter than printed.
- **+1 day** moves a date by hand; **Best-before +2 days** in a push does the same from the notification.
- Days are shown in words: **tomorrow**, **in 3 days**, **in 2 months**, **expired yesterday**.
- **Where it is stored counts:** the estimate follows the **storage kind** of the area (fridge, 0 °C compartment, freezer, pantry). **More → 📍 Edit areas** shows what Larder recognised each area as and lets you choose the kind when nothing was recognised.
- **Unknown product:** a product the shelf-life table does not know shows up in **data care**; there (or in the product view under **🧭 Kind for the shelf life**) you choose how Larder treats it.
- **Vacuum:** on the first filling Larder asks whether you have a vacuum sealer; without one, new containers are not preset as vacuum-sealed (the date would be too long).

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
| Shopping list: add, tick off, strike off, amount and note | ✓ | |
| Add bags, packs, household items, medicines, vouchers | ✓ | |
| Add containers, link a tag to a container | | ✓ |
| Link compartments with tags, print labels | ✓ | |
| Selection and serial scan, moving, remembered estimates, export and import, settings | | ✓ |
| Storage kind of areas, own store sections, choosing the shopping list in the first steps | | ✓ |
| AI features (recipe ideas, receipt, date and voucher from a photo) | | ✓ (with *AI Task*) |
| Voucher codes | | ✓ |

## Food, household, pharmacy, vouchers

The switch at the top of the **Larder** page shows one side at a time. Areas belong to one side (e.g. *Bathroom* → household) or both; see [Food, household or pharmacy](containers.md#food-household-or-pharmacy). Household items and medicines have their own, longer warnings and are not part of the daily summary of food; medicines have their [own reminder](kitchen.md#medicines-expiring). *Vouchers* only appears once there is one.

## Notifications: which blueprint for what?

| Blueprint | Sends |
|---|---|
| [Daily summary](kitchen.md#daily-summary) | what expires soon, optionally one push per entry with the buttons **Used up · Thrown away · Best-before +2 days · On the list** (and **🧊 Freeze** for what keeps in the freezer), recipe ideas, voice output |
| [Weekly review](kitchen.md#weekly-review) | last week eaten / thrown away (value), next week's expiring food, a recipe idea |
| [Opened items](kitchen.md#opened-items) | once a week everything opened that runs out soon, with how long it has been open |
| [Delivery day](kitchen.md#online-order) | on the delivery day of your online order, with **Put away** |
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
