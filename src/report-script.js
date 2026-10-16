/* Lightweight maintenance report UI
   - Loads issues from window.__ISSUES_JSON_PATH
   - Renders cards, filters, table, and detail panel
*/
(function(){
  'use strict';
  const root = document.getElementById('maintenance-root');
  const issuesPath = window.__ISSUES_JSON_PATH || './issues.json';

  function el(tag, cls, txt){ const e = document.createElement(tag); if(cls) e.className = cls; if(txt!==undefined) e.textContent = txt; return e; }

  function severityClass(s){ switch((s||'').toLowerCase()){ case 'critical': return 'severity-critical'; case 'high': return 'severity-high'; case 'medium': return 'severity-medium'; default: return 'severity-low'; }}

  function csvEscape(v){ if(v==null) return ''; const s = String(v).replace(/"/g,'""'); return '"'+s+'"'; }

  async function fetchIssues(){ try{ const res = await fetch(issuesPath); return await res.json(); } catch(err){ console.error(err); return []; } }

  function buildUI(){
    root.innerHTML = '';
    const container = el('div','container');
    // top
    const top = el('div','topbar');
    top.appendChild(el('div','brand','Maintenance Report'));
    const tabs = el('div','tabs');
    ['All Issues','Conversion & SEO','Technical & Performance','Visual / UX'].forEach((t,i)=>{
      const btn = el('button','tab',t+' (0)'); if(i===0) btn.classList.add('active'); tabs.appendChild(btn);
    });
    top.appendChild(tabs);
    container.appendChild(top);

    // toolbar
    const toolbar = el('div','toolbar');
    const filters = el('div','filters');
    filters.appendChild(el('input','input')); filters.querySelector('input').placeholder='Search...';
    const cat = el('select','input'); cat.innerHTML='<option value="">All categories</option>'; filters.appendChild(cat);
    const sev = el('select','input'); sev.innerHTML='<option value="">All severities</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option>'; filters.appendChild(sev);
    const vp = el('select','input'); vp.innerHTML='<option value="">All viewports</option>'; filters.appendChild(vp);
    toolbar.appendChild(filters);
    const actions = el('div','sticky-actions');
    const btnShare = el('button','btn','Share'); actions.appendChild(btnShare);
    const btnCSV = el('button','btn secondary','CSV export'); actions.appendChild(btnCSV);
    const btnXLS = el('button','btn secondary','Excel export'); actions.appendChild(btnXLS);
    toolbar.appendChild(actions);
    container.appendChild(toolbar);

    // cards
    const cardRow = el('div','card-row');
    ['Total Issues','Critical','High','Medium','Low'].forEach((c)=>{
      const card = el('div','card'); card.innerHTML=`<div class="label">${c}</div><div class="value">0</div>`; cardRow.appendChild(card);
    });
    container.appendChild(cardRow);

    // table
    const tblWrap = el('div','table-wrap');
    const table = document.createElement('table');
    const thead = document.createElement('thead'); thead.innerHTML='<tr><th>Issue</th><th>Severity</th><th># Pages</th><th>Impact</th><th>Difficulty</th><th>Actions</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody'); table.appendChild(tbody);
    tblWrap.appendChild(table);
    container.appendChild(tblWrap);

    root.appendChild(container);

    return {container,filters,cat,sev,vp,tbody,cardRow,btnCSV,btnXLS,btnShare};
  }

  function renderCounts(issues, ui){
    const counts = {total: issues.length, critical:0, high:0, medium:0, low:0};
    issues.forEach(i=>{ const s=(i.severity||'').toLowerCase(); if(s==='critical') counts.critical++; else if(s==='high') counts.high++; else if(s==='medium') counts.medium++; else counts.low++; });
    const cards = ui.cardRow.querySelectorAll('.card');
    cards[0].querySelector('.value').textContent = counts.total;
    cards[1].querySelector('.value').textContent = counts.critical;
    cards[2].querySelector('.value').textContent = counts.high;
    cards[3].querySelector('.value').textContent = counts.medium;
    cards[4].querySelector('.value').textContent = counts.low;
  }

  function populateFilters(issues, ui){
    const cats = new Set(); const vps = new Set();
    issues.forEach(i=>{ cats.add(i.category||''); vps.add(i.viewport||''); });
    ui.cat.innerHTML = '<option value="">All categories</option>' + Array.from(cats).sort().map(c=>`<option>${c}</option>`).join('');
    ui.vp.innerHTML = '<option value="">All viewports</option>' + Array.from(vps).sort().map(v=>`<option>${v}</option>`).join('');
  }

  function renderTable(issues, ui, filters){
    const tbody = ui.tbody; tbody.innerHTML='';
    const frag = document.createDocumentFragment();
    for (const it of issues) {
      const tr = document.createElement('tr');
      const tdIssue = document.createElement('td'); tdIssue.innerHTML = `<div style="font-weight:600">${it.issue}</div><div class="muted">${it.category} — ${it.url}</div>`;
      const tdSev = document.createElement('td'); tdSev.innerHTML = `<span class="badgeb ${severityClass(it.severity)}">${it.severity}</span>`;
      const tdPages = document.createElement('td'); tdPages.textContent = '1';
      const tdImpact = document.createElement('td'); tdImpact.textContent = it.impact || '';
      const tdDiff = document.createElement('td'); tdDiff.textContent = it.difficulty || '';
      const tdActions = document.createElement('td'); tdActions.innerHTML = `<button class="btn">Guide</button>`;
      tr.appendChild(tdIssue); tr.appendChild(tdSev); tr.appendChild(tdPages); tr.appendChild(tdImpact); tr.appendChild(tdDiff); tr.appendChild(tdActions);
      tr.addEventListener('click', ()=> showDetails(it));
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  function showDetails(issue){
    const rootContainer = document.querySelector('.container');
    let panel = document.getElementById('issue-details');
    if(panel) panel.remove();
    panel = el('div','details'); panel.id='issue-details';
    const thumb = el('div','thumb');
    if(issue.screenshot){ const img = el('img'); img.src = issue.screenshot; thumb.appendChild(img); } else thumb.appendChild(el('div','muted','No screenshot'));
    const body = el('div','detail-body');
    body.innerHTML = `<div style="font-weight:700">${issue.issue}</div><div class="muted">${issue.category} • ${issue.viewport} • ${issue.timestamp}</div><p style="margin-top:8px">${issue.recommendation}</p>`;
    panel.appendChild(thumb); panel.appendChild(body);
    rootContainer.appendChild(panel);
    // clickable full image
    if(issue.screenshot){ const img = panel.querySelector('img'); img.style.cursor='pointer'; img.addEventListener('click', ()=>{ const m = document.createElement('div'); m.style.position='fixed'; m.style.inset='0'; m.style.background='rgba(0,0,0,0.8)'; m.style.display='flex'; m.style.alignItems='center'; m.style.justifyContent='center'; m.style.zIndex='9999'; const im = img.cloneNode(); im.style.maxWidth='90%'; im.style.maxHeight='90%'; m.appendChild(im); m.addEventListener('click', ()=>m.remove()); document.body.appendChild(m); }); }
  }

  function exportCSV(issues){
    const headers = ['site','url','category','issue','severity','viewport','impact','difficulty','recommendation','screenshot','timestamp'];
    const rows = [headers.join(',')];
    for(const i of issues){ rows.push(headers.map(h=>csvEscape(i[h])).join(',')); }
    const blob = new Blob([rows.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='issues.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function exportXLS(issues){
    // simple HTML table excel-compatible
    let html = '<table><tr><th>site</th><th>url</th><th>category</th><th>issue</th><th>severity</th><th>viewport</th><th>impact</th><th>difficulty</th><th>recommendation</th><th>timestamp</th></tr>';
    for(const i of issues){ html += `<tr><td>${i.site||''}</td><td>${i.url||''}</td><td>${i.category||''}</td><td>${i.issue||''}</td><td>${i.severity||''}</td><td>${i.viewport||''}</td><td>${i.impact||''}</td><td>${i.difficulty||''}</td><td>${i.recommendation||''}</td><td>${i.timestamp||''}</td></tr>`; }
    html += '</table>';
    const blob = new Blob([html], {type:'application/vnd.ms-excel'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='issues.xls'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // wire up
  fetchIssues().then(issues=>{
    const ui = buildUI();
    renderCounts(issues, ui);
    populateFilters(issues, ui);
    renderTable(issues, ui,{ });
    ui.btnCSV.addEventListener('click', ()=> exportCSV(issues));
    ui.btnXLS.addEventListener('click', ()=> exportXLS(issues));
    ui.btnShare.addEventListener('click', ()=>{ navigator.clipboard?.writeText(location.href).then(()=>alert('Report URL copied to clipboard'))});
    // basic search
    ui.filters.querySelector('input').addEventListener('input', (ev)=>{ const q = ev.target.value.toLowerCase(); const filtered = issues.filter(i=> (i.issue||'').toLowerCase().includes(q) || (i.url||'').toLowerCase().includes(q)); renderCounts(filtered, ui); renderTable(filtered, ui); });
    ui.cat.addEventListener('change', ()=>{ const v=ui.cat.value; const filtered = issues.filter(i=> !v || i.category===v); renderCounts(filtered, ui); renderTable(filtered, ui); });
    ui.sev.addEventListener('change', ()=>{ const v=ui.sev.value; const filtered = issues.filter(i=> !v || i.severity===v); renderCounts(filtered, ui); renderTable(filtered, ui); });
    ui.vp.addEventListener('change', ()=>{ const v=ui.vp.value; const filtered = issues.filter(i=> !v || i.viewport===v); renderCounts(filtered, ui); renderTable(filtered, ui); });
  });

})();
