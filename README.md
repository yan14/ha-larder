# Zwilling Food Storage

<img src="assets/icon.svg" width="96" align="right" alt="Icon">

[🇩🇪 Deutsch](README.de.md) · 🇬🇧 English

Home Assistant integration for Zwilling food storage containers with a QR code. Every container becomes a device (identified by the `cc` parameter of its QR code) with:

| Entity | Type | Purpose |
| --- | --- | --- |
| **Filled on** | `datetime` | When was the container filled? |
| **Best before** | `date` | Best-before date (MHD) |
| **Contents** | `text` | What is in the container? |
| **Empty container** | `button` | Resets the whole container: **Contents** become empty, **Best before** and **Filled on** are cleared |
| **QR code** | `image` | The container's QR code as an image: scanning it with the camera app opens the device directly in the Home Assistant app |

The values survive restarts. "Empty container" is a regular button entity, so you can use it on dashboards and in automations via `button.press`.

You also get:

- a **dashboard** "Zwilling containers" in the sidebar (see [below](#dashboard-zwilling-containers)) that lists all containers, lets you add containers and edit everything, and updates itself,
- a **scan webhook** for the original Zwilling QR codes (iOS Shortcut, see below).

<p align="center"><img src="docs/images/dashboard-en.png" width="720" alt="Dashboard Zwilling containers (demo data)"></p>

## Installation via HACS

1. HACS → three-dot menu → **Custom repositories**
2. URL: `https://github.com/yan14/ha-zwilling-storage`, category **Integration**
3. Install "Zwilling Food Storage" and restart Home Assistant.

## Adding a container

Settings → Devices & services → **Add integration** → "Zwilling Food Storage". There are two ways:

**Create new QR code**

For containers without a (readable) Zwilling code. The integration generates a new, unique ID in the format `HA-XXXXXXXX` (8 characters, without the easily confused 0/O and 1/I). The `HA-` prefix keeps it clearly apart from Zwilling IDs (e.g. `34OL`), so the two cannot overlap. You can optionally give the container a name. Afterwards you find the QR code as an image on the device (see "Scanning the QR code directly").

**Read Zwilling QR code**

For existing Zwilling containers. Paste the content of the QR code, for example

```
zwilling://zwillingapp/food-storage/in/?tc=42ML30&s=m&cc=34OL
```

The ID alone (`cc`, here `34OL`) is enough as well. You can optionally give the container a name. Each container can only be added once.

Home Assistant has no camera in this dialog. On iOS you read the text with a Shortcut (next sections) and paste it.

You can also add containers in the sidebar dashboard (button **+ Add container**), see [below](#adding-a-container-from-the-dashboard). That is the quickest way once the first container exists.

## Scanning the QR code directly

Every container has the image entity **QR code**. It contains a link that makes the Home Assistant app jump straight to the container's device page (`homeassistant://navigate/config/devices/device/<device-id>`). You do not need a Shortcut for this.

1. Open the container's device in Home Assistant (or the "Zwilling containers" panel, where the QR code is shown small) and open the **QR code** entity. Save or print the image and stick it on the container. The content of the code is also available in the `qr_content` attribute of the entity.
2. Scan the sticker with the camera app. iOS offers to open the link in the Home Assistant app, and the app shows the container.

The code points to the device ID in Home Assistant. If you delete the container and add it again, it gets a new device ID and the sticker has to be printed again. If you have several Home Assistant servers in the app, it asks which one you mean when opening.

## Dashboard "Zwilling containers"

As soon as at least one container exists, a sidebar entry **Zwilling containers** (German UI: "Zwilling Dosen") appears. It needs no configuration and shows every container on a card (screenshot at the top):

*The screenshots show demo data. The panel adapts to your Home Assistant theme and language (English and German).*

- All containers of the integration, grouped by **area** (the area of the device) and sorted by name.
- Per container: area, **contents**, **best before** (with a hint "expired" or "n days left" starting 3 days before), **filled on**, the **Empty container** button and the QR code as a small image.
- Contents, best-before date and filled-on date can be edited right in the panel. "Now" sets "Filled on" to the current time.
- The **area** of a container can be changed with the dropdown on its card, no detour through the device page needed.
- **+ Add container** (top right) adds a container: either *Create new QR code* or *Read Zwilling QR code*, with optional name and area. It uses the same flow as Settings → Devices & services.
- New containers, changed values and changed areas show up immediately, no reload needed.

The panel is visible to all users, but only **administrators** can add containers and change areas (the same restriction as in the settings). Other users see the area as text. It is not a classic Lovelace dashboard and cannot be edited with the card editor. In return it updates itself.

### Adding a container from the dashboard

**+ Add container** opens a dialog:

<p align="center"><img src="docs/images/add-dialog-en.png" width="560" alt="Add container dialog"></p>

- **Create new QR code** generates a new unique ID. Afterwards open the card (or the device) and print the QR code.
- **Read Zwilling QR code** needs the content of the original code or just the ID. When you come from the iOS Shortcut, the field is already filled in.
- Name and area are optional. You can change both later (the area right on the card).

## iOS Shortcut for the original Zwilling codes

This way is meant for the **printed Zwilling QR codes**. For codes you created yourself you do not need it, just scan them with the camera app.

The QR code contains a link with the scheme `zwilling://`, which belongs to the discontinued Zwilling app. The **camera app is not suitable** for it: it wants to open the link in the Zwilling app and does not give you the text to copy. The Shortcut only reads out the text and does not open the link.

### 1. Find the webhook URL

Settings → Devices & services → **Zwilling Food Storage** → **Configure** on one of the containers. The dialog shows the webhook URL, built like `https://<your-HA-URL>/api/webhook/<long-secret-ID>`. The URL is the same for all containers, so you only need it once. You can close the Configure window with "Submit" afterwards, it changes nothing.

The long ID is the access protection, so treat the URL like a password. Which address is shown at the front (internal or external) depends on your Home Assistant configuration. When you are away from home the Shortcut only works with an address that is reachable from outside.

### 2. Create the Shortcut (once)

Shortcuts app → new shortcut with these actions, in this order:

1. **Scan QR/Bar Code**
2. **Get Contents of URL**:
   - URL: your webhook URL from step 1
   - Tap "Show More", method **POST**, request body **JSON**
   - "Add new field": type **Text**, key `code`, value: the result of action 1 (pick the "QR/Bar Code" variable from the variable bar)
3. **Get Dictionary Value**: key `app_url`, from "Contents of URL"
4. **Open URLs**: opens the value from action 3

Give it a name, e.g. "Scan container". Using the share icon you can add it to the Home Screen or assign it to the Action button. On the first run iOS asks for camera access and whether the Shortcut may access the URL.

### 3. Use it

Run the Shortcut and scan the QR code on the container. The Home Assistant app then opens:

- **Container known:** directly on the **device page** of this container (with Filled on, Contents and Empty container).
- **Container new:** on the dashboard "Zwilling containers", where the **Add container** dialog opens with the scanned code already filled in. Optionally enter a name and area and tap **Add**. This needs an administrator account; other users get a note with the scanned code.

If you have several Home Assistant servers in the app, it asks which one you mean when opening.

## Webhook interface

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
  "path": "/config/devices/device/0a1b2c…",
  "app_url": "homeassistant://navigate/config/devices/device/0a1b2c…"
}
```

For an unknown container `known` is `false`, and `path` and `app_url` point to the dashboard with the add dialog (`/zwilling-storage?add=<ID>`). If the request contains no valid ID, the webhook answers with `400` and `{"error": "invalid_code"}`. The webhook only reads and never changes any values.

## Development

```
pip install -r requirements_test.txt
pytest

npm install
npm test        # tests for the panel (jsdom)
```

The screenshots come from the real panel code with demo data: serve the repository (`python -m http.server`), open `docs/demo/index.html?lang=en` (or `de`, plus `&dialog=scan` for the dialog) and take a screenshot.
