/* Swish Shot — a lane-timing basketball game for 1–4 players (pass the phone).
 * Five shooters stand in a row; one hoop slides side to side across their lanes. Tap the shooter whose lane
 * the hoop is about to cross so the ball arrives as it passes. Three in a row earns a bonus, and the hoop
 * backs up each round. Mechanics follow the bar-top classic; art, rules detail and numbers are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  /* z = hoop depth (m); w = slide speed (rad/s); lat = make window either side of the rim centre (m);
   * need = baskets out of BALLS to qualify; pts = per basket. */
  const ROUNDS = [
    { z: 4.6, w: 0.9, lat: 0.24, need: 6, pts: 100 },
    { z: 5.6, w: 1.05, lat: 0.23, need: 7, pts: 150 },
    { z: 6.6, w: 1.2, lat: 0.22, need: 7, pts: 200 },
    { z: 7.6, w: 1.35, lat: 0.21, need: 8, pts: 250 },
    { z: 8.6, w: 1.5, lat: 0.2, need: 8, pts: 300 },
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
  const GAP = 0.45; /* seconds between any two shots */
  const RELOAD = 1.4; /* seconds before the same shooter has a ball again */
  const SWISH_BONUS = 50;
  const HEAT_BONUS = 300;
  const JERSEY = ['#ffb627', '#3ddc97', '#58b4ff', '#ff5d5d', '#c792ea'];
  const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#5a3825'];

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
      this.spacing = 1;
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
    proj(x, y, z) {
      const s = F / z;
      return { x: this.W / 2 + x * s, y: HZ + (CAM_Y - y) * s, s };
    }
    laneX(i) { return (i - (LANES - 1) / 2) * this.spacing; }
    amp() { return this.spacing * 2.25; }
    hoopX(t) {
      const tt = t == null ? this.hoopT : t;
      /* mostly a steady glide, with a little wobble so it can't be counted by rhythm alone */
      return this.amp() * (0.88 * Math.sin(this.R.w * tt) + 0.12 * Math.sin(2.7 * this.R.w * tt + 0.8));
    }
    flightTime() { return 0.5 + 0.06 * (this.R.z - SHOOTER_Z); }

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
        x: this.laneX(lane), y: y0, z: SHOOTER_Z + 0.15,
        vx: 0, vy: b / T, vz: (r.z - SHOOTER_Z - 0.15) / T,
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
      UT.sfx.swish();
      if (this.streak === 3 && !this.heat) {
        this.heat = true;
        this.P.score += HEAT_BONUS;
        this.flash = 1;
        this.popups.add('HEAT! +' + HEAT_BONUS + ' · 2× POINTS', this.W / 2, 300, C.coral, 34);
        UT.sfx.heat();
      }
    }
    miss() {
      if (this.heat) this.popups.add('COOLED OFF', this.W / 2, 300, C.sky, 26);
      this.streak = 0;
      this.heat = false;
    }

    decide(ball) {
      const r = this.R;
      ball.decided = true;
      const dx = ball.x - this.hoopX();
      const ax = Math.abs(dx);
      if (ax <= r.lat) {
        ball.state = 'in';
        this.make(ax < r.lat * 0.45 ? 'swish' : 'make');
      } else if (ax <= r.lat * 1.9) {
        UT.sfx.rim();
        const chance = 0.45 * (1 - (ax - r.lat) / (r.lat * 0.9));
        if (Math.random() < chance) {
          ball.state = 'rattle';
          ball.vy = 1.3;
        } else {
          ball.state = 'out';
          ball.vy = 1.6 + Math.random();
          ball.vx = (dx >= 0 ? 1 : -1) * (0.7 + Math.random() * 0.8);
          ball.vz = -1.4;
          this.miss();
          const p = this.proj(this.hoopX(), RIM_Y + 0.5, r.z);
          this.popups.add('RIM', p.x, p.y, C.dim, 24);
        }
      } else {
        ball.state = 'out';
        ball.vz = 0.5;
        this.miss();
      }
    }

    /* ---------- loop ---------- */
    update(dt) {
      this.stateT += dt;
      this.flash = Math.max(0, this.flash - dt * 1.5);
      this.netSwing = Math.max(0, this.netSwing - dt * 1.6);
      this.popups.update(dt);
      if (this.state === 'intro' || this.state === 'summary') {
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
      if (b.vz > 0 && b.z + BALL_R > boardZ && b.y > 2.9 && b.y < 3.95 && Math.abs(b.x - this.hoopX()) < 0.9) {
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
      this.state = 'done';
      this.onEnd({
        game: 'swish',
        rounds: ROUNDS.length,
        allClear: this.players.some((p) => p.rounds === ROUNDS.length),
        players: this.players.map((p) => ({ name: p.name, score: p.score, made: p.made, shots: p.shots, rounds: p.rounds })),
      });
    }

    /* ---------- drawing ---------- */
    draw(g) {
      const W = this.W;
      const H = this.H;
      const r = this.R;
      const sky = g.createLinearGradient(0, 0, 0, HZ + 60);
      sky.addColorStop(0, '#070b16');
      sky.addColorStop(1, '#1a2547');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 3; i++) {
        const lx = W * (0.2 + i * 0.3);
        const lg = g.createRadialGradient(lx, 0, 10, lx, 0, 260);
        lg.addColorStop(0, 'rgba(255,214,140,0.22)');
        lg.addColorStop(1, 'rgba(255,214,140,0)');
        g.fillStyle = lg;
        g.fillRect(lx - 260, 0, 520, 280);
      }
      const crowdCols = ['#2b3a66', '#36457a', '#46355e', '#5a3b4c', '#2f4f5e'];
      const t = performance.now() / 1000;
      const cheer = this.flash > 0 || this.netSwing > 0.5 ? 3 : 0.6;
      this.crowd.forEach((p) => {
        g.fillStyle = crowdCols[Math.floor(p.c * crowdCols.length)];
        g.beginPath();
        g.arc(p.x, p.y + Math.sin(t * 6 + p.ph) * cheer, p.r, 0, Math.PI * 2);
        g.fill();
      });
      g.fillStyle = '#10172b';
      g.fillRect(0, 312, W, 104);
      g.fillStyle = C.amber;
      g.fillRect(0, 312, W, 3);
      D.text(g, 'ULTRATOUCH ARENA', W / 2, 360, 26, 'rgba(243,238,227,0.08)', { family: UT.font.display, weight: 400 });

      /* floor with the five lanes painted on it */
      const floorTop = HZ + (CAM_Y * F) / 14;
      const fg = g.createLinearGradient(0, floorTop, 0, H);
      fg.addColorStop(0, '#8a5a2b');
      fg.addColorStop(1, '#d99a54');
      g.fillStyle = fg;
      g.fillRect(0, floorTop, W, H - floorTop);
      g.save();
      g.beginPath();
      g.rect(0, floorTop, W, H - floorTop);
      g.clip();
      g.strokeStyle = 'rgba(70,40,15,0.3)';
      g.lineWidth = 1;
      for (let i = -24; i <= 24; i++) {
        g.beginPath();
        g.moveTo(W / 2 + i * 6, floorTop);
        g.lineTo(W / 2 + i * 70, H);
        g.stroke();
      }
      for (let i = 0; i <= LANES; i++) {
        const x = (i - LANES / 2) * this.spacing;
        const a = this.proj(x, 0, SHOOTER_Z);
        const b = this.proj(x, 0, r.z + 1.2);
        g.strokeStyle = 'rgba(255,255,255,0.28)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(a.x, Math.min(a.y, H + 400));
        g.lineTo(b.x, b.y);
        g.stroke();
      }
      const rail = this.proj(0, 0, r.z + 1.0).y;
      g.fillStyle = 'rgba(20,12,4,0.45)';
      g.fillRect(0, rail - 2, W, 5);
      g.restore();

      const atHoop = (b) => b.z >= r.z - 0.3 && (b.state !== 'flight' || b.y < RIM_Y + 0.4);
      this.drawHoop(g, 'back');
      this.balls.filter(atHoop).forEach((b) => this.drawBall(g, b));
      this.drawHoop(g, 'front');
      this.balls.filter((b) => !atHoop(b)).forEach((b) => this.drawBall(g, b));

      for (let i = 0; i < LANES; i++) this.drawShooter(g, i);

      if (this.flash > 0) {
        g.fillStyle = 'rgba(255,93,93,' + this.flash * 0.25 + ')';
        g.fillRect(0, 0, W, H);
      }
      this.drawHud(g);
      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'summary') this.drawSummary(g);
      if (this.state === 'horn') D.text(g, this.timeLeft <= 0 ? 'TIME!' : 'OUT OF BALLS', W / 2, 250, 56, C.coral, { family: UT.font.display, weight: 400, stroke: C.ink, strokeWidth: 8 });
    }

    drawShooter(g, i) {
      /* seen from behind, kept short so the held ball stays below the rim line */
      const p = this.proj(this.laneX(i), 0, SHOOTER_Z);
      const s = p.s * 0.62;
      const cx = p.x;
      const base = this.H + 6;
      const sw = 0.55 * s;
      const shoulderY = this.H - 0.62 * s;
      const holdY = shoulderY - 0.62 * s;
      const loaded = this.reload[i] <= 0 && this.ballsLeft > 0 && (this.state === 'play' || this.state === 'intro');
      const k = this.reload[i] > 0 ? 1 - this.reload[i] / RELOAD : 1;
      const skin = SKIN[i % SKIN.length];
      g.strokeStyle = skin;
      g.lineCap = 'round';
      g.lineWidth = 0.12 * s;
      const handY = loaded ? holdY + 0.12 * s : shoulderY + 0.15 * s;
      const handX = loaded ? 0.14 * s : 0.45 * s;
      g.beginPath();
      g.moveTo(cx - sw * 0.42, shoulderY + 0.06 * s);
      g.lineTo(cx - handX, handY);
      g.moveTo(cx + sw * 0.42, shoulderY + 0.06 * s);
      g.lineTo(cx + handX, handY);
      g.stroke();
      g.fillStyle = JERSEY[i % JERSEY.length];
      g.beginPath();
      g.moveTo(cx - sw / 2, shoulderY);
      g.quadraticCurveTo(cx, shoulderY - 0.08 * s, cx + sw / 2, shoulderY);
      g.lineTo(cx + sw * 0.44, base);
      g.lineTo(cx - sw * 0.44, base);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(13,19,33,0.22)';
      g.fillRect(cx - sw * 0.44, shoulderY + 0.03 * s, sw * 0.1, base - shoulderY);
      g.fillRect(cx + sw * 0.34, shoulderY + 0.03 * s, sw * 0.1, base - shoulderY);
      D.text(g, String(i + 1), cx, shoulderY + 0.33 * s, Math.round(0.3 * s), C.ink, { family: UT.font.display, weight: 400 });
      g.fillStyle = skin;
      g.beginPath();
      g.arc(cx, shoulderY - 0.15 * s, 0.13 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1b1410';
      g.beginPath();
      g.arc(cx, shoulderY - 0.18 * s, 0.13 * s, Math.PI * 1.05, Math.PI * 1.95);
      g.fill();
      if (this.ballsLeft > 0 && (this.state === 'play' || this.state === 'intro')) {
        const y = loaded ? holdY : UT.lerp(this.H + 30, holdY, UT.ease(k));
        this.drawBallAt(g, cx, y, 0.17 * s, this.heat, 0);
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
        const poleZ = boardZ + 0.6;
        const base = this.proj(hx, 0, poleZ);
        const top = this.proj(hx, 3.4, poleZ);
        const bs = base.s;
        g.fillStyle = '#1d2236';
        D.rrect(g, base.x - 0.55 * bs, base.y - 0.25 * bs, 1.1 * bs, 0.3 * bs, 4);
        g.fill();
        g.strokeStyle = '#2b3150';
        g.lineWidth = 0.16 * bs;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(base.x, base.y - 0.1 * bs);
        g.lineTo(top.x, top.y);
        const arm = this.proj(hx, 3.4, boardZ);
        g.lineTo(arm.x, arm.y);
        g.stroke();
        const tl = this.proj(hx - 0.9, 3.95, boardZ);
        const br = this.proj(hx + 0.9, 2.9, boardZ);
        g.fillStyle = 'rgba(220,235,255,0.22)';
        g.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = Math.max(1.5, 0.04 * tl.s);
        g.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        const sq1 = this.proj(hx - 0.295, RIM_Y + 0.45, boardZ);
        const sq2 = this.proj(hx + 0.295, RIM_Y + 0.02, boardZ);
        g.strokeStyle = this.heat ? C.coral : C.amber;
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
          const p1 = this.proj(hx + Math.cos(a) * RIM_R, RIM_Y, r.z + Math.sin(a) * RIM_R);
          const p2 = this.proj(hx + Math.cos(a) * 0.13 + sway, RIM_Y - 0.42 + this.netSwing * 0.08, r.z + Math.sin(a) * 0.13);
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
        g.shadowColor = C.coral;
        g.shadowBlur = rad * 1.2;
      }
      const bg = g.createRadialGradient(p.x - rad * 0.35, p.y - rad * 0.35, rad * 0.1, p.x, p.y, rad);
      bg.addColorStop(0, b.heat ? '#ffb38a' : '#ffa463');
      bg.addColorStop(1, b.heat ? '#d4321e' : '#c75a17');
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

    drawHud(g) {
      const P = this.P;
      const r = this.R;
      const W = this.W;
      g.fillStyle = 'rgba(13,19,33,0.78)';
      D.rrect(g, 96, 10, 220, 62, 12);
      g.fill();
      D.text(g, P.name.toUpperCase(), 112, 28, 13, C.dim, { align: 'left', weight: 700 });
      D.text(g, P.score.toLocaleString(), 112, 54, 28, C.text, { align: 'left', family: UT.font.display, weight: 400 });
      g.fillStyle = 'rgba(13,19,33,0.78)';
      D.rrect(g, W / 2 - 80, 10, 160, 62, 12);
      g.fill();
      D.text(g, 'ROUND ' + (this.round + 1) + '/' + ROUNDS.length, W / 2, 26, 12, C.dim, { weight: 700 });
      const tl = Math.ceil(this.timeLeft);
      D.text(g, ':' + String(tl).padStart(2, '0'), W / 2, 52, 30, tl <= 5 && this.state === 'play' ? C.coral : C.amber, { family: UT.font.display, weight: 400 });
      g.fillStyle = 'rgba(13,19,33,0.78)';
      D.rrect(g, W - 250, 10, 234, 62, 12);
      g.fill();
      const ok = this.roundMade >= r.need;
      D.text(g, 'BASKETS ' + this.roundMade + ' / ' + r.need, W - 236, 28, 14, ok ? C.mint : C.text, { align: 'left', weight: 800 });
      D.text(g, 'BALLS ' + this.ballsLeft, W - 236, 52, 12, this.ballsLeft <= 3 ? C.coral : C.dim, { align: 'left', weight: 700 });
      for (let i = 0; i < 3; i++) {
        const lit = this.heat || i < this.streak;
        g.fillStyle = lit ? (this.heat ? C.coral : C.amber) : '#2e3d63';
        g.beginPath();
        g.arc(W - 140 + i * 20, 52, 7, 0, Math.PI * 2);
        g.fill();
      }
      if (this.heat) D.text(g, 'HEAT 2×', W - 72, 52, 12, C.coral, { weight: 800 });
      if (this.players.length > 1) {
        let x = 112;
        this.players.forEach((pl, i) => {
          D.text(g, 'P' + (i + 1) + ' ' + pl.score.toLocaleString(), x, 88, 12, pl.out ? '#56607e' : i === this.turn ? C.amber : C.dim, { align: 'left', weight: 700 });
          x += 92;
        });
      }
    }

    panel(g, w, h) {
      const x = this.W / 2 - w / 2;
      const y = this.H / 2 - h / 2 - 40;
      g.fillStyle = 'rgba(7,11,22,0.55)';
      g.fillRect(0, 0, this.W, this.H);
      g.fillStyle = 'rgba(20,29,51,0.96)';
      D.rrect(g, x, y, w, h, 18);
      g.fill();
      g.strokeStyle = C.amber;
      g.lineWidth = 2;
      g.stroke();
      return { x, y };
    }

    drawIntro(g) {
      const r = this.R;
      const { y } = this.panel(g, 470, 230);
      const cx = this.W / 2;
      if (this.players.length > 1) D.text(g, this.P.name.toUpperCase() + ', YOU’RE UP', cx, y + 28, 14, C.amber, { weight: 800 });
      D.text(g, 'ROUND ' + (this.round + 1), cx, y + 66, 40, C.text, { family: UT.font.display, weight: 400 });
      D.text(g, 'Hoop at ' + r.z.toFixed(1) + ' m · make ' + r.need + ' of ' + BALLS + ' in ' + ROUND_TIME + ' s', cx, y + 108, 17, C.text, { weight: 600 });
      D.text(g, 'Tap a shooter just before the hoop slides over his lane', cx, y + 138, 14, C.dim, { weight: 500 });
      D.text(g, '3 in a row = HEAT bonus and double points', cx, y + 160, 14, C.dim, { weight: 500 });
      if (this.stateT > 0.35) D.text(g, 'TAP TO START', cx, y + 200, 16, C.amber, { weight: 800 });
    }

    drawSummary(g) {
      const r = this.R;
      const { y } = this.panel(g, 440, 200);
      const cx = this.W / 2;
      D.text(g, this.qualified ? 'QUALIFIED' : 'MISSED THE CUT', cx, y + 48, 34, this.qualified ? C.mint : C.coral, { family: UT.font.display, weight: 400 });
      D.text(g, this.roundMade + ' baskets · needed ' + r.need, cx, y + 92, 18, C.text, { weight: 600 });
      D.text(g, this.P.name + ' total: ' + this.P.score.toLocaleString(), cx, y + 122, 16, C.dim, { weight: 600 });
      if (this.stateT > 0.8) D.text(g, 'TAP TO CONTINUE', cx, y + 170, 16, C.amber, { weight: 800 });
    }
  }

  UT.Swish = Swish;
  UT.Swish.ROUNDS = ROUNDS;
  UT.Swish.LANES = LANES;
})();
