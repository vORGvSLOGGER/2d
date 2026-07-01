/*
 * Sea Tycoon Defense - sound
 * --------------------------------------------------------------------------
 * All effects are synthesized at runtime with the WebAudio API, so the game
 * ships with zero audio asset files and stays a single static deploy.
 * Everything is wrapped in try/catch: if audio is unavailable the game is
 * completely unaffected.
 */
var Sound = (function () {
  var ctx = null;
  var master = null;
  var enabled = true;

  function init() {
    if (ctx) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  // Browsers start the audio context suspended until a user gesture.
  function resume() {
    try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) {}
  }

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }

  // A single decaying oscillator "blip", optionally sliding in pitch.
  function blip(freq, dur, type, vol, slideTo) {
    if (!enabled || !ctx) return;
    try {
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  // Filtered white-noise burst (explosions / splashes).
  function noise(dur, vol, cutoff) {
    if (!enabled || !ctx) return;
    try {
      var t = ctx.currentTime;
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1100;
      var g = ctx.createGain(); g.gain.value = vol || 0.25;
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur);
    } catch (e) {}
  }

  function later(ms, fn) { setTimeout(fn, ms); }

  /* ---- procedural background music (layered chords + groove + reverb) ---- */
  var mus = { timer: null, step: 0, theme: null, gain: null, stepDur: 0.3 };

  // A-minor chord progressions: bass root (Hz) + pad chord tones.
  var BATTLE_PROG = [
    { root: 110.00, pad: [220.00, 261.63, 329.63] }, // Am
    { root: 87.31,  pad: [174.61, 220.00, 261.63] }, // F
    { root: 130.81, pad: [261.63, 329.63, 392.00] }, // C
    { root: 98.00,  pad: [196.00, 246.94, 293.66] }, // G
  ];
  var BOSS_PROG = [
    { root: 110.00, pad: [220.00, 261.63, 329.63] }, // Am
    { root: 110.00, pad: [220.00, 261.63, 329.63] }, // Am
    { root: 146.83, pad: [293.66, 349.23, 440.00] }, // Dm
    { root: 164.81, pad: [329.63, 415.30, 493.88] }, // E
  ];

  // Build the music bus once: lowpass + a feedback-delay "reverb" for space.
  function musicBus() {
    if (mus.gain) return mus.gain;
    mus.gain = ctx.createGain(); mus.gain.gain.value = 0.5;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.5;
    mus.gain.connect(lp);
    var dl = ctx.createDelay(1.0); dl.delayTime.value = 0.27;
    var fb = ctx.createGain(); fb.gain.value = 0.34;
    var wet = ctx.createGain(); wet.gain.value = 0.25;
    lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet);
    lp.connect(master); wet.connect(master);
    return mus.gain;
  }

  // one enveloped oscillator voice into the music bus
  function voice(freq, t, dur, type, vol, detune) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    var atk = Math.min(0.14, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(mus.gain);
    o.start(t); o.stop(t + dur + 0.03);
  }

  function chord(freqs, t, dur, vol) {
    for (var i = 0; i < freqs.length; i++) {
      voice(freqs[i], t, dur, 'triangle', vol, -7);       // detuned pair = warmth
      voice(freqs[i], t, dur, 'triangle', vol * 0.7, 7);
    }
  }

  function kick(t) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g); g.connect(mus.gain); o.start(t); o.stop(t + 0.2);
  }

  function hat(t, vol) {
    var len = Math.floor(ctx.sampleRate * 0.03);
    var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = b;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    var g = ctx.createGain(); g.gain.value = vol;
    src.connect(hp); hp.connect(g); g.connect(mus.gain);
    src.start(t); src.stop(t + 0.04);
  }

  function musicStep() {
    if (!ctx || !enabled) { mus.step = (mus.step + 1) % 32; return; }
    var t = ctx.currentTime + 0.03;
    var boss = mus.theme === 'boss';
    var prog = boss ? BOSS_PROG : BATTLE_PROG;
    var sd = mus.stepDur, bar = Math.floor(mus.step / 8) % prog.length, st = mus.step % 8;
    var ch = prog[bar];
    if (st === 0) chord(ch.pad, t, sd * 8 * 0.96, boss ? 0.05 : 0.055); // sustained pad per bar
    var bf = (st % 2 === 0) ? ch.root : ch.root * 1.4983;               // root / fifth bass
    voice(bf / 2, t, sd * 0.92, boss ? 'sawtooth' : 'triangle', boss ? 0.16 : 0.12, 0);
    voice(ch.pad[st % ch.pad.length] * 2, t, sd * 0.8, 'triangle', boss ? 0.05 : 0.045, boss ? (st % 2 ? 9 : -9) : 0);
    if (st === 0 || st === 4) voice(ch.pad[2] * 2, t, sd * 1.4, 'sine', 0.05); // lead accents
    if (st % 4 === 0) kick(t);
    if (boss && st % 2 === 1) kick(t);
    hat(t, st % 2 ? (boss ? 0.14 : 0.10) : 0.045);
    mus.step = (mus.step + 1) % 32;
  }

  function stopMusic() {
    if (mus.timer) { try { clearInterval(mus.timer); } catch (e) {} mus.timer = null; }
  }

  function startMusic(theme) {
    if (!ctx) return;                 // inert without audio (e.g. Node tests)
    stopMusic();
    musicBus();
    mus.theme = theme; mus.step = 0;
    var bpm = theme === 'boss' ? 128 : 104;
    mus.stepDur = 60 / bpm / 2;        // eighth notes
    try { mus.timer = setInterval(musicStep, mus.stepDur * 1000); } catch (e) {}
  }

  // Public: Sound.music('battle' | 'boss' | 'stop').
  function music(theme) {
    if (theme === 'stop') stopMusic();
    else startMusic(theme);
  }

  var sfx = {
    shoot:   function () { blip(680, 0.07, 'square', 0.10, 1020); },
    hit:     function () { blip(300, 0.05, 'square', 0.09, 200); },
    kill:    function () { blip(520, 0.12, 'triangle', 0.16, 170); noise(0.08, 0.10); },
    crit:    function () { blip(940, 0.06, 'square', 0.13, 1500); noise(0.04, 0.07, 2400); },
    boss:    function () { blip(150, 0.40, 'sawtooth', 0.22, 60); noise(0.35, 0.20, 700); },
    damage:  function () { blip(170, 0.18, 'sawtooth', 0.20, 70); },
    ability: function () { blip(880, 0.18, 'sine', 0.16, 440); },
    upgrade: function () { blip(720, 0.10, 'square', 0.14, 1080); },
    start:   function () { blip(440, 0.08, 'square', 0.12, 660); },
    win:     function () { blip(523, 0.12, 'triangle', 0.18); later(120, function () { blip(659, 0.12, 'triangle', 0.18); }); later(240, function () { blip(784, 0.22, 'triangle', 0.18); }); },
    lose:    function () { blip(320, 0.30, 'sawtooth', 0.20, 90); later(160, function () { blip(170, 0.45, 'sawtooth', 0.18, 60); }); },
  };

  function play(name) { if (sfx[name]) sfx[name](); }

  return {
    init: init, resume: resume,
    setEnabled: setEnabled, isEnabled: isEnabled,
    play: play, music: music,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
