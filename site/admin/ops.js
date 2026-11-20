/* لوحة التشغيل: مباشر، التحليلات، الزبائن
   يعتمد على أدوات الصفحة: api, el, toast, money, toAr, DEST, when, DRIVERS */
(function(){
const css = `
:root{--lv-green:#2e7d4f;--lv-yellow:#a86b00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--lv-green:#6fcf97;--lv-yellow:#e3b341}}
.wide{max-width:1400px}
.drvstrip{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
.dchip{flex:none;display:flex;align-items:center;gap:6px;background:var(--surface);border:1.5px solid var(--line);border-radius:999px;padding:5px 12px;font-size:14px;font-weight:600;white-space:nowrap}
.dchip.off{opacity:.6}.dchip b{font-family:var(--font-display)}
.dchip.sug{border-color:var(--accent)}
.lsum{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:14px;color:var(--muted)}
.lsum b{color:var(--ink)}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(280px,1fr);gap:12px;overflow-x:auto;align-items:start;padding-bottom:6px}
.col{background:var(--surface2);border:1px solid var(--line);border-radius:18px;padding:10px;display:flex;flex-direction:column;gap:10px;min-height:120px}
.col h2{font-size:15px;display:flex;align-items:center;gap:6px}
.col h2 span{margin-inline-start:auto;background:var(--surface);border-radius:999px;padding:0 10px;font-size:13px;color:var(--muted)}
.oc{background:var(--surface);border-radius:14px;padding:10px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:6px;border-inline-start:5px solid var(--line);font-size:14px}
.oc.green{border-inline-start-color:var(--lv-green)}.oc.yellow{border-inline-start-color:var(--lv-yellow)}.oc.red{border-inline-start-color:var(--bad)}
.oc.fresh{animation:flash 1.2s ease 2}
@keyframes flash{50%{box-shadow:0 0 0 4px var(--accent-soft)}}
.oc h3{font-size:15px}
.lv{font-weight:700;font-size:13px;white-space:nowrap}
.lv.green{color:var(--lv-green)}.lv.yellow{color:var(--lv-yellow)}.lv.red{color:var(--bad)}.lv.done{color:var(--muted)}
.oc .ln{color:var(--muted)}.oc .ln b{color:var(--ink);font-weight:600}
.qa{display:flex;flex-wrap:wrap;gap:6px}
.qa a,.qa button{border:1.5px solid var(--line);background:var(--surface2);border-radius:10px;padding:3px 9px;font-size:13px;font-weight:700;text-decoration:none;color:var(--ink)}
.qa select{width:auto;flex:1;min-width:150px;padding:4px 8px;font-size:14px;border-radius:10px}
.badge{border-radius:999px;padding:0 8px;font-size:12px;font-weight:700;background:var(--bad-soft);color:var(--bad)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:var(--surface);border-radius:16px;padding:12px 14px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:2px}
.kpi small{color:var(--muted);font-size:13px}
.kpi b{font-family:var(--font-display);font-size:26px;line-height:1.2;font-variant-numeric:tabular-nums}
.kpi span{font-size:12.5px;color:var(--muted)}
.kpi span.up{color:var(--lv-green)}.kpi span.down{color:var(--bad)}
.hbars{display:flex;flex-direction:column;gap:8px}
.hb{display:grid;grid-template-columns:120px 1fr 64px;gap:8px;align-items:center;font-size:14px}
.hb i{display:block;height:12px;border-radius:0 4px 4px 0;background:var(--accent);min-width:2px}
.hb em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--ink);font-weight:700}
.chart svg{width:100%;height:auto;display:block}
.chart .bar{fill:var(--accent)}.chart .bar:hover{fill:var(--accent-2)}
.chart text{fill:var(--muted);font-size:11px;font-family:var(--font-body)}
.chart .gl{stroke:var(--line);stroke-width:1}
.heat{display:grid;grid-template-columns:56px repeat(24,minmax(14px,1fr));gap:2px;font-size:11px;color:var(--muted);min-width:480px}
.heat div{aspect-ratio:1;border-radius:3px;background:var(--surface2)}
.heat .lab{aspect-ratio:auto;background:none;align-self:center;white-space:nowrap}
.heat .hl{aspect-ratio:auto;background:none;text-align:center}
.legend{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.legend i{width:14px;height:14px;border-radius:3px;display:inline-block}
.segs{display:flex;gap:6px;flex-wrap:wrap}
.segs button{border:1.5px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;font-weight:700;font-size:14px}
.segs button.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.crow{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:10px}
.crow .qa{margin-top:2px}
.exp{display:flex;gap:6px;flex-wrap:wrap}
`;
const st = document.createElement("style"); st.textContent = css; document.head.append(st);

const M = 60000, H = 3600000, D = 86400000;
const tel = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const wa = (p, text) => "https://wa.me/" + String(p || "").replace(/[^\d]/g, "").replace(/^0(5\d{8})$/, "966$1") + (text ? "?text=" + encodeURIComponent(text) : "");
const link = (txt, href, blank) => { const a = el("a", "", txt); a.href = href; if(blank){ a.target = "_blank"; a.rel = "noopener"; } return a; };
const minsAgo = ms => Math.max(0, Math.round((Date.now() - ms) / M));
const minTxt = m => m === null || m === undefined ? "—" : m < 60 ? toAr(Math.round(m)) + " د" : toAr(Math.floor(m / 60)) + " س " + toAr(Math.round(m % 60)) + " د";
const iso = x => x.toISOString().slice(0, 10);
const riyadhNow = () => new Date(Date.now() + 3 * H);

/* ================= مباشر ================= */
const COLS = [["new","🆕 جديد / عند المحل"],["customer","⏳ ينتظر الزبون"],["buying","🛍️ يشتري"],["onway","🛵 في الطريق"],["done","✅ وصل (آخر ساعتين)"]];
const STAGE = { pricing:"ينتظر الفاتورة", approve:"ينتظر موافقة الزبون", prepay:"ينتظر التحويل", prepay_check:"تحويل ينتظر تأكيدك", buying:"يشتري", onway:"في الطريق", delivered:"وصل" };
const LEVEL = { green:"🟢 في الوقت", yellow:"🟡 قرّب يتأخر", red:"🔴 متأخر", done:"✓" };
let LIVE = null, liveTimer = null, seenLive = null;

async function loadLive(){
  try{ LIVE = await api("live"); renderLive(); }
  catch(err){ $("#liveBoard").textContent = err.message; }
}
function renderLive(){
  const d = LIVE, fresh = new Set();
  if(seenLive) d.orders.forEach(o => { if(!seenLive.has(o.id)) fresh.add(o.id); });
  seenLive = new Set(d.orders.map(o => o.id));
  // المناديب
  const ds = $("#liveDrivers"); ds.innerHTML = "";
  d.drivers.forEach(x => {
    const c = el("span", "dchip" + (x.on_duty ? "" : " off") + (x.suggested ? " sug" : ""));
    c.append(x.on_duty ? "🟢" : "😴", el("b", "", x.name), el("span", "", x.load ? `معه ${toAr(x.load)}` : "فاضي"));
    if(x.rating) c.append(el("span", "", "★" + toAr(x.rating)));
    if(x.suggested) c.append(el("span", "", "· المقترح"));
    ds.append(c);
  });
  if(!d.drivers.length) ds.append(el("span", "muted", "ما فيه مناديب فعّالين"));
  // الملخص
  const act = d.orders.filter(o => o.column !== "done");
  const red = act.filter(o => o.level === "red").length, noDrv = act.filter(o => !o.driver).length;
  const s = $("#liveSum"); s.innerHTML = "";
  s.append(el("span", "", "طلبات شغّالة: "), el("b", "", toAr(act.length)));
  if(red) s.append(el("span", "badge", `🔴 ${toAr(red)} متأخر`));
  if(noDrv) s.append(el("span", "badge", `🛵 ${toAr(noDrv)} بدون مندوب`));
  s.append(el("span", "", "· آخر تحديث " + new Intl.DateTimeFormat("ar-SA-u-nu-arab",{hour:"numeric",minute:"2-digit",second:"2-digit",timeZone:"Asia/Riyadh"}).format(new Date())));
  // الأعمدة
  const b = $("#liveBoard"); b.innerHTML = "";
  COLS.forEach(([key, title]) => {
    const list = d.orders.filter(o => o.column === key).sort((x, y) => key === "done" ? y.since - x.since : x.since - y.since);
    const c = el("section", "col"), h = el("h2", "", title); h.append(el("span", "", toAr(list.length))); c.append(h);
    if(!list.length) c.append(el("p", "muted", "ما فيه"));
    list.forEach(o => c.append(liveCard(o, d.drivers, fresh.has(o.id))));
    b.append(c);
  });
}
function liveCard(o, drivers, isFresh){
  const c = el("article", "oc " + o.level + (isFresh ? " fresh" : ""));
  const h = el("div", "row"); h.append(el("h3", "grow", o.order_no));
  if(o.blocked) h.append(el("span", "badge", "🚫 محظور"));
  if(o.reports) h.append(el("span", "badge", `🚩 ${toAr(o.reports)} بلاغ`));
  c.append(h);
  const lv = el("div", "lv " + o.level, `${LEVEL[o.level]} · ${STAGE[o.stage] || o.stage} من ${minTxt(minsAgo(o.since))}` + (o.sla && o.level !== "done" ? ` (المسموح ${toAr(o.sla)} د)` : ""));
  c.append(lv);
  const ln = (k, v) => { if(!v) return; const p = el("div", "ln"); p.append(k + " "); p.append(el("b", "", v)); c.append(p); };
  ln("👤", (o.customer_name || "زبون") + " · " + (DEST[o.dest] || o.dest) + (o.place ? " · " + o.place : ""));
  o.parts.forEach(p => ln(p.partner ? "🏪" : "🛒", (p.shop_name || "محل") + (p.bill != null ? ` · ${money(p.bill)} ر` : "") + (p.status === "rejected" ? " · رفض" : p.status === "cancelled" ? " · ملغي" : "")));
  o.parts.filter(p => p.shop_note).forEach(p => c.append(el("div", "snote", "📝 " + p.shop_note)));
  if(o.billed) ln("💰", `المشتريات ${money(o.total)} ر + توصيل ${money(o.fee)} ر` + (o.auto_approved ? " · موافقة تلقائية" : ""));
  ln("🛵", o.driver ? o.driver.name : "بدون مندوب");
  const qa = el("div", "qa");
  if(o.customer_phone){ qa.append(link("📞 الزبون", tel(o.customer_phone)), link("💬 الزبون", wa(o.customer_phone, `هلا، بخصوص طلبك ${o.order_no} من توصيل جلاجل`), true)); }
  o.parts.filter(p => p.shop_phone).forEach(p => qa.append(link("📞 " + p.shop_name, tel(p.shop_phone))));
  if(o.driver && o.driver.phone) qa.append(link("📞 المندوب", tel(o.driver.phone)));
  if(o.track) qa.append(link("🔗 المتابعة", o.track, true));
  if(o.map_url) qa.append(link("📍", o.map_url, true));
  c.append(qa);
  if(o.column !== "done" && o.driver_status !== "picked"){
    const r = el("div", "qa");
    const sel = el("select"); sel.setAttribute("aria-label", "تعيين مندوب");
    sel.append(new Option(o.driver ? "تغيير المندوب…" : "تعيين مندوب…", ""));
    drivers.forEach(x => sel.append(new Option(`${x.suggested ? "⭐ " : ""}${x.name} · ${x.on_duty ? (x.load ? "معه " + toAr(x.load) : "فاضي") : "مو شغّال"}`, x.id)));
    if(o.driver) sel.append(new Option("— شيل المندوب", "none"));
    sel.onchange = async () => {
      if(!sel.value) return;
      try{ await api("orders/" + o.id + "/driver", "POST", { driver_id: sel.value === "none" ? null : Number(sel.value) }); toast("تم ✓"); loadLive(); }
      catch(err){ toast(err.message); sel.value = ""; }
    };
    r.append(sel);
    const x = el("button", "", "إلغاء"); x.type = "button"; x.style.color = "var(--bad)";
    x.onclick = async () => {
      if(!confirm(`تلغي طلب ${o.order_no} كامل؟ المحل والمندوب بيدرون.`)) return;
      try{ for(const p of o.parts.filter(p => !["cancelled","rejected"].includes(p.status))) await api("parts/" + p.id, "POST", {action:"cancel"}); toast("انلغى الطلب"); loadLive(); }
      catch(err){ toast(err.message); }
    };
    r.append(x); c.append(r);
  }
  return c;
}
function startLive(){ stopLive(); loadLive(); liveTimer = setInterval(() => { if(document.visibilityState === "visible") loadLive(); }, 10000); }
function stopLive(){ clearInterval(liveTimer); liveTimer = null; }

/* ================= التحليلات ================= */
function period(v){
  const d = riyadhNow(), day = n => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return ({ today: [iso(d), iso(d)], yesterday: [day(-1), day(-1)], d7: [day(-6), iso(d)], d30: [day(-29), iso(d)],
    month: [iso(new Date(Date.UTC(y, m, 1))), iso(d)], lastmonth: [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))] })[v];
}
// الفرق عن الفترة اللي قبلها: السهم + كلمة، مو لون بس
function delta(cur, prev, goodUp = true, unit = ""){
  if(prev === null || prev === undefined || cur === null || cur === undefined) return el("span", "", "ما فيه مقارنة");
  const diff = Math.round((cur - prev) * 10) / 10;
  if(!diff) return el("span", "", "نفس الفترة اللي قبلها");
  const up = diff > 0, good = up === goodUp;
  return el("span", good ? "up" : "down", `${up ? "▲" : "▼"} ${toAr(Math.abs(diff))}${unit} عن الفترة اللي قبلها`);
}
async function loadStats(){
  const [from, to] = period($("#stPeriod").value);
  const box = $("#statsBody"); box.innerHTML = ""; box.append(el("p", "muted", "جاري الحساب…"));
  try{ renderStats(await api(`analytics?from=${from}&to=${to}`)); }
  catch(err){ box.innerHTML = ""; box.append(el("p", "muted", err.message)); }
}
function renderStats(d){
  const box = $("#statsBody"); box.innerHTML = "";
  const s = d.stats, p = d.before;
  // المؤشرات
  const k = el("div", "kpis");
  const tile = (label, val, dl, sub) => { const t = el("div", "kpi"); t.append(el("small", "", label), el("b", "", val), dl); if(sub) t.append(el("span", "", sub)); k.append(t); };
  tile("الطلبات", toAr(s.orders), delta(s.orders, p.orders));
  tile("وصلت", toAr(s.delivered), delta(s.delivered, p.delivered));
  tile("نسبة الإلغاء", toAr(s.cancel_rate) + "٪", delta(s.cancel_rate, p.cancel_rate, false, "٪"), toAr(s.cancelled) + " طلب ملغي");
  tile("متوسط وقت التوصيل", minTxt(s.avg_delivery), delta(s.avg_delivery, p.avg_delivery, false, " د"), "من الطلب لين وصل");
  tile("مبيعات المحلات", money(s.sales) + " ر", delta(s.sales, p.sales));
  tile("صافي ربحك", money(s.net) + " ر", delta(s.net, p.net));
  box.append(k);
  // تفصيل الربح
  const m = el("div", "card");
  m.append(el("h2", "", "💵 من وين جا ربحك"));
  m.append(el("p", "muted", `رسوم التوصيل ${money(s.fees)} ر − نصيب المناديب ${money(s.driver_share)} ر + عمولات المحلات ${money(s.commissions)} ر = ${money(s.net)} ر` + (s.discounts ? ` · وتحمّلت خصومات بقيمة ${money(s.discounts)} ر` : "")));
  box.append(m);
  // وين يضيع الوقت
  const tm = el("div", "card"); tm.append(el("h2", "", "⏱️ وين يضيع الوقت (متوسط بالدقايق)"));
  const st = [["المحل يقبل الطلب", s.stages.shop_accept], ["الزبون يوافق على المبلغ", s.stages.customer_approve], ["المندوب يشتري ويستلم", s.stages.buy], ["الطريق للزبون", s.stages.travel]];
  const max = Math.max(1, ...st.map(x => x[1] || 0));
  const hb = el("div", "hbars");
  st.forEach(([l, v]) => { const r = el("div", "hb"); const bar = el("i"); bar.style.width = ((v || 0) / max * 100) + "%"; r.title = `${l}: ${v === null ? "ما فيه بيانات" : toAr(v) + " دقيقة"}`; r.append(el("span", "", l), el("div", "", ""), el("em", "", v === null ? "—" : toAr(v) + " د")); r.children[1].append(bar); hb.append(r); });
  tm.append(hb);
  const worst = st.filter(x => x[1] !== null).sort((a, b) => b[1] - a[1])[0];
  if(worst) tm.append(el("p", "muted", `أطول خطوة: «${worst[0]}». هنا أكثر مكان تقدر تسرّع فيه الطلبات.`));
  box.append(tm);
  // يومياً
  if(d.days.length > 1){
    const c = el("div", "card chart"); c.append(el("h2", "", "📈 الطلبات يومياً"));
    c.append(dayChart(d.days)); box.append(c);
  }
  // الذروة
  const hc = el("div", "card"); hc.append(el("h2", "", "🔥 أوقات الذروة"), el("p", "muted", "كل مربع = ساعة في يوم من أيام الأسبوع. الأغمق = طلبات أكثر. رتّب المناديب على حسبها."));
  hc.append(heatmap(d.heat)); box.append(hc);
  // المحلات
  const sc = el("div", "card"); sc.append(el("h2", "", "🏪 أداء المحلات"));
  sc.append(table(["المحل","الطلبات","القبول","يقبل خلال","ملتزم بالوقت","التقييم","المبيعات","العمولة"],
    d.shops.map(x => [x.name, toAr(x.orders), x.accept_rate === null ? "—" : toAr(x.accept_rate) + "٪", minTxt(x.accept_minutes), x.on_time === null ? "—" : toAr(x.on_time) + "٪", x.rating ? "★" + toAr(x.rating) : "—", money(x.sales), money(x.commission)])));
  box.append(sc);
  // المناديب
  const dc = el("div", "card"); dc.append(el("h2", "", "🛵 أداء المناديب"));
  dc.append(table(["المندوب","التوصيلات","متوسط الوقت","التقييم","الشكاوى","ربحه"],
    d.drivers.map(x => [x.name, toAr(x.delivered), minTxt(x.minutes), x.rating ? "★" + toAr(x.rating) : "—", toAr(x.complaints), money(x.earned)])));
  dc.append(el("p", "muted", "متوسط الوقت: من ما ياخذ الطلب لين يسلّمه."));
  box.append(dc);
}
function table(head, rows){
  const w = el("div", "scroll"), t = el("table"), th = el("thead"), tr = el("tr");
  head.forEach(h => tr.append(el("th", "", h))); th.append(tr); t.append(th);
  const tb = el("tbody");
  if(!rows.length){ const r = el("tr"), c = el("td", "muted", "ما فيه بيانات في هالفترة"); c.colSpan = head.length; r.append(c); tb.append(r); }
  rows.forEach(r => { const x = el("tr"); r.forEach((v, i) => x.append(el("td", "", v))); tb.append(x); });
  t.append(tb); w.append(t); return w;
}
// أعمدة الطلبات يومياً: سلسلة وحدة، ألوان العلامة، خطوط شبكة خفيفة، تلميح على كل عمود
function dayChart(days){
  const W = 720, Hh = 200, pad = { l: 30, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...days.map(x => x.orders)), n = days.length;
  const bw = (W - pad.l - pad.r) / n, gap = Math.min(4, bw * .25);
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "عدد الطلبات يومياً");
  const mk = (t, a) => { const e = document.createElementNS(ns, t); for(const k in a) e.setAttribute(k, a[k]); return e; };
  const y = v => pad.t + (Hh - pad.t - pad.b) * (1 - v / max);
  const step = Math.max(1, Math.ceil(max / 4));
  for(let v = 0; v <= max; v += step){ svg.append(mk("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: "gl" })); const t = mk("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end" }); t.textContent = toAr(v); svg.append(t); }
  days.forEach((x, i) => {
    const X = pad.l + i * bw + gap / 2, h = Math.max(0, (Hh - pad.t - pad.b) * x.orders / max);
    const r = mk("rect", { x: X, y: Hh - pad.b - h, width: Math.max(1, bw - gap), height: h, rx: 3, class: "bar" });
    const tt = document.createElementNS(ns, "title"); tt.textContent = `${x.date}: ${x.orders} طلب، وصل ${x.delivered}، صافي ${x.net} ر`; r.append(tt); svg.append(r);
    if(n <= 10 || i % Math.ceil(n / 8) === 0){ const t = mk("text", { x: X + (bw - gap) / 2, y: Hh - 8, "text-anchor": "middle" }); t.textContent = toAr(Number(x.date.slice(8))) + "/" + toAr(Number(x.date.slice(5, 7))); svg.append(t); }
  });
  const w = el("div"); w.append(svg); return w;
}
// خريطة الذروة: درجات لون واحد (فاتح ← غامق)
function heatmap(heat){
  const days = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"], order = [6,0,1,2,3,4,5];
  const max = Math.max(1, ...heat.flat()), g = el("div", "heat");
  g.append(el("span", "lab", ""));
  for(let h = 0; h < 24; h++) g.append(el("span", "hl", h % 3 === 0 ? toAr(h) : ""));
  order.forEach(d => {
    g.append(el("span", "lab", days[d]));
    heat[d].forEach((v, h) => {
      const c = el("div"); if(v){ c.style.background = "var(--accent)"; c.style.opacity = (.15 + .85 * v / max).toFixed(2); }
      c.title = `${days[d]} الساعة ${h}:00 — ${v} طلب`; g.append(c);
    });
  });
  const w = el("div"); w.style.overflowX = "auto"; w.append(g);
  const lg = el("div", "legend"); lg.append("أقل");
  [.15,.45,.75,1].forEach(o => { const i = el("i"); i.style.background = "var(--accent)"; i.style.opacity = o; lg.append(i); });
  lg.append("أكثر"); w.append(lg);
  const flat = []; heat.forEach((r, d) => r.forEach((v, h) => flat.push([v, d, h])));
  const top = flat.filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 3);
  if(top.length) w.append(el("p", "muted", "أكثر الأوقات طلبات: " + top.map(([v, d, h]) => `${days[d]} ${toAr(h)}:٠٠ (${toAr(v)})`).join("، ")));
  return w;
}
async function exportCsv(type){
  const [from, to] = period($("#stPeriod").value);
  try{
    const r = await fetch(`/api/admin/export?type=${type}&from=${from}&to=${to}`);
    if(!r.ok){ let m = "ما قدرنا نصدّر"; try{ m = (await r.json()).error || m; }catch(e){} throw new Error(m); }
    const blob = await r.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `jalajil-${type}-${from}_${to}.csv`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }catch(err){ toast(err.message); }
}

/* ================= الزبائن ================= */
let SEG = "", custQ = "", custTimer = null, CUST = [];
const SEGS = [["","الكل","all"],["new","جدد","new"],["returning","متكررين","returning"],["inactive","منقطعين +٣٠ يوم","inactive"],["blocked","محظورين","blocked"]];
const SEGNAME = { new:"جديد", returning:"متكرر", inactive:"منقطع" };
async function loadCustomers(){
  const box = $("#custList"); box.textContent = "جاري التحميل…";
  try{
    const d = await api(`customers?segment=${SEG}&q=${encodeURIComponent(custQ)}`);
    CUST = d.customers;
    const sg = $("#custSegs"); sg.innerHTML = "";
    SEGS.forEach(([k, l, c]) => { const b = el("button", k === SEG ? "on" : "", `${l} (${toAr(d.counts[c] || 0)})`); b.type = "button"; b.onclick = () => { SEG = k; loadCustomers(); }; sg.append(b); });
    $("#winback").classList.toggle("hidden", SEG !== "inactive" || !CUST.length);
    box.innerHTML = "";
    if(!CUST.length){ box.append(el("p", "muted", "ما فيه زبائن هنا.")); return; }
    if(d.total > CUST.length) box.append(el("p", "muted", `يطلع أول ${toAr(CUST.length)} من ${toAr(d.total)}. ابحث عشان تلقى الباقي.`));
    CUST.forEach(c => box.append(custRow(c)));
  }catch(err){ box.textContent = err.message; }
}
function custRow(c){
  const r = el("div", "crow"), h = el("div", "row");
  h.append(el("b", "grow", (c.name || "بدون اسم") + " · " + (c.phone || c.phone_key)));
  if(c.blocked) h.append(el("span", "pill off", "🚫 محظور"));
  else h.append(el("span", "pill " + (c.segment === "inactive" ? "none" : "open"), SEGNAME[c.segment]));
  r.append(h);
  r.append(el("div", "muted", [`${toAr(c.orders)} طلب`, `وصل ${toAr(c.delivered)}`, `صرف ${money(c.spent)} ر`, c.last ? "آخر طلب " + when(c.last) : "", c.complaints ? `🚩 ${toAr(c.complaints)} شكوى` : "", c.promos ? `استخدم كود ${toAr(c.promos)} مرة` : ""].filter(Boolean).join(" · ")));
  if(c.blocked && c.reason) r.append(el("div", "muted", "سبب الحظر: " + c.reason));
  if(c.note) r.append(el("div", "snote", "📝 " + c.note));
  const qa = el("div", "qa");
  if(c.phone){ qa.append(link("📞 اتصال", tel(c.phone)), link("💬 واتساب", wa(c.phone), true)); }
  const n = el("button", "", "📝 ملاحظة"); n.type = "button";
  n.onclick = async () => { const v = prompt("ملاحظتك على الزبون:", c.note || ""); if(v === null) return; try{ await api("customers/" + c.phone_key, "PUT", { note: v }); loadCustomers(); }catch(err){ toast(err.message); } };
  const bl = el("button", "", c.blocked ? "✅ فك الحظر" : "🚫 حظر"); bl.type = "button"; if(!c.blocked) bl.style.color = "var(--bad)";
  bl.onclick = async () => {
    let reason = "";
    if(!c.blocked){ reason = prompt("ليش تحظر هالرقم؟ (طلباته بتوصلك بس، وما تطلع للمحلات ولا المناديب)", "طلبات وهمية"); if(reason === null) return; }
    try{ await api("customers/" + c.phone_key, "PUT", { blocked: !c.blocked, reason }); toast(c.blocked ? "انفك الحظر" : "انحظر الرقم"); loadCustomers(); }catch(err){ toast(err.message); }
  };
  qa.append(n, bl); r.append(qa);
  return r;
}
// رجّع المنقطعين: رسالة جاهزة لكل زبون على الواتساب (ترسلها أنت بنفسك)
function buildWinback(){
  const msg = $("#wbMsg").value.trim(), box = $("#wbList"); box.innerHTML = "";
  if(!msg){ toast("اكتب الرسالة أول"); return; }
  CUST.filter(c => !c.blocked && c.phone).forEach(c => {
    const t = msg.replace(/\{الاسم\}/g, (c.name || "").split(" ")[0] || "");
    const r = el("div", "row"); r.append(el("span", "grow", (c.name || "زبون") + " · " + c.phone), link("💬 أرسل", wa(c.phone, t), true)); box.append(r);
  });
  if(!box.children.length) box.append(el("p", "muted", "ما فيه أرقام."));
}

/* ================= التبويبات ================= */
window.OPS = {
  show(tab){
    if(tab === "live") startLive(); else stopLive();
    if(tab === "stats") loadStats();
    if(tab === "customers") loadCustomers();
  },
};
$("#stPeriod").addEventListener("change", loadStats);
document.querySelectorAll("[data-exp]").forEach(b => b.addEventListener("click", () => exportCsv(b.dataset.exp)));
$("#custQ").addEventListener("input", () => { clearTimeout(custTimer); custTimer = setTimeout(() => { custQ = $("#custQ").value.trim(); loadCustomers(); }, 350); });
$("#wbBuild").addEventListener("click", buildWinback);
})();
