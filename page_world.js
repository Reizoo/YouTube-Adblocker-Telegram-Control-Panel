// Runs in YT page main world. Exposes player API via CustomEvent bridge.
(() => {
  'use strict';
  const player = () => document.getElementById('movie_player');
  const api = {
    toggle() {
      const p = player();
      if (!p || typeof p.getPlayerState !== 'function') return null;
      const st = p.getPlayerState();
      if (st === 1) { p.pauseVideo(); return 'paused'; }
      p.playVideo();
      return 'playing';
    },
    play() { const p = player(); if (p && p.playVideo) { p.playVideo(); return true; } return false; },
    pause() { const p = player(); if (p && p.pauseVideo) { p.pauseVideo(); return true; } return false; },
    state() { const p = player(); return p && p.getPlayerState ? p.getPlayerState() : null; },
    seekTo(sec) { const p = player(); if (p && p.seekTo) { p.seekTo(sec, true); return true; } return false; },
    data() {
      const p = player();
      if (!p) return null;
      try {
        const d = p.getVideoData && p.getVideoData();
        if (!d) return null;
        return { title: d.title, author: d.author, video_id: d.video_id };
      } catch (e) { return null; }
    }
  };
  window.addEventListener('__yt_pw_req', (e) => {
    const { id, fn, args } = e.detail || {};
    let result = null, error = null;
    try {
      if (api[fn]) result = api[fn].apply(null, args || []);
      else error = 'unknown fn ' + fn;
    } catch (err) {
      error = String(err && err.message || err);
    }
    window.dispatchEvent(new CustomEvent('__yt_pw_res', { detail: { id, result, error } }));
  });
})();
