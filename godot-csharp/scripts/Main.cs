using Godot;
using System;
using System.Collections.Generic;

public partial class Main : Node2D
{
    enum Phase { Menu, Prep, Battle, Result }

    sealed class Enemy
    {
        public Vector2 Pos;
        public int Lane;
        public float Hp;
        public float MaxHp;
        public float Speed;
        public int Reward;
        public string Kind = "Fish";
        public Color Color = Colors.Cyan;
    }

    sealed class Shot
    {
        public Vector2 Pos;
        public int Lane;
        public float Damage;
        public float Speed;
    }

    readonly string[] _rooms = { "Command", "Cannons", "Engines", "Arsenal", "Shield", "Storage", "Radar", "Crew" };
    readonly string[] _roomEffects = { "Ship HP", "Damage", "Fire rate", "Ammo", "Armor", "Gold bonus", "Vision", "Cooldown" };

    Phase _phase = Phase.Menu;
    string _mode = "Normal";
    int _wave = 0;
    int _gold = 180;
    int[] _levels = new int[8];

    float _shipHp;
    float _shipMaxHp;
    int _ammo;
    int _spawnLeft;
    float _spawnTimer;
    float _lastShotTime;
    float _time;
    float _empTimer;
    float _speedTimer;
    int _kills;
    int _earned;
    string _message = "";

    readonly List<Enemy> _enemies = new();
    readonly List<Shot> _shots = new();
    readonly RandomNumberGenerator _rng = new();

    public override void _Ready()
    {
        _rng.Randomize();
        SetProcess(true);
    }

    public override void _Process(double delta)
    {
        float dt = (float)delta;
        _time += dt;
        if (_phase == Phase.Battle)
            UpdateBattle(dt);

        QueueRedraw();
    }

    public override void _Input(InputEvent e)
    {
        if (e is InputEventKey key && key.Pressed && !key.Echo)
        {
            if (_phase == Phase.Menu)
            {
                if (key.Keycode == Key.Key1) StartGame("Normal");
                if (key.Keycode == Key.Key2) StartGame("Blitz");
                if (key.Keycode == Key.Key3) StartGame("Endless");
            }
            else if (_phase == Phase.Prep && key.Keycode == Key.Enter)
            {
                StartBattle();
            }
            else if (_phase == Phase.Battle)
            {
                if (key.Keycode >= Key.Key1 && key.Keycode <= Key.Key5)
                    FireLane((int)(key.Keycode - Key.Key1));
                if (key.Keycode == Key.Q) UseWaveBarrage();
                if (key.Keycode == Key.W) RepairShip();
                if (key.Keycode == Key.E) _speedTimer = 6f;
                if (key.Keycode == Key.R) _empTimer = 3f;
            }
            else if (_phase == Phase.Result && key.Keycode == Key.Space)
            {
                _phase = _shipHp <= 0 ? Phase.Menu : Phase.Prep;
            }
        }

        if (e is InputEventMouseButton mb && mb.Pressed)
        {
            Vector2 p = mb.Position;
            if (_phase == Phase.Menu)
                HandleMenuTap(p);
            else if (_phase == Phase.Prep)
                HandlePrepTap(p);
            else if (_phase == Phase.Battle)
                HandleBattleTap(p);
            else if (_phase == Phase.Result)
                _phase = _shipHp <= 0 ? Phase.Menu : Phase.Prep;
        }
    }

    void StartGame(string mode)
    {
        _mode = mode;
        _wave = 0;
        _gold = 180;
        _levels = new int[8];
        _phase = Phase.Prep;
    }

    void StartBattle()
    {
        var s = Stats();
        _wave++;
        _shipMaxHp = s.hp;
        _shipHp = _shipMaxHp;
        _ammo = s.ammo;
        _spawnLeft = 7 + _wave * 2 + (_wave % 3 == 0 ? 1 : 0);
        _spawnTimer = 0;
        _lastShotTime = -99;
        _empTimer = 0;
        _speedTimer = 0;
        _kills = 0;
        _earned = 0;
        _enemies.Clear();
        _shots.Clear();
        _phase = Phase.Battle;
    }

    (float hp, float damage, float delay, int ammo, float armor, float goldBonus) Stats()
    {
        return (
            240 + _levels[0] * 45,
            26 + _levels[1] * 9,
            Mathf.Max(.16f, .56f - _levels[2] * .07f),
            24 + _levels[3] * 5,
            Mathf.Min(.45f, _levels[4] * .05f),
            1f + _levels[5] * .14f
        );
    }

    int UpgradeCost(int i) => Mathf.FloorToInt(80 * Mathf.Pow(1.6f, _levels[i]) + i * 18);

    float LaneY(int lane)
    {
        Rect2 vp = GetViewportRect();
        return Mathf.Lerp(250, vp.Size.Y - 320, (lane + .5f) / 5f);
    }

    void SpawnEnemy()
    {
        bool boss = _wave % 3 == 0 && _spawnLeft == 1;
        int lane = _rng.RandiRange(0, 4);
        Enemy e = new Enemy();
        e.Pos = new Vector2(GetViewportRect().Size.X + 80, LaneY(lane));
        e.Lane = lane;

        if (boss)
        {
            e.Kind = "Boss";
            e.Hp = e.MaxHp = 900 + _wave * 35;
            e.Speed = 42;
            e.Reward = 150;
            e.Color = new Color("ff7a18");
        }
        else
        {
            string[] kinds = { "Fish", "Raft", "Submarine" };
            e.Kind = kinds[_rng.RandiRange(0, kinds.Length - 1)];
            e.Hp = e.MaxHp = 80 + _wave * 10;
            e.Speed = _rng.RandfRange(70, 112);
            e.Reward = 14 + _wave * 2;
            e.Color = e.Kind == "Fish" ? new Color("22c55e") : e.Kind == "Submarine" ? new Color("94a3b8") : new Color("facc15");
        }

        if (_mode == "Blitz")
        {
            e.Speed *= 1.55f;
            e.Reward *= 2;
        }

        _enemies.Add(e);
        _spawnLeft--;
    }

    void FireLane(int lane, bool free = false)
    {
        var s = Stats();
        if (!free && _time - _lastShotTime < s.delay) return;
        if (!free && _ammo <= 0) return;
        if (!free)
        {
            _ammo--;
            _lastShotTime = _time;
        }
        _shots.Add(new Shot
        {
            Pos = new Vector2(145, LaneY(lane)),
            Lane = lane,
            Damage = s.damage * (_speedTimer > 0 ? 1.25f : 1f),
            Speed = 820 * (_speedTimer > 0 ? 1.65f : 1f)
        });
    }

    void UseWaveBarrage()
    {
        for (int i = 0; i < 5; i++) FireLane(i, true);
        _message = "Wave Barrage";
    }

    void RepairShip()
    {
        _shipHp = Mathf.Min(_shipMaxHp, _shipHp + _shipMaxHp * .25f);
        _message = "Repair +25%";
    }

    void UpdateBattle(float dt)
    {
        _empTimer = Mathf.Max(0, _empTimer - dt);
        _speedTimer = Mathf.Max(0, _speedTimer - dt);
        _spawnTimer -= dt;
        if (_spawnLeft > 0 && _spawnTimer <= 0)
        {
            SpawnEnemy();
            _spawnTimer = Mathf.Max(.42f, 1.12f - _wave * .02f);
        }

        float enemySpeed = _empTimer > 0 ? 0 : 1;
        var s = Stats();

        for (int i = _enemies.Count - 1; i >= 0; i--)
        {
            var e = _enemies[i];
            e.Pos.X -= e.Speed * enemySpeed * dt;
            if (e.Pos.X < 90)
            {
                _shipHp -= 35 * (1f - s.armor);
                _enemies.RemoveAt(i);
            }
        }

        for (int i = _shots.Count - 1; i >= 0; i--)
        {
            var shot = _shots[i];
            shot.Pos.X += shot.Speed * dt;
            if (shot.Pos.X > GetViewportRect().Size.X + 80)
            {
                _shots.RemoveAt(i);
                continue;
            }

            for (int j = _enemies.Count - 1; j >= 0; j--)
            {
                var e = _enemies[j];
                if (e.Lane == shot.Lane && shot.Pos.DistanceTo(e.Pos) < 45)
                {
                    e.Hp -= shot.Damage;
                    _shots.RemoveAt(i);
                    if (e.Hp <= 0)
                    {
                        int reward = Mathf.RoundToInt(e.Reward * s.goldBonus);
                        _gold += reward;
                        _earned += reward;
                        _kills++;
                        _enemies.RemoveAt(j);
                    }
                    break;
                }
            }
        }

        if (_shipHp <= 0) EndBattle(false);
        if (_spawnLeft <= 0 && _enemies.Count == 0) EndBattle(true);
    }

    void EndBattle(bool win)
    {
        if (win)
        {
            int bonus = Mathf.RoundToInt((40 + _wave * 18) * Stats().goldBonus * (_mode == "Blitz" ? 2 : 1));
            _gold += bonus;
            _earned += bonus;
        }
        _phase = Phase.Result;
    }

    void HandleMenuTap(Vector2 p)
    {
        Rect2 vp = GetViewportRect();
        float y = vp.Size.Y - 410;
        if (new Rect2(55, y, vp.Size.X - 110, 82).HasPoint(p)) StartGame("Normal");
        if (new Rect2(55, y + 96, vp.Size.X - 110, 82).HasPoint(p)) StartGame("Blitz");
        if (new Rect2(55, y + 192, vp.Size.X - 110, 82).HasPoint(p)) StartGame("Endless");
    }

    void HandlePrepTap(Vector2 p)
    {
        Rect2 vp = GetViewportRect();
        float w = (vp.Size.X - 70) / 2f;
        for (int i = 0; i < 8; i++)
        {
            float x = 25 + (i % 2) * (w + 20);
            float y = 230 + (i / 2) * 150;
            if (new Rect2(x, y, w, 130).HasPoint(p) && _levels[i] < 5 && _gold >= UpgradeCost(i))
            {
                _gold -= UpgradeCost(i);
                _levels[i]++;
                return;
            }
        }
        if (new Rect2(25, vp.Size.Y - 110, vp.Size.X - 50, 72).HasPoint(p)) StartBattle();
    }

    void HandleBattleTap(Vector2 p)
    {
        Rect2 vp = GetViewportRect();
        if (p.Y > vp.Size.Y - 135)
        {
            int lane = Mathf.Clamp((int)(p.X / (vp.Size.X / 5f)), 0, 4);
            FireLane(lane);
        }
    }

    public override void _Draw()
    {
        Rect2 vp = GetViewportRect();
        DrawRect(vp, new Color("03101f"));
        if (_phase == Phase.Menu) DrawMenu(vp);
        if (_phase == Phase.Prep) DrawPrep(vp);
        if (_phase == Phase.Battle) DrawBattle(vp);
        if (_phase == Phase.Result) DrawResult(vp);
    }

    void DrawMenu(Rect2 vp)
    {
        DrawSeaBackground(vp);
        DrawString(ThemeDB.FallbackFont, new Vector2(55, 180), "SEA TYCOON", HorizontalAlignment.Left, -1, 74, new Color("22d3ee"));
        DrawString(ThemeDB.FallbackFont, new Vector2(55, 255), "DEFENSE", HorizontalAlignment.Left, -1, 74, Colors.White);
        DrawString(ThemeDB.FallbackFont, new Vector2(55, 335), "C# Godot build - premium sea defense prototype", HorizontalAlignment.Left, -1, 24, new Color("a8bdcf"));
        string[] modes = { "Normal", "Blitz x2", "Endless" };
        float y = vp.Size.Y - 410;
        for (int i = 0; i < 3; i++)
        {
            DrawRoundPanel(new Rect2(55, y + i * 96, vp.Size.X - 110, 82), new Color("0b314f"));
            DrawString(ThemeDB.FallbackFont, new Vector2(85, y + 52 + i * 96), modes[i], HorizontalAlignment.Left, -1, 30, Colors.White);
        }
    }

    void DrawPrep(Rect2 vp)
    {
        DrawSeaBackground(vp);
        DrawString(ThemeDB.FallbackFont, new Vector2(25, 80), $"Prep - Wave {_wave + 1}", HorizontalAlignment.Left, -1, 42, Colors.White);
        DrawString(ThemeDB.FallbackFont, new Vector2(25, 132), $"Gold: {_gold}", HorizontalAlignment.Left, -1, 28, new Color("facc15"));
        float w = (vp.Size.X - 70) / 2f;
        for (int i = 0; i < 8; i++)
        {
            float x = 25 + (i % 2) * (w + 20);
            float y = 230 + (i / 2) * 150;
            DrawRoundPanel(new Rect2(x, y, w, 130), new Color("071b2e"));
            DrawString(ThemeDB.FallbackFont, new Vector2(x + 18, y + 36), _rooms[i], HorizontalAlignment.Left, -1, 24, Colors.White);
            DrawString(ThemeDB.FallbackFont, new Vector2(x + 18, y + 70), $"LV {_levels[i]}/5 - {_roomEffects[i]}", HorizontalAlignment.Left, -1, 18, new Color("a8bdcf"));
            DrawString(ThemeDB.FallbackFont, new Vector2(x + 18, y + 105), $"Cost {UpgradeCost(i)}", HorizontalAlignment.Left, -1, 20, new Color("facc15"));
        }
        DrawRoundPanel(new Rect2(25, vp.Size.Y - 110, vp.Size.X - 50, 72), new Color("0891b2"));
        DrawString(ThemeDB.FallbackFont, new Vector2(55, vp.Size.Y - 65), "START BATTLE", HorizontalAlignment.Left, -1, 30, Colors.White);
    }

    void DrawBattle(Rect2 vp)
    {
        DrawSeaBackground(vp);
        DrawHud(vp);
        for (int i = 0; i < 5; i++)
        {
            float y = LaneY(i);
            DrawLine(new Vector2(0, y), new Vector2(vp.Size.X, y), new Color(1, 1, 1, .12f), 2);
        }
        DrawPlayerShip(new Vector2(60, vp.Size.Y / 2));
        foreach (var e in _enemies) DrawEnemy(e);
        foreach (var s in _shots) DrawShot(s);
    }

    void DrawHud(Rect2 vp)
    {
        DrawRoundPanel(new Rect2(20, 25, vp.Size.X - 40, 78), new Color(0, 0, 0, .42f));
        DrawString(ThemeDB.FallbackFont, new Vector2(40, 60), $"HP {Mathf.Max(0, (int)_shipHp)}/{(int)_shipMaxHp}", HorizontalAlignment.Left, -1, 22, Colors.White);
        DrawString(ThemeDB.FallbackFont, new Vector2(40, 91), $"Gold {_gold}   Ammo {_ammo}   Wave {_wave}", HorizontalAlignment.Left, -1, 20, new Color("facc15"));
    }

    void DrawResult(Rect2 vp)
    {
        DrawSeaBackground(vp);
        string title = _shipHp <= 0 ? "SHIP DOWN" : "WAVE CLEAR";
        DrawString(ThemeDB.FallbackFont, new Vector2(70, vp.Size.Y / 2 - 100), title, HorizontalAlignment.Left, -1, 56, _shipHp <= 0 ? new Color("ef4444") : new Color("22c55e"));
        DrawString(ThemeDB.FallbackFont, new Vector2(70, vp.Size.Y / 2 - 40), $"Wave {_wave} | Kills {_kills} | Gold +{_earned}", HorizontalAlignment.Left, -1, 26, Colors.White);
        DrawString(ThemeDB.FallbackFont, new Vector2(70, vp.Size.Y / 2 + 20), "Tap or press Space", HorizontalAlignment.Left, -1, 24, new Color("a8bdcf"));
    }

    void DrawSeaBackground(Rect2 vp)
    {
        DrawRect(vp, new Color("082f49"));
        for (int i = 0; i < 12; i++)
        {
            float y = 80 + i * 130 + Mathf.Sin(_time + i) * 8;
            DrawArcLine(y, vp.Size.X, new Color(0.49f, 0.83f, 0.99f, .16f));
        }
    }

    void DrawArcLine(float y, float width, Color color)
    {
        Vector2 last = new Vector2(0, y);
        for (int x = 16; x <= width; x += 16)
        {
            Vector2 now = new Vector2(x, y + Mathf.Sin((x * .018f) + _time * 2f) * 8f);
            DrawLine(last, now, color, 2);
            last = now;
        }
    }

    void DrawRoundPanel(Rect2 r, Color color)
    {
        DrawRect(r, color);
        DrawRect(r, new Color("22d3ee"), false, 2);
    }

    void DrawPlayerShip(Vector2 pos)
    {
        DrawRect(new Rect2(pos.X - 34, pos.Y + 42, 88, 40), new Color("7c2d12"));
        Vector2[] sail = { new(pos.X - 18, pos.Y - 70), new(pos.X + 48, pos.Y + 48), new(pos.X - 22, pos.Y + 30) };
        DrawColoredPolygon(sail, new Color("38bdf8"));
        DrawLine(new Vector2(pos.X, pos.Y - 78), new Vector2(pos.X, pos.Y + 76), Colors.White, 5);
        DrawLine(new Vector2(pos.X + 56, pos.Y + 55), new Vector2(pos.X + 92, pos.Y + 55), new Color("facc15"), 6);
    }

    void DrawEnemy(Enemy e)
    {
        if (e.Kind == "Submarine")
        {
            DrawRect(new Rect2(e.Pos.X - 42, e.Pos.Y - 18, 84, 36), new Color("94a3b8"));
            DrawRect(new Rect2(e.Pos.X - 8, e.Pos.Y - 36, 20, 18), new Color("334155"));
        }
        else if (e.Kind == "Raft")
        {
            DrawRect(new Rect2(e.Pos.X - 42, e.Pos.Y - 14, 84, 28), new Color("7c2d12"));
            Vector2[] sail = { new(e.Pos.X - 5, e.Pos.Y - 45), new(e.Pos.X + 30, e.Pos.Y - 5), new(e.Pos.X - 10, e.Pos.Y - 5) };
            DrawColoredPolygon(sail, new Color("fef3c7"));
        }
        else
        {
            float scale = e.Kind == "Boss" ? 1.45f : 1f;
            DrawCircle(e.Pos, 24 * scale, e.Color);
            Vector2[] tail = { new(e.Pos.X + 22 * scale, e.Pos.Y), new(e.Pos.X + 52 * scale, e.Pos.Y - 18 * scale), new(e.Pos.X + 52 * scale, e.Pos.Y + 18 * scale) };
            DrawColoredPolygon(tail, e.Color);
            DrawCircle(e.Pos + new Vector2(-12 * scale, -5 * scale), 4 * scale, Colors.Black);
        }
        DrawRect(new Rect2(e.Pos.X - 36, e.Pos.Y - 40, 72, 6), new Color("ef4444"));
        DrawRect(new Rect2(e.Pos.X - 36, e.Pos.Y - 40, 72 * Mathf.Max(0, e.Hp / e.MaxHp), 6), new Color("22c55e"));
    }

    void DrawShot(Shot s)
    {
        DrawCircle(s.Pos, 9, new Color("facc15"));
        DrawCircle(s.Pos, 16, new Color(1, .8f, .1f, .18f));
    }
}
