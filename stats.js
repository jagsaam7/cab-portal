import { db, ensureSchema, rowsOf, send, adminOnly, csvOf, COMM, PCT } from "./_lib.js";

// Dashboard API (needs x-admin-key).  GET /api/stats?view=overview|drivers|trips|customers
// Common params: from, to (ms), tz (minutes from UTC), q (search), page, csv=1 (export up to 5000 rows)
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const SIZE = 25;

export default async function handler(req, res) {
  try {
    if (!adminOnly(req, res)) return;
    await ensureSchema();
    const q = req.query, view = q.view || "overview";
    const from = num(q.from, 0), to = num(q.to, 9e15), tz = num(q.tz, 0);
    const page = Math.max(1, Math.floor(num(q.page, 1))), exp = !!q.csv;
    const lim = exp ? 5000 : SIZE, off = exp ? 0 : (page - 1) * SIZE;
    const term = String(q.q || "").replace(/[%_\\]/g, "").trim(), like = "%" + term + "%";
    const run = async (sql, args = []) => rowsOf(await db.execute({ sql, args }));
    const done = async (rows, total) => exp ? send(res, 200, { csv: csvOf(rows) }) : send(res, 200, { total, page, size: SIZE, rows });

    if (view === "overview") {
      const w = "r.status='paid' AND r.created_at BETWEEN ? AND ?", a = [from, to];
      const [k] = await run(`SELECT COUNT(*) trips, COALESCE(SUM(r.total),0) revenue, COALESCE(SUM(${COMM("r.")}),0) commission, COUNT(DISTINCT r.cid) customers FROM rides r WHERE ${w}`, a);
      const [u] = await run("SELECT COUNT(*) c FROM rides WHERE status IN ('cancelled','norides') AND created_at BETWEEN ? AND ?", a);
      const [act] = await run("SELECT COUNT(*) c FROM rides WHERE status IN ('accepted','arrived','ontrip','ended')");
      const [dr] = await run("SELECT COUNT(*) total, COALESCE(SUM(online),0) online FROM drivers WHERE deleted=0");
      const daily = await run(`SELECT date(r.created_at/1000 + ?*60, 'unixepoch') d, COUNT(*) trips, SUM(r.total) revenue, SUM(${COMM("r.")}) commission FROM rides r WHERE ${w} GROUP BY d ORDER BY d`, [tz, ...a]);
      const top = await run(`SELECT d.id, d.name, COUNT(r.id) trips, SUM(r.total) revenue FROM rides r JOIN drivers d ON d.id=r.driver_id WHERE ${w} GROUP BY d.id ORDER BY revenue DESC LIMIT 5`, a);
      const methods = await run(`SELECT COALESCE(r.method,'Unknown') method, COUNT(*) trips, SUM(r.total) revenue FROM rides r WHERE ${w} GROUP BY r.method ORDER BY revenue DESC`, a);
      return send(res, 200, { pct: PCT, kpi: { ...k, payouts: k.revenue - k.commission, avg: k.trips ? Math.round(k.revenue / k.trips) : 0, unserved: u.c, active: act.c, drivers: dr.total, online: dr.online }, daily, top, methods });
    }

    if (view === "live") {
      const rows = await run(`SELECT d.id, d.name, d.plate, d.lat, d.lng, d.loc_at,
        (SELECT COUNT(*) FROM rides r WHERE r.driver_id = d.id AND r.status IN ('accepted','arrived','ontrip')) busy
        FROM drivers d WHERE d.deleted = 0 AND d.online = 1 AND d.lat IS NOT NULL AND d.loc_at > ? LIMIT 1000`, [Date.now() - 5 * 60000]);
      const [o] = await run("SELECT COUNT(*) c FROM drivers WHERE deleted = 0 AND online = 1");
      return send(res, 200, { rows, online: o.c });
    }

    if (view === "drivers") {
      const sorts = { revenue: "revenue DESC", trips: "trips DESC", commission: "commission DESC", name: "d.name ASC", last_trip: "last_trip DESC" };
      const s = term ? "AND (d.name LIKE ? OR d.plate LIKE ? OR d.car LIKE ?)" : "", sa = term ? [like, like, like] : [];
      const rows = await run(`SELECT d.id, d.name, d.car, d.plate, d.rating, d.online, COUNT(r.id) trips, COALESCE(SUM(r.total),0) revenue, COALESCE(SUM(${COMM("r.")}),0) commission, MAX(r.created_at) last_trip
        FROM drivers d LEFT JOIN rides r ON r.driver_id=d.id AND r.status='paid' AND r.created_at BETWEEN ? AND ?
        WHERE d.deleted=0 ${s} GROUP BY d.id ORDER BY ${sorts[q.sort] || sorts.revenue}, d.name LIMIT ? OFFSET ?`, [from, to, ...sa, lim, off]);
      rows.forEach((r) => { r.earn = r.revenue - r.commission; });
      const [t] = await run(`SELECT COUNT(*) c FROM drivers d WHERE d.deleted=0 ${s}`, sa);
      return done(rows, t.c);
    }

    if (view === "trips") {
      const st = { paid: "r.status='paid'", cancelled: "r.status IN ('cancelled','norides')", active: "r.status IN ('searching','accepted','arrived','ontrip','ended')" };
      const w = ["r.created_at BETWEEN ? AND ?"], a = [from, to];
      if (st[q.status]) w.push(st[q.status]);
      if (q.driver) { w.push("r.driver_id = ?"); a.push(num(q.driver, 0)); }
      if (q.cid) { w.push("r.cid = ?"); a.push(String(q.cid).slice(0, 40)); }
      if (term) { w.push("(r.name LIKE ? OR r.id LIKE ? OR d.name LIKE ?)"); a.push(like, like, like); }
      const from_ = "FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE " + w.join(" AND ");
      const rows = await run(`SELECT r.id, r.created_at, r.name customer, r.cid, d.id driver_id, d.name driver, r.from_place, r.to_place, r.km, r.type, r.total, CASE WHEN r.status='paid' THEN ${COMM("r.")} END commission, r.status, r.method, r.upi_ref ${from_} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [...a, lim, off]);
      const [t] = await run(`SELECT COUNT(*) c ${from_}`, a);
      return done(rows, t.c);
    }

    if (view === "customers") {
      const sorts = { spent: "spent DESC", trips: "trips DESC", last_trip: "last_trip DESC" };
      const w = "r.status='paid' AND r.created_at BETWEEN ? AND ?" + (term ? " AND r.name LIKE ?" : ""), a = [from, to, ...(term ? [like] : [])];
      const rows = await run(`SELECT r.cid, (SELECT x.name FROM rides x WHERE x.cid=r.cid ORDER BY x.created_at DESC LIMIT 1) name, COUNT(*) trips, SUM(r.total) spent, MAX(r.created_at) last_trip, COUNT(DISTINCT r.driver_id) drivers, group_concat(DISTINCT d.name) driver_names
        FROM rides r LEFT JOIN drivers d ON d.id=r.driver_id WHERE ${w} GROUP BY r.cid ORDER BY ${sorts[q.sort] || sorts.spent} LIMIT ? OFFSET ?`, [...a, lim, off]);
      const [t] = await run(`SELECT COUNT(DISTINCT r.cid) c FROM rides r WHERE ${w}`, a);
      return done(rows, t.c);
    }
    return send(res, 400, { error: "Unknown view" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Server error. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN." });
  }
}
