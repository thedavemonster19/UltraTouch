/* UltraTouch core: storage, scores, sound, canvas stage, drawing helpers. */
(function () {
  'use strict';
  const UT = (window.UT = window.UT || {});

  /* ---------- storage (never throws) ---------- */
  UT.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('ut:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('ut:' + key, JSON.stringify(value));
      } catch (e) { /* private mode or blocked storage: play on without saving */ }
    },
  };

  /* ---------- high scores: top 5 per game ---------- */
  UT.scores = {
    list(game) {
      const l = UT.store.get('hs:' + game, []);
      return Array.isArray(l) ? l : [];
    },
    best(game) {
      const l = this.list(game);
      return l.length ? l[0].score : 0;
    },
    /* returns the 0-based rank of the new score, or -1 if it did not make the table */
    add(game, score, label) {
      const l = this.list(game);
      const entry = { score: Math.round(score), label: label || '', date: new Date().toISOString().slice(0, 10), t: Date.now() };
      l.push(entry);
      l.sort((a, b) => b.score - a.score || a.t - b.t);
      const top = l.slice(0, 5);
      UT.store.set('hs:' + game, top);
      return top.indexOf(entry);
    },
  };

  /* ---------- sound: tiny Web Audio synth, no files ---------- */
  UT.sfx = (function () {
    let ac = null;
    let muted = !!UT.store.get('muted', false);
    function ctx() {
      if (!ac) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return null;
        try { ac = new A(); } catch (e) { return null; }
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function tone(freq, dur, type, vol, slideTo, delay) {
      if (muted) return;
      const c = ctx();
      if (!c) return;
      const t = c.currentTime + (delay || 0);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(vol == null ? 0.12 : vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    }
    let noiseBuf = null;
    function noise(dur, vol, freq, q, delay) {
      if (muted) return;
      const c = ctx();
      if (!c) return;
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = c.currentTime + (delay || 0);
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq || 1500;
      f.Q.value = q || 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t);
      src.stop(t + dur + 0.03);
    }
    return {
      unlock() { ctx(); },
      get muted() { return muted; },
      setMuted(m) { muted = !!m; UT.store.set('muted', muted); },
      tap() { tone(700, 0.05, 'triangle', 0.1); },
      shoot() { noise(0.22, 0.12, 700, 0.6); },
      swish() { noise(0.35, 0.22, 4200, 0.7); noise(0.25, 0.1, 2500, 1, 0.05); },
      rim() { tone(260, 0.18, 'square', 0.08, 180); tone(390, 0.12, 'triangle', 0.08); },
      board() { tone(110, 0.16, 'sine', 0.25, 70); },
      bounce() { tone(90, 0.1, 'sine', 0.18, 60); },
      heat() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.07, 0, i * 0.06)); },
      horn() { tone(140, 0.7, 'sawtooth', 0.12); tone(147, 0.7, 'square', 0.06); },
      tick() { tone(1400, 0.03, 'square', 0.05); },
      select() { tone(880, 0.05, 'triangle', 0.1); },
      match(n) { const b = 520 + Math.min(n || 0, 8) * 40; tone(b, 0.08, 'triangle', 0.12); tone(b * 1.5, 0.12, 'triangle', 0.1, 0, 0.06); },
      nope() { tone(160, 0.14, 'square', 0.08, 120); },
      deal() { noise(0.06, 0.1, 3000, 1.2); },
      win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'triangle', 0.1, 0, i * 0.09)); },
      lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, 0, i * 0.16)); },
    };
  })();

  /* ---------- palette shared by the canvas games ---------- */
  UT.col = {
    ink: '#0d1321',
    night: '#141d33',
    panel: '#1c2742',
    line: '#2e3d63',
    text: '#f3eee3',
    dim: '#9aa6c4',
    amber: '#ffb627',
    coral: '#ff5d5d',
    mint: '#3ddc97',
    sky: '#58b4ff',
  };
  UT.font = {
    display: "'Bungee', 'Arial Black', Impact, sans-serif",
    ui: "'Rubik', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  };

  /* ---------- drawing helpers ---------- */
  UT.draw = {
    rrect(g, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    },
    text(g, str, x, y, size, color, opts) {
      opts = opts || {};
      g.font = (opts.weight || 700) + ' ' + size + 'px ' + (opts.family || UT.font.ui);
      g.textAlign = opts.align || 'center';
      g.textBaseline = opts.baseline || 'middle';
      if (opts.stroke) {
        g.lineJoin = 'round';
        g.lineWidth = opts.strokeWidth || Math.max(3, size / 7);
        g.strokeStyle = opts.stroke;
        g.strokeText(str, x, y);
      }
      g.fillStyle = color;
      g.fillText(str, x, y);
    },
  };
  UT.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  UT.lerp = (a, b, t) => a + (b - a) * t;
  UT.ease = (t) => 1 - Math.pow(1 - UT.clamp(t, 0, 1), 3);

  /* Floating score popups shared by both games */
  UT.Popups = class {
    constructor() { this.items = []; }
    add(text, x, y, color, size) { this.items.push({ text, x, y, color: color || UT.col.amber, size: size || 30, t: 0 }); }
    update(dt) { this.items.forEach((p) => (p.t += dt)); this.items = this.items.filter((p) => p.t < 1.2); }
    draw(g) {
      this.items.forEach((p) => {
        g.globalAlpha = 1 - UT.clamp((p.t - 0.7) / 0.5, 0, 1);
        const s = p.size * (1 + 0.25 * Math.max(0, 0.15 - p.t) / 0.15);
        UT.draw.text(g, p.text, p.x, p.y - p.t * 50, s, p.color, { family: UT.font.display, weight: 400, stroke: UT.col.ink });
      });
      g.globalAlpha = 1;
    }
  };

  /* ---------- stage: fixed 540-unit-tall logical canvas, width follows the screen ---------- */
  UT.Stage = class {
    constructor(canvas) {
      this.canvas = canvas;
      this.g = canvas.getContext('2d');
      this.H = 540;
      this.W = 960;
      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.game = null;
      this.paused = false;
      this.last = 0;
      this.raf = 0;
      this.resize = this.resize.bind(this);
      this.frame = this.frame.bind(this);
      window.addEventListener('resize', this.resize);
      window.addEventListener('orientationchange', () => setTimeout(this.resize, 200));
      const toLogical = (e) => {
        const r = this.canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left - this.ox) / this.scale, y: (e.clientY - r.top - this.oy) / this.scale };
      };
      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        UT.sfx.unlock();
        if (!this.game || this.paused) return;
        const p = toLogical(e);
        this.game.onDown && this.game.onDown(p.x, p.y);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!this.game || this.paused || !this.game.onMove) return;
        const p = toLogical(e);
        this.game.onMove(p.x, p.y);
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const aspect = r.width / r.height;
      this.W = Math.round(UT.clamp(540 * aspect, 760, 1240));
      this.H = 540;
      this.scale = Math.min(r.width / this.W, r.height / this.H);
      this.ox = (r.width - this.W * this.scale) / 2;
      this.oy = (r.height - this.H * this.scale) / 2;
      this.dpr = dpr;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      if (this.game && this.game.resize) this.game.resize(this.W, this.H);
      this.render();
    }
    run(game) {
      this.stop();
      this.game = game;
      this.paused = false;
      this.resize();
      if (game.resize) game.resize(this.W, this.H);
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.game && this.game.destroy) this.game.destroy();
      this.game = null;
      this.render();
    }
    frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.game && !this.paused) this.game.update(dt);
      this.render();
      if (this.game) this.raf = requestAnimationFrame(this.frame);
    }
    render() {
      const g = this.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = UT.col.ink;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.game) return;
      const s = this.dpr * this.scale;
      g.setTransform(s, 0, 0, s, this.dpr * this.ox, this.dpr * this.oy);
      g.save();
      g.beginPath();
      g.rect(0, 0, this.W, this.H);
      g.clip();
      this.game.draw(g);
      g.restore();
    }
  };
})();
