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
const pName = () => S.pname || PRUEFERIN_STANDARD;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
/* Stimme der Prüferin: ElevenLabs über /api/tts (öffentliche Seite), sonst die Stimme des Geräts */
const AUDIO = { el: null, url: null };
function stilleWav(){ // 0,1 s Stille als WAV, um den Lautsprecher im Klick freizuschalten
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0,"RIFF"); v.setUint32(4, 36 + n, true); w(8,"WAVE"); w(12,"fmt "); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,8000,true); v.setUint32(28,8000,true); v.setUint16(32,1,true); v.setUint16(34,8,true); w(36,"data"); v.setUint32(40,n,true);
  for(let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let b = ""; new Uint8Array(buf).forEach(x => b += String.fromCharCode(x)); return "data:audio/wav;base64," + btoa(b);
}
function audioFreischalten(){ // im Klick aufrufen, sonst spielt iOS später nichts ab
  if(MODE !== "public" || !S.stimme) return;
  if(!AUDIO.el){ AUDIO.el = new Audio(); AUDIO.el.setAttribute("playsinline", ""); }
  try{ AUDIO.el.src = stilleWav(); AUDIO.el.play().catch(() => {}); }catch{}
}
async function sprechen(text){
  const t = String(text||"").replace("[ENDE]", "").trim(); if(!t) return;
  try{ speechSynthesis.cancel(); }catch{}
  if(MODE === "public" && S.stimme){
    try{
      const r = await fetch("/api/tts", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ text: t }) });
      if(!r.ok) throw new Error(r.status);
      const b = await r.blob(); if(AUDIO.url) URL.revokeObjectURL(AUDIO.url); AUDIO.url = URL.createObjectURL(b);
      if(!AUDIO.el){ AUDIO.el = new Audio(); AUDIO.el.setAttribute("playsinline", ""); }
      AUDIO.el.src = AUDIO.url; AUDIO.el.volume = 1; AUDIO.el.playbackRate = 1; await AUDIO.el.play(); return;
    }catch(e){ console.warn("tts", e); }
  }
  try{ const u = new SpeechSynthesisUtterance(t); u.lang = "de-DE"; u.rate = .85; u.volume = 1; speechSynthesis.speak(u); }catch{}
}
function stummschalten(){ try{ speechSynthesis.cancel(); }catch{} try{ AUDIO.el && AUDIO.el.pause(); }catch{} }

const S = { mode:"local", docs:{}, uid:null, name:"", owner:false, ki:false };
/* auf der öffentlichen Seite gehört alles Gespeicherte zur Person (zu ihrem Namen) */
const lsKey = base => MODE === "public" && S.uid ? base + "-" + S.uid : base;
function localAll(){ return LS.get(lsKey("examen-versuche-v1")) || {}; }
function localPut(doc){ const all = localAll(); all[doc.key] = doc; LS.set(lsKey("examen-versuche-v1"), all); }
/* Name → feste Kennung: wer denselben Namen wieder eingibt, findet seine Arbeit wieder (auf jedem Gerät) */
const nameNorm = n => String(n||"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
async function uidAusName(n){ const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("examen-pflege:" + nameNorm(n))); return "u" + Array.from(new Uint8Array(h), b => b.toString(16).padStart(2,"0")).join("").slice(0, 24); }
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
        this.db.collection("abgaben/" + S.uid + "/muendlich").onSnapshot(snap => { const o = {}; snap.docs.forEach(d => o[d.id] = { id:d.id, ...d.data() }); S.oral = o; }, () => {});
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
    const r = await this.sample.json(prueferPrompt(ex, v.antworten, pName()), { modelTier:"complex", cache:false });
    return auswerten(ex, r, pName() + " (Prüferin)");
  },
  async pruefer(o, st, onText){
    if(!this.sample) throw { code:"no_ai" };
    const turns = [{role:"user", content: oralRules(o, st.notizen, st.planung, pName())}, ...st.chat.slice(-30)];
    if(turns[turns.length-1].role !== "user") turns.push({role:"user", content:"(weiter)"});
    const { text } = await this.sample(turns, { cache:false, onText: ({text}) => onText(text) });
    return text;
  },
  async oralEval(o, st){
    if(!this.sample) throw { code:"no_ai" };
    const r = await this.sample.json(oralEvalPrompt(o, st.chat, st.planung, pName()), { modelTier:"complex", cache:false });
    if(S.mode === "db"){ try{ await this.db.doc("abgaben/" + S.uid + "/muendlich/" + o.id + "-" + (st.sid || Date.now())).set({ fall:o.id, start:st.vorbStart||st.pStart||null, chat:st.chat, notizen:st.notizen, planung:st.planung||[], bewertung:r, am:Date.now() }); }catch(e){} }
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
    S.name = LS.get("examen-name") || ""; S.ki = true; S.owner = !!LS.get("examen-admin");
    try{ const st = await this.call("/api/status"); S.stimme = !!st.stimme; S.kiServer = !!st.ki; if(st.name) S.pname = st.name; }catch{}
    S.uid = S.name ? await uidAusName(S.name) : null;
    S.docs = localAll();
    if(S.uid) await this.reload();
  },
  async reload(){
    if(!S.uid) return;
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
  async pruefer(o, st, onText){ const r = await this.post("/api/pruefer", { uid:S.uid, fall:o.id, notizen:st.notizen, planung:st.planung||[], chat:st.chat.slice(-30) }); onText(r.text); return r.text; },
  async oralEval(o, st){
    const sid = st.sid || (st.sid = String(Date.now())); LS.set(lsKey("oral-" + o.id), st);
    await this.reload();
    const vorh = S.oral && S.oral[o.id + "-" + sid];
    if(vorh && vorh.bewertung) return vorh.bewertung;
    if(vorh && vorh.wartet) throw { code:"wartet_oral" };
    const t = Date.now();
    await this.post("/api/muendlich", { uid:S.uid, name:S.name, fall:o.id, sid, t, start: st.vorbStart || st.pStart || null, notizen:st.notizen, planung:st.planung||[], chat:st.chat.slice(-60) });
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
  if(MODE !== "public") render();
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
  const tab = r === "muendlich" || OR[r] ? "muendlich" : ["ergebnisse","abgaben","tipps"].includes(r) ? r : (r.startsWith("v-") || r.startsWith("h-")) ? "ergebnisse" : "start";
  $("#tab-" + tab)?.setAttribute("aria-current","page");
  const app = $("#app");
  if(r === "abgaben") return renderAdmin(app);
  if(MODE === "public" && !S.name) return renderName(app);
  if(EX[r]) return renderExam(app, EX[r]);
  if(r.startsWith("v-") && S.docs[r.slice(2)] && EX[S.docs[r.slice(2)].pruefung]){ const d = S.docs[r.slice(2)]; return renderSubmitted(app, EX[d.pruefung], d); }
  if(r.startsWith("h-")){ const d = oralVerlauf().find(x => x.id === r.slice(2)); if(d) return renderOralVerlauf(app, d); }
  if(OR[r]) return renderOral(app, OR[r]);
  if(r === "muendlich") return renderOralList(app);
  if(r === "ergebnisse") return renderResults(app);
  if(r === "tipps") return renderTipps(app);
  renderStart(app);
}

/* ---------- Name (öffentliche Seite) ---------- */
function renderName(app){
  app.innerHTML = `<section class="intro"><span class="lbl">Examen Pflege · Übungsprüfung</span><h1>Willkommen</h1>
    <p class="muted" style="max-width:68ch">Hier übst du das schriftliche und das mündliche Examen. Du brauchst kein Konto. Gib deinen Namen ein. <b>Wenn du später wieder denselben Namen eingibst — auf diesem oder einem anderen Gerät —, geht deine Arbeit weiter</b> und du siehst alles, was du schon gemacht hast.</p></section>
    <form class="sheet" id="nf" style="max-width:520px">
      <label class="lbl" for="nm">Dein Vor- und Nachname</label><input id="nm" autocomplete="name" required style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)">
      <p class="muted" style="font-size:.85rem">Schreib deinen Namen jedes Mal gleich (Groß- und Kleinschreibung ist egal). Wer deinen Namen kennt, kann deine Arbeit sehen — benutze deshalb deinen vollen Namen.</p>
      <button class="btn pri big">Weiter</button>
    </form>`;
  $("#nf").onsubmit = async e => { e.preventDefault(); const n = $("#nm").value.trim().replace(/\s+/g, " "); if(n.length < 2) return;
    const alt = localAll();                       // was vorher ohne Namen auf diesem Gerät lag
    S.name = n; LS.set("examen-name", n); S.uid = await uidAusName(n);
    const neu = localAll(); for(const k in alt) if(!neu[k]) localPut(alt[k]);
    S.docs = localAll(); await B.reload(); render(); };
}
function abmelden(){ LS.set("examen-name", null); S.name = ""; S.uid = null; S.docs = {}; S.oral = {}; location.hash = "#start"; render(); }

/* ---------- Start ---------- */
function status(id){
  const v = letzter(id);
  if(!v) return ["Offen","go"];
  if(v.status === "laeuft") return Date.now() < v.ende ? ["Läuft","run"] : ["Abgegeben","done"];
  if(v.korrektur){ const p = v.korrektur.prozent; return ["Note " + note(p)[0] + " · " + komma(p) + " %","done"]; }
  return ["Abgegeben","done"];
}
function renderStart(app){
  setTimeout(() => { const b = $("#logout"); if(b) b.onclick = abmelden; }, 0);
  const mode = S.mode === "db" || S.mode === "api" ? "Deine Abgaben werden gespeichert und korrigiert." : "Speicher nicht verbunden: Antworten bleiben vorerst auf diesem Gerät.";
  app.innerHTML = `
  <section class="intro">
    <span class="lbl">Schriftliche Prüfung · § 14 PflAPrV</span>
    <h1>Drei Aufsichtsarbeiten an drei Tagen</h1>
    <p class="muted" style="max-width:68ch">Jeden Tag eine Klausur nach der Matrix deiner Schule, in zwei Varianten: erst A, dann B. Eine Arbeit ist verschlossen, bis du auf <b>Ich bin bereit</b> drückst. Dann läuft die Uhr. Wenn die Zeit um ist, schließt sich alles und die Arbeit kann korrigiert werden.</p>
    <p class="note info">${esc(mode)}</p>
    ${MODE === "public" && S.name ? `<p class="row" style="gap:8px 12px">Angemeldet als <b>${esc(S.name)}</b><a href="#ergebnisse">Alles, was du gemacht hast</a><button class="btn ghost" id="logout" type="button">Anderer Name</button></p>` : ""}
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
/* ---------- Verlauf der mündlichen Prüfungen ---------- */
const ORAL_H = "oral-historie-v1";
function oralArchiv(o, st, status){
  if(!st || !st.chat || !st.chat.length) return;
  const sid = st.sid || (st.sid = String(st.pStart || Date.now()));
  const all = LS.get(lsKey(ORAL_H)) || {};
  const id = o.id + "-" + sid;
  all[id] = { id, fall:o.id, start: st.vorbStart || st.pStart || Date.now(), ende: Date.now(), chat: st.chat, notizen: st.notizen || "", planung: st.planung || [], bewertung: st.bewertung || null, wartet: st.wartet || null, status: st.bewertung ? "bewertet" : status };
  LS.set(lsKey(ORAL_H), all);
}
function oralVerlauf(){
  const all = { ...(LS.get(lsKey(ORAL_H)) || {}) };
  for(const [id, d] of Object.entries(S.oral || {})){
    if(!d) continue;
    const loc = all[id] || {};
    all[id] = { ...loc, ...d, id, fall: d.fall || loc.fall, start: loc.start || d.start || d.am, bewertung: d.bewertung || loc.bewertung || null, status: d.bewertung ? "bewertet" : (loc.status || (d.wartet ? "wartet" : "")) };
  }
  return Object.values(all).filter(d => OR[d.fall]).sort((a,b) => (b.start||0) - (a.start||0));
}
function oralEvalHtml(o, r){
  return `<section class="grade"><div><span class="lbl">Übungsnote</span><div class="n">${esc(r.note)}</div></div><div class="pen" style="flex:1 1 260px">${(r.kb||[]).map(k => `<div><b>KB ${esc(k.kb)}:</b> ${esc(k.urteil)}${(k.fehlt||[]).length?` <span class="muted" style="font-family:var(--f-ui);font-size:.9rem">Fehlt: ${k.fehlt.map(esc).join("; ")}</span>`:""}</div>`).join("")}${r.planung ? `<div><b>Pflegeplanung:</b> ${esc(r.planung)}</div>` : ""}<div class="muted" style="font-family:var(--f-ui);font-size:.9rem;margin-top:6px">🇫🇷 ${esc(r.fr||"")}</div></div></section>
    <div class="cmp"><div><span class="lbl">Das kannst du</span><ul>${(r.staerken||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div><div><span class="lbl">Das übst du als Nächstes</span><ul>${(r.ueben||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div></div>
    ${(r.sprache||[]).length?`<div class="lang"><span class="lbl">Sprache</span><ul>${r.sprache.map(s => `<li><s>${esc(s.falsch)}</s> → <b>${esc(s.richtig)}</b> <span class="muted">(Baustelle ${esc(s.baustelle)})</span></li>`).join("")}</ul></div>`:""}`;
}
function horizontHtml(o, open){ return `<details${open?" open":""}><summary class="lbl" style="cursor:pointer">Erwartungshorizont</summary><ol>${o.fragen.map(f => `<li><b>[KB ${esc(f.kb)}] ${esc(f.frage)}</b><ul>${f.erwartung.map(e => `<li>${esc(e.text)}<div class="src">${esc(e.quelle||"")}</div></li>`).join("")}</ul></li>`).join("")}</ol></details>`; }
function planungHtml(planung){ const rows = (planung||[]).filter(r => r.p||r.z||r.m||r.b); return rows.length ? `<div class="tbl"><table><thead><tr><th>Pflegeproblem</th><th>Pflegeziele</th><th>Pflegemaßnahmen</th><th>Begründungen</th></tr></thead><tbody>${rows.map(r => `<tr><td style="white-space:pre-wrap">${esc(r.p)}</td><td style="white-space:pre-wrap">${esc(r.z)}</td><td style="white-space:pre-wrap">${esc(r.m)}</td><td style="white-space:pre-wrap">${esc(r.b)}</td></tr>`).join("")}</tbody></table></div>` : ""; }
function oralStatus(d){ return d.bewertung ? ["Note " + d.bewertung.note, "done"] : d.status === "abgebrochen" ? ["abgebrochen", "wait"] : ["Bewertung folgt", "run"]; }
function renderOralVerlauf(app, d){
  const o = OR[d.fall];
  const [st, cl] = oralStatus(d);
  app.innerHTML = `<div style="height:16px"></div><article class="sheet">
    <div class="row" style="justify-content:space-between"><div><span class="lbl">Verlauf · Mündliche Prüfung · ${fmtD(d.start)}</span><h1>${esc(o.titel)}</h1></div><span class="pill ${cl}">${esc(st)}</span></div>
    <details><summary class="lbl" style="cursor:pointer">Fallsituation</summary><div class="fall" style="margin-top:8px">${o.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div></details>
    ${d.notizen ? `<section class="stack"><span class="lbl">Deine Notizen</span><p style="white-space:pre-wrap">${esc(d.notizen)}</p></section>` : ""}
    ${planungHtml(d.planung) ? `<section class="stack"><span class="lbl">Deine Pflegeplanung</span>${planungHtml(d.planung)}</section>` : ""}
    <section class="stack"><span class="lbl">Das Gespräch</span><div class="chat">${(d.chat||[]).map(m => `<div class="msg ${m.role==="assistant"?"p":"k"}"><span class="who">${m.role==="assistant"?esc(pName()):"Du"}</span>${esc(String(m.content).replace("[ENDE]",""))}</div>`).join("")}</div></section>
    ${d.bewertung ? oralEvalHtml(o, d.bewertung) : `<p class="note ${d.status==="abgebrochen"?"warn":"info"}">${d.status==="abgebrochen" ? "Dieses Gespräch wurde nicht zu Ende geführt." : "Die Bewertung ist noch nicht da. Sie erscheint hier, sobald die Prüferin fertig ist."}</p>`}
    ${horizontHtml(o)}
    <div class="row"><a class="btn pri" style="text-decoration:none" href="#${o.id}">Diesen Fall noch einmal üben</a><a href="#ergebnisse" class="muted">← zu den Ergebnissen</a></div>
  </article>`;
}

function renderOral(app, o){
  const key = lsKey("oral-" + o.id);
  const st = LS.get(key) || { phase:"vorbereitung", notizen:"", chat:[] };
  const persist = () => LS.set(key, st);
  if(st.phase === "vorbereitung"){
    app.innerHTML = `<div style="height:16px"></div><article class="sheet">
      <div><span class="lbl">Mündliche Prüfung · Vorbereitung</span><h1>${esc(o.titel)}</h1><p class="muted">${esc(o.person)} · ${esc(o.setting)} · Kompetenzbereiche ${o.kb.join(", ")}</p></div>
      ${st.vorbStart ? `<div class="clock" style="position:static;border-radius:6px" id="clock"><div><span class="lbl" style="color:inherit;opacity:.8">Vorbereitungszeit</span><div class="t" id="rest"></div></div></div>` : ""}
      ${!st.vorbStart ? `<div class="locked"><div class="lock" aria-hidden="true">🔒</div><p><b>Der Fall ist verschlossen.</b><br><span class="muted">Vorbereitungszeit: <input id="vmin" type="number" min="5" max="60" value="${st.vorbMin||20}" style="width:4em;font:inherit"> Minuten. Die echte Vorbereitungszeit steht nicht in deinen Unterlagen; frag deine Schule.</span></p><button class="btn pri big" id="ready">Ich bin bereit</button></div>` : `
      <section><span class="lbl">Fallsituation</span><div class="fall">${o.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div></section>
      <section class="stack"><span class="lbl">Bereite vor</span><ul style="margin:0">${o.vorbereitung.map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
      ${DATA.tipps ? `<section class="stack note info"><span class="lbl">Gerüst: vier Leitfragen</span><ol style="margin:0">${DATA.tipps.leitfragen.map(x => `<li>${esc(x)}</li>`).join("")}</ol><span class="src">${esc(DATA.tipps.leitfragenHinweis)} ${quelleLinks(DATA.tipps.leitfragenQ)}</span></section>` : ""}
      <label class="lbl" for="notes">Deine Notizen (Stichworte)</label><textarea id="notes">${esc(st.notizen)}</textarea>
      <section class="stack"><h2>Deine Pflegeplanung</h2>
        <p class="muted" style="font-size:.9rem">Nach der Vorlage deiner Schule: „Verschriftung eines gedanklichen Problemlösungsprozesses im PESR-System“ — Pflegeproblem · Pflegeziele · Pflegemaßnahmen · Begründungen. Die Prüferin fragt im Gespräch danach. (§ 15 verlangt für die mündliche Prüfung keine Pflegeplanung — du übst sie hier auf eigenen Wunsch.)</p>
        <div id="plan" class="stack"></div>
        <button class="btn ghost" id="addrow" type="button">+ weiteres Pflegeproblem</button>
        <span class="src">Vorlage: PDFs/30-pflegeplanung-vorlage.pdf (Etude-Repo, Wissen/029-pflegeplanung-vorlage-pesr.md)</span>
      </section>
      <button class="btn pri big" id="go">Prüfung beginnen</button>`}
      <a href="#muendlich" class="muted">← zurück</a></article>`;
    if(!st.vorbStart){ $("#ready").onclick = () => { st.vorbMin = Math.max(5, Math.min(60, Number($("#vmin").value)||20)); st.vorbStart = Date.now(); persist(); render(); }; return; }
    $("#notes").oninput = e => { st.notizen = e.target.value; persist(); };
    if(!Array.isArray(st.planung) || !st.planung.length) st.planung = [{p:"",z:"",m:"",b:""}];
    const felder = [["p","Pflegeproblem (PE(S)R)","Problem · Ursache (Etiologie) · Symptome (nur bei aktuellen Problemen) · Ressourcen"],["z","Pflegeziele","konkret, messbar, realistisch, terminiert; Nah- und Fernziel"],["m","Pflegemaßnahmen","wer, was, wann, wie oft, womit"],["b","Begründungen","warum diese Maßnahme das Ziel erreicht (Fachwissen, Expertenstandard)"]];
    const drawPlan = () => { $("#plan").innerHTML = st.planung.map((r,i) => `<div class="cmp" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${felder.map(([k,l,h]) => `<div style="padding:0;border:0"><label class="lbl" for="pl-${i}-${k}">${i+1}. ${esc(l)}</label><textarea id="pl-${i}-${k}" data-i="${i}" data-k="${k}" placeholder="${esc(h)}" style="min-height:110px">${esc(r[k]||"")}</textarea></div>`).join("")}</div>`).join("");
      $("#plan").querySelectorAll("textarea").forEach(ta => ta.oninput = () => { st.planung[ta.dataset.i][ta.dataset.k] = ta.value; persist(); }); };
    drawPlan();
    $("#addrow").onclick = () => { if(st.planung.length < 6){ st.planung.push({p:"",z:"",m:"",b:""}); persist(); drawPlan(); } };
    const upd = () => { const rest = st.vorbStart + st.vorbMin*60000 - Date.now(); $("#rest").textContent = rest > 0 ? fmtT(rest) : "Zeit um — beginne die Prüfung"; $("#clock").classList.toggle("low", rest < 2*60000); };
    upd(); tick = setInterval(upd, 1000);
    $("#go").onclick = () => { audioFreischalten(); st.phase = "pruefung"; st.pStart = Date.now(); st.sid = String(st.pStart); persist(); render(); };
    return;
  }
  const ended = st.phase === "ende";
  app.innerHTML = `<div style="height:16px"></div><article class="sheet">
    <div class="row" style="justify-content:space-between"><div><span class="lbl">Mündliche Prüfung · ${esc(o.titel)}</span><h2>Gespräch mit der Prüferin</h2></div><span class="pill run" id="dauer"></span></div>
    <details><summary class="lbl" style="cursor:pointer">Fall und Notizen</summary><div class="fall" style="margin-top:8px">${o.fall.map(p => `<p>${esc(p)}</p>`).join("")}</div>${st.notizen?`<p class="muted" style="white-space:pre-wrap;margin-top:8px">${esc(st.notizen)}</p>`:""}${(st.planung||[]).some(r => r.p||r.z||r.m||r.b) ? `<div class="tbl" style="margin-top:8px"><table><thead><tr><th>Pflegeproblem</th><th>Pflegeziele</th><th>Pflegemaßnahmen</th><th>Begründungen</th></tr></thead><tbody>${st.planung.filter(r => r.p||r.z||r.m||r.b).map(r => `<tr><td style="white-space:pre-wrap">${esc(r.p)}</td><td style="white-space:pre-wrap">${esc(r.z)}</td><td style="white-space:pre-wrap">${esc(r.m)}</td><td style="white-space:pre-wrap">${esc(r.b)}</td></tr>`).join("")}</tbody></table></div>` : ""}</details>
    <div class="chat" id="chat"></div>
    ${ended ? "" : `<label class="lbl" for="ans">Deine Antwort</label><textarea id="ans" style="min-height:100px" placeholder="Schreib oder diktiere deine Antwort …"></textarea>
    <div class="row"><button class="btn pri" id="send">Antwort senden</button><button class="btn ghost" id="vor">🔊 ${esc(pName())} noch einmal hören</button>${MODE === "public" && ((S.stimme && window.MediaRecorder) || SR) ? `<button class="btn ghost" id="mic" type="button">🎤 Sprechen</button>` : ""}<button class="btn red" id="stop">Prüfung beenden und bewerten</button></div>`}
    <div id="eval" class="stack"></div>
    <div class="row"><button class="btn ghost" id="reset">Fall neu beginnen</button><a href="#muendlich" class="muted">← zurück</a></div>
  </article>`;
  const chat = $("#chat");
  const draw = () => { chat.innerHTML = st.chat.map(m => `<div class="msg ${m.role==="assistant"?"p":"k"}"><span class="who">${m.role==="assistant"?esc(pName()):"Du"}</span>${esc(m.content.replace("[ENDE]",""))}</div>`).join(""); };
  draw();
  const upd = () => { $("#dauer").textContent = fmtT(Date.now() - st.pStart) + " min"; }; upd(); tick = setInterval(upd, 1000);
  const speak = t => sprechen(t);
  const offlineFrage = () => {
    const gestellt = st.chat.filter(m => m.role === "assistant").length;
    if(gestellt === 0) return "Guten Tag, ich bin " + pName() + ", Ihre Prüferin. Fassen Sie zusammen, worum es in der Fallsituation im Wesentlichen geht.";
    const hatPlan = (st.planung||[]).some(r => r.p||r.m);
    if(hatPlan && gestellt === 1) return "Sie haben eine Pflegeplanung vorbereitet. Welches Pflegeproblem hat für Sie Vorrang, und wie begründen Sie Ihre wichtigste Maßnahme?";
    const f = o.fragen[gestellt - (hatPlan ? 2 : 1)];
    return f ? f.frage : "Vielen Dank. Die Prüfung ist beendet. [ENDE]";
  };
  const ask = async () => {
    if(st.offline){ const text = offlineFrage(); st.chat.push({role:"assistant", content:text}); persist(); draw(); speak(text); if(text.includes("[ENDE]")) bewerten(); return; }
    const bubble = document.createElement("div"); bubble.className = "msg p"; bubble.innerHTML = `<span class="who">${esc(pName())}</span><span>…</span>`; chat.append(bubble);
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
  const showOralEval = r => { $("#eval").innerHTML = oralEvalHtml(o, r) + horizontHtml(o) + `<p class="muted" style="font-size:.9rem">Dieses Gespräch ist in deinen <a href="#ergebnisse">Ergebnissen</a> gespeichert.</p>`; };
  const _altShow = r => { $("#eval").innerHTML = `<section class="grade"><div><span class="lbl">Übungsnote</span><div class="n">${esc(r.note)}</div></div><div class="pen" style="flex:1 1 260px">${(r.kb||[]).map(k => `<div><b>KB ${esc(k.kb)}:</b> ${esc(k.urteil)}${(k.fehlt||[]).length?` <span class="muted" style="font-family:var(--f-ui);font-size:.9rem">Fehlt: ${k.fehlt.map(esc).join("; ")}</span>`:""}</div>`).join("")}${r.planung ? `<div><b>Pflegeplanung:</b> ${esc(r.planung)}</div>` : ""}<div class="muted" style="font-family:var(--f-ui);font-size:.9rem;margin-top:6px">🇫🇷 ${esc(r.fr||"")}</div></div></section>
    <div class="cmp"><div><span class="lbl">Das kannst du</span><ul>${(r.staerken||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div><div><span class="lbl">Das übst du als Nächstes</span><ul>${(r.ueben||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ul></div></div>
    ${(r.sprache||[]).length?`<div class="lang"><span class="lbl">Sprache</span><ul>${r.sprache.map(s => `<li><s>${esc(s.falsch)}</s> → <b>${esc(s.richtig)}</b> <span class="muted">(Baustelle ${esc(s.baustelle)})</span></li>`).join("")}</ul></div>`:""}
    <details><summary class="lbl" style="cursor:pointer">Erwartungshorizont</summary><ol>${o.fragen.map(f => `<li><b>[KB ${esc(f.kb)}] ${esc(f.frage)}</b><ul>${f.erwartung.map(e => `<li>${esc(e.text)}<div class="src">${esc(e.quelle||"")}</div></li>`).join("")}</ul></li>`).join("")}</ol></details>`; };
  const bewerten = async () => {
    st.phase = "ende"; persist();
    $("#eval").innerHTML = `<p class="note info">Die Prüferin bewertet das Gespräch … (ein bis drei Minuten)</p>`;
    try{ const r = await B.oralEval(o, st); st.bewertung = r; persist(); oralArchiv(o, st, "bewertet"); showOralEval(r); }
    catch(e){
      if(e && e.code === "wartet_oral"){ st.wartet = Date.now(); persist(); oralArchiv(o, st, "wartet"); $("#eval").innerHTML = `<p class="note warn">${esc(kiFehler(e))}</p><details open><summary class="lbl" style="cursor:pointer">Erwartungshorizont zum Selbstvergleich</summary><ol>${o.fragen.map(f => `<li><b>[KB ${esc(f.kb)}] ${esc(f.frage)}</b><ul>${f.erwartung.map(x => `<li>${esc(x.text)}<div class="src">${esc(x.quelle||"")}</div></li>`).join("")}</ul></li>`).join("")}</ol></details><button class="btn ghost" id="retry">Ist die Bewertung da? Neu laden</button>`; $("#retry").onclick = bewerten; return; }
      $("#eval").innerHTML = `<p class="note warn">${esc(kiFehler(e))}</p><button class="btn red" id="retry">Noch einmal bewerten</button>`; $("#retry").onclick = bewerten; }
  };
  $("#reset").onclick = () => { oralArchiv(o, st, st.bewertung ? "bewertet" : st.wartet ? "wartet" : "abgebrochen"); LS.set(key, null); render(); };
  if(ended){ if(st.bewertung) showOralEval(st.bewertung); else bewerten(); return; }
  $("#vor").onclick = () => { audioFreischalten(); const last = [...st.chat].reverse().find(m => m.role === "assistant"); if(last) speak(last.content); };
  $("#send").onclick = () => { audioFreischalten(); const t = $("#ans").value.trim(); if(!t) return; st.chat.push({role:"user", content:t}); persist(); $("#ans").value = ""; draw(); ask(); };
  $("#stop").onclick = () => bewerten();
  if($("#mic")){
    const mic = $("#mic"); let rec = null, stream = null, teile = [];
    const zuruecksetzen = () => { rec = null; mic.disabled = false; mic.textContent = "🎤 Sprechen"; if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; } };
    mic.onclick = async () => {
      audioFreischalten();
      if(rec){ rec.stop(); return; }
      stummschalten();
      if(S.stimme && window.MediaRecorder && navigator.mediaDevices){
        try{ stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch(e){ flash("Mikrofon nicht erlaubt. Erlaube es in den Einstellungen deines Browsers oder nutze das Mikrofon deiner Tastatur."); return; }
        const typ = ["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
        rec = typ ? new MediaRecorder(stream, { mimeType: typ }) : new MediaRecorder(stream); teile = [];
        rec.ondataavailable = ev => { if(ev.data && ev.data.size) teile.push(ev.data); };
        rec.onstop = async () => {
          const blob = new Blob(teile, { type: rec.mimeType || typ || "audio/webm" });
          mic.disabled = true; mic.textContent = "… " + pName() + " hört zu";
          try{
            const r = await fetch("/api/stt", { method:"POST", headers:{ "content-type": blob.type.split(";")[0] || "audio/webm" }, body: blob });
            const j = await r.json(); if(!r.ok) throw new Error(j.error || r.status);
            if(j.text){ const a = $("#ans"); a.value = (a.value ? a.value.trim() + " " : "") + j.text; }
            else flash("Ich habe nichts verstanden. Sprich bitte noch einmal.");
          }catch(e){ flash("Die Spracherkennung hat nicht geklappt (" + e.message + "). Nutze das Mikrofon deiner Tastatur."); }
          zuruecksetzen();
        };
        rec.start(); mic.textContent = "⏹ Fertig gesprochen";
        return;
      }
      if(SR){
        rec = new SR(); rec.lang = "de-DE"; rec.interimResults = true; rec.continuous = true;
        const basis = $("#ans").value ? $("#ans").value.trim() + " " : "";
        rec.onresult = ev => { let t = ""; for(const r of ev.results) t += r[0].transcript; $("#ans").value = basis + t; };
        rec.onend = () => zuruecksetzen();
        rec.onerror = ev => flash(ev.error === "not-allowed" ? "Mikrofon nicht erlaubt. Erlaube es in den Einstellungen deines Browsers oder nutze das Mikrofon deiner Tastatur." : "Spracherkennung: " + ev.error);
        try{ rec.start(); mic.textContent = "⏹ Fertig gesprochen"; }catch(e){ rec = null; }
      }
    };
  }
  if(!st.chat.length) ask();
}

/* ---------- Tipps aus der Recherche ---------- */
function quelleLinks(qs){ const Q = (DATA.tipps && DATA.tipps.quellen) || {}; return (qs||[]).map(k => Q[k] ? `<a href="${esc(Q[k].u)}" target="_blank" rel="noopener" title="${esc(Q[k].t)}">[${esc(k)}]</a>` : "").join(" "); }
function renderTipps(app){
  const T = DATA.tipps;
  if(!T){ app.innerHTML = `<p class="note warn" style="margin-top:16px">Keine Tipps vorhanden.</p>`; return; }
  app.innerHTML = `<section class="intro"><span class="lbl">Tipps · Recherche vom 03.11.2026</span><h1>So wird gefragt, und hier liegen die Fallen</h1>
    <p class="muted" style="max-width:68ch">Echte NRW-Klausuren sind nicht öffentlich. Diese Tipps kommen aus Gesetzen, Leitfäden anderer Bundesländer, einer NRW-Lehrerschulung, Lehrbüchern und einem Gerichtsurteil. Die Nummer in Klammern führt zur Quelle. Was deine Schule sagt, gilt immer zuerst.</p></section>
  <article class="sheet">
    <section class="stack"><h2>Der Ablauf</h2><ul style="margin:0;display:flex;flex-direction:column;gap:6px">${T.ablauf.map(x => `<li>${esc(x.text)} <span class="src">${quelleLinks(x.q)}</span></li>`).join("")}</ul></section>
    <section class="stack"><h2>So liest du den Fall</h2><ol style="margin:0">${T.lesen.map(x => `<li>${esc(x)}</li>`).join("")}</ol><span class="src">${quelleLinks(T.lesenQ)}</span></section>
    <section class="stack"><h2>Die Fallen</h2><div class="tbl"><table><thead><tr><th>Falle</th><th>So machst du es richtig</th><th></th></tr></thead><tbody>${T.fallen.map(f => `<tr><td>${esc(f.falle)}</td><td>${esc(f.richtig)}</td><td class="src">${quelleLinks(f.q)}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="stack"><h2>Die Operatoren</h2><div class="tbl"><table><tbody>${T.operatoren.map(o => `<tr><th>Niveau ${esc(o.niveau)}</th><td>${esc(o.liste)}</td></tr>`).join("")}</tbody></table></div><span class="src">${esc(T.operatorenHinweis)} ${quelleLinks(T.operatorenQ)}</span></section>
    <section class="stack"><h2>Die mündliche Prüfung</h2><ul style="margin:0;display:flex;flex-direction:column;gap:6px">${T.muendlich.map(x => `<li>${esc(x.text)} <span class="src">${quelleLinks(x.q)}</span></li>`).join("")}</ul>
      <div class="note info"><span class="lbl">Vier Leitfragen als Gerüst</span><ol style="margin:4px 0 0">${T.leitfragen.map(x => `<li>${esc(x)}</li>`).join("")}</ol><span class="src">${esc(T.leitfragenHinweis)} ${quelleLinks(T.leitfragenQ)}</span></div></section>
    <details><summary class="lbl" style="cursor:pointer">Alle Quellen</summary><ol style="font-size:.85rem">${Object.entries(T.quellen).map(([k,v]) => `<li value="${esc(k)}"><a href="${esc(v.u)}" target="_blank" rel="noopener">${esc(v.t)}</a></li>`).join("")}</ol></details>
  </article>`;
}

/* ---------- Ergebnisse ---------- */
function renderResults(app){
  const rows = Object.values(S.docs).filter(d => EX[d.pruefung]).sort((a,b) => (b.start||0) - (a.start||0));
  const orals = oralVerlauf();
  app.innerHTML = `<section class="intro"><span class="lbl">Ergebnisse</span><h1>Dein Verlauf</h1><p class="muted">Jeder Versuch bleibt hier stehen, mit deinen Antworten und der Korrektur. So siehst du, ob du besser wirst.</p></section>
  <article class="sheet">
  <section class="stack"><h2>Schriftlich</h2>
  ${rows.length ? `<div class="tbl"><table><thead><tr><th>Datum</th><th>Klausur</th><th>Versuch</th><th>Punkte</th><th>Note</th><th></th></tr></thead><tbody>${rows.map(d => { const ex = EX[d.pruefung]; const k = d.korrektur;
    return `<tr><td>${fmtD(d.start)}</td><td>${ex.probe ? "Probelauf" : ex.klausur + esc(ex.variante)} · ${esc(ex.titel)}</td><td>${d.versuch}</td><td style="font-variant-numeric:tabular-nums">${k ? komma(k.summe) + " / " + ex.gesamtpunkte : d.status==="laeuft"?"läuft":d.korrekturWartet?"bei der Prüferin":"nicht korrigiert"}</td><td>${k ? note(k.prozent)[0] : "–"}</td><td><a href="#${d.status==="laeuft" ? ex.id : "v-" + esc(d.key)}">öffnen</a></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">Noch keine schriftliche Arbeit. Fang mit dem Probelauf an.</p>`}
  </section>
  <section class="stack"><h2>Mündlich</h2>
  ${orals.length ? `<div class="tbl"><table><thead><tr><th>Datum</th><th>Fall</th><th>Dauer</th><th>Ergebnis</th><th></th></tr></thead><tbody>${orals.map(d => { const [st] = oralStatus(d); const dauer = d.chat && d.chat.length && d.ende && d.start ? Math.round((d.ende - d.start)/60000) + " min" : "–";
    return `<tr><td>${fmtD(d.start)}</td><td>${esc(OR[d.fall].titel)}</td><td style="font-variant-numeric:tabular-nums">${dauer}</td><td>${esc(st)}</td><td><a href="#h-${esc(d.id)}">öffnen</a></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">Noch keine mündliche Prüfung.</p>`}
  </section>
  ${MODE !== "public" || S.mode === "api" ? "" : `<p class="note warn">Der Speicher ist nicht verbunden: dieser Verlauf liegt nur auf diesem Gerät.</p>`}
  </article>`;
}

/* ---------- Einstellungen (nur öffentliche Seite) ---------- */
function zeigeEinstellungen(c){
  $("#cfgstate").innerHTML = `<span class="pill ${c.ki?"done":"wait"}">${c.ki ? esc(pName()) + " korrigiert selbst ✓" : "Korrektur: noch aus"}</span> <span class="pill ${c.stimme?"done":"wait"}">${c.stimme ? "Stimme ✓" : "Stimme: aus"}</span>${c.stimmenFehler ? ` <span class="muted">Stimmenliste nicht geladen (${esc(c.stimmenFehler)})</span>` : ""}`;
  const sel = $("#k-voice"); const liste = (c.stimmen && c.stimmen.length) ? c.stimmen : [{ id: c.stimmeId, name: "Sarah (Standard)", info: "" }];
  sel.innerHTML = liste.map(v => `<option data-name="${esc(v.name)}" value="${esc(v.id)}"${v.id===c.stimmeId?" selected":""}>${esc(v.name)}${v.info?" — "+esc(v.info):""}</option>`).join("");
  S.stimme = !!c.stimme; S.kiServer = !!c.ki; if(c.name) S.pname = c.name;
}
async function einstellungenLaden(){
  const tok = LS.get("examen-admin") || "";
  try{ zeigeEinstellungen(await ApiB.call("/api/admin?einstellungen=1&token=" + encodeURIComponent(tok))); }catch(e){ $("#cfgstate").textContent = "Konnte die Einstellungen nicht laden (" + (e.code||"Fehler") + ")."; }
  const senden = async ein => { try{ zeigeEinstellungen(await ApiB.post("/api/admin", { token: tok, einstellungen: ein })); flash("Gespeichert."); }catch(e){ flash("Nicht gespeichert (" + (e.code||"Fehler") + ")."); } };
  $("#cfg").onsubmit = async e => { e.preventDefault(); const opt = $("#k-voice").selectedOptions[0]; const ein = { elevenVoice: $("#k-voice").value, elevenVoiceName: opt ? opt.dataset.name || "" : "" };
    const a = $("#k-ant").value.trim(), el = $("#k-el").value.trim(); if(a) ein.anthropicKey = a; if(el) ein.elevenKey = el;
    await senden(ein); $("#k-ant").value = ""; $("#k-el").value = ""; };
  $("#del-ant").onclick = () => senden({ anthropicKey: "" });
  $("#del-el").onclick = () => senden({ elevenKey: "" });
  $("#probe-stimme").onclick = () => { audioFreischalten(); sprechen("Guten Tag, ich bin " + stimmenVorname($("#k-voice").selectedOptions[0]?.dataset.name || pName()) + ", Ihre Prüferin. Fassen Sie zusammen, worum es in der Fallsituation im Wesentlichen geht."); };
}

/* ---------- Abgaben (Besitzerin) ---------- */
async function renderAdmin(app){
  if(MODE === "public" && !LS.get("examen-admin")){
    app.innerHTML = `<section class="intro"><span class="lbl">Abgaben</span><h1>Nur für die Besitzerin</h1></section><form class="sheet" id="af" style="max-width:520px"><label class="lbl" for="tok">Zugangsschlüssel</label><input id="tok" style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"><button class="btn pri">Öffnen</button></form>`;
    $("#af").onsubmit = e => { e.preventDefault(); LS.set("examen-admin", $("#tok").value.trim()); S.owner = true; $("#tab-abgaben").hidden = false; render(); };
    return;
  }
  if(MODE !== "public" && !S.owner){ app.innerHTML = `<p class="note warn" style="margin-top:16px">Diese Ansicht sieht nur die Besitzerin der Seite.</p>`; return; }
  app.innerHTML = `<section class="intro"><span class="lbl">Abgaben</span><h1>Alle Abgaben</h1><p class="muted">Die Arbeiten aller Personen, die die Seite benutzen.</p></section>
    ${MODE === "public" ? `<form class="sheet" id="cfg" style="margin-bottom:16px"><h2>Einstellungen: Prüferin und Stimme</h2><p class="muted" style="font-size:.9rem">Die Prüferin heißt wie die Stimme, die du wählst.</p><p class="muted" style="font-size:.9rem">Die Schlüssel werden verschlüsselt auf dem Server gespeichert und nie wieder angezeigt. Ein leeres Feld lässt den alten Schlüssel stehen.</p><div id="cfgstate" class="muted">Lade …</div>
      <label class="lbl" for="k-ant">Anthropic-Schlüssel (die Prüferin korrigiert und prüft selbst)</label><input id="k-ant" type="password" autocomplete="off" placeholder="sk-ant-…" style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)">
      <label class="lbl" for="k-el">ElevenLabs-Schlüssel (Stimme der Prüferin, Spracherkennung)</label><input id="k-el" type="password" autocomplete="off" style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)">
      <label class="lbl" for="k-voice">Stimme und Name der Prüferin</label><select id="k-voice" style="font:inherit;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"></select>
      <div class="row"><button class="btn pri">Speichern</button><button class="btn ghost" type="button" id="probe-stimme">Stimme anhören</button><button class="btn ghost" type="button" id="del-ant">Anthropic-Schlüssel löschen</button><button class="btn ghost" type="button" id="del-el">ElevenLabs-Schlüssel löschen</button></div></form>` : ""}
    <div id="adm" class="list"><p class="muted">Lade …</p></div>`;
  if(MODE === "public") einstellungenLaden();
  try{
    const rows = await B.adminList();
    $("#adm").innerHTML = rows.length ? rows.sort((a,b)=>(b.geaendert||0)-(a.geaendert||0)).map(r => { const ex = EX[r.pruefung]; return `<div class="it"><div><b>${esc(r.name||"Person")}</b> · ${ex ? (ex.probe ? "Probelauf" : "Klausur " + ex.klausur + ex.variante) : esc(r.pruefung||r.fall||"")} · ${r.versuch ? "Versuch " + r.versuch : "mündlich"}<div class="muted" style="font-size:.85rem">${r.status==="laeuft"?"läuft":"abgegeben "+fmtD(r.abgegeben||r.am)}${r.korrektur?" · Note "+r.korrektur.note+" ("+komma(r.korrektur.prozent)+" %)":""}${r.bewertung?" · Note "+esc(r.bewertung.note):""}</div></div></div>`; }).join("") : `<p class="muted">Noch keine Abgaben.</p>`;
  }catch(e){ $("#adm").innerHTML = `<p class="note warn">Konnte die Abgaben nicht laden (${esc(e.code||"Fehler")}).</p>`; if(MODE === "public") LS.set("examen-admin", null); }
}

boot();
