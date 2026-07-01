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
  try { window.__game = game; } catch (e) {} // debug / e2e handle

  // canvas
  var canvas = document.getElementById('cv');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;

  // player ship sprite (replaces the canvas-drawn warship once loaded)
  var shipImg = new Image();
  var shipImgReady = false;
  shipImg.onload = function () { shipImgReady = true; };
  shipImg.src = 'assets/player-ship.png';

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
  var smoke = [];          // funnel smoke puffs
  var explosions = [];     // impact blasts when an enemy/missile hits the ship
  var smokeTimer = 0;
  var shipRecoil = 0;      // 0..1, briefly set when the main gun fires
  var damageFlash = 0;     // red full-screen flash when the ship is hit
  var shakeMag = 0;        // current screen-shake magnitude (px)
  var banner = null;       // { text, life } wave-intro banner
  var callout = null;      // big centered hype text (combo / boss warning)
  var lastCombo = 0;
  var bossWarned = false;
  var clock = 0;
  var paused = false;
  var muted = false;
  var renderedPhase = null; // so overlays rebuild only on phase change
  var menuView = 'home';    // home | modes | shop (menu sub-view)
  var currentMusic = 'stop'; // 'battle' | 'boss' | 'stop'

  // background scenery (regenerated on resize)
  var stars = [];
  var clouds = [];
  var horizonY = 0;

  // emoji icons for the HUD ability buttons and the upgrade rooms (declared
  // up here so they exist before init() builds the buttons below)
  var ABILITY_ICONS = { q: '🎆', w: '🔧', e: '⚡', r: '❄️' };
  var ROOM_ICONS = ['🧭', '💣', '⚙️', '🔋', '🛡️', '💰', '📡', '🧑‍✈️'];

  // playfield layout (recomputed on resize)
  var marginLeft = 56, marginRight = 6, padTop = 8, padBottom = 8;

  init();

  /* ===================================================================== */
  /* setup                                                                  */
  /* ===================================================================== */

  function init() {
    buildLaneButtons();
    buildAbilityButtons();

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
      currentMusic = null; // re-apply music now that audio is unlocked
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

    // weapon toggle (war mode): cannon <-> missile interceptor
    document.getElementById('btn-weapon').addEventListener('click', function () {
      game.setWeapon(game.weapon === 'cannon' ? 'intercept' : 'cannon');
      Sound.play('ability');
      refreshWeaponBtn();
    });

    // keep the phone/browser "back" button inside the game instead of leaving
    try { history.pushState({ st: 1 }, ''); } catch (e) {}
    window.addEventListener('popstate', function () {
      try { history.pushState({ st: 1 }, ''); } catch (e) {}
      goBack();
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
      b.className = 'ability';
      b.dataset.key = a.key;
      b.innerHTML =
        '<span class="ab-cd"></span>' +
        '<span class="ab-timer"></span>' +
        '<span class="ab-ico">' + (ABILITY_ICONS[a.key] || '✨') + '</span>' +
        '<span class="ab-name">' + a.name + '</span>' +
        '<span class="ab-hint">' + a.hint + '</span>';
      b.addEventListener('click', function () { playerAbility(a.key); });
      wrap.appendChild(b);
    });
  }

  var MODE_INFO = {
    normal:  { hint: 'اللعب الكامل', ico: '⚓' },
    fast:    { hint: 'أسرع + ذهب مضاعف', ico: '⚡' },
    endless: { hint: 'تحدٍ متصاعد بلا نهاية', ico: '♾️' },
  };
  var META_ICONS = ['⛴️', '💣', '💰', '🎓'];

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
    marginLeft = Math.max(82, W * 0.22);
    horizonY = H * 0.33;
    initScenery();
  }

  // Generate the static parts of the night sky once per resize.
  function initScenery() {
    stars = [];
    var n = Math.round(W * horizonY / 5000);
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * (horizonY - 6),
        r: Math.random() * 1.3 + 0.3,
        tw: Math.random() * Math.PI * 2,
      });
    }
    clouds = [];
    for (var c = 0; c < 5; c++) {
      clouds.push({
        x: Math.random() * (W + 260),
        y: horizonY * (0.2 + Math.random() * 0.55),
        w: 70 + Math.random() * 90,
        h: 12 + Math.random() * 12,
        speed: 4 + Math.random() * 7,
        alpha: 0.10 + Math.random() * 0.12,
      });
    }
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
      if (k === 'x') { game.setWeapon(game.weapon === 'cannon' ? 'intercept' : 'cannon'); refreshWeaponBtn(); }
    } else if (game.phase === 'result') {
      if (k === ' ' || k === 'enter') advanceFromResult();
    }
  }

  // Route the hardware/browser back button to an in-app step so a stray
  // "back" pauses or returns to the menu instead of leaving the page.
  function goBack() {
    if (game.phase === 'menu') {
      if (menuView !== 'home') { menuView = 'home'; renderMenu(); }
      return;
    }
    if (game.phase === 'battle') {
      if (!paused) { togglePause(); return; }   // first back press = pause
      paused = false; game.toMenu(); return;     // again = quit to menu
    }
    game.toMenu(); // prep / result -> menu (the run stays saved)
  }

  function refreshWeaponBtn() {
    var btn = document.getElementById('btn-weapon');
    var war = game.phase === 'battle' && !paused && !!CONFIG.modes[game.mode].war;
    btn.classList.toggle('hide', !war);
    if (!war) return;
    var inter = game.weapon === 'intercept';
    btn.classList.toggle('intercept', inter);
    btn.innerHTML = inter
      ? '🛡️ <b>صدّ الصواريخ</b><small>اضغط للمدفع</small>'
      : '💥 <b>المدفع — دمّر السفن</b><small>اضغط لصدّ الصواريخ</small>';
  }

  // Background music follows the battle state: boss theme on boss waves.
  function updateMusic() {
    var want = 'stop';
    if (game.phase === 'battle' && !paused) want = (game.wave % 3 === 0) ? 'boss' : 'battle';
    if (want !== currentMusic) { currentMusic = want; Sound.music(want); }
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
      muzzles.push({ lane: lane, life: 0.1 });
      shipRecoil = 1;
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
      emitSmoke(dt);
      updateHype(events);
    }
    updateEffects(dt);

    drawScene();
    syncScreens();
    if (game.phase === 'battle') {
      updateHud();
      updateAbilityButtons();
    }
    refreshWeaponBtn();
    updateMusic();

    requestAnimationFrame(loop);
  }

  /* ===================================================================== */
  /* rendering                                                              */
  /* ===================================================================== */

  function drawScene() {
    drawBackground();

    if (game.phase !== 'battle') {
      // an idle warship bobbing on the open sea behind the menus
      if (shipImgReady) drawShipSprite(W * 0.5, horizonY + 92 + Math.sin(clock * 1.4) * 5, 240, 0);
      else drawWarship(W * 0.5, horizonY + 74 + Math.sin(clock * 1.4) * 5, 1.45, 0);
      return;
    }

    var shaking = shakeMag > 0.2;
    if (shaking) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    }
    drawLanes();
    drawShip();
    drawSmoke();
    drawMuzzles();
    game.enemies.forEach(drawEnemy);
    if (game.missiles) game.missiles.forEach(drawMissile);
    game.shots.forEach(drawShot);
    drawParticles();
    drawExplosions();
    drawFloats();
    if (shaking) ctx.restore();

    // overlays that should not be displaced by the shake
    drawDamageFlash();
    drawLowHpWarning();
    drawCombo();
    drawCallout();
    drawBanner();
  }

  function drawCombo() {
    var mult = game.comboMultiplier();
    if (mult <= 1) return;
    var pulse = 1 + Math.sin(clock * 8) * 0.04;
    ctx.save();
    ctx.translate(W / 2, 96);
    ctx.scale(pulse, pulse);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffc63d';
    ctx.font = '900 22px "Tajawal", Tahoma, sans-serif';
    ctx.fillText('كومبو ×' + mult.toFixed(2).replace(/\.?0+$/, '') + '  (' + game.combo + ')', 0, 0);
    ctx.restore();
    ctx.textAlign = 'start';
  }

  function drawMuzzles() {
    muzzles.forEach(function (mz) {
      var x = shipBowX();
      var y = laneY(mz.lane);
      var a = Math.max(0, mz.life / 0.1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff3b0';
      ctx.shadowColor = '#ffc63d';
      ctx.shadowBlur = 16;
      circle(x, y, 5 + a * 5);
      // quick burst rays
      ctx.strokeStyle = '#ffe9a0';
      ctx.lineWidth = 2;
      for (var k = 0; k < 4; k++) {
        var ang = k * Math.PI / 2 + 0.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * (10 + a * 8), y + Math.sin(ang) * (10 + a * 8));
        ctx.stroke();
      }
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
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#38e1ff';
    ctx.font = '900 44px "Tajawal", Tahoma, sans-serif';
    ctx.fillText(banner.text, 0, 0);
    if (banner.sub) {
      ctx.fillStyle = '#ffc63d';
      ctx.font = '800 22px "Tajawal", Tahoma, sans-serif';
      ctx.fillText('⚔ ' + banner.sub, 0, 34);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  var MOON_X_FRAC = 0.78;

  function drawBackground() {
    var moonX = W * MOON_X_FRAC, moonY = horizonY * 0.42;

    // --- sky ---
    var sky = ctx.createLinearGradient(0, 0, 0, horizonY + 4);
    sky.addColorStop(0, '#070a1e');
    sky.addColorStop(0.55, '#172248');
    sky.addColorStop(1, '#43406e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY + 4);

    // stars
    ctx.fillStyle = '#dbe7ff';
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = (0.35 + 0.65 * Math.abs(Math.sin(clock * 1.5 + st.tw))) * 0.9;
      circle(st.x, st.y, st.r);
    }
    ctx.globalAlpha = 1;

    // moon with soft halo
    var halo = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, 46);
    halo.addColorStop(0, 'rgba(255,247,224,0.55)');
    halo.addColorStop(1, 'rgba(255,247,224,0)');
    ctx.fillStyle = halo; circle(moonX, moonY, 46);
    ctx.fillStyle = '#fdf3d6'; circle(moonX, moonY, 13);

    // drifting clouds
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      var cx = ((cl.x + clock * cl.speed) % (W + 260)) - 130;
      ctx.globalAlpha = cl.alpha;
      ctx.fillStyle = '#1b2548';
      ctx.beginPath();
      ctx.ellipse(cx, cl.y, cl.w, cl.h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // warm glow along the horizon
    var glow = ctx.createLinearGradient(0, horizonY - 46, 0, horizonY + 26);
    glow.addColorStop(0, 'rgba(198,106,58,0)');
    glow.addColorStop(1, 'rgba(214,120,70,0.45)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - 46, W, 72);

    // --- sea ---
    var sea = ctx.createLinearGradient(0, horizonY, 0, H);
    sea.addColorStop(0, '#1b5a72');
    sea.addColorStop(0.22, '#0f4054');
    sea.addColorStop(1, '#04111d');
    ctx.fillStyle = sea;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // moon reflection shimmer on the water
    var refl = ctx.createLinearGradient(0, horizonY, 0, H);
    refl.addColorStop(0, 'rgba(255,239,196,0.5)');
    refl.addColorStop(1, 'rgba(255,239,196,0)');
    ctx.fillStyle = refl;
    for (var ry = horizonY; ry < H; ry += 7) {
      var ww = 5 + Math.sin(ry * 0.25 + clock * 3) * 4;
      ctx.fillRect(moonX - ww, ry, ww * 2, 3);
    }

    // specular wave glints scrolling across the sea
    ctx.strokeStyle = 'rgba(150,220,255,0.10)';
    ctx.lineWidth = 2;
    var rows = 12, step = (H - horizonY) / rows;
    for (var row = 1; row <= rows; row++) {
      var yy = horizonY + row * step;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 16) {
        var off = Math.sin((x + clock * 55) / 42 + row * 0.7) * 3;
        if (x === 0) ctx.moveTo(x, yy + off); else ctx.lineTo(x, yy + off);
      }
      ctx.stroke();
    }

    // vignette to focus the action
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(2,6,15,0)');
    vg.addColorStop(1, 'rgba(2,6,15,0.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSmoke() {
    smoke.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.4;
      ctx.fillStyle = '#9fb0c8';
      circle(p.x, p.y, p.r);
    });
    ctx.globalAlpha = 1;
  }

  function drawLanes() {
    var laneH = (H - padTop - padBottom) / CONFIG.lanes;
    for (var i = 0; i < CONFIG.lanes; i++) {
      var top = padTop + i * laneH;
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.028)';
        ctx.fillRect(0, top, W, laneH);
      }
      ctx.strokeStyle = 'rgba(160,200,255,0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top); ctx.lineTo(W, top);
      ctx.stroke();
    }

    // pulsing defence line the enemies must not cross
    var dx = worldX(CONFIG.enemyReachX);
    var pulse = 0.28 + 0.22 * Math.abs(Math.sin(clock * 3));
    ctx.strokeStyle = 'rgba(255,93,108,' + pulse.toFixed(2) + ')';
    ctx.setLineDash([5, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx, 0); ctx.lineTo(dx, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function shipBowX() { return marginLeft - 4; } // the ship's firing point, just before the line

  function drawShip() {
    var w = 150, cx = shipBowX() - w / 2, cy = shipY();
    if (shipImgReady) { drawShipSprite(cx, cy, w, shipRecoil); return; }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(clock * 1.2) * 0.02); // gentle pitch
    drawWarship(0, 0, 1.3, shipRecoil);
    ctx.restore();
  }

  // Draw the ship sprite mirrored so its bow faces the enemies (to the right).
  function drawShipSprite(cx, cy, w, recoil) {
    var h = w * (shipImg.height / shipImg.width);
    ctx.save();
    ctx.translate(cx - (recoil || 0) * 4, cy);
    ctx.rotate(Math.sin(clock * 1.2) * 0.015);
    ctx.scale(-1, 1);
    ctx.drawImage(shipImg, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // A grey naval destroyer facing right (the bow points toward the enemies).
  // Reused for the player ship and the idle hero ship on the menu.
  function drawWarship(cx, cy, s, recoil) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);

    // churning wake trailing off the stern (left)
    ctx.fillStyle = 'rgba(220,240,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(-44, -5);
    ctx.quadraticCurveTo(-92, -3, -132, -6 + Math.sin(clock * 6) * 2);
    ctx.lineTo(-132, 12);
    ctx.quadraticCurveTo(-92, 16, -44, 15);
    ctx.closePath();
    ctx.fill();

    // hull
    var hull = ctx.createLinearGradient(0, -8, 0, 18);
    hull.addColorStop(0, '#5b6b86');
    hull.addColorStop(0.5, '#39465f');
    hull.addColorStop(1, '#222c40');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(-46, -6);
    ctx.lineTo(34, -6);
    ctx.lineTo(54, 4);          // bow
    ctx.lineTo(34, 16);
    ctx.lineTo(-44, 16);
    ctx.quadraticCurveTo(-54, 5, -46, -6);
    ctx.closePath();
    ctx.fill();

    // deck highlight + waterline foam
    ctx.strokeStyle = '#8aa0c0';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-43, -5); ctx.lineTo(42, -4); ctx.stroke();
    ctx.fillStyle = 'rgba(232,246,255,0.55)';
    ctx.fillRect(-46, 15, 100, 2.4);

    // superstructure + bridge tower
    var sup = ctx.createLinearGradient(0, -30, 0, -6);
    sup.addColorStop(0, '#d2ddef');
    sup.addColorStop(1, '#7c8aa6');
    ctx.fillStyle = sup;
    roundRect(-20, -21, 26, 15, 3); ctx.fill();
    roundRect(-12, -31, 13, 12, 2); ctx.fill();
    ctx.fillStyle = '#0e1b2e';
    ctx.fillRect(-17, -17, 20, 3);   // bridge windows
    ctx.fillRect(-10, -28, 9, 3);

    // funnel
    ctx.fillStyle = '#2c374e';
    roundRect(9, -23, 10, 15, 2); ctx.fill();
    ctx.fillStyle = '#1a2236';
    ctx.fillRect(9, -23, 10, 3);

    // mast + waving flag
    ctx.strokeStyle = '#c3d0e6';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-6, -31); ctx.lineTo(-6, -46); ctx.stroke();
    ctx.fillStyle = '#38e1ff';
    var fl = Math.sin(clock * 8) * 2;
    ctx.beginPath();
    ctx.moveTo(-6, -46); ctx.lineTo(-19, -43 + fl); ctx.lineTo(-6, -39); ctx.closePath();
    ctx.fill();

    // main gun turret near the bow (recoils when firing)
    ctx.save();
    ctx.translate(28 - recoil * 5, -1);
    ctx.fillStyle = '#39465f';
    roundRect(-8, -6, 15, 12, 3); ctx.fill();
    ctx.fillStyle = '#222c40';
    ctx.fillRect(5, -2.4, 20, 4.8);   // barrel
    ctx.restore();

    ctx.restore();
  }

  function drawEnemy(e) {
    var x = worldX(e.x);
    var y = laneY(e.lane);
    var scale = e.kind === 'boss' ? 1.5 : 1;

    // bow wake foam trailing off the stern (enemies move left, so it's on the right)
    if (!e.submerged && e.category !== 'air') {
      var bw = 18 * scale;
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#dff1ff';
      ctx.beginPath();
      ctx.moveTo(x + bw, y - 6 * scale);
      ctx.lineTo(x + bw + 32, y - 2 + Math.sin(clock * 8 + e.lane) * 2);
      ctx.lineTo(x + bw + 32, y + 6);
      ctx.lineTo(x + bw, y + 8 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (e.submerged) ctx.globalAlpha = 0.4;

    if (e.category === 'air') {
      if (e.kind === 'heli') drawHeli(); else drawPlane();
    } else if (e.kind === 'sub') {
      drawHullGradient(-32, -8, 64, 17, 9, '#7c8aa0', '#2b3850');
      ctx.fillStyle = '#39465f'; roundRect(-4, -19, 14, 11, 2); ctx.fill();
      ctx.fillStyle = '#222c40'; ctx.fillRect(3, -26, 2.5, 8);   // periscope
      ctx.fillStyle = '#38e1ff'; circle(-24, 0, 3);              // running light
    } else if (e.kind === 'raft') {
      drawHullGradient(-30, -9, 60, 19, 5, '#9a6233', '#5c3719');
      ctx.strokeStyle = '#3f2611'; ctx.lineWidth = 1;
      for (var px = -22; px <= 22; px += 11) {
        ctx.beginPath(); ctx.moveTo(px, -9); ctx.lineTo(px, 10); ctx.stroke();
      }
      ctx.fillStyle = '#b07b3e'; ctx.fillRect(-8, -20, 18, 11);   // crate
      ctx.strokeStyle = '#3f2611'; ctx.strokeRect(-8, -20, 18, 11);
    } else if (e.kind === 'boss') {
      drawHullGradient(-44, -6, 90, 23, 5, '#566782', '#1c2538');
      ctx.fillStyle = 'rgba(232,246,255,0.5)'; ctx.fillRect(-44, 15, 90, 2.5);
      // pagoda bridge
      ctx.fillStyle = '#cdd8ec';
      roundRect(-6, -26, 16, 18, 2); ctx.fill();
      roundRect(-2, -34, 9, 10, 2); ctx.fill();
      ctx.fillStyle = '#0e1b2e'; ctx.fillRect(-4, -30, 9, 3);
      // funnels
      ctx.fillStyle = '#2c374e';
      roundRect(14, -22, 8, 13, 2); ctx.fill();
      roundRect(24, -20, 7, 11, 2); ctx.fill();
      // twin turrets aiming left
      [-30, -16].forEach(function (tx) {
        ctx.fillStyle = '#39465f'; roundRect(tx - 7, -3, 14, 11, 3); ctx.fill();
        ctx.fillStyle = '#222c40'; ctx.fillRect(tx - 21, 0, 16, 4);
      });
    } else {
      // 'fish' — a fast enemy attack boat
      drawHullBoat('#3ce0a6', '#0c5a45');
      ctx.fillStyle = '#063b2b'; roundRect(-2, -9, 14, 7, 2); ctx.fill();
      ctx.fillStyle = 'rgba(214,255,240,0.85)'; ctx.fillRect(-20, 2, 40, 1.4);
    }

    ctx.globalAlpha = 1;
    ctx.restore();

    if (e.submerged) {
      // dashed ring + bubbles mark an untargetable, submerged submarine
      ctx.strokeStyle = 'rgba(148,163,184,0.55)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(190,230,255,0.5)';
      for (var b = 0; b < 3; b++) {
        var by = y - ((clock * 22 + b * 14) % 34);
        circle(x - 6 + b * 5, by, 1.6 + b * 0.4);
      }
      return; // no health bar while it can't be hit
    }

    // health bar
    var hbw = 50 * scale, hx = x - hbw / 2, hy = y - 24 * scale;
    var pct = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(2,8,20,0.7)';
    roundRect(hx - 1, hy - 1, hbw + 2, 5, 2); ctx.fill();
    ctx.fillStyle = e.kind === 'boss' ? '#ff7a3d' : (pct > 0.5 ? '#46e39a' : '#ffd45c');
    ctx.fillRect(hx, hy, hbw * pct, 3);
  }

  // filled rounded hull with a vertical two-stop gradient
  function drawHullGradient(x, y, w, h, r, top, bottom) {
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    roundRect(x, y, w, h, r); ctx.fill();
  }

  // sleek speedboat hull (bow pointing left)
  function drawHullBoat(top, bottom) {
    var g = ctx.createLinearGradient(0, -8, 0, 9);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-28, 1);
    ctx.lineTo(10, -8);
    ctx.lineTo(26, -4);
    ctx.lineTo(26, 6);
    ctx.lineTo(10, 9);
    ctx.closePath();
    ctx.fill();
  }

  // enemy jet, nose to the left, with an afterburner flame at the tail
  function drawPlane() {
    ctx.fillStyle = '#9fb3cf';
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(8, -4); ctx.lineTo(20, -3); ctx.lineTo(20, 3); ctx.lineTo(8, 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6f86a8';
    ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(22, -15); ctx.lineTo(11, -2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(22, 15); ctx.lineTo(11, 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(17, -2); ctx.lineTo(26, -11); ctx.lineTo(23, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#37506e'; circle(-12, -1, 2.6);
    var fl = 6 + Math.sin(clock * 30) * 2;
    ctx.fillStyle = 'rgba(255,150,60,0.9)';
    ctx.beginPath(); ctx.moveTo(20, -2); ctx.lineTo(20 + fl, 0); ctx.lineTo(20, 2); ctx.closePath(); ctx.fill();
  }

  // enemy helicopter with a spinning main rotor
  function drawHeli() {
    ctx.fillStyle = '#5b6b86';
    roundRect(-18, -6, 30, 13, 6); ctx.fill();
    ctx.fillStyle = '#9fd0ff'; circle(-13, -1, 4);
    ctx.strokeStyle = '#3a465e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(30, -3); ctx.stroke();
    ctx.fillStyle = '#2c374e'; ctx.fillRect(28, -7, 2.5, 9);   // tail rotor
    ctx.strokeStyle = '#2c374e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-14, 9); ctx.lineTo(6, 9); ctx.stroke(); // skid
    var rw = 26 * Math.cos(clock * 40);
    ctx.strokeStyle = 'rgba(220,235,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-4 - rw, -12); ctx.lineTo(-4 + rw, -12); ctx.stroke();
    ctx.fillStyle = '#2c374e'; ctx.fillRect(-6, -13, 4, 4);
  }

  function drawShot(s) {
    var x = worldX(s.x), y = laneY(s.lane), k = s.kind;
    if (k === 'rocket') {                          // anti-helicopter rocket (red)
      var tr = ctx.createLinearGradient(x - 22, y, x, y);
      tr.addColorStop(0, 'rgba(255,120,80,0)'); tr.addColorStop(1, 'rgba(255,170,120,0.9)');
      ctx.fillStyle = tr; ctx.fillRect(x - 22, y - 1.5, 22, 3);
      ctx.fillStyle = '#ff6a3d'; ctx.shadowColor = '#ff6a3d'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x - 4, y - 3); ctx.lineTo(x - 4, y + 3); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; return;
    }
    var air = (k === 'flak' || k === 'intercept'); // cyan anti-air munitions
    var trail = ctx.createLinearGradient(x - 24, y, x, y);
    trail.addColorStop(0, air ? 'rgba(56,225,255,0)' : 'rgba(255,209,102,0)');
    trail.addColorStop(1, air ? 'rgba(160,240,255,0.9)' : 'rgba(255,233,160,0.9)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(x - 24, y - 1.5); ctx.lineTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.lineTo(x - 24, y + 1.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = air ? '#dffaff' : '#fff6d0';
    ctx.shadowColor = air ? '#38e1ff' : '#ffc63d';
    ctx.shadowBlur = 12;
    circle(x, y, k === 'flak' ? 3.5 : 4.5);
    ctx.shadowBlur = 0;
  }

  // war-mode enemy missile: a warhead flying left with a flame trail
  function drawMissile(m) {
    var x = worldX(m.x), y = laneY(m.lane);
    if (m.kind === 'shell') {
      var st = ctx.createLinearGradient(x, y, x + 16, y);
      st.addColorStop(0, 'rgba(255,90,70,0.9)'); st.addColorStop(1, 'rgba(255,90,70,0)');
      ctx.fillStyle = st; ctx.fillRect(x, y - 1.4, 16, 2.8);
      ctx.fillStyle = '#ffd0b0'; ctx.shadowColor = '#ff5a46'; ctx.shadowBlur = 8;
      circle(x, y, 3); ctx.shadowBlur = 0;
      return;
    }
    var tr = ctx.createLinearGradient(x, y, x + 22, y);
    tr.addColorStop(0, 'rgba(255,120,60,0.9)');
    tr.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = tr;
    ctx.beginPath();
    ctx.moveTo(x, y - 2); ctx.lineTo(x + 22, y - 1); ctx.lineTo(x + 22, y + 1); ctx.lineTo(x, y + 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe0b0';
    ctx.shadowColor = '#ff5d3a'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x - 7, y); ctx.lineTo(x + 3, y - 3.2); ctx.lineTo(x + 3, y + 3.2);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // expanding shockwave + fireball shown wherever something hits the ship
  function drawExplosions() {
    explosions.forEach(function (e) {
      var f = Math.max(0, e.life / e.maxLife);
      var r = e.r + (e.max - e.r) * (1 - f);
      ctx.globalAlpha = f;
      ctx.strokeStyle = '#ffd9a0';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,140,60,' + (f * 0.6).toFixed(2) + ')';
      circle(e.x, e.y, r * 0.5);
    });
    ctx.globalAlpha = 1;
  }

  /* ---- effects (visual only) ------------------------------------------ */

  function spawnEffects(events) {
    events.hits.forEach(function (hit) {
      var x = worldX(hit.x);
      var y = laneY(hit.lane);
      var crit = hit.crit;
      var n = crit ? 9 : 4;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, sp = crit ? 110 : 60;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: crit ? 0.35 : 0.25, max: crit ? 0.35 : 0.25,
          size: (crit ? 2 : 1.5) + Math.random() * 1.5, color: crit ? '#ffd45c' : '#fff7cc',
        });
      }
      if (hit.dmg != null && !hit.intercept) {
        floats.push({ x: x, y: y - 14, vy: -38, life: 0.7,
          text: (crit ? 'حرِج ' : '') + hit.dmg, color: crit ? '#ffd45c' : '#dfeaff', size: crit ? 18 : 12 });
      }
      if (crit) { Sound.play('crit'); setShake(4); }
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
      floats.push({ x: x, y: y - 18, vy: -42, life: 1.0, text: '+' + kill.reward, color: '#ffd45c', size: 16 });
      Sound.play(boss ? 'boss' : 'kill');
      if (boss) setShake(12);
      else if (kill.crit) setShake(4);
    });

    events.leaks.forEach(function (leak) {
      damageFlash = 1;
      setShake(9);
      Sound.play('damage');
      vibrate(45);
      var y = laneY(leak.lane);
      var x = shipBowX();
      // a clear impact blast on the hull — contact / shells / missiles
      explosions.push({ x: x, y: y, r: 6, max: 36, life: 0.34, maxLife: 0.34 });
      for (var i = 0; i < 16; i++) {
        var ang = Math.random() * Math.PI * 2;
        var spd = 50 + Math.random() * 190;
        particles.push({
          x: x, y: y,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: 0.5, max: 0.5, size: 1.5 + Math.random() * 2.5,
          color: Math.random() < 0.5 ? '#ff7a3d' : '#ffd45c',
        });
      }
    });

    // normal-mode enemy shells: a muzzle flash at the firing enemy
    events.efires.forEach(function (fr) {
      var ex = worldX(fr.x), ey = laneY(fr.lane);
      for (var i = 0; i < 4; i++) {
        var a = Math.PI + (Math.random() - 0.5) * 1.2;
        particles.push({ x: ex, y: ey, vx: Math.cos(a) * 60, vy: Math.sin(a) * 40,
          life: 0.2, max: 0.2, size: 1.3 + Math.random() * 1.3, color: '#ff8a5a' });
      }
    });
    if (events.efires.length) Sound.play('shoot');

    // war-mode missile launches: a muzzle flash at the firing ship
    events.fires.forEach(function (fr) {
      var fx = worldX(fr.x), fy = laneY(fr.lane);
      for (var i = 0; i < 5; i++) {
        var a = Math.random() * Math.PI * 2;
        particles.push({ x: fx, y: fy, vx: Math.cos(a) * 55, vy: Math.sin(a) * 55,
          life: 0.2, max: 0.2, size: 1.5 + Math.random() * 1.5, color: '#ffd9a0' });
      }
    });
    if (events.fires.length) Sound.play('shoot');
  }

  var COMBO_CALLS = { 5: 'كومبو!', 10: 'اكتساح!', 15: 'مدمّر!', 20: 'لا يُوقَف!' };
  function updateHype() {
    var c = game.combo;
    if (c > lastCombo && (COMBO_CALLS[c] || (c > 20 && c % 10 === 0))) {
      callout = { text: COMBO_CALLS[c] || ('سحق! ×' + c), life: 0.9, color: '#ffd45c', size: c >= 15 ? 36 : 28 };
      Sound.play('upgrade');
    }
    lastCombo = c;
    var hasBoss = false;
    for (var i = 0; i < game.enemies.length; i++) if (game.enemies[i].kind === 'boss') { hasBoss = true; break; }
    if (hasBoss && !bossWarned) {
      bossWarned = true;
      callout = { text: '⚠ الزعيم القادم', life: 1.4, color: '#ff5d6c', size: 34 };
      setShake(8); Sound.play('boss');
    } else if (!hasBoss) {
      bossWarned = false;
    }
  }

  function drawCallout() {
    if (!callout) return;
    var t = callout.life, a = Math.min(1, t * 2.2), sc = 1 + Math.max(0, 1 - t) * 0.3;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H * 0.44);
    ctx.scale(sc, sc);
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 14;
    ctx.fillStyle = callout.color || '#ffd45c';
    ctx.font = '900 ' + (callout.size || 30) + 'px "Tajawal", Tahoma, sans-serif';
    ctx.fillText(callout.text, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1; ctx.textAlign = 'start';
  }

  // Ship layout helpers (kept in one place so smoke / muzzle line up with art)
  function shipX() { return marginLeft - 12; }
  function shipY() { return H / 2 + Math.sin(clock * 1.6) * 4; }

  function emitSmoke(dt) {
    if (shipImgReady) return; // the sci-fi sprite has no coal funnel
    smokeTimer -= dt;
    if (smokeTimer > 0) return;
    smokeTimer = 0.22;
    smoke.push({
      x: shipX() + 16 + (Math.random() - 0.5) * 3,
      y: shipY() - 30,
      vx: 10 + Math.random() * 8,
      vy: -16 - Math.random() * 8,
      r: 4 + Math.random() * 3,
      life: 1.1, max: 1.1,
    });
  }

  function updateEffects(dt) {
    damageFlash = Math.max(0, damageFlash - dt * 2);
    shakeMag = Math.max(0, shakeMag - dt * 40);
    shipRecoil = Math.max(0, shipRecoil - dt * 6);
    for (var ex = explosions.length - 1; ex >= 0; ex--) {
      explosions[ex].life -= dt;
      if (explosions[ex].life <= 0) explosions.splice(ex, 1);
    }
    if (game.missiles && game.missiles.length) {
      for (var mq = 0; mq < game.missiles.length; mq++) {
        if (Math.random() < 0.6) {
          var mm = game.missiles[mq];
          smoke.push({ x: worldX(mm.x) + 8, y: laneY(mm.lane), vx: 16 + Math.random() * 10,
            vy: (Math.random() - 0.5) * 8, r: 2 + Math.random() * 2, life: 0.5, max: 0.5 });
        }
      }
    }
    for (var s = smoke.length - 1; s >= 0; s--) {
      var pf = smoke[s];
      pf.x += pf.vx * dt; pf.y += pf.vy * dt; pf.r += 9 * dt; pf.life -= dt;
      if (pf.life <= 0) smoke.splice(s, 1);
    }
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
    if (callout) { callout.life -= dt; if (callout.life <= 0) callout = null; }
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
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    floats.forEach(function (f) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.fillStyle = f.color || '#ffd45c';
      ctx.font = '900 ' + (f.size || 16) + 'px "Tajawal", Tahoma, sans-serif';
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.shadowBlur = 0;
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
    var hpPct = game.maxHp ? Math.max(0, game.hp) / game.maxHp : 0;
    document.getElementById('hp-fill').style.width = (hpPct * 100) + '%';
    document.getElementById('hp-val').textContent = Math.max(0, Math.round(game.hp)) + '/' + game.maxHp;
    document.querySelector('.bar-hp').classList.toggle('low', hpPct < 0.3);

    var enPct = game.maxEnergy ? game.energy / game.maxEnergy : 0;
    document.getElementById('energy-fill').style.width = (enPct * 100) + '%';
    document.getElementById('energy-val').textContent = Math.floor(game.energy) + '/' + game.maxEnergy;

    document.getElementById('gold-val').textContent = game.gold;
    document.getElementById('wave-val').textContent = game.wave;
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
      if (phase === 'menu') { menuView = 'home'; renderMenu(); }
      if (phase === 'prep') renderPrep();
      if (phase === 'battle') banner = { text: 'الموجة ' + game.wave, sub: (game.challenge && game.challenge.id !== 'standard') ? game.challenge.name : '', life: 2.0 };
      if (phase === 'result') { renderResult(); Sound.play(game.lastWin ? 'win' : 'lose'); }
    }
  }

  function show(el, visible) { el.classList.toggle('hide', !visible); }

  function renderMenu() {
    var body = document.getElementById('menu-body');
    if (menuView === 'modes') renderMenuModes(body);
    else if (menuView === 'shop') renderMenuShop(body);
    else renderMenuHome(body);
  }

  function renderMenuHome(body) {
    var c = game.career, m = game.meta, saved = game.savedInfo();
    var html = '<p class="subtitle">ابنِ سفينتك، ثم صُدّ موجات البحر. رقِّ الغرف بين الموجات لتصمد أطول.</p>';
    html += '<div class="menu-actions">';
    if (saved) {
      html += '<button class="cta cta-primary" id="btn-continue">▶ <span>أكمل</span>' +
              '<small>الموجة ' + saved.wave + ' — ' + CONFIG.modes[saved.mode].label + '</small></button>';
      html += '<button class="cta cta-second" id="btn-newgame">＋ لعبة جديدة</button>';
    } else {
      html += '<button class="cta cta-primary" id="btn-newgame">▶ <span>ابدأ اللعب</span></button>';
    }
    html += '<button class="cta cta-shop" id="btn-shop"><span>🎖️ الترقيات الدائمة</span><b>' + m.medals + '</b></button>';
    html += '</div>';
    html += '<div class="stat-strip">' +
      '<div><span>🏆</span><b>' + game.best + '</b><small>أفضل موجة</small></div>' +
      '<div><span>⚔️</span><b>' + c.runs + '</b><small>محاولات</small></div>' +
      '<div><span>💥</span><b>' + c.kills + '</b><small>سفن مدمرة</small></div>' +
      '<div><span>🎖️</span><b>' + m.medals + '</b><small>أوسمة</small></div>' +
    '</div>';
    body.innerHTML = html;
    var cont = document.getElementById('btn-continue');
    if (cont) cont.addEventListener('click', function () { if (game.continueSavedRun()) Sound.play('start'); });
    document.getElementById('btn-newgame').addEventListener('click', function () { menuView = 'modes'; renderMenu(); });
    document.getElementById('btn-shop').addEventListener('click', function () { menuView = 'shop'; renderMenu(); });
  }

  function renderMenuModes(body) {
    var html = '<div class="view-head"><button class="back-btn" id="btn-back">‹ رجوع</button>' +
               '<h2>اختر الطور</h2></div><div class="modes" id="menu-modes">';
    Object.keys(CONFIG.modes).forEach(function (key) {
      var info = MODE_INFO[key] || { hint: '', ico: '🚢' };
      html += '<button class="mode-btn" data-mode="' + key + '">' +
        '<span class="m-ico">' + info.ico + '</span>' +
        '<span class="m-txt">' + CONFIG.modes[key].label + '<small>' + info.hint + '</small></span></button>';
    });
    html += '</div>';
    body.innerHTML = html;
    document.getElementById('btn-back').addEventListener('click', function () { menuView = 'home'; renderMenu(); });
    body.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { Sound.play('start'); game.startRun(btn.dataset.mode); });
    });
  }

  function renderMenuShop(body) {
    var m = game.meta;
    var html = '<div class="view-head"><button class="back-btn" id="btn-back">‹ رجوع</button>' +
               '<h2>الترقيات الدائمة</h2></div>';
    html += '<div class="medal-bal">🎖️ أوسمتك: <b>' + m.medals + '</b></div>';
    html += '<p class="shop-hint">تكسب الأوسمة كل موجة وتبقى معك للأبد — تقوّي كل جولة جديدة.</p>';
    html += '<div class="meta-list">';
    META.forEach(function (r, i) {
      var cost = game.metaCost(i), afford = game.canBuyMeta(i);
      html += '<div class="meta-item"><div class="r-ico">' + (META_ICONS[i] || '⭐') + '</div>' +
        '<div class="meta-txt"><h3>' + r.name + ' <em>Lv ' + m.levels[i] + '</em></h3>' +
        '<div class="desc">' + r.desc + '</div></div>' +
        '<button class="meta-buy" data-i="' + i + '"' + (afford ? '' : ' disabled') + '>🎖️ ' + cost + '</button></div>';
    });
    html += '</div>';
    body.innerHTML = html;
    document.getElementById('btn-back').addEventListener('click', function () { menuView = 'home'; renderMenu(); });
    body.querySelectorAll('.meta-buy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (game.buyMeta(parseInt(btn.dataset.i, 10))) { Sound.play('upgrade'); renderMenu(); }
      });
    });
  }

  function renderPrep() {
    var body = document.getElementById('prep-body');
    var html = '' +
      '<div class="prep-head">' +
        '<button class="back-btn" id="prep-back">‹ القائمة</button>' +
        '<div class="title">التجهيز</div>' +
        '<div class="wave-badge">الموجة ' + (game.wave + 1) + '</div>' +
      '</div>' +
      '<div class="gold-line">🪙 الذهب: <b>' + game.gold + '</b></div>' +
      '<div class="rooms">';
    var cap = game.roomMaxLevel();
    for (var i = 0; i < ROOMS.length; i++) {
      var r = ROOMS[i];
      var maxed = game.levels[i] >= cap;
      var afford = game.canUpgrade(i);
      var label = maxed ? 'أقصى مستوى' : ('🪙 ' + game.upgradeCost(i));
      var pct = Math.round((game.levels[i] / cap) * 100);
      var pips =
        '<div class="lvbar"><div class="lvbar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="lvnum">المستوى ' + game.levels[i] + ' / ' + cap + '</div>';
      html +=
        '<div class="room' + (maxed ? ' maxed' : '') + '">' +
          '<div class="r-top"><div class="r-ico">' + (ROOM_ICONS[i] || '🔧') + '</div>' +
            '<h3>' + r.name + '</h3></div>' +
          '<div class="desc">' + r.desc + '</div>' +
          pips +
          '<button class="buy" data-room="' + i + '"' + (afford ? '' : ' disabled') + '>' + label + '</button>' +
        '</div>';
    }
    html += '</div><button class="start" id="prep-start">⚔️ ابدأ الموجة</button>';
    body.innerHTML = html;

    body.querySelectorAll('.buy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (game.buyUpgrade(parseInt(btn.dataset.room, 10))) {
          Sound.play('upgrade');
          renderPrep();
        }
      });
    });
    document.getElementById('prep-back').addEventListener('click', function () { game.toMenu(); });
    document.getElementById('prep-start').addEventListener('click', startWave);
  }

  function renderResult() {
    var body = document.getElementById('result-body');
    var win = game.lastWin;
    body.innerHTML = '' +
      '<div class="result-card">' +
        '<div class="result-emoji">' + (win ? '🎉' : '🌊') + '</div>' +
        '<div class="result-title ' + (win ? 'win' : 'lose') + '">' +
          (win ? 'تم صد الموجة' : 'غرقت السفينة') + '</div>' +
        (game.perfectWave ? '<div style="color:#ffd45c;font-weight:900;margin-top:6px;font-size:16px">⭐ موجة مثالية! مكافأة إضافية</div>' : '') +
        '<div class="result-stats">' +
          '<div class="rs"><span>🌊 الموجة</span><b>' + game.wave + '</b></div>' +
          '<div class="rs"><span>💥 أعداء مُدمَّرة</span><b>' + game.kills + '</b></div>' +
          '<div class="rs"><span>🪙 ذهب مكتسب</span><b>' + game.earned + '</b></div>' +
          '<div class="rs"><span>🏆 أفضل موجة</span><b>' + game.best + '</b></div>' +
          '<div class="rs"><span>🎖️ أوسمة هذه الجولة</span><b>' + (game.medalsRun || 0) + '</b></div>' +
        '</div>' +
        '<button class="start" id="result-go">' + (win ? '⚓ متابعة' : '🏠 القائمة') + '</button>' +
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
