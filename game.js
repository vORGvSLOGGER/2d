const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const lanes = 5;
const laneHeight = canvas.height / lanes;

let level = 1;
let score = 0;
let baseHealth = 100;
let gameOver = false;

const weapons = [
  { name: 'كرة صغيرة', color: '#c49a6c', radius: 11, speed: 5, damage: 1 },
  { name: 'كرة حديدية', color: '#9ca3af', radius: 14, speed: 6, damage: 2 },
  { name: 'كرة نارية', color: '#ff5a1f', radius: 13, speed: 7, damage: 3 },
  { name: 'كرة متفجرة', color: '#a3e635', radius: 17, speed: 8, damage: 4 }
];

let currentWeapon = weapons[0];
let monsters = [];
let projectiles = [];
let particles = [];
let spawnTimer = 0;
let spawnInterval = 105;
let killsThisLevel = 0;
let baseShake = 0;

const levelEl = document.getElementById('level');
const healthEl = document.getElementById('health');
const scoreEl = document.getElementById('score');
const weaponEl = document.getElementById('weapon');
const messageEl = document.getElementById('message');

canvas.addEventListener('pointerdown', (event) => {
  if (gameOver) {
    restartGame();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);
  const lane = Math.max(0, Math.min(lanes - 1, Math.floor(y / laneHeight)));
  shoot(lane);
});

function shoot(lane) {
  projectiles.push({
    x: 74,
    y: lane * laneHeight + laneHeight / 2,
    lane,
    radius: currentWeapon.radius,
    speed: currentWeapon.speed,
    damage: currentWeapon.damage,
    color: currentWeapon.color,
    spin: 0
  });
}

function createMonster() {
  const lane = Math.floor(Math.random() * lanes);
  const pool = [
    { color: '#22c55e', radius: 16, hp: 1, speed: 1.1 },
    { color: '#84cc16', radius: 19, hp: 2, speed: 0.95 },
    { color: '#16a34a', radius: 14, hp: 1, speed: 1.45 },
    { color: '#15803d', radius: 22, hp: 4, speed: 0.85 }
  ];

  const unlocked = Math.min(pool.length, 1 + Math.floor(level / 2));
  const type = pool[Math.floor(Math.random() * unlocked)];
  const hp = type.hp + Math.floor(level / 3);

  return {
    x: canvas.width + 30,
    y: lane * laneHeight + laneHeight / 2,
    lane,
    radius: type.radius,
    speed: type.speed + level * 0.12,
    health: hp,
    maxHealth: hp,
    color: type.color
  };
}

function update() {
  if (gameOver) return;

  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    monsters.push(createMonster());
  }

  for (let i = monsters.length - 1; i >= 0; i--) {
    const monster = monsters[i];
    monster.x -= monster.speed;

    if (monster.x - monster.radius <= 58) {
      baseHealth -= 8 + monster.maxHealth * 2;
      monsters.splice(i, 1);
      baseShake = 8;

      if (baseHealth <= 0) {
        baseHealth = 0;
        gameOver = true;
        messageEl.textContent = 'انتهت اللعبة — اضغط على الملعب لإعادة التشغيل';
      }
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const projectile = projectiles[i];
    projectile.x += projectile.speed;
    projectile.spin += 0.25;

    if (projectile.x - projectile.radius > canvas.width) {
      projectiles.splice(i, 1);
      continue;
    }

    for (let j = monsters.length - 1; j >= 0; j--) {
      const monster = monsters[j];
      if (monster.lane !== projectile.lane) continue;

      const dx = projectile.x - monster.x;
      const dy = projectile.y - monster.y;

      if (Math.hypot(dx, dy) < projectile.radius + monster.radius) {
        monster.health -= projectile.damage;
        createBurst(projectile.x, projectile.y, projectile.color);
        projectiles.splice(i, 1);

        if (monster.health <= 0) {
          createBurst(monster.x, monster.y, '#ffffff');
          monsters.splice(j, 1);
          score += 10;
          killsThisLevel++;

          if (killsThisLevel >= 10) {
            levelUp();
          }
        }
        break;
      }
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.life--;
    if (particle.life <= 0) particles.splice(i, 1);
  }

  draw();
  updateHud();
  requestAnimationFrame(update);
}

function levelUp() {
  level++;
  killsThisLevel = 0;
  spawnInterval = Math.max(48, spawnInterval - 9);

  const nextWeapon = weapons[Math.min(weapons.length - 1, level - 1)];

  if (nextWeapon !== currentWeapon) {
    currentWeapon = nextWeapon;
    messageEl.textContent = `تم تطوير القاعدة وفتح سلاح: ${currentWeapon.name}`;
  } else {
    currentWeapon = {
      ...currentWeapon,
      speed: currentWeapon.speed + 0.4,
      damage: currentWeapon.damage + 1
    };
    messageEl.textContent = 'تطوير إضافي للقاعدة: قوة السلاح ارتفعت';
  }

  setTimeout(() => {
    if (!gameOver) messageEl.textContent = '';
  }, 2600);
}

function createBurst(x, y, color) {
  for (let i = 0; i < 10; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5,
      life: 18 + Math.random() * 12,
      color
    });
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#6ea536');
  gradient.addColorStop(1, '#355f21');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < lanes; i++) {
    const y = i * laneHeight;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(0, y, canvas.width, laneHeight);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  drawBase();
  monsters.forEach(drawMonster);
  projectiles.forEach(drawProjectile);
  particles.forEach(drawParticle);

  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('انتهت اللعبة', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '18px Arial';
    ctx.fillText('اضغط لإعادة التشغيل', canvas.width / 2, canvas.height / 2 + 28);
  }
}

function drawBase() {
  const shake = baseShake > 0 ? (Math.random() - 0.5) * baseShake : 0;
  if (baseShake > 0) baseShake--;

  const x = 14 + shake;
  ctx.fillStyle = '#3b2f2f';
  ctx.fillRect(x, 90, 64, 280);

  ctx.fillStyle = '#6b4f3f';
  ctx.fillRect(x + 8, 118, 48, 224);

  ctx.fillStyle = '#facc15';
  ctx.fillRect(x + 22, 218, 20, 50);

  ctx.fillStyle = '#111827';
  ctx.fillRect(x + 18, 144, 28, 26);
  ctx.fillRect(x + 18, 178, 28, 26);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x + 62, 0, 16, canvas.height);

  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x + 6, 72, 56, 8);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x + 6, 72, 56 * (baseHealth / 100), 8);
}

function drawMonster(monster) {
  ctx.save();
  ctx.translate(monster.x, monster.y);

  ctx.fillStyle = monster.color;
  ctx.beginPath();
  ctx.arc(0, 0, monster.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#064e3b';
  ctx.beginPath();
  ctx.arc(-monster.radius * 0.55, monster.radius * 0.4, monster.radius * 0.32, 0, Math.PI * 2);
  ctx.arc(monster.radius * 0.55, monster.radius * 0.4, monster.radius * 0.32, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-5, -5, 4, 0, Math.PI * 2);
  ctx.arc(6, -5, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(-5, -5, 1.8, 0, Math.PI * 2);
  ctx.arc(6, -5, 1.8, 0, Math.PI * 2);
  ctx.fill();

  const barWidth = monster.radius * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(-monster.radius, -monster.radius - 10, barWidth, 4);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-monster.radius, -monster.radius - 10, barWidth * (monster.health / monster.maxHealth), 4);

  ctx.restore();
}

function drawProjectile(projectile) {
  ctx.save();
  ctx.translate(projectile.x, projectile.y);
  ctx.rotate(projectile.spin);

  ctx.fillStyle = projectile.color;
  ctx.beginPath();
  ctx.arc(0, 0, projectile.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-projectile.radius, 0);
  ctx.lineTo(projectile.radius, 0);
  ctx.moveTo(0, -projectile.radius);
  ctx.lineTo(0, projectile.radius);
  ctx.stroke();

  ctx.restore();
}

function drawParticle(particle) {
  ctx.globalAlpha = Math.max(0, particle.life / 30);
  ctx.fillStyle = particle.color;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function updateHud() {
  levelEl.textContent = `المستوى: ${level}`;
  healthEl.textContent = `صحة القاعدة: ${baseHealth}`;
  scoreEl.textContent = `النقاط: ${score}`;
  weaponEl.textContent = `السلاح: ${currentWeapon.name}`;
}

function restartGame() {
  level = 1;
  score = 0;
  baseHealth = 100;
  gameOver = false;
  currentWeapon = weapons[0];
  monsters = [];
  projectiles = [];
  particles = [];
  spawnTimer = 0;
  spawnInterval = 105;
  killsThisLevel = 0;
  messageEl.textContent = '';
  update();
}

update();
