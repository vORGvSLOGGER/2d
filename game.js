'use strict';

const $ = (id) => document.getElementById(id);
const menuScreen = $('menuScreen');
const gameScreen = $('gameScreen');
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');
const previewCanvas = $('previewCanvas');
const pctx = previewCanvas.getContext('2d');

const ui = {
  mode: $('modeValue'), phase: $('phaseValue'), timer: $('timerValue'), wave: $('waveValue'), castle: $('castleValue'),
  health: $('healthValue'), healthBar: $('healthBar'), coins: $('coinsValue'), weapon: $('weaponValue'), toast: $('toast'),
  miniGame: $('miniGame'), log: $('logText'), overlay: $('overlay'), overlayTitle: $('overlayTitle'), overlayText: $('overlayText'), overlayBtn: $('overlayBtn'),
  homeBtn: $('homeBtn'), pauseBtn: $('pauseBtn'), restartBtn: $('restartBtn'), quickCard: $('quickModeCard'), tycoonCard: $('tycoonModeCard')
};

const W = canvas.width;
const H = canvas.height;
const LANES = 5;
const TOP = 142;
const BOTTOM = H - 74;
const LANE_H = (BOTTOM - TOP) / LANES;
const QUICK_LEFT = 142;
const CASTLE_X = 245;
const CASTLE_Y = 366;
const TYCOON_GATE_X = 318;
const BUILD_TIME = 55;
const ATTACK_TIME = 48;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);
const fmt = (value) => Math.floor(value).toLocaleString('en-US');
const laneY = (lane) => TOP + lane * LANE_H + LANE_H / 2;

const weapons = [
  { name: 'حجارة دفاعية', key: 'stone', color: '#a16207', glow: '#fde68a', damage: 25, speed: 820, radius: 14, cooldown: 520, splash: 0 },
  { name: 'سهام فولاذية', key: 'arrow', color: '#cbd5e1', glow: '#f8fafc', damage: 40, speed: 1020, radius: 11, cooldown: 450, splash: 0 },
  { name: 'قذائف نار', key: 'fire', color: '#f97316', glow: '#fed7aa', damage: 52, speed: 920, radius: 17, cooldown: 490, splash: 82 },
  { name: 'جليد كاسر', key: 'ice', color: '#38bdf8', glow: '#bae6fd', damage: 42, speed: 970, radius: 16, cooldown: 430, splash: 66, slow: .46 },
  { name: 'بلازما', key: 'plasma', color: '#8b5cf6', glow: '#ddd6fe', damage: 82, speed: 1110, radius: 19, cooldown: 395, splash: 108 },
  { name: 'نواة ملكية', key: 'royal', color: '#facc15', glow: '#fff7ad', damage: 122, speed: 1240, radius: 23, cooldown: 360, splash: 148 }
];

const enemyTypes = [
  { key: 'imp', name: 'مخلب', hp: 42, speed: 66, radius: 20, color: '#22c55e', reward: 8, damage: 8 },
  { key: 'crawler', name: 'زاحف', hp: 74, speed: 48, radius: 23, color: '#84cc16', reward: 12, damage: 11 },
  { key: 'brute', name: 'محطم', hp: 132, speed: 34, radius: 31, color: '#16a34a', reward: 20, damage: 17 },
  { key: 'armored', name: 'مدرع', hp: 205, speed: 28, radius: 33, color: '#0f766e', reward: 30, damage: 24 },
  { key: 'witch', name: 'ساحر', hp: 155, speed: 41, radius: 28, color: '#a855f7', reward: 35, damage: 21 },
  { key: 'boss', name: 'ملك الوحوش', hp: 730, speed: 24, radius: 52, color: '#b91c1c', reward: 125, damage: 52 }
];

const state = {
  screen: 'menu', status: 'menu', mode: null, phase: 'idle', last: 0, time: 0, phaseTime: BUILD_TIME,
  wave: 1, cycle: 1, spawnTarget: 0, spawned: 0, spawnCooldown: 0,
  castleLevel: 1, wallLevel: 0, weaponLevel: 1, towerLevel: 0, mineLevel: 1, forgeLevel: 1, researchLevel: 1,
  maxHealth: 140, health: 140, coins: 90,
  bestQuick: Number(localStorage.getItem('2d_best_quick') || 0), bestTycoon: Number(localStorage.getItem('2d_best_tycoon') || 0),
  enemies: [], shots: [], particles: [], texts: [], rings: [], cooldowns: Array(LANES).fill(0), zones: [],
  incomeTick: 0, towerTick: 0, shake: 0, kills: 0, totalKills: 0, mouse: { x: 0, y: 0 }, xo: null, challengeLock: 0, selectedZone: null
};

function activeWeapon() {
  const index = clamp(state.weaponLevel + state.forgeLevel - 2, 0, weapons.length - 1);
  const base = weapons[index];
  const researchBoost = 1 + (state.researchLevel - 1) * 0.14;
  return { ...base, damage: Math.round(base.damage * researchBoost), cooldown: Math.max(180, Math.round(base.cooldown * (1 - (state.researchLevel - 1) * 0.035))) };
}

const cost = {
  castle: () => state.castleLevel >= 7 ? Infinity : Math.round(105 * Math.pow(1.63, state.castleLevel - 1)),
  weapon: () => state.weaponLevel >= 6 ? Infinity : Math.round(90 * Math.pow(1.58, state.weaponLevel - 1)),
  wall: () => Math.round(80 * Math.pow(1.52, state.wallLevel)),
  tower: () => Math.round(160 * Math.pow(1.72, state.towerLevel)),
  mine: () => Math.round(95 * Math.pow(1.66, state.mineLevel - 1)),
  forge: () => state.forgeLevel >= 6 ? Infinity : Math.round(135 * Math.pow(1.7, state.forgeLevel - 1)),
  research: () => Math.round(210 * Math.pow(1.82, state.researchLevel - 1)),
  repair: () => Math.max(24, Math.round((state.maxHealth - state.health) * .55))
};

const zoneInfo = {
  castle: { title: 'القلعة', desc: 'تطويرها يزيد الصحة والتحمل.' },
  wall: { title: 'السور', desc: 'يقوي خط الدفاع ويقلل ضرر الوحوش.' },
  mine: { title: 'منجم العملات', desc: 'يزيد الدخل أثناء مرحلة البناء.' },
  tower: { title: 'البرج', desc: 'يطلق تلقائياً أثناء الهجوم.' },
  forge: { title: 'الحدادة', desc: 'تفتح أسلحة أعلى.' },
  research: { title: 'مركز البحث', desc: 'يزيد ضرر الأسلحة.' },
  repair: { title: 'الإصلاح', desc: 'يعيد جزءاً من صحة القلعة.' },
  xo: { title: 'تحدي XO', desc: 'اهزم البوت واجمع عملات.' },
  rps: { title: 'حجرة ورقة مقص', desc: 'تحدي سريع ضد البوت.' },
  guess: { title: 'تخمين الرقم', desc: 'خمن رقم البوت من 1 إلى 5.' }
};

function showScreen(screen) {
  state.screen = screen;
  menuScreen.classList.toggle('active', screen === 'menu');
  gameScreen.classList.toggle('active', screen === 'game');
}

function setOverlay(show, title = '', text = '', button = 'متابعة') {
  ui.overlay.classList.toggle('show', show);
  if (title) ui.overlayTitle.textContent = title;
  if (text) ui.overlayText.textContent = text;
  ui.overlayBtn.textContent = button;
}

function toast(message) {
  ui.toast.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { ui.toast.textContent = ''; }, 2400);
}

function reset(mode = state.mode || 'quick') {
  state.mode = mode;
  state.status = 'playing';
  state.phase = mode === 'tycoon' ? 'build' : 'attack';
  state.phaseTime = mode === 'tycoon' ? BUILD_TIME : Infinity;
  state.time = 0;
  state.wave = 1;
  state.cycle = 1;
  state.spawnTarget = mode === 'quick' ? 10 : 0;
  state.spawned = 0;
  state.spawnCooldown = mode === 'quick' ? .35 : 0;
  state.castleLevel = 1;
  state.wallLevel = 0;
  state.weaponLevel = 1;
  state.towerLevel = 0;
  state.mineLevel = 1;
  state.forgeLevel = 1;
  state.researchLevel = 1;
  state.maxHealth = mode === 'tycoon' ? 190 : 140;
  state.health = state.maxHealth;
  state.coins = mode === 'tycoon' ? 135 : 90;
  state.enemies = [];
  state.shots = [];
  state.particles = [];
  state.texts = [];
  state.rings = [];
  state.cooldowns = Array(LANES).fill(0);
  state.incomeTick = 0;
  state.towerTick = 0;
  state.shake = 0;
  state.kills = 0;
  state.totalKills = 0;
  state.xo = null;
  state.challengeLock = 0;
  state.selectedZone = null;
  ui.miniGame.innerHTML = '';
  showScreen('game');
  setOverlay(false);
  toast(mode === 'tycoon' ? 'بدأت مرحلة البناء — اضغط المباني داخل الخريطة للتطوير' : 'بدأ الطور السريع');
}

function startMode(mode) { reset(mode); }

function goHome() {
  state.status = 'menu';
  state.mode = null;
  state.phase = 'idle';
  state.enemies = [];
  state.shots = [];
  state.selectedZone = null;
  showScreen('menu');
  setOverlay(false);
}

function pauseGame() {
  if (state.screen !== 'game') return;
  if (state.status === 'gameover') return reset();
  if (state.status === 'paused') {
    state.status = 'playing';
    setOverlay(false);
  } else {
    state.status = 'paused';
    setOverlay(true, 'إيقاف مؤقت', 'اللعبة متوقفة. اضغط متابعة للرجوع.', 'متابعة');
  }
}

function spend(kind) {
  if (state.mode === 'tycoon' && state.phase !== 'build' && kind !== 'repair') return toast('التطوير متاح في مرحلة البناء فقط');
  const price = cost[kind]();
  if (price === Infinity) return toast('وصلت لأقصى مستوى');
  if (state.coins < price) return toast(`تحتاج ${fmt(price)} عملة`);
  state.coins -= price;
  if (kind === 'castle') { state.castleLevel++; state.maxHealth += 75 + state.castleLevel * 18; state.health = Math.min(state.maxHealth, state.health + 140); boom(CASTLE_X, CASTLE_Y - 120, '#facc15', 60); say(CASTLE_X, CASTLE_Y - 185, `قلعة Lv.${state.castleLevel}`, '#facc15'); }
  if (kind === 'weapon') { state.weaponLevel++; say(CASTLE_X + 110, CASTLE_Y - 110, activeWeapon().name, '#38bdf8'); }
  if (kind === 'wall') { state.wallLevel++; state.maxHealth += 45; state.health += 45; boom(TYCOON_GATE_X, CASTLE_Y, '#94a3b8', 38); }
  if (kind === 'tower') state.towerLevel++;
  if (kind === 'mine') state.mineLevel++;
  if (kind === 'forge') state.forgeLevel++;
  if (kind === 'research') state.researchLevel++;
  if (kind === 'repair') state.health = Math.min(state.maxHealth, state.health + Math.round(state.maxHealth * .44));
  state.selectedZone = kind;
  toast('تم التطوير داخل الخريطة');
}

function zoneCostLabel(kind) {
  if (['xo', 'rps', 'guess'].includes(kind)) return 'تحدي';
  const price = cost[kind] ? cost[kind]() : Infinity;
  if (price === Infinity) return 'MAX';
  return fmt(price);
}

function beginAttackPhase() {
  state.phase = 'attack';
  state.phaseTime = ATTACK_TIME + state.cycle * 3;
  state.wave = state.cycle;
  state.spawned = 0;
  state.spawnTarget = 8 + state.cycle * 3;
  state.spawnCooldown = .6;
  state.xo = null;
  ui.miniGame.innerHTML = '';
  state.status = 'paused';
  setOverlay(true, 'بدأ الهجوم', 'انتهى وقت البناء. دافع عن قلعتك حتى ينتهي وقت الهجوم.', 'ابدأ الدفاع');
  toast('مرحلة الهجوم بدأت');
}

function endAttackPhase() {
  const reward = 90 + state.cycle * 35 + state.wallLevel * 8;
  state.coins += reward;
  state.cycle++;
  state.phase = 'build';
  state.phaseTime = BUILD_TIME + Math.min(18, state.castleLevel * 3);
  state.spawned = 0;
  state.spawnTarget = 0;
  state.enemies = [];
  state.shots = [];
  state.status = 'paused';
  say(CASTLE_X, CASTLE_Y - 190, `مكافأة صمود +${reward}`, '#facc15');
  setOverlay(true, 'رجعت مرحلة البناء', `كسبت ${reward} عملة. اضغط المباني داخل الخريطة للتطوير.`, 'ابدأ البناء');
}

function quickNextWave() {
  const reward = 45 + state.wave * 13;
  state.coins += reward;
  state.wave++;
  state.spawned = 0;
  state.spawnTarget = 9 + state.wave * 2 + (state.wave % 5 === 0 ? 1 : 0);
  state.spawnCooldown = 1.0;
  if (state.wave > state.bestQuick) { state.bestQuick = state.wave; localStorage.setItem('2d_best_quick', String(state.bestQuick)); }
  say(W / 2, 110, `موجة جديدة +${reward}`, '#facc15');
}

function selectedEnemyType() {
  const difficulty = state.mode === 'quick' ? state.wave : state.cycle;
  if (difficulty % 5 === 0 && state.spawned === state.spawnTarget - 1) return enemyTypes[5];
  const roll = Math.random();
  if (difficulty >= 8 && roll > .87) return enemyTypes[4];
  if (difficulty >= 6 && roll > .74) return enemyTypes[3];
  if (difficulty >= 3 && roll > .56) return enemyTypes[2];
  if (difficulty >= 2 && roll > .35) return enemyTypes[1];
  return enemyTypes[0];
}

function spawnEnemy() {
  const type = selectedEnemyType();
  const lane = Math.floor(Math.random() * LANES);
  const difficulty = state.mode === 'quick' ? state.wave : state.cycle;
  const scale = 1 + (difficulty - 1) * (state.mode === 'quick' ? .17 : .14);
  const bossScale = type.key === 'boss' ? 1 + Math.floor(difficulty / 5) * .35 : 1;
  const hp = Math.round(type.hp * scale * bossScale);
  const targetX = state.mode === 'tycoon' ? TYCOON_GATE_X : QUICK_LEFT;
  state.enemies.push({
    type: type.key, name: type.name, lane, x: W + rand(30, 150), y: laneY(lane), radius: type.radius * (type.key === 'boss' ? 1.12 : 1),
    hp, maxHp: hp, speed: type.speed * (1 + difficulty * .015), baseSpeed: type.speed * (1 + difficulty * .015), reward: Math.round(type.reward * scale * bossScale),
    damage: Math.round(type.damage * bossScale), color: type.color, slowTime: 0, wobble: rand(0, 6), targetX
  });
}

function shoot(lane, auto = false) {
  if (state.status !== 'playing') return;
  if (state.mode === 'tycoon' && state.phase !== 'attack' && !auto) return toast('الإطلاق يكون في مرحلة الهجوم');
  lane = clamp(lane, 0, LANES - 1);
  const weapon = activeWeapon();
  if (!auto && state.cooldowns[lane] > 0) return say(LEFTForMode() + 110, laneY(lane), 'تبريد', '#cbd5e1');
  if (!auto) state.cooldowns[lane] = weapon.cooldown;
  const startX = state.mode === 'tycoon' ? TYCOON_GATE_X - 18 : QUICK_LEFT - 6;
  state.shots.push({ x: startX, y: laneY(lane), lane, vx: weapon.speed, radius: weapon.radius, damage: weapon.damage, splash: weapon.splash, slow: weapon.slow || 0, color: weapon.color, glow: weapon.glow, type: weapon.key, life: 1.9, spin: 0 });
  boom(startX + 16, laneY(lane), weapon.glow, 10);
}

function LEFTForMode() { return state.mode === 'tycoon' ? TYCOON_GATE_X : QUICK_LEFT; }

function update(dt) {
  if (state.status !== 'playing') return;
  state.time += dt;
  state.challengeLock = Math.max(0, state.challengeLock - dt);
  state.cooldowns = state.cooldowns.map((v) => Math.max(0, v - dt * 1000));
  state.shake = Math.max(0, state.shake - dt * 22);
  if (state.mode === 'quick') updateQuick(dt);
  if (state.mode === 'tycoon') updateTycoon(dt);
  updateEnemies(dt);
  updateShots(dt);
  updateEffects(dt);
}

function updateQuick(dt) {
  state.spawnCooldown -= dt;
  if (state.spawned < state.spawnTarget && state.spawnCooldown <= 0) {
    spawnEnemy(); state.spawned++; state.spawnCooldown = Math.max(.3, .86 - state.wave * .035) + rand(0, .18);
  }
  if (state.spawned >= state.spawnTarget && state.enemies.length === 0) quickNextWave();
}

function updateTycoon(dt) {
  if (state.phase === 'build') {
    state.phaseTime -= dt;
    state.incomeTick += dt;
    if (state.incomeTick >= 1) {
      state.incomeTick = 0;
      const income = 4 + state.mineLevel * 5;
      state.coins += income;
      say(CASTLE_X + 20, CASTLE_Y + 115, `منجم +${income}`, '#facc15');
    }
    if (state.phaseTime <= 0) beginAttackPhase();
    return;
  }
  if (state.phase === 'attack') {
    state.phaseTime -= dt;
    state.spawnCooldown -= dt;
    if (state.spawned < state.spawnTarget && state.spawnCooldown <= 0) {
      spawnEnemy(); state.spawned++; state.spawnCooldown = Math.max(.34, 1.02 - state.cycle * .035) + rand(0, .2);
    }
    if (state.towerLevel > 0) {
      state.towerTick += dt;
      const towerRate = Math.max(.35, 1.4 - state.towerLevel * .16);
      if (state.towerTick >= towerRate) {
        state.towerTick = 0;
        const target = state.enemies.find((enemy) => enemy.x > TYCOON_GATE_X + 50);
        if (target) shoot(target.lane, true);
      }
    }
    if (state.phaseTime <= 0) endAttackPhase();
  }
}

function updateEnemies(dt) {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    enemy.wobble += dt * 5;
    if (enemy.slowTime > 0) { enemy.slowTime -= dt; if (enemy.slowTime <= 0) enemy.speed = enemy.baseSpeed; }
    enemy.x -= enemy.speed * dt;
    enemy.y = laneY(enemy.lane) + Math.sin(enemy.wobble) * 4;
    if (enemy.x - enemy.radius < enemy.targetX - 22) { damageCastle(enemy); state.enemies.splice(i, 1); continue; }
    if (enemy.hp <= 0) { killEnemy(enemy); state.enemies.splice(i, 1); }
  }
}

function updateShots(dt) {
  for (let i = state.shots.length - 1; i >= 0; i--) {
    const shot = state.shots[i];
    shot.x += shot.vx * dt; shot.spin += dt * 8; shot.life -= dt;
    if (shot.x > W + 90 || shot.life <= 0) { state.shots.splice(i, 1); continue; }
    for (const enemy of state.enemies) {
      if (enemy.lane !== shot.lane) continue;
      if (Math.hypot(enemy.x - shot.x, enemy.y - shot.y) < enemy.radius + shot.radius) { hitEnemy(enemy, shot); state.shots.splice(i, 1); break; }
    }
  }
}

function hitEnemy(enemy, shot) {
  enemy.hp -= shot.damage;
  say(enemy.x, enemy.y - enemy.radius - 14, `-${shot.damage}`, shot.glow);
  boom(shot.x, shot.y, shot.glow, 15);
  if (shot.slow) { enemy.slowTime = 1.8; enemy.speed = enemy.baseSpeed * shot.slow; }
  if (shot.splash) {
    state.rings.push({ x: shot.x, y: shot.y, radius: 8, max: shot.splash, life: .34, color: shot.glow });
    for (const other of state.enemies) {
      if (other === enemy) continue;
      const distance = Math.hypot(other.x - shot.x, other.y - shot.y);
      if (distance < shot.splash) {
        const damage = Math.round(shot.damage * (1 - distance / shot.splash) * .55);
        if (damage > 0) { other.hp -= damage; say(other.x, other.y - other.radius, `-${damage}`, shot.glow); }
      }
    }
  }
}

function killEnemy(enemy) {
  state.coins += enemy.reward;
  state.kills++;
  state.totalKills++;
  boom(enemy.x, enemy.y, enemy.color, enemy.type === 'boss' ? 80 : 34);
  say(enemy.x, enemy.y - enemy.radius - 24, `+${enemy.reward}`, '#facc15');
}

function damageCastle(enemy) {
  const wallReduction = state.mode === 'tycoon' ? Math.min(.5, state.wallLevel * .08) : 0;
  const damage = Math.max(1, Math.round(enemy.damage * (1 - wallReduction)));
  state.health = Math.max(0, state.health - damage);
  state.shake = 10;
  boom(LEFTForMode() - 14, enemy.y, '#ef4444', 30);
  say(LEFTForMode() + 60, enemy.y, `-${damage}`, '#ef4444');
  if (state.health <= 0) gameOver();
}

function gameOver() {
  state.status = 'gameover';
  if (state.mode === 'quick' && state.wave > state.bestQuick) { state.bestQuick = state.wave; localStorage.setItem('2d_best_quick', String(state.bestQuick)); }
  if (state.mode === 'tycoon' && state.cycle > state.bestTycoon) { state.bestTycoon = state.cycle; localStorage.setItem('2d_best_tycoon', String(state.bestTycoon)); }
  const progress = state.mode === 'tycoon' ? `وصلت إلى دورة ${state.cycle}` : `وصلت إلى موجة ${state.wave}`;
  setOverlay(true, 'سقطت القلعة', `${progress}. طور القلعة والسور والسلاح قبل الهجوم القادم.`, 'إعادة المحاولة');
}

function updateEffects(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) { const p = state.particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt; p.life -= dt; if (p.life <= 0) state.particles.splice(i, 1); }
  for (let i = state.texts.length - 1; i >= 0; i--) { const text = state.texts[i]; text.y -= 34 * dt; text.life -= dt; if (text.life <= 0) state.texts.splice(i, 1); }
  for (let i = state.rings.length - 1; i >= 0; i--) { const ring = state.rings[i]; ring.radius += (ring.max / .34) * dt; ring.life -= dt; if (ring.life <= 0) state.rings.splice(i, 1); }
}

function boom(x, y, color, count = 18) {
  for (let i = 0; i < count; i++) { const angle = rand(0, Math.PI * 2); const speed = rand(60, 190); state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: rand(2, 5), color, life: rand(.28, .78) }); }
}
function say(x, y, text, color) { state.texts.push({ x, y, text, color, life: 1.2 }); }

function canChallenge() {
  if (state.mode !== 'tycoon') { toast('التحديات موجودة في Tycoon فقط'); return false; }
  if (state.phase !== 'build') { toast('التحديات تعمل في مرحلة البناء فقط'); return false; }
  if (state.challengeLock > 0) { toast('انتظر لحظة قبل تحدي جديد'); return false; }
  return true;
}
function startRps() {
  if (!canChallenge()) return;
  state.selectedZone = 'rps';
  ui.miniGame.innerHTML = `<p class="hint-line">حجرة ورقة مقص ضد البوت</p><div class="choice-row"><button data-rps="rock">حجرة</button><button data-rps="paper">ورقة</button><button data-rps="scissors">مقص</button></div>`;
  ui.miniGame.querySelectorAll('[data-rps]').forEach((btn) => btn.onclick = () => playRps(btn.dataset.rps));
}
function playRps(choice) {
  const items = ['rock', 'paper', 'scissors'];
  const bot = items[Math.floor(Math.random() * items.length)];
  const names = { rock: 'حجرة', paper: 'ورقة', scissors: 'مقص' };
  let result = 'تعادل', reward = 18;
  if ((choice === 'rock' && bot === 'scissors') || (choice === 'paper' && bot === 'rock') || (choice === 'scissors' && bot === 'paper')) { result = 'فزت'; reward = 55 + state.cycle * 5; }
  else if (choice !== bot) { result = 'خسرت'; reward = 8; }
  state.coins += reward; state.challengeLock = .9;
  ui.miniGame.innerHTML = `<p>أنت: ${names[choice]} | البوت: ${names[bot]}<br><b>${result}</b> +${reward} عملة</p>`;
}
function startGuess() {
  if (!canChallenge()) return;
  state.selectedZone = 'guess';
  const target = Math.ceil(rand(0, 5));
  ui.miniGame.innerHTML = `<p class="hint-line">البوت اختار رقماً من 1 إلى 5</p><div class="choice-row">${[1,2,3,4,5].map((n) => `<button data-guess="${n}">${n}</button>`).join('')}</div>`;
  ui.miniGame.querySelectorAll('[data-guess]').forEach((btn) => { btn.onclick = () => { const guess = Number(btn.dataset.guess); const reward = guess === target ? 90 + state.cycle * 8 : Math.abs(guess - target) === 1 ? 28 : 10; state.coins += reward; state.challengeLock = 1.0; ui.miniGame.innerHTML = `<p>الرقم الصحيح: ${target}<br>${guess === target ? 'إصابة مباشرة' : 'محاولة'} +${reward} عملة</p>`; }; });
}
function startXO() { if (!canChallenge()) return; state.selectedZone = 'xo'; state.xo = { board: Array(9).fill(''), done: false }; renderXO('أنت X. ابدأ الحركة.'); }
function renderXO(message) { ui.miniGame.innerHTML = `<p class="hint-line">${message}</p><div class="xo-grid">${state.xo.board.map((cell, index) => `<button class="xo-cell" data-xo="${index}">${cell}</button>`).join('')}</div>`; ui.miniGame.querySelectorAll('[data-xo]').forEach((btn) => { btn.onclick = () => playerXO(Number(btn.dataset.xo)); }); }
function playerXO(index) {
  if (!state.xo || state.xo.done || state.xo.board[index]) return;
  state.xo.board[index] = 'X';
  const afterPlayer = checkXO(); if (afterPlayer) return finishXO(afterPlayer);
  const empty = state.xo.board.map((value, i) => value ? null : i).filter((v) => v !== null);
  if (empty.length) state.xo.board[chooseBotMove(empty)] = 'O';
  const afterBot = checkXO(); if (afterBot) return finishXO(afterBot);
  renderXO('دورك.');
}
function chooseBotMove(empty) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const mark of ['O','X']) for (const line of lines) { const values = line.map((i) => state.xo.board[i]); if (values.filter((v) => v === mark).length === 2 && values.includes('')) return line[values.indexOf('')]; }
  if (empty.includes(4)) return 4;
  return empty[Math.floor(Math.random() * empty.length)];
}
function checkXO() { const b = state.xo.board; const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]; for (const [a, c, d] of lines) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return b.every(Boolean) ? 'draw' : null; }
function finishXO(result) { state.xo.done = true; const reward = result === 'X' ? 120 + state.cycle * 10 : result === 'draw' ? 45 : 15; state.coins += reward; state.challengeLock = 1.2; const message = result === 'X' ? 'فزت على البوت' : result === 'draw' ? 'تعادل' : 'البوت فاز'; ui.miniGame.innerHTML += `<p><b>${message}</b> +${reward} عملة</p>`; }

function buildZones() {
  state.zones = [];
  if (state.mode !== 'tycoon' || state.phase !== 'build' || state.status !== 'playing') return;
  addZone('castle', CASTLE_X - 88, CASTLE_Y - 220, 158, 310);
  addZone('wall', TYCOON_GATE_X - 48, CASTLE_Y - 100, 70, 210);
  addZone('mine', 72, CASTLE_Y + 95, 120, 64);
  addZone('tower', CASTLE_X + 104, CASTLE_Y - 150, 82, 210);
  addZone('forge', 195, CASTLE_Y + 104, 104, 64);
  addZone('research', 60, TOP - 28, 130, 54);
  addZone('repair', CASTLE_X - 20, CASTLE_Y + 110, 110, 52);
  addZone('xo', 560, 110, 150, 64);
  addZone('rps', 730, 110, 170, 64);
  addZone('guess', 920, 110, 170, 64);
}
function addZone(kind, x, y, w, h) { state.zones.push({ kind, x, y, w, h }); }
function findZone(x, y) { return state.zones.find((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h); }
function triggerZone(kind) {
  state.selectedZone = kind;
  if (kind === 'xo') return startXO();
  if (kind === 'rps') return startRps();
  if (kind === 'guess') return startGuess();
  return spend(kind);
}

function draw() {
  buildZones();
  ctx.save(); if (state.shake > 0) ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
  drawWorld(ctx, W, H); drawLanes(ctx, W); if (state.mode === 'tycoon') drawTycoonBase(ctx); else drawQuickBase(ctx); drawTrails(ctx);
  state.enemies.forEach((enemy) => drawEnemy(ctx, enemy)); state.shots.forEach((shot) => drawShot(ctx, shot)); state.rings.forEach((ring) => drawRing(ctx, ring)); state.particles.forEach((particle) => drawParticle(ctx, particle)); state.texts.forEach((text) => drawText(ctx, text)); drawAim(ctx); drawMapZones(ctx);
  ctx.restore();
}
function drawWorld(c, width, height) { const sky = c.createLinearGradient(0, 0, width, height); sky.addColorStop(0, '#172554'); sky.addColorStop(.45, '#14532d'); sky.addColorStop(1, '#20283a'); c.fillStyle = sky; c.fillRect(0, 0, width, height); c.fillStyle = 'rgba(255,255,255,.055)'; for (let i = 0; i < 80; i++) c.fillRect((i * 113 + state.time * 12) % width, 28 + (i * 41) % 130, 2, 2); c.fillStyle = 'rgba(15,23,42,.58)'; mountain(c, 0, 210, 260, 95); mountain(c, 230, 190, 360, 118); mountain(c, 700, 210, 330, 102); mountain(c, 960, 175, 390, 136); }
function mountain(c, x, y, width, height) { c.beginPath(); c.moveTo(x, y + height); c.lineTo(x + width * .45, y); c.lineTo(x + width, y + height); c.closePath(); c.fill(); }
function drawLanes(c, width) { c.fillStyle = 'rgba(15,23,42,.35)'; c.fillRect(0, TOP - 24, width, BOTTOM - TOP + 48); for (let lane = 0; lane < LANES; lane++) { const y = TOP + lane * LANE_H, centerY = laneY(lane); const g = c.createLinearGradient(0, y, width, y + LANE_H); g.addColorStop(0, lane % 2 ? 'rgba(22,101,52,.35)' : 'rgba(34,197,94,.30)'); g.addColorStop(1, 'rgba(21,128,61,.18)'); c.fillStyle = g; c.fillRect(0, y, width, LANE_H); c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke(); c.setLineDash([16, 14]); c.strokeStyle = 'rgba(250,204,21,.13)'; c.beginPath(); c.moveTo(LEFTForMode() + 26, centerY); c.lineTo(width - 60, centerY); c.stroke(); c.setLineDash([]); } c.strokeStyle = 'rgba(239,68,68,.82)'; c.lineWidth = 5; c.beginPath(); c.moveTo(LEFTForMode() - 24, TOP - 24); c.lineTo(LEFTForMode() - 24, BOTTOM + 24); c.stroke(); }
function drawQuickBase(c) { drawCastle(c, 32, 172, state.castleLevel, false); }
function drawTycoonBase(c) { drawVillageGround(c); drawWall(c); drawCastle(c, CASTLE_X - 92, CASTLE_Y - 215, state.castleLevel, true); drawMine(c); drawTower(c, CASTLE_X + 105, CASTLE_Y - 146, Math.max(1, state.towerLevel)); drawForge(c); drawResearch(c); if (state.phase === 'build') { c.fillStyle = 'rgba(250,204,21,.08)'; c.fillRect(0, TOP - 24, W, BOTTOM - TOP + 48); } }
function drawVillageGround(c) { c.fillStyle = 'rgba(30,41,59,.42)'; roundRect(c, 22, TOP - 34, 340, BOTTOM - TOP + 70, 28); c.fill(); c.fillStyle = 'rgba(250,204,21,.08)'; roundRect(c, 68, CASTLE_Y + 98, 240, 74, 18); c.fill(); }
function drawWall(c) { const h = 125 + Math.max(1, state.wallLevel) * 18; const x = TYCOON_GATE_X - 38; const y = CASTLE_Y - h / 2; const blocks = 4 + state.wallLevel; c.fillStyle = state.wallLevel ? '#64748b' : 'rgba(100,116,139,.38)'; roundRect(c, x, y, 44, h, 10); c.fill(); c.fillStyle = '#94a3b8'; for (let i = 0; i < blocks; i++) c.fillRect(x + 3, y + 8 + i * (h / blocks), 38, 4); }
function drawCastle(c, x, y, level, tycoon) { const width = 105 + level * 10; const height = 360 + level * 8; c.save(); c.shadowColor = 'rgba(250,204,21,.24)'; c.shadowBlur = 22; const body = c.createLinearGradient(x, y, x + width, y + height); body.addColorStop(0, '#94a3b8'); body.addColorStop(.45, '#334155'); body.addColorStop(1, '#111827'); roundRect(c, x + 16, y + 52, width, height - 28, 24); c.fillStyle = body; c.fill(); c.fillStyle = '#facc15'; c.beginPath(); c.moveTo(x + 4, y + 55); c.lineTo(x + 68, y - 18); c.lineTo(x + width + 46, y + 55); c.closePath(); c.fill(); c.fillStyle = '#020617'; for (let i = 0; i < 4; i++) { c.fillRect(x + 40, y + 98 + i * 58, 24, 30); c.fillRect(x + 85, y + 98 + i * 58, 24, 30); } c.fillStyle = '#f97316'; c.fillRect(x + 62, y + height - 50, 44, 58); c.strokeStyle = '#facc15'; c.lineWidth = 3; c.beginPath(); c.arc(x + width + 40, tycoon ? CASTLE_Y : laneY(2), 38 + level * 4, -Math.PI / 2, Math.PI / 2); c.stroke(); c.restore(); }
function drawMine(c) { const x = 72, y = CASTLE_Y + 104; c.fillStyle = '#1f2937'; roundRect(c, x, y, 120, 58, 12); c.fill(); c.fillStyle = '#64748b'; c.fillRect(x + 14, y - 20, 18, 20); c.fillRect(x + 52, y - 32, 18, 32); c.fillStyle = '#facc15'; for (let i = 0; i < Math.min(7, state.mineLevel); i++) c.fillRect(x + 14 + i * 15, y + 18, 9, 20); }
function drawTower(c, x, y, level) { c.fillStyle = state.towerLevel ? '#334155' : 'rgba(51,65,85,.48)'; roundRect(c, x, y, 62, 196, 14); c.fill(); c.fillStyle = '#94a3b8'; c.beginPath(); c.moveTo(x - 10, y + 18); c.lineTo(x + 31, y - 22); c.lineTo(x + 72, y + 18); c.closePath(); c.fill(); c.fillStyle = '#38bdf8'; for (let i = 0; i < Math.max(1, level); i++) c.fillRect(x + 13, y + 44 + i * 24, 36, 8); }
function drawForge(c) { const x = 196, y = CASTLE_Y + 112; c.fillStyle = '#431407'; roundRect(c, x, y, 104, 56, 12); c.fill(); c.fillStyle = '#f97316'; c.beginPath(); c.arc(x + 52, y + 13, 20 + state.forgeLevel * 2, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fed7aa'; c.fillRect(x + 20, y + 36, 64, 6); }
function drawResearch(c) { const x = 60, y = TOP - 26; c.fillStyle = '#1e1b4b'; roundRect(c, x, y, 130, 54, 15); c.fill(); c.fillStyle = '#a78bfa'; c.beginPath(); c.arc(x + 27, y + 27, 14, 0, Math.PI * 2); c.fill(); c.fillStyle = '#ddd6fe'; c.font = 'bold 15px Tahoma'; c.fillText('بحث', x + 83, y + 32); }
function drawMapZones(c) { if (state.mode !== 'tycoon' || state.phase !== 'build' || state.status !== 'playing') return; for (const z of state.zones) { const active = state.selectedZone === z.kind || findZone(state.mouse.x, state.mouse.y) === z; c.save(); c.globalAlpha = active ? .98 : .76; c.strokeStyle = active ? '#facc15' : 'rgba(255,255,255,.33)'; c.lineWidth = active ? 4 : 2; roundRect(c, z.x, z.y, z.w, z.h, 14); c.stroke(); c.fillStyle = active ? 'rgba(250,204,21,.16)' : 'rgba(15,23,42,.20)'; c.fill(); drawZoneLabel(c, z); c.restore(); } }
function drawZoneLabel(c, z) { const info = zoneInfo[z.kind]; const title = info ? info.title : z.kind; const price = zoneCostLabel(z.kind); const cx = z.x + z.w / 2; const cy = z.y - 10; c.fillStyle = 'rgba(15,23,42,.86)'; roundRect(c, cx - 64, cy - 34, 128, 30, 12); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 13px Tahoma'; c.textAlign = 'center'; c.fillText(title, cx, cy - 16); c.fillStyle = '#facc15'; c.font = 'bold 12px Tahoma'; c.fillText(price, cx, cy - 1); }
function drawTrails(c) { for (const shot of state.shots) { c.globalAlpha = .25; c.strokeStyle = shot.glow; c.lineWidth = shot.radius * 1.2; c.beginPath(); c.moveTo(shot.x - 50, shot.y); c.lineTo(shot.x - 6, shot.y); c.stroke(); c.globalAlpha = 1; } }
function drawEnemy(c, enemy) { c.save(); c.translate(enemy.x, enemy.y); if (enemy.slowTime > 0) { c.strokeStyle = '#7dd3fc'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, enemy.radius + 8, 0, Math.PI * 2); c.stroke(); } c.shadowColor = enemy.color; c.shadowBlur = enemy.type === 'boss' ? 28 : 14; c.fillStyle = enemy.color; if (enemy.type === 'imp') monsterImp(c, enemy.radius); else if (enemy.type === 'crawler') monsterCrawler(c, enemy.radius); else if (enemy.type === 'brute') monsterBrute(c, enemy.radius); else if (enemy.type === 'armored') monsterArmored(c, enemy.radius); else if (enemy.type === 'witch') monsterWitch(c, enemy.radius); else monsterBoss(c, enemy.radius); c.shadowBlur = 0; drawEnemyHp(c, enemy); c.restore(); }
function monsterImp(c, r) { c.beginPath(); c.ellipse(0, 0, r * 1.05, r * .90, 0, 0, Math.PI * 2); c.fill(); eyes(c, r); horns(c, r, '#bbf7d0'); }
function monsterCrawler(c, r) { c.beginPath(); c.ellipse(0, 6, r * 1.35, r * .62, 0, 0, Math.PI * 2); c.fill(); eyes(c, r); legs(c, r); }
function monsterBrute(c, r) { roundRect(c, -r, -r * .8, r * 2, r * 1.75, 12); c.fill(); eyes(c, r); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-r * .7, r * .25, r * 1.4, r * .22); }
function monsterArmored(c, r) { roundRect(c, -r * 1.05, -r * .9, r * 2.1, r * 1.8, 14); c.fill(); c.strokeStyle = '#a7f3d0'; c.lineWidth = 4; c.stroke(); eyes(c, r); }
function monsterWitch(c, r) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); c.fillStyle = '#111827'; c.beginPath(); c.moveTo(-r * .9, -r * .7); c.lineTo(0, -r * 1.75); c.lineTo(r * .9, -r * .7); c.closePath(); c.fill(); eyes(c, r); }
function monsterBoss(c, r) { roundRect(c, -r * 1.05, -r * .9, r * 2.1, r * 1.82, 18); c.fill(); c.fillStyle = '#facc15'; c.beginPath(); c.moveTo(-r * .7, -r * .9); c.lineTo(-r * .35, -r * 1.55); c.lineTo(0, -r * .96); c.lineTo(r * .35, -r * 1.55); c.lineTo(r * .7, -r * .9); c.closePath(); c.fill(); eyes(c, r); }
function eyes(c, r) { c.fillStyle = '#fff'; c.beginPath(); c.arc(-r * .32, -r * .18, r * .15, 0, Math.PI * 2); c.arc(r * .28, -r * .18, r * .15, 0, Math.PI * 2); c.fill(); c.fillStyle = '#020617'; c.beginPath(); c.arc(-r * .32, -r * .18, r * .07, 0, Math.PI * 2); c.arc(r * .28, -r * .18, r * .07, 0, Math.PI * 2); c.fill(); }
function horns(c, r, color) { c.fillStyle = color; c.beginPath(); c.moveTo(-r * .65, -r * .45); c.lineTo(-r * .95, -r * 1.05); c.lineTo(-r * .25, -r * .75); c.moveTo(r * .65, -r * .45); c.lineTo(r * .95, -r * 1.05); c.lineTo(r * .25, -r * .75); c.fill(); }
function legs(c, r) { c.fillStyle = 'rgba(0,0,0,.28)'; for (let i = -2; i <= 2; i++) c.fillRect(i * r * .35, r * .42, 5, r * .55); }
function drawEnemyHp(c, enemy) { const width = enemy.radius * 2.35; const pct = clamp(enemy.hp / enemy.maxHp, 0, 1); c.fillStyle = 'rgba(0,0,0,.55)'; roundRect(c, -width / 2, -enemy.radius - 22, width, 7, 4); c.fill(); c.fillStyle = pct > .45 ? '#22c55e' : pct > .2 ? '#facc15' : '#ef4444'; roundRect(c, -width / 2, -enemy.radius - 22, width * pct, 7, 4); c.fill(); }
function drawShot(c, shot) { c.save(); c.translate(shot.x, shot.y); c.rotate(shot.spin); c.shadowColor = shot.glow; c.shadowBlur = 22; c.fillStyle = shot.color; if (shot.type === 'arrow') { c.beginPath(); c.moveTo(shot.radius * 2.1, 0); c.lineTo(-shot.radius * .8, -shot.radius * .55); c.lineTo(-shot.radius * .5, 0); c.lineTo(-shot.radius * .8, shot.radius * .55); c.closePath(); c.fill(); } else if (shot.type === 'ice') { c.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.lineTo(Math.cos(a) * shot.radius, Math.sin(a) * shot.radius); } c.closePath(); c.fill(); } else { c.beginPath(); c.arc(0, 0, shot.radius, 0, Math.PI * 2); c.fill(); c.strokeStyle = 'rgba(255,255,255,.48)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, shot.radius * .58, 0, Math.PI * 1.4); c.stroke(); } c.restore(); }
function drawRing(c, ring) { c.globalAlpha = clamp(ring.life / .34, 0, 1); c.strokeStyle = ring.color; c.lineWidth = 5; c.beginPath(); c.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
function drawParticle(c, p) { c.globalAlpha = clamp(p.life / .75, 0, 1); c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.radius, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1; }
function drawText(c, text) { c.globalAlpha = clamp(text.life, 0, 1); c.fillStyle = text.color; c.font = 'bold 20px Tahoma'; c.textAlign = 'center'; c.fillText(text.text, text.x, text.y); c.globalAlpha = 1; }
function drawAim(c) { if (state.status !== 'playing' || state.phase === 'build') return; const lane = clamp(Math.floor((state.mouse.y - TOP) / LANE_H), 0, LANES - 1); c.fillStyle = 'rgba(250,204,21,.075)'; c.fillRect(LEFTForMode(), laneY(lane) - LANE_H / 2, W - LEFTForMode(), LANE_H); }
function roundRect(c, x, y, width, height, radius) { const r = Math.min(radius, width / 2, height / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + width, y, x + width, y + height, r); c.arcTo(x + width, y + height, x, y + height, r); c.arcTo(x, y + height, x, y, r); c.arcTo(x, y, x + width, y, r); c.closePath(); }

function updateUI() {
  const w = activeWeapon();
  ui.mode.textContent = state.mode === 'tycoon' ? 'Tycoon' : state.mode === 'quick' ? 'سريع' : '-';
  ui.phase.textContent = state.phase === 'build' ? 'بناء' : state.phase === 'attack' ? 'هجوم' : '-';
  ui.phase.className = `value ${state.phase === 'build' ? 'phase-build' : state.phase === 'attack' ? 'phase-attack' : ''}`;
  ui.timer.textContent = state.phaseTime === Infinity ? '∞' : Math.max(0, Math.ceil(state.phaseTime)).toString();
  ui.wave.textContent = state.mode === 'tycoon' ? `دورة ${state.cycle}` : `موجة ${state.wave}`;
  ui.castle.textContent = `Lv.${state.castleLevel}`;
  ui.health.textContent = `${fmt(state.health)} / ${fmt(state.maxHealth)}`;
  ui.healthBar.style.width = `${clamp(state.health / state.maxHealth, 0, 1) * 100}%`;
  ui.coins.textContent = fmt(state.coins);
  ui.weapon.textContent = w.name;
  ui.pauseBtn.textContent = state.status === 'paused' ? 'متابعة' : 'إيقاف';
  const selected = state.selectedZone && zoneInfo[state.selectedZone] ? zoneInfo[state.selectedZone] : null;
  if (state.mode === 'tycoon') {
    const guide = state.phase === 'build'
      ? 'اضغط المباني داخل الخريطة للتطوير. التحديات أعلى الخريطة.'
      : 'مرحلة الهجوم: اضغط المسارات أو أزرار 1-5 للدفاع.';
    ui.log.innerHTML = `<span class="hint-line">${guide}</span><br>منجم: <b>+${4 + state.mineLevel * 5}/ث</b> | سور: <b>Lv.${state.wallLevel}</b> | برج: <b>Lv.${state.towerLevel}</b><br>${selected ? `<b>${selected.title}</b>: ${selected.desc} — التكلفة: <b>${zoneCostLabel(state.selectedZone)}</b>` : 'اختر مبنى من الخريطة.'}<br>أفضل دورة: <b>${state.bestTycoon}</b>`;
  } else {
    ui.log.innerHTML = `اضغط المسار داخل الخريطة أو أرقام <span class="kbd">1</span> إلى <span class="kbd">5</span> للإطلاق.<br>أفضل موجة: <b>${state.bestQuick}</b><br>القتلات: <b>${state.totalKills}</b>`;
  }
}

function previewLoop() {
  if (state.screen !== 'menu') return requestAnimationFrame(previewLoop);
  pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  drawWorld(pctx, previewCanvas.width, previewCanvas.height);
  pctx.save(); pctx.translate(110, 355); pctx.scale(.8, .8); monsterBoss(pctx, 50); pctx.restore();
  pctx.save(); pctx.translate(250, 380); pctx.scale(.82, .82); monsterArmored(pctx, 34); pctx.restore();
  pctx.save(); pctx.translate(390, 360); pctx.scale(.75, .75); monsterWitch(pctx, 36); pctx.restore();
  pctx.save(); pctx.translate(515, 390); pctx.scale(.90, .90); monsterImp(pctx, 28); pctx.restore();
  pctx.fillStyle = '#facc15'; pctx.font = 'bold 34px Tahoma'; pctx.textAlign = 'center'; pctx.fillText('تطوير داخل الخريطة', previewCanvas.width / 2, 78);
  pctx.fillStyle = '#cbd5e1'; pctx.font = '18px Tahoma'; pctx.fillText('مناسب للجوال واللابتوب', previewCanvas.width / 2, 114);
  requestAnimationFrame(previewLoop);
}
function frame(time) { const dt = Math.min(.033, (time - state.last) / 1000 || 0); state.last = time; update(dt); if (state.screen === 'game') { draw(); updateUI(); } requestAnimationFrame(frame); }

ui.quickCard.onclick = () => startMode('quick');
ui.tycoonCard.onclick = () => startMode('tycoon');
ui.homeBtn.onclick = goHome;
ui.pauseBtn.onclick = pauseGame;
ui.restartBtn.onclick = () => reset();
ui.overlayBtn.onclick = () => { if (state.status === 'paused') pauseGame(); else if (state.status === 'gameover') reset(); else setOverlay(false); };
document.querySelectorAll('[data-lane]').forEach((btn) => btn.onclick = () => shoot(Number(btn.dataset.lane)));
canvas.addEventListener('pointermove', (event) => { const rect = canvas.getBoundingClientRect(); state.mouse.x = (event.clientX - rect.left) * (W / rect.width); state.mouse.y = (event.clientY - rect.top) * (H / rect.height); });
canvas.addEventListener('pointerdown', (event) => {
  if (state.status === 'gameover') return reset();
  if (state.status !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (W / rect.width);
  const y = (event.clientY - rect.top) * (H / rect.height);
  state.mouse.x = x; state.mouse.y = y;
  if (state.mode === 'tycoon' && state.phase === 'build') {
    buildZones();
    const zone = findZone(x, y);
    if (zone) return triggerZone(zone.kind);
    return toast('اضغط على مبنى أو تحدي داخل الخريطة');
  }
  if (y < TOP || y > BOTTOM) return;
  shoot(Math.floor((y - TOP) / LANE_H));
});
window.addEventListener('keydown', (event) => { if (event.code === 'Space') { event.preventDefault(); pauseGame(); } if (event.key.toLowerCase() === 'r') reset(); if (['1', '2', '3', '4', '5'].includes(event.key)) shoot(Number(event.key) - 1); });

showScreen('menu');
previewLoop();
requestAnimationFrame(frame);
