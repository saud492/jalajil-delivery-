// Worker صغير يفحص الطلبات الواقفة كل دقيقة (Cloudflare Pages ما فيه cron)
// النشر: cd cron && npx wrangler@4 deploy && npx wrangler@4 secret put CRON_SECRET
// CRON_SECRET لازم يكون نفس السر المحطوط في مشروع Pages
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch(env.SITE + "/api/cron", { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } }));
  },
};
