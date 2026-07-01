# Sea Tycoon Defense

لعبة دفاع بحرية بمسارات: ابنِ سفينتك في مرحلة التجهيز، ثم صُدّ موجات الأعداء. رقِّ الغرف بين الموجات لتصمد أطول.

A lane-based naval defense game. Build your ship in the prep phase, then survive waves of enemies. Upgrade ship rooms between waves to last longer.

**▶️ Play:** open `index.html` in any browser (it's a static site; GitHub Pages serves it directly).

---

## How to play

- **5 lanes, sea & sky.** Lower lanes are the **sea** (enemy ships: fast boats,
  tanky rafts, diving submarines, and battleship bosses); upper lanes are the
  **sky** (**planes** and **helicopters**). Tapping a lane auto-fires the right
  munition for the target there (cannon / flak / rocket). Tougher types unlock
  as you progress, and a boss appears every third wave.
- **Combo:** consecutive kills without letting an enemy through raise a gold
  multiplier (up to ×2). A single leak resets it — clean play pays off.
- **Fire** by tapping a lane button `1`–`5`, or tapping that lane on the playfield. Each shot costs **energy**, which refills over time.
- **Abilities** (each on its own cooldown):
  - موجة `Q` — fire every lane at once
  - إصلاح `W` — repair 25% of ship armor
  - سرعة `E` — overdrive: faster, stronger shots
  - تجميد `R` — freeze all enemies briefly
- Clear a wave to earn gold, then spend it in **التجهيز (prep)** on 8 upgradeable rooms. Survive as long as you can; your best wave is saved.
- **Modes:** عادي (normal), سريع (faster + double gold), الحرب (War — ships halt and bombard you with missiles you must shoot down).

Desktop keys: `1`–`5` fire, `Q/W/E/R` abilities, `P`/`Esc` pause, `Enter` start/continue.

## Project structure (web build — the maintained version)

| File | Responsibility |
|------|----------------|
| `index.html` | Markup + screen containers |
| `style.css`  | All styling (mobile-first, RTL) |
| `game.js`    | **Pure game model** — rules, economy, simulation. No DOM, fully unit-testable. |
| `main.js`    | Browser layer — canvas rendering, input, HUD/overlays, effects, game loop |
| `tests/game.test.js` | Headless tests for the model |

The game logic in `game.js` is deliberately separated from rendering so it can be
tested in Node and reasoned about in isolation. All balance constants live in the
`CONFIG` object at the top of that file.

> The repository also contains earlier prototypes — `sea_tycoon_defense.py`
> (Pygame desktop) and `godot-csharp/` (Godot C# port). The browser build above
> is the primary, maintained version.

## Development

No build step and no runtime dependencies — it's plain HTML/CSS/JS.

```bash
# run the model tests
node tests/game.test.js     # or: npm test

# serve locally (any static server works)
python3 -m http.server 8000
# then open http://localhost:8000
```

## What changed in this rewrite

The previous web build was minified into a few unreadable lines and had real
bugs. This version is a clean rewrite that fixes them:

- **Fixed the broken progression loop.** Clearing a wave now goes to a result
  screen and back to prep with gold and upgrades preserved — previously it
  dumped you to the menu and reset everything, so only wave 1 was ever playable.
- **Abilities now have cooldowns** (with on-button countdowns) instead of being
  infinitely spammable.
- **All 8 upgrade rooms now have real, described effects** — three of them
  (Shield, Radar, Crew) did nothing before.
- **Energy regenerates** during a wave, so later/bigger waves stay playable.
- Added persistence (best wave), a pause screen, and lots of game feel:
  synthesized sound effects with a mute toggle (no audio files — generated at
  runtime), screen shake, muzzle flashes, hit sparks, floating gold, a
  wave-intro banner, a low-HP warning, and haptics on mobile.
- Split the minified blob into readable, maintainable files with tests
  (model unit tests + a Playwright-driven end-to-end run).
- Added depth: mechanically distinct enemy types (incl. diving submarines),
  difficulty-gated wave composition, a kill-combo gold multiplier, and
  persistent career stats (runs / kills / total gold) shown on the menu.
- **Full visual overhaul.** Replaced the flat look with an animated moonlit
  dusk sea (stars, drifting clouds, moon reflection, wave glints, vignette), a
  detailed naval warship (bridge, funnel smoke, recoiling gun, waving flag,
  wake) in place of the old sailboat, distinct enemy vessels with bow wakes,
  glowing tracer fire, a game-style HUD (HP/energy bars + gold/wave pills), and
  frosted-glass menus with icons, level pips, and entrance animations
  (Tajawal webfont with a local fallback).
- **Save & resume.** The active run (wave, gold, upgrades, mode) is persisted to
  localStorage, so closing the browser/phone and reopening offers a **Continue**
  at the start of your current wave — progress and attempts are no longer lost.
- **Endless progression.** Room upgrades now go to level 10, and a permanent
  **medals** meta-shop (earned every wave, never reset) keeps making each new
  run stronger — so maxing out the rooms is no longer a dead end.
- **Menu hub.** A redesigned home screen: Continue / New game, mode select, the
  permanent meta-shop, and a lifetime-stats strip.
- **In-app back everywhere + back-button guard.** Prep/menus have explicit back
  buttons, and the phone/browser back button navigates within the game (pause /
  return to menu) instead of accidentally leaving the page.
- **Consistent impact explosions.** Enemies — and War-mode missiles — detonate
  with a shockwave + fireball burst on contact, identically in every mode.
- **"War" mode** (the former endless mode): enemy ships stop mid-field and fire
  missiles; toggle between the **cannon** (destroy ships) and the **interceptor**
  (shoot the missiles down).
- **New flagship + air/sea realism.** The player ship is a detailed battleship
  sprite; enemies now match their lane — ships in the sea, planes & helicopters
  in the sky — each with its own auto-matched munition.
- **Mode-specific contact.** Normal mode: enemies **siege** the ship and grind HP
  bit by bit (damage varies by enemy type) until destroyed. Fast mode: they
  **explode** on contact. War mode: they bombard from range.
- **Per-wave challenges** (سرب / غارة جوية / مدّ سريع / أسطول) shown on the wave
  banner, and **procedural battle + boss music**.
- **Combat refinements + hype.** The flagship sits just before the firing line
  and shells emanate from it; in Normal mode enemies stop in front of the line
  and **fire at the hull**. Added critical hits with floating damage numbers,
  combo / boss call-outs, a no-damage **perfect-wave** bonus, and a richer
  **layered soundtrack** (warm chord pads + bass + groove + reverb, distinct
  boss theme) — well beyond the old chiptune.
