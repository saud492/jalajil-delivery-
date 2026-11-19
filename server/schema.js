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
  `CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    phone TEXT,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  // إعدادات صاحب الخدمة (حد الدفع المسبق، بيانات التحويل…)
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  // صور الفواتير وإيصالات التحويل، مضغوطة من الجوال
  `CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    kind TEXT NOT NULL,              -- bill = فاتورة محل، transfer = إيصال تحويل الزبون
    mime TEXT NOT NULL,
    data TEXT NOT NULL,              -- base64
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS receipts_order ON receipts(order_id)`,
  // تقييم الزبون بعد التوصيل: تقييم واحد لكل طلب
  `CREATE TABLE IF NOT EXISTS ratings (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id),
    driver_id INTEGER,
    driver_stars INTEGER,
    tags TEXT,                       -- JSON
    comment TEXT,
    created_at INTEGER NOT NULL
  )`,
  // بلاغات الزبائن
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    driver_id INTEGER,
    kind TEXT NOT NULL,
    note TEXT,
    image_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',   -- open، resolved
    resolution TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at)`,
  // تسويات المحفظة: موجب = المندوب سلّم صاحب الخدمة، سالب = صاحب الخدمة سلّم المندوب
  `CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL REFERENCES drivers(id),
    amount REAL NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  )`,
];

// أعمدة انضافت بعد أول نسخة: تنضاف للجداول القديمة لو ناقصة
const COLUMNS = {
  orders: [
    ["driver_id", "INTEGER REFERENCES drivers(id)"],
    ["driver_status", "TEXT"],       // null = بدون مندوب، assigned، picked، delivered
    ["assigned_at", "INTEGER"],
    ["picked_at", "INTEGER"],
    ["delivered_at", "INTEGER"],
    ["track_token", "TEXT"],         // رابط متابعة الزبون
    ["delivery_code", "TEXT"],       // رمز الاستلام: عند الزبون بس، والمندوب يكتبه لما يسلّم
    ["approved_total", "REAL"],      // المبلغ اللي وافق عليه الزبون (لو تغيّر المبلغ يحتاج موافقة جديدة)
    ["approved_at", "INTEGER"],
    ["rejected_at", "INTEGER"],      // الزبون رفض المبلغ
    ["prepay_status", "TEXT"],       // null، sent = الزبون رفع إيصال، confirmed = صاحب الخدمة أكّد
    ["prepay_amount", "REAL"],       // المبلغ اللي تأكد وصوله
    ["prepay_receipt", "INTEGER"],
    ["leave_at_door", "INTEGER"],    // الزبون طلب يتركه عند الباب (يسلّم بصورة بدل الرمز)
    ["delivery_photo", "INTEGER"],
    ["driver_share", "REAL"],        // نصيب المندوب من رسوم التوصيل، ينحفظ لحظة التسليم
  ],
  parts: [
    ["bill", "REAL"],                // مبلغ فاتورة المحل
    ["bill_receipt", "INTEGER"],     // صورة الفاتورة (للمحلات غير الشريكة)
    ["shop_stars", "INTEGER"],       // تقييم الزبون للمحل الشريك
  ],
  shops: [
    ["map_url", "TEXT"],             // موقع المحل
  ],
};

let ready = false;

export async function ensureSchema(db) {
  if (ready) return;
  await db.batch(STATEMENTS.map(s => db.prepare(s)));
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
    const have = new Set(results.map(r => r.name));
    const add = cols.filter(([n]) => !have.has(n));
    if (add.length) await db.batch(add.map(([n, t]) => db.prepare(`ALTER TABLE ${table} ADD COLUMN ${n} ${t}`)));
  }
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS orders_driver ON orders(driver_id, driver_status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS orders_track ON orders(track_token)"),
  ]);
  ready = true;
}
