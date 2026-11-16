/* UltraTouch shell: hub, pause/results sheets, fullscreen + orientation, offline install. */
(function () {
  'use strict';
  const UT = window.UT;
  const $ = (s) => document.querySelector(s);
  const hub = $('#hub');
  const overlay = $('#overlay');
  const pauseBtn = $('#btn-pause');
  const stage = (UT.stage = new UT.Stage($('#stage')));

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
  }
  /* shrink the whole menu to fit the visible height in landscape, so nothing hides under the toolbar */
  const hubInner = document.querySelector('.hub-inner');
  function fitHub() {
    if (hub.hidden) return;
    hubInner.style.transform = '';
    hubInner.style.width = '';
    hub.style.overflowY = '';
    const cs = getComputedStyle(hub);
    const availH = hub.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = hub.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (hub.clientWidth <= 640 || hubInner.offsetHeight <= availH) return;
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
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('orientationchange', () => setTimeout(fitViewport, 350));
  window.addEventListener('pageshow', fitViewport);
  fitViewport();
  const NAMES = { swish: 'Swish Shot', pairoff: 'Pair Off' };
  let current = null; /* { game, opts } */
  let swishPlayers = UT.clamp(UT.store.get('swishPlayers', 1), 1, 4);

  /* ---------- hub ---------- */
  function refreshBest() {
    ['swish', 'pairoff'].forEach((g) => {
      const b = UT.scores.best(g);
      $('#best-' + g).textContent = b ? b.toLocaleString() : '—';
    });
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

  /* ---------- fullscreen + landscape lock (Android/desktop; iOS uses Add to Home Screen) ---------- */
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
      Promise.resolve(p)
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
        .catch(() => {});
    } catch (e) { /* not allowed here; keep playing windowed */ }
  }
  fsBtn.addEventListener('click', () => {
    UT.store.set('autoFs', true);
    goFullscreen();
  });

  const rotate = $('#rotate');
  rotate.hidden = false;
  $('#btn-rotate-anyway').addEventListener('click', () => rotate.classList.add('dismissed'));

  /* ---------- game lifecycle ---------- */
  function start(game) {
    closeSheet();
    hub.hidden = true;
    pauseBtn.hidden = false;
    current = { game };
    const onEnd = (result) => setTimeout(() => results(result), 50);
    const make = () => (game === 'swish' ? new UT.Swish({ players: swishPlayers, onEnd }) : new UT.PairOff({ onEnd }));
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
    const first = box.querySelector('.primary') || box.querySelector('button');
    if (first) first.focus({ preventScroll: true });
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

  function results(r) {
    if (!current) return;
    stage.paused = true;
    pauseBtn.hidden = true;
    let body = '';
    const ranks = [];
    if (r.game === 'swish') {
      const sorted = r.players.slice().sort((a, b) => b.score - a.score);
      r.players.forEach((p) => {
        const label = r.players.length > 1 ? p.name : p.rounds === r.rounds ? 'All ' + r.rounds + ' rounds' : 'Round ' + Math.min(p.rounds + 1, r.rounds);
        const rank = UT.scores.add('swish', p.score, label);
        if (rank >= 0) ranks.push(rank);
      });
      if (r.players.length === 1) {
        const p = r.players[0];
        const pct = p.shots ? Math.round((p.made / p.shots) * 100) : 0;
        body += '<div class="big-score">' + p.score.toLocaleString() + '</div>';
        body += '<p class="note">' + p.made + ' of ' + p.shots + ' shots (' + pct + '%) · ' + (p.rounds === r.rounds ? 'cleared all ' + r.rounds + ' rounds' : 'reached round ' + Math.min(p.rounds + 1, r.rounds)) + '</p>';
      } else {
        body += '<p class="note">' + esc(sorted[0].name) + ' wins</p><div class="scores">';
        sorted.forEach((p, i) => {
          body += '<span class="rank">' + (i + 1) + '</span><span>' + esc(p.name) + ' · ' + p.made + '/' + p.shots + '</span><span class="val">' + p.score.toLocaleString() + '</span>';
        });
        body += '</div>';
      }
    } else {
      const rank = UT.scores.add('pairoff', r.score, 'Deal ' + r.level);
      if (rank >= 0) ranks.push(rank);
      body += '<div class="big-score">' + r.score.toLocaleString() + '</div>';
      body += '<p class="note">' + esc(r.reason) + ' · reached deal ' + r.level + ' · ' + r.pairs + ' pairs, ' + r.runs + ' runs</p>';
    }
    if (ranks.includes(0)) body = '<p class="center"><span class="badge">NEW BEST</span></p>' + body;
    body += '<p class="note">Top scores on this device</p>' + tableHtml(r.game, ranks);
    sheet(r.game === 'swish' ? 'Final buzzer' : 'Cards down', body, [
      { label: 'Play again', primary: true, run: () => start(r.game) },
      { label: 'Menu', run: toHub },
    ]);
  }

  refreshBest();

  /* ---------- offline support when hosted as a site (skipped inside sandboxed embeds) ---------- */
  if (!window.UT_NO_SW && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
