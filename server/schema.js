// الجداول تنشأ تلقائياً أول مرة، فما يحتاج أحد يشغّل SQL بيده
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    trial_end TEXT,
    is_open INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_key TEXT NOT NULL UNIQUE,
    order_no TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    dest TEXT, customer_name TEXT, customer_phone TEXT, map_url TEXT,
    place TEXT, pay TEXT, note TEXT, fee REAL, promo TEXT, pack TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    shop_id INTEGER REFERENCES shops(id),
    shop_name TEXT,
    category TEXT,
    items TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    prep_minutes INTEGER,
    reject_reason TEXT,
    accepted_at INTEGER,
    ready_at INTEGER,
    commission REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS parts_shop ON parts(shop_id, status)`,
  `CREATE INDEX IF NOT EXISTS parts_order ON parts(order_id)`,
  `CREATE INDEX IF NOT EXISTS parts_ready ON parts(shop_id, ready_at)`,
  `CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    shop_id INTEGER,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    fails INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
  )`,
];

let ready = false;

export async function ensureSchema(db) {
  if (ready) return;
  await db.batch(STATEMENTS.map(s => db.prepare(s)));
  ready = true;
}
