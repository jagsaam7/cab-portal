import { db, ensureSchema, rowsOf, send, adminOnly, clean, isUpi, csvOf, COMM, LEDGER, getSettings, balanceOf } from "./_lib.js";

// Payment settings and driver payouts (needs x-admin-key).
// GET  /api/payouts?view=settings | balances | history&driver=ID      POST {action:"settings"|"settle", …}
const SIZE = 25;
export default async function handler(req, res) {
  try {
    if (!adminOnly(req, res)) return;
    await ensureSchema();
    const run = async (sql, args = []) => rowsOf(await db.execute({ sql, args }));

    if (req.method === "POST") {
      const b = req.body || {};
      if (b.action === "settings") {
        const upi = clean(b.upi_id, 80).toLowerCase(), mode = b.pay_mode === "driver" ? "driver" : "agency";
        if (upi && !isUpi(upi)) return send(res, 400, { error: "Enter a valid UPI ID, for example name@bank" });
        await db.batch([["upi_id", upi], ["upi_name", clean(b.upi_name, 40)], ["pay_mode", mode]].map(([k, v]) => ({
          sql: "INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", args: [k, v] })), "write");
        return send(res, 200, { settings: await getSettings() });
      }
      if (b.action === "settle") {
        const id = Number(b.driver_id), amt = Math.round(Number(b.amount));
        if (!(amt >= 1 && amt <= 10000000)) return send(res, 400, { error: "Enter an amount in rupees" });
        if (!(await run("SELECT id FROM drivers WHERE id=?", [id]))[0]) return send(res, 404, { error: "Driver not found" });
        // positive = the agency paid the driver, negative = the driver paid the agency
        await db.execute({ sql: "INSERT INTO settlements (driver_id,amount,ref,note,created_at) VALUES (?,?,?,?,?)", args: [id, b.direction === "received" ? -amt : amt, clean(b.ref, 40), clean(b.note, 80), Date.now()] });
        return send(res, 200, { balance: await balanceOf(id) });
      }
      return send(res, 400, { error: "Unknown action" });
    }

    const q = req.query, view = q.view || "balances";
    if (view === "settings") return send(res, 200, { settings: await getSettings() });
    if (view === "history") return send(res, 200, { rows: await run("SELECT amount, ref, note, created_at FROM settlements WHERE driver_id=? ORDER BY created_at DESC LIMIT 50", [Number(q.driver)]) });

    const page = Math.max(1, Math.floor(Number(q.page) || 1)), exp = !!q.csv, lim = exp ? 5000 : SIZE, off = exp ? 0 : (page - 1) * SIZE;
    const term = String(q.q || "").replace(/[%_\\]/g, "").trim(), like = "%" + term + "%";
    const sorts = { balance_desc: "balance DESC, d.name", balance_asc: "balance ASC, d.name", name: "d.name" };
    const s = term ? "AND (d.name LIKE ? OR d.plate LIKE ? OR d.upi LIKE ?)" : "", sa = term ? [like, like, like] : [];
    const base = `FROM drivers d
      LEFT JOIN (SELECT r.driver_id, COUNT(*) trips, SUM(${LEDGER("r.")}) net, SUM(r.total - ${COMM("r.")}) share FROM rides r WHERE r.status='paid' GROUP BY r.driver_id) l ON l.driver_id = d.id
      LEFT JOIN (SELECT driver_id, SUM(amount) settled FROM settlements GROUP BY driver_id) s ON s.driver_id = d.id
      WHERE d.deleted = 0 ${s}`;
    const rows = await run(`SELECT d.id, d.name, d.plate, d.upi, COALESCE(l.trips,0) trips, COALESCE(l.share,0) driver_share, COALESCE(l.net,0) - COALESCE(s.settled,0) balance ${base} ORDER BY ${sorts[q.sort] || sorts.balance_desc} LIMIT ? OFFSET ?`, [...sa, lim, off]);
    if (exp) return send(res, 200, { csv: csvOf(rows) });
    const total = (await run(`SELECT COUNT(*) c ${base}`, sa))[0].c;
    const sum = (await run(`SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b END),0) due, COALESCE(SUM(CASE WHEN b < 0 THEN -b END),0) owed FROM (SELECT COALESCE(l.net,0) - COALESCE(s.settled,0) b ${base})`, sa))[0];
    return send(res, 200, { total, page, size: SIZE, rows, sum });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Server error. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN." });
  }
}
