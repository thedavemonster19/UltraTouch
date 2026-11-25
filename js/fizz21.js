/* Fizz 21 — a stack-to-21 game across five columns, three hands a game.
 * Mechanics follow the bar-top classic: drop each numbered glass onto any of five columns without going over 21;
 * a column is done at 21 or after five glasses; one unwanted glass may be spilled (passed) per hand; the total
 * of all five columns pays on a table from 97 to 105; a speed bonus drains while you play.
 * Soda-fountain theme, art, name and hand structure are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  const COLS = 5;
  const MAX_IN_COL = 5;
  const HANDS = 3;
  const SPILLS = 1;
  const SPEED_START = 300;
  const SPEED_DRAIN = 4; /* per second, measured from arcade footage */
  /* payout on the five-column total (from the cabinet's table) */
  const PAYOUT = { 105: 1000, 104: 500, 103: 400, 102: 300, 101: 250, 100: 200, 99: 150, 98: 100, 97: 50 };
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const FLAVORS = [
    { liquid: '#8a3b1d', top: '#b9592b' }, /* cola */
    { liquid: '#f08a24', top: '#ffb050' }, /* orange */
    { liquid: '#d93a5c', top: '#ff7590' }, /* cherry */
    { liquid: '#6bbf3a', top: '#9be06b' }, /* lime */
  ];
  const INK = '#13202b';
  const CREAM = '#fff6e3';
  const TEAL = '#1aa6a0';
  const RED = '#e2412f';

  function shuffledDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s, value: Math.min(10, r + 1), ace: r === 0 });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  /* best total: aces count 11 when that doesn't go over 21, else 1 */
  function total(col) {
    let t = 0;
    let aces = 0;
    col.forEach((c) => { t += c.value; if (c.ace) aces++; });
    if (aces && t + 10 <= 21) t += 10;
    return t;
  }
  /* every ace counted as 1: a soft 21 (A + 10) can still take more, as on the machine */
  function hard(col) { return col.reduce((n, c) => n + c.value, 0); }
  function payout(sum) { return PAYOUT[sum] || 0; }

  class Fizz21 {
    constructor(opts) {
      this.onEnd = opts.onEnd;
      this.onRecord = opts.onRecord || (() => {});
      this.score = 0;
      this.hand = 0;
      this.hands = [];
      this.best = UT.scores.best('fizz21');
      this.popups = new UT.Popups();
      this.W = 960;
      this.H = 540;
      this.clock = 0;
      this.startHand();
    }

    startHand() {
      this.hand++;
      this.deck = shuffledDeck();
      this.cols = [];
      for (let i = 0; i < COLS; i++) this.cols.push([]);
      this.next = this.deck.pop();
      this.spills = SPILLS;
      this.speedT = 0;
      this.state = 'intro';
      this.stateT = 0;
      this.flying = null;
      this.warn = 0;
      this.result = null;
    }

    get speed() { return Math.max(0, Math.round(SPEED_START - SPEED_DRAIN * this.speedT)); }
    locked(i) { const c = this.cols[i]; return hard(c) >= 21 || c.length >= MAX_IN_COL; }
    fits(i, card) { return !this.locked(i) && hard(this.cols[i].concat([card])) <= 21; }
    sum() { return this.cols.reduce((n, c) => n + total(c), 0); }

    resize(W, H) {
      this.W = W;
      this.H = H;
      const right = 196;
      const left = 120;
      const x0 = left + 14;
      const x1 = W - right - 14;
      const colW = (x1 - x0) / COLS;
      const gw = Math.min(78, colW - 14);
      this.L = {
        right, left, x0, colW, gw, gh: Math.round(gw * 1.12), step: Math.round(gw * 0.5),
        totalsY: 108, stackY: 150, btnY: H - 64,
        next: { x: 24, y: 122, w: 76, h: 86 },
        spill: { x: 18, y: 232, w: 88, h: 40 },
        giveUp: { x: W - right + 14, y: H - 70, w: right - 28, h: 50 },
      };
    }
    colX(i) { return this.L.x0 + i * this.L.colW + this.L.colW / 2; }

    /* ---------- input ---------- */
    inBox(x, y, b) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

    onDown(x, y) {
      const L = this.L;
      if (this.state === 'intro') {
        if (this.stateT > 0.3) { this.state = 'play'; this.stateT = 0; UT.sfx.deal(); }
        return;
      }
      if (this.state === 'handEnd') {
        if (this.stateT > 1) {
          UT.sfx.tap();
          if (this.hand >= HANDS) this.finish();
          else this.startHand();
        }
        return;
      }
      if (this.state !== 'play' || this.flying) return;
      if (this.inBox(x, y, L.giveUp)) { UT.sfx.tap(); this.endHand('You gave up the hand'); return; }
      if (this.inBox(x, y, L.spill)) { this.spill(); return; }
      /* a tap anywhere in a column (stack or its button) pours into that column */
      if (x < L.x0 || x > L.x0 + COLS * L.colW || y < L.totalsY - 20) return;
      this.pour(Math.floor((x - L.x0) / L.colW));
    }

    pour(i) {
      if (i < 0 || i >= COLS) return;
      if (!this.fits(i, this.next)) {
        UT.sfx.nope();
        this.popups.add(this.locked(i) ? 'FULL' : 'OVER 21', this.colX(i), this.L.totalsY + 40, C.coral, 22);
        return;
      }
      const card = this.next;
      this.cols[i].push(card);
      this.flying = { card, i, t: 0 };
      UT.sfx.select();
      const t = total(this.cols[i]);
      if (t === 21) { UT.sfx.match(6); this.popups.add('21!', this.colX(i), this.L.totalsY + 34, C.amber, 30); }
      else if (this.cols[i].length >= MAX_IN_COL) { UT.sfx.match(3); this.popups.add('5 GLASSES', this.colX(i), this.L.totalsY + 34, C.mint, 22); }
      this.drawNext();
    }

    spill() {
      if (this.spills <= 0) { UT.sfx.nope(); this.popups.add('NO SPILLS LEFT', this.L.spill.x + 50, this.L.spill.y - 8, C.coral, 18); return; }
      this.spills--;
      UT.sfx.deal();
      this.popups.add('SPILLED', this.L.next.x + 40, this.L.next.y + 20, C.sky, 20);
      this.drawNext();
    }

    drawNext() {
      this.next = this.deck.pop();
      this.checkStuck();
    }

    /* the hand ends when every column is done, or the next glass fits nowhere and the spill is used */
    checkStuck() {
      if (this.cols.every((_, i) => this.locked(i))) { this.endHand('All five columns are done'); return; }
      if (!this.next) { this.endHand('Out of glasses'); return; }
      const anywhere = this.cols.some((_, i) => this.fits(i, this.next));
      if (anywhere) return;
      if (this.spills > 0) { this.warn = 2.5; UT.sfx.nope(); return; }
      this.endHand('No room for that glass');
    }

    endHand(reason) {
      const sum = this.sum();
      const win = payout(sum);
      const speed = win > 0 ? this.speed : 0; /* the speed bonus only counts on a paying total */
      this.result = { reason, sum, win, speed, points: win + speed };
      this.score += this.result.points;
      this.hands.push(this.result);
      this.state = 'handEnd';
      this.stateT = 0;
      if (win > 0) UT.sfx.win(); else UT.sfx.lose();
      if (this.hand >= HANDS) this.onRecord(this.gameResult());
    }

    gameResult() {
      if (!this._result) this._result = { game: 'fizz21', score: this.score, hands: this.hands.map((h) => h.sum), best: Math.max(...this.hands.map((h) => h.sum)) };
      return this._result;
    }

    finish() {
      this.state = 'done';
      this.onEnd(this.gameResult());
    }

    /* ---------- loop ---------- */
    update(dt) {
      this.clock += dt;
      this.stateT += dt;
      this.popups.update(dt);
      this.warn = Math.max(0, this.warn - dt);
      if (this.flying) {
        this.flying.t += dt;
        if (this.flying.t > 0.22) this.flying = null;
      }
      if (this.state === 'play') this.speedT += dt;
    }

    /* ---------- drawing ---------- */
    draw(g) {
      const W = this.W;
      const H = this.H;
      const L = this.L;
      /* diner wall: cream with a red-and-white checker band, teal counter */
      g.fillStyle = '#f3e7cf';
      g.fillRect(0, 0, W, H);
      const sq = 18;
      for (let x = 0; x < W; x += sq) for (let r = 0; r < 2; r++) {
        g.fillStyle = ((x / sq + r) % 2) ? '#ffffff' : RED;
        g.fillRect(x, H - 2 * sq + r * sq, sq, sq);
      }
      g.fillStyle = TEAL;
      g.fillRect(0, 0, W, 58);
      g.fillStyle = '#0f7f7a';
      g.fillRect(0, 58, W, 4);

      this.drawHeader(g);
      this.drawTable(g);

      /* column totals */
      for (let i = 0; i < COLS; i++) {
        const cx = this.colX(i);
        const t = total(this.cols[i]);
        g.fillStyle = t === 21 ? C.amber : this.locked(i) ? C.mint : '#ffffff';
        D.rrect(g, cx - 30, L.totalsY - 16, 60, 32, 8);
        g.fill();
        g.strokeStyle = INK;
        g.lineWidth = 2;
        g.stroke();
        D.text(g, String(t), cx, L.totalsY + 1, 18, INK, { family: UT.font.display, weight: 400 });
      }
      g.strokeStyle = 'rgba(19,32,43,0.35)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(this.colX(0) + 30, L.totalsY);
      g.lineTo(this.colX(COLS - 1) - 30, L.totalsY);
      g.stroke();

      /* stacks */
      for (let i = 0; i < COLS; i++) {
        this.cols[i].forEach((card, k) => {
          let x = this.colX(i) - L.gw / 2;
          let y = L.stackY + k * L.step;
          if (this.flying && this.flying.card === card) {
            const e = UT.ease(this.flying.t / 0.22);
            x = UT.lerp(L.next.x, x, e);
            y = UT.lerp(L.next.y, y, e);
          }
          this.drawGlass(g, card, x, y, L.gw, L.gh);
        });
        /* pour button or FULL */
        const bx = this.colX(i);
        if (this.locked(i)) {
          D.text(g, 'FULL', bx, L.btnY, 18, '#0f7f7a', { family: UT.font.display, weight: 400 });
        } else {
          const can = this.state === 'play' && this.next && this.fits(i, this.next);
          g.fillStyle = can ? C.amber : '#d9cdb6';
          D.rrect(g, bx - 38, L.btnY - 17, 76, 34, 10);
          g.fill();
          g.strokeStyle = INK;
          g.lineWidth = 2;
          g.stroke();
          D.text(g, 'POUR', bx, L.btnY + 1, 15, INK, { family: UT.font.display, weight: 400 });
        }
      }

      /* next glass + spill */
      D.text(g, 'NEXT', L.next.x + L.next.w / 2, L.next.y - 6, 13, INK, { weight: 800 });
      if (this.next && !(this.state === 'intro')) this.drawGlass(g, this.next, L.next.x, L.next.y + 6, L.next.w, L.next.h);
      const sp = L.spill;
      const flash = this.warn > 0 && Math.sin(this.clock * 14) > 0;
      g.fillStyle = this.spills > 0 ? (flash ? C.coral : C.sky) : '#c9bfa9';
      D.rrect(g, sp.x, sp.y, sp.w, sp.h, 10);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.stroke();
      D.text(g, 'SPILL ×' + this.spills, sp.x + sp.w / 2, sp.y + sp.h / 2 + 1, 14, INK, { family: UT.font.display, weight: 400 });
      if (this.warn > 0) D.text(g, 'No column fits: spill it', sp.x + sp.w / 2 + 2, sp.y + sp.h + 16, 11, C.coral, { weight: 800 });

      /* give up */
      const gu = L.giveUp;
      g.fillStyle = '#7b4fd6';
      D.rrect(g, gu.x, gu.y, gu.w, gu.h, 25);
      g.fill();
      D.text(g, 'GIVE UP', gu.x + gu.w / 2, gu.y + gu.h / 2 + 1, 16, '#ffffff', { family: UT.font.display, weight: 400 });

      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'handEnd') this.drawHandEnd(g);
    }

    drawHeader(g) {
      const W = this.W;
      /* score (left of title, clear of the pause button) */
      g.fillStyle = INK;
      D.rrect(g, 96, 12, 150, 36, 18);
      g.fill();
      D.text(g, this.score.toLocaleString(), 234, 31, 18, C.amber, { align: 'right', family: UT.font.display, weight: 400 });
      D.text(g, 'H' + this.hand, 116, 31, 13, C.mint, { weight: 800 });
      D.text(g, 'FIZZ 21', W / 2 - 60, 30, 28, CREAM, { family: UT.font.display, weight: 400, stroke: '#0b5552', strokeWidth: 6 });
      /* speed bonus bar */
      const bx = W / 2 + 30;
      const bw = Math.max(120, W - this.L.right - bx - 20);
      const v = this.state === 'intro' ? SPEED_START : this.speed;
      g.fillStyle = INK;
      D.rrect(g, bx, 16, bw, 18, 9);
      g.fill();
      const grad = g.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#e2412f');
      grad.addColorStop(0.5, '#ffd23f');
      grad.addColorStop(1, '#3ddc97');
      g.fillStyle = grad;
      D.rrect(g, bx + 2, 18, Math.max(0, (bw - 4) * (v / SPEED_START)), 14, 7);
      g.fill();
      D.text(g, 'SPEED BONUS ' + v, bx + bw / 2, 46, 11, CREAM, { weight: 800 });
      /* best */
      g.fillStyle = INK;
      D.rrect(g, W - this.L.right + 14, 12, this.L.right - 28, 36, 10);
      g.fill();
      D.text(g, 'BEST ' + Math.max(this.best, this.score).toLocaleString(), W - this.L.right / 2, 31, 14, C.amber, { weight: 800 });
    }

    /* total box + payout table on the right */
    drawTable(g) {
      const L = this.L;
      const x = this.W - L.right + 14;
      const w = L.right - 28;
      const sum = this.sum();
      g.fillStyle = '#7b4fd6';
      D.rrect(g, x, 76, w, 44, 10);
      g.fill();
      D.text(g, 'TOTAL ' + sum, x + w / 2, 99, 20, '#ffffff', { family: UT.font.display, weight: 400 });
      g.fillStyle = INK;
      D.rrect(g, x, 130, w, 260, 10);
      g.fill();
      D.text(g, 'TOTAL', x + 34, 148, 11, C.dim, { weight: 800 });
      D.text(g, 'PAYS', x + w - 34, 148, 11, C.dim, { weight: 800 });
      for (let t = 105, k = 0; t >= 97; t--, k++) {
        const y = 172 + k * 24;
        const hit = sum === t;
        if (hit) {
          g.fillStyle = 'rgba(255,210,63,0.25)';
          g.fillRect(x + 6, y - 11, w - 12, 22);
        }
        D.text(g, String(t), x + 34, y, 15, hit ? C.amber : CREAM, { weight: 800 });
        D.text(g, PAYOUT[t].toLocaleString(), x + w - 34, y, 15, hit ? C.amber : CREAM, { weight: 800 });
      }
    }

    /* an original soda glass: tapered glass, flavour by suit, fizz cap with the value */
    drawGlass(g, card, x, y, w, h) {
      const f = FLAVORS[card.s];
      const top = y + h * 0.28;
      g.save();
      g.beginPath();
      g.moveTo(x + w * 0.1, top);
      g.lineTo(x + w * 0.9, top);
      g.lineTo(x + w * 0.8, y + h);
      g.lineTo(x + w * 0.2, y + h);
      g.closePath();
      g.fillStyle = f.liquid;
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x + w * 0.24, top + 6, w * 0.08, h * 0.5);
      /* bubbles */
      g.fillStyle = 'rgba(255,255,255,0.5)';
      [[0.4, 0.55], [0.6, 0.7], [0.5, 0.85]].forEach(([bx, by]) => { g.beginPath(); g.arc(x + w * bx, y + h * by, w * 0.035, 0, Math.PI * 2); g.fill(); });
      g.restore();
      /* fizz cap */
      g.fillStyle = card.ace ? '#ffe680' : CREAM;
      g.beginPath();
      [0.2, 0.4, 0.6, 0.8].forEach((cx, k) => g.arc(x + w * cx, top - 2 + (k % 2) * 3, w * 0.16, 0, Math.PI * 2));
      g.fill();
      g.strokeStyle = 'rgba(19,32,43,0.25)';
      g.lineWidth = 1;
      g.stroke();
      const label = card.ace ? 'A' : String(card.value);
      D.text(g, label, x + w / 2, top - 2, Math.round(w * 0.34), card.ace ? '#7b4fd6' : RED, { family: UT.font.display, weight: 400, stroke: '#ffffff', strokeWidth: 3 });
      if (card.r >= 10) D.text(g, RANKS[card.r], x + w / 2, y + h * 0.66, Math.round(w * 0.2), 'rgba(255,255,255,0.8)', { weight: 800 });
    }

    panel(g, w, h) {
      const x = this.W / 2 - w / 2;
      const y = this.H / 2 - h / 2;
      g.fillStyle = 'rgba(19,32,43,0.55)';
      g.fillRect(0, 0, this.W, this.H);
      g.fillStyle = CREAM;
      D.rrect(g, x, y, w, h, 18);
      g.fill();
      g.strokeStyle = RED;
      g.lineWidth = 4;
      g.stroke();
      return { x, y };
    }

    drawIntro(g) {
      const { y } = this.panel(g, 520, 250);
      const cx = this.W / 2;
      D.text(g, 'HAND ' + this.hand + ' OF ' + HANDS, cx, y + 44, 34, RED, { family: UT.font.display, weight: 400 });
      const lines = [
        'Pour each glass into any of 5 columns without going over 21.',
        'A column is done at 21 or after 5 glasses. Aces count 1 or 11: a soft 21 can still take more.',
        'Spill one unwanted glass per hand. Faster play keeps more speed bonus.',
        'Your 5-column total pays: 105 = 1,000 … 97 = 50 (+ speed bonus).',
      ];
      lines.forEach((t, i) => D.text(g, t, cx, y + 92 + i * 26, 14, INK, { weight: i === 3 ? 800 : 600 }));
      if (this.stateT > 0.3) D.text(g, 'TAP TO POUR', cx, y + 220, 16, TEAL, { weight: 800 });
    }

    drawHandEnd(g) {
      const r = this.result;
      const { y } = this.panel(g, 460, 250);
      const cx = this.W / 2;
      D.text(g, r.win ? 'TOTAL ' + r.sum + '!' : 'TOTAL ' + r.sum, cx, y + 44, 34, r.win ? TEAL : RED, { family: UT.font.display, weight: 400 });
      D.text(g, r.reason, cx, y + 82, 14, '#5b6470', { weight: 600 });
      D.text(g, r.win ? 'Table pays  +' + r.win.toLocaleString() : 'Below 97: the table pays nothing', cx, y + 112, 16, INK, { weight: 700 });
      if (r.win) D.text(g, 'Speed bonus  +' + r.speed, cx, y + 136, 16, INK, { weight: 700 });
      D.text(g, 'Score ' + this.score.toLocaleString(), cx, y + 172, 22, RED, { weight: 800 });
      const more = this.hand < HANDS ? 'TAP FOR HAND ' + (this.hand + 1) : 'TAP TO FINISH';
      if (this.stateT > 1) D.text(g, more, cx, y + 220, 16, TEAL, { weight: 800 });
    }
  }

  UT.Fizz21 = Fizz21;
  UT.Fizz21.total = total;
  UT.Fizz21.payout = payout;
})();
