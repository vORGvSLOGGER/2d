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

  /* ---- procedural background music (battle + boss themes) ---------------- */
  var mus = { timer: null, step: 0, theme: null, gain: null };

  function mnote(freq, dur, type, vol) {
    if (!enabled || !ctx || !mus.gain) return;
    try {
      var t = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(mus.gain);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  function musicStep() {
    if (!ctx) return;
    var st = mus.step & 15;
    if (enabled) {
      if (mus.theme === 'boss') {
        // relentless low drone + tense A-D-E-D arpeggio + downbeat hits
        mnote(55, 0.16, 'sawtooth', 0.16);
        if (st % 2 === 0) mnote(110, 0.12, 'square', 0.05);
        mnote([440, 587.33, 659.25, 587.33][st % 4], 0.10, 'triangle', 0.05);
        if (st === 0 || st === 6 || st === 10) mnote(880, 0.18, 'sine', 0.045);
        if (st % 4 === 0) noise(0.06, 0.05, 1800);
      } else {
        // driving naval groove: roots A A F G + gentle A-C-E arpeggio
        if (st % 4 === 0) mnote([110, 110, 87.31, 98][(st / 4) & 3], 0.34, 'sawtooth', 0.10);
        mnote([440, 523.25, 659.25, 523.25][st % 4], 0.12, 'triangle', 0.042);
        if (st === 0 || st === 8) mnote(880, 0.16, 'sine', 0.038);
      }
    }
    mus.step = (mus.step + 1) & 15;
  }

  function stopMusic() {
    if (mus.timer) { try { clearInterval(mus.timer); } catch (e) {} mus.timer = null; }
  }

  function startMusic(theme) {
    if (!ctx) return;                 // inert without audio (e.g. Node tests)
    stopMusic();
    if (!mus.gain) { mus.gain = ctx.createGain(); mus.gain.gain.value = 0.34; mus.gain.connect(master); }
    mus.theme = theme; mus.step = 0;
    var bpm = theme === 'boss' ? 166 : 138;
    try { mus.timer = setInterval(musicStep, 60000 / bpm / 2); } catch (e) {}
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
