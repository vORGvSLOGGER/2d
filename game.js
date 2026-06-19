'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  wave: document.getElementById('waveValue'),
  base: document.getElementById('baseValue'),
  health: document.getElementById('healthValue'),
  healthBar: document.getElementById('healthBar'),
  coins: document.getElementById('coinsValue'),
  weapon: document.getElementById('weaponValue'),
  best: document.getElementById('bestValue'),
  toast: document.getElementById('toast'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlayTitle'),
  overlayText: document.getElementById('overlayText'),
  overlayBtn: document.getElementById('overlayBtn'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  restartBtn: document.getElementById('restartBtn'),
  upgradeBaseBtn: document.getElementById('upgradeBaseBtn'),
  upgradePowerBtn: document.getElementById('upgradePowerBtn'),
  upgradeRateBtn: document.getElementById('upgradeRateBtn'),
  repairBtn: document.getElementById('repairBtn'),
  logText: document.getElementById('logText')
};

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const LANE_COUNT = 5;
const FIELD_LEFT = 128;
const FIELD_RIGHT = WIDTH - 60;
const LANE_TOP = 138;
const LANE_BOTTOM = HEIGHT - 70;
const LANE_HEIGHT = (LANE_BOTTOM - LANE_TOP) / LANE_COUNT;

const weapons = [
  { name: 'حجر دفاعي', color: '#a16207', glow: '#fbbf24', damage: 22, speed: 780, radius: 14, splash: 0, cooldown: 520, trail: '#fbbf24' },
  { name: 'كرة حديدية', color: '#94a3b8', glow: '#e2e8f0', damage: 38, speed: 860, radius: 17, splash: 0, cooldown: 480, trail: '#cbd5e1' },
  { name: 'قذيفة نارية', color: '#ea580c', glow: '#fed7aa', damage: 44, speed: 900, radius: 15, splash: 72, cooldown: 500, trail: '#fb923c' },
  { name: 'جليد كاسر', color: '#38bdf8', glow: '#bae6fd', damage: 34, speed: 930, radius: 15, splash: 54, cooldown: 450, slow: 0.48, trail: '#7dd3fc' },
  { name: 'بلازما زرقاء', color: '#7c3aed', glow: '#ddd6fe', damage: 70, speed: 1050, radius: 18, splash: 92, cooldown: 420, trail: '#a78bfa' },
  { name: 'نواة ميثك', color: '#facc15', glow: '#fff7ad', damage: 105, speed: 1180, radius: 22, splash: 130, cooldown: 390, trail: '#fde68a' }
];

const enemyTypes = [
  { key: 'runner', name: 'عدّاء', color: '#22c55e', hp: 42, speed: 58, radius: 19, reward: 7, damage: 8 },
  { key: 'brute', name: 'ضخم', color: '#16a34a', hp: 110, speed: 34, radius: 27, reward: 15, damage: 16 },
  { key: 'spitter', name: 'سام', color: '#84cc16', hp: 72, speed: 46, radius: 22, reward: 11, damage: 12 },
  { key: 'armored', name: 'مدرع', color: '#0f766e', hp: 165, speed: 28, radius: 30, reward: 22, damage: 22 },
  { key: 'boss', name: 'زعيم', color: '#b91c1c', hp: 560, speed: 23, radius: 46, reward: 90, damage: 40 }
];

const state = {
  status: 'menu',
  lastTime: 0,
  wave: 1,
  waveTime: 0,
  waveSpawned: 0,
  waveTarget: 8,
  spawnCooldown: 0,
  baseLevel: 1,
  maxHealth: 120,
  health: 120,
  coins: 70,
  kills: 0,
  totalKills: 0,
  powerLevel: 1,
  rateLevel: 1,
  bestWave: Number(localStorage.getItem('2d_best_wave') || 0),
  enemies: [],
  projectiles: [],
  particles: [],
  floaters: [],
  shockwaves: [],
  stars: [],
  cooldowns: Array(LANE_COUNT).fill(0),
  shake: 0,
  mouse: { x: 0, y: 0 }
};

function laneY(lane) {
  return LANE_TOP + lane * LANE_HEIGHT + LANE_HEIGHT / 2;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function currentWeapon() {
  const weapon = weapons[Math.min(weapons.length - 1, state.baseLevel - 1)];
  const powerBonus = 1 + (state.powerLevel - 1) * 0.22;
  const rateBonus = Math.max(0.42, 1 - (state.rateLevel - 1) * 0.08);
  return {
    ...weapon,
    damage: Math.round(weapon.damage * powerBonus),
    cooldown: Math.round(weapon.cooldown * rateBonus)
  };
}

function baseUpgradeCost() {
  return Math.round(90 * Math.pow(1.55, state.baseLevel - 1));
}

function powerCost() {
  return Math.round(65 * Math.pow(1.45, state.powerLevel - 1));
}

function rateCost() {
  return Math.round(70 * Math.pow(1.42, state.rateLevel - 1));
}

function repairCost() {
  return Math.max(25, Math.round((state.maxHealth - state.health) * 0.5));
}

function toast(message) {
  ui.toast.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    ui.toast.textContent = '';
  }, 2200);
}

function setOverlay(show, title = '', text = '', button = 'ابدأ') {
  ui.overlay.classList.toggle('show', show);
  if (title) ui.overlayTitle.textContent = title;
  if (text) ui.overlayText.textContent = text;
  ui.overlayBtn.textContent = button;
}

function startGame() {
  if (state.status === 'playing') return;
  if (state.status === 'gameover') resetGame();
  state.status = 'playing';
  setOverlay(false);
  ui.startBtn.textContent = 'مستمر';
  ui.pauseBtn.textContent = 'إيقاف مؤقت';
}

function togglePause() {
  if (state.status === 'menu') return startGame();
  if (state.status === 'gameover') return;

  if (state.status === 'paused') {
    state.status = 'playing';
    setOverlay(false);
    ui.pauseBtn.textContent = 'إيقاف مؤقت';
  } else {
    state.status = 'paused';
    setOverlay(true, 'إيقاف مؤقت', 'المعركة متوقفة. ارجع وكمل الدفاع.', 'متابعة');
    ui.pauseBtn.textContent = 'متابعة';
  }
}

function resetGame() {
  state.status = 'playing';
  state.wave = 1;
  state.waveTime = 0;
  state.waveSpawned = 0;
  state.waveTarget = 8;
  state.spawnCooldown = 0;
  state.baseLevel = 1;
  state.maxHealth = 120;
  state.health = 120;
  state.coins = 70;
  state.kills = 0;
  state.totalKills = 0;
  state.powerLevel = 1;
  state.rateLevel = 1;
  state.enemies.length = 0;
  state.projectiles.length = 0;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.shockwaves.length = 0;
  state.cooldowns = Array(LANE_COUNT).fill(0);
  state.shake = 0;
  setOverlay(false);
  toast('بدأت معركة جديدة');
}

function upgradeBase() {
  const cost = baseUpgradeCost();
  if (state.coins < cost) return toast(`تحتاج ${cost} عملة لتطوير القاعدة`);
  if (state.baseLevel >= weapons.length) return toast('وصلت القاعدة لأعلى مستوى حالياً');

  state.coins -= cost;
  state.baseLevel++;
  state.maxHealth += 45 + state.baseLevel * 12;
  state.health = Math.min(state.maxHealth, state.health + 85);
  state.shake = 5;

  const weapon = currentWeapon();
  toast(`تم تطوير القاعدة وفتح ${weapon.name}`);
  addFloater(FIELD_LEFT + 90, 95, `سلاح جديد: ${weapon.name}`, '#facc15');
  burst(FIELD_LEFT + 60, 130, '#facc15', 42, 6);
}

function upgradePower() {
  const cost = powerCost();
  if (state.coins < cost) return toast(`تحتاج ${cost} عملة لترقية القوة`);
  state.coins -= cost;
  state.powerLevel++;
  toast(`قوة السلاح الآن Lv.${state.powerLevel}`);
}

function upgradeRate() {
  const cost = rateCost();
  if (state.coins < cost) return toast(`تحتاج ${cost} عملة لترقية السرعة`);
  state.coins -= cost;
  state.rateLevel++;
  toast(`سرعة الإطلاق الآن Lv.${state.rateLevel}`);
}

function repairBase() {
  const missing = state.maxHealth - state.health;
  if (missing <= 0) return toast('القاعدة سليمة');
  const cost = repairCost();
  if (state.coins < cost) return toast(`تحتاج ${cost} عملة للإصلاح`);
  state.coins -= cost;
  const repair = Math.min(missing, Math.round(state.maxHealth * 0.38));
  state.health += repair;
  addFloater(FIELD_LEFT + 85, 120, `+${repair} صحة`, '#22c55e');
  toast('تم إصلاح القاعدة');
}

function shoot(lane) {
  if (state.status !== 'playing') return;
  lane = clamp(lane, 0, LANE_COUNT - 1);

  if (state.cooldowns[lane] > 0) {
    addFloater(FIELD_LEFT + 130, laneY(lane), 'انتظر', '#cbd5e1');
    return;
  }

  const weapon = currentWeapon();
  state.cooldowns[lane] = weapon.cooldown;

  const startX = FIELD_LEFT - 6;
  const startY = laneY(lane);
  state.projectiles.push({
    x: startX,
    y: startY,
    lane,
    vx: weapon.speed,
    radius: weapon.radius,
    damage: weapon.damage,
    splash: weapon.splash,
    slow: weapon.slow || 0,
    color: weapon.color,
    glow: weapon.glow,
    trail: weapon.trail,
    spin: 0,
    life: 1.7
  });

  burst(startX + 12, startY, weapon.trail, 8, 3);
}

function getEnemyForWave() {
  const list = [enemyTypes[0]];
  if (state.wave >= 2) list.push(enemyTypes[1]);
  if (state.wave >= 3) list.push(enemyTypes[2]);
  if (state.wave >= 5) list.push(enemyTypes[3]);

  if (state.wave % 5 === 0 && state.waveSpawned === state.waveTarget - 1) {
    return enemyTypes[4];
  }

  const roll = Math.random();
  if (state.wave >= 5 && roll > 0.82) return enemyTypes[3];
  if (state.wave >= 3 && roll > 0.64) return enemyTypes[2];
  if (state.wave >= 2 && roll > 0.40) return enemyTypes[1];
  return list[0];
}

function spawnEnemy() {
  const type = getEnemyForWave();
  const lane = Math.floor(Math.random() * LANE_COUNT);
  const scale = 1 + (state.wave - 1) * 0.14;
  const bossBoost = type.key === 'boss' ? 1 + Math.floor(state.wave / 5) * 0.35 : 1;
  const maxHp = Math.round(type.hp * scale * bossBoost);

  state.enemies.push({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2),
    type: type.key,
    name: type.name,
    lane,
    x: WIDTH + rand(20, 120),
    y: laneY(lane),
    radius: type.radius * (type.key === 'boss' ? 1.15 : 1),
    maxHp,
    hp: maxHp,
    speed: type.speed * (1 + state.wave * 0.018),
    baseSpeed: type.speed * (1 + state.wave * 0.018),
    reward: Math.round(type.reward * scale * bossBoost),
    damage: Math.round(type.damage * bossBoost),
    color: type.color,
    slowTime: 0,
    wobble: Math.random() * Math.PI * 2
  });
}

function updateWave(dt) {
  state.waveTime += dt;
  state.spawnCooldown -= dt;

  if (state.waveSpawned < state.waveTarget && state.spawnCooldown <= 0) {
    spawnEnemy();
    state.waveSpawned++;
    state.spawnCooldown = Math.max(0.34, 1.05 - state.wave * 0.035) + rand(0, 0.22);
  }

  if (state.waveSpawned >= state.waveTarget && state.enemies.length === 0) {
    completeWave();
  }
}

function completeWave() {
  const reward = 35 + state.wave * 12;
  state.coins += reward;
  addFloater(WIDTH / 2, 110, `مكافأة موجة +${reward}`, '#facc15');
  burst(WIDTH / 2, 160, '#facc15', 32, 5);

  state.wave++;
  state.waveTime = 0;
  state.waveSpawned = 0;
  state.waveTarget = 7 + state.wave * 2 + (state.wave % 5 === 0 ? 1 : 0);
  state.spawnCooldown = 1.25;

  if (state.wave > state.bestWave) {
    state.bestWave = state.wave;
    localStorage.setItem('2d_best_wave', String(state.bestWave));
  }

  toast(`موجة ${state.wave} بدأت`);
}

function damageBase(enemy) {
  state.health = Math.max(0, state.health - enemy.damage);
  state.shake = 10;
  burst(FIELD_LEFT + 35, enemy.y, '#ef4444', 22, 5);
  addFloater(FIELD_LEFT + 80, enemy.y - 15, `-${enemy.damage}`, '#ef4444');

  if (state.health <= 0) {
    state.status = 'gameover';
    if (state.wave > state.bestWave) {
      state.bestWave = state.wave;
      localStorage.setItem('2d_best_wave', String(state.bestWave));
    }
    setOverlay(true, 'سقطت القاعدة', `وصلت إلى الموجة ${state.wave}. طوّر القاعدة أسرع في المحاولة القادمة.`, 'إعادة المحاولة');
    ui.startBtn.textContent = 'ابدأ';
  }
}

function hitEnemy(enemy, projectile) {
  enemy.hp -= projectile.damage;

  if (projectile.slow) {
    enemy.slowTime = Math.max(enemy.slowTime, 1.7);
    enemy.speed = enemy.baseSpeed * projectile.slow;
  }

  addFloater(enemy.x, enemy.y - enemy.radius - 8, `-${projectile.damage}`, projectile.glow);
  burst(projectile.x, projectile.y, projectile.trail, 16, 4);

  if (projectile.splash > 0) {
    state.shockwaves.push({ x: projectile.x, y: projectile.y, r: 8, max: projectile.splash, life: 0.32, color: projectile.glow });

    for (const other of state.enemies) {
      if (other === enemy) continue;
      const dist = Math.hypot(other.x - projectile.x, other.y - projectile.y);
      if (dist <= projectile.splash) {
        const splashDamage = Math.round(projectile.damage * (1 - dist / projectile.splash) * 0.55);
        if (splashDamage > 0) {
          other.hp -= splashDamage;
          addFloater(other.x, other.y - other.radius, `-${splashDamage}`, projectile.glow);
        }
      }
    }
  }
}

function killEnemy(enemy) {
  state.coins += enemy.reward;
  state.kills++;
  state.totalKills++;
  burst(enemy.x, enemy.y, enemy.color, enemy.type === 'boss' ? 64 : 28, enemy.type === 'boss' ? 8 : 5);
  addFloater(enemy.x, enemy.y - enemy.radius - 20, `+${enemy.reward}`, '#facc15');
}

function update(dt) {
  if (state.status !== 'playing') return;

  updateWave(dt);

  for (let i = 0; i < state.cooldowns.length; i++) {
    state.cooldowns[i] = Math.max(0, state.cooldowns[i] - dt * 1000);
  }

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    enemy.wobble += dt * 5;

    if (enemy.slowTime > 0) {
      enemy.slowTime -= dt;
      if (enemy.slowTime <= 0) enemy.speed = enemy.baseSpeed;
    }

    enemy.x -= enemy.speed * dt;
    enemy.y = laneY(enemy.lane) + Math.sin(enemy.wobble) * 3;

    if (enemy.x - enemy.radius < FIELD_LEFT - 18) {
      damageBase(enemy);
      state.enemies.splice(i, 1);
      continue;
    }

    if (enemy.hp <= 0) {
      killEnemy(enemy);
      state.enemies.splice(i, 1);
    }
  }

  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const projectile = state.projectiles[i];
    projectile.x += projectile.vx * dt;
    projectile.spin += dt * 8;
    projectile.life -= dt;

    if (projectile.x > WIDTH + 60 || projectile.life <= 0) {
      state.projectiles.splice(i, 1);
      continue;
    }

    for (let j = 0; j < state.enemies.length; j++) {
      const enemy = state.enemies[j];
      if (enemy.lane !== projectile.lane) continue;
      const distance = Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y);
      if (distance < enemy.radius + projectile.radius) {
        hitEnemy(enemy, projectile);
        state.projectiles.splice(i, 1);
        break;
      }
    }
  }

  updateEffects(dt);
}

function updateEffects(dt) {
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 20);

  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 180 * dt;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }

  for (let i = state.floaters.length - 1; i >= 0; i--) {
    const f = state.floaters[i];
    f.y -= 32 * dt;
    f.life -= dt;
    if (f.life <= 0) state.floaters.splice(i, 1);
  }

  for (let i = state.shockwaves.length - 1; i >= 0; i--) {
    const s = state.shockwaves[i];
    s.r += (s.max / 0.32) * dt;
    s.life -= dt;
    if (s.life <= 0) state.shockwaves.splice(i, 1);
  }
}

function burst(x, y, color, count = 16, power = 4) {
  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(55, 115) * power / 4;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: rand(2, 5),
      color,
      life: rand(0.28, 0.75)
    });
  }
}

function addFloater(x, y, text, color) {
  state.floaters.push({ x, y, text, color, life: 1.15 });
}

function draw() {
  ctx.save();
  const shakeX = state.shake > 0 ? rand(-state.shake, state.shake) : 0;
  const shakeY = state.shake > 0 ? rand(-state.shake, state.shake) : 0;
  ctx.translate(shakeX, shakeY);

  drawBackground();
  drawLanes();
  drawBase();
  drawProjectilesBehind();
  state.enemies.forEach(drawEnemy);
  state.projectiles.forEach(drawProjectile);
  state.shockwaves.forEach(drawShockwave);
  state.particles.forEach(drawParticle);
  state.floaters.forEach(drawFloater);
  drawCrosshair();

  ctx.restore();
}

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#172554');
  bg.addColorStop(0.45, '#14532d');
  bg.addColorStop(1, '#1f2937');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 70; i++) {
    const x = (i * 97 + state.waveTime * 14) % WIDTH;
    const y = 30 + ((i * 53) % 150);
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
  drawMountain(0, 178, 240, 90);
  drawMountain(210, 165, 340, 108);
  drawMountain(620, 185, 280, 86);
  drawMountain(900, 150, 360, 120);
}

function drawMountain(x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.45, y);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

function drawLanes() {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.34)';
  ctx.fillRect(0, LANE_TOP - 24, WIDTH, LANE_BOTTOM - LANE_TOP + 48);

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const y = LANE_TOP + lane * LANE_HEIGHT;
    const center = laneY(lane);

    const laneGradient = ctx.createLinearGradient(0, y, WIDTH, y + LANE_HEIGHT);
    laneGradient.addColorStop(0, lane % 2 === 0 ? 'rgba(34,197,94,0.30)' : 'rgba(21,128,61,0.36)');
    laneGradient.addColorStop(1, lane % 2 === 0 ? 'rgba(101,163,13,0.28)' : 'rgba(22,101,52,0.28)');
    ctx.fillStyle = laneGradient;
    ctx.fillRect(0, y, WIDTH, LANE_HEIGHT);

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(250,204,21,0.15)';
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(FIELD_LEFT + 28, center);
    ctx.lineTo(FIELD_RIGHT, center);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = 'rgba(239,68,68,0.85)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(FIELD_LEFT - 20, LANE_TOP - 24);
  ctx.lineTo(FIELD_LEFT - 20, LANE_BOTTOM + 24);
  ctx.stroke();
}

function drawBase() {
  const level = state.baseLevel;
  const x = 30;
  const y = 185 - Math.min(level, 6) * 7;
  const w = 92 + level * 7;
  const h = 360 + level * 8;

  ctx.save();
  ctx.shadowColor = 'rgba(250,204,21,0.25)';
  ctx.shadowBlur = 18;

  ctx.fillStyle = '#1f2937';
  roundRect(ctx, x + 26, y + 14, w, h, 18);
  ctx.fill();

  const body = ctx.createLinearGradient(x, y, x + w, y + h);
  body.addColorStop(0, '#64748b');
  body.addColorStop(0.45, '#334155');
  body.addColorStop(1, '#0f172a');
  ctx.fillStyle = body;
  roundRect(ctx, x + 14, y + 40, w, h - 25, 22);
  ctx.fill();

  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 48);
  ctx.lineTo(x + 60, y - 15);
  ctx.lineTo(x + w + 35, y + 48);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#111827';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 36, y + 82 + i * 58, 22, 30);
    ctx.fillRect(x + 78, y + 82 + i * 58, 22, 30);
  }

  ctx.fillStyle = '#f97316';
  ctx.fillRect(x + 57, y + h - 56, 38, 56);

  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + w + 34, laneY(2), 36 + level * 3, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  ctx.restore();

  for (let i = 0; i < level; i++) {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(x + 28 + i * 15, y + 36, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProjectilesBehind() {
  for (const projectile of state.projectiles) {
    ctx.strokeStyle = projectile.trail;
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = projectile.radius * 1.1;
    ctx.beginPath();
    ctx.moveTo(projectile.x - 46, projectile.y);
    ctx.lineTo(projectile.x - 8, projectile.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawEnemy(enemy) {
  ctx.save();
  ctx.translate(enemy.x, enemy.y);

  if (enemy.slowTime > 0) {
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.shadowColor = enemy.color;
  ctx.shadowBlur = enemy.type === 'boss' ? 24 : 12;
  ctx.fillStyle = enemy.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, enemy.radius * 1.08, enemy.radius * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.beginPath();
  ctx.ellipse(-enemy.radius * 0.1, enemy.radius * 0.45, enemy.radius * 0.78, enemy.radius * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.arc(-enemy.radius * 0.32, -enemy.radius * 0.18, enemy.radius * 0.14, 0, Math.PI * 2);
  ctx.arc(enemy.radius * 0.28, -enemy.radius * 0.18, enemy.radius * 0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-enemy.radius * 0.35, -enemy.radius * 0.22, enemy.radius * 0.045, 0, Math.PI * 2);
  ctx.arc(enemy.radius * 0.25, -enemy.radius * 0.22, enemy.radius * 0.045, 0, Math.PI * 2);
  ctx.fill();

  if (enemy.type === 'boss') {
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-28, -enemy.radius - 2);
    ctx.lineTo(-12, -enemy.radius - 28);
    ctx.lineTo(0, -enemy.radius - 4);
    ctx.lineTo(16, -enemy.radius - 28);
    ctx.lineTo(32, -enemy.radius - 2);
    ctx.closePath();
    ctx.fill();
  }

  const barW = enemy.radius * 2.3;
  const hpPct = clamp(enemy.hp / enemy.maxHp, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, -barW / 2, -enemy.radius - 20, barW, 7, 4);
  ctx.fill();
  ctx.fillStyle = hpPct > 0.45 ? '#22c55e' : hpPct > 0.2 ? '#facc15' : '#ef4444';
  roundRect(ctx, -barW / 2, -enemy.radius - 20, barW * hpPct, 7, 4);
  ctx.fill();

  ctx.restore();
}

function drawProjectile(projectile) {
  ctx.save();
  ctx.translate(projectile.x, projectile.y);
  ctx.rotate(projectile.spin);
  ctx.shadowColor = projectile.glow;
  ctx.shadowBlur = 20;
  ctx.fillStyle = projectile.color;
  ctx.beginPath();
  ctx.arc(0, 0, projectile.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.48)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, projectile.radius * 0.62, 0, Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
}

function drawShockwave(s) {
  const alpha = clamp(s.life / 0.32, 0, 1);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawParticle(p) {
  ctx.globalAlpha = clamp(p.life / 0.75, 0, 1);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFloater(f) {
  ctx.globalAlpha = clamp(f.life, 0, 1);
  ctx.fillStyle = f.color;
  ctx.font = 'bold 20px Tahoma, Arial';
  ctx.textAlign = 'center';
  ctx.fillText(f.text, f.x, f.y);
  ctx.globalAlpha = 1;
}

function drawCrosshair() {
  if (state.status !== 'playing') return;
  const lane = clamp(Math.floor((state.mouse.y - LANE_TOP) / LANE_HEIGHT), 0, LANE_COUNT - 1);
  const y = laneY(lane);
  ctx.fillStyle = 'rgba(250,204,21,0.08)';
  ctx.fillRect(FIELD_LEFT, y - LANE_HEIGHT / 2, WIDTH - FIELD_LEFT, LANE_HEIGHT);
}

function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function updateUI() {
  const weapon = currentWeapon();
  ui.wave.textContent = state.wave;
  ui.base.textContent = `Lv.${state.baseLevel}`;
  ui.health.textContent = `${Math.round(state.health)} / ${state.maxHealth}`;
  ui.healthBar.style.width = `${clamp(state.health / state.maxHealth, 0, 1) * 100}%`;
  ui.coins.textContent = state.coins;
  ui.weapon.textContent = weapon.name;
  ui.best.textContent = state.bestWave;

  const baseCost = baseUpgradeCost();
  ui.upgradeBaseBtn.textContent = state.baseLevel >= weapons.length ? 'أقصى مستوى' : `تطوير (${baseCost})`;
  ui.upgradeBaseBtn.disabled = state.baseLevel >= weapons.length || state.coins < baseCost;

  const pCost = powerCost();
  ui.upgradePowerBtn.textContent = `ترقية القوة (${pCost})`;
  ui.upgradePowerBtn.disabled = state.coins < pCost;

  const rCost = rateCost();
  ui.upgradeRateBtn.textContent = `ترقية السرعة (${rCost})`;
  ui.upgradeRateBtn.disabled = state.coins < rCost;

  const repCost = repairCost();
  ui.repairBtn.textContent = `إصلاح (${repCost})`;
  ui.repairBtn.disabled = state.health >= state.maxHealth || state.coins < repCost;

  ui.logText.innerHTML = `القتلات: <b>${state.totalKills}</b><br>الضرر: <b>${weapon.damage}</b><br>التبريد: <b>${weapon.cooldown}ms</b><br>القاعدة تطور السلاح تلقائياً مع كل مستوى.`;
}

function frame(time) {
  const dt = Math.min(0.033, (time - state.lastTime) / 1000 || 0);
  state.lastTime = time;
  update(dt);
  draw();
  updateUI();
  requestAnimationFrame(frame);
}

function bindEvents() {
  ui.startBtn.addEventListener('click', startGame);
  ui.overlayBtn.addEventListener('click', () => {
    if (state.status === 'paused') return togglePause();
    if (state.status === 'gameover') return resetGame();
    startGame();
  });
  ui.pauseBtn.addEventListener('click', togglePause);
  ui.restartBtn.addEventListener('click', resetGame);
  ui.upgradeBaseBtn.addEventListener('click', upgradeBase);
  ui.upgradePowerBtn.addEventListener('click', upgradePower);
  ui.upgradeRateBtn.addEventListener('click', upgradeRate);
  ui.repairBtn.addEventListener('click', repairBase);

  document.querySelectorAll('[data-lane]').forEach((btn) => {
    btn.addEventListener('click', () => shoot(Number(btn.dataset.lane)));
  });

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = (event.clientX - rect.left) * (WIDTH / rect.width);
    state.mouse.y = (event.clientY - rect.top) * (HEIGHT / rect.height);
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (state.status === 'menu') return startGame();
    if (state.status === 'gameover') return resetGame();
    const rect = canvas.getBoundingClientRect();
    const y = (event.clientY - rect.top) * (HEIGHT / rect.height);
    if (y < LANE_TOP || y > LANE_BOTTOM) return;
    const lane = clamp(Math.floor((y - LANE_TOP) / LANE_HEIGHT), 0, LANE_COUNT - 1);
    shoot(lane);
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
    }
    if (event.key.toLowerCase() === 'r') resetGame();
    if (['1', '2', '3', '4', '5'].includes(event.key)) shoot(Number(event.key) - 1);
  });
}

bindEvents();
updateUI();
requestAnimationFrame(frame);
