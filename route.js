import { send, getRoute, fareFor, RATES, isLat, isLng } from "./_lib.js";

// Road distance, time, line and fares.  GET /api/route?from=lat,lng&to=lat,lng
export default async function handler(req, res) {
  try {
    const p = (v) => { const [lat, lng] = String(v || "").split(",").map(Number); return isLat(lat) && isLng(lng) ? { lat, lng } : null; };
    const a = p(req.query.from), b = p(req.query.to);
    if (!a || !b) return send(res, 400, { error: "from and to must be lat,lng" });
    const r = await getRoute(a, b);
    return send(res, 200, { ...r, fares: Object.fromEntries(Object.keys(RATES).map((t) => [t, fareFor(r.km, t).total])) });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Could not find a route" });
  }
}
