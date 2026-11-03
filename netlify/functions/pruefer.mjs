import { okUid, bad, body, cleanChat, claudeText, MODEL_GESPRAECH, kiAn, prueferinName } from "../lib/common.mjs";
import { DATA, oralRules } from "../lib/shared.mjs";

export default async (req) => {
  const bd = await body(req);
  if(!bd || !okUid(bd.uid)) return bad("Anfrage ungültig");
  const o = DATA.muendlich.find(f => f.id === bd.fall);
  if(!o) return bad("Fall unbekannt");
  if(!(await kiAn())) return bad("ki_aus", 503);
  const chat = cleanChat(bd.chat);
  const messages = cleanChat([{ role: "user", content: oralRules(o, bd.notizen, bd.planung, await prueferinName()) }, ...chat]);
  if(messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: "(weiter)" });
  try{
    const text = await claudeText(messages, { model: MODEL_GESPRAECH(), max_tokens: 700 });
    return Response.json({ text: text || "Bitte wiederholen Sie Ihre Antwort." });
  }catch(e){ console.error(e); return bad("Die Prüferin antwortet gerade nicht.", 502); }
};

export const config = { path: "/api/pruefer", method: "POST", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
