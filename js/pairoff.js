/* Pair Off — a speed card-clearing game.
 * Board: 28 face-up cards in five overlapping brick rows (6-5-6-5-6). A card is open once every card
 * overlapping it from the row below is gone. Take two open cards that are a PAIR (same rank) or a RUN
 * (one apart, up or down). Pairs pay more than runs. The dealt card counts as open; tapping NEXT CARD deals
 * another for a cost. Mechanics follow the bar-top classic; art and presentation are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RED = [false, true, true, false];
  const ROW_SIZES = [6, 5, 6, 5, 6];
  const RUN_PTS = 400;
  const PAIR_PTS = 1200;
  const DEAL_COST = 100;
  /* speed bonus (measured from arcade footage): every match adds the meter's value, then refills it to 500;
   * it holds ~1.5 s, then drains ~150 a second to a floor of 50 */
  const SPEED_MAX = 500;
  const SPEED_MIN = 50;
  const SPEED_HOLD = 1.5;
  const SPEED_DRAIN = 150;
  const CLEAR_PER_SEC = 50;
  const DOTS = 20;
  const FRAME = '#2a1650';
  const FRAME_HI = '#5b2fa8';
  const FIELD = '#07060d';

  function shuffled() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s, id: s * 13 + r });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  /* 'pair' = same rank, 'run' = one apart either way (K and A wrap round), null = no match */
  function kindOf(a, b) {
    if (a.r === b.r) return 'pair';
    const d = Math.abs(a.r - b.r);
    if (d === 1 || d === 12) return 'run';
    return null;
  }

  class PairOff {
    constructor(opts) {
      this.onEnd = opts.onEnd;
      this.onRecord = opts.onRecord || (() => {});
      this.level = 0;
      this.score = 0;
      this.runs = 0;
      this.pairsMade = 0;
      this.best = UT.scores.best('pairoff');
      this.popups = new UT.Popups();
      this.W = 960;
      this.H = 540;
      this.newDeal();
    }

    newDeal() {
      this.level++;
      const deck = shuffled();
      this.slots = [];
      let n = 0;
      ROW_SIZES.forEach((size, r) => {
        for (let i = 0; i < size; i++) {
          this.slots.push({ card: deck.pop(), r, i, gone: false, deal: n * 0.03 });
          n++;
        }
      });
      this.stock = deck;
      this.waste = [this.stock.pop()];
      this.waste[0].deal = n * 0.03 + 0.1;
      this.held = []; /* passed-on cards waiting for a gap in the board */
      this.speedT = 0; /* seconds since the last match (or since the deal started) */
      this.sel = null;
      this.timeMax = Math.max(60, 120 - 10 * (this.level - 1));
      this.timeLeft = this.timeMax;
      this.state = 'intro';
      this.stateT = 0;
      this.clock = 0;
      this.flying = [];
      this.shakeT = 0;
      this.shakeIds = [];
      this.lastTick = 11;
      this.reason = '';
    }

    get speed() { return Math.max(SPEED_MIN, Math.round((SPEED_MAX - SPEED_DRAIN * Math.max(0, this.speedT - SPEED_HOLD)) / 5) * 5); }

    resize(W, H) {
      this.W = W;
      this.H = H;
      const head = 78;
      const foot = 112;
      const side = 132;
      const byH = (H - head - foot - 14) / 3; /* five rows, each half-overlapping the last */
      const byW = ((W - 2 * side - 20) / 6 - 6) * 1.4;
      const ch = Math.round(Math.min(byH, byW, 130));
      const cw = Math.round(ch / 1.4);
      const dx = cw + 6;
      const fieldW = 6 * dx - 6;
      const fx = Math.round(W / 2 - fieldW / 2);
      const fy = head + 10;
      const bch = 96;
      const bcw = Math.round(bch / 1.4);
      this.L = {
        cw, ch, dx, dy: Math.round(ch * 0.5), fx, fy, fieldW, head, foot,
        bcw, bch,
        stock: { x: W / 2 - bcw - 10, y: H - foot + 8 },
        waste: { x: W / 2 + 10, y: H - foot + 8 },
        take: { x: W - side + 10, y: fy + 4, w: side - 26, h: 64 },
        meter: { x: W - side / 2 - 14, y: fy + 4 + 64 + 56, w: 24, h: Math.max(60, 3 * ch - 140) },
        tally: { x: 16, w: side - 26 },
      };
    }

    slotXY(s) {
      const L = this.L;
      const off = ROW_SIZES[s.r] === 5 ? 0.5 : 0;
      return { x: L.fx + (s.i + off) * L.dx, y: L.fy + s.r * L.dy };
    }
    slotAt(r, i) {
      if (r < 0 || r >= ROW_SIZES.length || i < 0 || i >= ROW_SIZES[r]) return null;
      let k = 0;
      for (let q = 0; q < r; q++) k += ROW_SIZES[q];
      return this.slots[k + i];
    }
    /* the cards in the next row that overlap this one */
    coverers(s) {
      if (s.r === ROW_SIZES.length - 1) return [];
      return ROW_SIZES[s.r] === 6 ? [this.slotAt(s.r + 1, s.i - 1), this.slotAt(s.r + 1, s.i)].filter(Boolean) : [this.slotAt(s.r + 1, s.i), this.slotAt(s.r + 1, s.i + 1)].filter(Boolean);
    }
    isOpen(s) { return !s.gone && this.coverers(s).every((c) => c.gone); }
    remaining() { return this.slots.reduce((n, s) => n + (s.gone ? 0 : 1), 0) + this.held.length; }

    openRefs() {
      const refs = [];
      this.slots.forEach((s, k) => { if (this.isOpen(s)) refs.push({ where: 'field', k }); });
      if (this.waste.length) refs.push({ where: 'waste' });
      return refs;
    }
    cardOf(ref) { return ref.where === 'field' ? this.slots[ref.k].card : this.waste[this.waste.length - 1]; }
    posOf(ref) { return ref.where === 'field' ? this.slotXY(this.slots[ref.k]) : { x: this.L.waste.x, y: this.L.waste.y }; }
    sizeOf(ref) { return ref.where === 'field' ? [this.L.cw, this.L.ch] : [this.L.bcw, this.L.bch]; }
    sameRef(a, b) { return !!(a && b && a.where === b.where && (a.where === 'waste' || a.k === b.k)); }
    findMatch() {
      const refs = this.openRefs();
      for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
        if (kindOf(this.cardOf(refs[i]), this.cardOf(refs[j]))) return [refs[i], refs[j]];
      }
      return null;
    }

    take(a, b) {
      const ca = this.cardOf(a);
      const cb = this.cardOf(b);
      const kind = kindOf(ca, cb);
      if (!kind) {
        this.shakeT = 0.35;
        this.shakeIds = [ca.id, cb.id];
        this.sel = null;
        UT.sfx.nope();
        return;
      }
      [a, b].forEach((ref, n) => {
        const p = this.posOf(ref);
        const [w, h] = this.sizeOf(ref);
        this.flying.push({ card: n ? cb : ca, x: p.x, y: p.y, w, h, t: 0, dir: n ? 1 : -1 });
      });
      [a, b].forEach((ref) => { if (ref.where === 'field') this.slots[ref.k].gone = true; });
      if (a.where === 'waste' || b.where === 'waste') this.waste.pop();
      const speed = this.speed;
      const pts = (kind === 'pair' ? PAIR_PTS : RUN_PTS) + speed;
      this.speedT = 0;
      if (kind === 'pair') this.pairsMade++;
      else this.runs++;
      this.score += pts;
      const pa = this.posOf(a);
      const pb = this.posOf(b);
      this.popups.add((kind === 'pair' ? 'PAIR +' : 'RUN +') + pts, (pa.x + pb.x) / 2 + this.L.cw / 2, Math.min(pa.y, pb.y) + 10, kind === 'pair' ? C.amber : C.mint, 26);
      UT.sfx.match(kind === 'pair' ? 6 : 2);
      this.sel = null;
      this.afterMove();
    }

    deal() {
      if (!this.stock.length) {
        UT.sfx.nope();
        this.popups.add('DECK EMPTY', this.L.stock.x + this.L.bcw / 2, this.L.stock.y, C.coral, 20);
        return;
      }
      /* the dealt card you passed on goes up into the board: first gap from the top row down */
      if (this.waste.length) this.toBoard(this.waste.pop(), { x: this.L.waste.x, y: this.L.waste.y });
      const card = this.stock.pop();
      card.dealFrom = this.clock;
      this.waste.push(card);
      this.score = Math.max(0, this.score - DEAL_COST);
      this.sel = null;
      this.popups.add('−' + DEAL_COST, this.L.waste.x + this.L.bcw / 2, this.L.waste.y - 4, C.coral, 22);
      UT.sfx.deal();
      this.afterMove();
    }

    toBoard(card, from) {
      const slot = this.slots.find((s) => s.gone);
      if (!slot) {
        this.held.push(card);
        return;
      }
      slot.card = card;
      slot.gone = false;
      slot.flyFrom = this.clock;
      slot.fromXY = from;
      card.dealFrom = null;
    }

    /* cards waiting for room drop into the board as soon as a gap opens */
    fillGaps() {
      while (this.held.length && this.slots.some((s) => s.gone)) this.toBoard(this.held.shift(), this.heldXY());
    }
    heldXY() { return { x: this.L.waste.x + this.L.bcw + 18, y: this.L.waste.y + 10 }; }

    afterMove() {
      this.fillGaps();
      if (!this.remaining()) {
        this.cleared = { bonus: Math.floor(this.timeLeft) * CLEAR_PER_SEC, deck: this.stock.length * 100 };
        this.score += this.cleared.bonus + this.cleared.deck;
        this.state = 'cleared';
        this.stateT = 0;
        UT.sfx.win();
        return;
      }
      if (!this.stock.length && !this.findMatch()) this.over('No matches left and the deck is empty');
    }

    over(reason) {
      this.state = 'over';
      this.stateT = 0;
      this.reason = reason;
      this.sel = null;
      UT.sfx.lose();
      /* save the score now, even if the player quits from the game-over screen */
      this.onRecord(this.result());
    }

    /* ---------- input ---------- */
    inBox(x, y, bx, by, bw, bh) { return x >= bx && x <= bx + bw && y >= by && y <= by + bh; }

    onDown(x, y) {
      const L = this.L;
      if (this.state === 'intro') {
        if (this.stateT > 0.3) { this.state = 'dealing'; this.stateT = 0; UT.sfx.deal(); }
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
      if (this.inBox(x, y, L.take.x, L.take.y, L.take.w, L.take.h)) {
        UT.sfx.tap();
        this.over('You took the score');
        this.stateT = 1;
        return;
      }
      if (this.inBox(x, y, L.stock.x - 6, L.stock.y - 6, L.bcw + 12, L.bch + 12)) { this.deal(); return; }
      let ref = null;
      if (this.waste.length && this.inBox(x, y, L.waste.x - 6, L.waste.y - 6, L.bcw + 12, L.bch + 12)) ref = { where: 'waste' };
      for (let k = this.slots.length - 1; k >= 0 && !ref; k--) {
        const s = this.slots[k];
        if (!this.isOpen(s)) continue;
        const p = this.slotXY(s);
        if (this.inBox(x, y, p.x - 3, p.y - 3, L.cw + 6, L.ch + 6)) ref = { where: 'field', k };
      }
      if (!ref) { this.sel = null; return; }
      if (!this.sel) { this.sel = ref; UT.sfx.select(); }
      else if (this.sameRef(this.sel, ref)) { this.sel = null; UT.sfx.tap(); }
      else this.take(this.sel, ref);
    }

    result() {
      if (!this._result) this._result = { game: 'pairoff', score: this.score, level: this.level, pairs: this.pairsMade, runs: this.runs, reason: this.reason };
      return this._result;
    }

    finish() {
      this.state = 'done';
      this.onEnd(this.result());
    }

    /* ---------- loop ---------- */
    update(dt) {
      this.clock += dt;
      this.stateT += dt;
      this.popups.update(dt);
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.flying.forEach((f) => (f.t += dt));
      this.flying = this.flying.filter((f) => f.t < 0.5);
      if (this.state === 'dealing' && this.stateT > this.slots.length * 0.03 + 0.45) {
        this.state = 'play';
        this.stateT = 0;
      }
      if (this.state === 'play') {
        this.speedT += dt;
        this.timeLeft -= dt;
        const whole = Math.ceil(this.timeLeft);
        if (whole < this.lastTick && whole > 0) { this.lastTick = whole; UT.sfx.tick(); }
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
      /* cabinet frame + black playfield */
      const fr = g.createLinearGradient(0, 0, 0, H);
      fr.addColorStop(0, FRAME_HI);
      fr.addColorStop(0.5, FRAME);
      fr.addColorStop(1, FRAME_HI);
      g.fillStyle = fr;
      g.fillRect(0, 0, W, H);
      g.fillStyle = FIELD;
      D.rrect(g, 8, L.head, W - 16, H - L.head - L.foot + 4, 18);
      g.fill();
      g.strokeStyle = 'rgba(160,120,255,0.55)';
      g.lineWidth = 2;
      g.stroke();

      this.drawHeader(g);
      this.drawTallies(g);
      this.drawRight(g);

      const dealing = this.state === 'dealing' || this.state === 'intro';
      const dealT = this.state === 'dealing' ? this.stateT : this.state === 'intro' ? -1 : 99;
      this.slots.forEach((s, k) => {
        if (s.gone) return;
        let { x, y } = this.slotXY(s);
        if (s.flyFrom != null && this.clock - s.flyFrom < 0.35) {
          const e = UT.ease((this.clock - s.flyFrom) / 0.35);
          x = UT.lerp(s.fromXY.x, x, e);
          y = UT.lerp(s.fromXY.y, y, e);
        }
        if (dealing) {
          if (dealT < s.deal) return;
          const e = UT.ease((dealT - s.deal) / 0.25);
          x = UT.lerp(L.stock.x, x, e);
          y = UT.lerp(L.stock.y, y, e);
        }
        const ref = { where: 'field', k };
        this.drawCard(g, s.card, x, y, L.cw, L.ch, { selected: this.sameRef(this.sel, ref), dim: !this.isOpen(s) });
      });

      /* bottom bar: deck count, NEXT CARD deck, dealt card */
      D.text(g, 'CLEAR THE BOARD WITH PAIRS (SAME RANK) OR RUNS (ONE UP OR DOWN, K-A COUNTS)', W / 2, H - L.foot - 4, 11, '#c9b8ff', { weight: 800 });
      g.fillStyle = FIELD;
      D.rrect(g, L.stock.x - 70, L.stock.y - 4, 70 + 2 * L.bcw + 30 + 8, L.bch + 8, 14);
      g.fill();
      g.fillStyle = '#16122a';
      D.rrect(g, L.stock.x - 60, L.stock.y + L.bch / 2 - 16, 48, 32, 16);
      g.fill();
      D.text(g, String(this.stock.length), L.stock.x - 36, L.stock.y + L.bch / 2, 16, C.amber, { weight: 800 });
      if (this.stock.length) {
        for (let k = Math.min(3, this.stock.length) - 1; k >= 0; k--) {
          const x = L.stock.x + k * 2;
          const y = L.stock.y - k * 2;
          g.fillStyle = '#123b3b';
          D.rrect(g, x, y, L.bcw, L.bch, 8);
          g.fill();
          g.strokeStyle = '#d8d0f0';
          g.lineWidth = 2;
          g.stroke();
        }
        D.text(g, 'NEXT', L.stock.x + L.bcw / 2, L.stock.y + L.bch / 2 - 10, 14, '#7ff0d0', { family: UT.font.display, weight: 400 });
        D.text(g, 'CARD', L.stock.x + L.bcw / 2, L.stock.y + L.bch / 2 + 10, 14, '#7ff0d0', { family: UT.font.display, weight: 400 });
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.setLineDash([5, 5]);
        D.rrect(g, L.stock.x, L.stock.y, L.bcw, L.bch, 8);
        g.stroke();
        g.setLineDash([]);
      }
      if (!(dealing && dealT < (this.waste[0] ? this.waste[0].deal : 0))) {
        const n = this.waste.length;
        for (let k = Math.max(0, n - 2); k < n; k++) {
          const card = this.waste[k];
          let x = L.waste.x + (k - (n - 1)) * 3;
          if (card.dealFrom != null) x = UT.lerp(L.stock.x, x, UT.ease((this.clock - card.dealFrom) / 0.22));
          this.drawCard(g, card, x, L.waste.y, L.bcw, L.bch, { selected: k === n - 1 && this.sameRef(this.sel, { where: 'waste' }) });
        }
        if (n > 1) {
          g.fillStyle = C.coral;
          g.beginPath();
          g.arc(L.waste.x + L.bcw, L.waste.y + 2, 11, 0, Math.PI * 2);
          g.fill();
          D.text(g, String(n), L.waste.x + L.bcw, L.waste.y + 3, 11, '#fff', { weight: 800 });
        }
      }

      if (this.held.length) {
        const h = this.heldXY();
        for (let k = Math.min(3, this.held.length) - 1; k >= 0; k--) this.drawCard(g, this.held[this.held.length - 1 - k], h.x + k * 4, h.y - k * 4, L.bcw * 0.7, L.bch * 0.7, { mini: true, dim: true });
        D.text(g, 'WAITING ' + this.held.length, h.x + L.bcw * 0.35, h.y - 14, 10, C.dim, { weight: 800 });
      }

      this.flying.forEach((f) => {
        const k = f.t / 0.5;
        g.save();
        g.globalAlpha = 1 - k;
        g.translate(f.x + f.dir * k * 60 + f.w / 2, f.y - k * 140 + f.h / 2);
        g.rotate(f.dir * k * 0.6);
        g.scale(1 - k * 0.3, 1 - k * 0.3);
        this.drawCard(g, f.card, -f.w / 2, -f.h / 2, f.w, f.h, {});
        g.restore();
      });

      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'cleared') this.drawCleared(g);
      if (this.state === 'over') this.drawOver(g);
    }

    drawHeader(g) {
      const W = this.W;
      /* player score, left (clear of the pause button) */
      g.fillStyle = FIELD;
      D.rrect(g, 96, 16, 170, 40, 20);
      g.fill();
      g.strokeStyle = C.amber;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(116, 36, 14, 0, Math.PI * 2);
      g.stroke();
      D.text(g, String(this.level), 116, 37, 14, C.amber, { weight: 800 });
      D.text(g, this.score.toLocaleString(), 254, 37, 22, C.amber, { align: 'right', family: UT.font.display, weight: 400 });
      /* title + dot timer, centre */
      D.text(g, 'PAIR OFF', W / 2, 26, 26, '#7ff0d0', { family: UT.font.display, weight: 400, stroke: '#1a0d33', strokeWidth: 6 });
      const tw = Math.max(120, Math.min(360, W - 620));
      const tx = W / 2 - tw / 2;
      g.fillStyle = FIELD;
      D.rrect(g, tx - 30, 46, tw + 40, 22, 11);
      g.fill();
      g.strokeStyle = C.amber;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(tx - 16, 57, 8, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(tx - 16, 57);
      g.lineTo(tx - 16, 52);
      g.moveTo(tx - 16, 57);
      g.lineTo(tx - 12, 57);
      g.stroke();
      const lit = Math.ceil((this.timeLeft / this.timeMax) * DOTS);
      for (let i = 0; i < DOTS; i++) {
        const on = i >= DOTS - lit;
        const f = i / DOTS;
        g.fillStyle = !on ? '#2a2540' : f < 0.2 ? '#ff4d5e' : f < 0.45 ? '#ffd23f' : '#3ddc97';
        g.beginPath();
        g.arc(tx + 6 + (i * (tw - 12)) / (DOTS - 1), 57, 5, 0, Math.PI * 2);
        g.fill();
      }
      /* best score, right */
      g.fillStyle = FIELD;
      D.rrect(g, W - 220, 12, 200, 52, 14);
      g.fill();
      g.strokeStyle = C.coral;
      g.lineWidth = 2;
      g.stroke();
      D.text(g, 'BEST', W - 120, 26, 11, C.coral, { weight: 800 });
      D.text(g, Math.max(this.best, this.score).toLocaleString(), W - 120, 47, 18, C.text, { family: UT.font.display, weight: 400 });
    }

    drawTallies(g) {
      const L = this.L;
      const rows = [
        { label: 'RUNS', count: this.runs, pts: RUN_PTS, a: 12, b: 11, col: C.mint },
        { label: 'PAIRS', count: this.pairsMade, pts: PAIR_PTS, a: 10, b: 10, col: C.amber },
      ];
      rows.forEach((row, n) => {
        const x = L.tally.x;
        const y = L.fy + 20 + n * Math.max(140, L.ch * 1.4);
        /* two mini cards showing what the match looks like */
        const mw = 34;
        const mh = 46;
        this.drawCard(g, { r: row.a, s: 1 }, x + 6, y, mw, mh, { mini: true });
        this.drawCard(g, { r: row.b, s: 0 }, x + 30, y + 4, mw, mh, { mini: true });
        g.fillStyle = '#16122a';
        g.beginPath();
        g.arc(x + 46, y + 52, 20, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = row.col;
        g.lineWidth = 2;
        g.stroke();
        D.text(g, String(row.count), x + 46, y + 53, 16, C.text, { weight: 800 });
        D.text(g, row.label, x + 46, y + 86, 12, row.col, { weight: 800 });
        D.text(g, '×' + row.pts.toLocaleString(), x + 46, y + 103, 14, row.col, { family: UT.font.display, weight: 400 });
      });
    }

    drawRight(g) {
      const L = this.L;
      const t = L.take;
      g.fillStyle = '#1a1033';
      D.rrect(g, t.x, t.y, t.w, t.h, 14);
      g.fill();
      g.strokeStyle = '#a77bff';
      g.lineWidth = 3;
      g.stroke();
      D.text(g, 'TAKE', t.x + t.w / 2, t.y + t.h / 2 - 10, 14, C.text, { family: UT.font.display, weight: 400 });
      D.text(g, 'SCORE', t.x + t.w / 2, t.y + t.h / 2 + 10, 14, C.text, { family: UT.font.display, weight: 400 });
      /* speed bonus meter: refills on every match, then drains; its value is added to the next match */
      const m = L.meter;
      const v = this.state === 'play' ? this.speed : SPEED_MAX;
      D.text(g, 'SPEED BONUS', m.x + m.w / 2, m.y - 10, 10, C.dim, { weight: 800 });
      g.fillStyle = '#12301f';
      D.rrect(g, m.x, m.y + 8, m.w, m.h, 10);
      g.fill();
      const fh = Math.max(8, (m.h * v) / SPEED_MAX);
      const fy = m.y + 8 + m.h - fh;
      g.save();
      g.shadowColor = '#3ddc97';
      g.shadowBlur = 14;
      g.fillStyle = v > SPEED_MIN ? '#3ddc97' : '#23885c';
      D.rrect(g, m.x, fy, m.w, fh, 10);
      g.fill();
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      for (let yy = fy + 6; yy < m.y + 8 + m.h; yy += 6) {
        g.beginPath();
        g.moveTo(m.x + 3, yy);
        g.lineTo(m.x + m.w - 3, yy);
        g.stroke();
      }
      g.fillStyle = FIELD;
      D.rrect(g, m.x - 20, fy - 12, m.w + 40, 24, 6);
      g.fill();
      g.strokeStyle = C.mint;
      g.lineWidth = 2;
      g.stroke();
      D.text(g, String(v), m.x + m.w / 2, fy + 1, 14, C.mint, { family: UT.font.display, weight: 400 });
    }

    drawCard(g, card, x, y, w, h, o) {
      if (this.shakeT > 0 && card.id != null && this.shakeIds.includes(card.id)) x += Math.sin(this.shakeT * 60) * 5;
      if (o.selected) y -= 6;
      const rad = w * 0.08;
      g.save();
      if (o.selected) {
        g.shadowColor = C.amber;
        g.shadowBlur = 18;
      } else if (!o.mini) {
        g.shadowColor = 'rgba(0,0,0,0.5)';
        g.shadowBlur = 5;
        g.shadowOffsetY = 2;
      }
      g.fillStyle = '#ffffff';
      D.rrect(g, x, y, w, h, rad);
      g.fill();
      g.restore();
      g.strokeStyle = o.selected ? C.amber : '#9a9aa6';
      g.lineWidth = o.selected ? 4 : 1;
      D.rrect(g, x, y, w, h, rad);
      g.stroke();
      const col = RED[card.s] ? '#e0202e' : '#111111';
      const rank = RANKS[card.r];
      /* rank and a big suit along the top edge, readable when the card is half covered */
      D.text(g, rank, x + w * 0.07, y + w * 0.22, Math.round(w * (rank === '10' ? 0.26 : 0.32)), col, { align: 'left', weight: 800, family: "Georgia, 'Times New Roman', serif" });
      D.text(g, SUITS[card.s], x + w * 0.72, y + w * 0.24, Math.round(w * 0.4), col, { weight: 400, family: 'system-ui, sans-serif' });
      if (!o.mini) {
        D.text(g, SUITS[card.s], x + w * 0.16, y + w * 0.5, Math.round(w * 0.22), col, { weight: 400, family: 'system-ui, sans-serif' });
        D.text(g, SUITS[card.s], x + w / 2, y + h * 0.7, Math.round(w * 0.42), col, { weight: 400, family: 'system-ui, sans-serif' });
      }
      if (o.dim) {
        g.fillStyle = 'rgba(20,10,40,0.12)';
        D.rrect(g, x, y, w, h, rad);
        g.fill();
      }
    }

    panel(g, w, h) {
      const x = this.W / 2 - w / 2;
      const y = this.H / 2 - h / 2;
      g.fillStyle = 'rgba(7,4,16,0.6)';
      g.fillRect(0, 0, this.W, this.H);
      g.fillStyle = 'rgba(26,16,51,0.97)';
      D.rrect(g, x, y, w, h, 18);
      g.fill();
      g.strokeStyle = '#a77bff';
      g.lineWidth = 2;
      g.stroke();
      return { x, y };
    }

    drawIntro(g) {
      const { y } = this.panel(g, 500, 250);
      const cx = this.W / 2;
      D.text(g, 'DEAL ' + this.level, cx, y + 46, 38, '#7ff0d0', { family: UT.font.display, weight: 400 });
      D.text(g, 'Clear all 28 cards in ' + this.timeMax + ' seconds', cx, y + 88, 18, C.text, { weight: 600 });
      D.text(g, 'PAIR (same rank) ' + PAIR_PTS.toLocaleString() + '   RUN (one up or down, K-A too) ' + RUN_PTS + '   + the speed bonus', cx, y + 120, 14, C.amber, { weight: 700 });
      D.text(g, 'Only uncovered cards can be taken. The dealt card counts.', cx, y + 146, 14, C.dim, { weight: 500 });
      D.text(g, 'Match fast: the green meter (up to ' + SPEED_MAX + ') is added to each match. NEXT CARD −' + DEAL_COST + '.', cx, y + 168, 14, C.dim, { weight: 500 });
      D.text(g, 'Stuck? TAKE SCORE ends the game and keeps your points.', cx, y + 190, 14, C.dim, { weight: 500 });
      if (this.stateT > 0.3) D.text(g, 'TAP TO DEAL', cx, y + 226, 16, C.amber, { weight: 800 });
    }

    drawCleared(g) {
      const { y } = this.panel(g, 440, 220);
      const cx = this.W / 2;
      D.text(g, 'BOARD CLEARED', cx, y + 44, 30, '#7ff0d0', { family: UT.font.display, weight: 400 });
      D.text(g, 'Time left  +' + this.cleared.bonus.toLocaleString(), cx, y + 90, 16, C.text, { weight: 600 });
      D.text(g, 'Cards left in the deck  +' + this.cleared.deck.toLocaleString(), cx, y + 114, 16, C.text, { weight: 600 });
      D.text(g, 'Score ' + this.score.toLocaleString(), cx, y + 152, 20, C.amber, { weight: 800 });
      if (this.stateT > 1) D.text(g, 'TAP FOR THE NEXT DEAL (shorter clock)', cx, y + 194, 14, C.amber, { weight: 800 });
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
  UT.PairOff.kindOf = kindOf;
})();
