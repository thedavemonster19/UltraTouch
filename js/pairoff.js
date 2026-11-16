/* Pair Off — a speed card-clearing game on a 28-card pyramid.
 * Mechanics follow the bar-top classic: clear the playfield by picking two open cards of the same rank or
 * next to each other in rank, use the dealt card when nothing on the board matches, and pay points for
 * every extra card you deal. Art, scoring numbers and timings are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RED = [false, true, true, false];
  const ROWS = 7; /* 1 + 2 + … + 7 = 28 cards */
  const DRAW_COST = 25;
  const HINT_COST = 50;
  const PAIR_BASE = 50;
  const CLEAR_BONUS = 1000;
  const FLIP_TIME = 0.22;

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
      /* pyramid slots: row r has r+1 cards; slot (r,i) is covered by (r+1,i) and (r+1,i+1) */
      this.pyr = [];
      let n = 0;
      for (let r = 0; r < ROWS; r++) for (let i = 0; i <= r; i++) {
        this.pyr.push({ card: deck.pop(), r, i, gone: false, deal: n * 0.035, flipAt: -1 });
        n++;
      }
      this.stock = deck;
      this.waste = [this.stock.pop()];
      this.waste[0].deal = n * 0.035 + 0.1;
      this.sel = null;
      this.combo = 0;
      this.timeLeft = Math.max(60, 120 - 10 * (this.level - 1));
      this.state = 'intro';
      this.stateT = 0;
      this.clock = 0;
      this.flying = [];
      this.shakeT = 0;
      this.shakeIds = [];
      this.hint = null;
      this.hintT = 0;
      this.lastTick = 11;
      this.reason = '';
      this.pyr.forEach((s) => (s.wasOpen = this.isOpen(s)));
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
      /* card height from the screen height (7 rows overlapping by half), width from the screen width */
      const byH = (H - 104) / 4.05;
      const byW = ((W - 128) / 9) * 1.4;
      const ch = Math.round(Math.min(byH, byW, 126));
      const cw = Math.round(ch / 1.4);
      const dx = cw + 8;
      const dy = Math.round(ch * 0.5);
      const top = 92;
      const corner = { y: H - ch - 16 };
      this.L = {
        cw, ch, dx, dy, top,
        stock: { x: 22, y: corner.y },
        waste: { x: W - 22 - cw, y: corner.y },
        hint: { x: W - 22 - cw - 8, y: corner.y - 62, w: cw + 16, h: 44 },
      };
    }

    slotXY(s) {
      const L = this.L;
      return { x: this.W / 2 - L.cw / 2 + (s.i - s.r / 2) * L.dx, y: L.top + s.r * L.dy };
    }
    slot(r, i) { return this.pyr[(r * (r + 1)) / 2 + i]; }
    isOpen(s) {
      if (s.gone) return false;
      if (s.r === ROWS - 1) return true;
      return this.slot(s.r + 1, s.i).gone && this.slot(s.r + 1, s.i + 1).gone;
    }

    /* ---------- rules ---------- */
    openRefs() {
      const refs = [];
      this.pyr.forEach((s, k) => { if (this.isOpen(s)) refs.push({ where: 'pyr', k }); });
      if (this.waste.length) refs.push({ where: 'waste' });
      return refs;
    }
    cardOf(ref) {
      if (!ref) return null;
      return ref.where === 'pyr' ? this.pyr[ref.k].card : this.waste[this.waste.length - 1] || null;
    }
    posOf(ref) {
      return ref.where === 'pyr' ? this.slotXY(this.pyr[ref.k]) : { x: this.L.waste.x, y: this.L.waste.y };
    }
    findPair() {
      const refs = this.openRefs();
      for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
        if (pairs(this.cardOf(refs[i]), this.cardOf(refs[j]))) return [refs[i], refs[j]];
      }
      return null;
    }
    sameRef(a, b) { return !!(a && b && a.where === b.where && (a.where === 'waste' || a.k === b.k)); }
    remaining() { return this.pyr.reduce((n, s) => n + (s.gone ? 0 : 1), 0); }

    take(ref) {
      if (ref.where === 'pyr') {
        this.pyr[ref.k].gone = true;
        return this.pyr[ref.k].card;
      }
      return this.waste.pop();
    }

    /* newly uncovered cards flip face up */
    flipNewlyOpen() {
      this.pyr.forEach((s) => {
        const open = this.isOpen(s);
        if (open && !s.wasOpen) {
          s.flipAt = this.clock;
          UT.sfx.deal();
        }
        s.wasOpen = open;
      });
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
      this.take(a);
      this.take(b);
      this.flying.push({ card: ca, x: pa.x, y: pa.y, t: 0, dir: -1 });
      this.flying.push({ card: cb, x: pb.x, y: pb.y, t: 0, dir: 1 });
      this.combo++;
      this.totalPairs++;
      const pts = PAIR_BASE * Math.min(this.combo, 10);
      this.score += pts;
      this.popups.add('+' + pts + (this.combo > 1 ? '  ×' + Math.min(this.combo, 10) : ''), (pa.x + pb.x) / 2 + this.L.cw / 2, Math.min(pa.y, pb.y), this.combo >= 5 ? C.mint : C.amber, 26);
      UT.sfx.match(this.combo);
      this.sel = null;
      this.hint = null;
      this.flipNewlyOpen();
      this.afterMove();
    }

    dealOne() {
      if (!this.stock.length) {
        UT.sfx.nope();
        this.popups.add('DECK EMPTY', this.L.stock.x + this.L.cw / 2, this.L.stock.y - 10, C.coral, 20);
        return;
      }
      const card = this.stock.pop();
      card.deal = 0;
      card.dealFrom = this.clock;
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
      if (!this.remaining()) {
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
    hitCard(x, y, cx, cy, h) { return x >= cx && x <= cx + this.L.cw && y >= cy && y <= cy + (h || this.L.ch); }

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
      /* open cards: test the full card face (nothing covers an open card) */
      for (let k = this.pyr.length - 1; k >= 0 && !ref; k--) {
        const s = this.pyr[k];
        if (!this.isOpen(s)) continue;
        const p = this.slotXY(s);
        if (this.hitCard(x, y, p.x - 3, p.y - 3, L.ch + 6)) ref = { where: 'pyr', k };
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
      this.clock += dt;
      this.stateT += dt;
      this.popups.update(dt);
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.hintT = Math.max(0, this.hintT - dt);
      if (!this.hintT) this.hint = null;
      this.flying.forEach((f) => (f.t += dt));
      this.flying = this.flying.filter((f) => f.t < 0.5);
      if (this.state === 'dealing' && this.stateT > this.pyr.length * 0.035 + 0.45) {
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
      const bg = g.createRadialGradient(W / 2, H * 0.5, 60, W / 2, H * 0.5, W * 0.7);
      bg.addColorStop(0, '#1a6a55');
      bg.addColorStop(1, '#0a2c2a');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.045)';
      g.lineWidth = 1;
      for (let i = -H; i < W; i += 18) {
        g.beginPath();
        g.moveTo(i, H);
        g.lineTo(i + H, 0);
        g.stroke();
      }

      const dealing = this.state === 'dealing' || this.state === 'intro';
      const dealT = this.state === 'dealing' ? this.stateT : this.state === 'intro' ? -1 : 99;
      const isHint = (ref) => !!(this.hint && this.hint.some((h) => this.sameRef(h, ref)));
      const isSel = (ref) => this.sameRef(this.sel, ref);

      /* pyramid, back rows first so lower rows overlap them */
      this.pyr.forEach((s, k) => {
        if (s.gone) return;
        let { x, y } = this.slotXY(s);
        if (dealing) {
          if (dealT < s.deal) return;
          const e = UT.ease((dealT - s.deal) / 0.25);
          x = UT.lerp(L.stock.x, x, e);
          y = UT.lerp(L.stock.y, y, e);
        }
        const open = this.isOpen(s);
        const ref = { where: 'pyr', k };
        if (!open) {
          this.drawBack(g, x, y);
          return;
        }
        /* flip: squash the back to nothing, then grow the face */
        const ft = s.flipAt >= 0 ? (this.clock - s.flipAt) / FLIP_TIME : 1;
        if (ft < 1) {
          const half = ft < 0.5;
          const sx = Math.abs(1 - ft * 2);
          g.save();
          g.translate(x + L.cw / 2, 0);
          g.scale(Math.max(0.02, sx), 1);
          g.translate(-(x + L.cw / 2), 0);
          if (half) this.drawBack(g, x, y);
          else this.drawCard(g, s.card, x, y, {});
          g.restore();
          return;
        }
        this.drawCard(g, s.card, x, y, { selected: isSel(ref), hint: isHint(ref) });
      });

      /* deck, bottom left */
      D.text(g, 'DECK  −' + DRAW_COST, L.stock.x + L.cw / 2, L.stock.y - 12, 11, C.dim, { weight: 700 });
      if (this.stock.length) {
        for (let k = Math.min(3, this.stock.length) - 1; k >= 0; k--) this.drawBack(g, L.stock.x + k * 2, L.stock.y - k * 2);
        g.fillStyle = 'rgba(7,11,22,0.8)';
        D.rrect(g, L.stock.x + L.cw / 2 - 20, L.stock.y + L.ch - 30, 40, 22, 11);
        g.fill();
        D.text(g, String(this.stock.length), L.stock.x + L.cw / 2, L.stock.y + L.ch - 19, 13, C.text, { weight: 800 });
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.2)';
        g.setLineDash([6, 6]);
        D.rrect(g, L.stock.x, L.stock.y, L.cw, L.ch, L.cw * 0.09);
        g.stroke();
        g.setLineDash([]);
        D.text(g, 'EMPTY', L.stock.x + L.cw / 2, L.stock.y + L.ch / 2, 12, 'rgba(255,255,255,0.4)', { weight: 700 });
      }

      /* dealt card, bottom right */
      D.text(g, 'DEALT CARD', L.waste.x + L.cw / 2, L.waste.y - 12, 11, C.dim, { weight: 700 });
      if (!(dealing && dealT < (this.waste[0] ? this.waste[0].deal : 0))) {
        const n = this.waste.length;
        for (let k = Math.max(0, n - 3); k < n; k++) {
          const card = this.waste[k];
          const off = (n - 1 - k) * 3;
          let x = L.waste.x - off;
          const y = L.waste.y - off;
          if (card.dealFrom != null) x = UT.lerp(L.stock.x, x, UT.ease((this.clock - card.dealFrom) / 0.22));
          const top = k === n - 1;
          this.drawCard(g, card, x, y, { selected: top && isSel({ where: 'waste' }), hint: top && isHint({ where: 'waste' }) });
        }
        if (n > 1) {
          g.fillStyle = C.coral;
          g.beginPath();
          g.arc(L.waste.x + L.cw - 4, L.waste.y + 4, 12, 0, Math.PI * 2);
          g.fill();
          D.text(g, String(n), L.waste.x + L.cw - 4, L.waste.y + 5, 12, '#fff', { weight: 800 });
        }
      }

      /* hint, above the dealt card */
      const hb = L.hint;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      D.rrect(g, hb.x, hb.y, hb.w, hb.h, 12);
      g.fill();
      g.strokeStyle = 'rgba(88,180,255,0.6)';
      g.lineWidth = 1.5;
      g.stroke();
      D.text(g, 'HINT −' + HINT_COST, hb.x + hb.w / 2, hb.y + hb.h / 2 + 1, 13, C.sky, { weight: 800 });

      this.flying.forEach((f) => {
        const k = f.t / 0.5;
        g.save();
        g.globalAlpha = 1 - k;
        g.translate(f.x + f.dir * k * 60 + L.cw / 2, f.y - k * 140 + L.ch / 2);
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
      D.text(g, rank, x + w * 0.08, y + w * 0.2, Math.round(w * (rank === '10' ? 0.24 : 0.28)), col, { align: 'left', weight: 800 });
      D.text(g, SUITS[card.s], x + w * 0.92, y + w * 0.2, Math.round(w * 0.24), col, { align: 'right', weight: 400, family: 'system-ui, sans-serif' });
      D.text(g, SUITS[card.s], x + w / 2, y + h * 0.6, Math.round(w * 0.55), col, { weight: 400, family: 'system-ui, sans-serif' });
      if (card.r >= 10 || card.r === 0) D.text(g, rank, x + w / 2, y + h * 0.6, Math.round(w * 0.2), '#fbf7ee', { weight: 800 });
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
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      D.rrect(g, x, y, w, h, rad);
      g.stroke();
      g.save();
      D.rrect(g, x + 4, y + 4, w - 8, h - 8, rad * 0.7);
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
      D.rrect(g, 96, 10, 200, 62, 12);
      g.fill();
      D.text(g, 'SCORE', 112, 28, 12, C.dim, { align: 'left', weight: 700 });
      D.text(g, this.score.toLocaleString(), 112, 54, 28, C.text, { align: 'left', family: UT.font.display, weight: 400 });
      /* the timer sits top-right so the pyramid's peak has the middle */
      g.fillStyle = 'rgba(7,20,20,0.7)';
      D.rrect(g, W - 222, 10, 200, 62, 12);
      g.fill();
      const t = Math.ceil(this.timeLeft);
      D.text(g, 'DEAL ' + this.level + ' · ' + this.remaining() + ' LEFT', W - 208, 28, 12, C.dim, { align: 'left', weight: 700 });
      D.text(g, Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'), W - 208, 54, 28, t <= 10 && this.state === 'play' ? C.coral : C.amber, { align: 'left', family: UT.font.display, weight: 400 });
      if (this.combo > 1) D.text(g, '×' + Math.min(this.combo, 10), W - 40, 54, 18, C.mint, { align: 'right', family: UT.font.display, weight: 400 });
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
      const { y } = this.panel(g, 480, 240);
      const cx = this.W / 2;
      D.text(g, 'DEAL ' + this.level, cx, y + 50, 40, C.text, { family: UT.font.display, weight: 400 });
      D.text(g, 'Clear the 28-card pyramid in ' + Math.floor(this.timeLeft) + ' seconds', cx, y + 94, 18, C.text, { weight: 600 });
      D.text(g, 'Tap two open cards of the same rank or one apart (7-8, K-A)', cx, y + 126, 14, C.dim, { weight: 500 });
      D.text(g, 'The dealt card counts. Stuck? Tap the deck for a new one (−' + DRAW_COST + ')', cx, y + 148, 14, C.dim, { weight: 500 });
      D.text(g, 'Chain pairs without dealing to build a combo', cx, y + 170, 14, C.dim, { weight: 500 });
      if (this.stateT > 0.3) D.text(g, 'TAP TO DEAL', cx, y + 212, 16, C.amber, { weight: 800 });
    }

    drawCleared(g) {
      const { y } = this.panel(g, 440, 240);
      const cx = this.W / 2;
      const b = this.bonus;
      D.text(g, 'PYRAMID CLEARED', cx, y + 46, 30, C.mint, { family: UT.font.display, weight: 400 });
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
