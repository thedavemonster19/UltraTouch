/* Streak 21 — build hands of 21 in four columns from one deck.
 * Mechanics follow the bar-top classic as Merit describes it: place each card in any of 4 columns; a column that
 * reaches 21, or holds 5 cards under 21, clears and scores; going over 21 costs points; 3 skips per game.
 * Scoring per a player who knew the machine: each 21 is worth the streak value, which starts at 1,000 and rises
 * 1,000 with every hand cleared in a row; a skip drops it back to 1,000 (a bust only costs points). 150,000 by the end of the deck
 * earns a bonus deck. Name, art and the bust/bonus details are our own. */
(function () {
  'use strict';
  const UT = window.UT;
  const C = UT.col;
  const D = UT.draw;

  const COLS = 4;
  const MAX_IN_COL = 5;
  const SKIPS = 3;
  const STREAK_STEP = 1000;
  const BUST_COST = 1000;
  const BONUS_TARGET = 150000;
  const DECKS = 1; /* one 52-card deck: about 17 hands, so 150,000 needs a near-perfect streak (1k + 2k + ... + 17k) */
  const ROUND_TIME = 120;
  const DOTS = 20;
  const DOT_BONUS = 200; /* per timer dot left when the deck is finished or the score is taken, as in Take 2 */
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RED = [false, true, true, false];
  const NAVY = '#0f1d3a';
  const NEON = '#4de1ff';
  const PINK = '#ff4fa0';

  function shuffledDeck() {
    const d = [];
    for (let k = 0; k < DECKS; k++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s, value: Math.min(10, r + 1), ace: r === 0 });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  /* best total: an ace counts 11 unless that would go over 21 */
  function total(col) {
    let t = 0;
    let aces = 0;
    col.forEach((c) => { t += c.value; if (c.ace) aces++; });
    if (aces && t + 10 <= 21) t += 10;
    return t;
  }

  class Streak21 {
    constructor(opts) {
      this.onEnd = opts.onEnd;
      this.onRecord = opts.onRecord || (() => {});
      this.score = 0;
      this.streak = STREAK_STEP; /* what the next 21 pays */
      this.twentyOnes = 0;
      this.busts = 0;
      this.skips = SKIPS;
      this.deckNo = 0;
      this.best = UT.scores.best('streak21');
      this.popups = new UT.Popups();
      this.W = 960;
      this.H = 540;
      this.clock = 0;
      this.flying = null;
      this.clearing = []; /* columns animating away: { cards, i, t, kind } */
      this.startDeck();
    }

    get bonusDeck() { return this.deckNo > 1; }

    startDeck() {
      this.deckNo++;
      this.deck = shuffledDeck();
      this.cols = [[], [], [], []];
      this.next = this.deck.pop();
      this.state = 'intro';
      this.stateT = 0;
      this.timeLeft = ROUND_TIME;
      this.timeBonus = 0;
      this.lastTick = 11;
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
      const left = 128;
      const right = 210;
      const x0 = left + 10;
      const x1 = W - right - 10;
      const colW = (x1 - x0) / COLS;
      const cw = Math.round(Math.min(76, colW - 18));
      this.L = {
        left, right, x0, colW, cw, ch: Math.round(cw * 1.4), step: Math.round(cw * 0.42),
        totalsY: 96, stackY: 126,
        next: { x: 26, y: 118, w: 76, h: 106 },
        skip: { x: 18, y: 250, w: 92, h: 42 },
        take: { x: 18, y: 318, w: 92, h: 50 },
      };
    }
    colX(i) { return this.L.x0 + i * this.L.colW + this.L.colW / 2; }

    /* ---------- rules ---------- */
    place(i) {
      if (i < 0 || i >= COLS || !this.next) return;
      const card = this.next;
      const col = this.cols[i];
      col.push(card);
      this.flying = { card, t: 0 };
      UT.sfx.select();
      const t = total(col);
      if (t === 21 || (t < 21 && col.length >= MAX_IN_COL)) this.clearCol(i, t === 21 ? '21!' : '5 CARDS');
      else if (t > 21) this.bust(i);
      this.advance();
    }

    clearCol(i, label) {
      const pts = this.streak;
      this.score += pts;
      this.twentyOnes++;
      this.popups.add(label + ' +' + pts.toLocaleString(), this.colX(i), this.L.totalsY + 50, this.streak >= 5000 ? PINK : C.amber, 26);
      this.streak += STREAK_STEP;
      this.clearing.push({ cards: this.cols[i], i, t: 0, kind: 'win' });
      this.cols[i] = [];
      UT.sfx.match(Math.min(8, this.streak / STREAK_STEP));
    }

    bust(i) {
      this.score = Math.max(0, this.score - BUST_COST);
      this.busts++;
      this.popups.add('BUST −' + BUST_COST.toLocaleString(), this.colX(i), this.L.totalsY + 50, C.coral, 24);
      this.clearing.push({ cards: this.cols[i], i, t: 0, kind: 'bust' });
      this.cols[i] = [];
      UT.sfx.nope();
    }

    skip() {
      if (this.skips <= 0 || !this.next) { UT.sfx.nope(); this.popups.add('NO SKIPS LEFT', this.L.skip.x + 46, this.L.skip.y - 10, C.coral, 18); return; }
      this.skips--;
      if (this.streak > STREAK_STEP) this.popups.add('STREAK RESET', this.L.skip.x + 46, this.L.skip.y - 10, C.sky, 18);
      this.streak = STREAK_STEP;
      UT.sfx.deal();
      this.advance();
    }

    advance() {
      this.next = this.deck.pop() || null;
      if (!this.next) this.endDeck('Deck finished');
    }

    endDeck(reason) {
      this.reason = reason || 'Deck finished';
      const dots = (this.timeLeft / ROUND_TIME) * DOTS;
      this.timeBonus = this.timeLeft > 0 ? Math.round((dots * DOT_BONUS) / 50) * 50 : 0;
      this.score += this.timeBonus;
      this.state = 'deckEnd';
      this.stateT = 0;
      this.nextStep = !this.bonusDeck && this.score >= BONUS_TARGET ? 'bonus' : 'over';
      if (this.nextStep === 'over') {
        UT.sfx.lose();
        this.onRecord(this.result());
      } else UT.sfx.heat();
    }

    result() {
      if (!this._result) this._result = { game: 'streak21', score: this.score, twentyOnes: this.twentyOnes, busts: this.busts, bonus: this.bonusDeck };
      return this._result;
    }

    finish() {
      this.state = 'done';
      this.onEnd(this.result());
    }

    /* ---------- input ---------- */
    inBox(x, y, b) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

    onDown(x, y) {
      const L = this.L;
      if (this.state === 'intro') {
        if (this.stateT > 0.3) { this.state = 'play'; UT.sfx.deal(); }
        return;
      }
      if (this.state === 'deckEnd') {
        if (this.stateT > 1) {
          UT.sfx.tap();
          if (this.nextStep === 'bonus') this.startDeck();
          else this.finish();
        }
        return;
      }
      if (this.state !== 'play' || this.flying) return;
      if (this.inBox(x, y, L.skip)) { this.skip(); return; }
      if (this.inBox(x, y, L.take)) { UT.sfx.tap(); this.endDeck('You took the score'); return; }
      if (x < L.x0 || x > L.x0 + COLS * L.colW || y < L.totalsY - 24) return;
      this.place(Math.floor((x - L.x0) / L.colW));
    }

    update(dt) {
      this.clock += dt;
      this.stateT += dt;
      this.popups.update(dt);
      if (this.flying) {
        this.flying.t += dt;
        if (this.flying.t > 0.2) this.flying = null;
      }
      this.clearing.forEach((c) => (c.t += dt));
      this.clearing = this.clearing.filter((c) => c.t < 0.5);
      if (this.state === 'play') {
        this.timeLeft -= dt;
        const whole = Math.ceil(this.timeLeft);
        if (whole < this.lastTick && whole > 0) { this.lastTick = whole; UT.sfx.tick(); }
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          UT.sfx.horn();
          this.endDeck('Time ran out');
        }
      }
    }

    /* ---------- drawing ---------- */
    draw(g) {
      const W = this.W;
      const H = this.H;
      const L = this.L;
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#16285a');
      bg.addColorStop(1, NAVY);
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      /* neon grid floor */
      g.strokeStyle = 'rgba(77,225,255,0.08)';
      g.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

      this.drawHeader(g);
      this.drawPanel(g);

      /* column totals + stacks */
      for (let i = 0; i < COLS; i++) {
        const cx = this.colX(i);
        const t = total(this.cols[i]);
        g.fillStyle = NAVY;
        D.rrect(g, cx - 32, L.totalsY - 16, 64, 32, 8);
        g.fill();
        g.strokeStyle = t >= 17 ? PINK : NEON;
        g.lineWidth = 2;
        g.stroke();
        D.text(g, String(t), cx, L.totalsY + 1, 18, '#ffffff', { family: UT.font.display, weight: 400 });
        g.strokeStyle = 'rgba(77,225,255,0.18)';
        g.setLineDash([6, 6]);
        D.rrect(g, cx - L.cw / 2, L.stackY, L.cw, L.ch + (MAX_IN_COL - 1) * L.step, 10);
        g.stroke();
        g.setLineDash([]);
        this.cols[i].forEach((card, k) => {
          let x = cx - L.cw / 2;
          let y = L.stackY + k * L.step;
          if (this.flying && this.flying.card === card) {
            const e = UT.ease(this.flying.t / 0.2);
            x = UT.lerp(L.next.x, x, e);
            y = UT.lerp(L.next.y, y, e);
          }
          this.drawCard(g, card, x, y, L.cw, L.ch);
        });
      }
      /* cleared or busted columns fly away */
      this.clearing.forEach((c) => {
        const k = c.t / 0.5;
        g.save();
        g.globalAlpha = 1 - k;
        c.cards.forEach((card, n) => this.drawCard(g, card, this.colX(c.i) - L.cw / 2 + (c.kind === 'bust' ? Math.sin(c.t * 50) * 6 : 0), L.stackY + n * L.step - (c.kind === 'win' ? k * 120 : 0), L.cw, L.ch));
        g.restore();
      });
      D.text(g, 'TAP A COLUMN TO PLACE THE CARD', L.x0 + (COLS * L.colW) / 2, H - 18, 12, 'rgba(255,255,255,0.45)', { weight: 800 });

      /* next card + skip */
      D.text(g, 'NEXT', L.next.x + L.next.w / 2, L.next.y - 10, 13, NEON, { weight: 800 });
      if (this.next && this.state !== 'intro' && !(this.flying && !this.next)) this.drawCard(g, this.next, L.next.x, L.next.y, L.next.w, L.next.h);
      D.text(g, this.deck.length + ' left in deck', L.next.x + L.next.w / 2, L.next.y + L.next.h + 12, 11, 'rgba(255,255,255,0.6)', { weight: 700 });
      const sk = L.skip;
      g.fillStyle = this.skips > 0 ? PINK : '#3b4466';
      D.rrect(g, sk.x, sk.y, sk.w, sk.h, 12);
      g.fill();
      D.text(g, 'SKIP ×' + this.skips, sk.x + sk.w / 2, sk.y + sk.h / 2 + 1, 15, '#ffffff', { family: UT.font.display, weight: 400 });
      D.text(g, 'resets the streak', sk.x + sk.w / 2, sk.y + sk.h + 12, 10, 'rgba(255,255,255,0.55)', { weight: 700 });
      const tk = L.take;
      g.fillStyle = NAVY;
      D.rrect(g, tk.x, tk.y, tk.w, tk.h, 12);
      g.fill();
      g.strokeStyle = NEON;
      g.lineWidth = 2;
      g.stroke();
      D.text(g, 'TAKE', tk.x + tk.w / 2, tk.y + tk.h / 2 - 8, 13, '#ffffff', { family: UT.font.display, weight: 400 });
      D.text(g, 'SCORE', tk.x + tk.w / 2, tk.y + tk.h / 2 + 9, 13, '#ffffff', { family: UT.font.display, weight: 400 });

      this.popups.draw(g);
      if (this.state === 'intro') this.drawIntro(g);
      if (this.state === 'deckEnd') this.drawDeckEnd(g);
    }

    drawHeader(g) {
      g.fillStyle = 'rgba(15,29,58,0.85)';
      g.fillRect(0, 0, this.W, 58);
      g.fillStyle = NEON;
      g.fillRect(0, 58, this.W, 2);
      D.text(g, 'STREAK 21', this.W / 2 - this.L.right / 2 + 30, 30, 28, '#ffffff', { family: UT.font.display, weight: 400, stroke: PINK, strokeWidth: 5 });
      if (this.bonusDeck) D.text(g, 'BONUS DECK', this.W / 2 - this.L.right / 2 + 30, 76, 12, C.amber, { family: UT.font.display, weight: 400 });
      /* dot timer, right of the title */
      const tx = this.W / 2 - this.L.right / 2 + 150;
      const tw = Math.max(110, this.W - this.L.right - tx - 30);
      g.fillStyle = NAVY;
      D.rrect(g, tx - 6, 18, tw + 12, 22, 11);
      g.fill();
      const lit = Math.ceil((this.timeLeft / ROUND_TIME) * DOTS);
      for (let i = 0; i < DOTS; i++) {
        const on = i >= DOTS - lit;
        const f = i / DOTS;
        g.fillStyle = !on ? '#26304f' : f < 0.2 ? '#ff4d5e' : f < 0.45 ? '#ffd23f' : NEON;
        g.beginPath();
        g.arc(tx + 4 + (i * (tw - 8)) / (DOTS - 1), 29, 4.5, 0, Math.PI * 2);
        g.fill();
      }
    }

    /* score, best and the streak counter (bottom right, like the cabinet's 21 counter) */
    drawPanel(g) {
      const x = this.W - this.L.right + 10;
      const w = this.L.right - 24;
      g.fillStyle = NAVY;
      D.rrect(g, x, 8, w, 42, 10);
      g.fill();
      D.text(g, 'SCORE', x + 12, 29, 11, NEON, { align: 'left', weight: 800 });
      D.text(g, this.score.toLocaleString(), x + w - 12, 30, 20, C.amber, { align: 'right', family: UT.font.display, weight: 400 });
      D.text(g, 'BEST ' + Math.max(this.best, this.score).toLocaleString(), x + w / 2, 74, 12, 'rgba(255,255,255,0.7)', { weight: 800 });
      D.text(g, 'BONUS DECK AT ' + BONUS_TARGET.toLocaleString(), x + w / 2, 94, 11, this.score >= BONUS_TARGET ? C.amber : 'rgba(255,255,255,0.5)', { weight: 800 });
      D.text(g, '21s ' + this.twentyOnes + '   BUSTS ' + this.busts, x + w / 2, 116, 12, 'rgba(255,255,255,0.75)', { weight: 800 });
      /* streak counter */
      const cy = this.H - 160;
      g.save();
      g.shadowColor = PINK;
      g.shadowBlur = 8 + Math.min(20, this.streak / 1000 * 2);
      g.fillStyle = NAVY;
      D.rrect(g, x, cy, w, 128, 16);
      g.fill();
      g.restore();
      g.strokeStyle = PINK;
      g.lineWidth = 3;
      D.rrect(g, x, cy, w, 128, 16);
      g.stroke();
      D.text(g, 'NEXT 21 PAYS', x + w / 2, cy + 22, 12, NEON, { weight: 800 });
      D.text(g, this.streak.toLocaleString(), x + w / 2, cy + 62, 34, '#ffffff', { family: UT.font.display, weight: 400, stroke: PINK, strokeWidth: 5 });
      const run = this.streak / STREAK_STEP - 1;
      D.text(g, run > 0 ? run + ' in a row · +' + STREAK_STEP.toLocaleString() + ' each' : '+' + STREAK_STEP.toLocaleString() + ' per 21 in a row', x + w / 2, cy + 100, 11, 'rgba(255,255,255,0.7)', { weight: 700 });
    }

    drawCard(g, card, x, y, w, h) {
      const rad = w * 0.09;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = 6;
      g.shadowOffsetY = 2;
      g.fillStyle = '#ffffff';
      D.rrect(g, x, y, w, h, rad);
      g.fill();
      g.restore();
      g.strokeStyle = '#b8c2d6';
      g.lineWidth = 1;
      D.rrect(g, x, y, w, h, rad);
      g.stroke();
      const col = RED[card.s] ? '#e0245e' : '#14213d';
      const rank = RANKS[card.r];
      D.text(g, rank, x + w * 0.08, y + w * 0.2, Math.round(w * (rank === '10' ? 0.26 : 0.3)), col, { align: 'left', weight: 800 });
      D.text(g, SUITS[card.s], x + w * 0.88, y + w * 0.2, Math.round(w * 0.26), col, { align: 'right', weight: 400, family: 'system-ui, sans-serif' });
      D.text(g, SUITS[card.s], x + w / 2, y + h * 0.62, Math.round(w * 0.5), col, { weight: 400, family: 'system-ui, sans-serif' });
    }

    panel(g, w, h) {
      const x = this.W / 2 - w / 2;
      const y = this.H / 2 - h / 2;
      g.fillStyle = 'rgba(5,10,25,0.6)';
      g.fillRect(0, 0, this.W, this.H);
      g.fillStyle = NAVY;
      D.rrect(g, x, y, w, h, 18);
      g.fill();
      g.strokeStyle = PINK;
      g.lineWidth = 3;
      g.stroke();
      return { x, y };
    }

    drawIntro(g) {
      const { y } = this.panel(g, 520, 260);
      const cx = this.W / 2;
      D.text(g, this.bonusDeck ? 'BONUS DECK!' : 'STREAK 21', cx, y + 42, 34, this.bonusDeck ? C.amber : '#ffffff', { family: UT.font.display, weight: 400 });
      const lines = [
        'Place each card in one of 4 columns. Hit 21 (or 5 cards under 21) to clear it.',
        'Every 21 in a row pays 1,000 more: 1,000, 2,000, 3,000…',
        'A skip (3 per game) resets the streak to 1,000.',
        'Going over 21 costs ' + BUST_COST.toLocaleString() + '. Aces are 1 or 11. ' + ROUND_TIME / 60 + ' minutes on the clock.',
        this.bonusDeck ? 'One more deck. Your streak carries on.' : 'Finish the deck with ' + BONUS_TARGET.toLocaleString() + '+ to earn a bonus deck.',
      ];
      lines.forEach((t, i) => D.text(g, t, cx, y + 84 + i * 26, 14, i === 1 ? C.amber : '#e6ecff', { weight: i === 1 ? 800 : 600 }));
      if (this.stateT > 0.3) D.text(g, 'TAP TO DEAL', cx, y + 232, 16, NEON, { weight: 800 });
    }

    drawDeckEnd(g) {
      const { y } = this.panel(g, 460, 240);
      const cx = this.W / 2;
      const bonus = this.nextStep === 'bonus';
      D.text(g, bonus ? 'BONUS DECK!' : 'DECK DONE', cx, y + 40, 34, bonus ? C.amber : PINK, { family: UT.font.display, weight: 400 });
      D.text(g, this.reason + ' · ' + this.twentyOnes + ' hands · ' + this.busts + ' busts', cx, y + 78, 14, '#e6ecff', { weight: 600 });
      if (this.timeBonus) D.text(g, 'Time bonus +' + this.timeBonus.toLocaleString() + ' (' + DOT_BONUS + ' per timer dot left)', cx, y + 102, 14, NEON, { weight: 700 });
      D.text(g, 'Score ' + this.score.toLocaleString(), cx, y + 136, 22, C.amber, { weight: 800 });
      D.text(g, bonus ? 'Over ' + BONUS_TARGET.toLocaleString() + ': one more deck, streak intact' : this.bonusDeck ? 'Bonus deck finished' : 'Needed ' + BONUS_TARGET.toLocaleString() + ' for the bonus deck', cx, y + 168, 14, '#e6ecff', { weight: 600 });
      if (this.stateT > 1) D.text(g, 'TAP TO CONTINUE', cx, y + 212, 15, NEON, { weight: 800 });
    }
  }

  UT.Streak21 = Streak21;
  UT.Streak21.total = total;
})();
