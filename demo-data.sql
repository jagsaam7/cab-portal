-- OPTIONAL demo data: 100 drivers, 60 customers and about 800 trips over the last 30 days,
-- so you can see the dashboard with realistic numbers.
-- Open the site once first (so the tables exist), then run:
--   turso db shell cab-portal < demo-data.sql
-- Remove it again with the two DELETE lines at the bottom.

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
INSERT INTO drivers (name, car, plate, rating, online, deleted)
SELECT 'Demo Driver ' || i,
       CASE i % 4 WHEN 0 THEN 'Maruti Swift' WHEN 1 THEN 'Hyundai Aura' WHEN 2 THEN 'Toyota Etios' ELSE 'Tata Tiago' END,
       'DEMO ' || printf('%03d', i), printf('%.1f', 4 + (i % 10) / 10.0), CASE WHEN i % 3 > 0 THEN 1 ELSE 0 END, 0
FROM n;

WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 800),
r AS (SELECT i, (i * 7) % 250 + 60 AS df, (strftime('%s','now') - ((i * 7919) % (30 * 86400))) * 1000 AS ts FROM n)
INSERT INTO rides (id, cid, name, from_place, to_place, km, mins, type, base, dist_fare, tax, total, pin, status, driver_id,
                   queue, idx, dists, log, offer_at, accepted_at, started_at, ended_at, method, paid_at, created_at, commission)
SELECT 'DM' || printf('%06d', i), 'demo-c' || (i % 60), 'Demo Customer ' || (i % 60),
       CASE i % 4 WHEN 0 THEN 'Indiranagar' WHEN 1 THEN 'Koramangala' WHEN 2 THEN 'MG Road' ELSE 'Jayanagar' END,
       CASE i % 3 WHEN 0 THEN 'Whitefield' WHEN 1 THEN 'HSR Layout' ELSE 'Hebbal' END,
       df / 12.0, 10 + df / 12, CASE i % 3 WHEN 0 THEN 'Mini' WHEN 1 THEN 'Sedan' ELSE 'SUV' END,
       40, df, CAST(ROUND((40 + df) * 0.05) AS INTEGER), 40 + df + CAST(ROUND((40 + df) * 0.05) AS INTEGER), '0000',
       CASE WHEN i % 10 = 0 THEN 'cancelled' ELSE 'paid' END,
       CASE WHEN i % 10 = 0 THEN NULL ELSE (SELECT id FROM drivers WHERE plate = 'DEMO ' || printf('%03d', 1 + (i * 7) % 100)) END,
       '[]', 0, '{}', '[]', ts, ts + 20000, ts + 60000, ts + 900000,
       CASE WHEN i % 10 = 0 THEN NULL ELSE CASE i % 4 WHEN 0 THEN 'UPI' WHEN 1 THEN 'Cash to driver' WHEN 2 THEN 'Debit / Credit card' ELSE 'Wallet' END END,
       CASE WHEN i % 10 = 0 THEN NULL ELSE ts + 1000000 END, ts,
       CASE WHEN i % 10 = 0 THEN NULL ELSE CAST(ROUND((40 + df + CAST(ROUND((40 + df) * 0.05) AS INTEGER)) * 0.2) AS INTEGER) END
FROM r;

-- To remove the demo data:
-- DELETE FROM rides WHERE id LIKE 'DM%';
-- DELETE FROM drivers WHERE plate LIKE 'DEMO %';
