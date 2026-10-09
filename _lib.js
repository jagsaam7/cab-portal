import { createClient } from "@libsql/client";

// Reads the Turso URL and token from environment variables.
// Falls back to a local file so `vercel dev` works before you add Turso.
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const OFFER_MS = 15000; // time a driver has to accept
// ---- map services (free public servers by default; set your own in the environment for production) ----
const env = (k, d) => process.env[k] || d;
export const OSRM_URL = env("OSRM_URL", "https://router.project-osrm.org");   // road routes and distance
export const GEO_URL = env("GEO_URL", "https://photon.komoot.io");            // address search (OpenStreetMap data)
const [cLat, cLng] = env("MAP_CENTER", "12.9716,77.5946").split(",").map(Number);
export const CENTER = { lat: Number.isFinite(cLat) ? cLat : 12.9716, lng: Number.isFinite(cLng) ? cLng : 77.5946 };
export const MAX_PICKUP_KM = Number(env("MAX_PICKUP_KM", 25)) || 25;          // drivers farther than this are not asked
const TRAFFIC = Number(env("TRAFFIC_FACTOR", 1.3)) || 1.3;                    // road time is multiplied by this
export const isLat = (v) => Number.isFinite(v) && Math.abs(v) <= 90;
export const isLng = (v) => Number.isFinite(v) && Math.abs(v) <= 180;
export function haversine(a, b) {
  const r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// Road route between two {lat,lng} points: distance, time and the line to draw. Falls back to a straight-line estimate.
export async function getRoute(a, b) {
  try {
    const url = `${OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "cab-portal" } });
    const rt = (await r.json()).routes?.[0];
    if (!rt) throw new Error("no route");
    let pts = rt.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(5), +lng.toFixed(5)]);
    const step = Math.ceil(pts.length / 300);
    if (step > 1) pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    return { km: Math.max(0.5, +(rt.distance / 1000).toFixed(1)), mins: Math.max(2, Math.round((rt.duration / 60) * TRAFFIC)), coords: pts, source: "road" };
  } catch {
    const km = Math.max(0.5, +(haversine(a, b) * 1.35).toFixed(1));
    return { km, mins: Math.max(2, Math.round(km * 3)), coords: [[a.lat, a.lng], [b.lat, b.lng]], source: "estimate" };
  }
}
export const RATES = { Mini: 12, Sedan: 16, SUV: 21 };
// Agency commission, as a percentage of the fare. Set COMMISSION_PCT in the environment to change it (default 20).
const pctEnv = Number(process.env.COMMISSION_PCT ?? 20);
export const PCT = Number.isFinite(pctEnv) ? Math.min(100, Math.max(0, pctEnv)) : 20;
export const commissionOf = (total) => Math.round(total * PCT / 100);
// SQL for a ride's commission: the value saved at payment, or the current rate for older rides.
export const COMM = (a = "") => `COALESCE(${a}commission, CAST(ROUND(${a}total * ${PCT} / 100.0) AS INTEGER))`;
export function adminOnly(req, res) {
  if (!process.env.ADMIN_KEY) { send(res, 503, { error: "ADMIN_KEY is not set in the environment variables" }); return false; }
  if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) { send(res, 401, { error: "Wrong admin key" }); return false; }
  return true;
}
export const METHODS = ["UPI", "Cash to driver"];

export function fareFor(km, type) {
  const base = 40, dist_fare = Math.round(km * RATES[type]);
  const tax = Math.round((base + dist_fare) * 0.05);
  return { base, dist_fare, tax, total: base + dist_fare + tax };
}

let ready;
export function ensureSchema() {
  return (ready ||= init().catch((e) => { ready = null; throw e; }));
}
async function init() {
  await db.batch([
    "CREATE TABLE IF NOT EXISTS drivers (id INTEGER PRIMARY KEY, name TEXT, car TEXT, plate TEXT, rating TEXT, online INTEGER DEFAULT 1, deleted INTEGER DEFAULT 0, upi TEXT, lat REAL, lng REAL, loc_at INTEGER)",
    `CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY, cid TEXT, name TEXT, from_place TEXT, to_place TEXT, km REAL, mins INTEGER, type TEXT,
      base INTEGER, dist_fare INTEGER, tax INTEGER, total INTEGER, pin TEXT,
      status TEXT, driver_id INTEGER, queue TEXT, idx INTEGER DEFAULT 0, dists TEXT, log TEXT DEFAULT '[]',
      offer_at INTEGER, accepted_at INTEGER, started_at INTEGER, ended_at INTEGER,
      method TEXT, paid_at INTEGER, created_at INTEGER, commission INTEGER, collected_by TEXT, upi_ref TEXT, from_lat REAL, from_lng REAL, to_lat REAL, to_lng REAL, route TEXT)`,
    "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
  ], "write");
  // Databases created by an older version need the deleted column.
  try { await db.execute("ALTER TABLE drivers ADD COLUMN deleted INTEGER DEFAULT 0"); } catch { /* already there */ }
  for (const sql of ["ALTER TABLE rides ADD COLUMN commission INTEGER", "ALTER TABLE drivers ADD COLUMN upi TEXT", "ALTER TABLE rides ADD COLUMN collected_by TEXT", "ALTER TABLE rides ADD COLUMN upi_ref TEXT",
    "ALTER TABLE drivers ADD COLUMN lat REAL", "ALTER TABLE drivers ADD COLUMN lng REAL", "ALTER TABLE drivers ADD COLUMN loc_at INTEGER",
    "ALTER TABLE rides ADD COLUMN from_lat REAL", "ALTER TABLE rides ADD COLUMN from_lng REAL", "ALTER TABLE rides ADD COLUMN to_lat REAL", "ALTER TABLE rides ADD COLUMN to_lng REAL", "ALTER TABLE rides ADD COLUMN route TEXT"]) {
    try { await db.execute(sql); } catch { /* column already there */ }
  }
  await db.batch([
    "CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_rides_created ON rides (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_rides_cid ON rides (cid)",
    "CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER, amount INTEGER, ref TEXT, note TEXT, created_at INTEGER)",
    "CREATE INDEX IF NOT EXISTS idx_settle_driver ON settlements (driver_id)",
  ], "write");
  // Sample drivers are added only once, so drivers you delete never come back.
  const seeded = rowsOf(await db.execute("SELECT v FROM meta WHERE k='seeded'"))[0];
  if (!seeded) {
    const n = rowsOf(await db.execute("SELECT COUNT(*) c FROM drivers"))[0].c;
    const ins = "INSERT OR IGNORE INTO drivers (id,name,car,plate,rating,online) VALUES ";
    await db.batch([
      ...(n ? [] : [
        ins + "(1,'Ramesh K','Maruti Swift','KA 01 AB 4521','4.8',1)",
        ins + "(2,'Suresh G','Hyundai Aura','KA 03 CD 9087','4.6',1)",
        ins + "(3,'Imran S','Toyota Etios','KA 05 EF 1234','4.9',1)",
        ins + "(4,'Prakash N','Tata Tiago','KA 02 GH 7766','4.7',1)",
      ]),
      "INSERT OR IGNORE INTO meta (k,v) VALUES ('seeded','1')",
    ], "write");
  }
}

export const rowsOf = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c) => [c, r[c]])));

function shape(r) {
  const j = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
  return { ...r, queue: j(r.queue, []), dists: j(r.dists, {}), log: j(r.log, []), route: j(r.route, null) };
}
const RIDE_SQL = "SELECT r.*, d.name dname, d.car dcar, d.plate dplate, d.rating drating, d.lat dlat, d.lng dlng, d.loc_at dloc FROM rides r LEFT JOIN drivers d ON d.id = r.driver_id";
export async function getRide(id) {
  const rows = rowsOf(await db.execute({ sql: RIDE_SQL + " WHERE r.id = ?", args: [id] }));
  return rows[0] ? shape(rows[0]) : null;
}
export async function listPaid(cid) {
  return rowsOf(await db.execute({ sql: RIDE_SQL + " WHERE r.cid = ? AND r.status = 'paid' ORDER BY r.created_at DESC LIMIT 20", args: [cid] })).map(shape);
}

// Moves a searching ride to the next driver when the current one times out,
// goes offline, or when nobody is left. Safe to call on every poll.
export async function advance(r) {
  if (!r || r.status !== "searching") return r;
  const now = Date.now(), cur = r.queue[r.idx];
  let online = 0, name = "";
  if (cur !== undefined) {
    const d = rowsOf(await db.execute({ sql: "SELECT name, online FROM drivers WHERE id = ?", args: [cur] }))[0];
    online = d?.online ?? 0; name = d?.name ?? "Driver";
    if (online && now - r.offer_at <= OFFER_MS) return r;
  }
  const log = [...r.log];
  if (cur !== undefined) log.push(name + (online ? " did not respond" : " went offline"));
  const idx = r.idx + 1, done = idx >= r.queue.length;
  await db.execute({
    sql: "UPDATE rides SET idx = ?, log = ?, offer_at = ?, status = ? WHERE id = ? AND status = 'searching' AND idx = ?",
    args: [idx, JSON.stringify(log), now, done ? "norides" : "searching", r.id, r.idx],
  });
  return getRide(r.id);
}

// Drivers who are online, nearest to the pickup first. Drivers without a recent GPS fix go last.
export async function dispatchQueue(pickup) {
  const now = Date.now(), dists = {}, ids = [];
  for (const d of rowsOf(await db.execute("SELECT id, lat, lng, loc_at FROM drivers WHERE online = 1 AND deleted = 0"))) {
    const fresh = d.lat != null && d.loc_at && now - d.loc_at < 5 * 60000;
    const km = fresh ? +haversine(pickup, { lat: d.lat, lng: d.lng }).toFixed(1) : null;
    if (km !== null && km > MAX_PICKUP_KM) continue;
    dists[d.id] = km; ids.push(d.id);
  }
  ids.sort((x, y) => (dists[x] ?? 1e9) - (dists[y] ?? 1e9));
  return { queue: ids, dists };
}

export const clean = (s, n) => String(s ?? "").replace(/[<>&"'`]/g, "").trim().slice(0, n);
export const send = (res, code, body) => res.status(code).json({ now: Date.now(), ...body });

export const isUpi = (v) => /^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,31}$/i.test(String(v || ""));

export function csvOf(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

// Ledger per paid ride, from the agency's point of view:
//   money collected by the agency  -> agency owes the driver (fare - commission)
//   money collected by the driver (cash, or the driver's own UPI) -> driver owes the agency the commission (negative)
export const LEDGER = (a = "") => `CASE WHEN COALESCE(${a}collected_by, CASE WHEN ${a}method = 'Cash to driver' THEN 'driver' ELSE 'agency' END) = 'driver' THEN -(${COMM(a)}) ELSE ${a}total - ${COMM(a)} END`;

// Positive = agency owes the driver. Negative = the driver owes the agency.
export async function balanceOf(did) {
  const n = rowsOf(await db.execute({ sql: `SELECT COALESCE(SUM(${LEDGER("r.")}),0) v FROM rides r WHERE r.driver_id=? AND r.status='paid'`, args: [did] }))[0].v;
  const s = rowsOf(await db.execute({ sql: "SELECT COALESCE(SUM(amount),0) v FROM settlements WHERE driver_id=?", args: [did] }))[0].v;
  return n - s;
}

export async function getSettings() {
  const m = Object.fromEntries(rowsOf(await db.execute("SELECT k, v FROM meta WHERE k IN ('upi_id','upi_name','pay_mode')")).map((r) => [r.k, r.v]));
  return { upi_id: m.upi_id || "", upi_name: m.upi_name || "", pay_mode: m.pay_mode === "driver" ? "driver" : "agency" };
}

// Who the customer pays by UPI for this ride.
export async function payTarget(ride) {
  const s = await getSettings();
  if (s.pay_mode === "driver") {
    const d = rowsOf(await db.execute({ sql: "SELECT upi FROM drivers WHERE id=?", args: [ride.driver_id] }))[0];
    return { mode: "driver", upi: d?.upi || "", name: ride.dname || "Driver" };
  }
  return { mode: "agency", upi: s.upi_id, name: s.upi_name || "Cab agency" };
}
