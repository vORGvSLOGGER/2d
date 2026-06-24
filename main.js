/*
 * Sea Tycoon Defense - browser layer
 * --------------------------------------------------------------------------
 * Everything that touches the DOM / canvas lives here: rendering, input,
 * the HTML overlays (menu, prep, result, pause), visual effects and the
 * requestAnimationFrame loop. All game rules come from game.js.
 */
(function () {
  'use strict';

  var game = new Game(safeLocalStorage());

  // canvas
  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;

  // overlays / controls
  var screenMenu = document.getElementById('screen-menu');
  var screenPrep = document.getElementById('screen-prep');
  var screenResult = document.getElementById('screen-result');
  var screenPause = document.getElementById('screen-pause');
  var hud = document.getElementById('hud');
  var controls = document.getElementById('controls');

  // visual-only effect state
  var particles = [];
  var floats = [];
  var muzzles = [];        // muzzle flashes at the ship when firing
  var damageFlash = 0;     // red full-screen flash when the ship is hit
  var shakeMag = 0;        // current screen-shake magnitude (px)
  var banner = null;       // { text, life } wave-intro banner
  var clock = 0;
  var paused = false;
  var muted = false;
  var renderedPhase = null; // so overlays rebuild only on phase change

  // playfield layout (recomputed on resize)
  var marginLeft = 56, marginRight = 6, padTop = 8, padBottom = 8;

  init();

  /* ===================================================================== */
  /* setup                                                                  */
  /* ===================================================================== */

  function init() {
    buildLaneButtons();
    buildAbilityButtons();
    buildMenuModes();

    document.getElementById('btn-pause').addEventListener('click', togglePause);
    document.getElementById('btn-resume').addEventListener('click', togglePause);
    document.getElementById('btn-quit').addEventListener('click', function () {
      paused = false;
      game.toMenu();
    });

    // sound: load mute preference, wire the toggle, and unlock audio on the
    // first user gesture (browsers require a gesture before audio can play).
    muted = loadMuted();
    Sound.setEnabled(!muted);
    refreshMuteButton();
    document.getElementById('btn-mute').addEventListener('click', toggleMute);
    var unlock = function () {
      Sound.init();
      Sound.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // fire by tapping a lane directly on the playfield
    canvas.addEventListener('pointerdown', function (ev) {
      if (game.phase !== 'battle' || paused) return;
      var rect = canvas.getBoundingClientRect();
      playerFire(laneFromY(ev.clientY - rect.top));
    });

    // keyboard support (desktop / testing)
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);

    fit();
    requestAnimationFrame(loop);
  }

  function buildLaneButtons() {
    var wrap = document.getElementById('lanes');
    for (var i = 0; i < CONFIG.lanes; i++) {
      var b = document.createElement('button');
      b.className = 'btn';
      b.textContent = String(i + 1);
      (function (lane) {
        b.addEventListener('click', function () { playerFire(lane); });
      })(i);
      wrap.appendChild(b);
    }
  }

  function buildAbilityButtons() {
    var wrap = document.getElementById('abilities');
    ABILITIES.forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn gold ability';
      b.dataset.key = a.key;
      b.innerHTML =
        '<span class="ab-cd"></span>' +
        '<span class="ab-timer"></span>' +
        '<span class="ab-name">' + a.name + '</span>' +
        '<span class="ab-hint">' + a.hint + '</span>';
      b.addEventListener('click', function () { playerAbility(a.key); });
      wrap.appendChild(b);
    });
  }

  function buildMenuModes() {
    var wrap = document.getElementById('menu-modes');
    var info = {
      normal:  'اللعب الكامل',
      fast:    'أسرع + ذهب مضاعف',
      endless: 'تحدٍ متصاعد بلا نهاية',
    };
    Object.keys(CONFIG.modes).forEach(function (key) {
      var b = document.createElement('button');
      b.className = 'mode-btn';
      b.innerHTML = CONFIG.modes[key].label + '<small>' + (info[key] || '') + '</small>';
      b.addEventListener('click', function () { game.startRun(key); });
      wrap.appendChild(b);
    });
  }

  /* ===================================================================== */
  /* layout                                                                 */
  /* ===================================================================== */

  function fit() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    marginLeft = Math.max(48, W * 0.12);
  }

  function worldX(x) { return marginLeft + x * (W - marginLeft - marginRight); }
  function laneY(lane) {
    var top = padTop, bottom = padBottom;
    return top + (H - top - bottom) * ((lane + 0.5) / CONFIG.lanes);
  }
  function laneFromY(y) {
    var top = padTop, bottom = padBottom;
    var lane = Math.floor(((y - top) / (H - top - bottom)) * CONFIG.lanes);
    return Math.max(0, Math.min(CONFIG.lanes - 1, lane));
  }

  /* ===================================================================== */
  /* input                                                                  */
  /* ===================================================================== */

  function onKey(e) {
    var k = e.key.toLowerCase();
    if (game.phase === 'menu') {
      if (k === '1') game.startRun('normal');
      if (k === '2') game.startRun('fast');
      if (k === '3') game.startRun('endless');
    } else if (game.phase === 'prep') {
      if (k === 'enter' || k === ' ') startWave();
    } else if (game.phase === 'battle') {
      if (k >= '1' && k <= '5') playerFire(parseInt(k, 10) - 1);
      if (k === 'q' || k === 'w' || k === 'e' || k === 'r') playerAbility(k);
      if (k === 'p' || k === 'escape') togglePause();
    } else if (game.phase === 'result') {
      if (k === ' ' || k === 'enter') advanceFromResult();
    }
  }

  function togglePause() {
    if (game.phase !== 'battle') return;
    paused = !paused;
  }

  function advanceFromResult() {
    if (game.lastWin) game.continueAfterWin();
    else game.toMenu();
  }

  // Player actions funnel through these so input source (button / tap / key)
  // and audio-visual feedback stay in one place.
  function playerFire(lane) {
    if (game.fire(lane)) {
      Sound.play('shoot');
      muzzles.push({ lane: lane, life: 0.09 });
    }
  }

  function playerAbility(key) {
    if (game.useAbility(key)) Sound.play('ability');
  }

  function startWave() {
    Sound.play('start');
    game.startWave();
  }

  function setShake(mag) { shakeMag = Math.max(shakeMag, mag); }

  function toggleMute() {
    muted = !muted;
    Sound.setEnabled(!muted);
    saveMuted(muted);
    refreshMuteButton();
  }

  function refreshMuteButton() {
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  }

  /* ===================================================================== */
  /* main loop                                                              */
  /* ===================================================================== */

  function loop(now) {
    var dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
    loop.last = now;
    clock += dt;

    if (game.phase === 'battle' && !paused) {
      var events = game.update(dt);
      spawnEffects(events);
    }
    updateEffects(dt);

    drawScene();
    syncScreens();
    if (game.phase === 'battle') {
      updateHud();
      updateAbilityButtons();
    }

    requestAnimationFrame(loop);
  }

  /* ===================================================================== */
  /* rendering                                                              */
  /* ===================================================================== */

  function drawScene() {
    var shaking = shakeMag > 0.2 && game.phase === 'battle';
    if (shaking) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    }

    drawSea();
    if (game.phase === 'battle') {
      drawLanes();
      drawShip();
      drawMuzzles();
      game.enemies.forEach(drawEnemy);
      game.shots.forEach(drawShot);
      drawParticles();
      drawFloats();
    }

    if (shaking) ctx.restore();

    // overlays that should not be displaced by the shake
    if (game.phase === 'battle') {
      drawDamageFlash();
      drawLowHpWarning();
      drawBanner();
    }
  }

  function drawMuzzles() {
    muzzles.forEach(function (mz) {
      var x = marginLeft + 6;
      var y = laneY(mz.lane);
      ctx.globalAlpha = Math.max(0, mz.life / 0.09);
      ctx.fillStyle = '#fff3b0';
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 14;
      circle(x, y, 8);
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;
  }

  function drawLowHpWarning() {
    if (!game.maxHp || game.hp / game.maxHp >= 0.3) return;
    var pulse = 0.18 + Math.abs(Math.sin(clock * 4)) * 0.22;
    ctx.strokeStyle = 'rgba(239,68,68,' + pulse.toFixed(3) + ')';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, W - 14, H - 14);
    ctx.lineWidth = 1;
  }

  function drawBanner() {
    if (!banner) return;
    var t = banner.life;
    var alpha = Math.min(1, t * 2.5);            // fade out at the end
    var scale = 1 + Math.max(0, (1.6 - t)) * 0.05;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H * 0.32);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#22d3ee';
    ctx.font = '900 44px Tahoma, Arial, sans-serif';
    ctx.fillText(banner.text, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  function drawSea() {
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#08304f');
    bg.addColorStop(0.55, '#064e63');
    bg.addColorStop(1, '#02111f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(125,211,252,.16)';
    ctx.lineWidth = 2;
    for (var row = 0; row < 10; row++) {
      ctx.beginPath();
      for (var x = 0; x <= W; x += 18) {
        var y = 20 + row * (H / 9) + Math.sin((x + clock * 70) / 36 + row) * 4;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawLanes() {
    ctx.strokeStyle = 'rgba(186,230,253,.20)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1;
    for (var i = 0; i < CONFIG.lanes; i++) {
      var y = laneY(i);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawShip() {
    var x = marginLeft - 30;
    var y = H / 2;
    ctx.save();
    ctx.translate(x, y);
    // hull
    ctx.fillStyle = '#78350f';
    roundRect(-6, 36, 64, 44, 20);
    ctx.fill();
    // sail
    var grad = ctx.createLinearGradient(0, -60, 60, 90);
    grad.addColorStop(0, '#dbeafe');
    grad.addColorStop(0.4, '#38bdf8');
    grad.addColorStop(1, '#075985');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(8, -54);
    ctx.lineTo(48, 44);
    ctx.lineTo(2, 30);
    ctx.closePath();
    ctx.fill();
    // mast
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(8, -60);
    ctx.lineTo(8, 70);
    ctx.stroke();
    // cannon
    ctx.fillStyle = '#facc15';
    ctx.fillRect(50, 44, 22, 6);
    ctx.restore();
  }

  function drawEnemy(e) {
    var x = worldX(e.x);
    var y = laneY(e.lane);
    var scale = e.kind === 'boss' ? 1.5 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    if (e.kind === 'sub') {
      ctx.fillStyle = '#94a3b8';
      roundRect(-30, -13, 60, 26, 13); ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.fillRect(-4, -24, 16, 12);
      ctx.fillStyle = '#22d3ee';
      circle(16, -2, 3.5);
    } else if (e.kind === 'raft') {
      ctx.fillStyle = '#7c2d12';
      roundRect(-30, -11, 60, 22, 9); ctx.fill();
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.moveTo(-2, -30); ctx.lineTo(24, -3); ctx.lineTo(-7, -3); ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = e.kind === 'boss' ? '#f97316' : '#22c55e';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      // tail
      ctx.beginPath();
      ctx.moveTo(27, 0); ctx.lineTo(48, -13); ctx.lineTo(48, 13); ctx.closePath();
      ctx.fill();
      // eye
      ctx.fillStyle = '#00131f';
      circle(-15, -4, 3);
    }
    ctx.restore();

    // health bar
    var hbw = 60 * scale;
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x - hbw / 2, y - 26 * scale, hbw, 4);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x - hbw / 2, y - 26 * scale, hbw * Math.max(0, e.hp / e.maxHp), 4);
  }

  function drawShot(s) {
    var x = worldX(s.x);
    var y = laneY(s.lane);
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 10;
    circle(x, y, 6);
    ctx.shadowBlur = 0;
  }

  /* ---- effects (visual only) ------------------------------------------ */

  function spawnEffects(events) {
    events.hits.forEach(function (hit) {
      var x = worldX(hit.x);
      var y = laneY(hit.lane);
      for (var i = 0; i < 4; i++) {
        var a = Math.random() * Math.PI * 2;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * 60, vy: Math.sin(a) * 60,
          life: 0.25, max: 0.25, size: 1.5 + Math.random() * 1.5, color: '#fff7cc',
        });
      }
    });
    if (events.hits.length) Sound.play('hit');

    events.kills.forEach(function (kill) {
      var x = worldX(kill.x);
      var y = laneY(kill.lane);
      var boss = kill.kind === 'boss';
      var color = boss ? '#f97316' : '#fde68a';
      var count = boss ? 26 : 12;
      for (var i = 0; i < count; i++) {
        var ang = Math.random() * Math.PI * 2;
        var spd = 40 + Math.random() * 140;
        particles.push({
          x: x, y: y,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: 0.6, max: 0.6, size: 2 + Math.random() * 3, color: color,
        });
      }
      floats.push({ x: x, y: y - 18, vy: -42, life: 1.0, text: '+' + kill.reward });
      Sound.play(boss ? 'boss' : 'kill');
      if (boss) setShake(10);
    });

    events.leaks.forEach(function (leak) {
      damageFlash = 1;
      setShake(7);
      Sound.play('damage');
      vibrate(35);
      var y = laneY(leak.lane);
      for (var i = 0; i < 8; i++) {
        particles.push({
          x: marginLeft, y: y,
          vx: -(20 + Math.random() * 60), vy: (Math.random() - 0.5) * 120,
          life: 0.5, max: 0.5, size: 2 + Math.random() * 2, color: '#ef4444',
        });
      }
    });
  }

  function updateEffects(dt) {
    damageFlash = Math.max(0, damageFlash - dt * 2);
    shakeMag = Math.max(0, shakeMag - dt * 40);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var j = floats.length - 1; j >= 0; j--) {
      var f = floats[j];
      f.y += f.vy * dt; f.life -= dt;
      if (f.life <= 0) floats.splice(j, 1);
    }
    for (var m = muzzles.length - 1; m >= 0; m--) {
      muzzles[m].life -= dt;
      if (muzzles[m].life <= 0) muzzles.splice(m, 1);
    }
    if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }
  }

  function drawParticles() {
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      circle(p.x, p.y, p.size);
    });
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.font = '900 16px Tahoma, Arial, sans-serif';
    floats.forEach(function (f) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.fillStyle = '#facc15';
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  function drawDamageFlash() {
    if (damageFlash <= 0) return;
    ctx.fillStyle = 'rgba(239,68,68,' + (damageFlash * 0.35).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }

  /* ---- canvas helpers -------------------------------------------------- */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ===================================================================== */
  /* HUD + ability buttons                                                  */
  /* ===================================================================== */

  function updateHud() {
    setChip('hud-hp', 'درع', Math.max(0, Math.round(game.hp)) + '/' + game.maxHp);
    setChip('hud-gold', 'ذهب', game.gold);
    setChip('hud-energy', 'طاقة', Math.floor(game.energy) + '/' + game.maxEnergy);
    setChip('hud-wave', 'موجة', game.wave);
  }

  function setChip(id, label, value) {
    document.getElementById(id).innerHTML = label + ' <b>' + value + '</b>';
  }

  function updateAbilityButtons() {
    var buttons = document.querySelectorAll('.ability');
    buttons.forEach(function (btn) {
      var key = btn.dataset.key;
      var remaining = game.cooldowns ? game.cooldowns[key] : 0;
      var max = game.abilityMaxCooldown(key);
      var cd = btn.querySelector('.ab-cd');
      var timer = btn.querySelector('.ab-timer');
      if (remaining > 0) {
        btn.classList.add('cooling');
        cd.style.height = Math.min(100, (remaining / max) * 100) + '%';
        timer.textContent = Math.ceil(remaining);
      } else {
        btn.classList.remove('cooling');
        cd.style.height = '0%';
        timer.textContent = '';
      }
    });
  }

  /* ===================================================================== */
  /* overlays                                                               */
  /* ===================================================================== */

  function syncScreens() {
    var phase = game.phase;
    show(screenMenu, phase === 'menu');
    show(screenPrep, phase === 'prep');
    show(screenResult, phase === 'result');
    show(screenPause, phase === 'battle' && paused);

    var inBattle = phase === 'battle';
    hud.style.visibility = inBattle ? 'visible' : 'hidden';
    controls.style.visibility = inBattle ? 'visible' : 'hidden';

    // rebuild overlay contents only when the phase actually changes
    if (phase !== renderedPhase) {
      renderedPhase = phase;
      if (phase === 'menu') renderMenu();
      if (phase === 'prep') renderPrep();
      if (phase === 'battle') banner = { text: 'الموجة ' + game.wave, life: 1.6 };
      if (phase === 'result') { renderResult(); Sound.play(game.lastWin ? 'win' : 'lose'); }
    }
  }

  function show(el, visible) { el.classList.toggle('hide', !visible); }

  function renderMenu() {
    var el = document.getElementById('menu-best');
    el.textContent = game.best > 0 ? ('أفضل موجة: ' + game.best) : '';
  }

  function renderPrep() {
    var body = document.getElementById('prep-body');
    var html = '' +
      '<div class="prep-head">' +
        '<div class="title" style="font-size:34px">التجهيز</div>' +
        '<div class="best">موجة ' + (game.wave + 1) + '</div>' +
      '</div>' +
      '<p class="subtitle">الذهب: <b style="color:var(--gold)">' + game.gold + '</b> — رقِّ الغرف ثم ابدأ.</p>' +
      '<div class="rooms">';
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      var maxed = game.levels[i] >= CONFIG.maxLevel;
      var afford = game.canUpgrade(i);
      var label = maxed ? 'أقصى مستوى' : ('ترقية — ' + game.upgradeCost(i));
      html +=
        '<div class="room' + (maxed ? ' maxed' : '') + '">' +
          '<h3>' + r.name + '</h3>' +
          '<div class="lv">المستوى ' + game.levels[i] + '/' + CONFIG.maxLevel + '</div>' +
          '<div class="desc">' + r.desc + '</div>' +
          '<button class="buy" data-room="' + i + '"' + (afford ? '' : ' disabled') + '>' + label + '</button>' +
        '</div>';
    }
    html += '</div><button class="start" id="prep-start">ابدأ الموجة</button>';
    body.innerHTML = html;

    body.querySelectorAll('.buy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (game.buyUpgrade(parseInt(btn.dataset.room, 10))) {
          Sound.play('upgrade');
          renderPrep();
        }
      });
    });
    document.getElementById('prep-start').addEventListener('click', startWave);
  }

  function renderResult() {
    var body = document.getElementById('result-body');
    var win = game.lastWin;
    body.innerHTML = '' +
      '<div class="result-card">' +
        '<div class="result-title ' + (win ? 'win' : 'lose') + '">' +
          (win ? 'تم صد الموجة' : 'غرقت السفينة') + '</div>' +
        '<div class="result-stats">' +
          'الموجة <b>' + game.wave + '</b><br>' +
          'أعداء مُدمَّرة: <b>' + game.kills + '</b><br>' +
          'ذهب مكتسب: <b>' + game.earned + '</b><br>' +
          'أفضل موجة: <b>' + game.best + '</b>' +
        '</div>' +
        '<button class="start" id="result-go">' + (win ? 'متابعة' : 'القائمة') + '</button>' +
      '</div>';
    document.getElementById('result-go').addEventListener('click', advanceFromResult);
  }

  /* ===================================================================== */
  /* misc                                                                   */
  /* ===================================================================== */

  function safeLocalStorage() {
    try {
      var t = '__st_test__';
      window.localStorage.setItem(t, t);
      window.localStorage.removeItem(t);
      return window.localStorage;
    } catch (err) {
      return null; // private mode / disabled storage — game still runs
    }
  }

  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (err) {}
  }

  function loadMuted() {
    try { return window.localStorage.getItem('seatycoon.muted') === '1'; }
    catch (err) { return false; }
  }

  function saveMuted(v) {
    try { window.localStorage.setItem('seatycoon.muted', v ? '1' : '0'); }
    catch (err) {}
  }
})();
