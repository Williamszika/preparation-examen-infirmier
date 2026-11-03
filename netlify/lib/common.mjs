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
  for(const k of ["anthropicKey", "elevenKey", "elevenVoice", "elevenVoiceName", "elevenVoiceMale"]){
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
export async function kiTest(model){
  try{ const t = await claudeText("Antworte nur mit: ok", { model, max_tokens: 5 }); return { model, ok: true, text: t }; }
  catch(e){ return { model, ok: false, fehler: String((e && (e.message || e.error?.message)) || e).slice(0, 300), status: e && e.status }; }
}
export const agnesVoice = async () => (await config()).elevenVoice || process.env.ELEVENLABS_VOICE_ID || AGNES_STANDARD;

export async function claudeText(prompt, { model, max_tokens }){
  const messages = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
  const key = process.env.ANTHROPIC_API_KEY ? undefined : (await config()).anthropicKey;
  const client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
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
