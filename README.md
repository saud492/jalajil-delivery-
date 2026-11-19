# jalajil-delivery-
## الإشعارات (مرة وحدة قبل النشر)
1. `node tools/vapid-keys.mjs` يطلع ثلاث قيم.
2. في Cloudflare Pages ← Settings ← Variables and Secrets، أضف `VAPID_PUBLIC` و `VAPID_PRIVATE` و `CRON_SECRET` كأسرار.
3. الحارس (يفحص الطلبات الواقفة كل دقيقة): `cd cron && npx wrangler@4 deploy && npx wrangler@4 secret put CRON_SECRET` بنفس السر.
4. بدون المفاتيح كل شي يشتغل مثل قبل، وزر التنبيهات ما يطلع.

في الآيفون: التطبيق لازم ينضاف للشاشة الرئيسية (iOS 16.4 أو أحدث) عشان توصله الإشعارات.

## التجارب
- `node --test tests/` (الوحدات والإشعارات)
- `LOCAL=1 node tests/e2e.mjs` (من الطلب للتسليم، بدون wrangler)
- `node tests/serve.mjs` سيرفر تجربة على http://localhost:8790 (كلمة سر اللوحة test-pass-123)
