'use strict'
// Hublo — bureau (POC). Vanilla JS.

const $ = s => document.querySelector(s)
const api = {
  async post (url, body) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify(body||{}) })
    const d = await r.json().catch(()=>({})); if (!r.ok) throw new Error(d.error||('Erreur '+r.status)); return d
  },
  async get (url) {
    const r = await fetch(url, { credentials:'same-origin' })
    const d = await r.json().catch(()=>({})); if (!r.ok) throw new Error(d.error||('Erreur '+r.status)); return d
  }
}
let ME = null

function toast (msg) {
  let t = $('#toast'); if (!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600)
}

/* ---------------- LOGIN ---------------- */
async function boot () {
  try { ME = await api.get('/api/me'); enterDesktop() } catch { /* reste sur login */ }
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault()
  const btn=$('#login-btn'), err=$('#login-error'); err.textContent=''
  btn.disabled=true; btn.textContent='Connexion…'
  try {
    ME = await api.post('/api/login', { username:$('#login-user').value.trim(), password:$('#login-pass').value })
    $('#login-pass').value=''; enterDesktop()
  } catch (ex){ err.textContent = ex.message }
  finally { btn.disabled=false; btn.textContent='Se connecter →' }
})
function enterDesktop () {
  $('#login').classList.add('hidden')
  $('#desktop').classList.remove('hidden')
  $('#menu-user').textContent = ME.username
  openApp('finder')
}
$('#menu-logout').addEventListener('click', async ()=>{ try{await api.post('/api/logout')}catch{} location.reload() })

/* clock */
function tick(){ const d=new Date(); const days=['dim','lun','mar','mer','jeu','ven','sam']
  $('#menu-clock').textContent = days[d.getDay()]+' '+d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+'  '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) }
setInterval(tick,1000); tick()

/* ---------------- WINDOW MANAGER ---------------- */
let zCounter = 100
const openWins = {}   // app -> {el, ...}
function focusWin (el){ el.style.zIndex = ++zCounter }

function createWindow (app, { title, w=560, h=380, x, y }) {
  const el = document.createElement('div')
  el.className='win'
  el.style.width=w+'px'; el.style.height=h+'px'
  el.style.left=(x ?? (90 + Object.keys(openWins).length*28))+'px'
  el.style.top =(y ?? (60 + Object.keys(openWins).length*24))+'px'
  el.innerHTML = `<div class="titlebar">
      <div class="lights"><span class="light r"></span><span class="light y"></span><span class="light g"></span></div>
      <div class="title"></div></div>
    <div class="win-body"></div>`
  el.querySelector('.title').textContent = title
  $('#windows').appendChild(el)
  requestAnimationFrame(()=>el.classList.add('open'))
  focusWin(el)
  el.addEventListener('mousedown', ()=>focusWin(el))

  // traffic lights
  el.querySelector('.light.r').addEventListener('click', e=>{ e.stopPropagation(); closeWin(app) })
  el.querySelector('.light.y').addEventListener('click', e=>{ e.stopPropagation(); el.classList.add('min'); markDock(app,false) })
  el.querySelector('.light.g').addEventListener('click', e=>{ e.stopPropagation(); el.classList.toggle('zoom')
    if (el.classList.contains('zoom')){ el._prev={w:el.style.width,h:el.style.height,l:el.style.left,t:el.style.top}
      el.style.left='30px'; el.style.top='40px'; el.style.width=(innerWidth-60)+'px'; el.style.height=(innerHeight-120)+'px' }
    else if(el._prev){ el.style.width=el._prev.w; el.style.height=el._prev.h; el.style.left=el._prev.l; el.style.top=el._prev.t }
    el._onresize && el._onresize() })

  // drag
  const tb = el.querySelector('.titlebar')
  tb.addEventListener('mousedown', e=>{
    if (e.target.classList.contains('light')) return
    const ox=e.clientX-el.offsetLeft, oy=e.clientY-el.offsetTop
    const mv=ev=>{ el.style.left=Math.max(0,ev.clientX-ox)+'px'; el.style.top=Math.max(26,ev.clientY-oy)+'px' }
    const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up) }
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up)
  })
  return el
}
function closeWin (app){ const w=openWins[app]; if(!w)return; w.cleanup&&w.cleanup(); w.el.remove(); delete openWins[app]; markDock(app,false) }
function markDock (app, running){ const d=document.querySelector(`.dock-item[data-app="${app}"]`); if(d)d.classList.toggle('running',!!running) }

document.querySelectorAll('.dock-item').forEach(d=>d.addEventListener('click',()=>openApp(d.dataset.app)))
function openApp (app){
  const w=openWins[app]
  if (w){ w.el.classList.remove('min'); focusWin(w.el); markDock(app,true); $('#menu-active').textContent=w.title||app; return }
  if (app==='finder') return openFinder()
  if (app==='terminal') return openTerminal()
  if (app==='monitor') return openMonitor()
  if (app==='textedit') return openTextEdit(null)
  if (app==='about') return openAbout()
}

/* ---------------- FINDER ---------------- */
function icoFor (e){ if(e.type==='dir')return'📁'; if(e.type==='link')return'🔗'
  const x=(e.name.split('.').pop()||'').toLowerCase()
  if(['png','jpg','jpeg','gif','webp','svg'].includes(x))return'🖼️'
  if(['mp3','wav','flac','ogg'].includes(x))return'🎵'; if(['mp4','mov','mkv','webm'].includes(x))return'🎬'
  if(['zip','tar','gz','tgz','rar','7z'].includes(x))return'🗜️'; if(['pdf'].includes(x))return'📕'
  if(['js','ts','vue','php','py','sh','json','html','css','c','cpp','go','rs','md','conf','yml','yaml'].includes(x))return'📜'
  return'📄' }

function openFinder (startPath){
  const el = createWindow('finder', { title:'Finder', w:640, h:430 })
  const body = el.querySelector('.win-body')
  body.innerHTML = `<div class="finder-bar">
      <button class="fbtn" data-a="back" title="Précédent">‹</button>
      <button class="fbtn" data-a="up" title="Dossier parent">↑</button>
      <button class="fbtn" data-a="reload" title="Rafraîchir">⟳</button>
      <span class="fpath"></span>
      <button class="fbtn" data-a="import" title="Importer des fichiers">⬆ Importer</button>
      <button class="fbtn" data-a="dl" disabled>⬇ Télécharger</button>
      <button class="fbtn" data-a="mkdir">Nouveau dossier</button>
      <button class="fbtn" data-a="rename" disabled>Renommer</button>
      <button class="fbtn" data-a="del" disabled>Supprimer</button>
    </div><div class="grid"></div>
    <input type="file" multiple class="upl" style="display:none">`
  const grid=body.querySelector('.grid'), pathEl=body.querySelector('.fpath')
  const state={ path:startPath||ME.home, parent:null, sel:null, hist:[] }
  openWins.finder={ el, title:'Finder' }
  markDock('finder',true); $('#menu-active').textContent='Finder'

  async function load (p, push=true){
    try{
      const d=await api.get('/api/fs/list?path='+encodeURIComponent(p))
      if(push && state.path && state.path!==d.path) state.hist.push(state.path)
      state.path=d.path; state.parent=d.parent; state.sel=null
      pathEl.textContent=d.path
      grid.innerHTML=''
      if(!d.entries.length){ grid.innerHTML='<div class="finder-empty">Dossier vide</div>' }
      d.entries.forEach(e=>{
        const c=document.createElement('div'); c.className='cell'
        c.innerHTML=`<div class="ic">${icoFor(e)}</div><div class="nm"></div>`
        c.querySelector('.nm').textContent=e.name
        c.addEventListener('click',()=>{ grid.querySelectorAll('.cell').forEach(x=>x.classList.remove('sel')); c.classList.add('sel'); state.sel=e
          body.querySelector('[data-a=rename]').disabled=false; body.querySelector('[data-a=del]').disabled=false
          body.querySelector('[data-a=dl]').disabled=(e.type==='dir') })
        c.addEventListener('dblclick',()=>{ const full=join(state.path,e.name)
          if(e.type==='dir') load(full)
          else if(isImage(e.name)) openPreview(full)
          else openTextEdit(full) })
        // drag & drop : la cellule est déplaçable ; un dossier accepte qu'on dépose dessus
        c.draggable=true
        c.addEventListener('dragstart',ev=>{ ev.dataTransfer.setData('application/x-hublo',e.name); ev.dataTransfer.effectAllowed='move' })
        if(e.type==='dir'){
          c.addEventListener('dragover',ev=>{ if(ev.dataTransfer.types.includes('application/x-hublo')||ev.dataTransfer.types.includes('Files')){ ev.preventDefault(); c.classList.add('drop') } })
          c.addEventListener('dragleave',()=>c.classList.remove('drop'))
          c.addEventListener('drop',async ev=>{ ev.preventDefault(); ev.stopPropagation(); c.classList.remove('drop')
            const folder=join(state.path,e.name)
            if(ev.dataTransfer.files.length){ await uploadFiles(ev.dataTransfer.files,folder); load(state.path,false); return }
            const src=ev.dataTransfer.getData('application/x-hublo'); if(!src||src===e.name)return
            try{ await api.post('/api/fs/rename',{from:join(state.path,src),to:join(folder,src)}); load(state.path,false); toast('Déplacé → '+e.name) }catch(ex){ toast(ex.message) } })
        }
        grid.appendChild(c)
      })
      body.querySelector('[data-a=up]').disabled = !d.parent
      body.querySelector('[data-a=rename]').disabled=true; body.querySelector('[data-a=del]').disabled=true
    }catch(ex){ toast(ex.message) }
  }
  body.querySelector('[data-a=up]').addEventListener('click',()=>{ if(state.parent) load(state.parent) })
  body.querySelector('[data-a=back]').addEventListener('click',()=>{ const p=state.hist.pop(); if(p) load(p,false) })
  body.querySelector('[data-a=reload]').addEventListener('click',()=>load(state.path,false))
  body.querySelector('[data-a=mkdir]').addEventListener('click',async()=>{ const n=prompt('Nom du nouveau dossier :'); if(!n)return
    try{ await api.post('/api/fs/mkdir',{path:join(state.path,n)}); load(state.path,false); toast('Dossier créé') }catch(ex){ toast(ex.message) } })
  body.querySelector('[data-a=rename]').addEventListener('click',async()=>{ if(!state.sel)return; const n=prompt('Nouveau nom :',state.sel.name); if(!n||n===state.sel.name)return
    try{ await api.post('/api/fs/rename',{from:join(state.path,state.sel.name),to:join(state.path,n)}); load(state.path,false); toast('Renommé') }catch(ex){ toast(ex.message) } })
  body.querySelector('[data-a=del]').addEventListener('click',async()=>{ if(!state.sel)return; if(!confirm('Supprimer « '+state.sel.name+' » ?'))return
    try{ await api.post('/api/fs/delete',{path:join(state.path,state.sel.name)}); load(state.path,false); toast('Supprimé') }catch(ex){ toast(ex.message) } })
  // Importer (bouton + input caché)
  const upl=body.querySelector('.upl')
  body.querySelector('[data-a=import]').addEventListener('click',()=>upl.click())
  upl.addEventListener('change',async()=>{ if(!upl.files.length)return; await uploadFiles(upl.files,state.path); upl.value=''; load(state.path,false) })
  // Télécharger le fichier sélectionné
  body.querySelector('[data-a=dl]').addEventListener('click',()=>{ if(!state.sel||state.sel.type==='dir')return
    const a=document.createElement('a'); a.href='/api/fs/download?path='+encodeURIComponent(join(state.path,state.sel.name)); a.download=state.sel.name; document.body.appendChild(a); a.click(); a.remove() })
  // Déposer des fichiers depuis l'OS sur la zone Finder → import dans le dossier courant
  grid.addEventListener('dragover',ev=>{ if(ev.dataTransfer.types.includes('Files')){ ev.preventDefault(); grid.classList.add('drop') } })
  grid.addEventListener('dragleave',ev=>{ if(ev.target===grid) grid.classList.remove('drop') })
  grid.addEventListener('drop',async ev=>{ grid.classList.remove('drop'); if(!ev.dataTransfer.files.length)return; ev.preventDefault(); await uploadFiles(ev.dataTransfer.files,state.path); load(state.path,false) })
  load(state.path,false)
}
function join (dir,name){ return (dir==='/'?'':dir)+'/'+name }
async function uploadFiles (files,destDir){
  for(const f of files){ const fd=new FormData(); fd.append('file',f)
    try{ const r=await fetch('/api/fs/upload?path='+encodeURIComponent(destDir),{method:'POST',credentials:'same-origin',body:fd})
      const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||'import'); toast('Importé : '+d.name) }
    catch(ex){ toast(ex.message) } }
}

/* ---------------- TEXTEDIT ---------------- */
async function openTextEdit (path){
  let el=openWins.textedit?.el
  if(!el){ el=createWindow('textedit',{title:'TextEdit',w:600,h:420}); openWins.textedit={el,title:'TextEdit'} }
  el.classList.remove('min'); focusWin(el); markDock('textedit',true); $('#menu-active').textContent='TextEdit'
  const body=el.querySelector('.win-body')
  body.style.display='flex'; body.style.flexDirection='column'
  body.innerHTML=`<div class="te-bar"><span class="te-name">Nouveau document</span>
      <button class="fbtn" data-a="save" disabled>Enregistrer</button><span class="te-status"></span></div>
      <textarea class="te-area" spellcheck="false" placeholder="—"></textarea>`
  const area=body.querySelector('.te-area'), nameEl=body.querySelector('.te-name'),
        saveBtn=body.querySelector('[data-a=save]'), status=body.querySelector('.te-status')
  let curPath=path
  if(path){
    nameEl.textContent=path; status.textContent='chargement…'
    try{ const d=await api.get('/api/fs/read?path='+encodeURIComponent(path)); area.value=d.content; status.textContent=fmtSize(d.size); saveBtn.disabled=false; el.querySelector('.title').textContent=baseName(path) }
    catch(ex){ status.textContent=''; area.value=''; nameEl.textContent='Nouveau document'; toast(ex.message) }
  }
  area.addEventListener('input',()=>{ if(curPath){saveBtn.disabled=false; status.textContent='• modifié'} })
  saveBtn.addEventListener('click',async()=>{ if(!curPath){ const p=prompt('Chemin du fichier à enregistrer :', ME.home+'/sans-titre.txt'); if(!p)return; curPath=p; nameEl.textContent=p; el.querySelector('.title').textContent=baseName(p) }
    try{ await api.post('/api/fs/write',{path:curPath,content:area.value}); status.textContent='enregistré ✓'; saveBtn.disabled=true; toast('Enregistré') }catch(ex){ toast(ex.message) } })
}
function baseName(p){ return p.split('/').pop() }
function fmtSize(n){ if(n<1024)return n+' o'; if(n<1048576)return (n/1024).toFixed(1)+' Ko'; return (n/1048576).toFixed(1)+' Mo' }

/* ---------------- APERÇU (image) ---------------- */
function isImage(n){ return ['png','jpg','jpeg','gif','webp','svg','bmp','ico','avif'].includes((n.split('.').pop()||'').toLowerCase()) }
function openPreview(path){
  let el=openWins.preview?.el
  if(!el){ el=createWindow('preview',{title:'Aperçu',w:560,h:440}); openWins.preview={el,title:'Aperçu'} }
  el.classList.remove('min'); focusWin(el); $('#menu-active').textContent='Aperçu'
  el.querySelector('.title').textContent=baseName(path)
  const body=el.querySelector('.win-body')
  body.style.cssText='display:flex;align-items:center;justify-content:center;background:#1b1b1d;overflow:auto'
  body.innerHTML=`<img src="/api/fs/download?path=${encodeURIComponent(path)}" style="max-width:100%;max-height:100%;object-fit:contain" alt="">`
}

/* ---------------- TERMINAL ---------------- */
function openTerminal (){
  const el=createWindow('terminal',{title:'Terminal — '+ME.username,w:660,h:400})
  const body=el.querySelector('.win-body'); body.innerHTML='<div class="term-host"></div>'
  const host=body.querySelector('.term-host')
  const term=new Terminal({ fontFamily:'ui-monospace,Menlo,Consolas,monospace', fontSize:13, theme:{background:'#1e1e1e'}, cursorBlink:true })
  const fit=new FitAddon.FitAddon(); term.loadAddon(fit); term.open(host)
  const proto=location.protocol==='https:'?'wss':'ws'
  const ws=new WebSocket(proto+'://'+location.host+'/ws/terminal')
  ws.binaryType='arraybuffer'
  const enc=new TextEncoder(), dec=new TextDecoder()
  ws.onopen=()=>{ doFit() }
  ws.onmessage=ev=>{ term.write(typeof ev.data==='string'?ev.data:new Uint8Array(ev.data)) }
  ws.onclose=()=>{ term.write('\r\n\x1b[31m[session terminée]\x1b[0m\r\n') }
  term.onData(d=>{ if(ws.readyState===1) ws.send(enc.encode(d)) })
  function doFit(){ try{ fit.fit(); if(ws.readyState===1) ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows})) }catch{} }
  el._onresize=doFit
  const ro=new ResizeObserver(()=>doFit()); ro.observe(host)
  openWins.terminal={ el, title:'Terminal', cleanup(){ try{ro.disconnect();ws.close();term.dispose()}catch{} } }
  markDock('terminal',true); $('#menu-active').textContent='Terminal'
  setTimeout(doFit,60)
}

/* ---------------- MONITEUR ---------------- */
function openMonitor (){
  const el=createWindow('monitor',{title:'Moniteur d’activité',w:560,h:420})
  const body=el.querySelector('.win-body'); body.className='win-body mon'
  body.innerHTML=`<table><thead><tr><th>PID</th><th>Utilisateur</th><th class="r">%CPU</th><th>%MEM</th><th class="r">Mém.</th><th>Process</th></tr></thead><tbody></tbody></table>`
  const tb=body.querySelector('tbody')
  async function refresh(){
    try{ const d=await api.get('/api/ps')
      tb.innerHTML=d.rows.map(r=>`<tr><td>${r.pid}</td><td>${r.user}</td>
        <td class="r">${r.cpu}</td><td><span class="bar"><i style="width:${Math.min(100,parseFloat(r.mem)*8)}%"></i></span> ${r.mem}</td>
        <td class="r">${(parseInt(r.rss)/1024).toFixed(0)} Mo</td><td>${escapeHtml(r.comm)}</td></tr>`).join('')
    }catch(ex){ toast(ex.message) }
  }
  const iv=setInterval(refresh,3000); refresh()
  openWins.monitor={ el, title:'Moniteur d’activité', cleanup(){ clearInterval(iv) } }
  markDock('monitor',true); $('#menu-active').textContent='Moniteur d’activité'
}
function escapeHtml(s){ return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) }

/* ---------------- ABOUT ---------------- */
function openAbout (){
  const el=createWindow('about',{title:'À propos de Hublo',w:380,h:300})
  el.querySelector('.win-body').innerHTML=`<div class="about"><div class="big">💧</div>
    <h2>Hublo</h2><p>Votre espace, sur le serveur — sans la console.</p>
    <p>Connecté en tant que <b>${escapeHtml(ME.username)}</b><br>via une session SSH sécurisée (vos droits Unix).</p>
    <p style="color:#aaa">POC · ${location.host}</p></div>`
  openWins.about={ el, title:'À propos de Hublo' }; markDock('about',true)
}

boot()
