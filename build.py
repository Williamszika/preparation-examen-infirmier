#!/usr/bin/env python3
"""Baut app/index.html aus app/vorlage.html + matrix/matrix.json + pruefungen/*.json + muendlich/*.json."""
import json, pathlib
R = pathlib.Path(__file__).resolve().parent
def load(d): return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((R / d).glob("*.json"))]
pr = load("pruefungen")
for e in pr:
    s = sum(a["punkte"] for a in e["aufgaben"])
    assert abs(s - e["gesamtpunkte"]) < 1e-9, f"{e['id']}: Summe {s} != {e['gesamtpunkte']}"
data = {"matrix": json.loads((R / "matrix/matrix.json").read_text(encoding="utf-8")),
        "pruefungen": pr, "muendlich": load("muendlich")}
js = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
html = (R / "app/vorlage.html").read_text(encoding="utf-8").replace("/*__DATA__*/null", js, 1)
(R / "app/index.html").write_text(html, encoding="utf-8")
print(f"app/index.html: {len(pr)} Klausur(en), {len(data['muendlich'])} mündliche(r) Fall/Fälle, {len(html)//1024} KB")
