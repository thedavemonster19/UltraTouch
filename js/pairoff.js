/* Pair Off — a speed card-clearing game.
 * Mechanics follow the bar-top classic: clear the board by picking two open cards of the same rank or
 * next to each other in rank, use the dealt card when nothing on the board matches, and pay points for
 * every extra card you deal. Layout, scoring numbers and art are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RED = [false, true, true, false];
  const COLS = 8;
  const DEPTH = 4;
  const DRAW_COST = 25;
  const HINT_COST = 50;
  const PAIR_BASE = 50;
  const CLEAR_BONUS = 1000;

  function shuffled() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s, id: s * 13 + r });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  /* Same rank, or one apart; King and Ace wrap around. */
  function pairs(a, b) {
    const d = Math.abs(a.r - b.r);
    return d === 0 || d === 1 || d === 12;
  }

  class PairOff {
    constructor(opts) {
      this.onEnd = opts.onEnd;
      this.level = 0;
      this.score = 0;
      this.totalPairs = 0;
      this.popups = new UT.Popups();
      this.W = 960;
      this.H = 540;
      this.newDeal();
    }

    newDeal() {
      this.level++;
      const deck = shuffled();
      this.cols = [];
      for (let c = 0; c < COLS; c++) this.cols.push([]);
      for (let row = 0; row < DEPTH; row++) for (let c = 0; c < COLS; c++) {
        const card = deck.pop();
        card.deal = (row * COLS + c) * 0.03;
        this.cols[c].push(card);
      }
      this.stock = deck;
      this.waste = [this.stock.pop()];
      this.waste[0].deal = COLS * DEPTH * 0.03 + 0.1;
      this.sel = null;
      this.combo = 0;
      this.timeLeft = Math.max(60, 130 - 10 * (this.level - 1));
      this.state = 'intro';
      this.stateT = 0;
      this.flying = [];
      this.shakeT = 0;
      this.shakeIds = [];
      this.hint = null;
      this.hintT = 0;
      this.lastTick = 11;
      this.reason = '';
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
      const cw = Math.round(UT.clamp((W - 152) / 10, 56, 96));
      const ch = Math.round(cw * 1.4);
      const step = Math.round(ch * 0.4);
      const pw = 2 * cw + 36;
      const x0 = 20 + pw + 16;
      const gap = Math.max(6, (W - 24 - x0 - COLS * cw) / (COLS - 1));
      const th = ch + (DEPTH - 1) * step;
      const ty = Math.max(98, Math.round((H - th) / 2 + 34));
      this.L = {
        cw, ch, step, gap, x0, ty,
        stock: { x: 26, y: ty + 18 },
        waste: { x: 26 + cw + 14, y: ty + 18 },
        hint: { x: 26, y: ty + 18 + ch + 30, w: 2 * cw + 14, h: 44 },
      };
    }

    colX(i) { return this.L.x0 + i * (this.L.cw + this.L.gap); }
    cardY(row) { return this.L.ty + row * this.L.step; }

    /* ---------- rules ---------- */
    openRefs() {
      const refs = [];
      this.cols.forEach((col, i) => { if (col.length) refs.push({ where: 'col', i }); });
      if (this.waste.length) refs.push({ where: 'waste' });
      return refs;
    }
    cardOf(ref) {
      if (!ref) return null;
      if (ref.where === 'col') {
        const col = this.cols[ref.i];
        return col[col.length - 1] || null;
      }
      return this.waste[this.waste.length - 1] || null;
    }
    posOf(ref) {
      if (ref.where === 'col') return { x: this.colX(ref.i), y: this.cardY(this.cols[ref.i].length - 1) };
      return { x: this.L.waste.x, y: this.L.waste.y };
    }
    findPair() {
      const refs = this.openRefs();
      for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
        if (pairs(this.cardOf(refs[i]), this.cardOf(refs[j]))) return [refs[i], refs[j]];
      }
      return null;
    }
    sameRef(a, b) { return a && b && a.where === b.where && (a.where === 'waste' || a.i === b.i); }

    take(ref) {
      const card = ref.where === 'col' ? this.cols[ref.i].pop() : this.waste.pop();
      return card;
    }

    tryPair(a, b) {
      const ca = this.cardOf(a);
      const cb = this.cardOf(b);
      if (!pairs(ca, cb)) {
        this.shakeT = 0.35;
        this.shakeIds = [ca.id, cb.id];
        this.combo = 0;
        this.sel = null;
        UT.sfx.nope();
        return;
      }
      const pa = this.posOf(a);
      const pb = this.posOf(b);
      /* take the column card first so a waste ref stays valid */
      const first = a.where === 'col' ? a : b;
      const second = first === a ? b : a;
      const c1 = this.take(first);
      const c2 = this.take(second);
      const p1 = first === a ? pa : pb;
      const p2 = first === a ? pb : pa;
      this.flying.push({ card: c1, x: p1.x, y: p1.y, t: 0, dir: -1 });
      this.flying.push({ card: c2, x: p2.x, y: p2.y, t: 0, dir: 1 });
      this.combo++;
      this.totalPairs++;
      const pts = PAIR_BASE * Math.min(this.combo, 10);
      this.score += pts;
      const mx = (pa.x + pb.x) / 2 + this.L.cw / 2;
      const my = Math.min(pa.y, pb.y);
      this.popups.add('+' + pts + (this.combo > 1 ? '  ×' + Math.min(this.combo, 10) : ''), mx, my, this.combo >= 5 ? C.mint : C.amber, 26);
      UT.sfx.match(this.combo);
      this.sel = null;
      this.hint = null;
      this.afterMove();
    }

    dealOne() {
      if (!this.stock.length) {
        UT.sfx.nope();
        this.popups.add('DECK EMPTY', this.L.stock.x + this.L.cw / 2, this.L.stock.y, C.coral, 20);
        return;
      }
      const card = this.stock.pop();
      card.deal = 0;
      card.dealFrom = performance.now();
      this.waste.push(card);
      this.score = Math.max(0, this.score - DRAW_COST);
      this.combo = 0;
      this.sel = null;
      this.hint = null;
      this.popups.add('−' + DRAW_COST, this.L.waste.x + this.L.cw / 2, this.L.waste.y - 6, C.coral, 22);
      UT.sfx.deal();
      this.afterMove();
    }

    useHint() {
      const p = this.findPair();
      if (!p) {
        this.popups.add(this.stock.length ? 'DEAL A CARD' : 'NO PAIRS', this.L.stock.x + this.L.cw, this.L.stock.y - 10, C.sky, 20);
        return;
      }
      this.hint = p;
      this.hintT = 2.2;
      this.score = Math.max(0, this.score - HINT_COST);
      this.popups.add('−' + HINT_COST, this.L.hint.x + this.L.hint.w / 2, this.L.hint.y, C.coral, 20);
      UT.sfx.select();
    }

    afterMove() {
      if (this.cols.every((c) => !c.length)) {
        const secs = Math.floor(this.timeLeft);
        this.bonus = { base: CLEAR_BONUS, time: secs * 10, deck: this.stock.length * 100 };
        this.score += this.bonus.base + this.bonus.time + this.bonus.deck;
        this.state = 'cleared';
        this.stateT = 0;
        UT.sfx.win();
        return;
      }
      if (!this.stock.length && !this.findPair()) this.over('No pairs left and the deck is empty');
    }

    over(reason) {
      this.state = 'over';
      this.stateT = 0;
      this.reason = reason;
      this.sel = null;
      UT.sfx.lose();
    }

    /* ---------- input ---------- */
    hitCard(x, y, cx, cy) { return x >= cx && x <= cx + this.L.cw && y >= cy && y <= cy + this.L.ch; }

    onDown(x, y) {
      const L = this.L;
      if (this.state === 'intro') {
        if (this.stateT > 0.3) {
          this.state = 'dealing';
          this.stateT = 0;
          UT.sfx.deal();
        }
        return;
      }
      if (this.state === 'cleared') {
        if (this.stateT > 1) { UT.sfx.tap(); this.newDeal(); }
        return;
      }
      if (this.state === 'over') {
        if (this.stateT > 1) this.finish();
        return;
      }
      if (this.state !== 'play') return;

      if (this.hitCard(x, y, L.stock.x, L.stock.y)) { this.dealOne(); return; }
      if (x >= L.hint.x && x <= L.hint.x + L.hint.w && y >= L.hint.y && y <= L.hint.y + L.hint.h) { this.useHint(); return; }

      let ref = null;
      if (this.waste.length && this.hitCard(x, y, L.waste.x, L.waste.y)) ref = { where: 'waste' };
      for (let i = 0; i < COLS && !ref; i++) {
        const n = this.cols[i].length;
        if (!n) continue;
        /* the whole top card is the target, plus a little slack above it */
        if (this.hitCard(x, y + 10, this.colX(i), this.cardY(n - 1)) || this.hitCard(x, y, this.colX(i), this.cardY(n - 1))) ref = { where: 'col', i };
      }
      if (!ref) {
        this.sel = null;
        return;
      }
      if (!this.sel) {
        this.sel = ref;
        UT.sfx.select();
      } else if (this.sameRef(this.sel, ref)) {
        this.sel = null;
        UT.sfx.tap();
      } else {
        this.tryPair(this.sel, ref);
      }
    }

    finish() {
      this.state = 'done';
      this.onEnd({ game: 'pairoff', score: this.score, level: this.level, pairs: this.totalPairs, reason: this.reason });
    }

    /* ---------- loop ---------- */
    update(dt) {
      this.stateT += dt;
      this.popups.update(dt);
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.hintT = Math.max(0, this.hintT - dt);
      if (!this.hintT) this.hint = null;
      this.flying.forEach((f) => (f.t += dt));
      this.flying = this.flying.filter((f) => f.t < 0.5);
      if (this.state === 'dealing' && this.stateT > COLS * DEPTH * 0.03 + 0.45) {
        this.state = 'play';
        this.stateT = 0;
        if (!this.findPair() && !this.stock.length) this.over('No pairs on the deal');
      }
      if (this.state === 'play') {
        this.timeLeft -= dt;
        const whole = Math.ceil(this.timeLeft);
        if (whole < this.lastTick && whole > 0) {
          this.lastTick = whole;
          UT.sfx.tick();
        }
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          UT.sfx.horn();
          this.over('Time ran out');
        }
      }
    }

    /* ---------- drawing ---------- */
    draw(g) {
      const W = this.W;
      const H = this.H;
      const L = this.L;
      /* felt */
      const bg = g.createRadialGradient(W * 0.55, H * 0.55, 60, W * 0.55, H * 0.55, W * 0.75);
      bg.addColorStop(0, '#17614f');
      bg.addColorStop(1, '#0a2c2a');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.lineWidth = 1;
      for (let i = -H; i < W; i += 18) {
        g.beginPath();
        g.moveTo(i, H);
        g.lineTo(i + H, 0);
        g.stroke();
      }
      /* side rail */
      g.fillStyle = 'rgba(7,20,20,0.55)';
      D.rrect(g, 12, L.ty - 14, 2 * L.cw + 42, L.ch + 120, 16);
      g.fill();

      /* empty column slots */
      for (let i = 0; i < COLS; i++) {
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 2;
        D.rrect(g, this.colX(i), L.ty, L.cw, L.ch, L.cw * 0.09);
        g.stroke();
      }

      const dealing = this.state === 'dealing' || this.state === 'intro';
      const dealT = this.state === 'dealing' ? this.stateT : this.state === 'intro' ? -1 : 99;
      const isHint = (ref) => this.hint && this.hint.some((h) => this.sameRef(h, ref));
      const isSel = (ref) => this.sameRef(this.sel, ref);

      /* tableau */
      this.cols.forEach((col, i) => {
        col.forEach((card, row) => {
          let x = this.colX(i);
          let y = this.cardY(row);
          if (dealing) {
            const k = UT.ease((dealT - card.deal) / 0.25);
            if (dealT < card.deal) return;
            x = UT.lerp(L.stock.x, x, k);
            y = UT.lerp(L.stock.y, y, k);
          }
          const top = row === col.length - 1;
          const ref = { where: 'col', i };
          this.drawCard(g, card, x, y, {
            dim: !top,
            selected: top && isSel(ref),
            hint: top && isHint(ref),
          });
        });
      });

      /* stock */
      if (this.stock.length) {
        for (let k = Math.min(3, this.stock.length) - 1; k >= 0; k--) this.drawBack(g, L.stock.x - k * 2, L.stock.y - k * 2);
        g.fillStyle = 'rgba(7,11,22,0.8)';
        D.rrect(g, L.stock.x + L.cw / 2 - 20, L.stock.y + L.ch - 30, 40, 22, 11);
        g.fill();
        D.text(g, String(this.stock.length), L.stock.x + L.cw / 2, L.stock.y + L.ch - 19, 13, C.text, { weight: 800 });
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.setLineDash([6, 6]);
        D.rrect(g, L.stock.x, L.stock.y, L.cw, L.ch, L.cw * 0.09);
        g.stroke();
        g.setLineDash([]);
        D.text(g, 'EMPTY', L.stock.x + L.cw / 2, L.stock.y + L.ch / 2, 12, 'rgba(255,255,255,0.4)', { weight: 700 });
      }
      D.text(g, 'DEAL  −' + DRAW_COST, L.stock.x + L.cw / 2, L.stock.y - 12, 11, C.dim, { weight: 700 });
      D.text(g, 'IN PLAY', L.waste.x + L.cw / 2, L.waste.y - 12, 11, C.dim, { weight: 700 });

      /* waste: the dealt card(s) */
      if (!(dealing && dealT < (this.waste[0] ? this.waste[0].deal : 0))) {
        const n = this.waste.length;
        for (let k = Math.max(0, n - 3); k < n; k++) {
          const card = this.waste[k];
          const off = (n - 1 - k) * 3;
          let x = L.waste.x - off;
          let y = L.waste.y - off;
          if (card.dealFrom) {
            const kk = UT.ease((performance.now() - card.dealFrom) / 200);
            x = UT.lerp(L.stock.x, x, kk);
          }
          const top = k === n - 1;
          this.drawCard(g, card, x, y, { selected: top && isSel({ where: 'waste' }), hint: top && isHint({ where: 'waste' }), dim: !top });
        }
        if (n > 1) {
          g.fillStyle = C.coral;
          g.beginPath();
          g.arc(L.waste.x + L.cw - 4, L.waste.y + 4, 12, 0, Math.PI * 2);
          g.fill();
          D.text(g, String(n), L.waste.x + L.cw - 4, L.waste.y + 5, 12, '#fff', { weight: 800 });
        }
      }

      /* hint button */
      const hb = L.hint;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      D.rrect(g, hb.x, hb.y, hb.w, hb.h, 12);
      g.fill();
      g.strokeStyle = 'rgba(88,180,255,0.6)';
      g.lineWidth = 1.5;
      g.stroke();
      D.text(g, 'HINT  −' + HINT_COST, hb.x + hb.w / 2, hb.y + hb.h / 2 + 1, 14, C.sky, { weight: 800 });

      /* matched cards flying off */
      this.flying.forEach((f) => {
        const k = f.t / 0.5;
        g.save();
        g.globalAlpha = 1 - k;
        const x = f.x + f.dir * k * 60;
        const y = f.y - k * 140;
        g.translate(x + L.cw / 2, y + L.ch / 2);
        g.rotate(f.dir * k * 0.6);
        g.scale(1 - k * 0.3, 1 - k * 0.3);
        this.drawCard(g, f.card, -L.cw / 2, -L.ch / 2, {});
        g.restore();
      });

      this.drawHud(g);
      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'cleared') this.drawCleared(g);
      if (this.state === 'over') this.drawOver(g);
    }

    drawCard(g, card, x, y, o) {
      const L = this.L;
      const w = L.cw;
      const h = L.ch;
      if (this.shakeT > 0 && this.shakeIds.includes(card.id)) x += Math.sin(this.shakeT * 60) * 5;
      if (o.selected) y -= 8;
      const rad = w * 0.09;
      g.save();
      if (o.selected || o.hint) {
        g.shadowColor = o.selected ? C.amber : C.mint;
        g.shadowBlur = 18;
      } else {
        g.shadowColor = 'rgba(0,0,0,0.35)';
        g.shadowBlur = 6;
        g.shadowOffsetY = 2;
      }
      g.fillStyle = '#fbf7ee';
      D.rrect(g, x, y, w, h, rad);
      g.fill();
      g.restore();
      g.strokeStyle = o.selected ? C.amber : o.hint ? C.mint : '#cfc6b0';
      g.lineWidth = o.selected || o.hint ? 3.5 : 1;
      D.rrect(g, x, y, w, h, rad);
      g.stroke();
      const col = RED[card.s] ? '#d23440' : '#1b1f2e';
      const rank = RANKS[card.r];
      const rs = Math.round(w * (rank === '10' ? 0.24 : 0.27));
      D.text(g, rank, x + w * 0.08, y + w * 0.2, rs, col, { align: 'left', weight: 800 });
      D.text(g, SUITS[card.s], x + w * 0.92, y + w * 0.2, Math.round(w * 0.24), col, { align: 'right', weight: 400, family: 'system-ui, sans-serif' });
      D.text(g, SUITS[card.s], x + w / 2, y + h * 0.6, Math.round(w * 0.55), col, { weight: 400, family: 'system-ui, sans-serif' });
      if (card.r >= 10 || card.r === 0) {
        D.text(g, rank, x + w / 2, y + h * 0.6, Math.round(w * 0.2), '#fbf7ee', { weight: 800 });
      }
      if (o.dim) {
        g.fillStyle = 'rgba(10,30,30,0.16)';
        D.rrect(g, x, y, w, h, rad);
        g.fill();
      }
    }

    drawBack(g, x, y) {
      const w = this.L.cw;
      const h = this.L.ch;
      const rad = w * 0.09;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 5;
      g.fillStyle = '#7b2d3b';
      D.rrect(g, x, y, w, h, rad);
      g.fill();
      g.restore();
      g.save();
      D.rrect(g, x + 5, y + 5, w - 10, h - 10, rad * 0.7);
      g.clip();
      g.fillStyle = '#9c3a4b';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,182,39,0.35)';
      g.lineWidth = 2;
      for (let i = -h; i < w + h; i += 9) {
        g.beginPath();
        g.moveTo(x + i, y);
        g.lineTo(x + i - h, y + h);
        g.stroke();
      }
      g.restore();
      g.fillStyle = '#7b2d3b';
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, w * 0.22, 0, Math.PI * 2);
      g.fill();
      D.text(g, 'U', x + w / 2, y + h / 2 + 1, Math.round(w * 0.26), C.amber, { family: UT.font.display, weight: 400 });
    }

    drawHud(g) {
      const W = this.W;
      g.fillStyle = 'rgba(7,20,20,0.7)';
      D.rrect(g, 96, 10, 210, 62, 12);
      g.fill();
      D.text(g, 'SCORE', 112, 28, 12, C.dim, { align: 'left', weight: 700 });
      D.text(g, this.score.toLocaleString(), 112, 54, 28, C.text, { align: 'left', family: UT.font.display, weight: 400 });
      g.fillStyle = 'rgba(7,20,20,0.7)';
      D.rrect(g, W / 2 - 80, 10, 160, 62, 12);
      g.fill();
      D.text(g, 'DEAL ' + this.level, W / 2, 26, 12, C.dim, { weight: 700 });
      const t = Math.ceil(this.timeLeft);
      const mm = Math.floor(t / 60);
      const ss = String(t % 60).padStart(2, '0');
      D.text(g, mm + ':' + ss, W / 2, 52, 30, t <= 10 && this.state === 'play' ? C.coral : C.amber, { family: UT.font.display, weight: 400 });
      g.fillStyle = 'rgba(7,20,20,0.7)';
      D.rrect(g, W - 250, 10, 226, 62, 12);
      g.fill();
      const left = this.cols.reduce((n, c) => n + c.length, 0);
      D.text(g, left + ' CARDS LEFT', W - 236, 30, 15, C.text, { align: 'left', weight: 800 });
      D.text(g, this.combo > 1 ? 'COMBO ×' + Math.min(this.combo, 10) : 'Pair same rank or ±1', W - 236, 54, 12, this.combo > 1 ? C.mint : C.dim, { align: 'left', weight: 700 });
    }

    panel(g, w, h) {
      const x = this.W / 2 - w / 2;
      const y = this.H / 2 - h / 2 + 10;
      g.fillStyle = 'rgba(4,14,14,0.5)';
      g.fillRect(0, 0, this.W, this.H);
      g.fillStyle = 'rgba(16,30,34,0.97)';
      D.rrect(g, x, y, w, h, 18);
      g.fill();
      g.strokeStyle = C.amber;
      g.lineWidth = 2;
      g.stroke();
      return { x, y };
    }

    drawIntro(g) {
      const { y } = this.panel(g, 470, 240);
      const cx = this.W / 2;
      D.text(g, 'DEAL ' + this.level, cx, y + 50, 40, C.text, { family: UT.font.display, weight: 400 });
      D.text(g, 'Clear all ' + COLS * DEPTH + ' cards in ' + Math.floor(this.timeLeft) + ' seconds', cx, y + 94, 18, C.text, { weight: 600 });
      D.text(g, 'Tap two open cards of the same rank or one apart (7-8, K-A)', cx, y + 126, 14, C.dim, { weight: 500 });
      D.text(g, 'The dealt card counts. Stuck? Deal another for −' + DRAW_COST, cx, y + 148, 14, C.dim, { weight: 500 });
      D.text(g, 'Chain pairs without dealing to build a combo', cx, y + 170, 14, C.dim, { weight: 500 });
      if (this.stateT > 0.3) D.text(g, 'TAP TO DEAL', cx, y + 212, 16, C.amber, { weight: 800 });
    }

    drawCleared(g) {
      const { y } = this.panel(g, 440, 240);
      const cx = this.W / 2;
      const b = this.bonus;
      D.text(g, 'BOARD CLEARED', cx, y + 46, 32, C.mint, { family: UT.font.display, weight: 400 });
      D.text(g, 'Clear bonus  +' + b.base.toLocaleString(), cx, y + 92, 16, C.text, { weight: 600 });
      D.text(g, 'Time left  +' + b.time.toLocaleString(), cx, y + 116, 16, C.text, { weight: 600 });
      D.text(g, 'Cards still in the deck  +' + b.deck.toLocaleString(), cx, y + 140, 16, C.text, { weight: 600 });
      D.text(g, 'Score ' + this.score.toLocaleString(), cx, y + 176, 20, C.amber, { weight: 800 });
      if (this.stateT > 1) D.text(g, 'TAP FOR THE NEXT DEAL (shorter clock)', cx, y + 214, 14, C.amber, { weight: 800 });
    }

    drawOver(g) {
      const { y } = this.panel(g, 440, 200);
      const cx = this.W / 2;
      D.text(g, 'GAME OVER', cx, y + 48, 36, C.coral, { family: UT.font.display, weight: 400 });
      D.text(g, this.reason, cx, y + 92, 16, C.text, { weight: 600 });
      D.text(g, 'Final score ' + this.score.toLocaleString(), cx, y + 124, 20, C.amber, { weight: 800 });
      if (this.stateT > 1) D.text(g, 'TAP TO CONTINUE', cx, y + 170, 15, C.amber, { weight: 800 });
    }
  }

  UT.PairOff = PairOff;
  UT.PairOff.pairs = pairs;
})();
