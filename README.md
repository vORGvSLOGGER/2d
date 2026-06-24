# Sea Tycoon Defense

لعبة دفاع بحرية بمسارات: ابنِ سفينتك في مرحلة التجهيز، ثم صُدّ موجات الأعداء. رقِّ الغرف بين الموجات لتصمد أطول.

A lane-based naval defense game. Build your ship in the prep phase, then survive waves of enemies. Upgrade ship rooms between waves to last longer.

**▶️ Play:** open `index.html` in any browser (it's a static site; GitHub Pages serves it directly).

---

## How to play

- **5 lanes.** Enemies (fish / rafts / submarines / bosses) sail from right to left toward your ship.
- **Fire** by tapping a lane button `1`–`5`, or tapping that lane on the playfield. Each shot costs **energy**, which refills over time.
- **Abilities** (each on its own cooldown):
  - موجة `Q` — fire every lane at once
  - إصلاح `W` — repair 25% of ship armor
  - سرعة `E` — overdrive: faster, stronger shots
  - تجميد `R` — freeze all enemies briefly
- Clear a wave to earn gold, then spend it in **التجهيز (prep)** on 8 upgradeable rooms. Survive as long as you can; your best wave is saved.
- **Modes:** عادي (normal), سريع (faster + double gold), لا نهاية (endless, escalating).

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
