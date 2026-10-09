import { db, ensureSchema, rowsOf, clean, send, adminOnly, isUpi, balanceOf } from "./_lib.js";

// Admin API for drivers.  Header  x-admin-key: <ADMIN_KEY>
// GET /api/admin                       list drivers
// POST /api/admin {action:"add"|"update"|"online"|"delete", …}
const LIST = `SELECT d.id, d.name, d.car, d.plate, d.rating, d.online, d.upi,
  (SELECT COUNT(*) FROM rides r WHERE r.driver_id = d.id AND r.status = 'paid') trips,
  (SELECT COALESCE(SUM(total),0) FROM rides r WHERE r.driver_id = d.id AND r.status = 'paid') revenue
  FROM drivers d WHERE d.deleted = 0 ORDER BY d.id`;
const list = async () => rowsOf(await db.execute(LIST));

function fields(b) {
  const name = clean(b.name, 40), car = clean(b.car, 40), plate = clean(b.plate, 20).toUpperCase();
  let rating = parseFloat(b.rating); if (!(rating >= 1 && rating <= 5)) rating = 4.5;
  return { name, car, plate, rating: rating.toFixed(1), upi: clean(b.upi, 80).toLowerCase() };
}

export default async function handler(req, res) {
  try {
    if (!adminOnly(req, res)) return;
    await ensureSchema();
    if (req.method === "GET") return send(res, 200, { drivers: await list() });

    const b = req.body || {}, id = Number(b.id);
    const plateTaken = async (plate, except) => rowsOf(await db.execute({ sql: "SELECT id FROM drivers WHERE plate=? AND deleted=0 AND id!=?", args: [plate, except || 0] })).length > 0;

    if (b.action === "add" || b.action === "update") {
      const f = fields(b);
      if (!f.name || !f.car || !f.plate) return send(res, 400, { error: "Name, car and plate number are required" });
      if (f.upi && !isUpi(f.upi)) return send(res, 400, { error: "Enter a valid UPI ID, for example name@bank" });
      if (await plateTaken(f.plate, b.action === "update" ? id : 0)) return send(res, 409, { error: "Another driver already has this plate number" });
      if (b.action === "add") {
        await db.execute({ sql: "INSERT INTO drivers (name,car,plate,rating,upi,online,deleted) VALUES (?,?,?,?,?,1,0)", args: [f.name, f.car, f.plate, f.rating, f.upi] });
      } else {
        const u = await db.execute({ sql: "UPDATE drivers SET name=?, car=?, plate=?, rating=?, upi=? WHERE id=? AND deleted=0", args: [f.name, f.car, f.plate, f.rating, f.upi, id] });
        if (!u.rowsAffected) return send(res, 404, { error: "Driver not found" });
      }
    } else if (b.action === "online") {
      await db.execute({ sql: "UPDATE drivers SET online=? WHERE id=? AND deleted=0", args: [b.value ? 1 : 0, id] });
    } else if (b.action === "delete") {
      const busy = rowsOf(await db.execute({ sql: "SELECT id FROM rides WHERE driver_id=? AND status IN ('accepted','arrived','ontrip','ended')", args: [id] }));
      if (busy.length) return send(res, 409, { error: "This driver has a ride in progress. Try again when it is finished." });
      const bal = await balanceOf(id);
      if (bal !== 0) return send(res, 409, { error: "This driver has an unsettled balance of ₹" + Math.abs(bal) + ". Settle it in the Payouts tab first." });
      const used = rowsOf(await db.execute({ sql: "SELECT COUNT(*) c FROM rides WHERE driver_id=?", args: [id] }))[0].c;
      // With trip history the driver is hidden (so old receipts still show the name); otherwise removed completely.
      if (used) await db.execute({ sql: "UPDATE drivers SET deleted=1, online=0 WHERE id=?", args: [id] });
      else await db.execute({ sql: "DELETE FROM drivers WHERE id=?", args: [id] });
    } else return send(res, 400, { error: "Unknown action" });

    return send(res, 200, { drivers: await list() });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Server error. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN." });
  }
}
