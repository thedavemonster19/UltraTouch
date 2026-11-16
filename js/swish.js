/* Swish Shot — a lane-timing basketball game for 1–4 players (pass the phone).
 * Five shooters stand in a row; one hoop slides side to side across their lanes. Tap the shooter whose lane
 * the hoop is about to cross so the ball arrives as it passes. Three in a row earns a bonus, and the hoop
 * backs up each round. Mechanics follow the bar-top classic; art, rules detail and numbers are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  /* z = hoop depth (m, sets its size and height); cross = seconds for the hoop to glide edge to edge;
   * need = baskets out of BALLS to qualify; pts = per basket. */
  const ROUNDS = [
    { z: 4.6, cross: 5.2, need: 6, pts: 10 },
    { z: 5.6, cross: 4.6, need: 7, pts: 15 },
    { z: 6.6, cross: 4.1, need: 7, pts: 20 },
    { z: 7.6, cross: 3.6, need: 8, pts: 25 },
    { z: 8.6, cross: 3.2, need: 8, pts: 30 },
  ];
  const LANES = 5;
  const BALLS = 15;
  const ROUND_TIME = 30;
  const SHOOTER_Z = 2.0;
  const RIM_Y = 3.05;
  const RIM_R = 0.23;
  const BALL_R = 0.12;
  const CAM_Y = 1.75;
  const F = 440;
  const HZ = 360;
  const GRAV = -9.8;
  const LAT_S = F / SHOOTER_Z; /* pixels per metre side to side */
  const GAP = 0.45; /* seconds between any two shots */
  const RELOAD = 1.4; /* seconds before the same shooter has a ball again */
  const SWISH_BONUS = 5;
  const HEAT_BONUS = 30;
  const JERSEY = '#d9342b';
  const WALL_BOTTOM = 345; /* where the brick wall meets the court */
  const SKIN = ['#8d5524', '#c68642', '#5a3825', '#e0ac69', '#a86b3c'];
  const HAIR = ['#2fd16b', '#1b1410', '#2fd16b', '#1b1410', '#2fd16b'];
  const HOLD = 0.3; /* the ball sits on the right shoulder, this far right of the lane (in shooter units) */

  class Swish {
    constructor(opts) {
      this.onEnd = opts.onEnd;
      const n = UT.clamp(opts.players || 1, 1, 4);
      this.players = [];
      for (let i = 0; i < n; i++) this.players.push({ name: 'Player ' + (i + 1), score: 0, out: false, made: 0, shots: 0, rounds: 0 });
      this.round = 0;
      this.turn = 0;
      this.popups = new UT.Popups();
      this.W = 960;
      this.H = 540;
      this.flash = 0;
      this.strike = 0;
      this.bolts = [];
      this.boltT = 0;
      this.spacing = 1;
      this.words = { swish: 0, brick: 0, airball: 0 };
      this.best = UT.scores.best('swish');
      this.beginTurn();
    }

    get P() { return this.players[this.turn]; }
    get R() { return ROUNDS[this.round]; }

    beginTurn() {
      this.state = 'intro';
      this.stateT = 0;
      this.balls = [];
      this.timeLeft = ROUND_TIME;
      this.ballsLeft = BALLS;
      this.roundMade = 0;
      this.streak = 0;
      this.heat = false;
      this.gap = 0;
      this.reload = new Array(LANES).fill(0);
      this.hoopT = Math.random() * 10;
      this.netSwing = 0;
      this.lastTick = 6;
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
      /* lanes are 1 m apart on a wide phone, closer on narrow screens so all five shooters fit */
      const s = F / SHOOTER_Z;
      this.spacing = UT.clamp((W / 2 - 110) / (2 * s), 0.6, 1.0);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      this.crowd = [];
      for (let row = 0; row < 7; row++) {
        const y = 150 + row * 22;
        for (let x = -10; x < W + 10; x += 15 + rnd() * 6) {
          this.crowd.push({ x: x + rnd() * 6, y: y + rnd() * 6, r: 5 + rnd() * 2.5, c: rnd(), ph: rnd() * 6.28 });
        }
      }
    }

    /* ---------- world ---------- */
    /* Side-to-side position is drawn flat (same scale at every depth) so a ball flies straight up its lane
     * and the hoop lines up with the shooters across the full screen; height and size still shrink with depth. */
    proj(x, y, z) {
      const s = F / z;
      return { x: this.W / 2 + x * LAT_S, y: HZ + (CAM_Y - y) * s, s };
    }
    /* a point dx metres from an object's centre cx, at true depth scale (board, rim, net) */
    projL(cx, dx, y, z) {
      const p = this.proj(cx, y, z);
      p.x += dx * p.s;
      return p;
    }
    laneX(i) { return (i - (LANES - 1) / 2) * this.spacing; }
    /* the hoop runs nearly edge to edge of the screen */
    amp() { return (this.W / 2 - 0.95 * (F / (this.R.z + 0.4)) - 8) / LAT_S; }
    /* steady glide, bouncing off each edge */
    hoopX(t) {
      const tt = t == null ? this.hoopT : t;
      const period = 2 * this.R.cross;
      const u = (((tt % period) + period) % period) / period;
      return this.amp() * (u < 0.5 ? -1 + 4 * u : 3 - 4 * u);
    }
    /* a jagged lightning polyline from (x1,y1) to (x2,y2), with a fork or two */
    bolt(x1, y1, x2, y2, width) {
      const pts = [[x1, y1]];
      const n = 10;
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        pts.push([x1 + (x2 - x1) * t + (Math.random() - 0.5) * len * 0.12, y1 + (y2 - y1) * t + (Math.random() - 0.5) * len * 0.04]);
      }
      pts.push([x2, y2]);
      const forks = [];
      for (let f = 0; f < 2; f++) {
        const k = 2 + Math.floor(Math.random() * (n - 4));
        const [fx, fy] = pts[k];
        forks.push([[fx, fy], [fx + (Math.random() - 0.5) * 90, fy + 30 + Math.random() * 40], [fx + (Math.random() - 0.5) * 140, fy + 70 + Math.random() * 50]]);
      }
      return { pts, forks, width };
    }

    drawBolts(g) {
      if (!this.bolts.length) return;
      g.save();
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const line = (pts) => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
      };
      this.bolts.forEach((b) => {
        g.shadowColor = '#7fd8ff';
        g.shadowBlur = 22;
        g.strokeStyle = 'rgba(127,216,255,0.75)';
        g.lineWidth = b.width * 3;
        line(b.pts);
        g.lineWidth = b.width * 1.5;
        b.forks.forEach(line);
        g.shadowBlur = 0;
        g.strokeStyle = '#ffffff';
        g.lineWidth = b.width;
        line(b.pts);
        g.lineWidth = b.width * 0.6;
        b.forks.forEach(line);
      });
      g.restore();
    }

    /* a slow, floaty lob: about 1.1 s to the rim in round 1, 1.4 s by round 5 */
    flightTime() { return 0.95 + 0.07 * (this.R.z - SHOOTER_Z); }

    /* ---------- input ---------- */
    onDown(x) {
      if (this.state === 'intro' && this.stateT > 0.35) {
        this.state = 'play';
        UT.sfx.tap();
        return;
      }
      if (this.state === 'summary' && this.stateT > 0.8) {
        UT.sfx.tap();
        this.next();
        return;
      }
      if (this.state === 'final' && this.stateT > 1) {
        this.report();
        return;
      }
      if (this.state !== 'play') return;
      /* the tap picks the nearest shooter, so the whole screen is a big button per lane */
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < LANES; i++) {
        const d = Math.abs(this.proj(this.laneX(i), 0, SHOOTER_Z).x - x);
        if (d < bd) { bd = d; best = i; }
      }
      this.shoot(best);
    }

    shoot(lane) {
      if (this.gap > 0 || this.reload[lane] > 0 || this.ballsLeft <= 0) return;
      const r = this.R;
      this.gap = GAP;
      this.reload[lane] = RELOAD;
      this.ballsLeft--;
      const T = this.flightTime();
      const y0 = 1.62;
      const d = RIM_Y - y0;
      const h = RIM_Y + 0.75 + 0.05 * r.z - y0;
      const b = 2 * h + 2 * Math.sqrt(h * h - h * d);
      const a = d - b;
      this.balls.push({
        x: this.laneX(lane) + HOLD * 0.62, y: y0, z: SHOOTER_Z + 0.15,
        vx: -(HOLD * 0.62) / T, vy: b / T, vz: (r.z - SHOOTER_Z - 0.15) / T,
        g: (2 * a) / (T * T),
        state: 'flight', decided: false, life: 0, spin: 0, heat: this.heat, lane,
      });
      this.P.shots++;
      UT.sfx.shoot();
    }

    /* ---------- scoring ---------- */
    make(kind) {
      const r = this.R;
      let pts = r.pts + (kind === 'swish' ? SWISH_BONUS : 0);
      if (this.heat) pts *= 2;
      this.streak++;
      this.roundMade++;
      this.P.made++;
      this.P.score += pts;
      const at = this.proj(this.hoopX(), RIM_Y + 0.7, r.z);
      this.popups.add((kind === 'swish' ? 'SWISH +' : '+') + pts, at.x, at.y - 10, kind === 'swish' ? C.mint : C.amber, 30);
      this.netSwing = 1;
      UT.sfx.swish(kind === 'swish');
      if (this.heat) UT.sfx.zap();
      if (this.streak === 3 && !this.heat) {
        this.heat = true;
        this.P.score += HEAT_BONUS;
        this.flash = 1;
        this.strike = 1.1;
        this.popups.add('LIGHTNING! +' + HEAT_BONUS + ' · 2× POINTS', this.W / 2, 200, '#bfe9ff', 34);
        UT.sfx.heat();
        UT.sfx.thunder();
      }
    }
    miss() {
      if (this.heat) this.popups.add('POWER OUT', this.W / 2, 200, C.dim, 26);
      this.streak = 0;
      this.heat = false;
    }

    decide(ball) {
      const r = this.R;
      ball.decided = true;
      const dx = ball.x - this.hoopX();
      /* compare in rim radii: inside 1.0 drops, 1.0–1.75 hits iron */
      const ax = (Math.abs(dx) * LAT_S) / ((RIM_R * F) / r.z);
      if (ax <= 1.15) {
        ball.state = 'in';
        this.words.swish = 1;
        this.make(ax < 0.5 ? 'swish' : 'make');
      } else if (ax <= 1.85) {
        UT.sfx.rim();
        const chance = 0.45 * (1 - (ax - 1.15) / 0.7);
        if (Math.random() < chance) {
          ball.state = 'rattle';
          ball.vy = 1.3;
        } else {
          ball.state = 'out';
          ball.vy = 1.6 + Math.random();
          ball.vx = (dx >= 0 ? 1 : -1) * (0.7 + Math.random() * 0.8);
          ball.vz = -1.4;
          this.miss();
          this.words.brick = 1;
        }
      } else {
        ball.state = 'out';
        ball.vz = 0.5;
        this.words.airball = 1;
        this.miss();
      }
    }

    /* ---------- loop ---------- */
    update(dt) {
      this.stateT += dt;
      this.flash = Math.max(0, this.flash - dt * 1.5);
      this.netSwing = Math.max(0, this.netSwing - dt * 1.6);
      for (const k in this.words) this.words[k] = Math.max(0, this.words[k] - dt * 0.8);
      this.strike = Math.max(0, this.strike - dt);
      /* regenerate the jagged bolts every few frames so they flicker */
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = 0.06;
        this.bolts = [];
        const hx = this.proj(this.hoopX(), RIM_Y, this.R.z);
        if (this.strike > 0) for (let i = 0; i < 3; i++) this.bolts.push(this.bolt(this.W * (0.15 + Math.random() * 0.7), 0, hx.x + (Math.random() - 0.5) * 30, hx.y, 3.5));
        if (this.heat && Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          this.bolts.push(this.bolt(hx.x + Math.cos(a) * 26, hx.y + Math.sin(a) * 12, hx.x + Math.cos(a + 1.5) * 40, hx.y + Math.sin(a + 1.5) * 30, 1.5));
        }
      }
      this.popups.update(dt);
      if (this.state === 'intro' || this.state === 'summary' || this.state === 'final') {
        this.hoopT += dt * 0.5;
        return;
      }
      this.hoopT += dt;
      this.gap = Math.max(0, this.gap - dt);
      for (let i = 0; i < LANES; i++) this.reload[i] = Math.max(0, this.reload[i] - dt);

      if (this.state === 'play') {
        this.timeLeft -= dt;
        const whole = Math.ceil(this.timeLeft);
        if (whole < this.lastTick && whole > 0) {
          this.lastTick = whole;
          UT.sfx.tick();
        }
        if (this.timeLeft <= 0 || (this.ballsLeft <= 0 && this.balls.every((b) => b.decided))) {
          this.timeLeft = Math.max(0, this.timeLeft);
          this.state = 'horn';
          this.stateT = 0;
          UT.sfx.horn();
        }
      }

      const steps = 4;
      for (let i = 0; i < steps; i++) this.balls.forEach((b) => this.stepBall(b, dt / steps));
      this.balls = this.balls.filter((b) => b.life < 3 && b.z > 1.2);

      /* buzzer beaters count: the round ends once every ball in the air has landed */
      if (this.state === 'horn' && this.stateT > 0.6 && this.balls.every((b) => b.decided)) this.endTurn();
    }

    stepBall(b, dt) {
      const r = this.R;
      b.life += dt;
      b.spin += dt * 9;
      if (b.state === 'flight') {
        const prevY = b.y;
        b.vy += b.g * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        if (prevY > RIM_Y && b.y <= RIM_Y && b.vy < 0) this.decide(b);
        return;
      }
      if (b.state === 'rattle') {
        b.vy += GRAV * dt;
        b.y += b.vy * dt;
        b.x = UT.lerp(b.x, this.hoopX(), 0.25);
        if (b.y <= RIM_Y && b.vy < 0) {
          b.state = 'in';
          this.words.swish = 1;
          this.make('make');
        }
        return;
      }
      if (b.state === 'in') {
        b.vy = Math.min(b.vy, -2.2) + GRAV * dt;
        b.y += b.vy * dt;
        b.x = UT.lerp(b.x, this.hoopX(), 0.35);
        b.z = UT.lerp(b.z, r.z, 0.35);
        if (b.y < RIM_Y - 0.55) {
          b.state = 'out';
          b.vx = 0;
          b.vz = -0.3;
        }
        return;
      }
      b.vy += GRAV * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < BALL_R) {
        b.y = BALL_R;
        if (Math.abs(b.vy) > 1.2) UT.sfx.bounce();
        b.vy = -b.vy * 0.55;
        b.vx *= 0.8;
        b.vz *= 0.8;
      }
      const boardZ = r.z + 0.4;
      if (b.vz > 0 && b.z + BALL_R > boardZ && b.y > 2.9 && b.y < 3.95 && Math.abs(b.x - this.hoopX()) * LAT_S < 0.9 * (F / boardZ)) {
        b.z = boardZ - BALL_R;
        b.vz = -Math.abs(b.vz) * 0.4;
        UT.sfx.board();
      }
    }

    endTurn() {
      const P = this.P;
      this.qualified = this.roundMade >= this.R.need;
      if (this.qualified) {
        P.rounds = this.round + 1;
        UT.sfx.win();
      } else {
        P.out = true;
        UT.sfx.lose();
      }
      this.state = 'summary';
      this.stateT = 0;
    }

    next() {
      for (let i = this.turn + 1; i < this.players.length; i++) {
        if (!this.players[i].out) {
          this.turn = i;
          this.beginTurn();
          return;
        }
      }
      this.round++;
      const first = this.players.findIndex((p) => !p.out);
      if (this.round >= ROUNDS.length || first < 0) {
        this.round = Math.min(this.round, ROUNDS.length - 1);
        this.finish();
        return;
      }
      this.turn = first;
      this.beginTurn();
    }

    finish() {
      this.state = 'final';
      this.stateT = 0;
      UT.sfx.win();
    }

    report() {
      this.state = 'done';
      this.onEnd({
        game: 'swish',
        rounds: ROUNDS.length,
        allClear: this.players.some((p) => p.rounds === ROUNDS.length),
        players: this.players.map((p) => ({ name: p.name, score: p.score, made: p.made, shots: p.shots, rounds: p.rounds })),
      });
    }

    /* ---------- drawing ---------- */
    /* the street court is static, so paint it once per size into an offscreen canvas */
    paintCourt() {
      const W = this.W;
      const H = this.H;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d');
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      /* brick wall */
      g.fillStyle = '#7a1f1a';
      g.fillRect(0, 0, W, WALL_BOTTOM);
      const bw = 46;
      const bh = 18;
      for (let row = 0; row * bh < WALL_BOTTOM; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < W + bw; x += bw) {
          const shade = 0.82 + rnd() * 0.3;
          g.fillStyle = 'rgb(' + Math.round(178 * shade) + ',' + Math.round(52 * shade) + ',' + Math.round(42 * shade) + ')';
          g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
        }
      }
      const shadow = g.createLinearGradient(0, 0, 0, WALL_BOTTOM);
      shadow.addColorStop(0, 'rgba(0,0,0,0.35)');
      shadow.addColorStop(0.3, 'rgba(0,0,0,0)');
      shadow.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = shadow;
      g.fillRect(0, 0, W, WALL_BOTTOM);
      /* asphalt */
      g.fillStyle = '#4b4d4f';
      g.fillRect(0, WALL_BOTTOM, W, H - WALL_BOTTOM);
      for (let i = 0; i < (W * (H - WALL_BOTTOM)) / 18; i++) {
        const v = 50 + rnd() * 70;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)';
        g.fillRect(rnd() * W, WALL_BOTTOM + rnd() * (H - WALL_BOTTOM), 1.5, 1.5);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, WALL_BOTTOM, W, 6);
      /* painted lines: baseline, lane and the top of the key */
      g.strokeStyle = 'rgba(214,74,52,0.85)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, WALL_BOTTOM + 24);
      g.lineTo(W, WALL_BOTTOM + 24);
      g.moveTo(W / 2 - 120, WALL_BOTTOM + 24);
      g.lineTo(W / 2 - 160, H - 70);
      g.moveTo(W / 2 + 120, WALL_BOTTOM + 24);
      g.lineTo(W / 2 + 160, H - 70);
      g.stroke();
      g.beginPath();
      g.ellipse(W / 2, H - 70, 230, 70, 0, Math.PI, Math.PI * 2);
      g.stroke();
      this.court = cv;
    }

    graffiti(g, word, key, x, color) {
      const k = this.words[key];
      const y = WALL_BOTTOM - 46;
      g.save();
      g.translate(x, y);
      g.rotate(-0.06);
      g.scale(1 + k * 0.18, 1 + k * 0.18);
      g.globalAlpha = 0.4 + k * 0.6;
      if (k > 0) {
        g.shadowColor = color;
        g.shadowBlur = 24 * k;
      }
      D.text(g, word, 0, 0, 40, color, { family: UT.font.graffiti, weight: 400, stroke: '#1a0b08', strokeWidth: 7 });
      g.restore();
    }

    draw(g) {
      const W = this.W;
      const H = this.H;
      const r = this.R;
      if (!this.court || this.court.width !== W) this.paintCourt();
      g.drawImage(this.court, 0, 0, W, H);

      this.graffiti(g, 'SWISH', 'swish', W * 0.2, '#5fe3e6');
      this.graffiti(g, 'BRICK', 'brick', W * 0.5, '#f2b632');
      this.graffiti(g, 'AIRBALL', 'airball', W * 0.8, '#8fc7b0');

      const atHoop = (b) => b.z >= r.z - 0.3 && (b.state !== 'flight' || b.y < RIM_Y + 0.4);
      this.drawHoop(g, 'back');
      this.balls.filter(atHoop).forEach((b) => this.drawBall(g, b));
      this.drawHoop(g, 'front');
      this.balls.filter((b) => !atHoop(b)).forEach((b) => this.drawBall(g, b));

      for (let i = 0; i < LANES; i++) this.drawShooter(g, i);

      this.drawBolts(g);
      if (this.flash > 0) {
        /* white strobe that flickers as it fades */
        const f = this.flash * (0.6 + 0.4 * Math.sin(performance.now() / 25));
        g.fillStyle = 'rgba(220,240,255,' + f * 0.45 + ')';
        g.fillRect(0, 0, W, H);
      }
      this.drawHud(g);
      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'summary') this.drawSummary(g);
      if (this.state === 'final') this.drawFinal(g);
      if (this.state === 'horn') D.text(g, this.timeLeft <= 0 ? 'TIME!' : 'OUT OF BALLS', W / 2, 250, 56, '#f3eee3', { family: UT.font.display, weight: 400, stroke: C.ink, strokeWidth: 8 });
    }

    drawShooter(g, i) {
      /* seen from behind in a red team jersey, ball cocked on the right shoulder */
      const p = this.proj(this.laneX(i), 0, SHOOTER_Z);
      const s = p.s * 0.62;
      const cx = p.x;
      const base = this.H + 6;
      const sw = 0.6 * s;
      const shoulderY = this.H - 0.6 * s;
      const live = this.ballsLeft > 0 && (this.state === 'play' || this.state === 'intro');
      const loaded = live && this.reload[i] <= 0;
      const k = this.reload[i] > 0 ? 1 - this.reload[i] / RELOAD : 1;
      const skin = SKIN[i % SKIN.length];
      const ballX = cx + HOLD * s;
      const ballY = shoulderY - 0.22 * s;
      /* arms: right arm up under the ball, left hand guiding it */
      g.strokeStyle = skin;
      g.lineCap = 'round';
      g.lineWidth = 0.13 * s;
      g.beginPath();
      g.moveTo(cx + sw * 0.42, shoulderY + 0.05 * s);
      g.lineTo(loaded ? ballX + 0.05 * s : cx + 0.5 * s, loaded ? ballY + 0.12 * s : shoulderY + 0.3 * s);
      g.moveTo(cx - sw * 0.42, shoulderY + 0.05 * s);
      g.lineTo(loaded ? ballX - 0.14 * s : cx - 0.5 * s, loaded ? ballY + 0.02 * s : shoulderY + 0.3 * s);
      g.stroke();
      /* jersey with white trim and number */
      g.fillStyle = JERSEY;
      g.beginPath();
      g.moveTo(cx - sw / 2, shoulderY);
      g.quadraticCurveTo(cx, shoulderY - 0.1 * s, cx + sw / 2, shoulderY);
      g.lineTo(cx + sw * 0.46, base);
      g.lineTo(cx - sw * 0.46, base);
      g.closePath();
      g.fill();
      g.strokeStyle = '#f3eee3';
      g.lineWidth = 0.035 * s;
      g.beginPath();
      g.moveTo(cx - sw * 0.38, shoulderY - 0.02 * s);
      g.quadraticCurveTo(cx - sw * 0.3, shoulderY + 0.28 * s, cx - sw * 0.44, shoulderY + 0.36 * s);
      g.moveTo(cx + sw * 0.38, shoulderY - 0.02 * s);
      g.quadraticCurveTo(cx + sw * 0.3, shoulderY + 0.28 * s, cx + sw * 0.44, shoulderY + 0.36 * s);
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.beginPath();
      g.moveTo(cx + sw * 0.1, shoulderY + 0.05 * s);
      g.lineTo(cx + sw * 0.46, base);
      g.lineTo(cx + sw * 0.18, base);
      g.closePath();
      g.fill();
      D.text(g, String(i + 1), cx, shoulderY + 0.36 * s, Math.round(0.3 * s), '#f3eee3', { family: UT.font.display, weight: 400 });
      /* neck, head, hair */
      g.fillStyle = skin;
      g.fillRect(cx - 0.06 * s, shoulderY - 0.12 * s, 0.12 * s, 0.1 * s);
      g.beginPath();
      g.arc(cx, shoulderY - 0.2 * s, 0.13 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = HAIR[i % HAIR.length];
      g.beginPath();
      g.arc(cx, shoulderY - 0.24 * s, 0.135 * s, Math.PI * 0.95, Math.PI * 2.05);
      g.fill();
      if (live) {
        const y = loaded ? ballY : UT.lerp(this.H + 30, ballY, UT.ease(k));
        this.drawBallAt(g, ballX, y, 0.17 * s, this.heat, 0);
      }
    }

    drawHoop(g, layer) {
      const r = this.R;
      const hx = this.hoopX();
      const boardZ = r.z + 0.4;
      const c = this.proj(hx, RIM_Y, r.z);
      const front = this.proj(hx, RIM_Y, r.z - RIM_R);
      const back = this.proj(hx, RIM_Y, r.z + RIM_R);
      const rx = RIM_R * c.s;
      const ry = Math.max(2, (front.y - back.y) / 2);
      const cy = (front.y + back.y) / 2;
      if (layer === 'back') {
        const tl = this.projL(hx, -0.9, 3.95, boardZ);
        const br = this.projL(hx, 0.9, 2.9, boardZ);
        g.fillStyle = '#35b9c6';
        g.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(tl.x, tl.y, (br.x - tl.x) * 0.35, br.y - tl.y);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = Math.max(1.5, 0.04 * tl.s);
        g.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        const sq1 = this.projL(hx, -0.295, RIM_Y + 0.45, boardZ);
        const sq2 = this.projL(hx, 0.295, RIM_Y + 0.02, boardZ);
        g.strokeStyle = this.heat ? '#bfe9ff' : '#ffffff';
        g.strokeRect(sq1.x, sq1.y, sq2.x - sq1.x, sq2.y - sq1.y);
        const bk = this.proj(hx, RIM_Y, boardZ);
        g.strokeStyle = '#c8cdd8';
        g.lineWidth = Math.max(2, 0.04 * c.s);
        g.beginPath();
        g.moveTo(bk.x, bk.y);
        g.lineTo(back.x, back.y);
        g.stroke();
        g.strokeStyle = '#ff7a2e';
        g.lineWidth = Math.max(2.5, 0.035 * c.s);
        g.beginPath();
        g.ellipse(c.x, cy, rx, ry, 0, Math.PI, Math.PI * 2);
        g.stroke();
      } else {
        const strands = 12;
        const sway = Math.sin(performance.now() / 60) * this.netSwing * 0.05;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1, 0.012 * c.s);
        const bottoms = [];
        for (let i = 0; i < strands; i++) {
          const a = (i / strands) * Math.PI * 2;
          const p1 = this.projL(hx, Math.cos(a) * RIM_R, RIM_Y, r.z + Math.sin(a) * RIM_R);
          const p2 = this.projL(hx, Math.cos(a) * 0.13 + sway, RIM_Y - 0.42 + this.netSwing * 0.08, r.z + Math.sin(a) * 0.13);
          bottoms.push(p2);
          g.beginPath();
          g.moveTo(p1.x, p1.y);
          g.lineTo(p2.x, p2.y);
          g.stroke();
        }
        g.beginPath();
        bottoms.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
        g.stroke();
        g.strokeStyle = '#ff7a2e';
        g.lineWidth = Math.max(2.5, 0.035 * c.s);
        g.beginPath();
        g.ellipse(c.x, cy, rx, ry, 0, 0, Math.PI);
        g.stroke();
      }
    }

    drawBall(g, b) {
      const p = this.proj(b.x, b.y, b.z);
      const rad = BALL_R * p.s;
      const sh = this.proj(b.x, 0, b.z);
      if (sh.y < this.H + 40) {
        g.fillStyle = 'rgba(0,0,0,' + UT.clamp(0.35 - b.y * 0.06, 0.05, 0.35) + ')';
        g.beginPath();
        g.ellipse(sh.x, sh.y, rad, rad * 0.3, 0, 0, Math.PI * 2);
        g.fill();
      }
      this.drawBallAt(g, p.x, p.y, rad, b.heat, b.spin);
    }

    drawBallAt(g, x, y, rad, heat, spin) {
      const p = { x, y };
      const b = { heat, spin };
      if (b.heat) {
        g.save();
        g.shadowColor = '#7fd8ff';
        g.shadowBlur = rad * 1.6;
      }
      const bg = g.createRadialGradient(p.x - rad * 0.35, p.y - rad * 0.35, rad * 0.1, p.x, p.y, rad);
      bg.addColorStop(0, b.heat ? '#ffe2b8' : '#ffa463');
      bg.addColorStop(1, b.heat ? '#e0731e' : '#c75a17');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(p.x, p.y, rad, 0, Math.PI * 2);
      g.fill();
      if (b.heat) g.restore();
      g.save();
      g.beginPath();
      g.arc(p.x, p.y, rad, 0, Math.PI * 2);
      g.clip();
      g.strokeStyle = 'rgba(40,15,5,0.75)';
      g.lineWidth = Math.max(1, rad * 0.07);
      g.translate(p.x, p.y);
      g.rotate(b.spin || 0);
      g.beginPath();
      g.moveTo(-rad, 0);
      g.lineTo(rad, 0);
      g.moveTo(0, -rad);
      g.lineTo(0, rad);
      g.stroke();
      g.beginPath();
      g.ellipse(-rad * 0.95, 0, rad * 0.55, rad, 0, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.beginPath();
      g.ellipse(rad * 0.95, 0, rad * 0.55, rad, 0, Math.PI / 2, Math.PI * 1.5);
      g.stroke();
      g.restore();
    }

    /* one scoreboard strip: player + score, shot clock, hi score; round info on a tag below */
    drawHud(g) {
      const P = this.P;
      const r = this.R;
      const W = this.W;
      const w = 470;
      const x = W / 2 - w / 2;
      const y = 6;
      g.fillStyle = '#0b0d10';
      D.rrect(g, x, y, w, 50, 8);
      g.fill();
      /* player + score */
      g.fillStyle = '#2bb6c4';
      D.rrect(g, x + 4, y + 4, 176, 42, 6);
      g.fill();
      g.fillStyle = '#111';
      g.fillRect(x + 42, y + 9, 132, 32);
      g.fillStyle = C.amber;
      g.beginPath();
      g.arc(x + 23, y + 25, 13, 0, Math.PI * 2);
      g.fill();
      D.text(g, String(this.turn + 1), x + 23, y + 26, 15, '#111', { weight: 800 });
      D.text(g, String(P.score), x + 168, y + 26, 26, '#ffd23f', { align: 'right', family: UT.font.display, weight: 400 });
      /* shot clock */
      g.fillStyle = '#9ea3a8';
      D.rrect(g, x + 186, y + 4, 120, 42, 6);
      g.fill();
      D.text(g, 'SHOT CLOCK', x + 246, y + 14, 11, '#1b1b1b', { weight: 800 });
      g.fillStyle = '#111';
      g.fillRect(x + 214, y + 21, 64, 22);
      const tl = Math.ceil(this.timeLeft);
      D.text(g, String(tl).padStart(2, '0'), x + 246, y + 33, 20, '#ff3b30', { family: UT.font.display, weight: 400 });
      /* hi score */
      g.fillStyle = '#9ea3a8';
      D.rrect(g, x + 312, y + 4, 154, 42, 6);
      g.fill();
      D.text(g, 'HI', x + 330, y + 18, 11, '#1b1b1b', { weight: 800 });
      D.text(g, 'SCORE', x + 330, y + 32, 9, '#1b1b1b', { weight: 800 });
      g.fillStyle = '#e8221b';
      g.fillRect(x + 352, y + 9, 108, 32);
      D.text(g, String(Math.max(this.best, P.score)), x + 452, y + 26, 22, '#ffe9b0', { align: 'right', family: UT.font.display, weight: 400 });
      /* round tag */
      const tag = 'ROUND ' + (this.round + 1) + '/' + ROUNDS.length + '   BASKETS ' + this.roundMade + '/' + r.need + '   BALLS ' + this.ballsLeft;
      g.fillStyle = 'rgba(11,13,16,0.82)';
      D.rrect(g, W / 2 - 170, y + 54, 340, 24, 12);
      g.fill();
      D.text(g, tag, W / 2, y + 67, 12, this.roundMade >= r.need ? C.mint : '#f3eee3', { weight: 800 });
      for (let i = 0; i < 3; i++) {
        g.fillStyle = this.heat ? '#7fd8ff' : i < this.streak ? C.amber : 'rgba(255,255,255,0.25)';
        g.beginPath();
        g.arc(W / 2 + 190 + i * 16, y + 66, 6, 0, Math.PI * 2);
        g.fill();
      }
      if (this.players.length > 1) {
        this.players.forEach((pl, i) => {
          D.text(g, 'P' + (i + 1) + ' ' + pl.score, W - 20, 30 + i * 18, 13, pl.out ? 'rgba(255,255,255,0.35)' : i === this.turn ? '#ffd23f' : '#f3eee3', { align: 'right', weight: 800, stroke: '#1a0b08', strokeWidth: 3 });
        });
      }
    }

    shout(g, text, y, size, color) {
      g.save();
      g.translate(this.W / 2, y);
      g.rotate(-0.03);
      D.text(g, text, 0, 0, size, color, { family: UT.font.display, weight: 400, stroke: '#1a0b08', strokeWidth: Math.max(6, size / 6) });
      g.restore();
    }

    dim(g) {
      g.fillStyle = 'rgba(10,6,4,0.6)';
      g.fillRect(0, 0, this.W, this.H);
    }

    drawIntro(g) {
      const r = this.R;
      this.dim(g);
      if (this.players.length > 1) this.shout(g, this.P.name.toUpperCase(), 120, 30, '#5fe3e6');
      this.shout(g, 'ROUND ' + (this.round + 1), 175, 58, '#f3eee3');
      const lines = ['Hoop at ' + r.z.toFixed(1) + ' m · make ' + r.need + ' of ' + BALLS + ' before the shot clock hits 00', 'Tap a shooter just before the hoop slides over his lane', '3 in a row = LIGHTNING: +' + HEAT_BONUS + ' and double points'];
      lines.forEach((t, i) => D.text(g, t, this.W / 2, 232 + i * 26, i ? 15 : 17, i ? '#f3eee3' : '#ffd23f', { weight: 700, stroke: '#1a0b08', strokeWidth: 4 }));
      if (this.stateT > 0.35) D.text(g, 'TAP TO START', this.W / 2, 330, 18, '#5fe3e6', { weight: 800, stroke: '#1a0b08', strokeWidth: 4 });
    }

    drawSummary(g) {
      const r = this.R;
      this.dim(g);
      this.shout(g, this.qualified ? 'NICE SHOOTING!' : 'MISSED THE CUT', 190, 52, this.qualified ? '#f3eee3' : C.coral);
      D.text(g, this.roundMade + ' baskets · needed ' + r.need + ' · ' + this.P.name + ' total ' + this.P.score, this.W / 2, 245, 17, '#ffd23f', { weight: 700, stroke: '#1a0b08', strokeWidth: 4 });
      if (this.stateT > 0.8) D.text(g, 'TAP TO CONTINUE', this.W / 2, 285, 17, '#5fe3e6', { weight: 800, stroke: '#1a0b08', strokeWidth: 4 });
    }

    drawFinal(g) {
      this.dim(g);
      const ranked = this.players.slice().sort((a, b) => b.score - a.score);
      const solo = this.players.length === 1;
      this.shout(g, solo ? 'FINAL BUZZER' : 'WINNER!', 165, 78, '#f6efc8');
      this.shout(g, solo ? 'SCORE ' + ranked[0].score : ranked[0].name.toUpperCase(), 232, 40, '#5fe3e6');
      if (this.stateT > 1) D.text(g, 'TAP TO CONTINUE', this.W / 2, 400, 16, '#f3eee3', { weight: 800, stroke: '#1a0b08', strokeWidth: 4 });
    }
  }

  UT.Swish = Swish;
  UT.Swish.ROUNDS = ROUNDS;
  UT.Swish.LANES = LANES;
})();
