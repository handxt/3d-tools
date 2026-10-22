import {HX3D} from './hx3d.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const hx=window.HX3D=new HX3D($('#c'));

// ---------- setting ----------
const S=JSON.parse(localStorage.hx3d||'{}'),save=()=>localStorage.hx3d=JSON.stringify(S);
const PRE={openai:['https://api.openai.com/v1','gpt-4o'],openrouter:['https://openrouter.ai/api/v1','anthropic/claude-sonnet-4.5'],groq:['https://api.groq.com/openai/v1','llama-3.3-70b-versatile'],ollama:['http://localhost:11434/v1','qwen2.5:14b'],proxy:['proxy.php','gpt-4o']};
for(const k of['base','key','token','model']){$('#'+k).value=S[k]||'';$('#'+k).onchange=e=>{S[k]=e.target.value.trim();save()}}
$('#preset').onchange=e=>{const p=PRE[e.target.value];if(!p)return;$('#base').value=S.base=p[0];$('#model').value=S.model=p[1];save()};
$('#shots').checked=S.shots!==false;$('#shots').onchange=e=>{S.shots=e.target.checked;save()};

// ---------- log / status ----------
const log=(c,t,img)=>{const d=document.createElement('div');d.className=c;d.textContent=t;if(img){const i=new Image();i.src=img;d.append(i)}const l=$('#log');l.append(d);l.scrollTop=l.scrollHeight;return d};
const status=t=>$('#st').textContent=t||'';
const CHIPS=['Robot kecil dengan rig dan animasi jalan','Pedang fantasi dengan gagang berukir','Pohon low-poly dengan batu di bawahnya','Rumah kecil dengan jendela dan pintu (pakai boolean)','Vas keramik dengan bentuk elegan'];
function intro(){const d=log('sys','Tulis deskripsi model, atau klik contoh di bawah. Klik objek di viewport buat pindah/putar manual (W/E/R), Ctrl+Z buat undo. Bisa juga seret file .glb/.obj/.stl ke viewport.');
 const c=document.createElement('div');c.className='chips';CHIPS.forEach(t=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.onclick=()=>{$('#p').value=t;$('#p').focus()};c.append(b)});d.append(c)}
intro();

// ---------- outliner + state tombol ----------
let busy=false,q=0;
const refresh=()=>{if(q)return;q=requestAnimationFrame(()=>{q=0;
 const L=$('#list'),items=hx.list();$('#cnt').textContent=items.length?`(${items.length})`:'';L.replaceChildren();
 if(!items.length){const e=document.createElement('div');e.className='empty';e.textContent='Kosong';L.append(e)}
 items.forEach(o=>{const r=document.createElement('div');r.className='it'+(hx.sel?.name===o.name?' sel':'')+(o.visible?'':' off');
  const n=document.createElement('span');n.className='nm';n.textContent=o.name;n.title=o.name;n.onclick=()=>hx.select(o.name);
  const t=document.createElement('em');t.textContent=o.type;
  const ev=document.createElement('button');ev.textContent=o.visible?'👁':'–';ev.title='Tampil/sembunyi';ev.disabled=busy;ev.onclick=()=>{hx.begin('Visibilitas '+o.name);hx.run('set_visible',{name:o.name,visible:!o.visible})};
  const dl=document.createElement('button');dl.textContent='✕';dl.title='Hapus';dl.disabled=busy;dl.onclick=()=>{hx.begin('Hapus '+o.name);hx.run('delete_object',{name:o.name})};
  r.append(n,t,ev,dl);L.append(r)});
 $('#undo').disabled=busy||!hx.hist.length;$('#redo').disabled=busy||!hx.undone.length})};
hx.onChange=refresh;hx.onSelect=refresh;refresh();
if(matchMedia('(max-width:800px)').matches)$('#ol').open=false; // HP: outliner tertutup default biar viewport lega

// ---------- toolbar ----------
const toggle=(id,fn)=>$(id).onclick=e=>{const on=!e.currentTarget.classList.contains('on');e.currentTarget.classList.toggle('on',on);fn(on)};
toggle('#wire',on=>hx.setWire(on));toggle('#grid',on=>hx.setGrid(on));toggle('#play',on=>hx.setPlaying(on));
$$('[data-view]').forEach(b=>b.onclick=()=>hx.setView(b.dataset.view));
const mode=m=>{hx.setMode(m);$$('[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===m))};
$$('[data-mode]').forEach(b=>b.onclick=()=>mode(b.dataset.mode));
const undo=async()=>{if(busy)return;const g=await hx.undo();if(!g)return;if(g.msgLen!=null){msgs.length=Math.min(msgs.length,g.msgLen);imgMsg=null}log('sys','↶ Undo: '+g.label);refresh()};
const redo=async()=>{if(busy)return;const g=await hx.redo();if(g){log('sys','↷ Redo: '+g.label);refresh()}};
$('#undo').onclick=undo;$('#redo').onclick=redo;
$('#exp').onclick=async()=>{const r=await hx.run('export_model',{format:$('#fmt').value});log('sys',r.ok?`Diekspor ${r.file} (${(r.bytes/1024).toFixed(0)} KB)`:r.error)};
$('#clear').onclick=()=>{if(busy)return;hx.begin('Kosongkan');hx.run('clear_scene');log('sys','Scene dikosongkan (Ctrl+Z buat balikin).')};
$('#save').onclick=()=>{const{json,skipped}=hx.saveProject();hx.download(new Blob([json],{type:'application/json'}),'proyek.hx3d.json');log('sys','Proyek disimpan'+(skipped?` (${skipped} file impor tidak ikut tersimpan)`:''))};
$('#newchat').onclick=()=>{if(busy)return;msgs.length=0;imgMsg=null;$('#log').replaceChildren();intro()};
$('#open').onclick=()=>$('#file').click();
const loadFiles=async fs=>{for(const f of fs)try{
  if(/\.(glb|gltf|obj|stl)$/i.test(f.name))log('sys','Dimuat: '+await hx.importFile(f));
  else{const bad=await hx.openProject(await f.text());hx.frame();log('sys','Proyek dimuat: '+f.name+(bad.length?`\nGagal: ${bad.join('; ')}`:''))}}catch(e){log('tool bad',e.message)}};
$('#file').onchange=e=>{loadFiles([...e.target.files]);e.target.value=''};
addEventListener('dragover',e=>e.preventDefault());addEventListener('drop',e=>{e.preventDefault();loadFiles(e.dataTransfer.files)});
addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;const k=e.key.toLowerCase(),c=e.ctrlKey||e.metaKey;
 if(c&&k==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if(c&&k==='y'){e.preventDefault();redo()}
 else if(c)return;else if(k==='w')mode('translate');else if(k==='e')mode('rotate');else if(k==='r')mode('scale');else if(k==='f')hx.setView('iso');
 else if(k==='escape')hx.select(null);else if((k==='delete'||k==='backspace')&&hx.sel&&!busy){e.preventDefault();const n=hx.sel.name;hx.begin('Hapus '+n);hx.run('delete_object',{name:n})}});

// ---------- agent ----------
const msgs=[],slimmed=new WeakSet();let imgMsg=null,ac=null;
const sleep=(ms,sig)=>new Promise((ok,no)=>{const t=setTimeout(ok,ms);sig.addEventListener('abort',()=>{clearTimeout(t);no(new DOMException('Aborted','AbortError'))},{once:true})});
const slim=()=>msgs.forEach((m,i)=>{if(m.role==='tool'&&i<msgs.length-24&&m.content.length>200&&!slimmed.has(m)){m.content=m.content.slice(0,160)+'…(dipotong)';slimmed.add(m)}}); // hemat token
async function chat(){
 const base=(S.base||'https://api.openai.com/v1').trim(),url=/\.php(\?|$)/.test(base)?base:base.replace(/\/$/,'')+'/chat/completions';
 const headers={'Content-Type':'application/json'};if(S.key)headers.Authorization='Bearer '+S.key;if(S.token)headers['X-HX-Token']=S.token;
 slim();const body=JSON.stringify({model:S.model||'gpt-4o',messages:[{role:'system',content:hx.systemPrompt},...msgs],tools:hx.openaiTools(),tool_choice:'auto'});
 for(let i=0;;i++){
  const r=await fetch(url,{method:'POST',headers,body,signal:ac.signal});
  if(r.ok){const j=await r.json(),m=j.choices?.[0]?.message;if(!m)throw Error('Respon provider kosong: '+JSON.stringify(j).slice(0,200));return m}
  const t=(await r.text()).slice(0,300);
  if(i<3&&(r.status===429||r.status>=500)){const w=Math.min((+r.headers.get('retry-after')||1.5*2**i),30)*1000;status(`Provider ${r.status}, ulang dalam ${Math.round(w/1000)}s…`);await sleep(w,ac.signal);continue}
  throw Error(`Provider ${r.status}: ${t}`)}
}
const label=(n,a)=>n==='batch'?`batch · ${a?.ops?.length||0} op`:`${n} ${JSON.stringify(a).slice(0,110)}`;
async function agent(text){
 hx.begin('AI: '+text.slice(0,40),{msgLen:msgs.length});
 msgs.push({role:'user',content:`${text}\n\n[scene] ${hx.summary()}`});
 for(let step=1;step<=40;step++){
  status(`Langkah ${step}/40 · AI mikir…`);
  const m=await chat();
  msgs.push({role:'assistant',content:m.content||'',...(m.tool_calls?.length?{tool_calls:m.tool_calls}:{})});
  if(m.content)log('ai',m.content);
  if(!m.tool_calls?.length)return;
  const shots=[];
  for(const tc of m.tool_calls){
   const push=res=>msgs.push({role:'tool',tool_call_id:tc.id,content:JSON.stringify(res)});
   if(ac.signal.aborted){push({ok:false,error:'dibatalkan user'});continue}
   let a=null;try{a=JSON.parse(tc.function.arguments||'{}')}catch{}
   const el=log('tool',label(tc.function.name,a||{}));status(`Langkah ${step}/40 · ${tc.function.name}…`);
   const res=a?await hx.run(tc.function.name,a):{ok:false,error:'argumen bukan JSON valid, kirim ulang'};
   if(res.image){if(S.shots!==false){shots.push(res.image);log('sys','',res.image)}res.image=S.shots!==false?'(dikirim sebagai gambar)':'(vision mati)'}
   if(!res.ok||res.failed){el.classList.add('bad');el.textContent+=' → '+(res.error||`#${res.failed.index} ${res.failed.tool}: ${res.failed.error}`)}
   push(res);
  }
  if(ac.signal.aborted)throw new DOMException('Aborted','AbortError');
  if(shots.length){if(imgMsg)imgMsg.content='[screenshot lama dihapus]';
   imgMsg={role:'user',content:[{type:'text',text:'Viewport screenshot. Evaluasi hasilnya, perbaiki yang salah, lanjutkan.'},...shots.map(u=>({type:'image_url',image_url:{url:u}}))]};msgs.push(imgMsg)}
 }
 log('sys','Berhenti: batas 40 langkah. Kirim "lanjut" buat lanjutin.');
}
const setBusy=b=>{busy=b;$('#go').textContent=b?'Stop':'Buat';$('#go').classList.toggle('stop',b);if(!b)status('');refresh()};
$('#f').onsubmit=async e=>{e.preventDefault();
 if(busy){ac.abort();return}
 const t=$('#p').value.trim();if(!t)return;$('#p').value='';log('me',t);ac=new AbortController();setBusy(true);
 try{await agent(t)}catch(err){log(err.name==='AbortError'?'sys':'tool bad',err.name==='AbortError'?'■ Dihentikan.':err.message)}
 setBusy(false)};
$('#p').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(pointer:fine)').matches){e.preventDefault();$('#f').requestSubmit()}}; // Enter kirim di desktop; di HP tetap baris baru
