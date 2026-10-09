import { db, ensureSchema, getRide, advance, rowsOf, clean, send, commissionOf, COMM, balanceOf, isLat, isLng } from "./_lib.js";

// Driver API.  GET /api/driver?list=1   GET /api/driver?id=1   POST /api/driver {id,action,…}
// Note: the customer's PIN and customer id are never sent to the driver.
const pub = (r, did, withRoute) => r && {
  id: r.id, first: String(r.name).split(" ")[0], from_place: r.from_place, to_place: r.to_place,
  km: r.km, mins: r.mins, total: r.total, earn: r.total - (r.commission ?? commissionOf(r.total)), status: r.status,
  offer_at: r.offer_at, accepted_at: r.accepted_at, started_at: r.started_at, paid_at: r.paid_at,
  method: r.method, dist: r.dists?.[did],
  from_lat: r.from_lat, from_lng: r.from_lng, to_lat: r.to_lat, to_lng: r.to_lng, ...(withRoute ? { route: r.route } : {}),
};

async function state(did, withRoute) {
  const drv = rowsOf(await db.execute({ sql: "SELECT * FROM drivers WHERE id=?", args: [did] }))[0];
  let offer = null;
  for (const { id } of rowsOf(await db.execute("SELECT id FROM rides WHERE status='searching'"))) {
    const r = await advance(await getRide(id));
    if (r.status === "searching" && r.queue[r.idx] === did && drv.online) offer = r;
  }
  const a = rowsOf(await db.execute({
    sql: "SELECT id FROM rides WHERE driver_id=? AND (status IN ('accepted','arrived','ontrip','ended') OR (status='paid' AND paid_at>?)) ORDER BY created_at DESC LIMIT 1",
    args: [did, Date.now() - 30000],
  }))[0];
  const e = rowsOf(await db.execute({ sql: `SELECT COUNT(*) c, COALESCE(SUM(total - ${COMM()}),0) t FROM rides WHERE driver_id=? AND status='paid'`, args: [did] }))[0];
  return { driver: drv, offer: pub(offer, did), active: pub(a && await getRide(a.id), did, withRoute), earnings: { count: e.c, total: e.t, balance: await balanceOf(did) } };
}

export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (req.method === "GET" && req.query.list) return send(res, 200, { drivers: rowsOf(await db.execute("SELECT id,name,car FROM drivers WHERE deleted=0 ORDER BY id")) });

    const b = req.method === "POST" ? req.body || {} : req.query;
    const did = Number(b.id), now = Date.now();
    const drv = rowsOf(await db.execute({ sql: "SELECT * FROM drivers WHERE id=?", args: [did] }))[0];
    if (!drv || drv.deleted) return send(res, 404, { error: "Driver not found" });

    if (req.method === "POST") {
      const r = b.rideId ? await getRide(clean(b.rideId, 20)) : null;
      const mine = r && r.status === "searching" && r.queue[r.idx] === did;
      if (b.action === "loc") {
        // Live GPS from the driver's phone. Only the latest position is kept.
        const lat = Number(b.lat), lng = Number(b.lng);
        if (!isLat(lat) || !isLng(lng)) return send(res, 400, { error: "Bad location" });
        await db.execute({ sql: "UPDATE drivers SET lat=?, lng=?, loc_at=? WHERE id=?", args: [lat, lng, now, did] });
        return send(res, 200, { ok: true });
      }
      if (b.action === "online") {
        await db.execute({ sql: "UPDATE drivers SET online=? WHERE id=?", args: [b.value ? 1 : 0, did] });
      } else if (b.action === "accept") {
        if (!mine) return send(res, 409, { error: "This request is no longer available" });
        const log = JSON.stringify([...r.log, drv.name + " accepted your booking"]);
        const u = await db.execute({ sql: "UPDATE rides SET status='accepted', driver_id=?, accepted_at=?, log=? WHERE id=? AND status='searching' AND idx=?", args: [did, now, log, r.id, r.idx] });
        if (!u.rowsAffected) return send(res, 409, { error: "This request is no longer available" });
      } else if (b.action === "reject") {
        if (!mine) return send(res, 409, { error: "This request is no longer available" });
        const idx = r.idx + 1;
        await db.execute({ sql: "UPDATE rides SET idx=?, log=?, offer_at=?, status=? WHERE id=? AND status='searching' AND idx=?",
          args: [idx, JSON.stringify([...r.log, drv.name + " rejected the request"]), now, idx >= r.queue.length ? "norides" : "searching", r.id, r.idx] });
      } else if (b.action === "arrived") {
        await db.execute({ sql: "UPDATE rides SET status='arrived' WHERE driver_id=? AND status='accepted'", args: [did] });
      } else if (b.action === "start") {
        const a = rowsOf(await db.execute({ sql: "SELECT id, pin FROM rides WHERE driver_id=? AND status='arrived'", args: [did] }))[0];
        if (!a) return send(res, 409, { error: "No ride is waiting to start" });
        if (String(b.pin) !== a.pin) return send(res, 400, { error: "Wrong PIN. Ask the customer to check the PIN." });
        await db.execute({ sql: "UPDATE rides SET status='ontrip', started_at=? WHERE id=?", args: [now, a.id] });
      } else if (b.action === "end") {
        await db.execute({ sql: "UPDATE rides SET status='ended', ended_at=? WHERE driver_id=? AND status='ontrip'", args: [now, did] });
      } else return send(res, 400, { error: "Unknown action" });
    }
    return send(res, 200, await state(did, !!b.route));
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Server error. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN." });
  }
}
