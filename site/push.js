/* زر «فعّل التنبيهات» المشترك بين التطبيقات
   JLPush.mount(مكان, { sw: "/driver/sw.js", scope: "/driver/", api: "/api/driver/push", who: "الطلبات الجديدة" })
   - لو الجهاز مفعّل: يحدّث الاشتراك بصمت (عشان يتبع الحساب الحالي) ويطلع «التنبيهات شغالة»
   - آيفون بدون تثبيت: يشرح «أضف للشاشة الرئيسية» أول
   - لو السيرفر ما فيه مفاتيح إشعارات: ما يطلع شي */
(function(){
  const css = ".jlp{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-radius:14px;padding:12px 14px;margin:0;"
    + "background:var(--accent-soft,#e1efed);border:1.5px solid var(--accent,#0f6a66);color:var(--ink,#1f2a2b);font-weight:600;line-height:1.6}"
    + ".jlp span{flex:1 1 200px}.jlp small{display:block;font-weight:500;color:var(--muted,#5f6b6b)}"
    + ".jlp button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:9px 16px;cursor:pointer;background:var(--accent,#0f6a66);color:var(--accent-ink,#fff);min-height:44px}"
    + ".jlp button.l{background:transparent;color:var(--accent,#0f6a66);border:1.5px solid var(--accent,#0f6a66)}"
    + ".jlp.on{background:transparent;border-style:dashed;padding:8px 14px}.jlp.bad{background:var(--bad-soft,#fbe9e7);border-color:var(--bad,#b3261e)}";
  let styled = false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  function key(b64){ const s = atob((b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); }
  async function post(api, body){
    const r = await fetch(api, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if(!r.ok){ let m = "ما قدرنا نفعّل التنبيهات"; try{ m = (await r.json()).error || m; }catch(e){} throw new Error(m); }
  }
  async function reg(o){
    return (await navigator.serviceWorker.getRegistration(o.scope)) || navigator.serviceWorker.register(o.sw, { scope: o.scope });
  }
  async function mount(box, o){
    if(!box) return;
    if(!styled){ const s = document.createElement("style"); s.textContent = css; document.head.append(s); styled = true; }
    let vapid = null;
    try{ vapid = (await (await fetch("/api/push/key")).json()).key; }catch(e){}
    if(!vapid){ box.innerHTML = ""; return; }
    const show = (cls, html, btn, fn, btn2, fn2) => {
      box.innerHTML = ""; const d = document.createElement("div"); d.className = "jlp " + cls;
      const t = document.createElement("span"); t.innerHTML = html; d.append(t);
      if(btn){ const b = document.createElement("button"); b.type = "button"; b.textContent = btn; b.onclick = fn; d.append(b); }
      if(btn2){ const b = document.createElement("button"); b.type = "button"; b.className = "l"; b.textContent = btn2; b.onclick = fn2; d.append(b); }
      box.append(d);
    };
    // وضع التذكير (الشاشة الرئيسية): يطلع بس لو التنبيهات مو شغالة، ومعه «لاحقاً» يخفيه ٣ أيام
    // وضع الإدارة (manage: في الملخص أو الإعدادات): يعرض الحالة دايم مع زر تشغيل/إيقاف
    const later = "jlp-later:" + o.scope;
    const snoozed = () => { try{ return Number(localStorage.getItem(later) || 0) > Date.now(); }catch(e){ return false; } };
    const snooze = () => { try{ localStorage.setItem(later, String(Date.now() + 3 * 864e5)); }catch(e){} box.innerHTML = ""; };
    const hide = () => { box.innerHTML = ""; };
    if(!supported()){
      if(o.quietIfUnsupported) hide();
      else if(ios && !standalone()){
        if(!o.manage && snoozed()) return hide();
        show("", "🔔 عشان توصلك تنبيهات " + o.who + " والجوال مقفل:<small>اضغط زر المشاركة <b>⬆️</b>، بعدين <b>«إضافة إلى الشاشة الرئيسية»</b>، وافتح التطبيق من أيقونته.</small>", null, null, o.manage ? null : "لاحقاً", snooze);
      }
      else if(o.manage) show("bad", "🔕 هالمتصفح ما يدعم التنبيهات.<small>جرّب Chrome، أو حدّث الجوال.</small>");
      else hide();
      return;
    }
    const enable = async () => {
      try{
        const p = await Notification.requestPermission();
        if(p !== "granted"){ render(); return; }
        const r = await reg(o); await navigator.serviceWorker.ready;
        let sub = await r.pushManager.getSubscription();
        if(!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(vapid) });
        await post(o.api, { ...(o.extra || {}), sub: sub.toJSON() });
        render(true);
      }catch(e){ show("bad", "⚠️ " + (e.message || "ما قدرنا نفعّل التنبيهات"), "جرّب مرة ثانية", enable); }
    };
    const disable = async () => {
      try{
        const r = await reg(o); const sub = await r.pushManager.getSubscription();
        if(sub){ await post(o.api, { ...(o.extra || {}), sub: sub.toJSON(), off: true }).catch(()=>{}); await sub.unsubscribe(); }
      }catch(e){}
      render();
    };
    async function render(justOn){
      if(Notification.permission === "denied"){
        if(!o.manage) return hide();
        show("bad", "🔕 التنبيهات مقفلة لهالموقع.<small>افتح إعدادات الجوال ← الإشعارات، وفعّلها للمتصفح أو التطبيق.</small>"); return;
      }
      let sub = null;
      if(Notification.permission === "granted"){ try{ const r = await reg(o); sub = await r.pushManager.getSubscription(); }catch(e){} }
      if(sub){
        if(!justOn) post(o.api, { ...(o.extra || {}), sub: sub.toJSON() }).catch(()=>{}); // يربط الجهاز بالحساب الحالي
        if(!o.manage){
          // شغالة: ما نزحم الشاشة الرئيسية. بس بعد التفعيل مباشرة نأكّد ثواني ونخفيها
          if(!justOn) return hide();
          show("on", "🔔 التنبيهات شغالة ✓<small>توصلك " + o.who + " حتى لو التطبيق مسكّر.</small>");
          setTimeout(hide, 4000); return;
        }
        show("on", "🔔 التنبيهات شغالة" + (justOn ? " ✓" : "") + "<small>توصلك " + o.who + " حتى لو التطبيق مسكّر.</small>", null, null, "إيقاف", disable);
      } else {
        if(!o.manage && snoozed()) return hide();
        show("", "🔕 فعّل التنبيهات عشان توصلك " + o.who + " حتى لو الجوال مقفل", "🔔 فعّل التنبيهات", enable, o.manage ? null : "لاحقاً", snooze);
      }
    }
    render();
  }
  window.JLPush = { mount };
})();
