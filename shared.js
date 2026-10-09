/* Shared by customer.html, driver.html and admin.html */
var $ = function (i) { return document.getElementById(i); };
var skew = 0;                                    // server clock minus browser clock
function nowS() { return Date.now() + skew; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function st(k, v) { try { if (v === undefined) return localStorage.getItem(k); v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } return null; }

/* api("ride?id=1") -> GET     api("ride", {action:"create"}) -> POST */
function api(path, body) {
  return fetch("/api/" + path, { method: body ? "POST" : "GET", headers: Object.assign(body ? { "Content-Type": "application/json" } : {}, window.AK ? { "x-admin-key": window.AK } : {}), body: body ? JSON.stringify(body) : undefined })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); if (j.now) skew = j.now - Date.now(); return j; }); });
}

/* ---- UPI QR (needs the qrcode-generator script on the page) ---- */
function upiUrl(upi, name, amount, note) { return "upi://pay?pa=" + encodeURIComponent(upi) + "&pn=" + encodeURIComponent(name || "") + (amount ? "&am=" + amount : "") + "&cu=INR&tn=" + encodeURIComponent(note || ""); }
function qrURL(text) { if (typeof qrcode === "undefined") return ""; var q = qrcode(0, "M"); q.addData(text); q.make(); return q.createDataURL(5, 2); }

/* ---- maps (Leaflet + OpenStreetMap; needs the leaflet script on the page) ---- */
var CENTER = [12.9716, 77.5946];                 // replaced by the MAP_CENTER setting from the server
api("geo?cfg=1").then(function (j) { CENTER = [j.center.lat, j.center.lng]; }).catch(function () { });
function mkMap(id) {
  var m = L.map(id).setView(CENTER, 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
  return m;
}
function ico(emoji, cls) { return L.divIcon({ html: "<span>" + emoji + "</span>", className: "ico " + (cls || ""), iconSize: [30, 30], iconAnchor: [15, 15] }); }

/* ---- address search box: placeSearch(input, list, function (place|null) {}) ---- */
function placeSearch(inp, ul, onPick) {
  var t = 0, seq = 0;
  inp.addEventListener("input", function () {
    onPick(null); clearTimeout(t); var v = inp.value.trim(); if (v.length < 3) { ul.hidden = true; return; }
    t = setTimeout(function () {
      var n = ++seq;
      api("geo?q=" + encodeURIComponent(v)).then(function (j) {
        if (n != seq) return;
        ul.innerHTML = j.places.length ? j.places.map(function (p, i) { return '<li tabindex="0" data-i="' + i + '">' + esc(p.label) + "</li>"; }).join("") : '<li class="mut">No match. Try a nearby landmark or area name.</li>';
        ul.hidden = false;
        ul.querySelectorAll("li[data-i]").forEach(function (li) {
          function go() { var p = j.places[+li.dataset.i]; inp.value = p.label; ul.hidden = true; onPick(p); }
          li.onmousedown = function (e) { e.preventDefault(); go(); }; li.onkeydown = function (e) { if (e.key == "Enter") go(); };
        });
      }).catch(function () { ul.innerHTML = '<li class="mut">Address search is unavailable. Try again.</li>'; ul.hidden = false; });
    }, 400);
  });
  inp.addEventListener("blur", function () { setTimeout(function () { ul.hidden = true; }, 150); });
}
function myLocation(ok, fail) {
  if (!navigator.geolocation) return fail("This device has no GPS.");
  navigator.geolocation.getCurrentPosition(function (p) {
    api("geo?lat=" + p.coords.latitude + "&lng=" + p.coords.longitude).then(function (j) { ok(j.place); }).catch(function (e) { fail(e.message); });
  }, function (e) { fail(e.code == 1 ? "Allow location access in your browser to use this." : "Could not get your location."); }, { enableHighAccuracy: true, timeout: 15000 });
}
