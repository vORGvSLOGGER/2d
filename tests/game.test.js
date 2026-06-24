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
    setItem: function (k, v) { data[k] = v; },
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
