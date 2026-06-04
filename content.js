(() => {
  'use strict';

  const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-survey-answer-button'
  ];

  const AD_SHOWING_SELECTORS = [
    '.html5-video-player.ad-showing',
    '.ad-interrupting'
  ];

  const isAdShowing = () =>
    AD_SHOWING_SELECTORS.some(s => document.querySelector(s));

  const clickSkip = () => {
    for (const sel of SKIP_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  };

  const safeSeekTarget = (v) => {
    let target = v.duration - 0.1;
    if (v.seekable && v.seekable.length > 0) {
      const seekEnd = v.seekable.end(v.seekable.length - 1) - 0.1;
      if (isFinite(seekEnd) && seekEnd > 0 && seekEnd < target) target = seekEnd;
    }
    return Math.max(0, target);
  };

  let lastSeekVideo = null;
  let lastSeekAt = 0;
  let lastObservedTime = -1;
  let stuckSince = 0;

  const fastForwardAd = () => {
    const v = document.querySelector('.html5-main-video');
    if (!v) return;
    if (!isAdShowing()) return;
    if (!isFinite(v.duration) || v.duration <= 0) return;
    if (v.readyState < 1) return; // wait for metadata

    try {
      v.muted = true;
      if (v.playbackRate < 8) v.playbackRate = 8;

      // Only seek once per ad to avoid feedback loop with player
      const now = Date.now();
      if (lastSeekVideo !== v || now - lastSeekAt > 1500) {
        const target = safeSeekTarget(v);
        if (target > v.currentTime + 0.5) {
          v.currentTime = target;
          lastSeekVideo = v;
          lastSeekAt = now;
        }
      }
    } catch (_) {}
  };

  const unstick = () => {
    const v = document.querySelector('.html5-main-video');
    if (!v) return;
    // Force ended state: try clicking skip, else nudge play / reload buffer
    if (clickSkip()) return;
    try {
      v.playbackRate = 1;
      // Tiny seek back, then play — often unblocks YT ad container
      const t = Math.max(0, v.duration - 0.05);
      if (isFinite(t)) v.currentTime = t;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
    // Last resort: click main player to wake it
    const player = document.getElementById('movie_player');
    if (player) {
      try { player.click(); } catch (_) {}
    }
  };

  const removeOverlays = () => {
    document.querySelectorAll(
      '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container'
    ).forEach(b => b.click && b.click());
    document.querySelectorAll(
      '.ytp-ad-overlay-slot, .ytp-ad-overlay-container, .ytp-ad-text-overlay'
    ).forEach(el => el.remove());
  };

  const tick = () => {
    if (!isAdShowing()) {
      removeOverlays();
      lastSeekVideo = null;
      lastObservedTime = -1;
      stuckSince = 0;
      const v = document.querySelector('.html5-main-video');
      if (v && v.playbackRate > 1.05) v.playbackRate = 1;
      return;
    }

    if (clickSkip()) {
      removeOverlays();
      return;
    }

    const v = document.querySelector('.html5-main-video');
    if (v) {
      const t = v.currentTime;
      const now = Date.now();
      if (Math.abs(t - lastObservedTime) < 0.05) {
        if (stuckSince === 0) stuckSince = now;
        else if (now - stuckSince > 1500) {
          unstick();
          stuckSince = 0;
        }
      } else {
        lastObservedTime = t;
        stuckSince = 0;
      }
    }

    fastForwardAd();
    removeOverlays();
  };

  setInterval(tick, 250);

  const mo = new MutationObserver(() => tick());
  const start = () => {
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
    } else {
      requestAnimationFrame(start);
    }
  };
  start();

  // Suppress "ad blocker detected" popup
  const killPopup = () => {
    document.querySelectorAll('tp-yt-paper-dialog').forEach(d => {
      if (d.querySelector('ytd-enforcement-message-view-model')) {
        d.remove();
        document.documentElement.style.overflow = '';
        document.body && (document.body.style.overflow = '');
        const v = document.querySelector('.html5-main-video');
        if (v && v.paused) v.play().catch(() => {});
      }
    });
  };
  setInterval(killPopup, 500);
})();
