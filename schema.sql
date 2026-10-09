-- Optional: the API creates these automatically on first request.
-- Run manually with:  turso db shell cab-portal < schema.sql
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY, name TEXT, car TEXT, plate TEXT, rating TEXT, online INTEGER DEFAULT 1, deleted INTEGER DEFAULT 0, upi TEXT, lat REAL, lng REAL, loc_at INTEGER
);
CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY, cid TEXT, name TEXT, from_place TEXT, to_place TEXT, km REAL, mins INTEGER, type TEXT,
  base INTEGER, dist_fare INTEGER, tax INTEGER, total INTEGER, pin TEXT,
  status TEXT, driver_id INTEGER, queue TEXT, idx INTEGER DEFAULT 0, dists TEXT, log TEXT DEFAULT '[]',
  offer_at INTEGER, accepted_at INTEGER, started_at INTEGER, ended_at INTEGER,
  method TEXT, paid_at INTEGER, created_at INTEGER, commission INTEGER, collected_by TEXT, upi_ref TEXT, from_lat REAL, from_lng REAL, to_lat REAL, to_lng REAL, route TEXT
);
INSERT OR IGNORE INTO drivers (id,name,car,plate,rating,online) VALUES (1,'Ramesh K','Maruti Swift','KA 01 AB 4521','4.8',1);
INSERT OR IGNORE INTO drivers (id,name,car,plate,rating,online) VALUES (2,'Suresh G','Hyundai Aura','KA 03 CD 9087','4.6',1);
INSERT OR IGNORE INTO drivers (id,name,car,plate,rating,online) VALUES (3,'Imran S','Toyota Etios','KA 05 EF 1234','4.9',1);
INSERT OR IGNORE INTO drivers (id,name,car,plate,rating,online) VALUES (4,'Prakash N','Tata Tiago','KA 02 GH 7766','4.7',1);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id, status);
CREATE INDEX IF NOT EXISTS idx_rides_created ON rides (created_at);
CREATE INDEX IF NOT EXISTS idx_rides_cid ON rides (cid);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id INTEGER, amount INTEGER, ref TEXT, note TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_settle_driver ON settlements (driver_id);
