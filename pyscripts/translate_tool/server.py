"""Local HTTP server hosting the translation editor.

Standard library only (no extra dependencies). Endpoints:

    GET  /worklist   -> {target, languages, items, done, total}
    POST /save       -> {source, path, value}; writes it, returns {ok}
    POST /regenerate -> runs the site generator, returns {ok, output}

The editor paginates rendering and tracks progress client-side, so it stays
responsive with thousands of fields. Run via ``python -m pyscripts.translate_tool``.
"""

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .worklist import LANGUAGES, SITE_ROOT, build_worklist, set_by_path, words_done, words_total


def make_handler(target_lang: str):
    languages = {code: cfg.get("label", code) for code, cfg in LANGUAGES.items()}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # keep the console quiet

        def _send(self, code, body, ctype="application/json; charset=utf-8"):
            data = body.encode("utf-8") if isinstance(body, str) else body
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            length = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            if self.path == "/" or self.path.startswith("/index"):
                self._send(200, EDITOR_HTML, "text/html; charset=utf-8")
            elif self.path == "/worklist":
                items = build_worklist()
                self._send(200, json.dumps({
                    "target": target_lang, "languages": languages,
                    "items": items, "done": words_done(items, target_lang),
                    "total": words_total(items),
                }, ensure_ascii=False))
            else:
                self._send(404, json.dumps({"error": "not found"}))

        def do_POST(self):
            if self.path == "/save":
                payload = self._body()
                try:
                    set_by_path(payload["source"], payload["path"], payload.get("value", ""))
                except Exception as exc:
                    self._send(400, json.dumps({"ok": False, "error": str(exc)}))
                    return
                # Progress is tracked client-side, so saving only writes the value —
                # no need to rebuild the whole worklist on every keystroke.
                self._send(200, json.dumps({"ok": True}))
            elif self.path == "/regenerate":
                proc = subprocess.run(
                    [sys.executable, "-m", "pyscripts.site_generator.generate_site"],
                    cwd=str(SITE_ROOT), capture_output=True, text=True,
                )
                tail = (proc.stdout + proc.stderr).strip().splitlines()[-12:]
                self._send(200, json.dumps({"ok": proc.returncode == 0,
                                            "output": "\n".join(tail)}))
            else:
                self._send(404, json.dumps({"error": "not found"}))

    return Handler


def serve(target_lang: str, port: int):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(target_lang))
    label = LANGUAGES.get(target_lang, {}).get("label", target_lang)
    print(f"Translation editor (tracking {label!r} / {target_lang}) → http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


EDITOR_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Translation editor</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --line:#e3e6ea; --accent:#2f7d5b; --muted:#6b7280; --target:#0e7490; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:#1f2430; }
  header { position:sticky; top:0; z-index:10; background:var(--card); border-bottom:1px solid var(--line);
           padding:12px 18px; box-shadow:0 1px 4px rgba(0,0,0,.04); }
  h1 { font-size:15px; margin:0 0 8px; }
  .bar { height:9px; background:var(--line); border-radius:6px; overflow:hidden; }
  .bar > div { height:100%; background:var(--accent); width:0; transition:width .2s; }
  .controls { display:flex; gap:10px; align-items:center; margin-top:8px; flex-wrap:wrap; font-size:13px; }
  .controls input[type=search] { flex:1; min-width:160px; padding:6px 10px; border:1px solid var(--line); border-radius:6px; }
  .count { color:var(--muted); font-size:13px; }
  .pager { display:flex; gap:8px; align-items:center; }
  .pager button { border:1px solid var(--line); background:#fff; border-radius:6px; padding:5px 10px; cursor:pointer; font-size:13px; }
  .pager button:disabled { opacity:.45; cursor:default; }
  .help { font-size:12px; color:var(--muted); margin-top:8px; line-height:1.5; }
  .help code { background:#eef1f4; padding:1px 5px; border-radius:4px; }
  button.rebuild { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:6px 12px; font-size:13px; cursor:pointer; }
  button.rebuild:disabled { opacity:.6; cursor:default; }
  #rebuildOut { font-size:12px; color:var(--muted); margin-top:6px; white-space:pre-wrap;
                font-family:ui-monospace,Menlo,monospace; max-height:120px; overflow:auto; }
  main { max-width:1000px; margin:0 auto; padding:16px; }
  .group { margin:18px 0 8px; font-weight:600; color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.04em; }
  .item { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 14px 4px; margin:8px 0; }
  .item.done { border-left:4px solid var(--accent); }
  .field { font-size:12px; color:var(--muted); margin-bottom:6px; }
  .lang { display:grid; grid-template-columns:48px 1fr 24px; gap:8px; align-items:start; margin-bottom:8px; }
  .lc { color:var(--accent); font-weight:700; font-size:11px; text-transform:uppercase; padding-top:8px; }
  .lang.is-target .lc { color:var(--target); }
  textarea { width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:6px;
             font-family:inherit; font-size:14px; line-height:1.45; resize:vertical; overflow:hidden; }
  .lang.is-target textarea { border-color:var(--target); }
  .st { font-size:13px; padding-top:8px; }
  .st.saved { color:var(--accent); }
  .st.error { color:#b3261e; cursor:help; }
  label.chk { display:flex; gap:5px; align-items:center; cursor:pointer; user-select:none; }
  .pagerow { display:flex; justify-content:center; margin:14px 0; }
</style>
</head>
<body>
<header>
  <h1 id="title">Translation editor</h1>
  <div class="bar"><div id="barfill"></div></div>
  <div class="controls">
    <span class="count" id="count"></span>
    <label class="chk"><input type="checkbox" id="onlyTodo"> untranslated only</label>
    <input type="search" id="search" placeholder="filter by text or group…">
    <div class="pager">
      <button id="prev">‹ Prev</button>
      <span id="pageInfo" class="count"></span>
      <button id="next">Next ›</button>
    </div>
    <button class="rebuild" id="rebuildBtn">↻ Rebuild site</button>
  </div>
  <div class="help" id="help"></div>
  <div id="rebuildOut"></div>
</header>
<main id="list"></main>
<div class="pagerow">
  <div class="pager">
    <button id="prev2">‹ Prev</button>
    <span id="pageInfo2" class="count"></span>
    <button id="next2">Next ›</button>
  </div>
</div>
<script>
const PAGE_SIZE = 30;
let DATA = { items: [], done: 0, total: 0, target: "", languages: {} };
let LANGS = [];
let view = [];     // items after filter/search
let page = 0;

function isDone(it) { return !!(it.langs[DATA.target] && it.langs[DATA.target].value); }

function computeProgress() {
  let d = 0, t = 0;
  for (const it of DATA.items) {
    const w = it.weight || 1;
    t += w;
    if (isDone(it)) d += w;
  }
  DATA.done = d; DATA.total = t;
  const pct = t ? Math.round(d / t * 100) : 0;
  document.getElementById('barfill').style.width = pct + '%';
  const tl = DATA.languages[DATA.target] || DATA.target;
  document.getElementById('count').textContent =
    tl + ': ' + d.toLocaleString() + ' / ' + t.toLocaleString() + ' words (' + pct + '%)';
}

function buildView() {
  const onlyTodo = document.getElementById('onlyTodo').checked;
  const q = document.getElementById('search').value.trim().toLowerCase();
  view = DATA.items.filter(it => {
    if (onlyTodo && isDone(it)) return false;
    if (q) {
      const vals = LANGS.map(l => (it.langs[l] && it.langs[l].value) || '').join(' ');
      if (!(it.group + ' ' + it.field + ' ' + vals).toLowerCase().includes(q)) return false;
    }
    return true;
  });
  page = 0;
  renderPage();
}

function pageCount() { return Math.max(1, Math.ceil(view.length / PAGE_SIZE)); }

function renderPage() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  const start = page * PAGE_SIZE;
  const slice = view.slice(start, start + PAGE_SIZE);
  let shownGroup = null;
  for (const it of slice) {
    if (it.group !== shownGroup) {
      shownGroup = it.group;
      const g = document.createElement('div');
      g.className = 'group'; g.textContent = it.group;
      list.appendChild(g);
    }
    list.appendChild(itemEl(it));
  }
  const info = view.length
    ? `${start + 1}–${Math.min(start + PAGE_SIZE, view.length)} of ${view.length.toLocaleString()} · page ${page + 1}/${pageCount()}`
    : 'nothing matches';
  for (const id of ['pageInfo', 'pageInfo2']) document.getElementById(id).textContent = info;
  for (const id of ['prev', 'prev2']) document.getElementById(id).disabled = page <= 0;
  for (const id of ['next', 'next2']) document.getElementById(id).disabled = page >= pageCount() - 1;
  window.scrollTo(0, 0);
}

function autoGrow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

function itemEl(it) {
  const div = document.createElement('div');
  div.className = 'item' + (isDone(it) ? ' done' : '');
  const field = document.createElement('div');
  field.className = 'field'; field.textContent = it.field;
  div.appendChild(field);

  for (const lc of LANGS) {
    const slot = it.langs[lc];
    if (!slot) continue;
    const row = document.createElement('div');
    row.className = 'lang' + (lc === DATA.target ? ' is-target' : '');
    const label = document.createElement('div');
    label.className = 'lc'; label.textContent = lc;
    const ta = document.createElement('textarea');
    ta.rows = 1; ta.value = slot.value || '';
    ta.placeholder = (DATA.languages[lc] || lc) + '…';
    const st = document.createElement('div');
    st.className = 'st';
    row.appendChild(label); row.appendChild(ta); row.appendChild(st);
    div.appendChild(row);
    requestAnimationFrame(() => autoGrow(ta));

    let timer = null;
    const save = () => {
      if (ta.value === (slot.value || '')) return;
      st.textContent = '…'; st.className = 'st';
      fetch('/save', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ source: it.source, path: slot.path, value: ta.value }) })
        .then(r => r.json())
        .then(res => {
          if (!res.ok) throw new Error(res.error || 'save failed');
          slot.value = ta.value.trim() ? ta.value : null;
          div.className = 'item' + (isDone(it) ? ' done' : '');
          st.textContent = '✓'; st.className = 'st saved';
          computeProgress();
        })
        .catch(e => { st.textContent = '!'; st.title = e.message; st.className = 'st error'; });
    };
    ta.addEventListener('input', () => { autoGrow(ta); clearTimeout(timer); timer = setTimeout(save, 800); });
    ta.addEventListener('blur', () => { clearTimeout(timer); save(); });
  }
  return div;
}

function goto(delta) {
  const np = Math.min(Math.max(0, page + delta), pageCount() - 1);
  if (np !== page) { page = np; renderPage(); }
}

let searchTimer = null;
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(searchTimer); searchTimer = setTimeout(buildView, 250);
});
document.getElementById('onlyTodo').addEventListener('change', buildView);
for (const id of ['prev', 'prev2']) document.getElementById(id).addEventListener('click', () => goto(-1));
for (const id of ['next', 'next2']) document.getElementById(id).addEventListener('click', () => goto(1));

document.getElementById('rebuildBtn').addEventListener('click', () => {
  const btn = document.getElementById('rebuildBtn');
  const out = document.getElementById('rebuildOut');
  btn.disabled = true; btn.textContent = '↻ Rebuilding…'; out.textContent = '';
  fetch('/regenerate', { method:'POST' }).then(r => r.json()).then(res => {
    out.textContent = (res.ok ? '✓ Site rebuilt. Reload the site to see your changes.\n' : '✗ Rebuild failed:\n') + (res.output || '');
  }).catch(e => { out.textContent = '✗ ' + e.message; })
    .finally(() => { btn.disabled = false; btn.textContent = '↻ Rebuild site'; });
});

fetch('/worklist').then(r => r.json()).then(d => {
  DATA = d; LANGS = Object.keys(d.languages);
  const tl = d.languages[d.target] || d.target;
  document.getElementById('title').textContent = 'Translation editor — every language editable (tracking ' + tl + ')';
  document.getElementById('help').innerHTML =
    'Edit any language inline; changes autosave. When done, click <b>Rebuild site</b> ' +
    '(or run <code>.venv/bin/python -m pyscripts.site_generator.generate_site</code>), then reload the site.';
  computeProgress();
  buildView();
});
</script>
</body>
</html>
"""
