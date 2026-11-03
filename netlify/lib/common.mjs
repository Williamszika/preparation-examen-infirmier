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

export const kiAn = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function claudeText(prompt, { model, max_tokens }){
  const messages = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
  const msg = await new Anthropic().messages.create({ model, max_tokens, messages });
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
