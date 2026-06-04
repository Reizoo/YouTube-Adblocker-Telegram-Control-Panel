(() => {
  'use strict';

  const STORAGE_KEY = 'yt_sb_patterns';
  const MAX_FP_PER_CHANNEL = 50;
  const JACCARD_THRESHOLD = 0.45;
  const NGRAM_N = 4;
  const MIN_TOKEN_LEN = 3;

  const STOPWORDS = new Set([
    // English
    'the','a','an','is','are','was','were','be','been','being','this','that','these','those',
    'and','or','but','if','then','else','for','to','of','in','on','at','by','with','from',
    'it','its','it\'s','as','so','not','no','do','does','did','have','has','had','will','would',
    'can','could','should','may','might','i','you','he','she','we','they','me','him','her','us','them',
    'my','your','his','our','their','what','when','where','who','how','why','here','there','very',
    'just','also','only','more','most','some','any','all','one','two','out','up','down','over',
    // Russian
    'и','в','на','с','со','по','для','как','что','это','не','же','а','но','или','то','от',
    'у','о','об','за','при','до','из','к','ко','бы','ли','да','уже','ещё','еще','быть',
    'есть','был','была','было','были','я','ты','он','она','оно','мы','вы','они','мой','моя',
    'мое','моё','твой','твоя','наш','ваш','их','этот','эта','это','эти','тот','та','те','очень',
    'там','тут','тогда','если','чтобы','потому','чем','так','такой','такая','такое','такие'
  ]);

  // --- tokenization ---
  const tokenize = (text) => {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
  };

  const buildNgrams = (tokens, n) => {
    const out = [];
    for (let i = 0; i + n <= tokens.length; i++) {
      out.push(tokens.slice(i, i + n).join(' '));
    }
    return out;
  };

  const jaccard = (aSet, bSet) => {
    if (!aSet.size || !bSet.size) return 0;
    let inter = 0;
    for (const x of aSet) if (bSet.has(x)) inter++;
    const uni = aSet.size + bSet.size - inter;
    return uni ? inter / uni : 0;
  };

  // --- storage ---
  const loadAllPatterns = () => new Promise(res => {
    chrome.storage.local.get([STORAGE_KEY], (d) => res(d[STORAGE_KEY] || {}));
  });

  const loadPatterns = async (channelId) => {
    const all = await loadAllPatterns();
    return all[channelId] || [];
  };

  const savePattern = async (channelId, fp) => {
    const all = await loadAllPatterns();
    const list = all[channelId] || [];
    list.push(fp);
    while (list.length > MAX_FP_PER_CHANNEL) list.shift();
    all[channelId] = list;
    return new Promise(res => chrome.storage.local.set({ [STORAGE_KEY]: all }, res));
  };

  // --- transcript fetching ---
  let _cachedPlayerResponse = null;
  let _cachedPlayerResponseTime = 0;

  const findPlayerResponse = () => {
    // Try window globals first
    try {
      if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    } catch (e) {}
    // Search inline scripts
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const t = s.textContent || '';
      const idx = t.indexOf('ytInitialPlayerResponse');
      if (idx === -1) continue;
      // Pattern: var ytInitialPlayerResponse = {...};
      const eq = t.indexOf('=', idx);
      if (eq === -1) continue;
      let i = eq + 1;
      while (i < t.length && /\s/.test(t[i])) i++;
      if (t[i] !== '{') continue;
      // Brace match
      let depth = 0, inStr = false, esc = false, strCh = '';
      const start = i;
      for (; i < t.length; i++) {
        const c = t[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
          if (c === '\\') { esc = true; continue; }
          if (c === strCh) { inStr = false; continue; }
          continue;
        }
        if (c === '"' || c === '\'') { inStr = true; strCh = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            const jsonStr = t.slice(start, i + 1);
            try { return JSON.parse(jsonStr); } catch (e) { break; }
          }
        }
      }
    }
    return null;
  };

  const getCaptionUrl = (videoId) => {
    const now = Date.now();
    let pr = _cachedPlayerResponse;
    if (!pr || (now - _cachedPlayerResponseTime > 30000)) {
      pr = findPlayerResponse();
      _cachedPlayerResponse = pr;
      _cachedPlayerResponseTime = now;
    }
    if (!pr) return null;
    try {
      const tracks = pr.captions
        && pr.captions.playerCaptionsTracklistRenderer
        && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (!tracks || !tracks.length) return null;
      // Prefer non-ASR if available, otherwise first
      const nonAsr = tracks.find(t => t.kind !== 'asr');
      return (nonAsr || tracks[0]).baseUrl;
    } catch (e) { return null; }
  };

  const _transcriptCache = new Map(); // videoId -> [{start,dur,text}]
  const _noTranscriptLogged = new Set();

  const parseTranscriptXml = (xml) => {
    const out = [];
    const re = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const attrs = m[1];
      const sm = attrs.match(/start="([\d.]+)"/);
      const dm = attrs.match(/dur="([\d.]+)"/);
      if (!sm) continue;
      const raw = m[2]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({
        start: parseFloat(sm[1]),
        dur: dm ? parseFloat(dm[1]) : 2,
        text: raw
      });
    }
    return out;
  };

  const parseTranscriptJson3 = (json) => {
    try {
      const events = json.events || [];
      const out = [];
      for (const ev of events) {
        if (!ev.segs) continue;
        const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        out.push({
          start: (ev.tStartMs || 0) / 1000,
          dur: (ev.dDurationMs || 2000) / 1000,
          text
        });
      }
      return out;
    } catch (e) { return []; }
  };

  const fetchTranscript = async (videoId) => {
    if (_transcriptCache.has(videoId)) return _transcriptCache.get(videoId);
    const baseUrl = getCaptionUrl(videoId);
    if (!baseUrl) {
      if (!_noTranscriptLogged.has(videoId)) {
        _noTranscriptLogged.add(videoId);
        console.log('[yt-sb-pattern] no transcript available for', videoId);
      }
      _transcriptCache.set(videoId, null);
      return null;
    }
    try {
      // Try JSON3 first
      const jsonUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
      let entries = null;
      try {
        const r = await fetch(jsonUrl, { credentials: 'omit' });
        if (r.ok) {
          const j = await r.json();
          entries = parseTranscriptJson3(j);
        }
      } catch (e) {}
      if (!entries || !entries.length) {
        const r = await fetch(baseUrl, { credentials: 'omit' });
        if (r.ok) {
          const xml = await r.text();
          entries = parseTranscriptXml(xml);
        }
      }
      if (!entries || !entries.length) {
        if (!_noTranscriptLogged.has(videoId)) {
          _noTranscriptLogged.add(videoId);
          console.log('[yt-sb-pattern] empty transcript for', videoId);
        }
        _transcriptCache.set(videoId, null);
        return null;
      }
      _transcriptCache.set(videoId, entries);
      return entries;
    } catch (e) {
      console.log('[yt-sb-pattern] transcript fetch failed', e);
      _transcriptCache.set(videoId, null);
      return null;
    }
  };

  // --- range extraction ---
  const transcriptInRange = (entries, start, end) => {
    if (!entries) return '';
    const parts = [];
    for (const e of entries) {
      const s = e.start, eEnd = e.start + (e.dur || 0);
      // include if overlapping with [start,end]
      if (eEnd >= start && s <= end) parts.push(e.text);
    }
    return parts.join(' ');
  };

  // --- main hooks ---
  const onSegmentSaved = async (start, end) => {
    try {
      const internal = window.__yt_sb_internal;
      if (!internal) return;
      const channelId = internal.getChannelId();
      const videoId = internal.getVideoId();
      if (!channelId || !videoId) return;
      const entries = await fetchTranscript(videoId);
      if (!entries) return;
      const text = transcriptInRange(entries, start, end);
      if (!text || text.length < 8) return;
      const tokens = tokenize(text);
      if (tokens.length < 3) return;
      const uniqTokens = Array.from(new Set(tokens));
      const ngrams = buildNgrams(tokens, NGRAM_N);
      const fp = {
        tokens: uniqTokens,
        ngrams: Array.from(new Set(ngrams)),
        duration: Math.max(1, end - start),
        sampleText: text.slice(0, 240),
        sourceVideoId: videoId,
        createdAt: Date.now()
      };
      await savePattern(channelId, fp);
      console.log('[yt-sb-pattern] saved fingerprint for channel', channelId, fp);
    } catch (e) {
      console.log('[yt-sb-pattern] onSegmentSaved error', e);
    }
  };

  const dedupSegments = (segs) => {
    segs.sort((a, b) => a.start - b.start);
    const out = [];
    for (const s of segs) {
      const last = out[out.length - 1];
      if (last && s.start <= last.end + 0.5) {
        last.end = Math.max(last.end, s.end);
      } else {
        out.push({ ...s });
      }
    }
    return out;
  };

  const scanForPattern = (entries, fp) => {
    // Build per-entry token arrays once
    const enrich = entries.map(e => ({
      start: e.start,
      end: e.start + (e.dur || 0),
      tokens: tokenize(e.text),
      text: e.text
    }));
    if (!enrich.length) return [];
    const targetDur = fp.duration;
    const minDur = targetDur * 0.7;
    const maxDur = targetDur * 1.3;
    const fpTokSet = new Set(fp.tokens);
    const fpNgramSet = new Set(fp.ngrams || []);
    const matches = [];

    // Sliding window: anchor at each entry, expand until duration falls in [minDur,maxDur*1.5]
    for (let i = 0; i < enrich.length; i++) {
      const windowTokens = [];
      let j = i;
      let lastWasMatch = false;
      while (j < enrich.length) {
        for (const t of enrich[j].tokens) windowTokens.push(t);
        const wStart = enrich[i].start;
        const wEnd = enrich[j].end;
        const wDur = wEnd - wStart;
        if (wDur > maxDur) break;
        if (wDur >= minDur) {
          const winSet = new Set(windowTokens);
          const sim = jaccard(winSet, fpTokSet);
          let ngramHit = false;
          if (fpNgramSet.size) {
            const winText = enrich.slice(i, j + 1).map(e => e.text).join(' ').toLowerCase();
            for (const ng of fpNgramSet) {
              if (ng && winText.includes(ng)) { ngramHit = true; break; }
            }
          }
          if (sim >= JACCARD_THRESHOLD || ngramHit) {
            matches.push({
              start: wStart,
              end: wEnd,
              category: 'pattern',
              _sim: sim,
              _ngramHit: ngramHit
            });
            lastWasMatch = true;
            // continue expanding to maximize but stop once we exceed maxDur
          } else if (lastWasMatch) {
            break;
          }
        }
        j++;
      }
    }
    return dedupSegments(matches);
  };

  const injectPatternSegments = async () => {
    try {
      const internal = window.__yt_sb_internal;
      if (!internal) return;
      const channelId = internal.getChannelId();
      const videoId = internal.getVideoId();
      if (!channelId || !videoId) return;
      const fps = await loadPatterns(channelId);
      if (!fps.length) return;
      const entries = await fetchTranscript(videoId);
      if (!entries) return;
      let all = [];
      for (const fp of fps) {
        if (fp.sourceVideoId === videoId) continue;
        const m = scanForPattern(entries, fp);
        all = all.concat(m);
      }
      if (!all.length) return;
      const merged = dedupSegments(all);
      internal.addSegmentsToActive(merged);
      try { internal.renderMarkersWhenReady && internal.renderMarkersWhenReady(); } catch (e) {}
      internal.showToast(`🤖 Найден похожий рекламный сегмент ${merged.length} штук`);
      console.log('[yt-sb-pattern] injected', merged.length, 'pattern segments for', videoId);
    } catch (e) {
      console.log('[yt-sb-pattern] injectPatternSegments error', e);
    }
  };

  window.__yt_sb_pattern = {
    onSegmentSaved,
    injectPatternSegments,
    // exposed for debugging
    _loadPatterns: loadPatterns,
    _savePattern: savePattern,
    _fetchTranscript: fetchTranscript,
    _tokenize: tokenize
  };
})();
