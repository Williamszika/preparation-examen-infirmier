import { kiAn, stimmeAn, prueferin } from "../lib/common.mjs";

/* Was ist eingeschaltet? Die Seite blendet danach Stimme und Mikrofon ein. Gibt nie Schlüssel heraus. */
export default async () => {
  let ki = false, stimme = false, p = { name: "Sarah", m: false };
  try{ [ki, stimme, p] = await Promise.all([kiAn(), stimmeAn(), prueferin()]); }catch(e){ console.error(e); }
  return Response.json({ ki, stimme, name: p.name, m: p.m });
};
export const config = { path: "/api/status", method: "GET" };
