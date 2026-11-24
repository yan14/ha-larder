# Changelog

Release notes for every version, newest first. They are also used as the text of the GitHub releases
(the workflow `release.yml` takes the section of the version in `manifest.json`).

## 5.3.2

- **Shopping mode:** lists from other integrations (e.g. Google Tasks) are read straight from the list when the action *get items* fails, and one odd item no longer hides the whole page. Instead of *Nothing on the shopping lists* the page now says why: which lists were read with how many open items, a list that cannot be read (with the reason), or a list chosen in the settings that does not exist (any more). While loading it says so.
- **Settings:** saving the integration's settings no longer resets the order of the store sections chosen in the dashboard.

## 5.3.1

Fixes from everyday use (block 40).

- **Barcode dialog:** tapping a place (or **Details**) opens the card of that pack; food packs can be **transferred into a container** right there.
- **Transfer into a container:** **＋ New container** (administrators) creates a container and transfers the pack into it right away.
- **Writing NFC stickers:** after *＋ → Write a new NFC tag* (and wherever Larder writes a sticker) a step of its own comes up – **📡 Write now** opens the app's writer, **Write again** if no window opened, **Done** goes on to filling. Before, the app was asked once in the background and nothing happened if it missed it.
- **Container card:** **✍ Write a new sticker** links a blank sticker (blank stickers cannot be scanned); the NFC row is back below the date instead of under *More*. *Scan NFC tag* now says that blank stickers have to be written.
- The check whether the app can write stickers waits for the app's settings everywhere, so *✍ Write sticker* in a compartment no longer goes missing.

## 5.3.0

Compartments and NFC tags made easy (block 36).

- **New tag? Just scan it:** a tag Larder does not know yet asks *What is it for?* – a compartment (area and compartment with suggestions), a container (administrators) or *Ignore*. In the open dashboard right away, otherwise as a notification on the scanning phone. Tags with a name in Settings → Tags (used for something else) stay untouched; event `larder_unknown_tag`.
- **More → 🏷 Compartments & tags:** every compartment with something in it and every linked one, with its tag status. Tap one to link or write a tag, print its label or start a stocktake; tick several to print their labels at once.
- **🏷 where compartments are:** next to the compartment on a card and next to each heading of the Larder page sorted by *area and compartment*. The tag buttons are now at the top of the compartment view.

## 5.2.0

Notifications you can act on, and Larder in your own Home Assistant dashboards and automations (blocks 34 and 35).

**Notifications**

- **Buttons in the push:** the daily summary can send one push per expiring entry with **Used up · Thrown away · +2 days · On the list**. A tap does it right away, without opening the app (option *One push per entry with buttons*; re-import the blueprint). The buttons are also in the result of `larder.get_expiring` for your own automations.
- **Buy again by consumption:** **🔁** next to a product in the stock view puts it onto the shopping list as soon as it will not last until the next shopping trip by its consumption – before the minimum stock is reached, once per purchase (event `larder_auto_reorder`).
- **Weekly review:** a new blueprint sends on Sunday what was eaten and thrown away last week (with its value), what expires next week and optionally a recipe idea (service `larder.get_weekly_review`).

**Larder in Home Assistant**

- **Overview sensors** on the main entry: `sensor.larder_expired`, `sensor.larder_expiring_soon`, `sensor.larder_stock_value`, `sensor.larder_shopping_open` and `sensor.larder_supply_days`, e.g. for a red light at the fridge.
- **Two new cards:** **Larder: Shopping** (open items per list, button to the shopping mode) and **Larder: Compartment** (what is in an area or compartment, with −1 – e.g. for a fridge tablet).
- **Two new blueprints:** *fridge door reminder* (door opens and something expires today → announcement) and *say what is in a compartment* (compartment tag scanned → a speaker lists its contents).

## 5.1.0

Faster entry and a history per product.

- **Product history:** what happened to a product across all containers, bags and packs – *ham was in container 3 last week, in container 7 this week* – with how often a year, how long it lasted on average, how much was thrown away (and its value), the prices and a hint like *thrown away 2 of 6 times – buy smaller amounts or freeze some?*. Open it with **📜 History of …** on the card, **📜 History** in the stock view or in the barcode dialog (also from the search).
- **Best-before date from a photo:** **📷** next to the date when putting away, in the shopping mode, after *One pack more* and on the card. The AI reads the printed date (administrators with an AI Task); only month and year printed → the last day of that month.
- **Several packs at once:** **＋1** next to a product when putting away and after *One pack more* adds another pack without scanning again; price and date then apply to all of them.
- **Recently used:** the last products added appear as chips in **＋** and in the empty search. One tap adds one pack at its usual place, even when none is left.

## 5.0.0

**Larder is now in the HACS default catalogue** – search for *Larder* in HACS (or the Home Assistant Marketplace), no custom repository needed any more. Existing installations keep updating as before.

A big usability release: what you need often is one tap away, and every way into and out of the stock follows the same rules.

**Navigation and start page**

- **New bar:** Start · Larder · **Shopping** (with the number of open items) · Recipes · **More**. *Areas* and *Categories* are now groupings at the top of the Larder page (**List · Areas · Categories**); old links like `?view=areas` keep working.
- **More** replaces the ⋮ menu, in three sections: *Everyday* (put away, receipt, stocktake, batch cooking, labels), *Overview* (stock, statistics, emergency supply, data care) and *Setup* for administrators (edit areas, store sections, container sizes, export, estimates, settings).
- **Quick actions** at the top of the start page: 📷 Scan · 📥 Put away · 🧾 Receipt · 🍳 Recipe idea.

**Scan and search**

- **One 📷 Scan button** at the top of every page (Home Assistant app) that recognises what was scanned: a barcode shows the packs of that product, a container's QR code or NFC opens its card, a compartment label the compartment view.
- **🔍 Search** at the top of every page: type a product to see every place with count and date, with −1, open, move and one pack more – no scan needed. Barcode digits are looked up like a scan.

**Slimmer card**

- The frequent actions as big buttons at the top: **−1**, **Open**, **Used up / Empty**, **Move**. Below only contents, amount, best-before date and place; everything else (price, store section, list, minimum stock, nutrition, NFC, replacement interval, convert …) is under **More**.

**The same rules everywhere**

- **Put away (📥)** now ticks off the shopping list too, and price and best-before date are entered right in the list (**Price/date**) instead of on the card.
- **Bought – into stock?** puts known products straight at their usual place with one tap; the dialog only opens for new products.
- **Barcode dialog → ＋ Add a new pack** joins the pack at the usual place (then price and date right away, or move it) instead of always creating a new entry.
- **Unknown products** are split into food packs and household items everywhere (put away, shopping mode, scan, receipt). The receipt now also reads household goods (🧻) and creates new ones as household items.
- **−1 on the card and in the compartment view** asks *Used up* or *🗑 Thrown away*, like the barcode dialog, so thrown-away packs count in the history, the statistics and the value lost.

## 4.12.0

- **Data care:** once a month, while something is missing, the start page shows **🧹 Data care** (hide it until next month with ✕; **⋮ → 🧹 Data care** any time): opened packs without a date, packs without a best-before date, products without a price, entries without an area or compartment, and products used often without a minimum stock. Tapping an entry opens its card.
- **🫙 Opened since …** on tiles and in lists, so it is clear why the date of an opened pack is shorter than printed.
- **Receipt ticks off the shopping list:** products read from a receipt also complete their open items on the shopping lists, so the shopping mode and *Bought – into stock?* do not add them twice.

## 4.11.1

- **Receipt like the shopping mode:** products from a receipt that are already in stock go to their usual place and join a pack there (with the price from the receipt and, if entered, their own best-before date). Only new products are created at the area and compartment chosen in the dialog.

## 4.11.0

- **Scan in the shopping mode:** **📷 Scan** (Home Assistant app) ticks off the matching item on the list and puts it into stock. Known products that are not on the list go into stock anyway; unknown ones are collected with their name from Open Food Facts and added at the end.
- **Price and best-before date when ticking off:** **€ / date** next to a ticked-off item. The price goes onto the pack and into a new **price history** (stock view: *€1.79 → €1.99 → €2.49*); with a date, the new pack gets an entry of its own when it joined one with more packs.
- **🧾 Receipt** is now also on the start page and in the shopping mode (administrators with an AI Task), not only in ＋ → Pack.

## 4.10.4

Better categories, from a real larder:

- **New category 🧂 Sauces, oil & spices:** ketchup, mustard, mayonnaise, soy sauce, curry paste, tomato paste, oils and spices (before: sweets or dry goods).
- **Game:** venison (Reh), deer, wild boar, rabbit, and cuts like *Unterschale*, *Keule*, *Rücken*, *Nacken*; marinated meat and gyros count as raw meat instead of a dish.
- **Fish:** more kinds (redfish, sea bream, halibut, Alaska pollock …) and canned fish (herring fillets in tomato sauce or cream, sardines, tuna in its own juice) instead of a sauce or dish.
- **More:** Brezen as bread, pumpkin seeds and nut butters as dry goods, cocoa drinks (Caotina, Kaba) with coffee, jam brands and fruit spreads as sweets, ready meals (teriyaki, dim sum, gyoza) as dishes, more pasta shapes.
- Raw pudding rice: *Milchreis roh*, *Milchreis ungekocht* or *Rundkornreis* count as dry goods; plain *Milchreis* stays a dish (cooked).
- Long shelf lives on tiles and in lists are shown in months or years from 60 days on (*8 mo*, *4 y* instead of *1556 d*).
- Remembered table estimates are calculated anew, your own corrections stay.

## 4.10.3

Changes requested in the review for the HACS default catalogue: Larder no longer reaches into other integrations.

- **Calendar:** only Home Assistant's calendar entity features are used. **CalDAV calendars are no longer supported**, because Home Assistant's CalDAV calendar cannot delete events (before, Larder used the CalDAV integration's own connection). Choosing one is rejected in the settings; events written earlier stay in that calendar.
- **NFC tags:** emptying a bag no longer deletes its tag from Settings → Tags (that list belongs to Home Assistant). The link in Larder is still removed, and an old sticker scanned by mistake still says when the bag was emptied.

## 4.10.2

- **Plant-based food:** new category **🌱 Plant-based** (*Vegan & Tofu*) for tofu, tempeh, seitan, veggie burgers, falafel, hummus and dry soy chunks, lupin or pea protein (kept long when dry). Before, they showed up as *Other* or as a dish.
- Soup pasta (*Sternchen*, *Buchstaben*, soup noodles) counts as dry goods instead of a cooked soup; bagels, tortillas, pita and naan as bread.
- The shelf-life table was extended: remembered table estimates are calculated anew, your own corrections stay.
- **How long expired:** tiles and lists show *expired (3 d)* (months and years for older ones), the card *expired 3 days ago*.

## 4.10.1

- Releases are now created only after all checks (hassfest, HACS action, lint, tests) have passed for that version – preparation for the default HACS catalogue. No functional changes.

## 4.10.0

- **Shopping mode:** **🛒 Go shopping** on the start page (or **⋮ → 🛒 Shopping mode**) shows every list Larder uses, grouped by store section. Ticking an item off completes it on its list and puts it into stock right away at its usual place (as many packs as Larder asked for); unknown items are collected and added together at the end. *Bought – into stock?* does not offer them again.
- **Recurring purchases:** **🔁 Recurring** on the shopping page puts things you do not count onto the list on chosen weekdays or every n days (at 8:00), never twice while still open.

## 4.9.0

- **Voucher from a photo:** with an AI Task set up, **📷 Read from a photo** in the voucher dialog fills in shop, value, valid until and code from a photo; everything can be checked before saving. The code is returned to administrators only.
- Vouchers no longer show up as classic cards (view *cards with all details* and the classic panel); they always open their own dialog.

## 4.8.0

- **Vouchers:** **＋ → 🎟️ Voucher** keeps vouchers with value, valid until and place (area and compartment). They get a side of their own, **🎟️ Vouchers**, which appears once there is one, with the open value and what expired or was redeemed in the last 12 months. Tap a voucher to **redeem part** of it (the remaining value goes down), mark it **fully redeemed** or **expired**, or edit value, date and code.
- **Reminder:** vouchers warn 60 days ahead like medicines, have a section on the start page and are named in the medicine reminder (blueprint switch *Include vouchers*, service field `include_vouchers`), e.g. "the Thalia voucher worth 25 euros".
- **Code for administrators only:** the optional code is kept outside the entity state and shown to administrators only.
- With four sides the switch shows the other sides as symbols.
- Docs: example of a hygiene box with an NFC tag or QR code (household items in a compartment).

## 4.7.0

- **One-click setup:** *Add integration* now creates a main entry **Larder** without a device or questions, so the dashboard is in the sidebar right away. While Larder is empty, the start page shows **🚀 Get started** (assign areas, choose a shopping list, add the first item). Existing installations get the main entry automatically; the settings are under its *Configure*. Adding the integration again offers the QR ways for a container.
- **Shopping list by store section:** every product has a section (fruit & vegetables, bakery, chilled, frozen, drugstore …), suggested from kind and category and changeable on its card. Items Larder writes are moved behind the last item of the same or an earlier section on lists that can move items (Shopping list, Local To-do). The order is set under **⋮ → 🏪 Store sections**.
- **Emergency supply check:** **⋮ → 🛟 Emergency supply** compares the stock with the BBK example supply for 10 days (drinks, grain, vegetables, fruit, dairy, protein, fats) and checks candles, batteries, radio, hygiene and first aid. Missing things go onto the right shopping list with 🛒. Persons and days are settings; it can be switched off.

## 4.6.0

- **Replace regularly:** household items such as a water filter or vacuum bags get an optional interval (*Replace every (weeks)* on the card). The card shows when it is due, **🔁 Replaced** takes one piece and restarts the interval, and the household section of the start page lists what is due within a week under **🔁 Replace soon**. On the due day the event `larder_replace_due` fires; the stock alerts blueprint can send it as push (new switch).
- **Names:** the bottom bar says **Vorrat / Larder** (🥫) instead of *Lager / Storage*; the stock view is now **🗃️ Bestand / Stock**; the food side uses 🍎.
- Household items and medicines: **Used up** instead of *Empty container* on the card; counts and empty texts no longer speak of containers.
- Tests: comments and test names are in English now.

## 4.5.0

- **Medicines expiring:** new blueprint *Larder – medicines expiring* reminds you on the chosen weekdays (e.g. every Monday) of medicines and household items with a date that expire within their warning period, as push to several phones and optionally read out on Alexa. Nothing is sent when nothing is due; run by hand it sends a test. New service `larder.get_expiring_medicines` (count, expired, items, summary, speech) for own automations. The daily summary stays food only.

## 4.4.0

- **Medicines (pharmacy):** a third side next to food and household (**＋ → 💊 Medicine**, tab *Pharmacy*). Expiry date with a **longer warning** (new setting, default 60 days) and a section of its own on the start page; not part of the daily summary, recipes or food statistics. Areas with the label `Larder: Pharmacy` / `Larder: Apotheke` are offered only for medicines (the automatic assignment knows medicine cabinets and first-aid kits). Own default shopping list. Categories for pain, colds, digestion, wounds, allergy and vitamins.
- **Household items with a date:** optional expiry date (e.g. sunscreen) on the card and in the add dialog, with the longer warning in the household section of the start page.
- **Period after opening** (*Keeps after opening, months* – the jar symbol): **Open** now also works for household items and medicines and limits the date to that period.
- The card offers **Convert to …** food pack, household item or medicine.

## 4.3.0

- **Put away after shopping** (**📥 Put away** on the start page, in the stock view and under ⋮): the app's barcode scanner stays open for one product after another. Known products become one more pack at their usual place right away (household items: a whole pack), confirmed in the scanner; unknown ones are collected and added together at the end. Bought items of these products are taken care of. Without the app's camera the barcode can be typed in.

## 4.2.0

- **Barcode dialog:** when a scanned product is in stock, every place (opened and oldest first) offers, for one pack, **Used up**, **Thrown away** (recorded in the history and statistics with its value), **Open** and **Move**. **＋ Add a new pack** adds another pack of the same product, prefilled with name, brand, barcode, price and the place where most of it is. Household items: *−1 piece* instead of *Used up*, no *Open*. Products not in stock: unchanged.

## 4.1.0

- **Several shopping lists:** a default list for food and, optionally, one for household items (empty = the food list). Each product can get a list of its own (e.g. butcher, pharmacy) on its card or in the add dialog; it is remembered by product name. Emptying, minimum stock, running low, meal plan, *Time for … again?* and 🛒 all follow this; *Bought – add to stock* watches every list Larder wrote to.
- **Household statistics:** the switch on **⋮ → 📊 Statistics** shows what household items cost per month on average, spending per month for six months and per product use and cost per month (from pieces taken, with pack size and price at that time).
- **Recall warnings for household items:** with household items, Larder also fetches the lebensmittelwarnung.de feed of all product types and matches household items against the cosmetics and consumer goods warnings. Food is still matched only against food warnings.
- Fixed an error in the log (`ValueError: too many values to unpack` in `repair_hints`) when a device of another integration with identifiers of more than two parts was changed.

## 4.0.1

- iOS app: the dashboard no longer starts with the bottom navigation half off the screen, and the page can no longer be pushed up so that the header disappears. Since 3.8.1 the dashboard took the full screen height although Home Assistant places it below the status bar; it now measures the space it really has (also after rotating the phone).

## 4.0.0

**Breaking change:** areas can now be used for food, for household items or for both. After the update every Larder area is offered for both; assign the use once (repair hint *Larder 4.0: assign areas to food and household*, or **Areas → ✏️ → Assign use automatically**). Only labels are added, existing labels and their descriptions stay as they are. See [Food or household](docs/en/containers.md#food-household-or-pharmacy).

- **Household items** (**＋ → 🧻 Household item**): toilet paper, detergent, batteries and the like, without a best-before date. Counted in **pieces** (−1, stocktake and minimum stock per piece) with **pieces per pack**; the shopping list gets the number of **packs**, rounded up (*Toilet paper (Zewa, 2 packs)*). Stock and card show *12 rolls · 1.5 packs*. A pack is converted with **→ Household item** on its card (and back); nothing is converted automatically. Household items stay out of *expires soon*, the daily summary, recipes and the food statistics.
- **Areas for food or household:** an additional label `Larder: Household` or `Larder: Food` (German names work too) limits an area to one side; storage-kind labels with temperature and max. storage time stay untouched. Set it under **Areas → ✏️ → Used for**.
- **Food | Household:** a switch on the pages Storage, Areas, Categories and in the stock view, remembered per device. The start page shows both in two sections.
- The page **Containers** is now called **Storage** (German: *Lager*), as it also holds bags, packs and household items.
- **Barcodes beyond food:** if Open Food Facts does not know a barcode, Larder also asks Open Beauty Facts, Open Products Facts and Open Pet Food Facts; such products are offered as household items.
- Housekeeping: all code comments are now in English, unused texts removed, documentation and screenshots updated.

## 3.8.1

- iOS: the bottom navigation no longer moves up (and shows a black bar) when the page is scrolled to the end; only the content scrolls, header and navigation stay put.
- Barcode: a pack added by scanning keeps its barcode when its name is changed, and Larder remembers *barcode → your name*, so a later scan finds it. Packs without a barcode can be linked from the barcode dialog (**🔗 Link to a product in stock**).
- Blueprint *Running low and recalls*: running the automation by hand sends a test notification instead of logging an error. Re-import the blueprint.

## 3.8.0

- **Container sizes:** a fixed size on the card of a container, or **variable** for lids that fit boxes of different sizes (chosen at every filling, the last one suggested). **⋮ → 📏 Container sizes** takes the loose boxes for variable lids; the storage view shows the **free containers by size**. Size on tile and card.
- **Batch cooking** (**⋮ → 🍲 Batch cooking**): split one dish into several empty containers; with millilitres Larder suggests fitting containers by size and splits the amount, then the fill dialog opens for all of them with the amount per container.
- **Week suggestion** (**🪄 Suggest week** on the recipe page): dishes for the next days (5 by default) that use up what expires first, from the recipe book and/or the AI (new settings for source and days); swap or remove single days, then accept them into the meal plan.

## 3.7.1

- Compartment tag: **Write sticker** now shows right away that the tag is linked (it no longer has to be linked again with *NFC tag*); both buttons are offered directly.

## 3.7.0

- **Compartment tags:** a compartment (or a whole area) can get its own NFC tag or QR label (**🏷 Compartment tag** in the stocktake). Scanning it opens the compartment: everything there, oldest best-before date first, **−1** for packs, **Open** for containers and bags, and **📋 Stocktake** for exactly this compartment. Notification on the scanning phone, event `larder_compartment_scanned`.
- **Labels:** text colour (dark blue, dark green, dark red, brown; QR code and frame stay black), **inverted** chalkboard look (QR code on a white patch) and the **Larder symbol in the middle of the QR code** (highest error correction, left out on very small labels).

## 3.6.0

- **Running low:** products with a minimum stock that will only last the *days until the next shopping trip* according to the forecast appear on the start page under **⏳ Running low**, before they drop below the minimum. **🛒 Shopping list** or hide for a week; new setting *Running low: add to the shopping list right away*. Event `larder_running_low`.
- **Recall warnings:** every 6 hours Larder compares the public recalls of [lebensmittelwarnung.de](https://www.lebensmittelwarnung.de) (last 30 days, optionally one German state) with brand, contents and barcode of everything in stock. Matches sit at the top of the start page with reason, place, how they matched and a link; **Read** hides them. The card of the entry shows the hint. Event `larder_recall`; settings to switch it off or limit it to one state.
- **New blueprint *Running low and recalls*** for push notifications of both.

## 3.5.1

- The card of a pack shows the price per pack (own, remembered or the Open Prices estimate, marked as such) and, with several packs, what they are worth together.

## 3.5.0

- **How long it lasts:** every pack taken (−1, emptying, stocktake) is counted, moving and opening are not. The stock view and the card of a pack show *lasts about … · from n takes in …*; the forecast uses 90 days, widens to 180 or 365 when there are fewer than 3 takes and weights recent takes more.
- **Suggested minimum stock:** *Suggestion: at least n* in the stock view, based on your use during the new setting *Stock: days until the next shopping trip* (7 days). Applied only with a tap.
- **Prices:** price per pack in the pack dialog, on the card and from the receipt photo; remembered per product. Without one, packs with a barcode get an estimate from [Open Prices](https://prices.openfoodfacts.org) (Open Food Facts, ODbL), marked as such.
- **Value:** price and value per product and the total value of the stock; the statistics and the monthly report show about how much was thrown away in euros.

## 3.4.0

- **Stocktake** (⋮ → 📋 Stocktake, for all users): go through an area or compartment, tick off, correct counts, remove what is gone (eaten / thrown away) or move it elsewhere; scanning QR codes, barcodes and NFC tags ticks off; summary at the end.
- **Opened packs:** **Open** on the card of a pack splits one off (with a count > 1), marks it 🔓 opened, moves it where you want (e.g. the fridge) and estimates the best-before date for the opened food, at most the printed date. Opened packs come first in the barcode dialog and the stock view.
- **Lovelace card `custom:larder-stock-card`:** below minimum stock (with 🛒), bought but not added yet, opened packs.
- Bags can now be moved to another area and compartment.


- Fix: scanning the barcode of a pack with 📷 offered to add a new container instead of showing the pack in the stock.

## 3.3.0

- **The estimate learns from the history:** remembered estimates get suggestions in the list (⋮ → Remembered estimates): shorter when something was thrown away before its best-before date at least twice, longer when it was eaten well after the date at least twice and never thrown away early. **Accept** or **Ignore**; nothing changes by itself.
- **Monthly report:** new blueprint and service `larder.get_monthly_report` – filled, emptied, eaten, thrown away, share thrown away compared with the previous month and what was thrown away most, as push and speech. Also at the top of the statistics.
- **Time for … again?** The start page suggests what was eaten often (3× in 90 days) but is in no container or pack right now; **🛒 Shopping list** or hide for 30 days.
- The history now records whether a container was vacuum-sealed (for the suggestions).


- **Compartment suggestions:** the compartments already used in the chosen area appear as chips below every compartment field (adding bags and packs, moving, card, fill dialog), most used first; typing filters them, and compartments entered before are remembered on the device.

## 3.2.0

- **Take a pack by barcode:** scan the barcode of a pack (📷 on the start and containers page, 📷 Barcode in the stock view). Larder shows every place of the product with count and best-before date, the oldest first; **−1** takes one from the place you choose. Unknown products can be added as a pack right away.
- **Oldest first:** the stock view sorts the places of a product by best-before date and shows the earliest; the card of a pack warns when an older pack of the same food lies elsewhere.
- **From the shopping list back into the stock:** items that Larder put on the shopping list (minimum stock, emptied containers) and that you tick off are offered on the start page; **Add to stock** opens the pack dialog with contents, brand, count and the usual place.


- **Stock view** (**⋮ → 🥫 Stock**): packs by product, summed over every place, with where they are and the **minimum stock**, editable at a glance.
- **Minimum stock** per product, also on the card of a pack: when there are fewer packs (−1, emptying, moving into a container), the product goes onto the shopping list with brand and package. Kept when the last pack is gone.
- **Move / split packs**: bring some or all packs of an entry to another area and compartment; packs of the same food with the same best-before date are merged.
- **Packs from a receipt photo**: 📷 Receipt in the pack dialog lets the AI propose the food items with their count.
- **Group by area and compartment** on the containers page.
- **NFC stickers for bags** can now be linked by all users (containers still by administrators).
- **Kind** (container, bag, pack) as a column in the inventory and history CSV.


- **Compartment for packs:** packs now have the **Compartment** entity too (e.g. "top shelf"), on the card, tiles and in the search. Existing packs get it after the update.
- **Compartment when adding bags and packs:** optional field in the dialog, applied to all items added at once.

## 3.0.0

**Breaking changes**

- **Larder experimental is gone:** the optional second sidebar entry and its setting were removed (it had been identical to the normal dashboard since 2.0). The blueprint option "Recipes button opens" has only one choice left; existing automations keep working.

**New**

- **Single-use bags** (e.g. vacuum bags): **＋ → Bag** adds several at once (× per content), vacuum preset, best-before date estimated. Mark them with **NFC stickers** one after another (write blank stickers or scan written ones) or print **labels**. After emptying, the bag, its entities and its NFC tag (also in Settings → Tags) are removed; it stays in the history. Scanning an old sticker or label says when the bag was emptied. Codes are never reused.
- **Packs** (stock without a container, e.g. cans): **＋ → Pack** by barcode (Open Food Facts) or by hand, with count and printed best-before date. No code, only six entities. They appear in expiring soon, daily summary, recipes and statistics; **−1** takes one, **Move into a container** opens a pack into an empty container (contents and nutrition move, best-before estimated again, at most the printed date).
- **Label right after filling:** a notice with **🖨 Label** for exactly the containers just filled.
- Filters **Bags** and **Packs**, 🛍 / 📦 on the tiles; attribute `kind` on the **Contents** entity and in `larder.get_expiring`.
- Bags and packs can be added by all users (containers still by administrators only).

**Housekeeping**

- **Docs:** the README is now an overview; the details moved to pages under `docs/en/` and `docs/de/`. New screenshots (bags, packs, statistics, labels, nutrition).
- **Code:** frontend texts and stylesheets split into their own modules, import order unified, linter (ruff) in CI.
- Repair hints "no area" and "no best-before date" skip packs.
- Devices of containers without a Zwilling code now show the manufacturer "Larder" instead of "ZWILLING".

## 2.13.0

- **Allergens in the household** (setting): containers whose allergens or contents match get a ⚠ on tile, list, card and Lovelace card; recipe ideas leave them out (unless picked) and avoid these allergens; attribute `allergen_warning`.
- **Shopping list with brand and package:** "Oats (Kölln, 500 g)" when known (setting, on by default); an open item with the same name is not added twice.
- **Labels:** contents and best-before date are now separate options, e.g. the contents permanently on a jar without a date.

## 2.12.0

- **Lovelace card** `custom:larder-card`: containers that expire soon on any dashboard (options title, days, show_expired, limit, area); loaded automatically, listed in the card picker, tap opens the container.
- **Contents from a photo:** 📷 in the fill dialog lets the AI recognise the food and fills in the contents.
- **Meal plan: ✓ Cooked** takes a portion from (or empties) the containers of the dish; **missing ingredients** of the recipe are shown and go to the shopping list with one tap.
- **Labels:** always black and white; text fills the label and wraps instead of being cut off; new option **nutrition** (kcal, Nutri-Score, allergens); new design **handwriting** (jar label with the Kalam font, OFL) replaces vintage.

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
