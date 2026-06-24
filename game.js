/*
 * Sea Tycoon Defense - core game model
 * --------------------------------------------------------------------------
 * This file holds the *pure* simulation: state + rules, with no DOM and no
 * canvas. Keeping it free of browser APIs means the whole game loop can be
 * unit-tested in Node (see tests/game.test.js) and reasoned about in isolation.
 *
 * Coordinate system (normalized "world space"):
 *   x = 0.0  -> the ship's firing line (left edge of the playfield)
 *   x = 1.0  -> the spawn line (right edge of the playfield)
 *   Enemies move right -> left (x decreasing). Shots move left -> right.
 *   Using 0..1 keeps the simulation independent of screen size; the renderer
 *   maps these values to pixels.
 */

var LANES = 5;

/* All balance numbers live here so tuning never means hunting through logic. */
var CONFIG = {
  lanes: LANES,
  startGold: 180,
  maxLevel: 5,

  // Motion (world units per second).
  shotSpeed: 1.30,
  shotSpeedBoost: 1.65, // multiplier while "Overdrive" (E) is active
  shotSpawnX: 0.03,
  shotDespawnX: 1.10,
  spawnX: 1.06,
  enemyReachX: 0.0, // x at which an enemy reaches the ship and deals damage
  hitRadius: 0.045, // |enemyX - shotX| within the same lane counts as a hit

  // Ship damage taken when an enemy slips past the firing line.
  leakDamage: 34,

  // Energy regenerates during a wave so later (bigger) waves stay playable.
  energyRegenBase: 2.6,
  energyRegenPerRadar: 1.3,

  // Ability cooldowns in seconds (scaled down by Crew level).
  abilityCooldown: { q: 10, w: 15, e: 9, r: 13 },
  overdriveTime: 6,
  freezeTime: 3,
  repairFraction: 0.25,

  // Game modes.
  modes: {
    normal:  { label: 'عادي',     enemySpeed: 1.0, reward: 1.0, spawn: 1.0 },
    fast:    { label: 'سريع',     enemySpeed: 1.5, reward: 2.0, spawn: 0.8 },
    endless: { label: 'لا نهاية', enemySpeed: 1.0, reward: 1.2, spawn: 1.0, ramp: true },
  },
};

/*
 * Upgrade rooms. Order is fixed and matches the prep-screen grid.
 * Every room now has a real, described gameplay effect (in the original web
 * build three of these did nothing at all).
 */
var ROOMS = [
  { key: 'command', name: 'القيادة', desc: 'هيكل السفينة (نقاط الحياة)' },
  { key: 'cannons', name: 'المدافع', desc: 'قوة الطلقة' },
  { key: 'engines', name: 'المحركات', desc: 'سرعة إطلاق النار' },
  { key: 'arsenal', name: 'الترسانة', desc: 'أقصى طاقة' },
  { key: 'shield',  name: 'الدرع',   desc: 'تقليل الضرر' },
  { key: 'storage', name: 'المخزن',  desc: 'مكافأة الذهب +' },
  { key: 'radar',   name: 'الرادار', desc: 'سرعة شحن الطاقة' },
  { key: 'crew',    name: 'الطاقم',  desc: 'تبريد القدرات أسرع' },
];

var ABILITIES = [
  { key: 'q', name: 'موجة',   hint: 'إطلاق كل المسارات' },
  { key: 'w', name: 'إصلاح',  hint: 'استعادة 25% درع' },
  { key: 'e', name: 'سرعة',   hint: 'تعزيز الطلقات' },
  { key: 'r', name: 'تجميد',  hint: 'إيقاف الأعداء' },
];

function randInt(n) { return Math.floor(Math.random() * n); }

var Game = (function () {
  function Game(storage) {
    // Optional persistence backend (localStorage in the browser). May be null.
    this.storage = storage || null;
    this.best = this._loadBest();
    this.toMenu();
  }

  /* ----------------------------------------------------------------- state */

  Game.prototype.toMenu = function () {
    this.phase = 'menu'; // menu | prep | battle | result
    this.mode = 'normal';
    this.wave = 0;
    this.gold = CONFIG.startGold;
    this.levels = new Array(ROOMS.length).fill(0);
    this.lastWin = false;
    this._clearBattle();
  };

  Game.prototype._clearBattle = function () {
    this.enemies = [];
    this.shots = [];
    this.kills = 0;
    this.earned = 0;
  };

  /* Begin a fresh run from the menu. Resets economy and upgrades. */
  Game.prototype.startRun = function (mode) {
    this.mode = CONFIG.modes[mode] ? mode : 'normal';
    this.wave = 0;
    this.gold = CONFIG.startGold;
    this.levels = new Array(ROOMS.length).fill(0);
    this.phase = 'prep';
  };

  /* --------------------------------------------------------- derived stats */

  Game.prototype.stats = function () {
    var L = this.levels;
    return {
      maxHp: 240 + L[0] * 45,
      damage: 26 + L[1] * 9,
      fireDelay: Math.max(0.16, 0.55 - L[2] * 0.07),
      maxEnergy: 24 + L[3] * 5,
      armor: Math.min(0.45, L[4] * 0.05),
      goldBonus: 1 + L[5] * 0.14,
      energyRegen: CONFIG.energyRegenBase + L[6] * CONFIG.energyRegenPerRadar,
      cooldownScale: Math.max(0.45, 1 - L[7] * 0.10),
    };
  };

  Game.prototype.upgradeCost = function (i) {
    return Math.floor(80 * Math.pow(1.6, this.levels[i]) + i * 18);
  };

  Game.prototype.canUpgrade = function (i) {
    return this.levels[i] < CONFIG.maxLevel && this.gold >= this.upgradeCost(i);
  };

  Game.prototype.buyUpgrade = function (i) {
    if (!this.canUpgrade(i)) return false;
    this.gold -= this.upgradeCost(i);
    this.levels[i]++;
    return true;
  };

  /* ----------------------------------------------------------------- flow */

  /* Start the next wave from the prep screen. Keeps gold and upgrades. */
  Game.prototype.startWave = function () {
    var s = this.stats();
    this.wave++;
    this.maxHp = s.maxHp;
    this.hp = s.maxHp;
    this.maxEnergy = s.maxEnergy;
    this.energy = s.maxEnergy;
    this.fireTimer = 0; // seconds until the next shot is allowed
    this.cooldowns = { q: 0, w: 0, e: 0, r: 0 };
    this.overdrive = 0;
    this.freeze = 0;
    this.spawnLeft = 6 + this.wave * 2 + (this.wave % 3 === 0 ? 1 : 0);
    this.spawnTimer = 0.4;
    this._clearBattle();
    this.phase = 'battle';
  };

  /* After a won wave, return to prep for the next one (progress preserved). */
  Game.prototype.continueAfterWin = function () {
    if (this.phase === 'result' && this.lastWin) this.phase = 'prep';
  };

  /* --------------------------------------------------------- battle actions */

  Game.prototype.fire = function (lane, free) {
    if (this.phase !== 'battle') return false;
    if (lane < 0 || lane >= CONFIG.lanes) return false;
    if (!free) {
      if (this.fireTimer > 0) return false;
      if (this.energy < 1) return false;
      this.energy -= 1;
      this.fireTimer = this.stats().fireDelay;
    }
    var boosted = this.overdrive > 0;
    this.shots.push({
      x: CONFIG.shotSpawnX,
      lane: lane,
      damage: this.stats().damage * (boosted ? 1.25 : 1),
      speed: CONFIG.shotSpeed * (boosted ? CONFIG.shotSpeedBoost : 1),
    });
    return true;
  };

  Game.prototype.abilityMaxCooldown = function (key) {
    return CONFIG.abilityCooldown[key] * this.stats().cooldownScale;
  };

  Game.prototype.useAbility = function (key) {
    if (this.phase !== 'battle') return false;
    if (!(key in this.cooldowns)) return false;
    if (this.cooldowns[key] > 0) return false; // still cooling down
    if (key === 'q') {
      for (var l = 0; l < CONFIG.lanes; l++) this.fire(l, true);
    } else if (key === 'w') {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * CONFIG.repairFraction);
    } else if (key === 'e') {
      this.overdrive = CONFIG.overdriveTime;
    } else if (key === 'r') {
      this.freeze = CONFIG.freezeTime;
    }
    this.cooldowns[key] = this.abilityMaxCooldown(key);
    return true;
  };

  /* ------------------------------------------------------------- spawning */

  Game.prototype._spawnEnemy = function () {
    var mode = CONFIG.modes[this.mode];
    var lane = randInt(CONFIG.lanes);
    var boss = this.wave % 3 === 0 && this.spawnLeft === 1;
    var hp, speed, reward, kind;

    if (boss) {
      kind = 'boss';
      hp = 900 + this.wave * 35;
      speed = 0.045;
      reward = 150;
    } else {
      var kinds = ['fish', 'raft', 'sub'];
      kind = kinds[randInt(kinds.length)];
      hp = 80 + this.wave * 8;
      speed = 0.060 + Math.random() * 0.035;
      reward = 14 + this.wave * 2;
    }

    speed *= mode.enemySpeed;
    if (mode.ramp) speed *= 1 + this.wave * 0.01;
    reward = Math.round(reward * mode.reward);

    this.enemies.push({ x: CONFIG.spawnX, lane: lane, hp: hp, maxHp: hp, speed: speed, reward: reward, kind: kind });
    this.spawnLeft--;
  };

  /* ------------------------------------------------------------- simulate */

  /*
   * Advance the battle by dt seconds. Returns an events object the renderer
   * uses to spawn purely-visual effects (kills, leaks) — the model itself
   * stays free of any rendering concern.
   */
  Game.prototype.update = function (dt) {
    var events = { kills: [], hits: [], leaks: [] };
    if (this.phase !== 'battle') return events;
    var s = this.stats();

    // timers
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.overdrive = Math.max(0, this.overdrive - dt);
    this.freeze = Math.max(0, this.freeze - dt);
    for (var k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.energy = Math.min(this.maxEnergy, this.energy + s.energyRegen * dt);

    // spawning
    this.spawnTimer -= dt;
    if (this.spawnLeft > 0 && this.spawnTimer <= 0) {
      this._spawnEnemy();
      this.spawnTimer = Math.max(0.42, 1.1 - this.wave * 0.02) * CONFIG.modes[this.mode].spawn;
    }

    // enemy motion + leaks
    var enemyFactor = this.freeze > 0 ? 0 : 1;
    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      e.x -= e.speed * enemyFactor * dt;
      if (e.x <= CONFIG.enemyReachX) {
        this.hp -= CONFIG.leakDamage * (1 - s.armor);
        events.leaks.push({ lane: e.lane });
        this.enemies.splice(i, 1);
      }
    }

    // shot motion + collisions
    for (var j = this.shots.length - 1; j >= 0; j--) {
      var shot = this.shots[j];
      shot.x += shot.speed * dt;
      if (shot.x > CONFIG.shotDespawnX) { this.shots.splice(j, 1); continue; }
      for (var m = this.enemies.length - 1; m >= 0; m--) {
        var en = this.enemies[m];
        if (en.lane === shot.lane && Math.abs(en.x - shot.x) < CONFIG.hitRadius) {
          en.hp -= shot.damage;
          this.shots.splice(j, 1);
          if (en.hp <= 0) {
            var reward = Math.round(en.reward * s.goldBonus);
            this.gold += reward;
            this.earned += reward;
            this.kills++;
            events.kills.push({ x: en.x, lane: en.lane, reward: reward, kind: en.kind });
            this.enemies.splice(m, 1);
          } else {
            events.hits.push({ x: en.x, lane: en.lane });
          }
          break;
        }
      }
    }

    // win / lose
    if (this.hp <= 0) { this.hp = 0; this._endWave(false); }
    else if (this.spawnLeft <= 0 && this.enemies.length === 0) { this._endWave(true); }

    return events;
  };

  Game.prototype._endWave = function (win) {
    this.lastWin = win;
    if (win) {
      var bonus = Math.round((40 + this.wave * 18) * this.stats().goldBonus);
      this.gold += bonus;
      this.earned += bonus;
    }
    this._saveBest();
    this.phase = 'result';
  };

  /* --------------------------------------------------------- persistence */

  Game.prototype._loadBest = function () {
    try {
      return this.storage ? (parseInt(this.storage.getItem('seatycoon.best'), 10) || 0) : 0;
    } catch (err) {
      return 0;
    }
  };

  Game.prototype._saveBest = function () {
    if (this.wave > this.best) {
      this.best = this.wave;
      try {
        if (this.storage) this.storage.setItem('seatycoon.best', String(this.best));
      } catch (err) { /* storage unavailable — ignore */ }
    }
  };

  return Game;
})();

/* Export for Node-based tests; harmless in the browser (no module global). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Game: Game, CONFIG: CONFIG, ROOMS: ROOMS, ABILITIES: ABILITIES, LANES: LANES };
}
