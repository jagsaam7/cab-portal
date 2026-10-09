import { ensureSchema, send, clean, GEO_URL, CENTER, isLat, isLng } from "./_lib.js";

// Address search and "use my location".  GET /api/geo?q=text   GET /api/geo?lat=..&lng=..   GET /api/geo?cfg=1
// Uses Photon (OpenStreetMap data). Set GEO_URL to switch to your own server.
const label = (p) => [...new Set([p.name || p.street, p.name && p.street ? p.street : null, p.district || p.locality, p.city || p.county, p.postcode].filter(Boolean))].join(", ");
const pick = (f) => ({ label: label(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "cab-portal" } })).json();

export default async function handler(req, res) {
  try {
    const q = req.query;
    if (q.cfg) return send(res, 200, { center: CENTER });
    if (q.q) {
      const t = clean(q.q, 80);
      if (t.length < 3) return send(res, 200, { places: [] });
      const j = await get(`${GEO_URL}/api/?q=${encodeURIComponent(t)}&limit=6&lang=en&lat=${CENTER.lat}&lon=${CENTER.lng}`);
      return send(res, 200, { places: (j.features || []).map(pick).filter((x) => x.label) });
    }
    const lat = Number(q.lat), lng = Number(q.lng);
    if (isLat(lat) && isLng(lng)) {
      const j = await get(`${GEO_URL}/reverse?lat=${lat}&lon=${lng}&lang=en`);
      const f = j.features?.[0];
      return send(res, 200, { place: { label: (f && label(f.properties)) || `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng } });
    }
    return send(res, 400, { error: "Missing search text" });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: "Address search is not available right now. Try again in a moment." });
  }
}
