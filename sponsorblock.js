(() => {
  'use strict';

  const API = 'https://sponsor.ajay.app/api/skipSegments';

  // Toggle categories here. true = skip, false = ignore.
  const CATEGORIES = {
    sponsor: true,        // оплаченный спонсор (NordVPN, Raid, etc.)
    selfpromo: true,      // самореклама автора (мерч, патреон)
    interaction: true,    // "подпишись, лайк"
    intro: false,         // заставка
    outro: false,         // конечные титры
    preview: false,       // ре-кап / превью
    music_offtopic: false,
    filler: false         // оффтоп шутки
  };

  const COLORS = {
    sponsor:        '#00d400',
    selfpromo:      '#ffff00',
    interaction:    '#cc00ff',
    intro:          '#00ffff',
    outro:          '#0202ed',
    preview:        '#008fd6',
    music_offtopic: '#ff9900',
    filler:         '#7300ff',
    custom:         '#ff2d2d',
    pattern:        '#ff8800'
  };

  const STORAGE_KEY = 'yt_sb_custom';
  let pendingStart = null;

  const loadCustom = async (videoId) => {
    return new Promise(res => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        const all = data[STORAGE_KEY] || {};
        res(all[videoId] || []);
      });
    });
  };

  const saveCustom = async (videoId, segs) => {
    return new Promise(res => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        const all = data[STORAGE_KEY] || {};
        all[videoId] = segs;
        chrome.storage.local.set({ [STORAGE_KEY]: all }, res);
      });
    });
  };

  const enabledCats = () =>
    Object.entries(CATEGORIES).filter(([, v]) => v).map(([k]) => k);

  let currentVideoId = null;
  let segments = [];      // [{start,end,category}]
  let lastSkipEnd = -1;
  let toast = null;

  const getVideoId = () => {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|embed)\/([^/?#]+)/);
    return m ? m[2] : null;
  };

  const fetchSegments = async (id) => {
    const cats = enabledCats();
    if (!cats.length) return [];
    const url = `${API}?videoID=${encodeURIComponent(id)}&categories=${encodeURIComponent(JSON.stringify(cats))}`;
    try {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) return [];
      const data = await r.json();
      return data.map(s => ({
        start: s.segment[0],
        end: s.segment[1],
        category: s.category
      })).sort((a, b) => a.start - b.start);
    } catch (e) {
      return [];
    }
  };

  const showToast = (msg) => {
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:rgba(0,0,0,0.85);color:#fff;padding:8px 14px;
        border-radius:6px;font:13px/1.3 Roboto,Arial,sans-serif;
        z-index:99999;pointer-events:none;transition:opacity .3s;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 2000);
  };

  const onTimeUpdate = (video) => {
    if (!segments.length) return;
    const t = video.currentTime;
    for (const seg of segments) {
      if (t >= seg.start && t < seg.end - 0.2 && seg.end !== lastSkipEnd) {
        const skipped = (seg.end - t).toFixed(1);
        video.currentTime = seg.end;
        lastSkipEnd = seg.end;
        showToast(`⏭ Пропущено ${skipped}с — ${seg.category}`);
        return;
      }
    }
  };

  let attachedVideo = null;
  const attach = (video) => {
    if (attachedVideo === video) return;
    if (attachedVideo) {
      attachedVideo.removeEventListener('timeupdate', attachedVideo._sbHandler);
    }
    const handler = () => onTimeUpdate(video);
    video._sbHandler = handler;
    video.addEventListener('timeupdate', handler);
    attachedVideo = video;
  };

  const clearMarkers = () => {
    document.querySelectorAll('.sb-marker').forEach(el => el.remove());
  };

  const renderMarkers = () => {
    const v = findVideo();
    if (!v || !isFinite(v.duration) || v.duration <= 0) return false;
    const bar = document.querySelector('.ytp-progress-list')
             || document.querySelector('.ytp-progress-bar-container');
    if (!bar) return false;

    clearMarkers();
    const dur = v.duration;
    for (const seg of segments) {
      const left = (seg.start / dur) * 100;
      const width = Math.max(0.15, ((seg.end - seg.start) / dur) * 100);
      const el = document.createElement('div');
      el.className = 'sb-marker';
      el.title = `${seg.category}: ${seg.start.toFixed(1)}s — ${seg.end.toFixed(1)}s`;
      el.style.cssText = `
        position:absolute;top:0;height:100%;
        left:${left}%;width:${width}%;
        background:${COLORS[seg.category] || '#ff0000'};
        opacity:0.75;pointer-events:none;z-index:40;
      `;
      bar.appendChild(el);
    }
    return true;
  };

  const renderMarkersWhenReady = () => {
    let tries = 0;
    const t = setInterval(() => {
      if (renderMarkers() || ++tries > 40) clearInterval(t);
    }, 250);
  };

  const loadForCurrent = async () => {
    const id = getVideoId();
    if (!id || id === currentVideoId) return;
    currentVideoId = id;
    segments = [];
    lastSkipEnd = -1;
    pendingStart = null;
    clearMarkers();
    const [api, custom] = await Promise.all([fetchSegments(id), loadCustom(id)]);
    segments = [...api, ...custom].sort((a, b) => a.start - b.start);
    try {
      if (window.__yt_sb_pattern && typeof window.__yt_sb_pattern.injectPatternSegments === 'function') {
        await window.__yt_sb_pattern.injectPatternSegments();
      }
    } catch (e) { /* ignore */ }
    if (segments.length) {
      const apiN = api.length, cN = custom.length;
      const pN = segments.filter(s => s.category === 'pattern').length;
      showToast(`SB: ${apiN} API + ${cN} свои${pN ? ` + ${pN} pattern` : ''}`);
      renderMarkersWhenReady();
    }
  };

  const fmt = (t) => {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2,'0')}`;
  };

  const addCustomSegment = async (start, end) => {
    const id = currentVideoId || getVideoId();
    if (!id) return;
    const existing = await loadCustom(id);
    const seg = { start, end, category: 'custom' };
    existing.push(seg);
    await saveCustom(id, existing);
    segments.push(seg);
    segments.sort((a, b) => a.start - b.start);
    lastSkipEnd = -1;
    renderMarkers();
    showToast(`✅ Сегмент ${fmt(start)}–${fmt(end)} сохранён`);
    try {
      if (window.__yt_sb_pattern && typeof window.__yt_sb_pattern.onSegmentSaved === 'function') {
        window.__yt_sb_pattern.onSegmentSaved(start, end);
      }
    } catch (e) { /* ignore */ }
  };

  const clearCustomForCurrent = async () => {
    const id = currentVideoId || getVideoId();
    if (!id) return;
    await saveCustom(id, []);
    segments = segments.filter(s => s.category !== 'custom');
    renderMarkers();
    showToast('Свои сегменты для этого видео удалены');
  };

  // Hotkeys: [ = mark start, ] = mark end + save, \ = clear custom for this video
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    const v = findVideo();
    if (!v) return;
    if (e.key === '[') {
      pendingStart = v.currentTime;
      showToast(`▶ Старт: ${fmt(pendingStart)}. Жми ] в конце.`);
      e.preventDefault();
    } else if (e.key === ']') {
      if (pendingStart === null) {
        showToast('Сначала жми [ на старте сегмента');
      } else {
        const end = v.currentTime;
        if (end <= pendingStart) {
          showToast('Конец должен быть позже старта');
        } else {
          addCustomSegment(pendingStart, end);
          pendingStart = null;
        }
      }
      e.preventDefault();
    } else if (e.key === '\\') {
      clearCustomForCurrent();
      e.preventDefault();
    }
  }, true);

  // Re-render on resize / fullscreen toggle
  window.addEventListener('resize', () => segments.length && renderMarkers());
  document.addEventListener('fullscreenchange', () => segments.length && renderMarkersWhenReady());

  const findVideo = () => document.querySelector('video.html5-main-video, video');

  const getChannelId = () => {
    try {
      const m = document.querySelector('meta[itemprop="channelId"]');
      if (m && m.content) return m.content;
    } catch (e) {}
    try {
      const a = document.querySelector('ytd-channel-name a[href*="/channel/"], ytd-video-owner-renderer a[href*="/channel/"], #owner a[href*="/channel/"]');
      if (a) {
        const mm = a.getAttribute('href').match(/\/channel\/([A-Za-z0-9_-]+)/);
        if (mm) return mm[1];
      }
    } catch (e) {}
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.indexOf('ytInitialData') !== -1) {
          const m = t.match(/"channelId":"(UC[A-Za-z0-9_-]{20,})"/);
          if (m) return m[1];
        }
      }
    } catch (e) {}
    return null;
  };

  // Public API
  window.__yt_sb = {
    markStart: () => {
      const v = findVideo();
      if (!v) return false;
      pendingStart = v.currentTime;
      showToast(`▶ Старт: ${fmt(pendingStart)}. Жми ] в конце.`);
      return true;
    },
    markEnd: () => {
      const v = findVideo();
      if (!v) return false;
      if (pendingStart === null) {
        showToast('Сначала жми [ на старте сегмента');
        return false;
      }
      const end = v.currentTime;
      if (end <= pendingStart) {
        showToast('Конец должен быть позже старта');
        return false;
      }
      addCustomSegment(pendingStart, end);
      pendingStart = null;
      return true;
    },
    clearCustom: () => clearCustomForCurrent(),
    skipNext: () => {
      const v = findVideo();
      if (!v || !segments.length) return false;
      const t = v.currentTime;
      const upcoming = segments.find(s => s.end > t + 0.2);
      if (!upcoming) return false;
      v.currentTime = upcoming.end;
      lastSkipEnd = upcoming.end;
      showToast(`⏭ Скип до ${fmt(upcoming.end)} — ${upcoming.category}`);
      return true;
    },
    getStatus: () => {
      const v = findVideo();
      const titleEl = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata, h1.title yt-formatted-string, h1.title'
      );
      const title = (titleEl && titleEl.textContent.trim()) ||
                    document.title.replace(/ - YouTube$/, '').trim();
      const authorEl = document.querySelector(
        'ytd-channel-name#channel-name a, ytd-video-owner-renderer ytd-channel-name a, #owner ytd-channel-name a, #channel-name a'
      );
      const author = authorEl ? authorEl.textContent.trim() : null;
      return {
        videoId: currentVideoId || getVideoId(),
        channelId: getChannelId(),
        title,
        author,
        currentTime: v ? v.currentTime : 0,
        duration: v ? v.duration : 0,
        paused: v ? v.paused : true,
        segmentsCount: segments.length
      };
    }
  };

  // Expose helpers for pattern module
  window.__yt_sb_internal = {
    getChannelId,
    getVideoId,
    findVideo,
    showToast,
    addSegmentsToActive: (segs) => {
      if (!Array.isArray(segs) || !segs.length) return;
      // dedup overlapping with existing
      const merged = [...segments];
      for (const s of segs) {
        const overlap = merged.some(m =>
          !(s.end <= m.start || s.start >= m.end) && m.category !== 'pattern'
        );
        if (!overlap) merged.push(s);
      }
      segments = merged.sort((a, b) => a.start - b.start);
      lastSkipEnd = -1;
    },
    renderMarkersWhenReady,
    getCurrentVideoId: () => currentVideoId
  };

  setInterval(() => {
    const v = findVideo();
    if (v) attach(v);
    loadForCurrent();
  }, 1000);

  // YT SPA navigation
  window.addEventListener('yt-navigate-finish', loadForCurrent);
  window.addEventListener('popstate', loadForCurrent);
})();
