/* UltraTouch shell: hub, pause/results sheets, fullscreen + orientation, offline install. */
(function () {
  'use strict';
  const UT = window.UT;
  const $ = (s) => document.querySelector(s);
  const hub = $('#hub');
  const overlay = $('#overlay');
  const pauseBtn = $('#btn-pause');
  const stage = (UT.stage = new UT.Stage($('#stage')));
  ['touchend', 'click', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => UT.sfx.unlock(), { passive: true }));

  /* Fit the app to the part of the screen you can actually see. Mobile Safari's toolbars overlap the page
   * (and grow/shrink as you scroll), so the full window height would push the bottom of the game off-screen. */
  const appEl = $('#app');
  function fitViewport() {
    const vv = window.visualViewport;
    if (vv) {
      appEl.style.top = vv.offsetTop + 'px';
      appEl.style.left = vv.offsetLeft + 'px';
      appEl.style.width = vv.width + 'px';
      appEl.style.height = vv.height + 'px';
      appEl.style.right = 'auto';
      appEl.style.bottom = 'auto';
    }
    stage.resize();
    fitHub();
    fitSheet();
  }
  /* shrink the whole menu to fit the visible height (either orientation), so nothing hides under the toolbar */
  const hubInner = document.querySelector('.hub-inner');
  function fitHub() {
    if (hub.hidden) return;
    hubInner.style.transform = '';
    hubInner.style.width = '';
    hub.style.overflowY = '';
    const cs = getComputedStyle(hub);
    const availH = hub.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = hub.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (hubInner.offsetHeight <= availH) return;
    /* widening the content (so it still fills the width once scaled) changes its height, so settle in a few passes */
    let s = 1;
    for (let i = 0; i < 4; i++) {
      s = UT.clamp(availH / hubInner.offsetHeight, 0.45, 1);
      hubInner.style.width = availW / s + 'px';
    }
    s = UT.clamp(availH / hubInner.offsetHeight, 0.45, 1);
    hubInner.style.transform = 'scale(' + s + ')';
    hub.style.overflowY = 'hidden';
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHub);
  window.addEventListener('resize', fitHub);
  window.addEventListener('resize', () => fitSheet());
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('orientationchange', () => setTimeout(fitViewport, 350));
  window.addEventListener('pageshow', fitViewport);
  fitViewport();
  const NAMES = { swish: 'Swish Shot', pairoff: 'Pair Off', fizz21: 'Fizz 21', streak21: 'Streak 21' };
  const GAMES = ['swish', 'pairoff', 'fizz21', 'streak21'];
  let current = null; /* { game, opts } */
  let swishPlayers = UT.clamp(UT.store.get('swishPlayers', 1), 1, 4);

  /* ---------- hub ---------- */
  function refreshBest() {
    GAMES.forEach((g) => {
      const b = UT.scores.best(g);
      $('#best-' + g).textContent = b ? b.toLocaleString() : '—';
    });
  }
  /* each game's #1 from the shared board, shown on its menu tile; last known value shows instantly */
  function showChamp(g, top) {
    const el = $('#champ-' + g);
    if (!el) return;
    el.hidden = !top;
    if (!top) return;
    el.querySelector('.champ-name').textContent = top.name;
    el.querySelector('.champ-score').textContent = top.score.toLocaleString();
  }
  async function refreshChamps() {
    if (!UT.lb.enabled) return;
    GAMES.forEach((g) => showChamp(g, UT.store.get('champ:' + g, null)));
    fitHub();
    for (const g of GAMES) {
      try {
        const top = (await UT.lb.top(g, 1))[0] || null;
        UT.store.set('champ:' + g, top);
        showChamp(g, top);
      } catch (e) { /* offline: keep the last known #1 */ }
    }
    fitHub();
  }
  function setPlayers(n) {
    swishPlayers = n;
    UT.store.set('swishPlayers', n);
    document.querySelectorAll('.pchip').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.p) === n)));
  }
  document.querySelectorAll('.pchip').forEach((b) =>
    b.addEventListener('click', () => {
      UT.sfx.unlock();
      UT.sfx.tap();
      setPlayers(Number(b.dataset.p));
    })
  );
  setPlayers(swishPlayers);

  document.querySelectorAll('.play').forEach((b) =>
    b.addEventListener('click', () => {
      UT.sfx.unlock();
      UT.sfx.tap();
      tryFullscreen();
      start(b.dataset.game);
    })
  );

  const soundBtn = $('#btn-sound');
  function syncSound() {
    soundBtn.textContent = UT.sfx.muted ? 'Sound off' : 'Sound on';
    soundBtn.setAttribute('aria-pressed', String(!UT.sfx.muted));
  }
  soundBtn.addEventListener('click', () => {
    UT.sfx.setMuted(!UT.sfx.muted);
    UT.sfx.unlock();
    UT.sfx.tap();
    syncSound();
  });
  syncSound();

  /* ---------- fullscreen (Android/desktop; iOS uses Add to Home Screen) ---------- */
  const root = document.documentElement;
  const canFs = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const standalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
  const fsBtn = $('#btn-fullscreen');
  if (canFs && !standalone) fsBtn.hidden = false;
  if (standalone) $('#install-tip').hidden = true;
  function tryFullscreen() {
    if (!canFs || standalone || document.fullscreenElement || document.webkitFullscreenElement) return;
    if (!UT.store.get('autoFs', false)) return;
    goFullscreen();
  }
  function goFullscreen() {
    try {
      const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
      Promise.resolve(p).catch(() => {});
    } catch (e) { /* not allowed here; keep playing windowed */ }
  }
  fsBtn.addEventListener('click', () => {
    UT.store.set('autoFs', true);
    goFullscreen();
  });


  /* ---------- game lifecycle ---------- */
  function start(game) {
    closeSheet();
    hub.hidden = true;
    pauseBtn.hidden = false;
    current = { game };
    const onRecord = (result) => record(result);
    const onEnd = (result) => setTimeout(() => results(result), 50);
    const make = () => (game === 'swish' ? new UT.Swish({ players: swishPlayers, onEnd, onRecord }) : game === 'fizz21' ? new UT.Fizz21({ onEnd, onRecord }) : game === 'streak21' ? new UT.Streak21({ onEnd, onRecord }) : new UT.PairOff({ onEnd, onRecord }));
    const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]) : Promise.resolve();
    fontsReady.then(() => stage.run(make()));
  }
  function toHub() {
    closeSheet();
    stage.stop();
    current = null;
    pauseBtn.hidden = true;
    hub.hidden = false;
    refreshBest();
    fitHub();
    refreshChamps();
  }

  /* ---------- sheet ---------- */
  function sheet(title, bodyHtml, actions) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = bodyHtml;
    const box = $('#sheet-actions');
    box.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', () => {
        UT.sfx.tap();
        a.run();
      });
      box.appendChild(b);
    });
    overlay.hidden = false;
    fitSheet();
    const first = box.querySelector('.primary') || box.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  /* scale the open sheet down if it is taller than the visible screen, so its buttons are always on screen */
  const sheetEl = document.querySelector('.sheet');
  function fitSheet() {
    if (overlay.hidden) return;
    sheetEl.style.transform = '';
    const cs = getComputedStyle(overlay);
    const availH = overlay.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const s = Math.min(1, (availH - 4) / sheetEl.offsetHeight);
    if (s < 1) sheetEl.style.transform = 'scale(' + s + ')';
  }
  function closeSheet() {
    overlay.hidden = true;
  }

  function pause() {
    if (!current || !stage.game || stage.paused) return;
    stage.paused = true;
    sheet('Paused', '<p class="note">' + NAMES[current.game] + '</p>', [
      { label: 'Resume', primary: true, run: resume },
      { label: 'Restart', run: () => start(current.game) },
      { label: UT.sfx.muted ? 'Sound on' : 'Sound off', run: () => { UT.sfx.setMuted(!UT.sfx.muted); syncSound(); resume(); } },
      { label: 'Quit to menu', run: toHub },
    ]);
  }
  function resume() {
    closeSheet();
    stage.last = performance.now();
    stage.paused = false;
  }
  pauseBtn.addEventListener('click', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function tableHtml(game, highlightRanks) {
    const list = UT.scores.list(game);
    if (!list.length) return '';
    return (
      '<div class="scores">' +
      list.map((e, i) => {
        const me = highlightRanks.includes(i) ? ' me' : '';
        return '<span class="rank' + me + '">#' + (i + 1) + '</span><span class="' + me.trim() + '">' + esc(e.label || '') + ' · ' + esc(e.date) + '</span><span class="val' + me + '">' + e.score.toLocaleString() + '</span>';
      }).join('') +
      '</div>'
    );
  }

  /* add a finished game to the high scores exactly once; returns the table ranks it earned */
  function record(r) {
    if (r.ranks) return r.ranks;
    const ranks = [];
    if (r.game === 'swish') {
      r.players.forEach((p) => {
        const label = r.players.length > 1 ? p.name : p.bonus ? 'Bonus round' : p.rounds === r.rounds ? 'All ' + r.rounds + ' rounds' : 'Round ' + Math.min(p.rounds + 1, r.rounds);
        const rank = UT.scores.add('swish', p.score, label);
        if (rank >= 0) ranks.push(rank);
      });
    } else if (r.game === 'streak21') {
      const rank = UT.scores.add('streak21', r.score, r.twentyOnes + ' hands' + (r.bonus ? ' · bonus round' : ''));
      if (rank >= 0) ranks.push(rank);
    } else if (r.game === 'fizz21') {
      const rank = UT.scores.add('fizz21', r.score, r.won + (r.won === 1 ? ' hand won' : ' hands won'));
      if (rank >= 0) ranks.push(rank);
    } else {
      const rank = UT.scores.add('pairoff', r.score, r.bonus ? 'Bonus round' : 'Round ' + r.round);
      if (rank >= 0) ranks.push(rank);
    }
    r.ranks = ranks;
    refreshBest();
    return ranks;
  }

  function results(r) {
    if (!current) return;
    stage.paused = true;
    pauseBtn.hidden = true;
    let body = '';
    const ranks = record(r);
    if (r.game === 'swish') {
      const sorted = r.players.slice().sort((a, b) => b.score - a.score);
      if (r.players.length === 1) {
        const p = r.players[0];
        const pct = p.shots ? Math.round((p.made / p.shots) * 100) : 0;
        body += '<div class="big-score">' + p.score.toLocaleString() + '</div>';
        body += '<p class="note">' + p.made + ' of ' + p.shots + ' shots (' + pct + '%) · ' + (p.rounds === r.rounds ? 'cleared all ' + r.rounds + ' rounds' : 'reached round ' + Math.min(p.rounds + 1, r.rounds)) + (p.bonus ? ' · bonus round +' + p.bonusPts : '') + '</p>';
      } else {
        body += '<p class="note">' + esc(sorted[0].name) + ' wins</p><div class="scores">';
        sorted.forEach((p, i) => {
          body += '<span class="rank">' + (i + 1) + '</span><span>' + esc(p.name) + ' · ' + p.made + '/' + p.shots + '</span><span class="val">' + p.score.toLocaleString() + '</span>';
        });
        body += '</div>';
      }
    } else if (r.game === 'streak21') {
      body += '<div class="big-score">' + r.score.toLocaleString() + '</div>';
      body += '<p class="note">' + r.twentyOnes + ' hands cleared · ' + (r.bonus ? 'played the bonus round' : 'round ' + Math.min(r.round, 2) + ' of 2') + '</p>';
    } else if (r.game === 'fizz21') {
      body += '<div class="big-score">' + r.score.toLocaleString() + '</div>';
      body += '<p class="note">' + r.won + (r.won === 1 ? ' hand won' : ' hands won') + ' · totals ' + r.hands.join(' · ') + ' (97 needed)</p>';
    } else {
      body += '<div class="big-score">' + r.score.toLocaleString() + '</div>';
      body += '<p class="note">' + esc(r.reason) + ' · ' + (r.bonus ? 'played the bonus round' : 'round ' + r.round + ' of 2') + ' · ' + r.boards + (r.boards === 1 ? ' board' : ' boards') + ' · ' + r.pairs + ' pairs, ' + r.runs + ' runs</p>';
    }
    if (ranks.includes(0)) body = '<p class="center"><span class="badge">NEW BEST</span></p>' + body;
    body = '<div class="split"><div class="summary">' + body + '</div><div class="board"><p class="note">Top scores on this device</p>' + tableHtml(r.game, ranks) + '</div></div>';
    if (UT.lb.enabled) body += postHtml(r);
    sheet(r.game === 'swish' ? 'Final buzzer' : r.game === 'fizz21' ? 'Last call' : r.game === 'streak21' ? 'Deck done' : 'Cards down', body, [
      { label: 'Play again', primary: true, run: () => start(r.game) },
      { label: 'Menu', run: toHub },
    ]);
    if (UT.lb.enabled) wirePost(r);
  }

  /* ---------- shared leaderboard ---------- */
  function scorers(r) {
    return r.game === 'swish' ? r.players.map((p) => ({ label: p.name, score: p.score, detail: p.bonus ? 'Bonus round' : r.players.length > 1 ? p.made + '/' + p.shots : 'Round ' + Math.min(p.rounds + 1, r.rounds) })) : r.game === 'fizz21' ? [{ label: 'You', score: r.score, detail: r.won + (r.won === 1 ? ' hand won' : ' hands won') }] : r.game === 'streak21' ? [{ label: 'You', score: r.score, detail: r.twentyOnes + ' hands' + (r.bonus ? ' + bonus' : '') }] : [{ label: 'You', score: r.score, detail: r.bonus ? 'Bonus round' : 'Round ' + r.round }];
  }
  function postHtml(r) {
    const who = scorers(r);
    const multi = who.length > 1;
    let h = '<div class="post" id="lb-post">';
    who.forEach((w, i) => {
      const val = i === 0 ? UT.lb.savedName() : '';
      h += '<input id="lb-name-' + i + '" class="lb-name" type="text" inputmode="text" autocomplete="nickname" autocapitalize="words" maxlength="' + UT.lb.nameMax + '" placeholder="' + (multi ? esc(w.label) + ' nickname' : 'Your nickname') + '" value="' + esc(val) + '" aria-label="' + esc(w.label) + ' nickname">';
    });
    h += '<button id="lb-send" type="button">' + (multi ? 'Post scores' : 'Post score') + '</button>';
    h += '<p class="note" id="lb-status">' + (r.posted ? 'Already posted.' : 'Post to the shared leaderboard so your friends can see it.') + '</p></div>';
    return h;
  }
  function wirePost(r) {
    const btn = $('#lb-send');
    const status = $('#lb-status');
    const inputs = [...document.querySelectorAll('.lb-name')];
    if (r.posted) btn.disabled = true;
    inputs.forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } }));
    btn.addEventListener('click', async () => {
      const who = scorers(r);
      const names = inputs.map((el) => UT.lb.clean(el.value));
      const missing = names.findIndex((n, i) => !n && who[i].score > 0);
      if (missing >= 0) { status.textContent = 'Type a nickname first (letters and numbers, up to ' + UT.lb.nameMax + ').'; inputs[missing].focus(); return; }
      btn.disabled = true;
      status.textContent = 'Posting…';
      UT.lb.saveName(names[0]);
      const sent = await Promise.all(who.map((w, i) => (w.score > 0 ? UT.lb.submit(r.game, names[i], w.score, w.detail) : Promise.resolve(true))));
      if (!sent.every(Boolean)) { btn.disabled = false; status.textContent = 'Could not reach the leaderboard. Check your connection and try again.'; return; }
      r.posted = true;
      UT.lb.refresh();
      status.textContent = 'Posted! Checking your rank…';
      setTimeout(async () => {
        try {
          const rk = await UT.lb.rankOf(r.game, names[0], who[0].score);
          const board = NAMES[r.game];
          status.textContent = rk ? (rk.rank <= 10 ? names[0] + ' made the ' + board + ' top 10 at #' + rk.rank + '!' : names[0] + '\'s ' + rk.score.toLocaleString() + ' is #' + rk.rank + ' of ' + rk.of + ' ' + board + ' scores.') : 'Posted! It can take a few seconds to show on the board.';
        } catch (e) { status.textContent = 'Posted! Open Leaderboard on the menu to see it.'; }
      }, 2500);
    });
  }

  function boardHtml(list) {
    if (!list.length) return '<p class="note">No scores yet. Be the first.</p>';
    return '<div class="scores">' + list.map((e, i) => '<span class="rank">#' + (i + 1) + '</span><span>' + esc(e.name) + (e.detail ? ' · ' + esc(e.detail) : '') + '</span><span class="val">' + e.score.toLocaleString() + '</span>').join('') + '</div>';
  }
  async function openLeaders() {
    UT.sfx.unlock();
    UT.sfx.tap();
    const col = (cls, title, id) => '<div class="board lb-board ' + cls + '"><h3>' + title + '</h3><div id="' + id + '"><p class="note">Loading…</p></div></div>';
    const note = UT.lb.enabled ? '<p class="note">Top 10 scores of all time. Post yours from the game-over screen.</p>' : '<p class="note">The shared board isn\'t switched on yet. Showing this phone\'s top scores.</p>';
    sheet('Leaderboard', note + '<div class="split split4">' + col('swish', 'Swish Shot', 'lb-swish') + col('pair', 'Pair Off', 'lb-pair') + col('fizz', 'Fizz 21', 'lb-fizz') + col('streak', 'Streak 21', 'lb-streak') + '</div>', [
      { label: 'Refresh', run: () => { UT.lb.refresh(); openLeaders(); } },
      { label: 'Close', primary: true, run: closeSheet },
    ]);
    const fill = (id, html) => { const el = document.getElementById(id); if (el) { el.innerHTML = html; fitSheet(); } };
    if (!UT.lb.enabled) {
      fill('lb-swish', tableHtml('swish', []) || '<p class="note">No scores yet.</p>');
      fill('lb-pair', tableHtml('pairoff', []) || '<p class="note">No scores yet.</p>');
      fill('lb-fizz', tableHtml('fizz21', []) || '<p class="note">No scores yet.</p>');
      fill('lb-streak', tableHtml('streak21', []) || '<p class="note">No scores yet.</p>');
      return;
    }
    for (const [game, id] of [['swish', 'lb-swish'], ['pairoff', 'lb-pair'], ['fizz21', 'lb-fizz'], ['streak21', 'lb-streak']]) {
      try { fill(id, boardHtml(await UT.lb.top(game, 10))); } catch (e) { fill(id, '<p class="note">Couldn\'t load the board. Check your connection and tap Refresh.</p>'); }
    }
  }
  $('#btn-leaders').addEventListener('click', openLeaders);

  refreshBest();
  refreshChamps();

  /* ---------- offline support when hosted as a site (skipped inside sandboxed embeds) ---------- */
  if (!window.UT_NO_SW && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}));
  }
})();
