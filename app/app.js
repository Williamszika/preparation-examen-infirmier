/* Übungsseite Examen Pflege. MODE "artifact" = claude.ai (db + sample), MODE "public" = Netlify (/api/…). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtT = ms => { ms = Math.max(0, ms); const s = Math.floor(ms/1000); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return (h? h+":" : "") + String(m).padStart(2,"0") + ":" + String(x).padStart(2,"0"); };
const fmtD = t => t ? new Date(t).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "–";
const komma = n => String(n).replace(".", ",");
const EX = Object.fromEntries((DATA.pruefungen||[]).map(e => [e.id, e]));
const OR = Object.fromEntries((DATA.muendlich||[]).map(e => [e.id, e]));
const LS = { get(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch{ return null; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const S = { mode:"local", docs:{}, uid:null, name:"", owner:false, ki:false };
function localAll(){ return LS.get("examen-versuche-v1") || {}; }
function localPut(doc){ const all = localAll(); all[doc.key] = doc; LS.set("examen-versuche-v1", all); }
function versuche(id){ return Object.values(S.docs).filter(d => d.pruefung === id).sort((a,b) => a.versuch - b.versuch); }
function letzter(id){ const v = versuche(id); return v[v.length-1] || null; }
let toastT;
function flash(t){ let el = $("#toast"); if(!el){ el = document.createElement("div"); el.id="toast"; el.setAttribute("role","status"); el.style.cssText="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));background:var(--ink);color:var(--sheet);padding:10px 14px;border-radius:6px;z-index:20;max-width:90vw;font-size:.9rem"; document.body.append(el);} el.textContent=t; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true, 4500); }
function editing(){ const a = document.activeElement; return a && a.tagName === "TEXTAREA"; }

/* ================= Backend: claude.ai-Artifact ================= */
const ArtifactB = {
  db:null, user:null, sample:null, parentDone:false,
  col(){ return this.db.collection("abgaben/" + S.uid + "/versuche"); },
  async init(){
    try{
      const [db, user, sample] = await Promise.all([claude.use("db"), claude.use("user"), claude.use("sample")]);
      this.sample = sample; this.user = user; S.ki = !!sample;
      S.owner = user ? !!(await user.isOwner()) : false;
      S.uid = user ? await user.id() : null;
      if(db && S.uid){
        this.db = db; S.mode = "db";
        const timer = setTimeout(() => flash("Der Speicher antwortet noch nicht — du arbeitest vorerst auf diesem Gerät."), 10000);
        this.col().onSnapshot(snap => {
          clearTimeout(timer);
          const fromDb = {}; snap.docs.forEach(d => fromDb[d.id] = d.data());
          const loc = localAll();
          for(const k in loc){ if(!fromDb[k] || (loc[k].geaendert||0) > (fromDb[k].geaendert||0)){ fromDb[k] = loc[k]; this.col().doc(k).set(loc[k]).catch(()=>{}); } }
          S.docs = fromDb; if(!editing()) render();
        }, e => { clearTimeout(timer); S.mode = "local"; flash("Speicher nicht erreichbar (" + e.code + ") — Antworten bleiben auf diesem Gerät."); render(); });
      }
    }catch(e){ console.warn(e); }
  },
  async save(doc){
    if(S.mode !== "db") return;
    if(!this.parentDone){ this.parentDone = true; this.db.doc("abgaben/" + S.uid).set({ zuletzt: Date.now() }).catch(()=>{ this.parentDone = false; }); }
    await this.col().doc(doc.key).set(doc);
  },
  async korrigieren(ex, v){
    if(!this.sample) throw { code:"no_ai" };
    const r = await this.sample.json(prueferPrompt(ex, v.antworten), { modelTier:"complex", cache:false });
    return auswerten(ex, r, "Claude (Prüferin)");
  },
  async pruefer(o, st, onText){
    if(!this.sample) throw { code:"no_ai" };
    const turns = [{role:"user", content: oralRules(o, st.notizen)}, ...st.chat.slice(-30)];
    if(turns[turns.length-1].role !== "user") turns.push({role:"user", content:"(weiter)"});
    const { text } = await this.sample(turns, { cache:false, onText: ({text}) => onText(text) });
    return text;
  },
  async oralEval(o, st){
    if(!this.sample) throw { code:"no_ai" };
    const r = await this.sample.json(oralEvalPrompt(o, st.chat), { modelTier:"complex", cache:false });
    if(S.mode === "db"){ try{ await this.db.doc("abgaben/" + S.uid + "/muendlich/" + o.id + "-" + Date.now()).set({ fall:o.id, chat:st.chat, notizen:st.notizen, bewertung:r, am:Date.now() }); }catch(e){} }
    return r;
  },
  async adminList(){
    const people = await this.db.collection("abgaben").get();
    const rows = [];
    for(const d of people.docs){ const s = await this.db.collection("abgaben/" + d.id + "/versuche").get(); s.docs.forEach(x => rows.push({pid:d.id, ...x.data()})); }
    let names = {}; try{ names = await this.user.profiles([...new Set(rows.map(r => r.pid))]); }catch{}
    rows.forEach(r => r.name = names[r.pid]?.name || (r.pid===S.uid ? "Du" : "Person"));
    return rows;
  }
};

/* ================= Backend: öffentliche Seite (Netlify) ================= */
const ApiB = {
  async call(path, opts){ const r = await fetch(path, opts); if(!r.ok){ let m = ""; try{ m = (await r.json()).error; }catch{} throw { code: m === "ki_aus" ? "ki_aus" : r.status === 429 ? "rate_limited" : "http_" + r.status, message: m }; } return r.status === 202 ? {} : r.json(); },
  async post(path, body){ return this.call(path, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) }); },
  async init(){
    let id = LS.get("examen-uid");
    if(!id){ id = "u" + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2,"0")).join("").slice(0,20); LS.set("examen-uid", id); }
    S.uid = id; S.name = LS.get("examen-name") || ""; S.ki = true; S.owner = !!LS.get("examen-admin");
    await this.reload();
  },
  async reload(){
    try{
      const r = await this.call("/api/versuche?uid=" + encodeURIComponent(S.uid));
      const fromApi = {}; (r.docs||[]).forEach(d => fromApi[d.key] = d);
      const loc = localAll();
      for(const k in loc){ if(!fromApi[k] || (loc[k].geaendert||0) > (fromApi[k].geaendert||0) && !fromApi[k].korrektur){ fromApi[k] = loc[k]; this.save(loc[k]).catch(()=>{}); } }
      S.docs = fromApi; S.mode = "api"; S.oral = r.oral || {};
    }catch(e){ S.mode = "local"; console.warn(e); }
  },
  async save(doc){ const r = await this.post("/api/versuche", { uid:S.uid, name:S.name, doc }); if(r.doc){ S.docs[r.doc.key] = r.doc; localPut(r.doc); } },
  async poll(check, maxMs){ const t0 = Date.now(); while(Date.now() - t0 < maxMs){ await sleep(5000); await this.reload(); const x = check(); if(x) return x; } throw { code:"timeout" }; },
  async korrigieren(ex, v){
    const t = Date.now();
    await this.post("/api/korrektur", { uid:S.uid, key:v.key, t });
    const d = await this.poll(() => { const d = S.docs[v.key]; return d && (d.korrektur || d.korrekturWartet || (d.korrekturFehler && d.fehlerFuer === t)) ? d : null; }, 6*60000);
    if(d.korrektur) return d.korrektur;
    if(d.korrekturWartet) throw { code:"wartet" };
    throw { code:"server", message:d.korrekturFehler };
  },
  async pruefer(o, st, onText){ const r = await this.post("/api/pruefer", { uid:S.uid, fall:o.id, notizen:st.notizen, chat:st.chat.slice(-30) }); onText(r.text); return r.text; },
  async oralEval(o, st){
    const sid = st.sid || (st.sid = String(Date.now())); LS.set("oral-" + o.id, st);
    await this.reload();
    const vorh = S.oral && S.oral[o.id + "-" + sid];
    if(vorh && vorh.bewertung) return vorh.bewertung;
    if(vorh && vorh.wartet) throw { code:"wartet_oral" };
    const t = Date.now();
    await this.post("/api/muendlich", { uid:S.uid, name:S.name, fall:o.id, sid, t, notizen:st.notizen, chat:st.chat.slice(-60) });
    const k = o.id + "-" + sid;
    const x = await this.poll(() => { const d = S.oral && S.oral[k]; return d && (d.bewertung || d.wartet || (d.fehler && d.fehlerFuer === t)) ? d : null; }, 6*60000);
    if(x.bewertung) return x.bewertung;
    if(x.wartet) throw { code:"wartet_oral" }; throw { code:"server", message:x.fehler };
  },
  async adminList(){ const r = await this.call("/api/admin?token=" + encodeURIComponent(LS.get("examen-admin")||"")); return r.docs || []; }
};

const B = MODE === "public" ? ApiB : ArtifactB;
async function save(doc){
  doc = JSON.parse(JSON.stringify(doc)); doc.geaendert = Date.now();
  S.docs[doc.key] = doc; localPut(doc);
  try{ await B.save(doc); }catch(e){ console.warn(e); if(S.mode !== "local") flash("Nicht übertragen (" + (e.code||"Fehler") + "). Deine Antworten sind auf diesem Gerät gesichert."); }
}
function kiFehler(e){
  return { not_granted:"Du hast der Seite nicht erlaubt, Claude zu fragen.", rate_limited:"Zu viele Anfragen gerade. Versuch es in ein paar Minuten noch einmal.", invalid_json:"Die Korrektur kam unvollständig an. Drück noch einmal auf den Knopf.", no_ai:"Die Prüferin ist in dieser Ansicht nicht verfügbar.", timeout:"Die Prüferin braucht zu lange. Lade die Seite später neu: das Ergebnis erscheint dann von selbst.", wartet:"Deine Arbeit ist bei der Prüferin angekommen. Die Korrektur und die Note erscheinen hier, sobald sie fertig sind. Schau später wieder vorbei.", wartet_oral:"Dein Gespräch ist bei der Prüferin angekommen. Die Bewertung erscheint hier, sobald sie fertig ist." }[e && e.code] || "Das hat nicht geklappt (" + ((e && (e.message || e.code)) || "Fehler") + ").";
}

async function boot(){
  S.docs = localAll();
  render();
  await B.init();
  $("#tab-abgaben").hidden = !S.owner;
  render();
}

/* ---------- Routing ---------- */
window.addEventListener("hashchange", render);
function route(){ return (location.hash || "#start").slice(1); }
let tick;
function render(){
  clearInterval(tick);
  const r = route();
  for(const a of document.querySelectorAll("#tabs a")) a.removeAttribute("aria-current");
  const tab = r === "muendlich" || OR[r] ? "muendlich" : r === "ergebnisse" ? "ergebnisse" : r === "abgaben" ? "abgaben" : "start";
  $("#tab-" + tab)?.setAttribute("aria-current","page");
  const app = $("#app");
  if(r === "abgaben") return renderAdmin(app);
  if(MODE === "public" && !S.name) return renderName(app);
  if(EX[r]) return renderExam(app, EX[r]);
  if(OR[r]) return renderOral(app, OR[r]);
  if(r === "muendlich") return renderOralList(app);
  if(r === "ergebnisse") return renderResults(app);
  renderStart(app);
}

/* ---------- Name (öffentliche Seite) ---------- */
function renderName(app){
  app.innerHTML = `<section class="intro"><span class="lbl">Examen Pflege · Übungsprüfung</span><h1>Willkommen</h1>
    <p class="muted" style="max-width:68ch">Hier übst du das schriftliche und das mündliche Examen. Du brauchst kein Konto. Gib deinen Namen ein, damit deine Arbeiten dir zugeordnet werden können.</p></section>
    <form class="sheet" id="nf" style="max-width:520px">
      <label class="lbl" for="nm">Dein Name</label><input id="nm" autocomplete="name" required style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)">
      <button class="btn pri big">Weiter</button>
      <details><summary class="muted" style="cursor:pointer">Ich habe schon auf einem anderen Gerät geübt</summary><div class="stack" style="margin-top:8px"><label class="lbl" for="code">Dein Code von dem anderen Gerät</label><input id="code" style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"></div></details>
    </form>`;
  $("#nf").onsubmit = async e => { e.preventDefault(); const n = $("#nm").value.trim(); if(!n) return; const c = $("#code").value.trim();
    if(/^u[a-z0-9]{8,30}$/.test(c)){ LS.set("examen-uid", c); S.uid = c; await B.reload(); }
    S.name = n; LS.set("examen-name", n); render(); };
}

/* ---------- Start ---------- */
function status(id){
  const v = letzter(id);
  if(!v) return ["Offen","go"];
  if(v.status === "laeuft") return Date.now() < v.ende ? ["Läuft","run"] : ["Abgegeben","done"];
  if(v.korrektur){ const p = v.korrektur.prozent; return ["Note " + note(p)[0] + " · " + komma(p) + " %","done"]; }
  return ["Abgegeben","done"];
}
function renderStart(app){
  const mode = S.mode === "db" || S.mode === "api" ? "Deine Abgaben werden gespeichert und korrigiert." : "Speicher nicht verbunden: Antworten bleiben vorerst auf diesem Gerät.";
  app.innerHTML = `
  <section class="intro">
    <span class="lbl">Schriftliche Prüfung · § 14 PflAPrV</span>
    <h1>Drei Aufsichtsarbeiten an drei Tagen</h1>
    <p class="muted" style="max-width:68ch">Jeden Tag eine Klausur nach der Matrix deiner Schule, in zwei Varianten: erst A, dann B. Eine Arbeit ist verschlossen, bis du auf <b>Ich bin bereit</b> drückst. Dann läuft die Uhr. Wenn die Zeit um ist, schließt sich alles und die Arbeit kann korrigiert werden.</p>
    <p class="note info">${esc(mode)}${MODE === "public" && S.name ? ` Angemeldet als <b>${esc(S.name)}</b> · dein Code für ein anderes Gerät: <code>${esc(S.uid)}</code>` : ""}</p>
  </section>
  ${(DATA.pruefungen||[]).filter(e => e.probe).map(e => { const [st,cl] = status(e.id); return `<section class="oral" style="border-style:dashed"><div><span class="lbl">Zum Ausprobieren · ${e.dauerMin} Minuten · ${e.gesamtpunkte} Punkte</span><h2>${esc(e.titel)}</h2><p class="muted">Ein kurzer Probelauf mit drei Aufgaben. So siehst du, wie Sperre, Uhr, Abgabe und Korrektur funktionieren.</p></div><div class="row"><span class="pill ${cl}">${esc(st)}</span><a class="btn pri" style="text-decoration:none" href="#${e.id}">${cl==="go"?"Probelauf starten":"Ansehen"}</a></div></section>`; }).join("")}
  <div class="days">${DATA.matrix.klausuren.map(k => `
    <article class="day">
      <div class="head"><div><span class="lbl">Tag</span><div class="num">${k.tag}</div></div><div style="text-align:right"><b>Klausur ${k.klausur}</b><div class="muted" style="font-size:.85rem">${esc(k.person)} · ${esc(k.setting)}</div></div></div>
      ${["A","B"].map(v => { const id = "k"+k.klausur+v.toLowerCase(); const ex = EX[id]; const [st,cl] = ex ? status(id) : ["In Vorbereitung","wait"];
        const themen = k.varianten[v].flatMap(x => x.themen);
        return `<div class="var"><div class="vh"><b>Variante ${v}</b><span class="pill ${cl}">${esc(st)}</span></div>
          <ul>${[...new Set(themen)].map(t => `<li>${esc(t)}</li>`).join("")}</ul>
          ${ex ? `<a class="btn ${cl==="go"?"pri":"ghost"}" style="text-align:center;text-decoration:none" href="#${id}">${cl==="go"?"Zur Arbeit":cl==="run"?"Weiterschreiben":"Ansehen"}</a>` : `<span class="muted" style="font-size:.8rem">Wird gerade geschrieben.</span>`}
        </div>`; }).join("")}
    </article>`).join("")}
  </div>
  <section class="oral"><div><span class="lbl">Mündliche Prüfung · § 15 PflAPrV</span><h2>Mit der Prüferin sprechen</h2><p class="muted">Ein komplexer Fall zu den Kompetenzbereichen III, IV und V.</p></div><a class="btn pri" style="text-decoration:none" href="#muendlich">Zur mündlichen Prüfung</a></section>`;
}

/* ---------- Schriftliche Arbeit ---------- */
function renderExam(app, ex){
  const v = letzter(ex.id);
  if(v && v.status === "laeuft" && Date.now() >= v.ende){ v.status = "abgegeben"; v.abgegeben = v.ende; v.automatisch = true; save(v); }
  if(!v) return renderCover(app, ex);
  if(v.status === "laeuft") return renderWriting(app, ex, v);
  return renderSubmitted(app, ex, v);
}
function coverInfo(ex){
  const afb = {I:0,II:0,III:0}; ex.aufgaben.forEach(a => afb[a.afb] = (afb[a.afb]||0) + a.punkte);
  return `<dl>
    <dt>Klausur</dt><dd>${ex.probe ? "Probelauf" : `${ex.klausur}, Variante ${esc(ex.variante)} · Tag ${ex.tag}`}</dd>
    <dt>Fall</dt><dd>${esc(ex.person)} · ${esc(ex.setting)}</dd>
    <dt>Bearbeitungszeit</dt><dd>${ex.dauerMin} Minuten</dd>
    <dt>Punkte</dt><dd>${ex.gesamtpunkte} (AFB I ${afb.I} · II ${afb.II} · III ${afb.III})</dd>
    <dt>Aufgaben</dt><dd>${ex.aufgaben.length}</dd>
    <dt>Hilfsmittel</dt><dd>keine</dd>
    <dt>Bewertung</dt><dd>Übungsnote nach dem NRW-Schlüssel deiner Unterlagen, bestanden ab 50 %</dd></dl>`;
}
function exLabel(ex){ return ex.probe ? "Probelauf" : `Aufsichtsarbeit ${ex.klausur} · Variante ${esc(ex.variante)}`; }
function renderCover(app, ex){
  const n = versuche(ex.id).length;
  app.innerHTML = `<div style="height:16px"></div><article class="sheet cover">
    <div><span class="lbl">${exLabel(ex)}</span><h1>${esc(ex.titel)}</h1></div>
    ${coverInfo(ex)}
    <div class="locked"><div class="lock" aria-hidden="true">🔒</div>
      <p><b>Die Aufgaben sind verschlossen.</b><br><span class="muted">Leg dein Handy weg, nimm dir ${ex.dauerMin} Minuten Ruhe. Die Uhr startet, sobald du drückst, und läuft weiter, auch wenn du die Seite schließt.</span></p>
      <button class="btn pri big" id="ready">Ich bin bereit</button>
      ${n ? `<p class="muted" style="font-size:.85rem">Das wird dein ${n+1}. Versuch.</p>` : ""}
    </div>
    <a href="#start" class="muted">← zurück zur Übersicht</a>
  </article>`;
  $("#ready").onclick = async () => {
    $("#ready").disabled = true;
    const start = Date.now(); const nr = n + 1;
    await save({ key: ex.id + "-" + nr, pruefung: ex.id, versuch: nr, status: "laeuft", start, ende: start + ex.dauerMin*60000, antworten: {} });
    render();
  };
}
function taskHead(a){ return `<div class="meta"><span class="nr">${esc(a.nr)}</span><span class="op">${esc(a.operator)}</span><span class="pill">AFB ${esc(a.afb)}</span><span class="pts">${a.punkte} P.</span></div><p class="q">${esc(a.frage)}</p>`; }
function renderWriting(app, ex, v){
  app.innerHTML = `
  <div class="clock" id="clock" role="timer" aria-live="off"><div><span class="lbl" style="color:inherit;opacity:.8">Restzeit</span><div class="t" id="rest">${fmtT(v.ende-Date.now())}</div></div>
    <div class="bar" aria-hidden="true"><i id="bar"></i></div>
    <span class="saved" id="saved">gespeichert</span>
    <button class="btn" id="abgeben">Abgeben</button></div>
  <article class="sheet">
    <div><span class="lbl">${exLabel(ex)} · ${esc(ex.person)} · ${esc(ex.setting)}</span><h1>${esc(ex.titel)}</h1></div>
    <section><span class="lbl">Fallsituation</span><div class="fall">${ex.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div></section>
    ${ex.aufgaben.map(a => `<section class="task">${taskHead(a)}<label class="lbl" for="a-${esc(a.nr)}">Deine Antwort</label><textarea id="a-${esc(a.nr)}" data-nr="${esc(a.nr)}">${esc(v.antworten[a.nr]||"")}</textarea></section>`).join("")}
    <div class="row"><button class="btn pri big" id="abgeben2">Arbeit abgeben</button><span class="muted">Bis zum Ende der Zeit kannst du sie wieder öffnen.</span></div>
  </article>`;
  let t;
  const collect = () => app.querySelectorAll("textarea").forEach(ta => v.antworten[ta.dataset.nr] = ta.value);
  app.querySelectorAll("textarea").forEach(ta => ta.addEventListener("input", () => {
    v.antworten[ta.dataset.nr] = ta.value; $("#saved").textContent = "…";
    clearTimeout(t); t = setTimeout(async () => { await save(v); const s = $("#saved"); if(s) s.textContent = "gespeichert " + new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); }, 1500);
  }));
  const total = ex.dauerMin*60000;
  const upd = () => { const rest = v.ende - Date.now(); $("#rest").textContent = fmtT(rest); $("#bar").style.width = (100*Math.max(0,rest)/total) + "%"; $("#clock").classList.toggle("low", rest < 10*60000);
    if(rest <= 0){ clearInterval(tick); clearTimeout(t); collect(); v.status = "abgegeben"; v.abgegeben = v.ende; v.automatisch = true; save(v).then(render); flash("Die Zeit ist um. Deine Arbeit wurde abgegeben."); } };
  upd(); tick = setInterval(upd, 1000);
  const abg = async () => { clearTimeout(t); collect(); v.status = "abgegeben"; v.abgegeben = Date.now(); await save(v); render(); scrollTo(0,0); };
  $("#abgeben").onclick = abg; $("#abgeben2").onclick = abg;
}
function renderSubmitted(app, ex, v){
  const now = Date.now(); const offen = !v.endgueltig && !v.korrektur && now < v.ende;
  const all = versuche(ex.id);
  app.innerHTML = `<div style="height:16px"></div><article class="sheet">
    <div><span class="lbl">${exLabel(ex)} · Versuch ${v.versuch}${all.length>1?" von "+all.length:""}</span><h1>${esc(ex.titel)}</h1></div>
    <p class="note ${v.korrektur?"ok":"info"}">Abgegeben am ${fmtD(v.abgegeben)}${v.automatisch?" (Zeit abgelaufen)":""}. ${offen ? "Noch " + fmtT(v.ende-now) + " Zeit: du kannst sie wieder öffnen." : "Die Arbeit ist geschlossen."}</p>
    <div class="row">
      ${offen ? `<button class="btn" id="reopen">Wieder öffnen und weiterschreiben</button>` : ""}
      <button class="btn red" id="korr">${v.korrektur ? "Korrektur und Note ansehen" : v.korrekturWartet ? "Ist die Korrektur da? Neu laden" : "Korrigieren lassen und Note ansehen"}</button>
      <button class="btn ghost" id="copy">Antworten kopieren</button>
      <button class="btn ghost" id="again">Neuer Versuch</button>
    </div>
    ${v.korrekturWartet && !v.korrektur ? `<p class="note warn">Deine Arbeit ist bei der Prüferin angekommen (${fmtD(v.korrekturWartet)}). Die Korrektur und die Note erscheinen hier, sobald sie fertig sind. Bis dahin kannst du dich unten selbst kontrollieren.</p>` : ""}
    <div id="confirm"></div>
    <div id="out" class="stack"></div>
    <details><summary class="lbl" style="cursor:pointer">Fall und deine Antworten</summary><div class="stack" style="margin-top:12px">
      <div class="fall">${ex.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div>
      ${ex.aufgaben.map(a => `<section class="task">${taskHead(a)}<textarea readonly aria-label="Deine Antwort ${esc(a.nr)}">${esc(v.antworten[a.nr]||"")}</textarea></section>`).join("")}
    </div></details>
    <a href="#start" class="muted">← zurück zur Übersicht</a>
  </article>`;
  if(offen) $("#reopen").onclick = async () => { v.status = "laeuft"; await save(v); render(); };
  $("#copy").onclick = () => copyText(antwortText(ex, v));
  $("#again").onclick = () => { $("#confirm").innerHTML = `<div class="note warn row"><span>Neuen Versuch beginnen? Dieser Versuch bleibt in deinen Ergebnissen.</span><button class="btn pri" id="ja">Ja, neu beginnen</button><button class="btn ghost" id="nein">Abbrechen</button></div>`;
    $("#nein").onclick = () => $("#confirm").innerHTML = ""; $("#ja").onclick = () => renderCover(app, ex); };
  $("#korr").onclick = async () => {
    if(v.korrektur) return showKorrektur(ex, v);
    if(v.korrekturWartet && MODE === "public"){ await B.reload(); const d = S.docs[v.key]; if(d && d.korrektur) return render(); flash("Noch nicht korrigiert. Schau später wieder vorbei."); return showKorrektur(ex, v); }
    if(offen){ $("#confirm").innerHTML = `<div class="note warn row"><span>Damit schließt du die Arbeit endgültig, auch wenn noch Zeit ist.</span><button class="btn red" id="ja">Endgültig abgeben und korrigieren</button><button class="btn ghost" id="nein">Abbrechen</button></div>`;
      $("#nein").onclick = () => $("#confirm").innerHTML = ""; $("#ja").onclick = async () => { v.endgueltig = true; await save(v); $("#confirm").innerHTML = ""; korrigieren(ex, v); }; }
    else korrigieren(ex, v);
  };
  if(v.korrektur || v.korrekturWartet) showKorrektur(ex, v);
}
function antwortText(ex, v){ return `${ex.probe ? "Probelauf" : `Klausur ${ex.klausur} Variante ${ex.variante}`} — ${ex.titel} — Versuch ${v.versuch}, abgegeben ${fmtD(v.abgegeben)}\n\n` + ex.aufgaben.map(a => `${a.nr} ${a.operator} (${a.punkte} P.)\n${a.frage}\n→ ${v.antworten[a.nr]||"(leer)"}\n`).join("\n"); }
async function copyText(t){ try{ await navigator.clipboard.writeText(t); flash("Kopiert."); }catch{ const ta = document.createElement("textarea"); ta.value = t; $("#out").prepend(ta); ta.select(); flash("Text markiert: jetzt kopieren."); } }
async function korrigieren(ex, v){
  const out = $("#out");
  out.innerHTML = `<p class="note info">Die Prüferin liest deine Arbeit … Das dauert meist ein bis drei Minuten. Du kannst die Seite offen lassen.</p>`;
  $("#korr").disabled = true;
  try{
    v.korrektur = await B.korrigieren(ex, v); v.endgueltig = true;
    if(MODE !== "public") await save(v); else { S.docs[v.key] = v; localPut(v); }
    render();
  }catch(e){
    $("#korr").disabled = false;
    if(e && e.code === "wartet"){ v.korrekturWartet = Date.now(); v.endgueltig = true; S.docs[v.key] = v; localPut(v); return render(); }
    out.innerHTML = `<p class="note warn">${esc(kiFehler(e))} Unten steht der Erwartungshorizont zum Selbstvergleich. Mit <b>Antworten kopieren</b> kannst du deine Arbeit auch weiterschicken.</p>`;
    showKorrektur(ex, v, true);
  }
}
function showKorrektur(ex, v, anhaengen){
  const k = v.korrektur; const out = $("#out");
  const kmap = k ? Object.fromEntries(k.aufgaben.map(x => [x.nr, x])) : {};
  const [n, nt] = k ? note(k.prozent) : [null,null];
  const selbst = !k;
  const html = (selbst ? `<section class="grade" style="border-color:var(--blue)"><div><span class="lbl">Selbstkontrolle</span><div class="n" id="sk-note" style="color:var(--blue)">–</div></div><div class="s"><div><b id="sk-sum">0</b> von ${ex.gesamtpunkte} Punkten</div><div class="muted" style="font-size:.85rem;max-width:40ch">Hake bei jeder Aufgabe die Punkte ab, die wirklich in deiner Antwort stehen. Das ist deine eigene Schätzung, nicht die Korrektur der Prüferin.</div></div></section>` : "") + (k ? `
    <section class="grade"><div><span class="lbl">Übungsnote</span><div class="n">${n}</div><div>${nt}</div></div>
      <div class="s"><div><b>${komma(k.summe)}</b> von ${ex.gesamtpunkte} Punkten · ${komma(k.prozent)} %</div><div>${k.prozent>=50?"bestanden":"nicht bestanden"} (Grenze 50 %)</div><div class="muted" style="font-size:.85rem">korrigiert von ${esc(k.von)} am ${fmtD(k.am)}</div></div>
      <div class="pen" style="flex:1 1 260px">${esc(k.gesamt)}${k.gesamtFr?`<div class="muted" style="font-family:var(--f-ui);font-size:.9rem;margin-top:4px">🇫🇷 ${esc(k.gesamtFr)}</div>`:""}</div>
    </section>
    ${(k.staerken||[]).length||(k.ueben||[]).length ? `<div class="cmp"><div><span class="lbl">Das kannst du</span><ul>${(k.staerken||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div><div><span class="lbl">Das übst du als Nächstes</span><ul>${(k.ueben||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div></div>`:""}
    <p class="src">Die Note ist eine Übungsnote nach dem NRW-Notenschlüssel in deinen Unterlagen (ressources/klausur-konventionen.md). Die amtliche Bewertung der echten Prüfung steht nicht in deinen Unterlagen.</p>` : "") +
    ex.aufgaben.map(a => { const x = kmap[a.nr];
      return `<section class="task">${taskHead(a)}
        <div class="cmp"><div><span class="lbl">Deine Antwort</span><div class="yours">${esc(v.antworten[a.nr]||"(leer)")}</div></div>
        <div><span class="lbl">Erwartungshorizont</span><ul>${a.erwartung.map((e,i) => { const hit = x && x.getroffen.includes(i); return `<li class="${hit?"hit":""}">${selbst ? `<label><input type="checkbox" class="sk" data-a="${esc(a.nr)}" data-max="${a.punkte}" data-p="${e.punkte}"> ` : hit ? "✓ " : ""}${esc(e.text)} <span class="muted">(${e.punkte} P.)</span>${selbst ? "</label>" : ""}${e.quelle?`<div class="src">${esc(e.quelle)}</div>`:""}</li>`; }).join("")}</ul>${a.hinweis?`<p class="src" style="margin-top:6px">${esc(a.hinweis)}</p>`:""}</div></div>
        ${x ? `<div class="pen"><span class="sc">${komma(x.punkte)} / ${a.punkte}</span> — ${esc(x.kommentar)}${x.fr?`<div class="muted" style="font-family:var(--f-ui);font-size:.9rem">🇫🇷 ${esc(x.fr)}</div>`:""}</div>
          ${x.sprache.length ? `<div class="lang"><span class="lbl">Sprache</span><ul>${x.sprache.map(s => `<li><s>${esc(s.falsch)}</s> → <b>${esc(s.richtig)}</b> <span class="muted">(Baustelle ${esc(s.baustelle)})</span></li>`).join("")}</ul></div>` : ""}` : ""}
      </section>`; }).join("") +
    `<details><summary class="lbl" style="cursor:pointer">Quellen und Hinweise zu dieser Klausur</summary><div class="stack" style="margin-top:10px;font-size:.88rem">
      <div><b>Quellen (deine Unterlagen)</b><ul>${(ex.quellen||[]).map(q=>`<li>${esc(q)}</li>`).join("")}</ul></div>
      ${(ex.fiktiv||[]).length?`<div><b>Erfunden für die Übung</b><ul>${ex.fiktiv.map(q=>`<li>${esc(q)}</li>`).join("")}</ul></div>`:""}
      ${(ex.luecken||[]).length?`<div><b>Lücken</b><ul>${ex.luecken.map(q=>`<li>${esc(q)}</li>`).join("")}</ul></div>`:""}
    </div></details>`;
  if(anhaengen) out.insertAdjacentHTML("beforeend", html); else out.innerHTML = html;
  if(selbst){
    const sk = LS.get("selbst-" + v.key) || {};
    const boxes = [...out.querySelectorAll("input.sk")];
    boxes.forEach((b, i) => { b.checked = !!sk[i]; b.onchange = () => { sk[i] = b.checked; LS.set("selbst-" + v.key, sk); calc(); }; });
    const calc = () => { const per = {}; boxes.forEach(b => { if(b.checked){ per[b.dataset.a] = Math.min(Number(b.dataset.max), (per[b.dataset.a]||0) + Number(b.dataset.p)); } });
      const sum = Object.values(per).reduce((a,b) => a+b, 0); const p = 100*sum/ex.gesamtpunkte;
      $("#sk-sum").textContent = komma(sum); $("#sk-note").textContent = sum ? note(p)[0] : "–"; };
    calc();
  }
}

/* ---------- Mündlich ---------- */
function renderOralList(app){
  const list = DATA.muendlich || [];
  app.innerHTML = `<section class="intro"><span class="lbl">Mündliche Prüfung · § 15 PflAPrV</span><h1>Ein Fall, eine Prüferin, Kompetenzbereiche III, IV und V</h1>
  <p class="muted" style="max-width:68ch">Du bereitest den Fall vor. Dann stellt dir die Prüferin Fragen, eine nach der anderen, und fragt nach. Am Ende bekommst du eine Rückmeldung zu Inhalt und Sprache. Schreib deine Antworten oder diktiere sie mit dem Mikrofon deiner Tastatur.</p></section>
  <div class="list">${list.map(o => `<div class="it"><div><b>${esc(o.titel)}</b><div class="muted" style="font-size:.88rem">${esc(o.person)} · ${esc(o.setting)} · KB ${o.kb.join(", ")}</div></div><a class="btn pri" style="text-decoration:none" href="#${o.id}">Öffnen</a></div>`).join("") || `<p class="muted">Noch kein Fall da.</p>`}</div>`;
}
function renderOral(app, o){
  const key = "oral-" + o.id;
  const st = LS.get(key) || { phase:"vorbereitung", notizen:"", chat:[] };
  const persist = () => LS.set(key, st);
  if(st.phase === "vorbereitung"){
    app.innerHTML = `<div style="height:16px"></div><article class="sheet">
      <div><span class="lbl">Mündliche Prüfung · Vorbereitung</span><h1>${esc(o.titel)}</h1><p class="muted">${esc(o.person)} · ${esc(o.setting)} · Kompetenzbereiche ${o.kb.join(", ")}</p></div>
      ${st.vorbStart ? `<div class="clock" style="position:static;border-radius:6px" id="clock"><div><span class="lbl" style="color:inherit;opacity:.8">Vorbereitungszeit</span><div class="t" id="rest"></div></div></div>` : ""}
      ${!st.vorbStart ? `<div class="locked"><div class="lock" aria-hidden="true">🔒</div><p><b>Der Fall ist verschlossen.</b><br><span class="muted">Vorbereitungszeit: <input id="vmin" type="number" min="5" max="60" value="${st.vorbMin||20}" style="width:4em;font:inherit"> Minuten. Die echte Vorbereitungszeit steht nicht in deinen Unterlagen; frag deine Schule.</span></p><button class="btn pri big" id="ready">Ich bin bereit</button></div>` : `
      <section><span class="lbl">Fallsituation</span><div class="fall">${o.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div></section>
      <section class="stack"><span class="lbl">Bereite vor</span><ul style="margin:0">${o.vorbereitung.map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <label class="lbl" for="notes">Deine Notizen (Stichworte)</label><textarea id="notes">${esc(st.notizen)}</textarea>
      <button class="btn pri big" id="go">Prüfung beginnen</button>`}
      <a href="#muendlich" class="muted">← zurück</a></article>`;
    if(!st.vorbStart){ $("#ready").onclick = () => { st.vorbMin = Math.max(5, Math.min(60, Number($("#vmin").value)||20)); st.vorbStart = Date.now(); persist(); render(); }; return; }
    $("#notes").oninput = e => { st.notizen = e.target.value; persist(); };
    const upd = () => { const rest = st.vorbStart + st.vorbMin*60000 - Date.now(); $("#rest").textContent = rest > 0 ? fmtT(rest) : "Zeit um — beginne die Prüfung"; $("#clock").classList.toggle("low", rest < 2*60000); };
    upd(); tick = setInterval(upd, 1000);
    $("#go").onclick = () => { st.phase = "pruefung"; st.pStart = Date.now(); persist(); render(); };
    return;
  }
  const ended = st.phase === "ende";
  app.innerHTML = `<div style="height:16px"></div><article class="sheet">
    <div class="row" style="justify-content:space-between"><div><span class="lbl">Mündliche Prüfung · ${esc(o.titel)}</span><h2>Gespräch mit der Prüferin</h2></div><span class="pill run" id="dauer"></span></div>
    <details><summary class="lbl" style="cursor:pointer">Fall und Notizen</summary><div class="fall" style="margin-top:8px">${o.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div>${st.notizen?`<p class="muted" style="white-space:pre-wrap;margin-top:8px">${esc(st.notizen)}</p>`:""}</details>
    <div class="chat" id="chat"></div>
    ${ended ? "" : `<label class="lbl" for="ans">Deine Antwort</label><textarea id="ans" style="min-height:100px" placeholder="Schreib oder diktiere deine Antwort …"></textarea>
    <div class="row"><button class="btn pri" id="send">Antwort senden</button><button class="btn ghost" id="vor">🔊 Frage vorlesen</button><button class="btn red" id="stop">Prüfung beenden und bewerten</button></div>`}
    <div id="eval" class="stack"></div>
    <div class="row"><button class="btn ghost" id="reset">Fall neu beginnen</button><a href="#muendlich" class="muted">← zurück</a></div>
  </article>`;
  const chat = $("#chat");
  const draw = () => { chat.innerHTML = st.chat.map(m => `<div class="msg ${m.role==="assistant"?"p":"k"}"><span class="who">${m.role==="assistant"?"Prüferin":"Du"}</span>${esc(m.content.replace("[ENDE]",""))}</div>`).join(""); };
  draw();
  const upd = () => { $("#dauer").textContent = fmtT(Date.now() - st.pStart) + " min"; }; upd(); tick = setInterval(upd, 1000);
  const speak = t => { try{ speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace("[ENDE]","")); u.lang = "de-DE"; u.rate = .92; speechSynthesis.speak(u); }catch{} };
  const offlineFrage = () => {
    const gestellt = st.chat.filter(m => m.role === "assistant").length;
    if(gestellt === 0) return "Guten Tag. Stellen Sie bitte den Fall kurz vor.";
    const f = o.fragen[gestellt - 1];
    return f ? f.frage : "Vielen Dank. Die Prüfung ist beendet. [ENDE]";
  };
  const ask = async () => {
    if(st.offline){ const text = offlineFrage(); st.chat.push({role:"assistant", content:text}); persist(); draw(); speak(text); if(text.includes("[ENDE]")) bewerten(); return; }
    const bubble = document.createElement("div"); bubble.className = "msg p"; bubble.innerHTML = `<span class="who">Prüferin</span><span>…</span>`; chat.append(bubble);
    $("#send") && ($("#send").disabled = true);
    try{
      const text = await B.pruefer(o, st, t => bubble.lastChild.textContent = t.replace("[ENDE]",""));
      st.chat.push({role:"assistant", content:text}); persist(); speak(text);
      if(text.includes("[ENDE]")) return bewerten();
    }catch(e){
      if(e && e.code === "ki_aus"){ bubble.remove(); st.offline = true; persist(); flash("Die Prüferin stellt die Fragen aus dem Fall. Die Bewertung kommt später."); return ask(); }
      bubble.lastChild.textContent = kiFehler(e) + " Sende deine Antwort noch einmal."; }
    finally{ $("#send") && ($("#send").disabled = false); }
  };
  const showOralEval = r => { $("#eval").innerHTML = `<section class="grade"><div><span class="lbl">Übungsnote</span><div class="n">${esc(r.note)}</div></div><div class="pen" style="flex:1 1 260px">${(r.kb||[]).map(k => `<div><b>KB ${esc(k.kb)}:</b> ${esc(k.urteil)}${(k.fehlt||[]).length?` <span class="muted" style="font-family:var(--f-ui);font-size:.9rem">Fehlt: ${k.fehlt.map(esc).join("; ")}</span>`:""}</div>`).join("")}<div class="muted" style="font-family:var(--f-ui);font-size:.9rem;margin-top:6px">🇫🇷 ${esc(r.fr||"")}</div></div></section>
    <div class="cmp"><div><span class="lbl">Das kannst du</span><ul>${(r.staerken||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div><div><span class="lbl">Das übst du als Nächstes</span><ul>${(r.ueben||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div></div>
    ${(r.sprache||[]).length?`<div class="lang"><span class="lbl">Sprache</span><ul>${r.sprache.map(s => `<li><s>${esc(s.falsch)}</s> → <b>${esc(s.richtig)}</b> <span class="muted">(Baustelle ${esc(s.baustelle)})</span></li>`).join("")}</ul></div>`:""}
    <details><summary class="lbl" style="cursor:pointer">Erwartungshorizont</summary><ol>${o.fragen.map(f => `<li><b>[KB ${esc(f.kb)}] ${esc(f.frage)}</b><ul>${f.erwartung.map(e => `<li>${esc(e.text)}<div class="src">${esc(e.quelle||"")}</div></li>`).join("")}</ul></li>`).join("")}</ol></details>`; };
  const bewerten = async () => {
    st.phase = "ende"; persist();
    $("#eval").innerHTML = `<p class="note info">Die Prüferin bewertet das Gespräch … (ein bis drei Minuten)</p>`;
    try{ const r = await B.oralEval(o, st); st.bewertung = r; persist(); showOralEval(r); }
    catch(e){
      if(e && e.code === "wartet_oral"){ st.wartet = Date.now(); persist(); $("#eval").innerHTML = `<p class="note warn">${esc(kiFehler(e))}</p><details open><summary class="lbl" style="cursor:pointer">Erwartungshorizont zum Selbstvergleich</summary><ol>${o.fragen.map(f => `<li><b>[KB ${esc(f.kb)}] ${esc(f.frage)}</b><ul>${f.erwartung.map(x => `<li>${esc(x.text)}<div class="src">${esc(x.quelle||"")}</div></li>`).join("")}</ul></li>`).join("")}</ol></details><button class="btn ghost" id="retry">Ist die Bewertung da? Neu laden</button>`; $("#retry").onclick = bewerten; return; }
      $("#eval").innerHTML = `<p class="note warn">${esc(kiFehler(e))}</p><button class="btn red" id="retry">Noch einmal bewerten</button>`; $("#retry").onclick = bewerten; }
  };
  $("#reset").onclick = () => { LS.set(key, null); render(); };
  if(ended){ if(st.bewertung) showOralEval(st.bewertung); else bewerten(); return; }
  $("#vor").onclick = () => { const last = [...st.chat].reverse().find(m => m.role === "assistant"); if(last) speak(last.content); };
  $("#send").onclick = () => { const t = $("#ans").value.trim(); if(!t) return; st.chat.push({role:"user", content:t}); persist(); $("#ans").value = ""; draw(); ask(); };
  $("#stop").onclick = () => bewerten();
  if(!st.chat.length) ask();
}

/* ---------- Ergebnisse ---------- */
function renderResults(app){
  const rows = Object.values(S.docs).filter(d => EX[d.pruefung]).sort((a,b) => (b.start||0) - (a.start||0));
  app.innerHTML = `<section class="intro"><span class="lbl">Ergebnisse</span><h1>Deine Versuche</h1><p class="muted">Jeder Versuch bleibt hier stehen. So siehst du, ob du besser wirst.</p></section>
  ${rows.length ? `<div class="tbl"><table><thead><tr><th>Datum</th><th>Klausur</th><th>Versuch</th><th>Punkte</th><th>Note</th><th></th></tr></thead><tbody>${rows.map(d => { const ex = EX[d.pruefung]; const k = d.korrektur;
    return `<tr><td>${fmtD(d.start)}</td><td>${ex.probe ? "Probelauf" : ex.klausur + esc(ex.variante)} · ${esc(ex.titel)}</td><td>${d.versuch}</td><td style="font-variant-numeric:tabular-nums">${k ? komma(k.summe) + " / " + ex.gesamtpunkte : d.status==="laeuft"?"läuft":"nicht korrigiert"}</td><td>${k ? note(k.prozent)[0] : "–"}</td><td><a href="#${ex.id}">öffnen</a></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="note info">Noch kein Versuch. Fang mit dem Probelauf an.</p>`}`;
}

/* ---------- Abgaben (Besitzerin) ---------- */
async function renderAdmin(app){
  if(MODE === "public" && !LS.get("examen-admin")){
    app.innerHTML = `<section class="intro"><span class="lbl">Abgaben</span><h1>Nur für die Besitzerin</h1></section><form class="sheet" id="af" style="max-width:520px"><label class="lbl" for="tok">Zugangsschlüssel</label><input id="tok" style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"><button class="btn pri">Öffnen</button></form>`;
    $("#af").onsubmit = e => { e.preventDefault(); LS.set("examen-admin", $("#tok").value.trim()); S.owner = true; $("#tab-abgaben").hidden = false; render(); };
    return;
  }
  if(MODE !== "public" && !S.owner){ app.innerHTML = `<p class="note warn" style="margin-top:16px">Diese Ansicht sieht nur die Besitzerin der Seite.</p>`; return; }
  app.innerHTML = `<section class="intro"><span class="lbl">Abgaben</span><h1>Alle Abgaben</h1><p class="muted">Die Arbeiten aller Personen, die die Seite benutzen.</p></section><div id="adm" class="list"><p class="muted">Lade …</p></div>`;
  try{
    const rows = await B.adminList();
    $("#adm").innerHTML = rows.length ? rows.sort((a,b)=>(b.geaendert||0)-(a.geaendert||0)).map(r => { const ex = EX[r.pruefung]; return `<div class="it"><div><b>${esc(r.name||"Person")}</b> · ${ex ? (ex.probe ? "Probelauf" : "Klausur " + ex.klausur + ex.variante) : esc(r.pruefung||r.fall||"")} · ${r.versuch ? "Versuch " + r.versuch : "mündlich"}<div class="muted" style="font-size:.85rem">${r.status==="laeuft"?"läuft":"abgegeben "+fmtD(r.abgegeben||r.am)}${r.korrektur?" · Note "+r.korrektur.note+" ("+komma(r.korrektur.prozent)+" %)":""}${r.bewertung?" · Note "+esc(r.bewertung.note):""}</div></div></div>`; }).join("") : `<p class="muted">Noch keine Abgaben.</p>`;
  }catch(e){ $("#adm").innerHTML = `<p class="note warn">Konnte die Abgaben nicht laden (${esc(e.code||"Fehler")}).</p>`; if(MODE === "public") LS.set("examen-admin", null); }
}

boot();
