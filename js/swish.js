/* Swish Shot — a timing basketball game for 1–4 players (pass the phone).
 * Mechanics follow the bar-top classic "time each shot; three in a row earns a bonus; the basket moves
 * back each round and slides side to side". Art, rules detail and numbers are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  /* Per-round tuning. z = hoop depth (m), amp/w = side-to-side slide, tol/lat = make window (m),
   * rate = power-needle speed (bar heights per second), need = baskets to qualify. */
  const ROUNDS = [
    { z: 4.2, amp: 0.9, w: 0.95, tol: 0.5, lat: 0.2, pts: 100, need: 4, rate: 1.0 },
    { z: 5.4, amp: 1.2, w: 1.15, tol: 0.45, lat: 0.19, pts: 150, need: 5, rate: 1.15 },
    { z: 6.6, amp: 1.5, w: 1.35, tol: 0.41, lat: 0.18, pts: 200, need: 5, rate: 1.3 },
    { z: 7.8, amp: 1.8, w: 1.55, tol: 0.38, lat: 0.17, pts: 250, need: 6, rate: 1.45 },
  ];
  const ROUND_TIME = 24;
  const Z0 = 2.6;
  const Z1 = 9.6;
  const START = { x: 0, y: 1.25, z: 1.4 };
  const RIM_Y = 3.05;
  const RIM_R = 0.23;
  const BALL_R = 0.12;
  const CAM_Y = 1.75;
  const F = 440;
  const HZ = 360;
  const GRAV = -9.8;
  const COOLDOWN = 0.85;
  const SWISH_BONUS = 50;
  const HEAT_BONUS = 300;

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
      this.beginTurn();
    }

    get P() { return this.players[this.turn]; }
    get R() { return ROUNDS[this.round]; }

    beginTurn() {
      this.state = 'intro';
      this.stateT = 0;
      this.balls = [];
      this.timeLeft = ROUND_TIME;
      this.roundMade = 0;
      this.streak = 0;
      this.heat = false;
      this.cool = 0;
      this.meterPh = Math.random() * 2;
      this.hoopT = Math.random() * 10;
      this.netSwing = 0;
      this.lastTick = 6;
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
      /* crowd dots, regenerated per width so the stands fill the screen */
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
    hoopX(t) {
      const r = this.R;
      const tt = t == null ? this.hoopT : t;
      return r.amp * (0.86 * Math.sin(r.w * tt) + 0.14 * Math.sin(2.3 * r.w * tt + 1.1));
    }
    meter() {
      const ph = this.meterPh % 2;
      return ph < 1 ? ph : 2 - ph;
    }

    /* ---------- input ---------- */
    onDown(x, y) {
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
      if (this.state !== 'play' || this.cool > 0) return;
      this.shoot(x);
    }

    shoot(sx) {
      const r = this.R;
      this.cool = COOLDOWN;
      const p = this.meter();
      const zLand = Z0 + p * (Z1 - Z0);
      /* tap position aims the ball: where you tap at the hoop's depth is where it goes */
      const xt = UT.clamp(((sx - this.W / 2) * r.z) / F, -3, 3);
      const xLand = (xt * (zLand - START.z)) / (r.z - START.z);
      const T = 0.55 + 0.065 * zLand;
      const d = RIM_Y - START.y;
      const h = RIM_Y + 0.7 + 0.06 * zLand - START.y;
      const b = 2 * h + 2 * Math.sqrt(h * h - h * d);
      const a = d - b;
      this.balls.push({
        x: START.x, y: START.y, z: START.z,
        vx: xLand / T, vy: b / T, vz: (zLand - START.z) / T,
        g: (2 * a) / (T * T),
        state: 'flight', decided: false, board: false, life: 0, spin: 0, heat: this.heat,
      });
      this.P.shots++;
      UT.sfx.shoot();
    }

    /* ---------- scoring ---------- */
    make(ball, kind) {
      const r = this.R;
      let pts = r.pts + (kind === 'swish' ? SWISH_BONUS : 0);
      if (this.heat) pts *= 2;
      this.streak++;
      this.roundMade++;
      this.P.made++;
      this.P.score += pts;
      const at = this.proj(this.hoopX(), RIM_Y + 0.6, r.z);
      const label = kind === 'swish' ? 'SWISH +' + pts : kind === 'bank' ? 'BANK +' + pts : '+' + pts;
      this.popups.add(label, at.x, at.y - 20, kind === 'swish' ? C.mint : C.amber, 30);
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
      const dz = ball.z - r.z;
      const e1 = (dx / r.lat) ** 2 + (dz / r.tol) ** 2;
      const e2 = (dx / (r.lat * 1.8)) ** 2 + (dz / (r.tol * 1.45)) ** 2;
      if (e1 <= 1) {
        ball.state = 'in';
        this.make(ball, ball.board ? 'bank' : e1 < 0.3 ? 'swish' : 'make');
      } else if (e2 <= 1) {
        UT.sfx.rim();
        const chance = 0.5 * UT.clamp(1 - (Math.sqrt(e1) - 1) / 0.8, 0, 1);
        if (Math.random() < chance) {
          ball.state = 'rattle';
          ball.vy = 1.3;
          ball.vx = 0;
          ball.vz = 0;
        } else {
          ball.state = 'out';
          ball.vy = 1.6 + Math.random() * 1.2;
          ball.vx = (dx >= 0 ? 1 : -1) * (0.6 + Math.random() * 0.9);
          ball.vz = dz > 0 ? 0.6 : -1.6;
          this.miss();
          this.popups.add('RIM', this.proj(this.hoopX(), RIM_Y + 0.5, r.z).x, this.proj(0, RIM_Y + 0.5, r.z).y, C.dim, 24);
        }
      } else {
        ball.state = 'out';
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
        this.meterPh += dt * this.R.rate * 0.5;
        this.hoopT += dt * 0.5;
        return;
      }
      this.hoopT += dt;
      this.meterPh += dt * this.R.rate;
      this.cool = Math.max(0, this.cool - dt);

      if (this.state === 'play') {
        this.timeLeft -= dt;
        const whole = Math.ceil(this.timeLeft);
        if (whole < this.lastTick && whole > 0) {
          this.lastTick = whole;
          UT.sfx.tick();
        }
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.state = 'horn';
          this.stateT = 0;
          UT.sfx.horn();
        }
      }

      const steps = 4;
      for (let i = 0; i < steps; i++) this.balls.forEach((b) => this.stepBall(b, dt / steps));
      this.balls = this.balls.filter((b) => b.life < 3.2 && b.z > 0.9);

      /* buzzer beaters count: the round ends once every ball in the air has landed */
      if (this.state === 'horn' && this.stateT > 0.6 && this.balls.every((b) => b.decided)) {
        this.endTurn();
      }
    }

    stepBall(b, dt) {
      const r = this.R;
      b.life += dt;
      b.spin += dt * 9;
      const boardZ = r.z + 0.4;
      if (b.state === 'flight') {
        const prevY = b.y;
        b.vy += b.g * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        if (b.vz > 0 && b.z + BALL_R >= boardZ) {
          const hx = this.hoopX();
          if (Math.abs(b.x - hx) < 0.9 + BALL_R && b.y > 2.9 - BALL_R && b.y < 3.95 + BALL_R) {
            b.z = boardZ - BALL_R;
            b.vz = -Math.abs(b.vz) * 0.45;
            b.vx *= 0.6;
            b.board = true;
            UT.sfx.board();
          }
        }
        if (prevY > RIM_Y && b.y <= RIM_Y && b.vy < 0) this.decide(b);
        return;
      }
      if (b.state === 'rattle') {
        b.vy += GRAV * dt;
        b.y += b.vy * dt;
        b.x = UT.lerp(b.x, this.hoopX(), 0.2);
        b.z = UT.lerp(b.z, r.z, 0.2);
        if (b.y <= RIM_Y && b.vy < 0) {
          b.state = 'in';
          this.make(b, 'rattle');
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
          b.vz = -0.4;
        }
        return;
      }
      /* free physics after the shot is decided */
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
      if (b.vz > 0 && b.z + BALL_R > boardZ && b.y > 2.9 && b.y < 3.95 && Math.abs(b.x - this.hoopX()) < 0.9) {
        b.z = boardZ - BALL_R;
        b.vz = -Math.abs(b.vz) * 0.4;
      }
    }

    endTurn() {
      const r = this.R;
      const P = this.P;
      this.qualified = this.roundMade >= r.need;
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
        this.finish();
        return;
      }
      this.turn = first;
      this.beginTurn();
    }

    finish() {
      this.state = 'done';
      const allClear = this.players.some((p) => p.rounds === ROUNDS.length);
      this.onEnd({
        game: 'swish',
        players: this.players.map((p) => ({ name: p.name, score: p.score, made: p.made, shots: p.shots, rounds: p.rounds })),
        allClear,
      });
    }

    /* ---------- drawing ---------- */
    draw(g) {
      const W = this.W;
      const H = this.H;
      const r = this.R;
      /* arena */
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
      /* back wall band with the track the hoop rides on */
      g.fillStyle = '#10172b';
      g.fillRect(0, 312, W, 104);
      g.fillStyle = C.amber;
      g.fillRect(0, 312, W, 3);
      D.text(g, 'ULTRATOUCH ARENA', W / 2, 360, 26, 'rgba(243,238,227,0.08)', { family: UT.font.display, weight: 400 });

      /* floor */
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
      g.strokeStyle = 'rgba(70,40,15,0.35)';
      g.lineWidth = 1;
      for (let i = -24; i <= 24; i++) {
        const bx = W / 2 + i * 70;
        g.beginPath();
        g.moveTo(W / 2 + i * 6, floorTop);
        g.lineTo(bx, H);
        g.stroke();
      }
      /* rail across the floor under the hoop */
      const railZ = r.z + 1.0;
      const ry = this.proj(0, 0, railZ).y;
      g.fillStyle = 'rgba(20,12,4,0.45)';
      g.fillRect(0, ry - 2, W, 5);
      /* free-throw style arc at the current distance */
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 2;
      const lineZ = Math.max(4.4, r.z - 2.2);
      const ly = this.proj(0, 0, lineZ).y;
      g.beginPath();
      g.moveTo(0, ly);
      g.lineTo(W, ly);
      g.stroke();
      g.restore();

      this.drawHoop(g, 'back');
      /* balls at the hoop sit between the back and front of the rim; the rest are drawn on top */
      const atHoop = (b) => b.z >= r.z - 0.3 && (b.state !== 'flight' || b.y < RIM_Y + 0.4);
      this.balls.filter(atHoop).forEach((b) => this.drawBall(g, b));
      this.drawHoop(g, 'front');
      this.balls.filter((b) => !atHoop(b)).forEach((b) => this.drawBall(g, b));

      /* next ball, rising into the hands */
      if (this.state === 'play' || this.state === 'intro') {
        const k = this.cool > 0 ? 1 - this.cool / COOLDOWN : 1;
        const rest = { x: START.x, y: START.y - 0.6 * (1 - UT.ease(k)), z: START.z, spin: 0, heat: this.heat, state: 'rest' };
        this.drawBall(g, rest);
      }

      if (this.flash > 0) {
        g.fillStyle = 'rgba(255,93,93,' + this.flash * 0.25 + ')';
        g.fillRect(0, 0, W, H);
      }
      this.drawMeter(g);
      this.drawHud(g);
      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'summary') this.drawSummary(g);
      if (this.state === 'horn') D.text(g, 'TIME!', W / 2, 250, 64, C.coral, { family: UT.font.display, weight: 400, stroke: C.ink, strokeWidth: 8 });
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
        /* stanchion */
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
        g.strokeStyle = C.amber;
        g.lineWidth = 0.05 * bs;
        g.beginPath();
        g.moveTo(base.x, base.y - 0.4 * bs);
        g.lineTo(base.x, base.y - 1.6 * bs);
        g.stroke();
        /* glass board */
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
        /* bracket */
        const bk = this.proj(hx, RIM_Y, boardZ);
        g.strokeStyle = '#c8cdd8';
        g.lineWidth = Math.max(2, 0.04 * c.s);
        g.beginPath();
        g.moveTo(bk.x, bk.y);
        g.lineTo(back.x, back.y);
        g.stroke();
        /* back half of the rim */
        g.strokeStyle = '#ff7a2e';
        g.lineWidth = Math.max(2.5, 0.035 * c.s);
        g.beginPath();
        g.ellipse(c.x, cy, rx, ry, 0, Math.PI, Math.PI * 2);
        g.stroke();
      } else {
        /* net */
        const strands = 12;
        const sway = Math.sin(performance.now() / 60) * this.netSwing * 0.05;
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1, 0.012 * c.s);
        const bottoms = [];
        for (let i = 0; i < strands; i++) {
          const a = (i / strands) * Math.PI * 2;
          const tx = hx + Math.cos(a) * RIM_R;
          const tz = r.z + Math.sin(a) * RIM_R;
          const bx = hx + Math.cos(a) * 0.13 + sway;
          const bz = r.z + Math.sin(a) * 0.13;
          const p1 = this.proj(tx, RIM_Y, tz);
          const p2 = this.proj(bx, RIM_Y - 0.42 + this.netSwing * 0.08, bz);
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
        /* front half of the rim */
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
      if (b.state !== 'rest') {
        const sh = this.proj(b.x, 0, b.z);
        if (sh.y < this.H + 40) {
          g.fillStyle = 'rgba(0,0,0,' + UT.clamp(0.35 - b.y * 0.06, 0.05, 0.35) + ')';
          g.beginPath();
          g.ellipse(sh.x, sh.y, rad, rad * 0.3, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
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

    drawMeter(g) {
      const r = this.R;
      const x = this.W - 74;
      const top = 96;
      const bot = 470;
      const h = bot - top;
      const w = 30;
      g.fillStyle = 'rgba(13,19,33,0.75)';
      D.rrect(g, x - 12, top - 34, w + 24, h + 60, 14);
      g.fill();
      D.text(g, 'POWER', x + w / 2, top - 17, 12, C.dim, { weight: 700 });
      const grd = g.createLinearGradient(0, bot, 0, top);
      grd.addColorStop(0, '#2c5e8f');
      grd.addColorStop(1, '#7b3a7f');
      g.fillStyle = grd;
      D.rrect(g, x, top, w, h, 8);
      g.fill();
      /* the sweet band for this hoop distance */
      const pc = (r.z - Z0) / (Z1 - Z0);
      const half = r.tol / (Z1 - Z0);
      const y1 = bot - (pc + half) * h;
      const y2 = bot - (pc - half) * h;
      g.save();
      g.shadowColor = C.amber;
      g.shadowBlur = 12;
      g.fillStyle = C.amber;
      g.fillRect(x - 3, y1, w + 6, y2 - y1);
      g.restore();
      /* needle */
      const p = this.meter();
      const ny = bot - p * h;
      const inBand = ny >= y1 && ny <= y2;
      g.fillStyle = inBand ? '#ffffff' : C.text;
      g.fillRect(x - 8, ny - 2, w + 16, 4);
      g.beginPath();
      g.moveTo(x - 10, ny - 8);
      g.lineTo(x - 1, ny);
      g.lineTo(x - 10, ny + 8);
      g.fill();
      D.text(g, r.z.toFixed(1) + ' m', x + w / 2, bot + 14, 12, C.dim, { weight: 600 });
    }

    drawHud(g) {
      const P = this.P;
      const r = this.R;
      const W = this.W;
      g.fillStyle = 'rgba(13,19,33,0.78)';
      D.rrect(g, 96, 10, 230, 62, 12);
      g.fill();
      D.text(g, P.name.toUpperCase(), 112, 28, 13, C.dim, { align: 'left', weight: 700 });
      D.text(g, P.score.toLocaleString(), 112, 54, 28, C.text, { align: 'left', family: UT.font.display, weight: 400 });
      /* clock */
      g.fillStyle = 'rgba(13,19,33,0.78)';
      D.rrect(g, W / 2 - 80, 10, 160, 62, 12);
      g.fill();
      D.text(g, 'ROUND ' + (this.round + 1) + '/' + ROUNDS.length, W / 2, 26, 12, C.dim, { weight: 700 });
      const tl = Math.ceil(this.timeLeft);
      D.text(g, ':' + String(tl).padStart(2, '0'), W / 2, 52, 30, tl <= 5 && this.state === 'play' ? C.coral : C.amber, { family: UT.font.display, weight: 400 });
      /* goal + streak */
      g.fillStyle = 'rgba(13,19,33,0.78)';
      D.rrect(g, W - 330, 10, 220, 62, 12);
      g.fill();
      const ok = this.roundMade >= r.need;
      D.text(g, 'BASKETS ' + this.roundMade + ' / ' + r.need, W - 316, 30, 15, ok ? C.mint : C.text, { align: 'left', weight: 800 });
      D.text(g, this.heat ? 'HEAT · 2× POINTS' : 'STREAK', W - 316, 54, 12, this.heat ? C.coral : C.dim, { align: 'left', weight: 700 });
      for (let i = 0; i < 3; i++) {
        const lit = this.heat || i < this.streak;
        g.fillStyle = lit ? (this.heat ? C.coral : C.amber) : '#2e3d63';
        g.beginPath();
        g.arc(W - 196 + i * 22 + (this.heat ? 30 : 0), 54, 7, 0, Math.PI * 2);
        g.fill();
      }
      if (this.players.length > 1) {
        let x = 112;
        this.players.forEach((pl, i) => {
          const txt = 'P' + (i + 1) + ' ' + pl.score.toLocaleString();
          D.text(g, txt, x, 88, 12, pl.out ? '#56607e' : i === this.turn ? C.amber : C.dim, { align: 'left', weight: 700 });
          x += 92;
        });
      }
    }

    panel(g, w, h) {
      const x = this.W / 2 - w / 2;
      const y = this.H / 2 - h / 2 + 10;
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
      const { y } = this.panel(g, 440, 230);
      const cx = this.W / 2;
      if (this.players.length > 1) D.text(g, this.P.name.toUpperCase() + ', YOU’RE UP', cx, y + 30, 14, C.amber, { weight: 800 });
      D.text(g, 'ROUND ' + (this.round + 1), cx, y + 70, 40, C.text, { family: UT.font.display, weight: 400 });
      D.text(g, 'Hoop at ' + r.z.toFixed(1) + ' m · make ' + r.need + ' in ' + ROUND_TIME + ' seconds', cx, y + 112, 17, C.text, { weight: 600 });
      D.text(g, 'Tap the hoop when the needle is in the gold band', cx, y + 142, 14, C.dim, { weight: 500 });
      D.text(g, '3 in a row = HEAT bonus and double points', cx, y + 164, 14, C.dim, { weight: 500 });
      if (this.stateT > 0.35) D.text(g, 'TAP TO START', cx, y + 202, 16, C.amber, { weight: 800 });
    }

    drawSummary(g) {
      const r = this.R;
      const { y } = this.panel(g, 440, 210);
      const cx = this.W / 2;
      D.text(g, this.qualified ? 'QUALIFIED' : 'MISSED THE CUT', cx, y + 52, 34, this.qualified ? C.mint : C.coral, { family: UT.font.display, weight: 400 });
      D.text(g, this.roundMade + ' baskets · needed ' + r.need, cx, y + 96, 18, C.text, { weight: 600 });
      D.text(g, this.P.name + ' total: ' + this.P.score.toLocaleString(), cx, y + 126, 16, C.dim, { weight: 600 });
      if (this.stateT > 0.8) D.text(g, 'TAP TO CONTINUE', cx, y + 178, 16, C.amber, { weight: 800 });
    }
  }

  UT.Swish = Swish;
  UT.Swish.ROUNDS = ROUNDS;
})();
