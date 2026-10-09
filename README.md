# Cab Portal (customer app + driver app)

Two separate pages that talk through one backend, the way real cab apps work.

```
public/customer.html  --->  /api/ride    --->  Turso (libSQL) database
public/driver.html    --->  /api/driver  --->  (same database)
```

- Customer books, a request goes to the nearest online driver for 15 seconds, then the next, and so on.
- Driver accepts or rejects. Accept assigns the cab to the customer.
- Driver enters the customer's PIN to start the trip, ends it, the customer pays, and a receipt and history are saved.
- The pages poll the API every 2 seconds. Vercel functions cannot hold WebSocket connections, so polling keeps it simple.

## Project files

```
api/_lib.js        Turso client, pricing, auto-creates tables, dispatch logic
api/ride.js        customer API (create, cancel, retry, pay, history)
api/driver.js      driver API (online, accept, reject, arrived, start, end, earnings)
api/admin.js       admin API (add, edit, switch online, delete drivers), needs ADMIN_KEY
api/payouts.js     payment settings (UPI) and driver payouts, needs ADMIN_KEY
api/geo.js         address search and reverse lookup (OpenStreetMap / Photon)
api/route.js       road distance, time, route line and fares (OSRM)
api/stats.js       dashboard numbers (overview, drivers, trips, customers, CSV export), needs ADMIN_KEY
public/            customer.html, driver.html, admin.html (dashboard), index.html, shared.js, shared.css
schema.sql         optional manual schema and 4 sample drivers
demo-data.sql      optional: 100 demo drivers and about 800 trips to preview the dashboard
.env.example       SAMPLE values for the two environment variables
```

## 1. Create the Turso database

```bash
turso auth login
turso db create cab-portal
turso db show cab-portal --url          # -> TURSO_DATABASE_URL
turso db tokens create cab-portal       # -> TURSO_AUTH_TOKEN
```

The tables and 4 sample drivers are created automatically on the first API call.
To create them by hand instead: `turso db shell cab-portal < schema.sql`

## 2. Run locally (optional)

```bash
npm install
cp .env.example .env.local      # then put your real URL and token inside
npx vercel dev                  # opens http://localhost:3000
```

Without the two variables the API falls back to a local `local.db` file.

## 3. Push to GitHub

```bash
git init && git add . && git commit -m "Cab portal"
git branch -M main
git remote add origin https://github.com/<you>/cab-portal.git
git push -u origin main
```

`.env` and `.env.local` are in `.gitignore`, so your token is never committed.

## 4. Deploy on Vercel

1. Vercel > Add New > Project > import the GitHub repo. Leave the framework as "Other".
2. Settings > Environment Variables, add for Production, Preview and Development:
   - `TURSO_DATABASE_URL` = your `libsql://...turso.io` URL
   - `TURSO_AUTH_TOKEN` = your token
   - `ADMIN_KEY` = a long secret of your choice, used to sign in to the admin page
   - `COMMISSION_PCT` = your agency commission percent per fare (optional, default 20)
3. Deploy (or redeploy after adding the variables).

## Agency dashboard and managing drivers (`/admin.html`)

Sign in with your `ADMIN_KEY`. Pick a date range at the top (Today, Last 7 days, Last 30 days, This month, All time, or Custom).

- **Overview:** business revenue, your commission profit, driver payouts, completed trips, average fare, customers served, cancelled or unserved bookings, trips in progress, drivers online. Also a daily revenue chart, the top 5 drivers and a payment-method split.
- **Drivers:** every driver with trips, revenue, what the driver earns, your commission and last trip. Search by name, plate or car, and sort. Works for hundreds of drivers (25 per page).
- **Trips:** every booking with customer, driver, route, fare, commission and status. Filter by status, search by customer, driver or trip id. Click a driver or customer name to see only their trips.
- **Customers:** who booked, how much they spent and which drivers served them.
- **Manage drivers:** add, edit, switch online or offline, and delete. A driver with no trips is removed completely. A driver with trips is hidden instead, so old receipts and history keep their name. A driver with a ride in progress cannot be deleted.
- **Export CSV** on the Drivers, Trips and Customers tabs downloads up to 5,000 rows for your filters, for Excel or accounts.

**Commission:** set by `COMMISSION_PCT` (default 20). It is saved on each trip when the customer pays, so changing the rate later only affects new trips.

## UPI payments and driver payouts

**Payment settings tab:** enter your agency UPI ID and payee name, and choose who customers pay:

1. **Agency UPI (default):** the customer scans your agency QR for the exact fare. Your drivers are paid later from the Payouts tab.
2. **Driver's own UPI:** the customer scans that driver's QR, and the driver then owes you the commission.

**Drivers' UPI ID:** set it per driver in Manage drivers (for example `name@bank`). It is used for payouts, and for mode 2 above.

**Payouts tab:** a running balance for every driver.
- Fares collected by the agency add to what you owe the driver (fare minus your commission).
- Cash trips, and trips paid to the driver's own UPI, subtract your commission from the driver's balance. A negative balance means the driver owes you.
- Press Settle to pay a driver. For a positive balance it shows a UPI QR for the driver's UPI ID with the amount filled in, so you scan and pay from your UPI app, then press Mark as done and add the UTR. Every settlement is kept in the history. If a driver owes you, choose "The driver paid me" to record it.
- A driver with an unsettled balance cannot be deleted. Drivers see their pending payout (or what they owe) in the driver app.

**Important:** the customer confirms a UPI payment by pressing "I have paid". The app cannot see your bank account, so check the UPI transaction ID against your bank or UPI statement. To verify payments automatically, use a payment gateway with a webhook (for example Razorpay UPI QR). Payouts to drivers are still paid by you in your UPI app. Automatic bank payouts need a payout service such as Razorpay X or Cashfree.

**Preview with demo data:** open the site once, then run `turso db shell cab-portal < demo-data.sql`. The last lines of that file remove the demo data again.

New drivers appear in the driver app's "Logged in as" list straight away. No redeploy is needed. The four sample drivers are added only once, so ones you delete do not come back.

## Real maps and live GPS tracking

- **Real addresses:** customers search any address, area or landmark (OpenStreetMap data via Photon), or tap "Use my current location".
- **Real fares:** distance and time come from the road network (OSRM), so fares use actual road kilometres, and the route is drawn on the map.
- **Live tracking:** the driver app reads the phone's GPS (`navigator.geolocation`) and sends it every few seconds while the driver is Online. The customer sees the cab move on a Leaflet map, with road ETA and distance to the pickup, then to the drop. Only the latest position is stored, not a history.
- **Dispatch by distance:** a new booking asks the nearest online driver first (straight-line distance from their last GPS fix to the pickup). Drivers farther than `MAX_PICKUP_KM`, or without a GPS fix in the last 5 minutes, come later or are skipped.
- **Driver navigation:** the driver app has a "Navigate in Google Maps" button for the pickup and then the drop.
- **Live map (admin):** all online drivers on one map, green for available and orange for on a trip.

Settings are optional environment variables (see `.env.example`): `MAP_CENTER`, `OSRM_URL`, `GEO_URL`, `MAX_PICKUP_KM`, `TRAFFIC_FACTOR`.

**Limits to know about**
- GPS in a web page needs HTTPS (Vercel gives you this) and the driver's permission. It only updates while the driver page is open and the screen is on. Reliable background tracking needs a native app or a PWA/Capacitor wrapper.
- The free public OSRM, Photon and OpenStreetMap tile servers are for testing and light use. For real traffic, use a paid provider (Mapbox, Google Maps, Stadia, Geoapify) or host OSRM and Photon yourself, then set `OSRM_URL` and `GEO_URL`. Change the tile URL in `public/shared.js` for another tile provider.
- OSRM gives free-flow road time. `TRAFFIC_FACTOR` is a rough allowance for traffic, not live traffic. Google or Mapbox routing gives live traffic.
- Tell your drivers that their live location is collected while they are online.

## 5. Try it

1. Open `/driver.html` on a phone, choose a driver, tick Online and allow location when the browser asks.
2. Open `/customer.html`, search a pickup and drop, and book a ride.
3. The driver sees the request, taps Accept, then "I have arrived", enters the PIN shown on the customer screen, then End trip.
4. The customer pays and sees the receipt. Trip history is under "Trip history".

To test rejections, open the driver page in several tabs, one per driver, and reject or ignore.

## Before real users

- Add login for customers and drivers (for example Clerk, Auth0 or Supabase Auth). Right now anyone can pick any driver.
- Replace the simulated payment in `api/ride.js` with Razorpay or Stripe.
- Add push notifications or WebSockets (for example Ably or Pusher) for faster updates than polling.
