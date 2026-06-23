import { useEffect, useMemo, useRef } from 'react';
import { XmlResult, XmlChange } from '../types';
import { SaveTextFile } from '../../wailsjs/go/main/App';

interface XmlDiffViewProps {
  result: XmlResult;
}

// What each side needs to highlight: anchored ids (ItemGroup/CodeList) and
// group-scoped variable rows. Each changed variable carries its kind and the
// set of changed attribute keys so the UI tints only the affected cell(s).
interface VarChange {
  kind: string;
  keys: string[]; // changed attribute names (Length, DataType, ...)
}
interface Payload {
  ids: Record<string, string>; // anchor id -> kind
  groups: Record<string, Record<string, VarChange>>; // domain -> { varName: VarChange }
}

function buildPayload(changes: XmlChange[], side: 'a' | 'b'): Payload {
  const ids: Record<string, string> = {};
  const groups: Record<string, Record<string, VarChange>> = {};
  for (const c of changes) {
    if (c.kind === 'removed' && side !== 'a') continue;
    if (c.kind === 'added' && side !== 'b') continue;
    if (c.idPrefix) {
      ids[`${c.idPrefix}${c.oid}`] = c.kind;
    } else if (c.elemType === 'ItemDef' && c.domain && c.varName) {
      (groups[c.domain] ||= {})[c.varName] = { kind: c.kind, keys: c.changedKeys ?? [] };
    }
  }
  return { ids, groups };
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
  var groups = ${JSON.stringify(p.groups)};
  function tintEl(el, kind){ if(el) el.classList.add('shtuka-'+kind); }
  // The ItemGroup anchor the stylesheet emits is <a id="IG.<ItemGroupOID>"/> and
  // the ItemGroup OID is itself "IG.<domain>" — so the real id is "IG.IG.<domain>".
  // The anchor is empty; the variable table is its next element sibling(s).
  function groupContainer(domain){
    var anchor = document.getElementById('IG.IG.'+domain) || document.getElementById('IG.'+domain);
    if(!anchor) return null;
    // Walk forward to the nearest following element that contains a table.
    var node = anchor.nextElementSibling;
    for(var i=0;i<8 && node;i++){
      if(node.tagName==='TABLE') return node;
      if(node.querySelector && node.querySelector('table')) return node;
      node = node.nextElementSibling;
    }
    // Fallback: a containerbox ancestor holding a table.
    var up = anchor.parentElement;
    for(var j=0;j<6 && up;j++){
      if(up.querySelector && up.querySelector('table')) return up;
      up = up.parentElement;
    }
    return null;
  }
  // Map an XML attribute name to the rendered cell's stable CSS class (the XSL
  // tags data cells: Length/Display-Format -> td.number, Type -> td.datatype,
  // Role -> td.role). Cell classes are reliable across domains, unlike header
  // text. Returns null when there's no class-based target.
  function cellClassFor(key){
    switch(key){
      case 'Length': case 'SignificantDigits': case 'DisplayFormat': return 'number';
      case 'DataType': return 'datatype';
      case 'Role': return 'role';
      default: return null;
    }
  }
  // Header keyword fallback for attributes without a stable cell class.
  function headerKeywords(key){
    switch(key){
      case 'Name': return ['variable'];
      case 'Origin': return ['origin','source','method','comment'];
      case 'Mandatory': return ['mandatory','core'];
      case 'CodeListOID': return ['controlled terms','codelist','format'];
      default: return [key.toLowerCase()];
    }
  }
  function headerLabels(row){
    var table = row.closest ? row.closest('table') : null;
    if(!table) return [];
    // header row = the row containing <th> cells (not necessarily the first tr)
    var rows = table.rows || [];
    for(var r=0;r<rows.length;r++){
      if(rows[r].getElementsByTagName('th').length){
        var ths = rows[r].children, labels=[];
        for(var i=0;i<ths.length;i++) labels.push((ths[i].textContent||'').toLowerCase());
        return labels;
      }
    }
    return [];
  }
  // Tint only the cells in a row affected by the changed keys. Prefer the cell's
  // own class (robust); else match by header keyword; else tint whole row.
  function tintCells(row, kind, keys){
    if(!keys || !keys.length){ tintEl(row, kind); return; }
    var tds = row.children;
    var any = false;
    var labels = null;
    keys.forEach(function(key){
      var cls = cellClassFor(key);
      if(cls){
        for(var i=0;i<tds.length;i++){
          if(tds[i].className && tds[i].className.indexOf(cls)>=0){ tintEl(tds[i], kind); any=true; }
        }
        return;
      }
      if(labels===null) labels = headerLabels(row);
      var kws = headerKeywords(key);
      for(var ci=0; ci<labels.length && ci<tds.length; ci++){
        for(var k=0;k<kws.length;k++){
          if(labels[ci].indexOf(kws[k])>=0){ tintEl(tds[ci], kind); any=true; break; }
        }
      }
    });
    if(!any) tintEl(row, kind); // nothing matched -> highlight row so nothing is missed
  }
  function apply(){
    // anchored elements (ItemGroup/CodeList) by id
    Object.keys(ids).forEach(function(id){ tintEl(document.getElementById(id), ids[id]); });
    // group-scoped ItemDef rows: locate row by variable name, tint changed cells
    Object.keys(groups).forEach(function(domain){
      var cont = groupContainer(domain);
      if(!cont) return;
      var wanted = groups[domain];
      var cells = cont.getElementsByTagName('td');
      for(var i=0;i<cells.length;i++){
        var t=(cells[i].textContent||'').trim();
        if(wanted.hasOwnProperty(t)){
          var row = cells[i].closest ? cells[i].closest('tr') : cells[i].parentNode;
          if(row){
            var info = wanted[t];
            if(info.kind === 'modified') tintCells(row, 'modified', info.keys);
            else tintEl(row, info.kind); // added/removed variable -> whole row
            row.setAttribute('data-chg', domain+'.'+t);
          }
        }
      }
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
    var as = document.querySelectorAll(
      'a[id^="IG."],a[id^="CL."],a[id^="MT."],a[id^="AR."],a[id^="VL."],'+
      'a[id="datasets"],a[id="compmethod"],a[id="decodelist"],a[id="externaldictionary"],a[id="comment"]'
    );
    for(var i=0;i<as.length;i++){
      var top = as[i].getBoundingClientRect().top + (document.documentElement.scrollTop||document.body.scrollTop);
      list.push({ id: as[i].id, top: top });
    }
    list.sort(function(x,y){ return x.top - y.top; });
    return list;
  }
  var anchors = [];
  function rebuild(){ anchors = anchorEls(); }
  function curScroll(){ return document.documentElement.scrollTop||document.body.scrollTop; }
  // Report current position as {id, offset} relative to the nearest anchor above.
  function report(){
    if(!anchors.length) rebuild();
    var y = curScroll();
    var cur = null;
    for(var i=0;i<anchors.length;i++){ if(anchors[i].top<=y+2) cur=anchors[i]; else break; }
    if(cur){
      parent.postMessage({ shtukaAnchor: cur.id, shtukaOffset: y-cur.top, side: window.name }, '*');
    } else {
      parent.postMessage({ shtukaTop: y, side: window.name }, '*');
    }
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
      var found=null;
      for(var i=0;i<anchors.length;i++){ if(anchors[i].id===d.shtukaAnchor){ found=anchors[i]; break; } }
      if(found){ var top=found.top + (d.shtukaOffset||0); document.documentElement.scrollTop=top; document.body.scrollTop=top; }
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
            ? { shtukaAnchor: d.shtukaAnchor, shtukaOffset: d.shtukaOffset }
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
      var msg = d.shtukaAnchor!==undefined ? {shtukaAnchor:d.shtukaAnchor,shtukaOffset:d.shtukaOffset} : {shtukaTop:d.shtukaTop};
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
