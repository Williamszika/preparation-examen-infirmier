import { bad, elevenKey } from "../lib/common.mjs";

/* Die Kandidatin spricht: Aufnahme aus dem Browser → ElevenLabs Speech-to-Text (Deutsch) → Text. */
export default async (req) => {
  const key = await elevenKey();
  if(!key) return bad("stimme_aus", 503);
  const typ = (req.headers.get("content-type") || "audio/webm").split(";")[0];
  if(!/^audio\//.test(typ)) return bad("kein Audio");
  const audio = await req.arrayBuffer();
  if(!audio.byteLength) return bad("leer");
  if(audio.byteLength > 4_000_000) return bad("Aufnahme zu lang (höchstens etwa 3 Minuten)", 413);
  const endung = typ.includes("mp4") || typ.includes("m4a") ? "m4a" : typ.includes("ogg") ? "ogg" : typ.includes("wav") ? "wav" : "webm";
  const fd = new FormData();
  fd.append("model_id", "scribe_v1");
  fd.append("language_code", "deu");
  fd.append("file", new Blob([audio], { type: typ }), "antwort." + endung);
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: fd });
  if(!r.ok){ console.error("stt", r.status, (await r.text()).slice(0, 300)); return bad("erkennung_fehler", 502); }
  const j = await r.json();
  return Response.json({ text: String(j.text || "").trim() });
};
export const config = { path: "/api/stt", method: "POST", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
