import { useEffect, useMemo, useRef } from 'react';
import { XmlResult, XmlChange } from '../types';
import { SaveTextFile } from '../../wailsjs/go/main/App';

interface XmlDiffViewProps {
  result: XmlResult;
}

// What each side needs to highlight, located via the EXACT anchors the
// define.xml stylesheet emits (no fuzzy text matching):
//   - vars: regular variable rows, found by the per-row anchor
//       <a id="IG.<DOMAIN>.<ItemDefOID>"> in the first cell; we tint only the
//       columns that changed (name|label|type|role|length|terms|origin).
//   - values: value-level (VLM) sub-rows, found inside the VLM block (rows whose
//       class carries the parent ItemDef OID) and matched by "<whereVar> = ...".
//   - codelists: a codelist div#CL.CL.<OID>; we tint only the changed term rows
//       (by CodedValue text) and the caption only when captionChanged.
//   - ids: other anchored elements (Methods/Comments) tinted whole.
interface VarLoc {
  anchorId: string; // IG.<DOMAIN>.<ItemDefOID>
  kind: string;
  cols: string[]; // empty ⇒ whole row
}
interface ValueLoc {
  parentOid: string; // IT.<DOM>.<VAR>
  whereVar: string;
  whereVal: string;
  kind: string;
  cols: string[];
}
interface CodeListLoc {
  id: string; // CL.CL.<OID> (rendered container id)
  kind: string;
  caption: boolean;
  items: { value: string; kind: string }[];
}
interface Payload {
  ids: Record<string, string>;
  vars: VarLoc[];
  values: ValueLoc[];
  codelists: CodeListLoc[];
}

function buildPayload(changes: XmlChange[], side: 'a' | 'b'): Payload {
  const ids: Record<string, string> = {};
  const vars: VarLoc[] = [];
  const values: ValueLoc[] = [];
  const codelists: CodeListLoc[] = [];
  for (const c of changes) {
    if (c.kind === 'removed' && side !== 'a') continue;
    if (c.kind === 'added' && side !== 'b') continue;
    if (c.elemType === 'ItemDef' && c.valueLevel && c.parentOid) {
      values.push({
        parentOid: c.parentOid,
        whereVar: c.whereVar ?? '',
        whereVal: c.whereVal ?? '',
        kind: c.kind,
        cols: c.cols ?? [],
      });
    } else if (c.elemType === 'ItemDef' && c.domain) {
      // The rendered per-row anchor id is "IG.<DOMAIN>.<ItemDefOID>".
      vars.push({ anchorId: `IG.${c.domain}.${c.oid}`, kind: c.kind, cols: c.cols ?? [] });
    } else if (c.elemType === 'CodeList') {
      // Container id is doubled because the OID already starts with "CL.".
      codelists.push({
        id: `${c.idPrefix}${c.oid}`,
        kind: c.kind,
        caption: !!c.captionChanged,
        // A removed term exists only on the OLD (a) side; an added term only on
        // the NEW (b) side. Modified terms exist on both. Filter per side so we
        // don't hunt for a term that isn't rendered on this side.
        items: (c.items ?? []).filter(
          it =>
            it.kind === 'modified' ||
            (it.kind === 'removed' && side === 'a') ||
            (it.kind === 'added' && side === 'b')
        ),
      });
    } else if (c.idPrefix) {
      ids[`${c.idPrefix}${c.oid}`] = c.kind;
    }
  }
  return { ids, vars, values, codelists };
}

function transform(xml: string | undefined, xsl: string | undefined, payload: Payload) {
  if (!xml) return { html: null as string | null };
  if (!xsl) return { html: null, error: 'no stylesheet found next to the file' };
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, 'application/xml');
    const xslDoc = parser.parseFromString(xsl, 'application/xml');
    if (xmlDoc.querySelector('parsererror') || xslDoc.querySelector('parsererror')) {
      return { html: null, error: 'XML/XSL parse error' };
    }
    const proc = new XSLTProcessor();
    proc.importStylesheet(xslDoc);
    const out = proc.transformToDocument(xmlDoc);
    const html = '<!DOCTYPE html>' + new XMLSerializer().serializeToString(out.documentElement);
    return { html: instrument(html, payload) };
  } catch (e) {
    return { html: null, error: String(e) };
  }
}

// Inject highlight + linked-scroll script. Highlighting is GROUP-SCOPED: for a
// changed ItemDef we find the ItemGroup's rendered block (the element after the
// `IG.<domain>` anchor) and tint only the row inside it whose name matches — so
// CO.STUDYID highlights in the CO block but TA.STUDYID does not.
function instrument(html: string, p: Payload): string {
  const inject = `
<style>
  .shtuka-added { background: rgba(34,197,94,0.20) !important; outline:1px solid rgba(34,197,94,0.55); }
  .shtuka-removed { background: rgba(239,68,68,0.20) !important; outline:1px solid rgba(239,68,68,0.55); }
  .shtuka-modified { background: rgba(245,158,11,0.22) !important; outline:1px solid rgba(245,158,11,0.55); }
  .shtuka-flash { background: rgba(99,102,241,0.4) !important; }
</style>
<script>
(function(){
  var ids = ${JSON.stringify(p.ids)};
  var vars = ${JSON.stringify(p.vars)};
  var values = ${JSON.stringify(p.values)};
  var codelists = ${JSON.stringify(p.codelists)};
  function tintEl(el, kind){ if(el) el.classList.add('shtuka-'+kind); }
  function mark(el){ if(el) el.setAttribute('data-chg','1'); }

  // Map a variable table's columns to td indices by reading its header <th>
  // text. The define.xml variable table has fixed columns but their ORDER can
  // vary slightly by stylesheet version, so resolve by keyword, not constant.
  function colIndex(table){
    var map = { name:0, label:1, type:2, role:3, length:4, terms:5, origin:6 }; // sane default
    if(!table || !table.rows) return map;
    for(var r=0;r<table.rows.length;r++){
      var ths = table.rows[r].getElementsByTagName('th');
      if(!ths.length) continue;
      var labels=[];
      for(var i=0;i<table.rows[r].children.length;i++) labels.push((table.rows[r].children[i].textContent||'').toLowerCase());
      function find(){ for(var a=0;a<arguments.length;a++){ for(var ci=0;ci<labels.length;ci++){ if(labels[ci].indexOf(arguments[a])>=0) return ci; } } return -1; }
      var m={};
      m.name=find('variable'); m.label=find('label','description'); m.type=find('type');
      m.role=find('role'); m.length=find('length','display format'); m.terms=find('controlled terms','iso format','codelist','format');
      m.origin=find('origin','source','method','comment');
      for(var k in m){ if(m[k]>=0) map[k]=m[k]; }
      break;
    }
    return map;
  }
  // Tint the cells of the row for the given semantic columns. Empty cols = whole row.
  function tintRowCols(row, kind, cols){
    if(!cols || !cols.length){ tintEl(row, kind); mark(row); return; }
    var table = row.closest ? row.closest('table') : null;
    var map = colIndex(table);
    var tds = row.children;
    var any=false;
    cols.forEach(function(col){
      var idx = map[col];
      if(idx!=null && idx>=0 && idx<tds.length){ tintEl(tds[idx], kind); any=true; }
    });
    if(any) mark(row); else { tintEl(row, kind); mark(row); }
  }

  function apply(){
    // Other anchored elements (Methods/Comments) — tint whole.
    Object.keys(ids).forEach(function(id){ var e=document.getElementById(id); tintEl(e, ids[id]); mark(e); });

    // Regular variable rows: locate by the exact per-row anchor the XSL emits.
    vars.forEach(function(v){
      var a = document.getElementById(v.anchorId);
      if(!a) return;
      var row = a.closest ? a.closest('tr') : null;
      if(!row) return;
      if(v.kind==='modified') tintRowCols(row, 'modified', v.cols);
      else { tintEl(row, v.kind); mark(row); }
    });

    // Value-level (VLM) rows: the parent variable's VLM block is made of <tr>
    // whose className contains the parent ItemDef OID. Within it, match the row
    // whose where-clause cell reads '<whereVar> = "<whereVal>"'.
    values.forEach(function(v){
      var rows = document.getElementsByTagName('tr');
      for(var i=0;i<rows.length;i++){
        var cn = rows[i].className||'';
        if(cn.indexOf('vlm')<0 || cn.indexOf(v.parentOid)<0) continue;
        var txt = (rows[i].textContent||'');
        // where-clause text looks like: EGTESTCD = "EGALL" (...)
        if(v.whereVar && txt.indexOf(v.whereVar)<0) continue;
        if(v.whereVal && txt.indexOf(v.whereVal)<0) continue;
        if(v.kind==='modified') tintRowCols(rows[i], 'modified', v.cols);
        else { tintEl(rows[i], v.kind); mark(rows[i]); }
        break;
      }
    });

    // CodeLists: tint only the changed TERM rows (by CodedValue text), and the
    // caption only when the codelist's own attributes changed. An added/removed
    // whole codelist tints its container.
    codelists.forEach(function(cl){
      var cont = document.getElementById(cl.id);
      if(!cont) return;
      if(cl.kind!=='modified'){ tintEl(cont, cl.kind); mark(cont); return; }
      if(cl.caption){
        var cap = cont.querySelector ? cont.querySelector('.codelist-caption') : null;
        tintEl(cap||cont, 'modified'); mark(cap||cont);
      }
      var trs = cont.getElementsByTagName('tr');
      (cl.items||[]).forEach(function(it){
        for(var i=0;i<trs.length;i++){
          if(trs[i].getElementsByTagName('th').length) continue; // skip header
          var firstTd = trs[i].getElementsByTagName('td')[0];
          if(!firstTd) continue;
          // First cell renders 'CODEDVALUE [*]' — compare the leading token.
          var cv = (firstTd.textContent||'').replace(/\\s*\\[.*$/,'').trim();
          if(cv===it.value){ tintEl(trs[i], it.kind); mark(trs[i]); break; }
        }
      });
    });
  }
  if(document.readyState!=='loading') apply();
  else document.addEventListener('DOMContentLoaded', apply);

  // --- In-page links: intercept #anchor clicks and scroll, never navigate
  // (navigating an about:srcdoc document would blank the iframe). Empty inline
  // <a name="..."> anchors don't scroll reliably via scrollIntoView, so compute
  // the absolute document Y and set scrollTop directly. ---
  function gotoAnchor(id){
    var t = document.getElementById(id);
    if(!t){ var n=document.getElementsByName(id); t = n && n[0]; }
    if(!t) return false;
    // Empty inline <a id> anchors have no reliable offsetTop; use the rect
    // relative to current scroll, which is correct for inline elements too.
    var cur = document.documentElement.scrollTop || document.body.scrollTop || 0;
    var y = t.getBoundingClientRect().top + cur - 4;
    window.scrollTo(0, y);
    return true;
  }
  document.addEventListener('click', function(e){
    var el = e.target;
    while(el && el.tagName!=='A') el = el.parentElement;
    if(!el) return;
    var href = el.getAttribute('href') || '';
    if(href.charAt(0)==='#' && href.length>1){
      e.preventDefault();
      gotoAnchor(decodeURIComponent(href.slice(1)));
    }
  }, true);

  // --- Linked scroll by ANCHOR alignment ---
  // The two documents share per-domain anchors (IG.IG.<OID>). We sync by "which
  // anchor is at the top + how far past it", so the columns realign at every
  // domain instead of drifting like a single global percentage.
  function anchorEls(){
    var list = [];
    // Use ALL stable section/element anchors as alignment points — not just the
    // ItemGroup (IG.*) ones. The Methods, CodeList, and external-dictionary
    // sections come AFTER the datasets and have their own anchors (compmethod,
    // decodelist, MT.*, CL.*, datasets, externaldictionary); without these the
    // columns drift apart once you scroll past the last ItemGroup.
    // Match both id= and name= anchors. The CodeList/Controlled-Terms section
    // emits per-codelist anchors (CL.*) and, in some stylesheets, name= rather
    // than id= — without them this whole section has no alignment points and the
    // two columns drift apart exactly where content differs most.
    var sel = '[id^="IG."],[id^="CL."],[id^="MT."],[id^="AR."],[id^="VL."],[id^="CM."],'+
      '[id="datasets"],[id="compmethod"],[id="decodelist"],[id="codelists"],'+
      '[id="externaldictionary"],[id="comment"],[id="valuemeta"],'+
      'a[name^="IG."],a[name^="CL."],a[name^="MT."],a[name^="CM."]';
    var as = document.querySelectorAll(sel);
    var seen = {};
    for(var i=0;i<as.length;i++){
      var id = as[i].id || as[i].getAttribute('name');
      if(!id || seen[id]) continue; // de-dupe id/name pointing at same place
      seen[id] = 1;
      var top = as[i].getBoundingClientRect().top + (document.documentElement.scrollTop||document.body.scrollTop);
      list.push({ id: id, top: top });
    }
    list.sort(function(x,y){ return x.top - y.top; });
    return list;
  }
  var anchors = [];
  function rebuild(){ anchors = anchorEls(); }
  function curScroll(){ return document.documentElement.scrollTop||document.body.scrollTop; }
  // Report current position relative to the nearest anchor above. We send the
  // NEXT anchor's id and a fraction of the way toward it, so the other side maps
  // PROPORTIONALLY within the same segment — essential when a section (e.g. a
  // CodeList with many added/removed terms) is a very different height on the
  // two sides. A raw pixel offset would overshoot badly there. The pixel offset
  // is kept as a fallback for the final segment (no next anchor).
  function report(){
    if(!anchors.length) rebuild();
    var y = curScroll();
    var idx = -1;
    for(var i=0;i<anchors.length;i++){ if(anchors[i].top<=y+2) idx=i; else break; }
    if(idx<0){ parent.postMessage({ shtukaTop: y, side: window.name }, '*'); return; }
    var cur = anchors[idx], next = anchors[idx+1];
    var msg = { shtukaAnchor: cur.id, shtukaOffset: y-cur.top, side: window.name };
    if(next){
      var span = next.top - cur.top;
      msg.shtukaNextId = next.id;
      msg.shtukaFrac = span>0 ? (y-cur.top)/span : 0;
    }
    parent.postMessage(msg, '*');
  }
  var ticking=false;
  window.addEventListener('scroll', function(){
    if(ticking) return; ticking=true;
    requestAnimationFrame(function(){ report(); ticking=false; });
  });
  // --- Jump to next/previous change (highlighted element) ---
  function changeEls(){
    var els = document.querySelectorAll('.shtuka-added,.shtuka-removed,.shtuka-modified');
    var arr=[];
    for(var i=0;i<els.length;i++){
      arr.push({ el: els[i], top: els[i].getBoundingClientRect().top + curScroll() });
    }
    arr.sort(function(x,y){ return x.top-y.top; });
    return arr;
  }
  function jumpChange(dir){
    var arr = changeEls();
    if(!arr.length) return;
    var y = curScroll();
    var target=null;
    if(dir>0){ for(var i=0;i<arr.length;i++){ if(arr[i].top>y+6){ target=arr[i]; break; } } if(!target) target=arr[0]; }
    else { for(var j=arr.length-1;j>=0;j--){ if(arr[j].top<y-6){ target=arr[j]; break; } } if(!target) target=arr[arr.length-1]; }
    var top = target.top - 60;
    window.scrollTo(0, top<0?0:top);
    target.el.classList.add('shtuka-flash');
    setTimeout(function(){ target.el.classList.remove('shtuka-flash'); }, 800);
  }

  window.addEventListener('message', function(e){
    var d=e.data; if(!d) return;
    if(d.shtukaNext){ jumpChange(1); return; }
    if(d.shtukaPrev){ jumpChange(-1); return; }
    if(d.shtukaAnchor){
      if(!anchors.length) rebuild();
      function byId(id){ for(var i=0;i<anchors.length;i++){ if(anchors[i].id===id) return anchors[i]; } return null; }
      var cur=byId(d.shtukaAnchor);
      if(!cur) return;
      var top;
      // Proportional mapping within the [cur,next] segment when both anchors
      // exist on this side too — re-syncs at every section regardless of height.
      var nxt = (d.shtukaNextId!=null) ? byId(d.shtukaNextId) : null;
      if(nxt && typeof d.shtukaFrac==='number'){
        top = cur.top + (nxt.top - cur.top) * d.shtukaFrac;
      } else {
        top = cur.top + (d.shtukaOffset||0);
      }
      document.documentElement.scrollTop=top; document.body.scrollTop=top;
    } else if(typeof d.shtukaTop==='number'){
      document.documentElement.scrollTop=d.shtukaTop; document.body.scrollTop=d.shtukaTop;
    }
  });
  // Anchor positions shift once the page fully lays out; rebuild after load.
  window.addEventListener('load', rebuild);
  setTimeout(rebuild, 500);
})();
</script>`;
  const i = html.lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + inject + html.slice(i) : html + inject;
}

export function XmlDiffView({ result }: XmlDiffViewProps) {
  const aRef = useRef<HTMLIFrameElement>(null);
  const bRef = useRef<HTMLIFrameElement>(null);
  const syncing = useRef(false);
  const changes = result.changes ?? [];

  const a = useMemo(
    () => transform(result.xmlA, result.xslA, buildPayload(changes, 'a')),
    [result.xmlA, result.xslA, changes]
  );
  const b = useMemo(
    () => transform(result.xmlB, result.xslB, buildPayload(changes, 'b')),
    [result.xmlB, result.xslB, changes]
  );
  const base = (p: string) => p.split(/[/\\]/).pop() || p;

  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, modified: 0 };
    for (const ch of changes) c[ch.kind]++;
    return c;
  }, [changes]);

  // Linked scroll by shared anchors: relay one iframe's {anchor,offset} (or raw
  // top before the first anchor) to the other, which realigns to the same anchor.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || (d.side !== 'a' && d.side !== 'b')) return;
      const isScroll = d.shtukaAnchor !== undefined || typeof d.shtukaTop === 'number';
      if (!isScroll) return;
      if (syncing.current) {
        syncing.current = false;
        return;
      }
      const target = d.side === 'a' ? bRef.current : aRef.current;
      if (target?.contentWindow) {
        syncing.current = true;
        const msg =
          d.shtukaAnchor !== undefined
            ? {
                shtukaAnchor: d.shtukaAnchor,
                shtukaOffset: d.shtukaOffset,
                shtukaNextId: d.shtukaNextId,
                shtukaFrac: d.shtukaFrac,
              }
            : { shtukaTop: d.shtukaTop };
        target.contentWindow.postMessage(msg, '*');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [a.html, b.html]);

  // Export a standalone HTML report: both highlighted sides side by side, in
  // two iframes (srcdoc) so the original define.xml styling + scripts survive.
  const exportReport = async () => {
    if (!a.html && !b.html) return;
    const esc = (s: string) => s.replace(/"/g, '&quot;');
    const enc = (s: string | null) => (s ? esc(s) : '');
    const title = `define.xml diff — ${base(result.pathA)} vs ${base(result.pathB)}`;
    const doc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif}
  .bar{padding:6px 12px;background:#f3f4f6;border-bottom:1px solid #ddd;font-size:13px;display:flex;gap:16px}
  .grid{display:flex;height:calc(100vh - 40px)}
  .col{flex:1;display:flex;flex-direction:column;min-width:0;border-right:2px solid #cbd5e1}
  .col:last-child{border-right:0}
  .lbl{padding:4px 10px;font-size:11px;font-weight:600;border-bottom:1px solid #eee}
  .old{color:#b91c1c;background:#fef2f2}.new{color:#15803d;background:#f0fdf4}
  iframe{flex:1;width:100%;border:0;background:#fff}
  .bar button{font-size:12px;padding:2px 8px;border:1px solid #c7c9d1;border-radius:4px;background:#fff;cursor:pointer}
  .bar button#nextBtn{background:#4f46e5;color:#fff;border-color:#4f46e5}
</style></head>
<body>
  <div class="bar">
    <span style="color:#15803d">${counts.added} added</span>
    <span style="color:#b91c1c">${counts.removed} removed</span>
    <span style="color:#b45309">${counts.modified} modified</span>
    <button id="prevBtn" title="Previous change" style="margin-left:8px">↑</button>
    <button id="nextBtn" title="Next change">Next change ↓</button>
    <span style="margin-left:auto;color:#888">left: old · right: new</span>
  </div>
  <div class="grid">
    <div class="col"><div class="lbl old">OLD · ${base(result.pathA)}</div>
      <iframe id="fa" name="a" sandbox="allow-scripts allow-same-origin" srcdoc="${enc(a.html)}"></iframe></div>
    <div class="col"><div class="lbl new">NEW · ${base(result.pathB)}</div>
      <iframe id="fb" name="b" sandbox="allow-scripts allow-same-origin" srcdoc="${enc(b.html)}"></iframe></div>
  </div>
  <script>
  // Relay anchor-aligned scroll between the two iframes, and drive change
  // navigation (same protocol as the app). The NEW side carries the highlights.
  (function(){
    var fa=document.getElementById('fa'), fb=document.getElementById('fb'), syncing=false;
    window.addEventListener('message', function(e){
      var d=e.data; if(!d||(d.side!=='a'&&d.side!=='b')) return;
      if(d.shtukaAnchor===undefined && typeof d.shtukaTop!=='number') return;
      if(syncing){ syncing=false; return; }
      var tgt=(d.side==='a'?fb:fa); if(!tgt||!tgt.contentWindow) return;
      syncing=true;
      var msg = d.shtukaAnchor!==undefined ? {shtukaAnchor:d.shtukaAnchor,shtukaOffset:d.shtukaOffset,shtukaNextId:d.shtukaNextId,shtukaFrac:d.shtukaFrac} : {shtukaTop:d.shtukaTop};
      tgt.contentWindow.postMessage(msg,'*');
    });
    function jump(dir){
      var w=(fb||fa).contentWindow; if(!w) return;
      w.postMessage(dir>0?{shtukaNext:true}:{shtukaPrev:true}, '*');
    }
    document.getElementById('nextBtn').addEventListener('click', function(){ jump(1); });
    document.getElementById('prevBtn').addEventListener('click', function(){ jump(-1); });
  })();
  </script>
</body></html>`;
    const name = `${base(result.pathB).replace(/\.xml$/i, '')}_diff.html`;
    try {
      await SaveTextFile(name, doc);
    } catch (e) {
      console.error('export failed', e);
    }
  };

  // Drive change navigation off the NEW (B) side, which carries added/modified
  // highlights; linked-scroll then syncs the OLD side. Falls back to A.
  const jump = (dir: 1 | -1) => {
    const w = (bRef.current || aRef.current)?.contentWindow;
    if (w) w.postMessage(dir > 0 ? { shtukaNext: true } : { shtukaPrev: true }, '*');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-3 text-xs flex-shrink-0">
        <span className="text-green-700">{counts.added} added</span>
        <span className="text-red-700">{counts.removed} removed</span>
        <span className="text-amber-700">{counts.modified} modified</span>
        {(counts.added + counts.modified + counts.removed) > 0 && (
          <span className="flex items-center gap-1">
            <button onClick={() => jump(-1)} className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-100" title="Previous change">↑</button>
            <button onClick={() => jump(1)} className="px-1.5 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700" title="Next change">Next change ↓</button>
          </span>
        )}
        {result.notes && result.notes.length > 0 && (
          <span className="text-amber-700">⚠ {result.notes.join('; ')}</span>
        )}
        <span className="ml-auto text-[10px] text-gray-400">left: old · right: new</span>
        <button
          onClick={exportReport}
          className="px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Export HTML
        </button>
      </div>
      <div className="flex-1 flex overflow-hidden divide-x-2 divide-gray-300">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-3 py-1 text-[11px] font-medium text-red-700 bg-red-50 border-b border-red-100 truncate">
            OLD · {base(result.pathA)}
          </div>
          {a.html ? (
            <iframe ref={aRef} name="a" title="old" srcDoc={a.html} sandbox="allow-scripts allow-same-origin" className="flex-1 w-full border-0 bg-white" />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-4 text-center">{a.error ?? 'no document'}</div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-3 py-1 text-[11px] font-medium text-green-700 bg-green-50 border-b border-green-100 truncate">
            NEW · {base(result.pathB)}
          </div>
          {b.html ? (
            <iframe ref={bRef} name="b" title="new" srcDoc={b.html} sandbox="allow-scripts allow-same-origin" className="flex-1 w-full border-0 bg-white" />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-4 text-center">{b.error ?? 'no document'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
