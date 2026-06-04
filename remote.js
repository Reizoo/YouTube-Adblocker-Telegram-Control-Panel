// remote.js — WebSocket client bridging the local bot to YouTube playback.
// Runs in the same isolated content-script world as sponsorblock.js, so
// `window.__yt_sb` (defined there) is reachable directly.
(() => {
  const WS_URL = 'ws://127.0.0.1:8765';
  const RECONNECT_MS = 3000;
  let ws = null;
  let reconnectTimer = null;
  let helloSent = false;

  function getVideo() {
    return document.querySelector('video');
  }

  function isYouTube() {
    return /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
  }

  function hasVideo() {
    const v = getVideo();
    return !!(v && !isNaN(v.duration) && v.duration > 0);
  }

  function sendHello() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({
        type: 'hello',
        isYouTube: isYouTube(),
        hasVideo: hasVideo(),
        url: location.href,
      }));
      helloSent = true;
    } catch (_) {}
  }

  function pwCall(fn, ...args) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (!e.detail || e.detail.id !== id) return;
        window.removeEventListener('__yt_pw_res', handler);
        resolve(e.detail);
      };
      window.addEventListener('__yt_pw_res', handler);
      window.dispatchEvent(new CustomEvent('__yt_pw_req', { detail: { id, fn, args } }));
      setTimeout(() => {
        window.removeEventListener('__yt_pw_res', handler);
        resolve({ result: null, error: 'timeout' });
      }, 1500);
    });
  }

  async function waitForApi(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.__yt_sb && typeof window.__yt_sb.getStatus === 'function') {
        return true;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  async function handleCommand(msg) {
    const { id, cmd, arg } = msg;
    const reply = (payload) => {
      try { ws.send(JSON.stringify({ id, ...payload })); } catch (_) {}
    };

    try {
      const video = getVideo();
      const apiReady = await waitForApi(1500);

      switch (cmd) {
        case 'play': {
          const r = await pwCall('play');
          if (r.result) return reply({ ok: true, result: { paused: false } });
          if (!video) throw new Error('no video element');
          try { await video.play(); } catch (_) {}
          return reply({ ok: true, result: { paused: video.paused } });
        }
        case 'pause': {
          const r = await pwCall('pause');
          if (r.result) return reply({ ok: true, result: { paused: true } });
          if (!video) throw new Error('no video element');
          video.pause();
          return reply({ ok: true, result: { paused: video.paused } });
        }
        case 'toggle': {
          const r = await pwCall('toggle');
          if (r.result) {
            return reply({ ok: true, result: { paused: r.result === 'paused' } });
          }
          if (!video) throw new Error('no video element');
          if (video.paused) { try { await video.play(); } catch (_) {} } else { video.pause(); }
          return reply({ ok: true, result: { paused: video.paused } });
        }
        case 'seek': {
          if (!video) throw new Error('no video element');
          const n = Number(arg) || 0;
          video.currentTime = Math.min((video.duration || Infinity), video.currentTime + n);
          return reply({ ok: true, result: { currentTime: video.currentTime } });
        }
        case 'back': {
          if (!video) throw new Error('no video element');
          const n = Number(arg) || 0;
          video.currentTime = Math.max(0, video.currentTime - n);
          return reply({ ok: true, result: { currentTime: video.currentTime } });
        }
        case 'jumpAbs': {
          if (!video) throw new Error('no video element');
          const n = Math.max(0, Number(arg) || 0);
          video.currentTime = n;
          return reply({ ok: true, result: { currentTime: video.currentTime } });
        }
        case 'markStart': {
          if (!apiReady) throw new Error('__yt_sb not ready');
          const r = window.__yt_sb.markStart();
          return reply({ ok: true, result: r ?? null });
        }
        case 'markEnd': {
          if (!apiReady) throw new Error('__yt_sb not ready');
          const r = window.__yt_sb.markEnd();
          return reply({ ok: true, result: r ?? null });
        }
        case 'skip': {
          if (!apiReady) throw new Error('__yt_sb not ready');
          const r = window.__yt_sb.skipNext();
          return reply({ ok: true, result: r ?? null });
        }
        case 'clear': {
          if (!apiReady) throw new Error('__yt_sb not ready');
          const r = window.__yt_sb.clearCustom();
          return reply({ ok: true, result: r ?? null });
        }
        case 'status': {
          let status = null;
          if (apiReady) {
            try { status = window.__yt_sb.getStatus(); } catch (_) {}
          }
          if (!status && video) {
            status = {
              videoId: new URL(location.href).searchParams.get('v') || null,
              channelId: null,
              title: document.title.replace(/ - YouTube$/, ''),
              currentTime: video.currentTime,
              duration: video.duration,
              paused: video.paused,
              segmentsCount: 0,
            };
          }
          if (!status) throw new Error('no video');

          // Enrich title/author from YT player main-world API.
          try {
            const r = await pwCall('data');
            if (r.result) {
              if (r.result.title) status.title = r.result.title;
              if (r.result.author) status.author = r.result.author;
            }
          } catch (_) {}
          // Also use real paused state from player when available.
          try {
            const st = await pwCall('state');
            if (st.result !== null && st.result !== undefined) {
              status.paused = st.result !== 1;
            }
          } catch (_) {}

          sendHello();
          return reply({ ok: true, result: status });
        }
        default:
          return reply({ ok: false, error: 'unknown cmd: ' + cmd });
      }
    } catch (e) {
      reply({ ok: false, error: String(e && e.message || e) });
    }
  }

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      console.debug('[yt-adblock] WS connected');
      helloSent = false;
      sendHello();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && msg.cmd && msg.id) handleCommand(msg);
    });

    ws.addEventListener('close', () => {
      ws = null;
      scheduleReconnect();
    });

    // Swallow WS error silently — bot may simply be offline; will retry.
    ws.addEventListener('error', () => {
      try { ws && ws.close(); } catch (_) {}
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sendHello();
  });

  // Re-send hello when a new video element loads metadata.
  const observer = new MutationObserver(() => {
    const v = getVideo();
    if (v && !v.__yt_sb_remote_bound) {
      v.__yt_sb_remote_bound = true;
      v.addEventListener('loadedmetadata', sendHello);
      v.addEventListener('play', sendHello);
    }
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  connect();
})();
