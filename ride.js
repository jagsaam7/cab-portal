import { db, ensureSchema, getRide, listPaid, advance, dispatchQueue, fareFor, getRoute, haversine, isLat, isLng, commissionOf, clean, send, getSettings, payTarget, RATES, METHODS } from "./_lib.js";

// Customer API.  GET /api/ride?id=…   GET /api/ride?list=1&cid=…   POST /api/ride {action,…}
// Route lines are big, so they are only sent when asked for (?route=1) or on create.
const out = (r, keep) => { if (r && !keep) delete r.route; return r; };

export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === "GET") {
      if (req.query.list) return send(res, 200, { rides: await listPaid(clean(req.query.cid, 40)) });
      const ride = await advance(await getRide(clean(req.query.id, 20)));
      if (ride && ride.status === "ended") ride.payto = await payTarget(ride);
      return ride ? send(res, 200, { ride: out(ride, req.query.route) }) : send(res, 404, { error: "Ride not found" });
    }

    const b = req.body || {};
    const now = Date.now();

    if (b.action === "create") {
      const name = clean(b.name, 40), cid = clean(b.cid, 40);
      const pt = (o) => { const lat = Number(o?.lat), lng = Number(o?.lng); return isLat(lat) && isLng(lng) ? { lat, lng, label: clean(o.label, 90) } : null; };
      const A = pt(b.from), B = pt(b.to);
      if (!name || !cid) return send(res, 400, { error: "Name is required" });
      if (!A || !B || !A.label || !B.label) return send(res, 400, { error: "Choose pickup and drop from the suggestions" });
      if (!RATES[b.type]) return send(res, 400, { error: "Choose a cab type" });
      const crow = haversine(A, B);
      if (crow < 0.2) return send(res, 400, { error: "Pickup and drop are too close" });
      if (crow > 300) return send(res, 400, { error: "This trip is too long to book online" });
      const rt = await getRoute(A, B), f = fareFor(rt.km, b.type);
      const { queue, dists } = await dispatchQueue(A);
      const id = "CB" + Math.floor(100000 + Math.random() * 899999);
      const pin = String(Math.floor(1000 + Math.random() * 8999));
      await db.execute({
        sql: `INSERT INTO rides (id,cid,name,from_place,to_place,km,mins,type,base,dist_fare,tax,total,pin,status,queue,idx,dists,log,offer_at,created_at,from_lat,from_lng,to_lat,to_lng,route)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'[]',?,?,?,?,?,?,?)`,
        args: [id, cid, name, A.label, B.label, rt.km, rt.mins, b.type, f.base, f.dist_fare, f.tax, f.total, pin,
          queue.length ? "searching" : "norides", JSON.stringify(queue), JSON.stringify(dists), now, now, A.lat, A.lng, B.lat, B.lng, JSON.stringify(rt.coords)],
      });
      return send(res, 200, { ride: out(await getRide(id), true) });
    }

    const ride = await getRide(clean(b.id, 20));
    if (!ride || ride.cid !== clean(b.cid, 40)) return send(res, 404, { error: "Ride not found" });

    if (b.action === "cancel") {
      await db.execute({ sql: "UPDATE rides SET status='cancelled' WHERE id=? AND status IN ('searching','norides','accepted','arrived')", args: [ride.id] });
    } else if (b.action === "retry" && ride.status === "norides") {
      const { queue, dists } = await dispatchQueue({ lat: ride.from_lat, lng: ride.from_lng });
      await db.execute({
        sql: "UPDATE rides SET status=?, queue=?, dists=?, idx=0, log='[]', offer_at=? WHERE id=? AND status='norides'",
        args: [queue.length ? "searching" : "norides", JSON.stringify(queue), JSON.stringify(dists), now, ride.id],
      });
    } else if (b.action === "pay") {
      if (!METHODS.includes(b.method)) return send(res, 400, { error: "Choose a payment method" });
      const target = await payTarget(ride), settings = await getSettings();
      if (b.method === "UPI" && !target.upi) return send(res, 400, { error: "UPI is not set up for this trip. Please choose cash." });
      // Collected by the driver (cash, or the driver's own UPI) or by the agency: used for driver payouts.
      const by = b.method === "Cash to driver" || settings.pay_mode === "driver" ? "driver" : "agency";
      // UPI payments are confirmed by the customer. Reconcile with your bank or UPI statement, or use a payment gateway to verify automatically.
      await db.execute({ sql: "UPDATE rides SET status='paid', method=?, paid_at=?, commission=?, collected_by=?, upi_ref=? WHERE id=? AND status='ended'", args: [b.method, now, commissionOf(ride.total), by, clean(b.ref, 40), ride.id] });
    } else return send(res, 400, { error: "Unknown action" });

    return send(res, 200, { ride: out(await getRide(ride.id)) });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Server error. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN." });
  }
}
