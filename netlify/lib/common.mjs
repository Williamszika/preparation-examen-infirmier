import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

export const store = () => getStore({ name: "abgaben", consistency: "strong" });
export const okUid = u => typeof u === "string" && /^u[a-z0-9]{8,30}$/.test(u);
export const okKey = k => typeof k === "string" && /^[a-z0-9]{1,12}-\d{1,3}$/.test(k);
export const bad = (msg, status = 400) => Response.json({ error: msg }, { status });
export async function body(req){ try{ return await req.json(); }catch{ return null; } }

export function cleanAntworten(a){
  const out = {};
  if(a && typeof a === "object") for(const [k, v] of Object.entries(a)){ if(/^[0-9a-z.]{1,8}$/i.test(k)) out[k] = String(v ?? "").slice(0, 12000); }
  return out;
}
export function cleanChat(chat){
  const out = [];
  for(const m of (Array.isArray(chat) ? chat : []).slice(-60)){
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = String((m && m.content) || "").slice(0, 4000).trim();
    if(!content) continue;
    if(out.length && out[out.length-1].role === role) out[out.length-1].content += "\n" + content;
    else out.push({ role, content });
  }
  return out;
}

/* Einstellungen, die die Besitzerin auf der Seite einträgt (Reiter „Abgaben“ → Einstellungen).
   Liegen verschlüsselt in Netlify Blobs, werden nie an den Browser zurückgegeben. */
const cfgStore = () => getStore({ name: "einstellungen", consistency: "strong" });
let cfgCache = null, cfgZeit = 0;
export async function config(frisch){
  if(!frisch && cfgCache && Date.now() - cfgZeit < 30000) return cfgCache;
  cfgCache = (await cfgStore().get("config", { type: "json" })) || {}; cfgZeit = Date.now();
  return cfgCache;
}
export async function configSetzen(neu){
  const alt = await config(true);
  const c = { ...alt };
  for(const k of ["anthropicKey", "elevenKey", "elevenVoice", "elevenVoiceName", "elevenVoiceMale", "agnesModel"]){
    if(typeof neu[k] !== "string") continue;
    const v = neu[k].trim();
    if(v) c[k] = v.slice(0, 300); else delete c[k];
  }
  await cfgStore().setJSON("config", c); cfgCache = c; cfgZeit = Date.now();
  return c;
}
const anthropicKey = async () => process.env.ANTHROPIC_API_KEY || (await config()).anthropicKey || "";
export const kiAn = async () => !!(process.env.ANTHROPIC_AUTH_TOKEN || await anthropicKey());
export const stimmeAn = async () => !!(process.env.ELEVENLABS_API_KEY || (await config()).elevenKey);
export const elevenKey = async () => process.env.ELEVENLABS_API_KEY || (await config()).elevenKey || "";
/* Stimme der Prüferin: Standard „Sarah“ (EXAVITQu4vr4xnSDxMaL, aus der Liste freier Stimmen in cours-allemand/api/_lib/eleven.js) */
export const AGNES_STANDARD = "EXAVITQu4vr4xnSDxMaL";
const nameAus = n => String(n||"").split(/\s+[-—–(|]\s*|\s*\(/)[0].replace(/^Essai\s+/i, "").trim().slice(0, 40);
const istMann = (name, gender) => gender === "male" || /^(Monsieur|Herr|Mr\.?)\s/i.test(name || "");
/* Name und Geschlecht der Prüferin/des Prüfers = die gewählte Stimme. Rückgabe {name, m}. */
export const prueferin = async () => {
  const c = await config();
  if(!c.elevenVoice) return { name: "Sarah", m: false };
  if(c.elevenVoiceName && c.elevenVoiceMale !== undefined) return { name: c.elevenVoiceName, m: c.elevenVoiceMale === "1" };
  try{
    const k = await elevenKey();
    const r = await fetch("https://api.elevenlabs.io/v1/voices/" + encodeURIComponent(c.elevenVoice), { headers: { "xi-api-key": k } });
    if(r.ok){ const j = await r.json(); const name = nameAus(j.name); if(name){ const m = istMann(name, j.labels && j.labels.gender); await configSetzen({ elevenVoiceName: name, elevenVoiceMale: m ? "1" : "0" }); return { name, m }; } }
  }catch(e){ console.error(e); }
  return { name: c.elevenVoiceName || "Sarah", m: false };
};
export const prueferinName = async () => (await prueferin()).name;
export { nameAus, istMann };
/* Kurztest der KI für die Besitzerin: welches Modell antwortet, und wenn nicht, warum */
export async function kiTest(model, agnesModel){
  try{ const ki = await kiAnbieter(); const t = await claudeText("Antworte nur mit: ok", { model, max_tokens: 20, agnesModel }); return { anbieter: ki.art, model: ki.art === "agnes" ? (agnesModel || (await config()).agnesModel || MODEL_AGNES()) : model, ok: true, text: t }; }
  catch(e){ return { model, ok: false, fehler: String((e && (e.message || e.error?.message)) || e).slice(0, 300), status: e && e.status }; }
}
export const agnesVoice = async () => (await config()).elevenVoice || process.env.ELEVENLABS_VOICE_ID || AGNES_STANDARD;

/* Welche KI? Ein Schlüssel „sk-ant-…“ → Anthropic (Claude). Jeder andere Schlüssel im KI-Feld → Agnes AI
   (agnes-ai.com, OpenAI-kompatibel, Basis https://apihub.agnes-ai.com/v1). Ihr Wunsch: „utiliser Agnes comme professeur“. */
export const AGNES_BASE = "https://apihub.agnes-ai.com/v1";
/* Textmodelle laut /v1/models am 03.11.2026: agnes-3.0-flash, agnes-2.5-flash, agnes-2.5-pro-alpha/-beta (agnes-2.0-flash fehlt). */
export const MODEL_AGNES = () => Netlify.env.get("AGNES_MODEL") || "agnes-3.0-flash";
const AGNES_ERSATZ = ["agnes-2.5-flash"];
export async function kiAnbieter(){
  if(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return { art: "anthropic" };
  const k = (await config()).anthropicKey || "";
  if(!k) return { art: "" };
  return k.startsWith("sk-ant-") ? { art: "anthropic", key: k } : { art: "agnes", key: k };
}
export async function claudeText(prompt, { model, max_tokens, agnesModel }){
  const messages = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
  const ki = await kiAnbieter();
  if(ki.art === "agnes"){
    const erst = agnesModel || (await config()).agnesModel || MODEL_AGNES();
    let r, txt;
    for(const m of [erst, ...AGNES_ERSATZ.filter(x => x !== erst && !agnesModel)]){
      r = await fetch(AGNES_BASE + "/chat/completions", {
        method: "POST",
        headers: { "authorization": "Bearer " + ki.key, "content-type": "application/json" },
        body: JSON.stringify({ model: m, max_tokens, temperature: 0.3, messages })
      });
      txt = await r.text();
      if(r.ok || r.status !== 500) break;   // 500 „temporarily unavailable“ → nächstes Modell
    }
    if(!r.ok){ const e = new Error("Agnes AI " + r.status + ": " + txt.slice(0, 200)); e.status = r.status; throw e; }
    const j = JSON.parse(txt);
    return String(j.choices?.[0]?.message?.content || "").trim();
  }
  const client = ki.key ? new Anthropic({ apiKey: ki.key }) : new Anthropic();
  const msg = await client.messages.create({ model, max_tokens, messages });
  return msg.content.filter(c => c.type === "text").map(c => c.text).join("").trim();
}
export function parseJson(text){
  try{ return JSON.parse(text); }catch{}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); if(m){ try{ return JSON.parse(m[1]); }catch{} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if(a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error("Antwort war kein JSON");
}
export const MODEL_KORREKTUR = () => Netlify.env.get("PRUEFER_MODEL") || "claude-sonnet-5-5";
export const MODEL_GESPRAECH = () => Netlify.env.get("GESPRAECH_MODEL") || "claude-haiku-5-5";
