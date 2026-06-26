/*
 * Headless tests for the Sea Tycoon Defense model.
 * Run with:  node tests/game.test.js
 *
 * These exercise the rules that were broken in the original web build:
 *   - the wave -> result -> prep progression loop (gold/upgrades preserved)
 *   - ability cooldowns (no more infinite spam)
 *   - energy regen
 * plus a balance simulation that an honest auto-player can clear early waves.
 */
var assert = require('assert');
var path = require('path');
var { Game, CONFIG, ROOMS } = require(path.join(__dirname, '..', 'game.js'));

var passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  - ' + name);
}

/* A simple in-memory localStorage stand-in. */
function memStorage() {
  var data = {};
  return {
    getItem: function (k) { return k in data ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
  };
}

/*
 * Auto-player: each frame fire at whichever enemy is closest to the ship,
 * and fire any ability that is off cooldown. Returns true if the wave was won.
 * Caps simulated time so a broken (unwinnable) wave can't loop forever.
 */
function playWave(g, maxSeconds) {
  var dt = 1 / 60;
  var t = 0;
  while (g.phase === 'battle' && t < (maxSeconds || 120)) {
    // target the closest enemy
    var target = null;
    for (var i = 0; i < g.enemies.length; i++) {
      if (!target || g.enemies[i].x < target.x) target = g.enemies[i];
    }
    if (target) g.fire(target.lane);
    // opportunistically use abilities
    g.useAbility('q');
    if (g.hp < g.maxHp * 0.5) g.useAbility('w');
    g.useAbility('e');
    g.useAbility('r');
    g.update(dt);
    t += dt;
  }
  return g.lastWin;
}

console.log('Sea Tycoon Defense - model tests\n');

test('starts in the menu with default economy', function () {
  var g = new Game();
  assert.strictEqual(g.phase, 'menu');
  assert.strictEqual(g.gold, CONFIG.startGold);
  assert.strictEqual(g.levels.length, ROOMS.length);
  assert.ok(g.levels.every(function (v) { return v === 0; }));
});

test('upgrades cost gold and raise levels', function () {
  var g = new Game();
  g.startRun('normal');
  var cost = g.upgradeCost(1);
  var before = g.gold;
  assert.ok(g.buyUpgrade(1));
  assert.strictEqual(g.levels[1], 1);
  assert.strictEqual(g.gold, before - cost);
});

test('cannot upgrade past max level or without gold', function () {
  var g = new Game();
  g.startRun('normal');
  g.gold = 0;
  assert.ok(!g.canUpgrade(0));
  assert.ok(!g.buyUpgrade(0));
  g.gold = 1e9;
  for (var n = 0; n < CONFIG.maxLevel; n++) g.buyUpgrade(0);
  assert.strictEqual(g.levels[0], CONFIG.maxLevel);
  assert.ok(!g.canUpgrade(0)); // capped
});

test('every one of the 8 upgrades changes a stat (none are dead)', function () {
  for (var i = 0; i < ROOMS.length; i++) {
    var base = new Game().stats();
    var g = new Game();
    g.startRun('normal');
    g.levels[i] = 1;
    var up = g.stats();
    var changed = Object.keys(base).some(function (key) { return base[key] !== up[key]; });
    assert.ok(changed, 'room ' + i + ' (' + ROOMS[i].key + ') had no effect');
  }
});

test('THE BIG FIX: win -> result -> prep preserves gold and upgrades', function () {
  var g = new Game();
  g.startRun('normal');
  g.buyUpgrade(1); // buy a cannon upgrade
  var levelsSnapshot = g.levels.slice();
  g.startWave();
  assert.strictEqual(g.phase, 'battle');
  var won = playWave(g);
  assert.ok(won, 'auto-player should clear wave 1 with no/minimal upgrades');
  assert.strictEqual(g.phase, 'result');
  var goldAfterWin = g.gold;
  g.continueAfterWin();
  assert.strictEqual(g.phase, 'prep', 'continue must return to prep, NOT the menu');
  assert.deepStrictEqual(g.levels, levelsSnapshot, 'upgrades must persist into next prep');
  assert.strictEqual(g.gold, goldAfterWin, 'gold must persist into next prep');
  assert.strictEqual(g.wave, 1, 'wave count is preserved between waves');
});

test('losing goes to result(lose); continueAfterWin does not advance', function () {
  var g = new Game();
  g.startRun('normal');
  g.startWave();
  g.hp = 1;
  g.hp = -5; // force death on next update
  g.update(1 / 60);
  assert.strictEqual(g.phase, 'result');
  assert.strictEqual(g.lastWin, false);
  g.continueAfterWin();
  assert.strictEqual(g.phase, 'result', 'a lost run should not silently continue');
});

test('abilities respect cooldowns (no infinite spam)', function () {
  var g = new Game();
  g.startRun('normal');
  g.startWave();
  assert.ok(g.useAbility('w'), 'first repair allowed');
  assert.ok(!g.useAbility('w'), 'second repair blocked while on cooldown');
  assert.ok(g.cooldowns.w > 0);
  // run the cooldown down and confirm it becomes usable again
  for (var t = 0; t < 20; t += 1 / 60) g.update(1 / 60);
  // (wave may have ended; just assert the timer logic itself)
  var g2 = new Game();
  g2.startRun('normal');
  g2.startWave();
  g2.useAbility('e');
  var cd = g2.cooldowns.e;
  g2.update(cd + 0.01);
  assert.strictEqual(g2.cooldowns.e, 0, 'cooldown should reach zero after enough time');
});

test('energy is spent per shot and regenerates over time', function () {
  var g = new Game();
  g.startRun('normal');
  g.startWave();
  var start = g.energy;
  g.fire(0);
  assert.ok(g.energy < start, 'firing spends energy');
  var low = g.energy;
  g.fireTimer = 0; // ignore fire-rate gate for this check
  g.update(1.0); // one second of regen
  assert.ok(g.energy > low, 'energy regenerates during a wave');
  assert.ok(g.energy <= g.maxEnergy, 'energy never exceeds the cap');
});

test('non-lethal shots emit hit events; lethal shots emit kills', function () {
  var g = new Game();
  g.startRun('normal');
  g.startWave();
  // a tanky enemy parked in lane 0 with a shot just behind it
  g.enemies = [{ x: 0.10, lane: 0, hp: 1000, maxHp: 1000, speed: 0, reward: 10, kind: 'fish' }];
  g.shots = [{ x: 0.099, lane: 0, damage: 50, speed: 1.3 }];
  var ev = g.update(1 / 60);
  assert.strictEqual(ev.hits.length, 1, 'a connecting non-lethal shot reports a hit');
  assert.strictEqual(ev.kills.length, 0, 'enemy survived, so no kill');
  assert.strictEqual(g.enemies.length, 1, 'enemy still on the field');

  g.enemies = [{ x: 0.10, lane: 0, hp: 20, maxHp: 1000, speed: 0, reward: 10, kind: 'fish' }];
  g.shots = [{ x: 0.099, lane: 0, damage: 50, speed: 1.3 }];
  ev = g.update(1 / 60);
  assert.strictEqual(ev.kills.length, 1, 'a lethal shot reports a kill');
  assert.strictEqual(ev.hits.length, 0, 'a lethal shot is not also a non-lethal hit');
});

test('sound module loads and never throws without an AudioContext', function () {
  var Sound = require(path.join(__dirname, '..', 'sound.js'));
  Sound.init();           // no window/AudioContext in Node -> stays inert
  Sound.setEnabled(false);
  assert.strictEqual(Sound.isEnabled(), false);
  Sound.setEnabled(true);
  ['shoot', 'hit', 'kill', 'boss', 'damage', 'ability', 'upgrade', 'start', 'win', 'lose'].forEach(function (n) {
    Sound.play(n); // must be a no-op, not a crash
  });
  Sound.play('does-not-exist');
});

test('best wave is persisted via storage', function () {
  var store = memStorage();
  var g = new Game(store);
  g.startRun('normal');
  g.startWave();   // wave 1
  g._endWave(true);
  assert.strictEqual(store.getItem('seatycoon.best'), '1');
  var g2 = new Game(store);
  assert.strictEqual(g2.best, 1, 'best wave reloads from storage');
});

test('an active run is saved and resumes at the start of its current wave', function () {
  var store = memStorage();
  var g = new Game(store);
  g.startRun('normal');
  g.buyUpgrade(1);            // cannons -> level 1
  g.startWave();             // wave 1
  g.enemies = []; g.spawnLeft = 0;
  g.update(1 / 60);          // clears wave 1 -> snapshot saved
  assert.ok(g.hasSave(), 'a run snapshot exists');
  assert.deepStrictEqual(g.savedInfo(), { mode: 'normal', wave: 2 }, 'will resume into wave 2');
  var goldAtPrep = g.gold, lvl = g.levels[1];

  var reloaded = new Game(store);  // simulate closing + reopening the browser
  assert.ok(reloaded.hasSave());
  assert.strictEqual(reloaded.career.runs, 1, 'attempts are NOT reset on reload');
  assert.ok(reloaded.continueSavedRun());
  assert.strictEqual(reloaded.phase, 'prep');
  assert.strictEqual(reloaded.wave, 1, 'resumes at the current (unfinished) wave');
  assert.strictEqual(reloaded.gold, goldAtPrep, 'gold preserved');
  assert.strictEqual(reloaded.levels[1], lvl, 'upgrades preserved');
});

test('losing clears the saved run', function () {
  var store = memStorage();
  var g = new Game(store);
  g.startRun('normal');
  g.startWave();
  assert.ok(g.hasSave());
  g.hp = 0;
  g.update(1 / 60);          // hp<=0 -> _endWave(false)
  assert.strictEqual(g.phase, 'result');
  assert.ok(!g.lastWin);
  assert.ok(!g.hasSave(), 'a lost run no longer offers continue');
});

test('medals are earned per wave and persist; meta upgrades apply', function () {
  var store = memStorage();
  var g = new Game(store);
  g.startRun('normal');
  function clearWave() { g.startWave(); g.enemies = []; g.spawnLeft = 0; g.update(1 / 60); }
  clearWave();               // wave 1 -> +1
  assert.strictEqual(g.meta.medals, 1, 'one medal per wave');
  g.continueAfterWin(); clearWave();   // wave 2 -> +1
  g.continueAfterWin(); clearWave();   // wave 3 (boss) -> +1 +2
  assert.strictEqual(g.meta.medals, 5, 'boss wave grants the +2 bonus');

  var g2 = new Game(store);
  assert.strictEqual(g2.meta.medals, 5, 'medals persist across reload');

  g2.startRun('normal');
  var s0 = g2.stats().maxHp;
  g2.meta.medals = 99;
  assert.ok(g2.buyMeta(0), 'buy fleet');               // +25 base HP
  assert.strictEqual(g2.stats().maxHp, s0 + 25, 'fleet raises base HP');
  assert.ok(g2.buyMeta(3), 'buy training');            // +1 room cap
  assert.strictEqual(g2.roomMaxLevel(), CONFIG.maxLevel + 1, 'training raises the room cap');
  var g3 = new Game(store);
  assert.ok(g3.meta.levels[0] >= 1 && g3.meta.levels[3] >= 1, 'meta levels persist');
});

test('war mode: ships hold at a line and fire missiles', function () {
  var g = new Game();
  g.startRun('endless');           // "endless" key is now War mode
  g.startWave();
  g.spawnLeft = 0;                 // stop the spawner so the test is deterministic
  g.enemies = [{ x: 0.9, lane: 0, hp: 999, maxHp: 999, speed: 0.5, reward: 5, kind: 'fish',
                 submerged: false, diveTimer: 0, hold: 0.5, stationed: false, fireTimer: 0.05 }];
  g.missiles = [];
  for (var i = 0; i < 120; i++) g.update(1 / 60);
  assert.ok(g.enemies[0].stationed, 'ship stops at its hold line');
  assert.ok(Math.abs(g.enemies[0].x - 0.5) < 1e-6, 'parked exactly at the hold line');
  assert.ok(g.missiles.length >= 1, 'a stationed ship fires missiles');
});

test('war mode: interceptor downs missiles, cannon ignores them', function () {
  var g = new Game();
  g.startRun('endless');
  g.startWave();
  g.spawnLeft = 0;
  g.enemies = [{ x: 0.5, lane: 0, hp: 999, maxHp: 999, reward: 5, kind: 'fish',
                 submerged: false, diveTimer: 0, hold: 0.5, stationed: true, fireTimer: 999 }];

  // interceptor destroys a missile without touching the ship
  g.missiles = [{ x: 0.4, lane: 0, speed: 0, damage: 16 }];
  g.setWeapon('intercept');
  var hp0 = g.hp;
  g.fire(0);
  for (var k = 0; k < 60; k++) g.update(1 / 60);
  assert.strictEqual(g.missiles.length, 0, 'interceptor shot downs the missile');
  assert.strictEqual(g.hp, hp0, 'no ship damage when a missile is intercepted');

  // cannon shots pass over missiles (anti-ship only)
  g.setWeapon('cannon');
  g.missiles = [{ x: 0.45, lane: 1, speed: 0, damage: 16 }];
  g.fire(1);
  for (var z = 0; z < 60; z++) g.update(1 / 60);
  assert.strictEqual(g.missiles.length, 1, 'cannon ignores missiles');
});

test('war mode: an unintercepted missile damages the ship', function () {
  var g = new Game();
  g.startRun('endless');
  g.startWave();
  g.spawnLeft = 0;
  // keep one parked ship alive so the wave doesn't end before the missile lands
  g.enemies = [{ x: 0.5, lane: 0, hp: 999, maxHp: 999, kind: 'fish',
                 submerged: false, hold: 0.5, stationed: true, fireTimer: 999 }];
  g.missiles = [{ x: 0.08, lane: 2, speed: 0.5, damage: 16 }];
  var hp0 = g.hp;
  for (var i = 0; i < 60; i++) g.update(1 / 60);
  assert.ok(g.hp < hp0, 'a missile that reaches the ship deals damage');
});

test('treasury meta raises starting gold', function () {
  var store = memStorage();
  var g = new Game(store);
  g.meta.levels[2] = 2;      // treasury x2 -> +70 start gold
  g.startRun('normal');
  assert.strictEqual(g.gold, CONFIG.startGold + 70);
});

test('enemy variety unlocks as waves progress', function () {
  var g = new Game();
  assert.deepStrictEqual(g.availableKinds(1), ['fish'], 'wave 1 is fish only');
  var w2 = g.availableKinds(2);
  assert.ok(w2.indexOf('raft') >= 0 && w2.indexOf('sub') < 0, 'rafts join at wave 2, subs not yet');
  assert.ok(g.availableKinds(4).indexOf('sub') >= 0, 'submarines join at wave 4');
});

test('combo multiplier scales by tier and is capped', function () {
  var g = new Game();
  g.combo = 0;
  assert.strictEqual(g.comboMultiplier(), 1, 'no combo = no bonus');
  g.combo = CONFIG.comboStep;
  assert.ok(Math.abs(g.comboMultiplier() - (1 + CONFIG.comboTierBonus)) < 1e-9, 'one tier');
  g.combo = 100000;
  assert.ok(Math.abs(g.comboMultiplier() - (1 + CONFIG.comboMaxBonus)) < 1e-9, 'capped');
});

test('a kill raises the combo; a leak resets it', function () {
  var g = new Game();
  g.startRun('normal');
  g.startWave();
  g.spawnLeft = 5; // keep the wave from ending mid-test
  g.combo = CONFIG.comboStep; // tier 1 -> x(1+bonus)
  g.enemies = [{ x: 0.10, lane: 0, hp: 10, maxHp: 100, speed: 0, reward: 100, kind: 'fish', submerged: false, diveTimer: 0 }];
  g.shots = [{ x: 0.099, lane: 0, damage: 50, speed: 1.3 }];
  var goldBefore = g.gold;
  var ev = g.update(1 / 60);
  assert.strictEqual(ev.kills.length, 1, 'enemy killed');
  assert.strictEqual(g.combo, CONFIG.comboStep + 1, 'combo incremented on kill');
  var expected = Math.round(100 * g.stats().goldBonus * (1 + CONFIG.comboTierBonus));
  assert.strictEqual(g.gold - goldBefore, expected, 'reward scaled by the combo multiplier');

  // now let one leak through and confirm the combo resets
  g.enemies = [{ x: 0, lane: 0, hp: 10, maxHp: 10, speed: 0.1, reward: 5, kind: 'fish', submerged: false, diveTimer: 0 }];
  g.update(1 / 60);
  assert.strictEqual(g.combo, 0, 'a leak resets the combo');
});

test('submerged submarines are untargetable until they surface', function () {
  var g = new Game();
  g.startRun('normal');
  g.startWave();
  g.spawnLeft = 5;
  var sub = { x: 0.5, lane: 0, hp: 100, maxHp: 100, speed: 0, reward: 10, kind: 'sub', submerged: true, diveTimer: CONFIG.subSubmerged };
  g.enemies = [sub];
  g.shots = [{ x: 0.49, lane: 0, damage: 50, speed: 1.3 }];
  g.update(1 / 60);
  assert.strictEqual(sub.hp, 100, 'shots pass over a submerged sub');

  sub.diveTimer = 0.0001; // force it to surface
  g.shots = [];
  g.update(1 / 60);
  assert.strictEqual(sub.submerged, false, 'sub surfaces when its dive timer elapses');
  g.shots = [{ x: 0.49, lane: 0, damage: 50, speed: 1.3 }];
  g.update(1 / 60);
  assert.ok(sub.hp < 100, 'a surfaced sub takes damage');
});

test('career stats accumulate and persist across runs', function () {
  var store = memStorage();
  var g = new Game(store);
  assert.deepStrictEqual(g.career, { kills: 0, gold: 0, runs: 0 });
  g.startRun('normal');
  assert.strictEqual(g.career.runs, 1, 'starting a run is counted');
  g.startWave();
  g.kills = 3;
  g.earned = 50;
  g._endWave(true);
  assert.strictEqual(g.career.kills, 3, 'kills banked into career');
  assert.ok(g.career.gold >= 50, 'earned gold banked into career');
  var reloaded = new Game(store);
  assert.strictEqual(reloaded.career.runs, 1, 'career reloads from storage');
  assert.strictEqual(reloaded.career.kills, 3);
});

test('balance: a no-upgrade player clears waves 1-3, and waves get harder', function () {
  var g = new Game();
  g.startRun('normal');
  var clearedNoUpgrade = 0;
  for (var w = 0; w < 3; w++) {
    g.startWave();
    if (playWave(g)) { clearedNoUpgrade++; g.continueAfterWin(); } else break;
  }
  assert.ok(clearedNoUpgrade >= 3, 'early waves should be winnable bare (got ' + clearedNoUpgrade + ')');

  // Without ever upgrading, the player should eventually lose -> there is a curve.
  var g2 = new Game();
  g2.startRun('normal');
  var reached = 0;
  for (var k = 0; k < 60; k++) {
    g2.startWave();
    if (playWave(g2)) { reached = g2.wave; g2.continueAfterWin(); } else break;
  }
  assert.ok(reached < 60, 'a no-upgrade player should not survive forever (reached ' + reached + ')');
  console.log('       (no-upgrade survival reached wave ' + reached + ')');
});

console.log('\n' + passed + ' tests passed.');
