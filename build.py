#!/usr/bin/env python3
"""Baut beide Fassungen der Übungsseite:
   app/index.html        — claude.ai-Artifact (db + sample)
   site/index.html       — öffentliche Seite auf Netlify, ohne Claude-Konto (Funktionen in netlify/functions)
   netlify/lib/shared.mjs — Daten und Prüfer-Prompts für die Netlify-Funktionen
Quelle: app/vorlage.html + app/app.js + app/prompts.js + matrix/ + pruefungen/ + muendlich/."""
import json, pathlib
R = pathlib.Path(__file__).resolve().parent
def load(d): return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((R / d).glob("*.json"))]
pr = load("pruefungen")
for e in pr:
    s = sum(a["punkte"] for a in e["aufgaben"])
    assert abs(s - e["gesamtpunkte"]) < 1e-9, f"{e['id']}: Summe {s} != {e['gesamtpunkte']}"
data = {"matrix": json.loads((R / "matrix/matrix.json").read_text(encoding="utf-8")),
        "pruefungen": pr, "muendlich": load("muendlich"),
        "tipps": json.loads((R / "recherche/tipps.json").read_text(encoding="utf-8"))}
js = json.dumps(data, ensure_ascii=False)
shared = (R / "app/prompts.js").read_text(encoding="utf-8")
app = (R / "app/app.js").read_text(encoding="utf-8")
tpl = (R / "app/vorlage.html").read_text(encoding="utf-8")

def page(mode):
    return (tpl.replace('"__MODE__"', json.dumps(mode), 1)
               .replace("/*__DATA__*/null", js.replace("</", "<\\/"), 1)
               .replace("/*__SHARED__*/", shared, 1)
               .replace("/*__APP__*/", app, 1))

(R / "app/index.html").write_text(page("artifact"), encoding="utf-8")
(R / "site").mkdir(exist_ok=True)
pub = ('<!doctype html>\n<html lang="de"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
       '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
       'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n'
       + page("public") + '\n</body></html>\n')
(R / "site/index.html").write_text(pub, encoding="utf-8")
(R / "netlify/lib/shared.mjs").write_text(
    "// automatisch erzeugt von build.py — nicht von Hand ändern\n" + shared +
    "\nexport const DATA = " + js + ";\nexport { note, prueferPrompt, auswerten, oralRules, oralEvalPrompt, PRUEFERIN_STANDARD, stimmenVorname };\n",
    encoding="utf-8")
print(f"{len(pr)} Klausur(en), {len(data['muendlich'])} mündliche(r) Fall/Fälle → app/index.html, site/index.html, netlify/lib/shared.mjs")
