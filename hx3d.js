// HX3D engine v2: scene + tool registry (Blender-like ops) yang dipanggil AI lewat function calling.
// Standalone: const hx = new HX3D(canvas|null); await hx.run('add_primitive',{...}); hx.openaiTools(); hx.systemPrompt
// canvas = null -> headless (tanpa renderer), cocok buat test di Node.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import * as U from 'three/addons/utils/BufferGeometryUtils.js';

const D=Math.PI/180,V=a=>new THREE.Vector3(...a),R=v=>[v.x,v.y,v.z].map(x=>+x.toFixed(3));
const str={type:'string'},num={type:'number'},v3={type:'array',items:num,minItems:3,maxItems:3},axis={type:'string',enum:['x','y','z']};
const ANG={type:'string',enum:['front','back','left','right','top','iso']};
const base={name:str,position:v3,rotation:{...v3,description:'euler degrees'},color:{type:'string',description:'#rrggbb'},metalness:num,roughness:num,flat:{type:'boolean',description:'flat shading (low-poly look)'}};
const closest=(p,a,b)=>{const ab=b.clone().sub(a),l=ab.lengthSq(),t=l?Math.max(0,Math.min(1,p.clone().sub(a).dot(ab)/l)):0;return a.clone().add(ab.multiplyScalar(t))};
const nz=(p,s,k)=>Math.sin(p.x*s+k)*Math.sin(p.y*s*1.3+k*2)*Math.sin(p.z*s*.9+k*3)+.5*Math.sin(p.x*s*2.1+p.y*s*1.7+k)*Math.cos(p.z*s*2.3+k);
const weld=g=>{g=g.clone();['uv','uv1','normal'].forEach(n=>g.deleteAttribute(n));g=U.mergeVertices(g,1e-4);g.computeVertexNormals();return g};
// balik winding tiap segitiga (dipakai setelah mirror supaya sisi depan tetap menghadap keluar)
const flipWind=g=>{if(g.index){const x=g.index.array;for(let i=0;i<x.length;i+=3){const t=x[i+1];x[i+1]=x[i+2];x[i+2]=t}}
 else for(const at of Object.values(g.attributes)){const s=at.itemSize,A=at.array;for(let i=0;i+2<at.count;i+=3)for(let k=0;k<s;k++){const t=A[(i+1)*s+k];A[(i+1)*s+k]=A[(i+2)*s+k];A[(i+2)*s+k]=t}}return g};
const mirrorGeom=(m,ax)=>{m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);
 g.applyMatrix4(new THREE.Matrix4().makeScale(ax==='x'?-1:1,ax==='y'?-1:1,ax==='z'?-1:1));return flipWind(g)};
const cloneMat=m=>Array.isArray(m)?m.map(x=>x.clone()):m.clone();
const gap=(a,b)=>Math.hypot(Math.max(0,a.min.x-b.max.x,b.min.x-a.max.x),Math.max(0,a.min.y-b.max.y,b.min.y-a.max.y),Math.max(0,a.min.z-b.max.z,b.min.z-a.max.z));

const SYS=`You are a 3D artist agent driving a Blender-like toolkit inside a web viewer. Units: meters, Y up, floor at y=0, characters face +Z and stand on the floor. Never reply with only a description: BUILD the model with tools, then verify.
A line "[scene] ..." is appended to every user message with the current objects (the user may have moved/deleted things or used undo) - trust it, don't call list_scene unless you need details.
EFFICIENCY: use the \`batch\` tool to create many parts in ONE call (10-25 ops per batch). Aim for the whole build in under ~12 steps. Don't add_primitive one at a time.
Workflow: 1) Plan parts + proportions in numbers first (adult human ~1.7m, ~7.5 heads; head ~0.23m). 2) Blockout with add_primitive / add_lathe (round: vases, torsos, bottles) / add_extrude (flat outlines, supports holes) / add_tube (limbs, tails, cables, hair, absolute coords). Primitives are centered on \`position\`; size = FULL dimensions. 3) Cuts and holes: \`boolean\` subtract with closed meshes (windows, eye sockets, mouths, bolt holes) - much cleaner than faking it. 4) Refine with modify_mesh: taper limbs, smooth, displace_noise (organic), inflate. 5) Symmetry: build ONE side, then duplicate_object with mirror:'x' (or count+offset for arrays: teeth, fence, windows). 6) set_origin before rotating things that must pivot at a joint/edge. 7) join_meshes into logical parts, set_material (limited palette, distinct color per part; roughness 0.4-0.8, metalness only for metal parts; flat:true for low-poly style). 8) If it must move: create_armature (parents before children, bone head/tail ON the real joints, names like upperarm_L, no dots/spaces), bind_skin on the finished mesh in rest pose, pose_bone to test, add_animation (first and last keyframe equal for seamless loops), play_animation to switch clips. 9) Cloth: add_cloth + simulate_cloth with colliders [{object:'torso'}] (auto capsule from an object) or explicit capsules; pin 'top' for capes. 10) Verify: validate_model (finds floating parts, floor contact, NaN), then screenshot with views:['front','right','back','top'] (ONE composite image of 4 sides). Fix what is wrong, repeat at most 2 times. 11) export_model only when the user asks.
Quality rules: no floating parts (touching or slightly overlapping), segments 24-48, meaningful unique names, simple readable silhouettes beat tiny details. Finish with a 2-3 line summary of what was built and what the user can ask next. Reply in the user's language.`;

export class HX3D{
 systemPrompt=SYS;clips=[];mixers=new Map();hist=[];undone=[];wire=false;playing=true;dirty=true;sel=null;
 onChange=()=>{};onSelect=()=>{};
 constructor(canvas){
  this.root=new THREE.Group();this.scene=new THREE.Scene();this.scene.add(this.root);
  this.cam=new THREE.PerspectiveCamera(40,1,.01,500);this.cam.position.set(3,2,4);
  this.tools=this.makeTools();
  if(canvas)this.initView(canvas);
 }
 initView(canvas){
  const r=this.r=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true}),s=this.scene;
  r.setPixelRatio(Math.min(devicePixelRatio,2));r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1;
  r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
  s.background=new THREE.Color('#171a22');
  s.environment=new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(),.04).texture; // biar metal/roughness kelihatan bagus
  s.add(new THREE.HemisphereLight('#ffffff','#445066',.5));
  const L=this.sun=new THREE.DirectionalLight('#ffffff',2.2);L.position.set(4,8,5);L.castShadow=true;L.shadow.mapSize.set(2048,2048);
  Object.assign(L.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:30});L.shadow.bias=-.0004;L.shadow.normalBias=.02;s.add(L);
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.ShadowMaterial({opacity:.28}));gnd.rotation.x=-Math.PI/2;gnd.position.y=.001;gnd.receiveShadow=true;s.add(gnd);
  this.grid=new THREE.GridHelper(10,20,'#3a4050','#262b38');s.add(this.grid);
  this.ctl=new OrbitControls(this.cam,canvas);this.ctl.target.set(0,.9,0);this.ctl.enableDamping=true;
  this.selBox=new THREE.BoxHelper(new THREE.Object3D(),'#e3b23c');this.selBox.material.transparent=true;this.selBox.material.opacity=.45;this.selBox.visible=false;s.add(this.selBox);
  const tc=this.tc=new TransformControls(this.cam,canvas);tc.size=.8;s.add(tc);
  tc.addEventListener('change',()=>{this.selBox.update();this.dirty=true});
  tc.addEventListener('objectChange',()=>this._moved=true);
  tc.addEventListener('dragging-changed',e=>{this.ctl.enabled=!e.value;const o=this.sel;
   if(!e.value&&this._moved&&o){this._moved=false;this.begin('Transform '+o.name);
    this.run('set_transform',{name:o.name,position:R(o.position),rotation:R({x:o.rotation.x/D,y:o.rotation.y/D,z:o.rotation.z/D}),scale:R(o.scale)})}});
  canvas.addEventListener('pointerdown',e=>this._pd=[e.clientX,e.clientY]);
  canvas.addEventListener('pointerup',e=>{if(!this._pd||tc.axis||Math.hypot(e.clientX-this._pd[0],e.clientY-this._pd[1])>4)return;this.pick(e)});
  const clock=new THREE.Clock(),loop=()=>{requestAnimationFrame(loop);const dt=clock.getDelta();
   if(this.playing&&this.mixers.size){this.mixers.forEach(m=>m.update(dt));this.dirty=true}
   if(this.ctl.update())this.dirty=true;if(this.fit())this.dirty=true;
   if(this.dirty){this.dirty=false;this.selBox.visible&&this.selBox.update();r.render(s,this.cam)}}; // render hanya kalau ada perubahan (hemat baterai)
  this.fit();loop();
 }
 fit(){const p=this.r.domElement.parentElement,w=p.clientWidth,h=p.clientHeight;if(w&&h&&(this._w!==w||this._h!==h)){this._w=w;this._h=h;this.r.setSize(w,h,false);this.cam.aspect=w/h;this.cam.updateProjectionMatrix();return true}return false}
 get(n){const o=this.root.children.find(c=>c.name===n);if(!o)throw Error(`objek "${n}" tidak ada. Yang ada: ${this.root.children.map(c=>c.name).join(', ')||'(kosong)'}`);return o}
 mat(o,dbl){return new THREE.MeshStandardMaterial({color:o.color||'#b8bcc4',metalness:o.metalness??0,roughness:o.roughness??.6,flatShading:!!o.flat,side:dbl?THREE.DoubleSide:THREE.FrontSide,wireframe:this.wire})}
 put(m){m.traverse(x=>{if(x.isMesh)x.castShadow=x.receiveShadow=true});this.root.add(m);this.dirty=true;return m}
 add(m,o={}){if(!o.name)throw Error('name wajib');if(this.root.children.some(c=>c.name===o.name))throw Error(`nama "${o.name}" sudah dipakai`);
  m.name=o.name;if(o.position)m.position.set(...o.position);if(o.rotation)m.rotation.set(...o.rotation.map(x=>x*D));this.put(m);return this.info(m)}
 info(o){if(o.userData.arm){const b=[];o.traverse(x=>x.isBone&&b.push(x.name));return{name:o.name,type:'armature',bones:b}}
  const bb=new THREE.Box3().setFromObject(o);return{name:o.name,type:o.isSkinnedMesh?'skinned_mesh':o.isMesh?'mesh':'group',vertices:o.geometry?.attributes.position.count,min:R(bb.min),max:R(bb.max)}}
 summary(){const o=this.root.children;if(!o.length)return'scene kosong';
  const t=o.slice(0,60).map(c=>{if(c.userData.arm){let n=0;c.traverse(x=>x.isBone&&n++);return`${c.name}(armature ${n} bones)`}
   const b=new THREE.Box3().setFromObject(c);return`${c.name}(${c.isSkinnedMesh?'skinned':c.isMesh?'mesh':'group'} ${R(b.getSize(new THREE.Vector3())).join('x')} @${R(b.getCenter(new THREE.Vector3())).join(',')}${c.visible?'':' hidden'})`}).join('; ');
  return t+(o.length>60?` ...+${o.length-60} lagi`:'')+(this.clips.length?` | clips: ${this.clips.map(c=>c.name).join(',')}`:'')}
 list(){return this.root.children.map(c=>({name:c.name,type:c.userData.arm?'armature':c.isSkinnedMesh?'skinned':c.isMesh?'mesh':'group',visible:c.visible}))}
 frame(angle='iso'){const b=new THREE.Box3().setFromObject(this.root);if(b.isEmpty())return;const c=b.getCenter(new THREE.Vector3()),rad=b.getSize(new THREE.Vector3()).length()/2||1,
   vf=this.cam.fov*D,hf=2*Math.atan(Math.tan(vf/2)*this.cam.aspect),d=rad/Math.sin(Math.min(vf,hf)/2)*1.05,
   dir={front:[0,.1,1],back:[0,.1,-1],left:[-1,.1,0],right:[1,.1,0],top:[0,1,.001],iso:[1,.7,1]}[angle]||[1,.7,1];
  this.cam.position.copy(c).add(V(dir).normalize().multiplyScalar(d));this.cam.lookAt(c);if(this.ctl){this.ctl.target.copy(c);this.ctl.update()}this.dirty=true}
 setView(v){this.frame(v)}
 setWire(on){this.wire=on;this.root.traverse(o=>o.isMesh&&[].concat(o.material).forEach(m=>m.wireframe=on));this.dirty=true}
 setGrid(on){this.grid&&(this.grid.visible=on);this.dirty=true}
 setPlaying(on){this.playing=on;this.dirty=true}
 setMode(m){this.tc?.setMode(m)}
 // ---------- seleksi ----------
 select(name){const o=name?this.root.children.find(c=>c.name===name):null;this.sel=o||null;
  if(!this.tc)return this.onSelect(o?o.name:null);
  if(o){this.tc.attach(o);this.selBox.setFromObject(o);this.selBox.visible=true}else{this.tc.detach();this.selBox.visible=false}
  this.dirty=true;this.onSelect(o?o.name:null)}
 pick(e){const rc=this._rc||=new THREE.Raycaster(),b=this.r.domElement.getBoundingClientRect();
  rc.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1),this.cam);
  const hit=rc.intersectObjects(this.root.children.filter(o=>o.visible),true)[0];if(!hit)return this.select(null);
  let o=hit.object;while(o.parent&&o.parent!==this.root)o=o.parent;this.select(o.name)}
 // ---------- history: undo / redo / simpan proyek (replay tool call) ----------
 begin(label,extra={}){const g={label,ops:[],...extra};this.hist.push(g);this.undone=[];return g}
 async run(n,a={}){const t=this.tools[n];if(!t)return{ok:false,error:'tool tidak ada: '+n};
  try{const r=await t.fn(a);if(t.mut&&!this._replay)(this.hist.at(-1)||this.begin('auto')).ops.push([n,JSON.parse(JSON.stringify(a))]);
   this.dirty=true;this.onChange(n);return{ok:true,...r}}catch(e){return{ok:false,error:e.message}}}
 async replay(ops){const bad=[];this._replay=1;try{for(const[n,a]of ops){if(n==='__import'){try{await this.load(a.file)}catch(e){bad.push('impor: '+e.message)}continue}
   const r=await this.run(n,a);if(!r.ok)bad.push(`${n}: ${r.error}`)}}finally{this._replay=0}this.onChange('replay');return bad}
 reset(){[...this.root.children].forEach(o=>this.del(o));this.clips=[];this.mixers.clear();this.select(null);this.dirty=true}
 async undo(){const g=this.hist.pop();if(!g)return null;this.undone.push(g);this.reset();await this.replay(this.hist.flatMap(x=>x.ops));return g}
 async redo(){const g=this.undone.pop();if(!g)return null;this.hist.push(g);await this.replay(g.ops);return g}
 saveProject(){const all=this.hist.flatMap(g=>g.ops),ops=all.filter(o=>o[0]!=='__import');return{json:JSON.stringify({hx3d:2,ops}),skipped:all.length-ops.length}}
 async openProject(txt){const p=JSON.parse(txt);if(!Array.isArray(p.ops))throw Error('file proyek tidak valid');
  this.reset();this.hist=[{label:'Muat proyek',ops:p.ops}];this.undone=[];return this.replay(p.ops)}
 // ---------- screenshot (resolusi tetap, bisa komposit 4 sisi) ----------
 capture(a={}){if(!this.r)throw Error('tidak ada renderer (headless)');
  const r=this.r,cam=this.cam,vs=a.views?.length>1?a.views.slice(0,4):null,W=vs?512:768,H=vs?384:576,
   keep={w:this._w,h:this._h,pr:r.getPixelRatio(),pos:cam.position.clone(),tg:this.ctl.target.clone(),asp:cam.aspect},
   hide=[this.tc,this.selBox],vis=hide.map(x=>x.visible);hide.forEach(x=>x.visible=false);
  try{r.setPixelRatio(1);r.setSize(W,H,false);cam.aspect=W/H;cam.updateProjectionMatrix();
   if(!vs){if(a.angle||a.views?.[0])this.frame(a.angle||a.views[0]);r.render(this.scene,cam);return r.domElement.toDataURL('image/jpeg',.85)}
   const cv=document.createElement('canvas');cv.width=W*2;cv.height=H*Math.ceil(vs.length/2);const x=cv.getContext('2d');
   x.fillStyle='#171a22';x.fillRect(0,0,cv.width,cv.height);x.font='bold 22px system-ui,sans-serif';
   vs.forEach((v,i)=>{this.frame(v);r.render(this.scene,cam);const ox=(i%2)*W,oy=(i>>1)*H;x.drawImage(r.domElement,ox,oy,W,H);
    x.strokeStyle='#2e3342';x.strokeRect(ox+.5,oy+.5,W-1,H-1);x.fillStyle='#e3b23c';x.fillText(v.toUpperCase(),ox+12,oy+30)});
   return cv.toDataURL('image/jpeg',.85)
  }finally{r.setPixelRatio(keep.pr);if(keep.w)r.setSize(keep.w,keep.h,false);cam.aspect=keep.asp;cam.updateProjectionMatrix();
   if(vs){cam.position.copy(keep.pos);this.ctl.target.copy(keep.tg);this.ctl.update()}hide.forEach((x,i)=>x.visible=vis[i]);this.dirty=true}}
 openaiTools(){return Object.entries(this.tools).map(([name,t])=>({type:'function',function:{name,description:t.desc,parameters:{type:'object',properties:t.props,required:t.req}}}))}
 async exportBlob(fmt='glb',names,file='model'){
  const hid=[];if(names?.length)this.root.children.forEach(c=>{if(!names.includes(c.name)){hid.push(c);c.visible=false}});
  try{let blob;
   if(fmt==='glb'||fmt==='gltf'){const bin=fmt==='glb',o=await new Promise((ok,no)=>new GLTFExporter().parse(this.root,ok,no,{binary:bin,animations:this.clips}));
    blob=bin?new Blob([o],{type:'model/gltf-binary'}):new Blob([JSON.stringify(o)],{type:'model/gltf+json'})}
   else if(fmt==='obj')blob=new Blob([new OBJExporter().parse(this.root)],{type:'text/plain'});
   else if(fmt==='stl')blob=new Blob([new STLExporter().parse(this.root,{binary:true})],{type:'model/stl'});
   else throw Error('format harus glb|gltf|obj|stl');
   return{blob,filename:`${file}.${fmt}`}}finally{hid.forEach(c=>c.visible=true)}}
 download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5e3)}
 async load(f){const ext=f.name.split('.').pop().toLowerCase();let o;
  if(ext==='glb'||ext==='gltf')o=(await new GLTFLoader().parseAsync(await f.arrayBuffer(),'')).scene;
  else if(ext==='obj')o=new OBJLoader().parse(await f.text());
  else if(ext==='stl')o=new THREE.Mesh(new STLLoader().parse(await f.arrayBuffer()),this.mat({}));
  else throw Error('format tidak didukung (glb, gltf, obj, stl)');
  let n=f.name.replace(/\.\w+$/,''),i=1;const b=n;while(this.root.children.some(c=>c.name===n))n=b+'_'+i++;
  o.name=n;this.put(o);if(this.r)this.frame();return n}
 async importFile(f){this.begin('Impor '+f.name);const n=await this.load(f);this.hist.at(-1).ops.push(['__import',{file:f}]);return n}
 del(o){if(o.userData.helper)this.scene.remove(o.userData.helper);if(this.sel===o)this.select(null);this.root.remove(o);
  o.traverse(x=>{x.geometry?.dispose()});
  if(o.userData.arm){this.mixers.delete(o.name);this.clips=this.clips.filter(c=>c.arm!==o.name)}}
 mixer(arm){let m=this.mixers.get(arm.name);if(!m){m=new THREE.AnimationMixer(arm);this.mixers.set(arm.name,m)}return m}
 capsuleOf(o,k=1){const b=new THREE.Box3().setFromObject(o),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3()),
   ax=s.x>=s.y&&s.x>=s.z?'x':s.y>=s.z?'y':'z',ot=['x','y','z'].filter(q=>q!==ax),r=Math.max(s[ot[0]],s[ot[1]])/2*k,half=Math.max(0,s[ax]/2-r),A=c.clone(),B=c.clone();
  A[ax]-=half;B[ax]+=half;return{a:A,b:B,r}}
 async csg(){return this._csg||=import('three-bvh-csg')}

 makeTools(){
  const h=this,T={},def=(name,desc,props,req,fn,mut=true)=>T[name]={desc,props,req,fn,mut};
  def('add_primitive','Create a primitive mesh centered at `position`. size = FULL dimensions [x,y,z] in meters. types: box sphere cylinder cone torus capsule plane(faces +Z) icosphere hemisphere(dome, open at bottom). cylinder/cone with segments 3-8 = prism/pyramid. torus: tube = tube radius in unit space (default .15).',
   {...base,type:{type:'string',enum:['box','sphere','cylinder','cone','torus','capsule','plane','icosphere','hemisphere']},size:v3,segments:{type:'integer'},tube:num,detail:{type:'integer',description:'icosphere subdivisions 0-6'},double_sided:{type:'boolean'}},['name','type'],a=>{
   const q=Math.max(3,Math.min(a.segments||32,96)),tb=a.tube||.15,g={box:()=>new THREE.BoxGeometry(1,1,1,4,4,4),sphere:()=>new THREE.SphereGeometry(.5,q,Math.max(2,q>>1)),cylinder:()=>new THREE.CylinderGeometry(.5,.5,1,q,4),
    cone:()=>new THREE.CylinderGeometry(0,.5,1,q,4),torus:()=>new THREE.TorusGeometry(.5-tb,tb,16,q),capsule:()=>new THREE.CapsuleGeometry(.25,.5,8,q).scale(2,1,2),plane:()=>new THREE.PlaneGeometry(1,1,4,4),
    icosphere:()=>new THREE.IcosahedronGeometry(.5,Math.min(a.detail??3,6)),hemisphere:()=>new THREE.SphereGeometry(.5,q,Math.max(2,q>>2),0,Math.PI*2,0,Math.PI/2)}[a.type]?.();
   if(!g)throw Error('type tidak dikenal');g.scale(...(a.size||[1,1,1]));return h.add(new THREE.Mesh(g,h.mat(a,a.double_sided||a.type==='plane'||a.type==='hemisphere')),a)});
  def('add_lathe','Revolve a profile around Y. profile = [[radius,y],...] bottom to top (radius>=0).',{...base,profile:{type:'array',items:{type:'array',items:num}},segments:{type:'integer'}},['name','profile'],a=>
   h.add(new THREE.Mesh(new THREE.LatheGeometry(a.profile.map(([r,y])=>new THREE.Vector2(r,y)),a.segments||40),h.mat(a,true)),a));
  def('add_extrude','Extrude a 2D outline [[x,y],...] along Z (centered). holes = optional list of outlines. bevel in meters.',{...base,shape:{type:'array',items:{type:'array',items:num}},holes:{type:'array',items:{type:'array',items:{type:'array',items:num}}},depth:num,bevel:num},['name','shape'],a=>{
   const d=a.depth||.1,b=a.bevel||0,P=p=>p.map(([x,y])=>new THREE.Vector2(x,y)),sh=new THREE.Shape(P(a.shape));(a.holes||[]).forEach(p=>sh.holes.push(new THREE.Path(P(p))));
   const g=new THREE.ExtrudeGeometry(sh,{depth:d,bevelEnabled:b>0,bevelSize:b,bevelThickness:b,bevelSegments:3});g.translate(0,0,-d/2);return h.add(new THREE.Mesh(g,h.mat(a,true)),a)});
  def('add_tube','Smooth tube along a curve through points (limbs, tails, cables, hair). Absolute world coordinates; origin stays at 0,0,0 (use set_origin before rotating).',{name:str,points:{type:'array',items:v3},radius:num,closed:{type:'boolean'},color:str,metalness:num,roughness:num,flat:{type:'boolean'}},['name','points'],a=>{
   if(a.points.length<2)throw Error('minimal 2 titik');return h.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(a.points.map(V),!!a.closed),a.points.length*12,a.radius||.05,12,!!a.closed),h.mat(a)),{name:a.name})});
  def('set_transform','Set position / rotation (degrees) / scale of an object.',{name:str,position:v3,rotation:v3,scale:v3},['name'],a=>{
   const o=h.get(a.name);if(a.position)o.position.set(...a.position);if(a.rotation)o.rotation.set(...a.rotation.map(x=>x*D));if(a.scale)o.scale.set(...a.scale);return h.info(o)});
  def('set_origin','Move an object\'s pivot WITHOUT moving its shape in the world. at: center | bottom | top | point (then give point=[x,y,z] world). Do this before rotating limbs/doors so they pivot at the joint/hinge.',{name:str,at:{type:'string',enum:['center','bottom','top','point']},point:v3},['name'],a=>{
   const m=h.get(a.name);if(!m.isMesh||m.isSkinnedMesh)throw Error('hanya mesh biasa');m.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(m),c=b.getCenter(new THREE.Vector3());let P=c;
   if(a.at==='bottom')P=new THREE.Vector3(c.x,b.min.y,c.z);else if(a.at==='top')P=new THREE.Vector3(c.x,b.max.y,c.z);else if(a.at==='point'||(!a.at&&a.point)){if(!a.point)throw Error('point wajib');P=V(a.point)}
   const L=P.clone().applyMatrix4(m.matrixWorld.clone().invert());m.geometry=m.geometry.clone().translate(-L.x,-L.y,-L.z);m.position.copy(P);return h.info(m)});
  def('modify_mesh','Deform a plain mesh. op: taper{axis,from,to} (scale cross-section along axis), twist{axis,degrees}, displace_noise{amount,scale,seed}, smooth{iterations}, inflate{amount}, mirror{axis} (creates NAME_mirror, mirrored across the world plane through origin).',
   {name:str,op:{type:'string',enum:['taper','twist','displace_noise','smooth','inflate','mirror']},axis,from:num,to:num,degrees:num,amount:num,scale:num,seed:num,iterations:{type:'integer'}},['name','op'],a=>{
   const m=h.get(a.name);if(!m.isMesh||m.isSkinnedMesh)throw Error('hanya mesh biasa (belum di-bind ke armature)');const ax=a.axis||'y';
   if(a.op==='mirror'){const n=a.name+'_mirror';if(h.root.children.some(c=>c.name===n))throw Error(`nama "${n}" sudah dipakai`);const c=new THREE.Mesh(mirrorGeom(m,ax),cloneMat(m.material));return h.add(c,{name:n})}
   if(['displace_noise','smooth','inflate'].includes(a.op))m.geometry=weld(m.geometry);
   const g=m.geometry,P=g.attributes.position,p=new THREE.Vector3(),o=['x','y','z'].filter(c=>c!==ax);g.computeBoundingBox();
   const bb=g.boundingBox,lo=bb.min[ax],sp=(bb.max[ax]-lo)||1,cen=bb.getCenter(new THREE.Vector3()),Nm=g.attributes.normal,n=new THREE.Vector3();
   if(a.op==='smooth'){const ix=g.index.array,nb=Array.from({length:P.count},()=>new Set());
    for(let i=0;i<ix.length;i+=3)for(let j=0;j<3;j++){nb[ix[i+j]].add(ix[i+(j+1)%3]);nb[ix[i+j]].add(ix[i+(j+2)%3])}
    for(let it=0;it<(a.iterations||2);it++){const s=P.array.slice();nb.forEach((set,v)=>{if(!set.size)return;for(let c=0;c<3;c++){let t=0;set.forEach(u=>t+=s[u*3+c]);P.array[v*3+c]=s[v*3+c]+.5*(t/set.size-s[v*3+c])}})}}
   else for(let i=0;i<P.count;i++){p.fromBufferAttribute(P,i);const t=(p[ax]-lo)/sp;
    if(a.op==='taper'){const k=(a.from??1)+((a.to??1)-(a.from??1))*t;p[o[0]]=cen[o[0]]+(p[o[0]]-cen[o[0]])*k;p[o[1]]=cen[o[1]]+(p[o[1]]-cen[o[1]])*k}
    else if(a.op==='twist'){const u=ax==='x'?V([1,0,0]):ax==='y'?V([0,1,0]):V([0,0,1]);p.sub(cen).applyAxisAngle(u,(a.degrees||0)*D*(t-.5)).add(cen)}
    else{n.fromBufferAttribute(Nm,i);p.addScaledVector(n,(a.amount||.02)*(a.op==='inflate'?1:nz(p,a.scale||6,a.seed||1)))}
    P.setXYZ(i,p.x,p.y,p.z)}
   P.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();return h.info(m)});
  def('duplicate_object','Copy a plain mesh. Options: position/rotation/scale for the copy; mirror:axis (mirror across the world plane through origin - build one side then mirror, e.g. arm_L -> arm_R); count+offset makes an array (copies get NAME_1..N, each shifted by offset from the previous). new_name defaults to NAME_copy.',
   {name:str,new_name:str,position:v3,rotation:v3,scale:v3,mirror:axis,count:{type:'integer'},offset:v3},['name'],a=>{
   const m=h.get(a.name);if(!m.isMesh||m.isSkinnedMesh)throw Error('hanya mesh biasa');const nm=a.new_name||a.name+'_copy',cnt=Math.max(1,Math.min(a.count||1,200)),made=[];
   for(let i=0;i<cnt;i++){const n=cnt>1?`${nm}_${i+1}`:nm;
    let c;if(a.mirror){c=new THREE.Mesh(mirrorGeom(m,a.mirror),cloneMat(m.material))}
    else{c=new THREE.Mesh(m.geometry.clone(),cloneMat(m.material));c.position.copy(m.position);c.quaternion.copy(m.quaternion);c.scale.copy(m.scale)}
    if(a.position)c.position.set(...a.position);if(a.rotation)c.rotation.set(...a.rotation.map(x=>x*D));if(a.scale)c.scale.set(...a.scale);
    if(a.offset)c.position.add(V(a.offset).multiplyScalar(cnt>1?i+1:1));made.push(h.add(c,{name:n}))}
   return cnt>1?{created:made.map(x=>x.name),first:made[0],last:made.at(-1)}:made[0]});
  def('join_meshes','Merge several plain meshes into one mesh (each part keeps its own material, existing smooth normals are kept).',{names:{type:'array',items:str},name:str},['names','name'],a=>{
   const ms=a.names.map(n=>h.get(n));if(ms.length<2)throw Error('minimal 2 mesh');const mats=[],gs=[],groups=[];let off=0;
   ms.forEach(m=>{if(!m.isMesh||m.isSkinnedMesh)throw Error(m.name+' bukan mesh biasa');m.updateMatrix();
    let g=m.geometry.clone().applyMatrix4(m.matrix);['uv','uv1','color'].forEach(k=>g.deleteAttribute(k));if(g.index)g=g.toNonIndexed();if(!g.attributes.normal)g.computeVertexNormals();
    const multi=Array.isArray(m.material),ml=[].concat(m.material),gr=multi&&g.groups.length?g.groups:[{start:0,count:g.attributes.position.count,materialIndex:0}];
    gr.forEach(q=>{const mt=ml[multi?q.materialIndex||0:0];let i=mats.indexOf(mt);if(i<0)i=mats.push(mt)-1;groups.push([off+q.start,q.count,i])});
    off+=g.attributes.position.count;g.clearGroups();gs.push(g)});
   const g=U.mergeGeometries(gs,false);if(!g)throw Error('geometri tidak kompatibel');g.clearGroups();if(mats.length>1)groups.forEach(q=>g.addGroup(...q));
   ms.forEach(m=>h.del(m));return h.add(new THREE.Mesh(g,mats.length>1?mats:mats[0]),{name:a.name})});
  def('boolean','CSG on two CLOSED meshes (primitives, lathe, extrude, joined solids). op: subtract (a minus b: holes, windows, notches), union, intersect. Result becomes mesh `name` (default = a\'s name). a and b are consumed unless keep_a / keep_b. Cutter b should poke fully through the surface.',
   {a:str,b:str,op:{type:'string',enum:['subtract','union','intersect']},name:str,keep_a:{type:'boolean'},keep_b:{type:'boolean'}},['a','b','op'],async a=>{
   const {Brush,Evaluator,SUBTRACTION,ADDITION,INTERSECTION}=await h.csg(),A=h.get(a.a),B=h.get(a.b);
   const br=m=>{if(!m.isMesh||m.isSkinnedMesh)throw Error(m.name+' bukan mesh biasa');m.updateMatrix();const g=m.geometry.clone();['uv','uv1','color'].forEach(k=>g.deleteAttribute(k));
    if(!g.attributes.normal)g.computeVertexNormals();if(!Array.isArray(m.material))g.clearGroups();const b=new Brush(g,m.material);b.position.copy(m.position);b.quaternion.copy(m.quaternion);b.scale.copy(m.scale);b.updateMatrixWorld(true);return b};
   const ev=new Evaluator();ev.attributes=['position','normal'];ev.useGroups=true;
   const res=ev.evaluate(br(A),br(B),{subtract:SUBTRACTION,union:ADDITION,intersect:INTERSECTION}[a.op]||SUBTRACTION);
   if(!res.geometry.attributes.position.count)throw Error('hasil boolean kosong (objek tidak berpotongan?)');
   const g=res.geometry;g.applyMatrix4(res.matrix);g.computeBoundingBox();let ms=[].concat(res.material);
   if(a.op==='subtract')ms=ms.map(x=>[].concat(B.material).includes(x)?[].concat(A.material)[0]:x);
   if(ms.every(x=>x===ms[0])){g.clearGroups();ms=ms[0]}
   const nm=a.name||a.a;if(!a.keep_a)h.del(A);if(!a.keep_b)h.del(B);return h.add(new THREE.Mesh(g,ms),{name:nm})});
  def('set_material','Change material of an object.',{name:str,color:str,metalness:num,roughness:num,emissive:str,opacity:num,flat:{type:'boolean'},double_sided:{type:'boolean'}},['name'],a=>{
   h.get(a.name).traverse(o=>{if(!o.isMesh)return;[].concat(o.material).forEach(x=>{if(a.color)x.color.set(a.color);if(a.metalness!=null)x.metalness=a.metalness;if(a.roughness!=null)x.roughness=a.roughness;
    if(a.emissive)x.emissive.set(a.emissive);if(a.opacity!=null){x.opacity=a.opacity;x.transparent=a.opacity<1}
    if(a.flat!=null){x.flatShading=a.flat;x.needsUpdate=true}if(a.double_sided!=null){x.side=a.double_sided?THREE.DoubleSide:THREE.FrontSide;x.needsUpdate=true}})});return{updated:a.name}});
  def('set_visible','Show/hide an object (hidden objects are not exported). isolate:true hides everything else.',{name:str,visible:{type:'boolean'},isolate:{type:'boolean'}},['name'],a=>{
   const o=h.get(a.name);if(a.isolate)h.root.children.forEach(c=>c.visible=c===o);else o.visible=a.visible!==false;if(h.sel&&!h.sel.visible)h.select(null);return{name:o.name,visible:o.visible}});
  def('create_armature','Create a skeleton. bones:[{name,parent,head:[x,y,z],tail:[x,y,z]}] in world coords at rest pose; parents must come before children; names without dots/spaces.',
   {name:str,bones:{type:'array',items:{type:'object',properties:{name:str,parent:str,head:v3,tail:v3}}}},['name','bones'],a=>{
   const g=new THREE.Group(),map={};g.userData.arm=true;
   a.bones.forEach(b=>{if(!/^[\w-]+$/.test(b.name||''))throw Error(`nama bone "${b.name}" tidak valid (hanya huruf/angka/_/-)`);if(map[b.name])throw Error(`bone "${b.name}" dobel`);
    const B=new THREE.Bone(),par=b.parent&&map[b.parent];if(b.parent&&!par)throw Error(`parent "${b.parent}" belum didefinisikan`);
    B.name=b.name;B.userData={head:b.head,tail:b.tail||b.head};const ph=par?par.userData.head:[0,0,0];B.position.set(b.head[0]-ph[0],b.head[1]-ph[1],b.head[2]-ph[2]);(par||g).add(B);map[b.name]=B});
   const r=h.add(g,{name:a.name});g.updateMatrixWorld(true);const sh=new THREE.SkeletonHelper(g);sh.material.depthTest=false;sh.renderOrder=9;g.userData.helper=sh;h.scene.add(sh);return r});
  def('bind_skin','Auto-weight a plain mesh to an armature (nearest-bone falloff, 4 influences). Call after geometry is final and armature is in rest pose. Higher falloff = sharper joints.',{mesh:str,armature:str,falloff:{type:'number',description:'weight sharpness, default 3'}},['mesh','armature'],a=>{
   const m=h.get(a.mesh),arm=h.get(a.armature),bones=[];if(!m.isMesh||m.isSkinnedMesh||!arm.userData.arm)throw Error('butuh mesh biasa + armature');
   arm.traverse(o=>o.isBone&&bones.push(o));arm.updateMatrixWorld(true);m.updateMatrix();
   const g=m.geometry.clone().applyMatrix4(m.matrix),P=g.attributes.position,n=P.count,p=new THREE.Vector3(),sg=bones.map(b=>[V(b.userData.head),V(b.userData.tail)]),ix=new Uint16Array(n*4),wt=new Float32Array(n*4);
   for(let i=0;i<n;i++){p.fromBufferAttribute(P,i);const d=sg.map(([s,e],j)=>[j,p.distanceTo(closest(p,s,e))]).sort((x,y)=>x[1]-y[1]).slice(0,4),w=d.map(([,x])=>1/Math.pow(x+.02,a.falloff||3)),t=w.reduce((x,y)=>x+y,0);
    d.forEach(([j],k)=>{ix[i*4+k]=j;wt[i*4+k]=w[k]/t})}
   g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ix,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(wt,4));
   const s=new THREE.SkinnedMesh(g,m.material);s.name=m.name;s.frustumCulled=false;h.root.remove(m);h.put(s);s.bind(new THREE.Skeleton(bones));return h.info(s)});
  def('pose_bone','Rotate a bone (euler degrees, relative to rest) to test or pose. Stops running animations.',{armature:str,bone:str,rotation:v3},['armature','bone','rotation'],a=>{
   const b=h.get(a.armature).getObjectByName(a.bone);if(!b)throw Error('bone tidak ada: '+a.bone);h.mixers.forEach(m=>m.stopAllAction());b.rotation.set(...a.rotation.map(x=>x*D));return{posed:a.bone}});
  def('add_animation','Keyframe bone rotations (absolute euler degrees vs rest). tracks:[{bone,times:[sec],rotations:[[x,y,z],...]}] (times and rotations same length, times increasing). Starts playing in a loop; all clips are included in glb/gltf export. Make first == last keyframe for seamless loops.',
   {armature:str,name:str,duration:num,tracks:{type:'array',items:{type:'object',properties:{bone:str,times:{type:'array',items:num},rotations:{type:'array',items:v3}}}}},['armature','name','tracks'],a=>{
   const arm=h.get(a.armature),q=new THREE.Quaternion(),e=new THREE.Euler();if(!arm.userData.arm)throw Error(a.armature+' bukan armature');
   const tr=a.tracks.map(t=>{if(!arm.getObjectByName(t.bone))throw Error('bone tidak ada: '+t.bone);if(!t.times?.length||t.times.length!==t.rotations?.length)throw Error(`track ${t.bone}: times & rotations harus sama panjang`);
    return new THREE.QuaternionKeyframeTrack(t.bone+'.quaternion',t.times,t.rotations.flatMap(r=>q.setFromEuler(e.set(...r.map(x=>x*D))).toArray()))});
   const clip=new THREE.AnimationClip(a.name,a.duration||-1,tr);clip.arm=a.armature;h.clips=h.clips.filter(c=>!(c.name===a.name&&c.arm===a.armature));h.clips.push(clip);
   const mx=h.mixer(arm);mx.stopAllAction();mx.clipAction(clip).reset().play();return{clips:h.clips.filter(c=>c.arm===a.armature).map(c=>c.name),playing:a.name}});
  def('play_animation','Play a named clip on an armature (loop). name="none" stops and returns to rest pose.',{armature:str,name:str},['armature','name'],a=>{
   const arm=h.get(a.armature),mx=h.mixer(arm);mx.stopAllAction();if(a.name==='none'){arm.traverse(o=>o.isBone&&o.rotation.set(0,0,0));return{playing:null}}
   const c=h.clips.find(c=>c.name===a.name&&c.arm===a.armature);if(!c)throw Error(`clip "${a.name}" tidak ada. Yang ada: ${h.clips.filter(c=>c.arm===a.armature).map(c=>c.name).join(', ')||'(kosong)'}`);
   mx.clipAction(c).reset().play();return{playing:a.name}});
  def('add_cloth','Create a cloth sheet (verlet sim). Hangs in the XY plane at position; rotate [-90,0,0] to lay it flat. pin: top | corners | none.',{...base,width:num,height:num,resolution:{type:'integer'},pin:{type:'string',enum:['top','corners','none']}},['name'],a=>{
   const n=Math.min(a.resolution||24,48),W=n+1,g=new THREE.PlaneGeometry(a.width||1,a.height||1,n,n),mode=a.pin||'top';
   g.applyMatrix4(new THREE.Matrix4().compose(V(a.position||[0,1,0]),new THREE.Quaternion().setFromEuler(new THREE.Euler(...(a.rotation||[0,0,0]).map(x=>x*D))),V([1,1,1])));
   const P=g.attributes.position,pin=new Set(),cons=[],id=(x,y)=>y*W+x,link=(i,j)=>cons.push([i,j,Math.hypot(P.getX(i)-P.getX(j),P.getY(i)-P.getY(j),P.getZ(i)-P.getZ(j))]);
   if(mode==='top')for(let i=0;i<W;i++)pin.add(i);if(mode==='corners')[0,n,n*W,n*W+n].forEach(i=>pin.add(i));
   for(let y=0;y<W;y++)for(let x=0;x<W;x++){if(x<n)link(id(x,y),id(x+1,y));if(y<n)link(id(x,y),id(x,y+1));if(x<n&&y<n){link(id(x,y),id(x+1,y+1));link(id(x+1,y),id(x,y+1))}if(x<n-1)link(id(x,y),id(x+2,y));if(y<n-1)link(id(x,y),id(x,y+2))}
   const m=new THREE.Mesh(g,h.mat(a,true));m.userData.cloth={pin,cons};return h.add(m,{name:a.name})});
  def('simulate_cloth','Run cloth physics and bake the result. colliders: [{object:"torso",scale?}] (auto capsule fitted to that object) and/or [{a:[x,y,z],b:[x,y,z]?,radius}] in world coords; floor = min y; wind = [x,y,z]. Call again to continue the sim.',
   {name:str,steps:{type:'integer'},colliders:{type:'array',items:{type:'object',properties:{object:str,scale:num,a:v3,b:v3,radius:num}}},floor:num,wind:v3},['name'],a=>{
   const m=h.get(a.name),c=m.userData.cloth;if(!c)throw Error('bukan cloth');const P=m.geometry.attributes.position,cur=P.array,n=P.count,prev=c.prev||=cur.slice();
   const col=(a.colliders||[]).map(k=>{if(k.object){const q=h.capsuleOf(h.get(k.object),k.scale||1);return{a:q.a,b:q.b,r:q.r+.004}}return{a:V(k.a),b:V(k.b||k.a),r:k.radius||.1}}),dt=1/60,w=a.wind||[0,0,0],p=new THREE.Vector3();
   for(let s=0;s<Math.min(a.steps||150,600);s++){
    for(let i=0;i<n;i++){if(c.pin.has(i))continue;for(let k=0;k<3;k++){const x=cur[i*3+k];cur[i*3+k]=x+(x-prev[i*3+k])*.985+(k===1?-9.8*dt*dt:0)+w[k]*dt*dt;prev[i*3+k]=x}}
    for(let it=0;it<5;it++)for(const[i,j,r]of c.cons){const dx=cur[j*3]-cur[i*3],dy=cur[j*3+1]-cur[i*3+1],dz=cur[j*3+2]-cur[i*3+2],d=Math.hypot(dx,dy,dz)||1e-6,k=(d-r)/d,pi=c.pin.has(i),pj=c.pin.has(j),wi=pi?0:pj?1:.5,wj=pj?0:pi?1:.5;
     cur[i*3]+=dx*k*wi;cur[i*3+1]+=dy*k*wi;cur[i*3+2]+=dz*k*wi;cur[j*3]-=dx*k*wj;cur[j*3+1]-=dy*k*wj;cur[j*3+2]-=dz*k*wj}
    for(let i=0;i<n;i++){if(c.pin.has(i))continue;p.fromArray(cur,i*3);
     for(const k of col){const q=closest(p,k.a,k.b),d=p.distanceTo(q);if(d<k.r)p.copy(d>1e-6?p.clone().sub(q).normalize():V([0,1,0])).multiplyScalar(k.r+.004).add(q)}
     if(a.floor!=null&&p.y<a.floor)p.y=a.floor;p.toArray(cur,i*3)}}
   P.needsUpdate=true;m.geometry.computeVertexNormals();m.geometry.computeBoundingSphere();return h.info(m)});
  def('list_scene','List every object with bounding box, vertex count, bones, clips.',{},[],()=>({objects:h.root.children.map(o=>h.info(o)),clips:h.clips.map(c=>`${c.arm}:${c.name}`)}),false);
  def('validate_model','Automatic QA: floating/disconnected parts (bbox gaps), floor contact, NaN vertices, zero-scale objects, unskinned meshes when an armature exists, triangle count. Call before declaring a model finished.',{},[],()=>{
   const objs=h.root.children.filter(o=>!o.userData.arm&&o.visible),boxes=objs.map(o=>new THREE.Box3().setFromObject(o)),issues=[];let tris=0;
   const par=objs.map((_,i)=>i),find=i=>par[i]===i?i:(par[i]=find(par[i])),eps=.004;
   for(let i=0;i<objs.length;i++)for(let j=i+1;j<objs.length;j++)if(gap(boxes[i],boxes[j])<=eps)par[find(i)]=find(j);
   const comps={};objs.forEach((o,i)=>(comps[find(i)]||=[]).push(o.name));const cl=Object.values(comps).sort((x,y)=>y.length-x.length);
   if(cl.length>1)issues.push(`${cl.length} grup terpisah (bbox tidak bersentuhan). Utama: ${cl[0].length} objek. Melayang/terpisah: ${cl.slice(1).map(c=>'['+c.join(',')+']').join(' ')}`);
   const all=new THREE.Box3();boxes.forEach(b=>all.union(b));
   objs.forEach(o=>{o.traverse(x=>{const P=x.geometry?.attributes.position;if(!P)return;tris+=(x.geometry.index?x.geometry.index.count:P.count)/3;
     for(let i=0;i<P.array.length;i++)if(!Number.isFinite(P.array[i])){issues.push(`${o.name}: vertex NaN/Infinity`);return}});
    if(Math.abs(o.scale.x*o.scale.y*o.scale.z)<1e-9)issues.push(`${o.name}: scale nol`)});
   if(!all.isEmpty()){if(all.min.y>.03)issues.push(`seluruh model melayang ${all.min.y.toFixed(2)}m di atas lantai (y=0)`);if(all.min.y<-.03)issues.push(`sebagian model menembus lantai ${(-all.min.y).toFixed(2)}m`)}
   const hasArm=h.root.children.some(o=>o.userData.arm),un=objs.filter(o=>o.isMesh&&!o.isSkinnedMesh&&!o.userData.cloth).map(o=>o.name);
   if(hasArm&&un.length)issues.push(`ada armature tapi mesh ini belum di-skin (abaikan jika memang prop statis): ${un.join(', ')}`);
   return{objects:objs.length,triangles:Math.round(tris),bounds:all.isEmpty()?null:{min:R(all.min),max:R(all.max),size:R(all.getSize(new THREE.Vector3()))},issues:issues.length?issues:['OK: tidak ada masalah terdeteksi']}},false);
  def('screenshot','Capture the viewport. angle: front|back|left|right|top|iso for ONE view (re-frames camera). views:[...] (2-4 angles) gives ONE composite image with labels, best for checking all sides in one call, e.g. ["front","right","back","top"]. Omit both to keep the current camera.',{angle:ANG,views:{type:'array',items:ANG}},[],a=>({image:h.capture(a)}),false);
  def('delete_object','Delete an object by name.',{name:str},['name'],a=>{h.del(h.get(a.name));return{deleted:a.name}});
  def('clear_scene','Remove everything.',{},[],()=>{h.reset();return{cleared:true}});
  def('export_model','Export the scene (or only `names`) and download it. format: glb (default, includes rig + animations) | gltf | obj | stl. Include the armature name when exporting rigged parts.',
   {format:{type:'string',enum:['glb','gltf','obj','stl']},names:{type:'array',items:str},filename:str},[],async a=>{
   const f=a.format||'glb',{blob,filename}=await h.exportBlob(f,a.names,a.filename||'model');h.download(blob,filename);return{file:filename,bytes:blob.size}},false);
  def('batch','Run MANY tool calls in ONE request (saves round trips + tokens). ops:[{tool,args}]. Executes in order, stops at the first error and reports its index (earlier ops stay applied). Cannot contain screenshot/export_model/batch. Use it to build whole parts at once.',
   {ops:{type:'array',items:{type:'object',properties:{tool:str,args:{type:'object'}},required:['tool']}}},['ops'],async a=>{
   if(!Array.isArray(a.ops)||!a.ops.length)throw Error('ops kosong');if(a.ops.length>60)throw Error('maks 60 ops per batch');const out=[];
   for(const[i,o]of a.ops.entries()){if(['batch','screenshot','export_model'].includes(o.tool))return{done:i,failed:{index:i,tool:o.tool,error:o.tool+' tidak boleh di dalam batch'},results:out};
    const r=await h.run(o.tool,o.args||{});if(!r.ok)return{done:i,failed:{index:i,tool:o.tool,error:r.error},results:out};const{ok,...rest}=r;out.push({i,tool:o.tool,...(rest.name?{name:rest.name,min:rest.min,max:rest.max}:rest)})}
   return{done:a.ops.length,results:out}},false);
  return T;
 }
}
