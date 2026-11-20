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
  // أجهزة مشتركة في الإشعارات: shop/driver = رقم المحل أو المندوب، track = رقم الطلب، admin = بدون
  `CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id INTEGER,
    fails INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS push_subs_kind ON push_subs(kind, ref_id)`,
  // أكواد الخصم: تنضاف وتنوقف من اللوحة، والسيرفر يتحقق منها (مو صفحة الزبون)
  `CREATE TABLE IF NOT EXISTS promos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    discount REAL NOT NULL,          -- 0.5 = نص رسوم التوصيل
    date_from TEXT,                  -- YYYY-MM-DD بتوقيت الرياض، فاضي = من الحين
    date_to TEXT,                    -- فاضي = بدون نهاية
    per_phone INTEGER NOT NULL DEFAULT 1,
    max_uses INTEGER,                -- فاضي = بدون حد
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`,
  // ملاحظات صاحب الخدمة على الزبون، والحظر (رقم يسوي طلبات وهمية)
  `CREATE TABLE IF NOT EXISTS customers (
    phone_key TEXT PRIMARY KEY,
    blocked INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    note TEXT,
    updated_at INTEGER
  )`,
  // طلبات انضمام المحلات من صفحة «انضم كشريك»
  `CREATE TABLE IF NOT EXISTS shop_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, category TEXT, owner TEXT, phone TEXT, map_url TEXT, note TEXT,
    status TEXT NOT NULL DEFAULT 'new',   -- new، done، rejected
    created_at INTEGER NOT NULL
  )`,
  // الكود اللي كان مكتوب في صفحة الزبون ينتقل هنا أول مرة
  `INSERT OR IGNORE INTO promos (code, discount, date_from, date_to, per_phone, created_at) VALUES ('JALAJIL', 0.5, '2026-11-20', '2026-11-20', 1, 0)`,
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
    ["fee_full", "REAL"],
    ["auto_approve", "REAL"],
    ["billed_at", "INTEGER"],        // متى اكتملت الفاتورة (لحساب وقت انتظار موافقة الزبون)
    ["blocked", "INTEGER"],          // طلب من رقم محظور: ما يطلع للمحلات ولا للمناديب
    ["ref_shop", "INTEGER"],         // الزبون جا من ملصق QR حق هالمحل        // الزبون يوافق مسبقاً على أي فاتورة لين هالمبلغ
    ["phone_key", "TEXT"],           // جوال الزبون بصيغة موحدة (لحساب استخدام أكواد الخصم)
    ["nudge_driver_at", "INTEGER"],  // الحارس نبّه إن الطلب بدون مندوب
    ["nudge_approve_at", "INTEGER"], // الحارس نبّه إن الزبون ما وافق            // رسوم التوصيل قبل كود الخصم: نصيب المندوب ينحسب منها، والخصم على صاحب الخدمة
  ],
  parts: [
    ["bill", "REAL"],                // مبلغ فاتورة المحل
    ["bill_receipt", "INTEGER"],     // صورة الفاتورة (للمحلات غير الشريكة)
    ["shop_stars", "INTEGER"],
    ["nudged_at", "INTEGER"],        // الحارس نبّه إن المحل ما رد
    ["shop_note", "TEXT"],
    ["offer_min", "REAL"],           // عرض المحل وقت الطلب: توصيل مجاني لو فاتورته فوق هالمبلغ
    ["offer_charge", "REAL"],        // رسوم التوصيل اللي تحمّلها المحل بسبب عرضه (تنحسب عليه مع العمولة)           // المحل كتبها وقت القبول: «خلص كذا، والبديل كذا»       // تقييم الزبون للمحل الشريك
  ],
  shops: [
    ["map_url", "TEXT"],             // موقع المحل
    ["closed_until", "INTEGER"],
    ["offer_min", "REAL"],           // عرض المحل: توصيل مجاني فوق هالمبلغ، على حساب المحل
    ["offer_text", "TEXT"],
    ["featured", "INTEGER"],         // محل مميز: يطلع أول في صفحة الطلب (تسويق مجاني للشريك)
    ["phone", "TEXT"],               // جوال المحل (لصاحب الخدمة يتصل عليه من لوحة العمليات)     // مسكّر مؤقتاً (زحمة) ويفتح لحاله بعد هالوقت
  ],
  drivers: [
    ["on_duty", "INTEGER NOT NULL DEFAULT 1"], // شغّال الحين؟ لو لا: ما توصله تنبيهات الطلبات الجديدة
  ],
  reports: [
    ["source", "TEXT"],              // null = الزبون، driver = المندوب بلّغ وهو في الطريق
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
    db.prepare("CREATE INDEX IF NOT EXISTS orders_promo ON orders(promo, phone_key)"),
  ]);
  ready = true;
}
