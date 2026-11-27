# Renders assets/demo.gif from real output of the live demo (captured 2026-11-27). Run: python3 assets/src/demo.py
import html, os, subprocess, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "demo.gif")
B = "https://toolrelay.azet.io"
SCENES = [
    ("# find a tool by the job, with its price", None),
    (f'curl -s "{B}/v1/catalog?q=profile from email" | jq -c \'.[0:3][] | {{id, price_usd, ready}}\'',
     '{"id":"gravatar.profile.from_email","price_usd":0,"ready":true}\n'
     '{"id":"hunter.email.find","price_usd":0.034,"ready":false}\n'
     '{"id":"bluesky.profile.get","price_usd":0,"ready":true}'),
    ("# call it. no key needed for free tools on the demo", None),
    (f"curl -s -X POST {B}/v1/call/people.profile.from_email \\\n    -d '{{\"email\":\"beau@dentedreality.com.au\"}}' \\\n  | jq '{{name: .output.display_name, company: .output.company, cost_usd, served_by}}'",
     '{\n  "name": "Beau Lebens",\n  "company": "Automattic",\n  "cost_usd": 0,\n  "served_by": "gravatar.profile.from_email"\n}'),
]
PAGE = """<!doctype html><meta charset=utf-8><style>
body{margin:0;background:#0b0b0c;width:960px;height:540px;font:16px/1.5 'Geist Mono',ui-monospace,monospace;color:#e8e8e4}
.bar{height:38px;background:#151518;border-bottom:1px solid #26262a;display:flex;align-items:center;gap:8px;padding:0 16px}
.bar i{width:12px;height:12px;border-radius:50%;background:#2f2f34;display:block}.bar b{margin-left:12px;font-weight:500;color:#8a8a85;font-size:14px}
pre{margin:0;padding:22px 26px;white-space:pre-wrap;word-break:break-all;font:inherit}
.p{color:#ff6b2c}.c{color:#6f6f6a}.o{color:#9ad27a}.cur{background:#e8e8e4;color:#0b0b0c}
</style><div class=bar><i></i><i></i><i></i><b>toolrelay — live demo</b></div><pre id=t></pre>"""

def frames():
    done, out = "", []
    for cmd, res in SCENES:
        cls = "c" if cmd.startswith("#") else ""
        step = 3 if cls else 4
        for i in range(0, len(cmd) + step, step):
            typed = html.escape(cmd[:i])
            out.append((done + f'<span class=p>$ </span><span class="{cls}">{typed}</span><span class=cur> </span>', 4))
        done += f'<span class=p>$ </span><span class="{cls}">{html.escape(cmd)}</span>\n'
        out.append((done + '<span class=cur> </span>', 40 if res else 25))
        if res:
            done += f'<span class=o>{html.escape(res)}</span>\n\n'
            out.append((done + '<span class=p>$ </span><span class=cur> </span>', 160))
    out.append((done + '<span class=p>$ </span><span class=cur> </span>', 300))
    return out

with tempfile.TemporaryDirectory() as d, sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 960, "height": 540})
    pg.set_content(PAGE)
    lst = []
    for n, (h, cs) in enumerate(frames()):
        pg.evaluate("h => document.getElementById('t').innerHTML = h", h)
        f = os.path.join(d, f"{n:04d}.png"); pg.screenshot(path=f); lst.append(f"file '{f}'\nduration {cs/100}")
    b.close()
    open(os.path.join(d, "list.txt"), "w").write("\n".join(lst) + f"\nfile '{f}'\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(d, "list.txt"),
                    "-vf", "split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none", OUT], check=True)
print(OUT, os.path.getsize(OUT))
