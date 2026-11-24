/* Shared all-time top-10 boards with no server of our own: scores are posted to a Google Form, whose responses land in
 * a Google Sheet that is shared view-only; the board is read back from that Sheet. The Sheet owner can delete
 * any bad row. Configured in leaderboard-config.js. */
(function () {
  'use strict';
  const UT = window.UT;
  const CFG = window.UT_LEADERBOARD || {};
  const E = CFG.entries || {};

  /* highest believable score per board; anything above is ignored when reading */
  const MAX = { 'swish-arcade': 3000, pairoff: 800000, fizz21: 4000, streak21: 1500000 };
  const NAME_MAX = 12;

  let cache = null; /* { at, rows } */

  function boardKey(game) { return (UT.SCORE_TABLE && UT.SCORE_TABLE[game]) || game; }

  function clean(name) {
    return String(name || '')
      .replace(/[^\p{L}\p{N} ._'-]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX);
  }

  /* read the Sheet through the Google Visualization endpoint as JSONP (works from any static site) */
  function readSheet() {
    return new Promise((resolve, reject) => {
      const cb = '__utLB' + Date.now() + Math.floor(Math.random() * 1000);
      const s = document.createElement('script');
      const done = (fn, v) => {
        clearTimeout(timer);
        delete window[cb];
        s.remove();
        fn(v);
      };
      const timer = setTimeout(() => done(reject, new Error('timeout')), 9000);
      window[cb] = (resp) => {
        try {
          const rows = (resp.table && resp.table.rows) || [];
          const out = [];
          rows.forEach((r) => {
            const c = r.c || [];
            const val = (i) => (c[i] && c[i].v != null ? c[i].v : '');
            /* columns: Timestamp, Game, Name, Score, Detail */
            const game = String(val(1)).trim();
            const name = clean(val(2));
            const score = Math.round(Number(String(val(3)).replace(/[^0-9.-]/g, '')));
            if (!game || !name || !Number.isFinite(score) || score <= 0) return;
            if (MAX[game] && score > MAX[game]) return;
            out.push({ game, name, score, detail: String(val(4)).slice(0, 40) });
          });
          done(resolve, out);
        } catch (e) {
          done(reject, e);
        }
      };
      s.onerror = () => done(reject, new Error('load'));
      s.src = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(CFG.sheetId) + '/gviz/tq?tqx=out:json;responseHandler:' + cb + '&headers=1&t=' + Date.now();
      document.head.appendChild(s);
    });
  }

  UT.lb = {
    get enabled() { return !!(CFG.formAction && CFG.sheetId && E.game && E.name && E.score); },
    clean,
    nameMax: NAME_MAX,
    savedName() { return UT.store.get('nick', ''); },
    saveName(n) { UT.store.set('nick', clean(n)); },

    /* fire-and-forget POST to the Form; the response is opaque, so success means "sent" */
    submit(game, name, score, detail) {
      const body = new URLSearchParams();
      body.append(E.game, boardKey(game));
      body.append(E.name, clean(name));
      body.append(E.score, String(Math.round(score)));
      if (E.detail) body.append(E.detail, String(detail || '').slice(0, 40));
      cache = null;
      return fetch(CFG.formAction, { method: 'POST', mode: 'no-cors', body }).then(() => true, () => false);
    },

    /* classic arcade table: every score ever posted, highest first; the same player can appear more than
     * once, and on a tie the earlier score stays ahead (rows arrive in the order they were posted) */
    async top(game, n) {
      if (!cache || Date.now() - cache.at > 15000) cache = { at: Date.now(), rows: await readSheet() };
      const key = boardKey(game);
      const list = cache.rows.filter((r) => r.game === key).sort((a, b) => b.score - a.score);
      return n ? list.slice(0, n) : list;
    },

    /* where this exact score landed among all scores on the board */
    async rankOf(game, name, score) {
      const list = await this.top(game);
      const id = clean(name).toLowerCase();
      let i = -1;
      for (let k = list.length - 1; k >= 0; k--) if (list[k].name.toLowerCase() === id && list[k].score === Math.round(score)) { i = k; break; }
      return i < 0 ? null : { rank: i + 1, of: list.length, score: list[i].score };
    },

    refresh() { cache = null; },
  };
})();
