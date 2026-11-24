# EV Bus Live: real-time EV bus tracking SaaS

A multi-tenant platform where bus operators share live bus locations with passengers through WhatsApp. This build runs entirely on your own computer. You don't need a cloud account, a phone number or any API keys.

| What the spec asks for | What this build uses for now | What to swap in later |
|---|---|---|
| Azure PostgreSQL | Embedded Postgres ([PGlite](https://pglite.dev)), stored in `backend/data/` | Set `DATABASE_URL`. The same SQL runs unchanged. |
| WhatsApp Cloud API | **Outbox**: every message is saved and shown in Developer console → Message outbox | Set `MESSAGING_CHANNEL=whatsapp` and add your token and phone number ID |
| SMS / WhatsApp OTP | The login code appears on the conductor's screen and in the Outbox | Set `EXPOSE_DEV_OTP=false` once WhatsApp is connected |
| Google Maps | Leaflet + OpenStreetMap (no key) | Replace `frontend/assets/js/map.js` |
| Azure Blob Storage | Payment screenshots are stored in `backend/uploads/` | Replace `backend/src/lib/storage.js` |
| Azure Functions timers | Background jobs run inside the API process (`backend/src/jobs.js`) | Timer-triggered Functions that call the same service functions |
| Conductor phone GPS | Real GPS, **plus a "Simulate GPS" switch** that drives the bus along the route | Nothing. Real phones just work over HTTPS. |

## Run it

You need **Node.js 20 or newer**. Nothing else.

```bash
npm install
npm run dev
```

Then open **http://localhost:4000**. The first start creates the database and fills it with demo data.

| Role | Where | Sign in |
|---|---|---|
| Developer (platform owner) | http://localhost:4000/dev/ | `dev@evbus.local` / `Dev@12345` |
| Operator admin, *EV Services* | http://localhost:4000/admin/ | `admin@evservices.local` / `Admin@12345` |
| Operator admin, *Urban Transit* | http://localhost:4000/admin/ | `admin@urbantransit.local` / `Admin@12345` |
| Conductor | http://localhost:4000/conductor/ | `0300 1234567` or `0300 7654321`. The code is shown on screen. |
| Passenger signup | http://localhost:4000/join/?op=ev-services | none |
| Passenger live map | Admin → Routes → copy a live map link | none |

Other commands:

```bash
npm test          # 20 automated tests: cohort maths + the full SRS acceptance flow on an in-memory DB
npm run seed      # wipe and recreate the demo data (stop the server first)
npm run reset-db  # delete the local database and uploads (stop the server first)
```

## A 5-minute demo

1. **Conductor** (`/conductor/`): sign in with `0300 7654321`, pick **EV2 → Towards City Centre**, and press **START TRIP**. Turn on **Simulate GPS**.
2. **Passenger map**: open Admin → Routes → copy EV2's *Towards City Centre* link. The bus moves every 5 seconds.
3. **Signup**: today (22 Nov) is outside a signup window, so `/join/` offers the waitlist. To test signup now, go to Developer → **Settings** and tick **Force signup window open**, then sign up and pay with any transaction ID.
4. **Admin → Payments**: open the screenshot, then **Confirm & send invite**. The passenger's status page turns green.
5. **Developer → Message outbox**: you'll see the WhatsApp invite with both group links and both map links, exactly as it will be sent.
6. **Admin → Cohorts**: one demo subscriber (*Kamran*) is past his cohort end. **Run cycle switch** to expire him and get the list of numbers to remove from each group.
7. **Tenant isolation**: sign in as the Urban Transit admin. You only see route UT1.
8. **Developer → Operators**: change EV Services to *Premium* and the route limit goes from 5 to 20. **Impersonate** opens that operator's admin view with a purple banner.

## Project layout

```
backend/                 Node.js + Express API (plain JavaScript, ES modules)
  src/
    index.js             starts DB → migrations → seed (first run) → server → jobs
    app.js               Express app, security headers, serves the frontend
    config.js            reads backend/.env
    db/                  adapter (PGlite or Postgres), migrations/001_init.sql, seed
    lib/                 auth (JWT, bcrypt), cohort maths, feature flags, phone numbers, audit log
    messaging/           channel router (console Outbox / WhatsApp Cloud API) + message catalogue
    services/            subscriptions, payments, cycle switch, trips, GPS pings
    routes/              auth, public (passenger), conductor, admin, dev
    jobs.js              auto-close trips, renewal reminders, waitlist notify
  test/                  node:test suites
frontend/                Plain HTML + CSS + JavaScript, no build step
  index.html, login.html
  dev/  admin/           developer console and operator admin (sidebar apps)
  conductor/             mobile conductor app
  join/                  passenger signup + status
  live/                  passenger live map
  assets/css, assets/js  shared styles, API client, UI helpers, one module per page
```

**Design system.** Everything is in `frontend/assets/css/app.css`: the Inter font (self-hosted, so it works offline), a neutral palette with colour reserved for meaning (green = live, amber = attention, red = danger), and Lucide stroke icons (`assets/js/icons.js`, a small generated subset). Every colour is a CSS token.

**Dark mode.** The app follows the operating system's light/dark setting. People can override it with the Appearance switch in the sidebar, or the sun/moon button on public pages and in the conductor app. The choice is saved per browser. The dark palette sits at the bottom of `app.css`, and the maps darken their tiles to match.

There's one server and one port. Express serves `/api/*` and the static frontend. Because the frontend is plain files, it can later go to Azure Static Web Apps as-is.

## How the SRS rules are enforced

- **Tenant isolation (SR-11/12/13):** each admin or conductor login carries its `operator_id`, and every admin query filters on it. The operator ID never comes from the request. A test checks that one operator can't read or confirm another's data.
- **One live trip per conductor, and per route + direction (SR-01/02):** enforced by unique indexes in Postgres as well as in the code, so two simultaneous taps can't both win.
- **Auto-close after 10 minutes with no GPS (SR-03):** handled by a background job. If the conductor comes back online with fresh GPS, the trip resumes.
- **Exactly 4 groups per route (SR-05):** enforced by validation plus a unique (route, cohort, direction) constraint.
- **Package limits (SR-07/08):** resolved as package features plus per-operator overrides, which can expire (SRS 6.7).
- **Offline GPS (FR-C-11/12):** pings are queued on the phone and uploaded in batches when the connection returns.

## Design decisions to review

1. **Both cohorts get the trip message.** Cohort A runs 1st–end of month and cohort B runs 15th–14th, so **both are always active at once**. SRS 6.6 routes pings only to the "current cohort", which would leave half the riders without updates. In this build, a trip on EV1 Towards targets *both* EV1-Towards-A and EV1-Towards-B. The live map link is per route and direction, so both cohorts see the same bus.
2. **Expiry follows the cohort.** The spec says both "clean 30-day cycles" and "expiry = now + 30 days". I chose clean cycles: a subscription ends when its cohort ends (A on the last day of the month, B on the 14th), whenever the payment was confirmed. A signup is only possible in the first 5 days, so the most anyone loses is 4 days.
3. **Renewals** are a new signup in the next window. Someone who renews into the same cohort letter keeps the same WhatsApp groups, so the cycle switch doesn't ask you to remove them.
4. **Cycle switch** is a button the admin presses, with a dashboard reminder, as the risk table suggests. It expires finished subscriptions, messages people who didn't renew, and lists, group by group, which numbers to remove. WhatsApp's API can't remove group members, so that step stays manual.
5. **Deleting a route** with history archives it instead, so trips and payments are never lost.
6. **The live map is reached by link.** Anyone with the link can open it. You can generate new links on the route page, for example each cycle.

## Connecting the real services later

**WhatsApp Cloud API**
1. In Meta Business Manager, create the app and add a phone number. Then create message templates named after the `template` values in `backend/src/messaging/messages.js`: `subscription_invite`, `conductor_login_code` (an *authentication* template), `renewal_reminder`, `payment_rejected`, `signup_received`, `subscription_expired`, `waitlist_joined`, `signup_window_open` and `cohort_switched`. Copy the wording from each message's `text` and replace the values with `{{1}}`, `{{2}}` and so on, in the same order as `params`.
2. In `backend/.env`: `MESSAGING_CHANNEL=whatsapp`, `WHATSAPP_TOKEN=...`, `WHATSAPP_PHONE_NUMBER_ID=...`, `EXPOSE_DEV_OTP=false`.
3. Every send, successful or not, is still logged in the Outbox / `delivery_log`.

**Keeping the WhatsApp bill down.** Meta charges for each template message (about Rs 4 each in Pakistan, according to October 2026 press reports). Developer console → **Paid messages** has an on/off switch for every message type, a 30-day count with the estimated cost, and two presets: *Recommended* and *Essentials only*. A switched-off message is not sent or charged, but it still appears in the Outbox as "Switched off".
- Off by default: *Signup received* (the status page already shows it) and the *7-day renewal reminder* (only the 3-day one is sent).
- *Keep conductors signed in* (on by default): a conductor signs in once per phone and stays signed in until they tap Sign out or an admin deactivates them, so a login code is only paid for once.
- Trip updates in the WhatsApp groups are always free, because the conductor or admin posts them.

**Azure**
- *Database:* create a PostgreSQL Flexible Server and set `DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require`. Migrations run on start. Run `npm run seed` only if you want demo data there.
- *API:* either host the backend as-is (App Service / Container Apps), or wrap each Express router in Azure Functions HTTP triggers. The business logic lives in `services/` and doesn't depend on Express.
- *Frontend:* deploy the `frontend/` folder to Static Web Apps. If the API is on another domain, set `CORS_ORIGIN`.
- *Uploads:* swap `lib/storage.js` for Azure Blob Storage.
- *Production checklist:* set a long random `JWT_SECRET`, set `PUBLIC_BASE_URL` to your real domain (it goes into WhatsApp links), use HTTPS (phones only share GPS over HTTPS), and switch map tiles to a provider whose terms allow production traffic.

## Testing on a real phone

Browsers only allow GPS on `https://` pages or on `localhost`. To try the conductor app on your phone, expose the server over HTTPS. For example, run `npx cloudflared tunnel --url http://localhost:4000` and set `PUBLIC_BASE_URL` to the URL it prints. Keep the conductor page open and the screen on. The app asks the phone to keep the screen awake while a trip is live.
