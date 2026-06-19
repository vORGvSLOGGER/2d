'use strict';

const $ = (id) => document.getElementById(id);
const menuScreen = $('menuScreen');
const gameScreen = $('gameScreen');
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');
const pCanvas = $('previewCanvas');
const pctx = pCanvas.getContext('2d');

const ui = {
  mode: $('modeValue'), wave: $('waveValue'), base: $('baseValue'), health: $('healthValue'), healthBar: $('healthBar'),
  coins: $('coinsValue'), weapon: $('weaponValue'), best: $('bestValue'), toast: $('toast'), upgrades: $('upgrades'),
  log: $('logText'), sideTitle: $('sideTitle'), overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'), overlayBtn: $('overlayBtn'),
  homeBtn: $('homeBtn'), pauseBtn: $('pauseBtn'), restartBtn: $('restartBtn'), quickCard: $('quickModeCard'), tycoonCard: $('tycoonModeCard')
};

const W = canvas.width, H = canvas.height, LANES = 5;
const LEFT = 142, RIGHT = W - 60, TOP = 142, BOTTOM = H - 70, LH = (BOTTOM - TOP) / LANES;
const laneY = (lane) => TOP + lane * LH + LH / 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

const weapons = [
  {name:'حجر حارس', type:'stone', color:'#a16207', glow:'#fde68a', dmg:26, speed:800, r:14, cd:500, splash:0},
  {name:'رمح فولاذي', type:'spear', color:'#94a3b8', glow:'#e2e8f0', dmg:42, speed:980, r:12, cd:440, splash:0},
  {name:'نار دوّارة', type:'fire', color:'#f97316', glow:'#fed7aa', dmg:48, speed:900, r:17, cd:470, splash:76},
  {name:'بلورة جليد', type:'ice', color:'#38bdf8', glow:'#bae6fd', dmg:38, speed:950, r:16, cd:420, splash:62, slow:.45},
  {name:'قذيفة بلازما', type:'plasma', color:'#8b5cf6', glow:'#ddd6fe', dmg:78, speed:1080, r:19, cd:390, splash:104},
  {name:'نواة ميثك', type:'mythic', color:'#facc15', glow:'#fff7ad', dmg:120, speed:1220, r:23, cd:360, splash:145}
];

const enemyTypes = [
  {key:'imp', name:'مخلب', hp:44, speed:66, r:20, color:'#22c55e', reward:8, dmg:8},
  {key:'crawler', name:'زاحف', hp:74, speed:48, r:23, color:'#84cc16', reward:12, dmg:11},
  {key:'brute', name:'محطم', hp:132, speed:34, r:31, color:'#16a34a', reward:20, dmg:17},
  {key:'armored', name:'مدرع', hp:205, speed:28, r:33, color:'#0f766e', reward:30, dmg:24},
  {key:'witch', name:'ساحر', hp:155, speed:41, r:28, color:'#a855f7', reward:35, dmg:21},
  {key:'boss', name:'ملك الوحوش', hp:720, speed:24, r:52, color:'#b91c1c', reward:120, dmg:50}
];

const state = {
  screen:'menu', status:'menu', mode:null, last:0, wave:1, spawnTarget:8, spawned:0, spawnCd:0, time:0,
  baseLv:1, maxHp:120, hp:120, coins:80, best:Number(localStorage.getItem('2d_best_wave')||0),
  power:1, rate:1, wall:1, incomeLv:1, forgeLv:1, turretLv:0, research:1, incomeTick:0, turretTick:0,
  enemies:[], shots:[], particles:[], texts:[], rings:[], cd:Array(LANES).fill(0), mouse:{x:0,y:0}, shake:0, kills:0, total:0
};

function weapon() {
  const w = weapons[Math.min(weapons.length - 1, state.baseLv + state.forgeLv - 2)];
  return {...w, dmg:Math.round(w.dmg * (1 + (state.power - 1) * .22) * (1 + (state.research - 1) * .13)), cd:Math.max(180, Math.round(w.cd * (1 - (state.rate - 1) * .075)))};
}

const costs = {
  base:()=> state.baseLv >= 6 ? Infinity : Math.round(100 * Math.pow(1.62, state.baseLv - 1)),
  power:()=> Math.round(70 * Math.pow(1.45, state.power - 1)),
  rate:()=> Math.round(85 * Math.pow(1.42, state.rate - 1)),
  wall:()=> Math.round(75 * Math.pow(1.50, state.wall - 1)),
  repair:()=> Math.max(25, Math.round((state.maxHp - state.hp) * .55)),
  income:()=> Math.round(90 * Math.pow(1.72, state.incomeLv - 1)),
  forge:()=> Math.round(130 * Math.pow(1.85, state.forgeLv - 1)),
  turret:()=> Math.round(170 * Math.pow(1.95, state.turretLv)),
  research:()=> Math.round(220 * Math.pow(1.9, state.research - 1))
};

function showScreen(name) {
  state.screen = name;
  menuScreen.classList.toggle('active', name === 'menu');
  gameScreen.classList.toggle('active', name === 'game');
}

function toast(msg) {
  ui.toast.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(()=> ui.toast.textContent = '', 2200);
}

function overlay(show, title='', text='', button='متابعة') {
  ui.overlay.classList.toggle('show', show);
  if (title) ui.overlayTitle.textContent = title;
  if (text) ui.overlayText.textContent = text;
  ui.overlayBtn.textContent = button;
}

function startMode(mode) {
  reset(mode);
  showScreen('game');
  state.status = 'playing';
  overlay(false);
  toast(mode === 'quick' ? 'بدأ الطور السريع' : 'بدأ Tycoon Mode');
}

function reset(mode = state.mode || 'quick') {
  state.mode = mode; state.status = 'playing'; state.wave = 1; state.spawnTarget = mode === 'quick' ? 10 : 8;
  state.spawned = 0; state.spawnCd = .45; state.time = 0; state.baseLv = 1; state.maxHp = mode === 'tycoon' ? 160 : 120;
  state.hp = state.maxHp; state.coins = mode === 'tycoon' ? 140 : 90; state.power = 1; state.rate = 1; state.wall = 1;
  state.incomeLv = 1; state.forgeLv = 1; state.turretLv = 0; state.research = 1; state.incomeTick = 0; state.turretTick = 0;
  state.enemies = []; state.shots = []; state.particles = []; state.texts = []; state.rings = []; state.cd = Array(LANES).fill(0);
  state.shake = 0; state.kills = 0; state.total = 0;
  overlay(false);
}

function pause() {
  if (state.screen !== 'game') return;
  if (state.status === 'gameover') return reset();
  state.status = state.status === 'paused' ? 'playing' : 'paused';
  overlay(state.status === 'paused', 'إيقاف مؤقت', 'المعركة متوقفة. اضغط متابعة للرجوع.', 'متابعة');
}

function goHome() {
  state.status = 'menu';
  showScreen('menu');
  overlay(false);
}

function buy(kind) {
  const cost = costs[kind]();
  if (state.coins < cost) return toast(`تحتاج ${fmt(cost)} عملة`);
  if (kind === 'base' && state.baseLv >= 6) return toast('القاعدة وصلت لأعلى مستوى');
  state.coins -= cost;
  if (kind === 'base') { state.baseLv++; state.maxHp += 55 + state.baseLv * 18; state.hp = Math.min(state.maxHp, state.hp + 120); boom(LEFT, 190, '#facc15', 56); say(LEFT+110, 110, `سلاح جديد: ${weapon().name}`, '#facc15'); }
  if (kind === 'power') state.power++;
  if (kind === 'rate') state.rate++;
  if (kind === 'wall') { state.wall++; state.maxHp += 55; state.hp += 55; }
  if (kind === 'repair') state.hp = Math.min(state.maxHp, state.hp + Math.round(state.maxHp*.44));
  if (kind === 'income') state.incomeLv++;
  if (kind === 'forge') state.forgeLv++;
  if (kind === 'turret') state.turretLv++;
  if (kind === 'research') state.research++;
  toast('تم التطوير');
}

function shoot(lane, auto=false) {
  if (state.status !== 'playing') return;
  lane = clamp(lane, 0, LANES-1);
  const w = weapon();
  if (!auto && state.cd[lane] > 0) return say(LEFT + 105, laneY(lane), 'تبريد', '#cbd5e1');
  if (!auto) state.cd[lane] = w.cd;
  const y = laneY(lane);
  state.shots.push({x:LEFT-4, y, lane, vx:w.speed, r:w.r, dmg:w.dmg, splash:w.splash, slow:w.slow||0, color:w.color, glow:w.glow, type:w.type, life:1.8, spin:0});
  boom(LEFT+18, y, w.glow, 9);
}

function enemyType() {
  if (state.wave % 5 === 0 && state.spawned === state.spawnTarget - 1) return enemyTypes[5];
  const r = Math.random();
  if (state.wave >= 7 && r > .87) return enemyTypes[4];
  if (state.wave >= 5 && r > .74) return enemyTypes[3];
  if (state.wave >= 3 && r > .56) return enemyTypes[2];
  if (state.wave >= 2 && r > .36) return enemyTypes[1];
  return enemyTypes[0];
}

function spawn() {
  const t = enemyType();
  const lane = Math.floor(Math.random() * LANES);
  const scale = 1 + (state.wave - 1) * (state.mode === 'quick' ? .17 : .13);
  const boss = t.key === 'boss' ? 1 + Math.floor(state.wave / 5) * .36 : 1;
  const hp = Math.round(t.hp * scale * boss);
  state.enemies.push({type:t.key, name:t.name, lane, x:W + rand(20,140), y:laneY(lane), r:t.r*(t.key==='boss'?1.1:1), hp, maxHp:hp, speed:t.speed*(1+state.wave*.015), baseSpeed:t.speed*(1+state.wave*.015), reward:Math.round(t.reward*scale*boss), dmg:Math.round(t.dmg*boss), color:t.color, slow:0, wobble:rand(0,6)});
}

function update(dt) {
  if (state.status !== 'playing') return;
  state.time += dt;
  state.spawnCd -= dt;
  state.cd = state.cd.map(v => Math.max(0, v - dt*1000));

  if (state.mode === 'tycoon') {
    state.incomeTick += dt;
    if (state.incomeTick >= 1) { state.incomeTick = 0; state.coins += 6 + state.incomeLv * 5; say(W-170, 80, `دخل +${6 + state.incomeLv*5}`, '#facc15'); }
    if (state.turretLv > 0) { state.turretTick += dt; if (state.turretTick >= Math.max(.45, 1.25 - state.turretLv*.12)) { state.turretTick=0; const target = state.enemies.find(e=>e.x>LEFT+80); if (target) shoot(target.lane, true); } }
  }

  if (state.spawned < state.spawnTarget && state.spawnCd <= 0) {
    spawn(); state.spawned++;
    state.spawnCd = Math.max(.30, (state.mode === 'quick' ? .86 : 1.08) - state.wave*.035) + rand(0,.20);
  }
  if (state.spawned >= state.spawnTarget && state.enemies.length === 0) nextWave();

  updateEnemies(dt); updateShots(dt); updateEffects(dt);
}

function nextWave() {
  const reward = (state.mode === 'quick' ? 45 : 32) + state.wave * 13;
  state.coins += reward; say(W/2, 100, `مكافأة موجة +${reward}`, '#facc15'); boom(W/2, 130, '#facc15', 35);
  state.wave++; state.spawned = 0; state.spawnTarget = (state.mode === 'quick' ? 9 : 7) + state.wave * 2 + (state.wave % 5 === 0 ? 1 : 0); state.spawnCd = 1.1;
  if (state.wave > state.best) { state.best = state.wave; localStorage.setItem('2d_best_wave', String(state.best)); }
  toast(`بدأت موجة ${state.wave}`);
}

function updateEnemies(dt) {
  for (let i=state.enemies.length-1;i>=0;i--) {
    const e = state.enemies[i];
    e.wobble += dt*5; if (e.slow>0) { e.slow -= dt; if (e.slow<=0) e.speed = e.baseSpeed; }
    e.x -= e.speed*dt; e.y = laneY(e.lane) + Math.sin(e.wobble)*4;
    if (e.x - e.r < LEFT - 22) { damageBase(e); state.enemies.splice(i,1); continue; }
    if (e.hp <= 0) { kill(e); state.enemies.splice(i,1); }
  }
}

function updateShots(dt) {
  for (let i=state.shots.length-1;i>=0;i--) {
    const s = state.shots[i]; s.x += s.vx*dt; s.spin += dt*8; s.life -= dt;
    if (s.x > W+90 || s.life <= 0) { state.shots.splice(i,1); continue; }
    for (const e of state.enemies) {
      if (e.lane !== s.lane) continue;
      if (Math.hypot(e.x-s.x, e.y-s.y) < e.r + s.r) { hit(e,s); state.shots.splice(i,1); break; }
    }
  }
}

function hit(e,s) {
  e.hp -= s.dmg; say(e.x, e.y-e.r-14, `-${s.dmg}`, s.glow); boom(s.x,s.y,s.glow,15);
  if (s.slow) { e.slow = 1.8; e.speed = e.baseSpeed*s.slow; }
  if (s.splash) {
    state.rings.push({x:s.x,y:s.y,r:8,max:s.splash,life:.34,color:s.glow});
    for (const o of state.enemies) { if (o===e) continue; const d=Math.hypot(o.x-s.x,o.y-s.y); if (d<s.splash) { const dmg=Math.round(s.dmg*(1-d/s.splash)*.55); if (dmg>0) {o.hp-=dmg; say(o.x,o.y-o.r,`-${dmg}`,s.glow);} } }
  }
}

function kill(e) { state.coins += e.reward; state.kills++; state.total++; boom(e.x,e.y,e.color,e.type==='boss'?80:34); say(e.x,e.y-e.r-24,`+${e.reward}`, '#facc15'); }
function damageBase(e) { const dmg = Math.max(1, Math.round(e.dmg * (1 - (state.wall-1)*.08))); state.hp = Math.max(0, state.hp - dmg); state.shake=10; boom(LEFT-8,e.y,'#ef4444',28); say(LEFT+65,e.y,`-${dmg}`, '#ef4444'); if (state.hp<=0) gameOver(); }
function gameOver() { state.status='gameover'; if (state.wave>state.best) { state.best=state.wave; localStorage.setItem('2d_best_wave', String(state.best)); } overlay(true,'سقطت القاعدة',`وصلت إلى موجة ${state.wave}. طور الاقتصاد والجدار والسلاح أبكر.`, 'إعادة المحاولة'); }

function updateEffects(dt) {
  state.shake = Math.max(0, state.shake - dt*22);
  for (let i=state.particles.length-1;i>=0;i--) { const p=state.particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=160*dt; p.life-=dt; if(p.life<=0)state.particles.splice(i,1); }
  for (let i=state.texts.length-1;i>=0;i--) { const f=state.texts[i]; f.y-=34*dt; f.life-=dt; if(f.life<=0)state.texts.splice(i,1); }
  for (let i=state.rings.length-1;i>=0;i--) { const r=state.rings[i]; r.r+=(r.max/.34)*dt; r.life-=dt; if(r.life<=0)state.rings.splice(i,1); }
}
function boom(x,y,color,count=18) { for(let i=0;i<count;i++){const a=rand(0,Math.PI*2),sp=rand(60,190);state.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:rand(2,5),color,life:rand(.28,.78)});} }
function say(x,y,text,color) { state.texts.push({x,y,text,color,life:1.2}); }

function draw() {
  ctx.save(); if(state.shake>0)ctx.translate(rand(-state.shake,state.shake),rand(-state.shake,state.shake));
  drawWorld(ctx,W,H); drawLanes(); drawBase(); drawTrails(); state.enemies.forEach(drawEnemy); state.shots.forEach(drawShot); state.rings.forEach(drawRing); state.particles.forEach(drawParticle); state.texts.forEach(drawText); drawAim();
  ctx.restore();
}

function drawWorld(c,w,h) {
  const g=c.createLinearGradient(0,0,w,h); g.addColorStop(0,'#172554'); g.addColorStop(.45,'#14532d'); g.addColorStop(1,'#20283a'); c.fillStyle=g; c.fillRect(0,0,w,h);
  c.fillStyle='rgba(255,255,255,.055)'; for(let i=0;i<80;i++){c.fillRect((i*113+state.time*12)%w,28+(i*41)%130,2,2);}
  c.fillStyle='rgba(15,23,42,.58)'; mountain(c,0,210,260,95); mountain(c,230,190,360,118); mountain(c,700,210,330,102); mountain(c,960,175,390,136);
}
function mountain(c,x,y,w,h){c.beginPath();c.moveTo(x,y+h);c.lineTo(x+w*.45,y);c.lineTo(x+w,y+h);c.closePath();c.fill();}
function drawLanes(){ctx.fillStyle='rgba(15,23,42,.35)';ctx.fillRect(0,TOP-24,W,BOTTOM-TOP+48);for(let l=0;l<LANES;l++){const y=TOP+l*LH,cy=laneY(l);const g=ctx.createLinearGradient(0,y,W,y+LH);g.addColorStop(0,l%2?'rgba(22,101,52,.35)':'rgba(34,197,94,.30)');g.addColorStop(1,'rgba(21,128,61,.18)');ctx.fillStyle=g;ctx.fillRect(0,y,W,LH);ctx.strokeStyle='rgba(255,255,255,.10)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();ctx.setLineDash([16,14]);ctx.strokeStyle='rgba(250,204,21,.13)';ctx.beginPath();ctx.moveTo(LEFT+26,cy);ctx.lineTo(RIGHT,cy);ctx.stroke();ctx.setLineDash([]);}ctx.strokeStyle='rgba(239,68,68,.82)';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(LEFT-24,TOP-24);ctx.lineTo(LEFT-24,BOTTOM+24);ctx.stroke();}
function drawBase(){const lv=state.baseLv,x=28,y=178-Math.min(lv,6)*7,w=95+lv*9,h=372+lv*8;ctx.save();ctx.shadowColor='rgba(250,204,21,.24)';ctx.shadowBlur=22;round(x+22,y+32,w,h,22,'#0f172a');const g=ctx.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,'#94a3b8');g.addColorStop(.45,'#334155');g.addColorStop(1,'#111827');round(x+14,y+48,w,h-28,24,g);ctx.fillStyle='#facc15';ctx.beginPath();ctx.moveTo(x+2,y+52);ctx.lineTo(x+62,y-18);ctx.lineTo(x+w+42,y+52);ctx.closePath();ctx.fill();ctx.fillStyle='#020617';for(let i=0;i<4;i++){ctx.fillRect(x+36,y+92+i*58,24,30);ctx.fillRect(x+80,y+92+i*58,24,30);}ctx.fillStyle='#f97316';ctx.fillRect(x+58,y+h-52,42,58);ctx.strokeStyle='#facc15';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x+w+36,laneY(2),38+lv*4,-Math.PI/2,Math.PI/2);ctx.stroke();if(state.mode==='tycoon'){drawFactory(x+10,y+h+12);}ctx.restore();}
function drawFactory(x,y){ctx.fillStyle='rgba(15,23,42,.88)';ctx.fillRect(x,y,110,48);ctx.fillStyle='#64748b';ctx.fillRect(x+12,y-22,18,22);ctx.fillRect(x+48,y-34,18,34);ctx.fillStyle='#facc15';for(let i=0;i<state.incomeLv;i++)ctx.fillRect(x+12+i*16,y+12,9,18);}
function drawTrails(){for(const s of state.shots){ctx.globalAlpha=.25;ctx.strokeStyle=s.glow;ctx.lineWidth=s.r*1.2;ctx.beginPath();ctx.moveTo(s.x-50,s.y);ctx.lineTo(s.x-6,s.y);ctx.stroke();ctx.globalAlpha=1;}}
function drawEnemy(e){ctx.save();ctx.translate(e.x,e.y);if(e.slow>0){ctx.strokeStyle='#7dd3fc';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,e.r+8,0,Math.PI*2);ctx.stroke();}ctx.shadowColor=e.color;ctx.shadowBlur=e.type==='boss'?28:14;ctx.fillStyle=e.color;if(e.type==='imp') monsterImp(e.r); else if(e.type==='crawler') monsterCrawler(e.r); else if(e.type==='brute') monsterBrute(e.r); else if(e.type==='armored') monsterArmored(e.r); else if(e.type==='witch') monsterWitch(e.r); else monsterBoss(e.r);ctx.shadowBlur=0;drawHp(e);ctx.restore();}
function monsterImp(r){ctx.beginPath();ctx.ellipse(0,0,r*1.05,r*.90,0,0,Math.PI*2);ctx.fill();eyes(r);horns(r,'#bbf7d0');}
function monsterCrawler(r){ctx.beginPath();ctx.ellipse(0,6,r*1.35,r*.62,0,0,Math.PI*2);ctx.fill();eyes(r);legs(r);}
function monsterBrute(r){round(-r,-r*.8,r*2,r*1.75,12,ctx.fillStyle);eyes(r);ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(-r*.7,r*.25,r*1.4,r*.22);}
function monsterArmored(r){round(-r*1.05,-r*.9,r*2.1,r*1.8,14,ctx.fillStyle);ctx.strokeStyle='#a7f3d0';ctx.lineWidth=4;ctx.stroke();eyes(r);}
function monsterWitch(r){ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#111827';ctx.beginPath();ctx.moveTo(-r*.9,-r*.7);ctx.lineTo(0,-r*1.75);ctx.lineTo(r*.9,-r*.7);ctx.closePath();ctx.fill();eyes(r);}
function monsterBoss(r){round(-r*1.05,-r*.9,r*2.1,r*1.82,18,ctx.fillStyle);ctx.fillStyle='#facc15';ctx.beginPath();ctx.moveTo(-r*.7,-r*.9);ctx.lineTo(-r*.35,-r*1.55);ctx.lineTo(0,-r*.96);ctx.lineTo(r*.35,-r*1.55);ctx.lineTo(r*.7,-r*.9);ctx.closePath();ctx.fill();eyes(r);}
function eyes(r){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-r*.32,-r*.18,r*.15,0,Math.PI*2);ctx.arc(r*.28,-r*.18,r*.15,0,Math.PI*2);ctx.fill();ctx.fillStyle='#020617';ctx.beginPath();ctx.arc(-r*.32,-r*.18,r*.07,0,Math.PI*2);ctx.arc(r*.28,-r*.18,r*.07,0,Math.PI*2);ctx.fill();}
function horns(r,col){ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(-r*.65,-r*.45);ctx.lineTo(-r*.95,-r*1.05);ctx.lineTo(-r*.25,-r*.75);ctx.moveTo(r*.65,-r*.45);ctx.lineTo(r*.95,-r*1.05);ctx.lineTo(r*.25,-r*.75);ctx.fill();}
function legs(r){ctx.fillStyle='rgba(0,0,0,.28)';for(let i=-2;i<=2;i++)ctx.fillRect(i*r*.35,r*.42,5,r*.55);}
function drawHp(e){const bw=e.r*2.35,p=clamp(e.hp/e.maxHp,0,1);round(-bw/2,-e.r-22,bw,7,4,'rgba(0,0,0,.55)');round(-bw/2,-e.r-22,bw*p,7,4,p>.45?'#22c55e':p>.2?'#facc15':'#ef4444');}
function drawShot(s){ctx.save();ctx.translate(s.x,s.y);ctx.rotate(s.spin);ctx.shadowColor=s.glow;ctx.shadowBlur=22;ctx.fillStyle=s.color;if(s.type==='spear'){ctx.beginPath();ctx.moveTo(s.r*1.9,0);ctx.lineTo(-s.r*.8,-s.r*.55);ctx.lineTo(-s.r*.5,0);ctx.lineTo(-s.r*.8,s.r*.55);ctx.closePath();ctx.fill();}else if(s.type==='ice'){ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.lineTo(Math.cos(a)*s.r,Math.sin(a)*s.r);}ctx.closePath();ctx.fill();}else{ctx.beginPath();ctx.arc(0,0,s.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.48)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,s.r*.58,0,Math.PI*1.4);ctx.stroke();}ctx.restore();}
function drawRing(r){ctx.globalAlpha=clamp(r.life/.34,0,1);ctx.strokeStyle=r.color;ctx.lineWidth=5;ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
function drawParticle(p){ctx.globalAlpha=clamp(p.life/.75,0,1);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
function drawText(t){ctx.globalAlpha=clamp(t.life,0,1);ctx.fillStyle=t.color;ctx.font='bold 20px Tahoma';ctx.textAlign='center';ctx.fillText(t.text,t.x,t.y);ctx.globalAlpha=1;}
function drawAim(){if(state.status!=='playing')return;const l=clamp(Math.floor((state.mouse.y-TOP)/LH),0,LANES-1),y=laneY(l);ctx.fillStyle='rgba(250,204,21,.075)';ctx.fillRect(LEFT,y-LH/2,W-LEFT,LH);}
function round(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fill();}

function renderUpgrades() {
  const quick = [
    ['base','تطوير القاعدة','يفتح أسلحة أعلى ويزيد الصحة.'], ['power','قوة السلاح','يزيد الضرر لكل الأسلحة.'], ['rate','سرعة الإطلاق','يقلل وقت التبريد بين الطلقات.'], ['repair','إصلاح القاعدة','يعيد جزءاً من الصحة.']
  ];
  const tycoon = [
    ['income','مصنع العملات','يزيد الدخل التلقائي كل ثانية.'], ['forge','ورشة الأسلحة','يسرّع فتح الأسلحة المتقدمة.'], ['turret','برج تلقائي','يطلق تلقائياً على مسار فيه وحش.'], ['research','بحث عسكري','يرفع ضرر كل الأسلحة بنسبة كبيرة.'], ['wall','تدريع الجدار','يزيد الصحة ويقلل ضرر الوحوش.'], ['base','تطوير القاعدة','يزيد التحمل ويفتح سلاحاً جديداً.'], ['repair','إصلاح القاعدة','يعيد جزءاً من الصحة.']
  ];
  const list = state.mode === 'tycoon' ? tycoon : quick;
  ui.upgrades.innerHTML = list.map(([k,title,desc]) => `<div class="upgrade-card"><strong>${title}</strong><p>${desc}</p><button data-buy="${k}">${label(k)}</button></div>`).join('');
  ui.upgrades.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>buy(b.dataset.buy));
}
function label(k){const c=costs[k](); if(c===Infinity)return'أقصى مستوى'; return `${fmt(c)} عملة`;}
function updateUI(){const wpn=weapon();ui.mode.textContent=state.mode==='tycoon'?'Tycoon':'سريع';ui.wave.textContent=state.wave;ui.base.textContent=`Lv.${state.baseLv}`;ui.health.textContent=`${fmt(state.hp)} / ${fmt(state.maxHp)}`;ui.healthBar.style.width=`${clamp(state.hp/state.maxHp,0,1)*100}%`;ui.coins.textContent=fmt(state.coins);ui.weapon.textContent=wpn.name;ui.best.textContent=state.best;ui.sideTitle.textContent=state.mode==='tycoon'?'مركز التايكون':'مركز التطوير';ui.log.innerHTML=`القتلات: <b>${fmt(state.total)}</b><br>ضرر السلاح: <b>${wpn.dmg}</b><br>تبريد: <b>${wpn.cd}ms</b><br>${state.mode==='tycoon'?`دخل تلقائي: <b>${6+state.incomeLv*5}/ث</b>`:'اضغط المسارات بسرعة ولا تترك الوحوش تلمس القاعدة.'}`;renderUpgrades();}

function preview(t){pctx.clearRect(0,0,pCanvas.width,pCanvas.height);drawWorld(pctx,pCanvas.width,pCanvas.height);pctx.save();pctx.translate(65,310);pctx.scale(.75,.75);monsterBoss(50);pctx.restore();pctx.save();pctx.translate(230,330);pctx.scale(.8,.8);monsterArmored(34);pctx.restore();pctx.save();pctx.translate(380,315);pctx.scale(.7,.7);monsterWitch(36);pctx.restore();pctx.save();pctx.translate(500,335);pctx.scale(.85,.85);monsterImp(28);pctx.restore();pctx.fillStyle='#facc15';pctx.font='bold 34px Tahoma';pctx.textAlign='center';pctx.fillText('طورين في لعبة واحدة',pCanvas.width/2,80);pctx.fillStyle='#cbd5e1';pctx.font='18px Tahoma';pctx.fillText('Quick Defense + Tycoon Economy',pCanvas.width/2,116);requestAnimationFrame(preview);}

function loop(time){const dt=Math.min(.033,(time-state.last)/1000||0);state.last=time;update(dt);if(state.screen==='game'){draw();updateUI();}requestAnimationFrame(loop);}

ui.quickCard.onclick=()=>startMode('quick'); ui.tycoonCard.onclick=()=>startMode('tycoon'); ui.homeBtn.onclick=goHome; ui.pauseBtn.onclick=pause; ui.restartBtn.onclick=()=>reset(); ui.overlayBtn.onclick=()=>{ if(state.status==='paused')pause(); else reset(); };
document.querySelectorAll('[data-lane]').forEach(b=>b.onclick=()=>shoot(Number(b.dataset.lane)));
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();state.mouse.x=(e.clientX-r.left)*(W/r.width);state.mouse.y=(e.clientY-r.top)*(H/r.height);});
canvas.addEventListener('pointerdown',e=>{if(state.status==='gameover')return reset();if(state.status!=='playing')return;const r=canvas.getBoundingClientRect(),y=(e.clientY-r.top)*(H/r.height);if(y<TOP||y>BOTTOM)return;shoot(Math.floor((y-TOP)/LH));});
window.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();pause();}if(e.key.toLowerCase()==='r')reset();if(['1','2','3','4','5'].includes(e.key))shoot(Number(e.key)-1);});

showScreen('menu'); preview(0); requestAnimationFrame(loop);
