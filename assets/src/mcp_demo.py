# Renders assets/mcp.gif from a real Claude Code run against the live demo's MCP endpoint (2026-11-27):
#   claude mcp add --transport http toolrelay https://toolrelay.azet.io/mcp
#   claude -p "Who is behind beau@dentedreality.com.au? Use the toolrelay tools. ..."
# Tool calls, results and the answer below are copied from that run's stream-json transcript (trimmed, not reworded).
import html, os, subprocess, tempfile
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mcp.gif")
E = html.escape
STEPS = [
    ("cmd", "claude mcp add --transport http toolrelay https://toolrelay.azet.io/mcp"),
    ("out", "Added HTTP MCP server toolrelay with URL: https://toolrelay.azet.io/mcp to local config"),
    ("cmd", "claude"),
    ("ask", "Who is behind beau@dentedreality.com.au? Use the toolrelay tools. Say what it cost."),
    ("tool", 'toolrelay.search_tools({"query": "email to profile"})'),
    ("res", 'gravatar.profile.from_email  price_usd 0  ready true   (+ 8 more)'),
    ("tool", 'toolrelay.call_tool({"id": "gravatar.profile.from_email", "params": {"email": "beau@dentedreality.com.au"}})'),
    ("res", '"display_name": "Beau Lebens", "location": "Golden, CO", "company": "Automattic"  cost_usd 0'),
    ("ans", "Beau Lebens, per the public Gravatar profile for that address. They're based in Golden, CO.\n"
            "They lead WooCommerce at Automattic and previously worked on Jetpack and WordPress.com.\n"
            "Cost: $0 (one Gravatar lookup, free)."),
]
PAGE = """<!doctype html><meta charset=utf-8><style>
body{margin:0;background:#0b0b0c;width:960px;height:540px;font:15.5px/1.55 'Geist Mono',ui-monospace,monospace;color:#e8e8e4}
.bar{height:38px;background:#151518;border-bottom:1px solid #26262a;display:flex;align-items:center;gap:8px;padding:0 16px}
.bar i{width:12px;height:12px;border-radius:50%;background:#2f2f34;display:block}.bar b{margin-left:12px;font-weight:500;color:#8a8a85;font-size:14px}
pre{margin:0;padding:20px 26px;white-space:pre-wrap;word-break:break-word;font:inherit}
.p{color:#ff6b2c}.d{color:#8a8a85}.t{color:#7fb7ff}.r{color:#9ad27a}.a{color:#f2f2f0}.q{color:#f2f2f0;background:#1a1a1e;display:block;padding:6px 10px;border-left:3px solid #ff6b2c}
.cur{background:#e8e8e4;color:#0b0b0c}
</style><div class=bar><i></i><i></i><i></i><b>Claude Code + toolrelay MCP · real run</b></div><pre id=t></pre>"""

def render(kind, text):
    if kind == "cmd": return f'<span class=p>$ </span>{E(text)}\n'
    if kind == "out": return f'<span class=d>{E(text)}</span>\n\n'
    if kind == "ask": return f'<span class=q>&gt; {E(text)}</span>\n'
    if kind == "tool": return f'<span class=t>● {E(text)}</span>\n'
    if kind == "res": return f'<span class=r>  ⎿ {E(text)}</span>\n'
    return f'\n<span class=a>{E(text)}</span>\n'

def frames():
    done, out = "", []
    for kind, text in STEPS:
        if kind in ("cmd", "ask"):
            pre = '<span class=p>$ </span>' if kind == "cmd" else '<span class=q>&gt; '
            post = '' if kind == "cmd" else '</span>'
            for i in range(0, len(text) + 4, 4):
                out.append((done + pre + E(text[:i]) + '<span class=cur> </span>' + post, 4))
            done += render(kind, text); out.append((done, 30))
        else:
            done += render(kind, text); out.append((done, 90 if kind != "ans" else 500))
    return out

with tempfile.TemporaryDirectory() as d, sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 960, "height": 540}); pg.set_content(PAGE)
    lst = []
    for n, (h, cs) in enumerate(frames()):
        pg.evaluate("h => document.getElementById('t').innerHTML = h", h)
        f = os.path.join(d, f"{n:04d}.png"); pg.screenshot(path=f); lst.append(f"file '{f}'\nduration {cs/100}")
    b.close()
    open(os.path.join(d, "l.txt"), "w").write("\n".join(lst) + f"\nfile '{f}'\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(d, "l.txt"),
                    "-vf", "split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none", OUT], check=True)
print(OUT, os.path.getsize(OUT))
