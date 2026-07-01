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
  maxLevel: 10, // base per-room cap; meta "training" raises it further

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

  // Submarines periodically dive: while submerged they cannot be hit (shots
  // pass over them), so the player must time shots for when they surface.
  subSurfaced: 2.2,
  subSubmerged: 1.3,

  // Combo: consecutive kills without letting an enemy through raise a gold
  // multiplier. Any leak resets it — a clean-play risk/reward system.
  comboStep: 5,           // kills per multiplier tier
  comboTierBonus: 0.25,   // +25% gold per tier
  comboMaxBonus: 1.0,     // capped at +100% (x2 gold)

  // Lanes above the horizon are "sky" (aircraft); the rest are "sea" (ships).
  skyLanes: [0, 1],
  // Normal mode: enemies stop in front of the line here and shell the ship.
  siegeX: 0.085,
  siegeFireInterval: 0.9, siegeFireJitter: 0.5, siegeShotSpeed: 0.95,
  // Fast mode: contact is a one-shot explosion of contact*burstMul damage.
  burstMul: 3,
  // Critical hits on the player's shots, and a no-damage "perfect wave" bonus.
  critChance: 0.12, critMult: 2, perfectBonus: 60,

  // Enemy type profiles. category = sea/air; contact = per-second siege damage
  // (or, x burstMul, the explosion damage); ammo = the munition auto-fired at it.
  enemyTypes: {
    fish:  { category: 'sea', ammo: 'cannon', hpMul: 0.8, speedMul: 1.25, rewardMul: 0.9, contact: 10, minWave: 1 },
    raft:  { category: 'sea', ammo: 'cannon', hpMul: 1.7, speedMul: 0.65, rewardMul: 1.5, contact: 22, minWave: 2 },
    sub:   { category: 'sea', ammo: 'cannon', hpMul: 1.1, speedMul: 1.0,  rewardMul: 1.3, contact: 16, minWave: 4, dive: true },
    plane: { category: 'air', ammo: 'flak',   hpMul: 0.7, speedMul: 1.7,  rewardMul: 1.1, contact: 14, minWave: 1 },
    heli:  { category: 'air', ammo: 'rocket', hpMul: 1.0, speedMul: 0.9,  rewardMul: 1.2, contact: 9,  minWave: 2 },
  },

  // Per-wave challenge modifiers (boss waves use their own fixed challenge).
  challenges: [
    { id: 'standard', name: 'موجة قياسية' },
    { id: 'swarm',    name: 'سرب',        countAdd: 4, speedMul: 1.05 },
    { id: 'airraid',  name: 'غارة جوية',  airBias: 0.7 },
    { id: 'fasttide', name: 'مدّ سريع',   speedMul: 1.35 },
    { id: 'armada',   name: 'أسطول',      countAdd: 2, hpMul: 1.2 },
  ],

  // "War" mode: enemy ships stop at a line and bombard the player with
  // missiles. The player intercepts missiles with one weapon and destroys the
  // ships with another.
  war: {
    holdX: 0.46, holdJitter: 0.18,
    missileSpeed: 0.42, missileDamage: 16,
    fireInterval: 2.6, fireJitter: 1.4,
  },

  // Game modes. (the former "endless" mode is now "War"; key kept for saves)
  modes: {
    normal:  { label: 'عادي', enemySpeed: 1.0, reward: 1.0, spawn: 1.0, contact: 'siege' },
    fast:    { label: 'سريع', enemySpeed: 1.5, reward: 2.0, spawn: 0.8, contact: 'burst' },
    endless: { label: 'الحرب', enemySpeed: 1.0, reward: 1.2, spawn: 1.0, ramp: true, war: true },
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

/*
 * Permanent meta-progression. "Medals" are earned every run and never reset;
 * spending them makes every future run stronger, so progress continues even
 * after a player has maxed out the in-run rooms.
 */
var META = [
  { key: 'fleet',    name: 'الأسطول',       desc: '+25 نقطة حياة أساسية' },
  { key: 'guns',     name: 'مدافع موروثة',  desc: '+3 قوة طلقة أساسية' },
  { key: 'treasury', name: 'الخزينة',       desc: '+35 ذهب البداية' },
  { key: 'training', name: 'تدريب الطاقم',  desc: '+1 لسقف ترقية الغرف' },
];

function randInt(n) { return Math.floor(Math.random() * n); }

var Game = (function () {
  function Game(storage) {
    // Optional persistence backend (localStorage in the browser). May be null.
    this.storage = storage || null;
    this.best = this._loadBest();
    this.career = this._loadCareer(); // lifetime stats across runs
    this.meta = this._loadMeta();     // permanent cross-run upgrades
    this.combo = 0;
    this.medalsRun = 0;               // medals earned in the current run (display)
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
    this.missiles = [];
    this.kills = 0;
    this.earned = 0;
  };

  /* Begin a fresh run from the menu. Resets economy and upgrades. */
  Game.prototype.startRun = function (mode) {
    this.mode = CONFIG.modes[mode] ? mode : 'normal';
    this.wave = 0;
    this.gold = CONFIG.startGold + this.meta.levels[2] * 35; // treasury bonus
    this.levels = new Array(ROOMS.length).fill(0);
    this.medalsRun = 0;
    this.career.runs++;
    this._saveCareer();
    this._saveRun();
    this.phase = 'prep';
  };

  /* --------------------------------------------------------- derived stats */

  Game.prototype.stats = function () {
    var L = this.levels;
    return {
      maxHp: 240 + L[0] * 45 + this.meta.levels[0] * 25,
      damage: 26 + L[1] * 9 + this.meta.levels[1] * 3,
      fireDelay: Math.max(0.16, 0.55 - L[2] * 0.07),
      maxEnergy: 24 + L[3] * 5,
      armor: Math.min(0.45, L[4] * 0.05),
      goldBonus: 1 + L[5] * 0.14,
      energyRegen: CONFIG.energyRegenBase + L[6] * CONFIG.energyRegenPerRadar,
      cooldownScale: Math.max(0.45, 1 - L[7] * 0.10),
    };
  };

  // Per-room cap, raised permanently by the meta "training" upgrade.
  Game.prototype.roomMaxLevel = function () {
    return CONFIG.maxLevel + this.meta.levels[3];
  };

  Game.prototype.upgradeCost = function (i) {
    return Math.floor(80 * Math.pow(1.6, this.levels[i]) + i * 18);
  };

  Game.prototype.canUpgrade = function (i) {
    return this.levels[i] < this.roomMaxLevel() && this.gold >= this.upgradeCost(i);
  };

  Game.prototype.buyUpgrade = function (i) {
    if (!this.canUpgrade(i)) return false;
    this.gold -= this.upgradeCost(i);
    this.levels[i]++;
    this._saveRun();
    return true;
  };

  /* ----------------------------------------------------- meta-progression */

  Game.prototype.metaCost = function (i) {
    var base = [4, 4, 3, 6][i];
    var step = [3, 3, 2, 5][i];
    return base + step * this.meta.levels[i];
  };

  Game.prototype.canBuyMeta = function (i) {
    return i >= 0 && i < META.length && this.meta.medals >= this.metaCost(i);
  };

  Game.prototype.buyMeta = function (i) {
    if (!this.canBuyMeta(i)) return false;
    this.meta.medals -= this.metaCost(i);
    this.meta.levels[i]++;
    this._saveMeta();
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
    this.combo = 0;
    this.weapon = 'cannon';
    this.tookDamage = false;
    this.challenge = this.pickChallenge(this.wave);
    this.spawnLeft = 6 + this.wave * 2 + (this.wave % 3 === 0 ? 1 : 0) + (this.challenge.countAdd || 0);
    this.spawnTimer = 0.4;
    this._clearBattle();
    this.phase = 'battle';
  };

  // Gold multiplier from the current kill combo (1.0 = no bonus).
  Game.prototype.comboMultiplier = function () {
    var tier = Math.floor(this.combo / CONFIG.comboStep);
    return 1 + Math.min(CONFIG.comboMaxBonus, tier * CONFIG.comboTierBonus);
  };

  // Enemy kinds that can appear on a given wave (difficulty gating).
  Game.prototype.availableKinds = function (wave, category) {
    var out = [];
    for (var key in CONFIG.enemyTypes) {
      var t = CONFIG.enemyTypes[key];
      if (wave >= t.minWave && (!category || t.category === category)) out.push(key);
    }
    return out;
  };

  // Is a lane in the sky band (aircraft) rather than the sea (ships)?
  Game.prototype.isSkyLane = function (lane) {
    return CONFIG.skyLanes.indexOf(lane) >= 0;
  };

  // Deterministic per-wave challenge (stable across resume); bosses are fixed.
  Game.prototype.pickChallenge = function (wave) {
    if (wave % 3 === 0) return { id: 'boss', name: 'مواجهة الزعيم' };
    var pool = CONFIG.challenges;
    return pool[(wave * 7 + 3) % pool.length];
  };

  /* After a won wave, return to prep for the next one (progress preserved). */
  Game.prototype.continueAfterWin = function () {
    if (this.phase === 'result' && this.lastWin) { this.phase = 'prep'; this._saveRun(); }
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
    var warMode = !!CONFIG.modes[this.mode].war;
    var kind = warMode ? (this.weapon || 'cannon') : this._ammoForLane(lane);
    this.shots.push({
      x: CONFIG.shotSpawnX,
      lane: lane,
      damage: this.stats().damage * (boosted ? 1.25 : 1),
      speed: CONFIG.shotSpeed * (boosted ? CONFIG.shotSpeedBoost : 1),
      kind: kind,
    });
    return true;
  };

  // Outside War mode, tapping a lane auto-fires the munition that matches the
  // frontmost target there (ship -> cannon, plane -> flak, heli -> rocket).
  Game.prototype._ammoForLane = function (lane) {
    var best = null;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.lane === lane && !e.submerged && (!best || e.x < best.x)) best = e;
    }
    return best ? (best.ammo || 'cannon') : 'cannon';
  };

  // War mode: switch between the anti-ship cannon and the anti-missile interceptor.
  Game.prototype.setWeapon = function (w) {
    if (w === 'cannon' || w === 'intercept') this.weapon = w;
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
    var ch = this.challenge || {};
    var boss = this.wave % 3 === 0 && this.spawnLeft === 1;

    // pick a lane: bosses are battleships (always sea); the air-raid challenge
    // biases spawns toward the sky lanes.
    var lane;
    if (boss) {
      var seaLanes = [];
      for (var li = 0; li < CONFIG.lanes; li++) if (!this.isSkyLane(li)) seaLanes.push(li);
      lane = seaLanes[randInt(seaLanes.length)];
    } else {
      lane = randInt(CONFIG.lanes);
      if (ch.airBias && Math.random() < ch.airBias) lane = CONFIG.skyLanes[randInt(CONFIG.skyLanes.length)];
    }
    var sky = this.isSkyLane(lane);

    var e = { x: CONFIG.spawnX, lane: lane, kind: 'fish', category: sky ? 'air' : 'sea',
              ammo: 'cannon', contact: 12, submerged: false, diveTimer: 0 };

    if (boss) {
      e.kind = 'boss'; e.category = 'sea'; e.ammo = 'cannon'; e.contact = 40;
      e.hp = e.maxHp = 900 + this.wave * 35;
      e.speed = 0.045;
      e.reward = 150;
    } else {
      var kinds = this.availableKinds(this.wave, sky ? 'air' : 'sea');
      if (!kinds.length) kinds = this.availableKinds(this.wave, 'sea');
      e.kind = kinds[randInt(kinds.length)];
      var t = CONFIG.enemyTypes[e.kind];
      e.category = t.category; e.ammo = t.ammo; e.contact = t.contact;
      var baseHp = 80 + this.wave * 8;
      e.hp = e.maxHp = Math.round(baseHp * t.hpMul * (ch.hpMul || 1));
      e.speed = (0.060 + Math.random() * 0.035) * t.speedMul;
      e.reward = Math.round((14 + this.wave * 2) * t.rewardMul);
      if (t.dive) e.diveTimer = CONFIG.subSurfaced;
    }

    e.speed *= mode.enemySpeed * (ch.speedMul || 1);
    if (mode.ramp) e.speed *= 1 + this.wave * 0.01;
    e.reward = Math.round(e.reward * mode.reward);

    if (mode.war) {
      e.hold = CONFIG.war.holdX + Math.random() * CONFIG.war.holdJitter;
      e.stationed = false;
      e.fireTimer = CONFIG.war.fireInterval + Math.random() * CONFIG.war.fireJitter;
    }

    this.enemies.push(e);
    this.spawnLeft--;
  };

  /* ------------------------------------------------------------- simulate */

  /*
   * Advance the battle by dt seconds. Returns an events object the renderer
   * uses to spawn purely-visual effects (kills, leaks) — the model itself
   * stays free of any rendering concern.
   */
  Game.prototype.update = function (dt) {
    var events = { kills: [], hits: [], leaks: [], fires: [], efires: [] };
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

    // enemy motion (war ships hold at a line and fire missiles; others leak)
    var enemyFactor = this.freeze > 0 ? 0 : 1;
    var mode = CONFIG.modes[this.mode];
    var warMode = !!mode.war;
    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      if (e.kind === 'sub') {
        e.diveTimer -= dt;
        if (e.diveTimer <= 0) {
          e.submerged = !e.submerged;
          e.diveTimer = e.submerged ? CONFIG.subSubmerged : CONFIG.subSurfaced;
        }
      }
      if (warMode && e.hold != null) {
        if (!e.stationed) {
          e.x -= e.speed * enemyFactor * dt;
          if (e.x <= e.hold) { e.x = e.hold; e.stationed = true; }
        } else if (enemyFactor > 0) {
          e.fireTimer -= dt;
          if (e.fireTimer <= 0) {
            e.fireTimer = CONFIG.war.fireInterval + Math.random() * CONFIG.war.fireJitter;
            this.missiles.push({ x: e.x - 0.02, lane: e.lane, speed: CONFIG.war.missileSpeed, damage: CONFIG.war.missileDamage, kind: 'missile' });
            events.fires.push({ lane: e.lane, x: e.x });
          }
        }
        continue; // war ships never leak — they hold position and bombard
      }
      e.x -= e.speed * enemyFactor * dt;
      if (mode.contact === 'siege') {
        // normal mode: the enemy stops in front of the line and shells the ship
        if (e.x <= CONFIG.siegeX) {
          e.x = CONFIG.siegeX;
          if (!e.sieging) { e.sieging = true; this.combo = 0; e.fireTimer = 0.25 + Math.random() * 0.5; }
          if (enemyFactor > 0) {
            e.fireTimer -= dt;
            if (e.fireTimer <= 0) {
              e.fireTimer = CONFIG.siegeFireInterval + Math.random() * CONFIG.siegeFireJitter;
              this.missiles.push({ x: e.x, lane: e.lane, speed: CONFIG.siegeShotSpeed, damage: (e.contact || 12), kind: 'shell' });
              events.efires.push({ lane: e.lane, x: e.x });
            }
          }
        }
      } else if (e.x <= CONFIG.enemyReachX) {
        // fast mode: a one-shot explosion on contact
        this.hp -= (e.contact || 12) * CONFIG.burstMul * (1 - s.armor);
        this.combo = 0;
        this.tookDamage = true;
        events.leaks.push({ lane: e.lane });
        this.enemies.splice(i, 1);
      }
    }

    // war-mode missiles travel toward the ship and explode on contact
    for (var mi = this.missiles.length - 1; mi >= 0; mi--) {
      var ms = this.missiles[mi];
      ms.x -= ms.speed * enemyFactor * dt;
      if (ms.x <= CONFIG.enemyReachX) {
        this.hp -= ms.damage * (1 - s.armor);
        this.combo = 0;
        this.tookDamage = true;
        events.leaks.push({ lane: ms.lane, kind: ms.kind });
        this.missiles.splice(mi, 1);
      }
    }

    // shot motion + collisions (cannon downs ships; interceptor downs missiles)
    for (var j = this.shots.length - 1; j >= 0; j--) {
      var shot = this.shots[j];
      shot.x += shot.speed * dt;
      if (shot.x > CONFIG.shotDespawnX) { this.shots.splice(j, 1); continue; }
      if (shot.kind === 'intercept') {
        for (var mm = this.missiles.length - 1; mm >= 0; mm--) {
          var mis = this.missiles[mm];
          if (mis.lane === shot.lane && Math.abs(mis.x - shot.x) < CONFIG.hitRadius) {
            this.missiles.splice(mm, 1);
            this.shots.splice(j, 1);
            events.hits.push({ x: shot.x, lane: shot.lane, intercept: true });
            break;
          }
        }
        continue;
      }
      for (var m = this.enemies.length - 1; m >= 0; m--) {
        var en = this.enemies[m];
        // submerged submarines are untargetable — shots pass over them
        if (en.lane === shot.lane && !en.submerged && Math.abs(en.x - shot.x) < CONFIG.hitRadius) {
          var crit = Math.random() < CONFIG.critChance;
          var dmg = shot.damage * (crit ? CONFIG.critMult : 1);
          en.hp -= dmg;
          this.shots.splice(j, 1);
          if (en.hp <= 0) {
            this.combo++;
            var reward = Math.round(en.reward * s.goldBonus * this.comboMultiplier());
            this.gold += reward;
            this.earned += reward;
            this.kills++;
            events.kills.push({ x: en.x, lane: en.lane, reward: reward, kind: en.kind, combo: this.combo, crit: crit });
            this.enemies.splice(m, 1);
          } else {
            events.hits.push({ x: en.x, lane: en.lane, dmg: Math.round(dmg), crit: crit });
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
    this.perfectWave = win && !this.tookDamage;
    if (win) {
      var bonus = Math.round((40 + this.wave * 18) * this.stats().goldBonus);
      this.gold += bonus;
      this.earned += bonus;
      if (this.perfectWave) {
        var pb = Math.round(CONFIG.perfectBonus * this.stats().goldBonus);
        this.gold += pb; this.earned += pb;
      }
      // medals: +1 per wave, +2 on boss waves, +1 for a no-damage perfect wave
      var medals = 1 + (this.wave % 3 === 0 ? 2 : 0) + (this.perfectWave ? 1 : 0);
      this.meta.medals += medals;
      this.medalsRun += medals;
      this._saveMeta();
      this._saveRun();   // snapshot post-win state so resume lands at next prep
    } else {
      this.clearSave();  // the run is over
    }
    this.career.kills += this.kills;
    this.career.gold += this.earned;
    this._saveBest();
    this._saveCareer();
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

  Game.prototype._loadCareer = function () {
    var def = { kills: 0, gold: 0, runs: 0 };
    try {
      if (!this.storage) return def;
      var raw = this.storage.getItem('seatycoon.career');
      if (!raw) return def;
      var o = JSON.parse(raw);
      return { kills: o.kills || 0, gold: o.gold || 0, runs: o.runs || 0 };
    } catch (err) {
      return def;
    }
  };

  Game.prototype._saveCareer = function () {
    try {
      if (this.storage) this.storage.setItem('seatycoon.career', JSON.stringify(this.career));
    } catch (err) { /* storage unavailable — ignore */ }
  };

  /* ---- active-run snapshot (resume across browser sessions) ---- */

  Game.prototype._saveRun = function () {
    try {
      if (!this.storage) return;
      var snap = { v: 1, mode: this.mode, wave: this.wave, gold: this.gold, levels: this.levels.slice() };
      this.storage.setItem('seatycoon.run', JSON.stringify(snap));
    } catch (err) { /* ignore */ }
  };

  Game.prototype._loadRun = function () {
    try {
      if (!this.storage) return null;
      var raw = this.storage.getItem('seatycoon.run');
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.v !== 1 || !CONFIG.modes[o.mode]) return null;
      if (!Array.isArray(o.levels) || o.levels.length !== ROOMS.length) return null;
      return o;
    } catch (err) { return null; }
  };

  Game.prototype.hasSave = function () { return !!this._loadRun(); };

  Game.prototype.savedInfo = function () {
    var o = this._loadRun();
    return o ? { mode: o.mode, wave: o.wave + 1 } : null; // the next wave to play
  };

  Game.prototype.clearSave = function () {
    try { if (this.storage) this.storage.removeItem('seatycoon.run'); } catch (err) { /* ignore */ }
  };

  // Resume a saved run at the start of its current (unfinished) wave.
  Game.prototype.continueSavedRun = function () {
    var o = this._loadRun();
    if (!o) return false;
    this.mode = o.mode;
    this.wave = o.wave;
    this.gold = o.gold;
    this.levels = o.levels.slice();
    this.medalsRun = 0;
    this.lastWin = false;
    this._clearBattle();
    this.phase = 'prep';
    return true;
  };

  /* ---- permanent meta upgrades ---- */

  Game.prototype._loadMeta = function () {
    var def = { v: 1, medals: 0, levels: new Array(META.length).fill(0) };
    try {
      if (!this.storage) return def;
      var raw = this.storage.getItem('seatycoon.meta');
      if (!raw) return def;
      var o = JSON.parse(raw);
      var levels = Array.isArray(o.levels) ? o.levels.slice(0, META.length) : [];
      while (levels.length < META.length) levels.push(0);
      return { v: 1, medals: o.medals || 0, levels: levels.map(function (n) { return n || 0; }) };
    } catch (err) { return def; }
  };

  Game.prototype._saveMeta = function () {
    try { if (this.storage) this.storage.setItem('seatycoon.meta', JSON.stringify(this.meta)); } catch (err) { /* ignore */ }
  };

  return Game;
})();

/* Export for Node-based tests; harmless in the browser (no module global). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Game: Game, CONFIG: CONFIG, ROOMS: ROOMS, ABILITIES: ABILITIES, META: META, LANES: LANES };
}
