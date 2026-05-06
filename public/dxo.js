/* dXO — Demo XO overlay v0
 *
 * Vanilla JS, zero dependencies. Inject into any page and it runs the
 * configured demo script: highlights elements, narrates with browser TTS,
 * exposes Pause / Resume / Skip / Restart controls, and an "Ask a question"
 * input (v0 logs to console; v1 routes via Claude Haiku).
 *
 * Three ways to load:
 *   1. Paste this whole file into a browser DevTools console while on the
 *      target site (no auth changes, no deploy needed). Fastest test loop.
 *   2. Inject as a <script src="..."> tag in the target site's index.html.
 *   3. Bundle in a Chrome extension content script (fallback when (2) is
 *      blocked by the client).
 *
 * Script source:
 *   window.DXO_SCRIPT_URL  -- set to a URL that returns JSON, OR
 *   window.DXO_SCRIPT      -- inline JSON object before this file loads.
 *   If neither is set, falls back to the bundled MFP relationship-led
 *   demo script (defined at the bottom of this file).
 *
 * Persistence:
 *   localStorage key 'dxo.state' carries { stepIndex, paused, prospectId }
 *   so a page reload mid-demo resumes from the same beat.
 *
 * Auth gate:
 *   Bootstrap polls for the [data-dxo="dashboard-header"] anchor before
 *   rendering the panel. That anchor is only on the post-auth dashboard,
 *   so the panel does not appear on welcome / sign-in screens.
 */

(function () {
  'use strict';

  if (window.__DXO_LOADED__) {
    console.warn('[dXO] already loaded; reload the page to reset.');
    return;
  }
  window.__DXO_LOADED__ = true;

  const VERSION = '0.1';
  const STATE_KEY = 'dxo.state';
  // API Gateway base URL. Same constant the React app's build uses; required
  // because /api/* is NOT routed through CloudFront -- a relative fetch returns
  // the SPA HTML fallback. Override at runtime by setting window.DXO_API_BASE
  // before this script loads (useful when pointing dXO at a different env).
  const API_BASE = (typeof window !== 'undefined' && window.DXO_API_BASE)
    || 'https://odvopohlp3.execute-api.eu-west-2.amazonaws.com/prod';

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const state = loadState();

  function loadState() {
    let prospectId;
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) prospectId = JSON.parse(raw).prospectId;
    } catch (_) {}
    // Fresh-load default is paused. The first step's narration would otherwise
    // call audio.play() with no user gesture in the load chain (Run dXO is on
    // the previous page) and the browser autoplay policy blocks it. The
    // pause button doubles as a Start button until the operator clicks once.
    return {
      stepIndex: 0,
      paused: true,
      _neverPlayed: true,
      prospectId: prospectId || anonId(),
    };
  }

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function anonId() {
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }

  // -------------------------------------------------------------------------
  // Telemetry stub (v1 will POST to a real endpoint)
  // -------------------------------------------------------------------------
  function track(event, payload) {
    const row = {
      ts: new Date().toISOString(),
      prospect: state.prospectId,
      event,
      ...payload,
    };
    console.log('[dXO telemetry]', row);
    // v1: fetch(window.DXO_TELEMETRY_URL, { method: 'POST', body: JSON.stringify(row), keepalive: true });
  }

  // -------------------------------------------------------------------------
  // Styles (scoped under #dxo-root)
  // -------------------------------------------------------------------------
  const css = `
    #dxo-root, #dxo-root * { box-sizing: border-box; }
    #dxo-callout {
      position: absolute; pointer-events: none; z-index: 2147483646;
      border: 3px solid #ff6b35; border-radius: 8px;
      box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.35), 0 6px 16px rgba(0,0,0,0.25);
      transition: top 0.35s ease, left 0.35s ease, width 0.35s ease, height 0.35s ease;
    }
    #dxo-panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: 380px; max-width: calc(100vw - 32px);
      background: #0b1f3a; color: #f3f4f6;
      border-radius: 12px; box-shadow: 0 12px 36px rgba(0,0,0,0.45);
      font: 13px/1.45 -apple-system, system-ui, sans-serif;
      padding: 14px 16px 12px 16px;
      border: 1px solid rgba(255,255,255,0.08);
      user-select: none;
    }
    #dxo-panel.is-dragging { transition: none; cursor: grabbing; }
    #dxo-panel-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
      cursor: grab;
    }
    #dxo-panel-head:active { cursor: grabbing; }
    #dxo-panel input, #dxo-panel button { user-select: auto; }
    #dxo-title {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
      color: #00a9a5; font-weight: 700;
    }
    #dxo-progress { font-size: 10px; color: #6b7280; }
    #dxo-segment-name {
      font-size: 14px; font-weight: 600; margin-bottom: 4px; color: #fff;
    }
    #dxo-narration {
      font-size: 13px; color: #cbd5e1; margin-bottom: 10px;
      max-height: 120px; overflow-y: auto;
    }
    #dxo-controls { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
    .dxo-btn {
      background: rgba(0,169,165,0.15); color: #00a9a5; border: 1px solid #00a9a5;
      border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer;
      font-family: inherit; font-weight: 600;
    }
    .dxo-btn:hover { background: rgba(0,169,165,0.28); }
    .dxo-btn-primary { background: #00a9a5; color: #0b1f3a; }
    .dxo-btn-primary:hover { background: #1bc8c4; }
    #dxo-question {
      width: 100%; padding: 6px 8px; border-radius: 6px;
      background: rgba(255,255,255,0.06); color: #fff;
      border: 1px solid rgba(255,255,255,0.12);
      font-family: inherit; font-size: 12px;
    }
    #dxo-question::placeholder { color: #6b7280; }
    #dxo-answer {
      margin-top: 8px; padding: 8px 26px 8px 8px; border-radius: 6px;
      background: rgba(0,169,165,0.08); border-left: 3px solid #00a9a5;
      font-size: 12px; color: #cbd5e1; display: none;
      position: relative;
    }
    #dxo-answer-text { display: block; }
    #dxo-answer-close {
      position: absolute; top: 4px; right: 4px;
      width: 18px; height: 18px; line-height: 16px; text-align: center;
      background: transparent; color: #6b7280; border: 1px solid transparent;
      border-radius: 50%; cursor: pointer; font-size: 13px;
      font-family: inherit; padding: 0;
    }
    #dxo-answer-close:hover { color: #f3f4f6; border-color: rgba(255,255,255,0.18); }
    #dxo-time {
      font-size: 10px; color: #6b7280; text-align: right; margin-top: 4px;
    }
  `;

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------
  function buildUI() {
    const style = document.createElement('style');
    style.id = 'dxo-style';
    style.textContent = css;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'dxo-root';
    document.body.appendChild(root);

    const callout = document.createElement('div');
    callout.id = 'dxo-callout';
    callout.style.display = 'none';
    document.body.appendChild(callout);

    const panel = document.createElement('div');
    panel.id = 'dxo-panel';
    panel.innerHTML = `
      <div id="dxo-panel-head">
        <span id="dxo-title">dXO · Demo XO v${VERSION}</span>
        <span id="dxo-progress">step –/–</span>
      </div>
      <div id="dxo-segment-name">Loading…</div>
      <div id="dxo-narration"></div>
      <div id="dxo-controls">
        <button class="dxo-btn dxo-btn-primary" id="dxo-next">Next ▸</button>
        <button class="dxo-btn" id="dxo-pause">Pause</button>
        <button class="dxo-btn" id="dxo-prev">◂ Back</button>
        <button class="dxo-btn" id="dxo-restart">Restart</button>
      </div>
      <input id="dxo-question" placeholder="Ask anything about what you're seeing…" />
      <div id="dxo-answer">
        <button id="dxo-answer-close" type="button" aria-label="Clear answer" title="Clear answer">×</button>
        <span id="dxo-answer-text"></span>
      </div>
      <div id="dxo-time"></div>
    `;
    root.appendChild(panel);

    document.getElementById('dxo-next').addEventListener('click', next);
    document.getElementById('dxo-prev').addEventListener('click', prev);
    document.getElementById('dxo-pause').addEventListener('click', togglePause);
    document.getElementById('dxo-restart').addEventListener('click', restart);
    document.getElementById('dxo-question').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        handleQuestion(e.target.value.trim());
        e.target.value = '';
      }
    });
    document.getElementById('dxo-answer-close').addEventListener('click', clearAnswer);

    enableDrag();
    restorePanelPosition();
  }

  // Drag-to-reposition. Header bar is the grab handle. Position persists
  // in localStorage so the panel stays where the operator put it across
  // page navigations and reloads. Default position is bottom-right; once
  // the user drags, we switch to top/left absolute coords.
  function enableDrag() {
    const panel = document.getElementById('dxo-panel');
    const head = document.getElementById('dxo-panel-head');
    let drag = null;

    head.addEventListener('pointerdown', (e) => {
      // Don't initiate drag from a button click inside the head
      if (e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      };
      panel.classList.add('is-dragging');
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const left = Math.max(8, Math.min(window.innerWidth - drag.width - 8, e.clientX - drag.offsetX));
      const top = Math.max(8, Math.min(window.innerHeight - drag.height - 8, e.clientY - drag.offsetY));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    const stopDrag = (e) => {
      if (!drag) return;
      drag = null;
      panel.classList.remove('is-dragging');
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      // Persist
      try {
        localStorage.setItem('dxo.panelPos', JSON.stringify({
          left: panel.style.left,
          top: panel.style.top,
        }));
      } catch (_) {}
    };
    head.addEventListener('pointerup', stopDrag);
    head.addEventListener('pointercancel', stopDrag);

    // Reposition into viewport on window resize so the panel doesn't end up
    // off-screen if the operator shrinks the window after dragging.
    window.addEventListener('resize', () => {
      if (panel.style.left && panel.style.top) {
        const rect = panel.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, parseFloat(panel.style.left)));
        const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, parseFloat(panel.style.top)));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
      }
    });
  }

  function restorePanelPosition() {
    try {
      const raw = localStorage.getItem('dxo.panelPos');
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (pos && pos.left && pos.top) {
        const panel = document.getElementById('dxo-panel');
        panel.style.left = pos.left;
        panel.style.top = pos.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }
    } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // Element targeting
  // -------------------------------------------------------------------------
  function findTarget(selector) {
    if (!selector) return null;
    // Try CSS selector first.
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch (_) {}
    // Fall back to text-content match: prefix `text:`
    if (typeof selector === 'string' && selector.startsWith('text:')) {
      const needle = selector.slice(5).toLowerCase();
      const all = document.querySelectorAll('a, button, h1, h2, h3, h4, h5, h6, span, div, td, th, li, summary, p, label');
      let best = null;
      let bestArea = Infinity;
      for (const el of all) {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (!txt.includes(needle)) continue;
        const rect = el.getBoundingClientRect();
        // Skip invisible / zero-size / off-screen elements
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight + 2000) continue;
        // Prefer the smallest matching element (likely the actual label/link
        // rather than its parent container). Tie-break: closer to the text length.
        const area = rect.width * rect.height;
        if (area < bestArea) { best = el; bestArea = area; }
      }
      return best;
    }
    return null;
  }

  // Poll the DOM for a target to appear. After a route change, the
  // SPA re-renders asynchronously (data fetch + paint). Try every
  // 150ms up to `timeoutMs`, then give up and call cb with null so
  // the step at least narrates and doesn't get stuck.
  function pollForTarget(selector, timeoutMs, cb) {
    const start = Date.now();
    const tryOnce = () => {
      const t = findTarget(selector);
      if (t || Date.now() - start > timeoutMs) {
        cb(t);
        return;
      }
      setTimeout(tryOnce, 150);
    };
    // Small initial delay so the render kicks off first
    setTimeout(tryOnce, 100);
  }

  // Walk up the DOM looking for an actually-clickable ancestor. React 17+
  // uses event delegation so DOM elements don't have an `onclick` property
  // even when the JSX has onClick. Heuristics:
  //   - <a>, <button>, [role=button|link] are always clickable
  //   - <tr> in MFP queue tables is clickable by convention
  //   - any element whose computed style has cursor:pointer is intended
  //     to be clicked
  // First match up the tree wins.
  function findClickableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const tag = (cur.tagName || '').toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'tr') return cur;
      const role = cur.getAttribute && cur.getAttribute('role');
      if (role === 'button' || role === 'link') return cur;
      try {
        const cs = window.getComputedStyle(cur);
        if (cs && cs.cursor === 'pointer') return cur;
      } catch (_) {}
      if (cur.onclick) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function highlight(el, opts) {
    const callout = document.getElementById('dxo-callout');
    if (!el) {
      callout.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    callout.style.display = 'block';
    callout.style.top = (rect.top + window.scrollY - 6) + 'px';
    callout.style.left = (rect.left + window.scrollX - 6) + 'px';
    callout.style.width = (rect.width + 12) + 'px';
    callout.style.height = (rect.height + 12) + 'px';
    // Only auto-scroll when the caller asks for it. After a navigate or
    // find_case the page should be read top-down, so we deliberately do
    // NOT yank the viewport to the OODA card -- the operator sees the
    // case header, badges, event context, then scrolls naturally.
    if (opts && opts.scroll) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // -------------------------------------------------------------------------
  // Narration -- AWS Polly via /api/dxo/synthesize, with browser TTS fallback
  //
  // Two independent audio slots so a Q&A answer doesn't interrupt step
  // narration (and vice versa). speak() drives the 'narration' slot; the
  // question router drives the 'answer' slot via speakAnswer(). Each slot
  // tracks its own currentAudio<Slot>; stopping one is local to that slot.
  // -------------------------------------------------------------------------
  let currentAudioNarration = null;
  let currentAudioAnswer = null;
  let currentUtterance = null;
  const POLLY_VOICE = 'Brian'; // British male, neural, eu-west-2
  // In-memory cache keyed by text. Same narration line in two places (or on
  // restart) re-uses the same MP3 blob URL. No re-synthesis cost.
  const _audioCache = new Map();

  function _stopSlot(slot) {
    if (slot === 'narration' && currentAudioNarration) {
      try { currentAudioNarration.pause(); } catch (_) {}
      currentAudioNarration = null;
    }
    if (slot === 'answer' && currentAudioAnswer) {
      try { currentAudioAnswer.pause(); } catch (_) {}
      currentAudioAnswer = null;
    }
  }

  function _synthAndPlay(text, slot, signal) {
    const cached = _audioCache.get(text);
    if (cached) { playAudio(cached, text, slot); return; }

    // xo-capture stores its session JWT under 'xo-token'; the original
    // MFP build used 'mfp.jwt'. Try both so the same engine works in
    // either app without forking.
    const token = localStorage.getItem('xo-token') || localStorage.getItem('mfp.jwt');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // Compose a hard timeout with the upstream signal so a hung
    // /api/dxo/synthesize response can't strand the playback. If the
    // caller passed an AbortSignal (answer slot does), aborting it
    // also aborts our fetch.
    const timeoutCtrl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtrl.abort(), 4000);
    if (signal) {
      if (signal.aborted) timeoutCtrl.abort();
      else signal.addEventListener('abort', () => timeoutCtrl.abort(), { once: true });
    }

    fetch(API_BASE + '/api/dxo/synthesize', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, voice: POLLY_VOICE }),
      signal: timeoutCtrl.signal,
    })
      .then(r => { clearTimeout(timeoutId); return r.ok ? r.blob() : null; })
      .then(blob => {
        if (!blob || !blob.size) {
          if (slot === 'narration') fallbackToBrowserTts(text);
          return;
        }
        const url = URL.createObjectURL(blob);
        _audioCache.set(text, url);
        playAudio(url, text, slot);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err && err.name === 'AbortError') {
          // User-cancelled or timed out -- fall back so the operator
          // still hears narration on long Polly calls.
          if (slot === 'narration') fallbackToBrowserTts(text);
          return;
        }
        console.warn('[dXO] polly synth failed', err);
        if (slot === 'narration') fallbackToBrowserTts(text);
      });
  }

  function speak(text) {
    if (!text) return;
    _stopSlot('narration');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    currentUtterance = null;
    _synthAndPlay(text, 'narration', undefined);
  }

  function speakAnswer(text, signal) {
    if (!text) return;
    _stopSlot('answer');
    _synthAndPlay(text, 'answer', signal);
  }

  function playAudio(url, label, slot) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    if (slot === 'answer') currentAudioAnswer = audio;
    else currentAudioNarration = audio;
    audio.play().catch((err) => {
      // Autoplay policy can block the first .play() if the user has not
      // interacted yet. Step 1 is gated behind the Start tour button so
      // the narration slot rarely hits this; the answer slot is always
      // post-gesture. Fall back to browser TTS for the narration slot
      // only -- answer slot stays silent rather than swap to a different
      // voice mid-Q&A.
      console.warn('[dXO] audio.play blocked', err);
      if (slot === 'narration') fallbackToBrowserTts(label);
    });
  }

  function fallbackToBrowserTts(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.lang = 'en-GB';
    u.voice = pickVoice();
    currentUtterance = u;
    window.speechSynthesis.speak(u);
  }

  function pickVoice() {
    const voices = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || [];
    if (!voices.length) return null;
    // Prefer local voices to avoid silent failures from remote synthesis
    // that can occur when the network or remote voice service is flaky.
    const score = (v) => {
      let s = 0;
      const lang = (v.lang || '').toLowerCase();
      const name = (v.name || '').toLowerCase();
      if (lang === 'en-gb') s += 100;
      else if (lang.startsWith('en')) s += 30;
      if (/oliver|kate|serena|daniel/.test(name)) s += 50;
      else if (/karen|moira|tessa|samantha|alex/.test(name)) s += 40;
      if (v.localService) s += 60;
      if (/google.*english|microsoft.*online/.test(name)) s -= 30;
      return s;
    };
    return voices.slice().sort((a, b) => score(b) - score(a))[0];
  }

  function shutUp() {
    _stopSlot('narration');
    _stopSlot('answer');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    currentUtterance = null;
  }

  // -------------------------------------------------------------------------
  // Step engine
  // -------------------------------------------------------------------------
  let script = null;

  // Look up a real event_id via the API matching the step's filter, then
  // navigate to /exceptions/<id>. This replaces the brittle "click a row by
  // text" pattern with a deterministic call: every demo run lands on a real
  // case that matches scope/type/preferred-client filters. Falls back gracefully
  // (no navigation, no error) if the API returns nothing.
  function findCaseAndNavigate(step, done) {
    const params = new URLSearchParams();
    if (step.find_case.scope_question) params.set('scope_question', step.find_case.scope_question);
    if (step.find_case.exception_type) params.set('exception_type', step.find_case.exception_type);
    if (step.find_case.status) params.set('status', step.find_case.status);
    if (step.find_case.resolution_path) params.set('resolution_path', step.find_case.resolution_path);
    if (step.find_case.q) params.set('q', step.find_case.q);
    params.set('limit', '5');
    const token = localStorage.getItem('mfp.jwt');
    const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
    fetch(API_BASE + '/api/exceptions?' + params.toString(), { headers })
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(data => {
        const row = (data.rows || [])[0];
        if (!row) {
          console.warn('[dXO] find_case found no match', step.find_case);
          done(null);
          return;
        }
        track('find_case_hit', { event_id: row.id, filters: step.find_case });
        const path = '/exceptions/' + row.id;
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
        done(row);
      })
      .catch(err => {
        console.warn('[dXO] find_case error', err);
        done(null);
      });
  }

  function updatePauseButtonLabel() {
    const btn = document.getElementById('dxo-pause');
    if (!btn) return;
    if (state._neverPlayed && state.paused) {
      btn.textContent = '▶ Start tour';
      btn.classList.add('dxo-btn-primary');
    } else if (state.paused) {
      btn.textContent = 'Resume';
      btn.classList.remove('dxo-btn-primary');
    } else {
      btn.textContent = 'Pause';
      btn.classList.remove('dxo-btn-primary');
    }
  }

  function renderStep() {
    if (!script) return;
    const step = script.steps[state.stepIndex];
    if (!step) return;

    // Tear down any prior narration audio so pause -> Next -> Resume plays
    // the NEW step from start, not the leftover paused element from the
    // previous step. When paused, no fresh speak() fires -- but the next
    // togglePause-resume falls through to speak() since the slot is null.
    if (currentAudioNarration) {
      try { currentAudioNarration.pause(); } catch (_) {}
      currentAudioNarration = null;
    }

    document.getElementById('dxo-segment-name').textContent = step.title || '(untitled step)';
    document.getElementById('dxo-narration').textContent = step.narration || '';
    document.getElementById('dxo-progress').textContent =
      `step ${state.stepIndex + 1}/${script.steps.length}`;
    document.getElementById('dxo-time').textContent =
      step.duration_seconds ? `~${step.duration_seconds}s` : '';
    updatePauseButtonLabel();
    clearAnswer();

    // Three ways a step can change route: find_case (API lookup -> navigate by
    // real ID), navigate (explicit pathname), or click (highlight -> simulate).
    // Run in priority order; find_case is the most deterministic.
    const routedThisStep = !!(step.find_case || step.navigate);
    const continueAfterRoute = () => {
      // After a route change, force the page back to the top so the user
      // reads the case from its header down. Without this, the highlight's
      // scrollIntoView lands in the middle of the page.
      if (routedThisStep) window.scrollTo({ top: 0, behavior: 'auto' });
      pollForTarget(step.target, 4000, (target) => {
        // Skip the auto-scroll-to-target on routed steps; let the operator
        // read top-down. On non-routed steps, scroll the highlight into
        // view since the page hasn't moved.
        highlight(target, { scroll: !routedThisStep });
        if (target && step.click && !state.paused) {
          setTimeout(() => {
            const clickable = findClickableAncestor(target) || target;
            const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
            try { clickable.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
            try { clickable.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
            try { clickable.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
            clickable.dispatchEvent(new MouseEvent('click', opts));
            console.log('[dXO] clicked', clickable.tagName, (clickable.textContent || '').slice(0, 40));
          }, step.click_delay_ms || 1200);
        }
      });
    };

    if (step.find_case && !state.paused) {
      findCaseAndNavigate(step, () => {
        // Give React Router + ExceptionDetail's API fetch a beat to settle
        setTimeout(continueAfterRoute, 400);
      });
    } else if (step.navigate && !state.paused) {
      try {
        const url = new URL(step.navigate, window.location.origin);
        if (url.origin === window.location.origin) {
          window.history.pushState({}, '', url.pathname + url.search);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } else {
          window.location.href = step.navigate;
          return;
        }
      } catch (_) {}
      setTimeout(continueAfterRoute, 250);
    } else {
      continueAfterRoute();
    }

    if (!state.paused) {
      speak(step.narration || '');
    }

    track('step_render', { step_index: state.stepIndex, step_id: step.id });
  }

  function next() {
    if (!script) return;
    if (state.stepIndex < script.steps.length - 1) {
      state.stepIndex += 1;
      saveState();
      renderStep();
    } else {
      track('script_complete', {});
      document.getElementById('dxo-segment-name').textContent = 'Demo complete.';
      document.getElementById('dxo-narration').textContent =
        script.closing_message || 'Thanks for watching. Pick a use case you want prototyped.';
      shutUp();
      highlight(null);
    }
  }

  function prev() {
    if (state.stepIndex > 0) {
      state.stepIndex -= 1;
      saveState();
      renderStep();
    }
  }

  function togglePause() {
    if (state._neverPlayed) state._neverPlayed = false;
    state.paused = !state.paused;
    saveState();
    if (state.paused) {
      // Preserve the narration element AND its currentTime so resume can
      // pick up from the same word. Don't null it -- the next togglePause
      // checks for it. Cancel browser-TTS too in case the fallback was
      // active. Answer slot stays untouched per the dual-slot rule.
      if (currentAudioNarration) {
        try { currentAudioNarration.pause(); } catch (_) {}
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      currentUtterance = null;
    } else {
      const step = script.steps[state.stepIndex];
      const a = currentAudioNarration;
      if (a && Number.isFinite(a.duration) && a.currentTime < a.duration) {
        a.play().catch((err) => {
          console.warn('[dXO] resume play() failed; re-speaking from start', err);
          speak(step.narration || '');
        });
      } else {
        // No element, finished, or duration unknown -- fresh playback. Also
        // covers the very first Start tour click since _neverPlayed implies
        // no narration element exists yet.
        speak(step.narration || '');
      }
    }
    updatePauseButtonLabel();
    track('pause_toggle', { paused: state.paused });
  }

  function restart() {
    state.stepIndex = 0;
    state.paused = false;
    state._neverPlayed = false;
    saveState();
    track('restart', {});
    renderStep();
  }

  // -------------------------------------------------------------------------
  // Question input -- v1 router: POST /api/dxo/answer (Haiku 4.5), render
  // text immediately, then speakAnswer() through the answer audio slot
  // (independent of step narration). Text never gated on audio readiness.
  //
  // currentAnswerAbort is a single in-flight controller covering both the
  // /answer fetch and the downstream /synthesize fetch. Aborting it cancels
  // both cleanly. clearAnswer() and a new question both call .abort().
  // -------------------------------------------------------------------------
  const EXCEPTION_PATH_RE = /\/exceptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  let currentAnswerAbort = null;

  function clearAnswer() {
    if (currentAnswerAbort) {
      try { currentAnswerAbort.abort(); } catch (_) {}
      currentAnswerAbort = null;
    }
    _stopSlot('answer');
    const wrap = document.getElementById('dxo-answer');
    const text = document.getElementById('dxo-answer-text');
    if (text) text.textContent = '';
    if (wrap) wrap.style.display = 'none';
  }

  function handleQuestion(q) {
    track('question', { text: q });
    // New question supersedes any in-flight one. Abort the previous fetches,
    // stop the previous answer audio, and clear the panel before showing
    // "Thinking…".
    clearAnswer();

    const wrap = document.getElementById('dxo-answer');
    const textEl = document.getElementById('dxo-answer-text');
    wrap.style.display = 'block';
    textEl.textContent = 'Thinking…';

    const ctrl = new AbortController();
    currentAnswerAbort = ctrl;

    const startedAt = Date.now();
    const pathname = (typeof location !== 'undefined' && location.pathname) || '';
    const m = pathname.match(EXCEPTION_PATH_RE);
    const eventId = m ? m[1] : null;
    const currentStep = (script && script.steps && script.steps[state.stepIndex]) || null;

    const token = localStorage.getItem('xo-token') || localStorage.getItem('mfp.jwt');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    fetch(API_BASE + '/api/dxo/answer', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: q,
        current_url: pathname,
        event_id: eventId,
        step_index: state.stepIndex,
        step_title: currentStep ? currentStep.title : null,
      }),
      signal: ctrl.signal,
    })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(b)))
      .then((data) => {
        if (ctrl.signal.aborted) return;
        const answerText = (data && data.answer) || 'No answer returned.';
        textEl.textContent = answerText;
        // Render text immediately, then synthesise + play in the 'answer'
        // slot. Step narration in the 'narration' slot continues unaffected.
        let audioPlayed = false;
        try { speakAnswer(answerText, ctrl.signal); audioPlayed = true; } catch (_) {}
        track('question_answered', {
          latency_ms: Date.now() - startedAt,
          answer_chars: answerText.length,
          audio_played: audioPlayed,
          usage: data && data.usage ? data.usage : null,
        });
      })
      .catch((err) => {
        if (err && err.name === 'AbortError') return;
        if (ctrl.signal.aborted) return;
        console.warn('[dXO] /api/dxo/answer failed', err);
        textEl.textContent = "I couldn't reach the answer service right now. Try again in a moment.";
        track('question_answered', {
          latency_ms: Date.now() - startedAt,
          answer_chars: 0,
          audio_played: false,
          error: (err && err.error) || String(err),
        });
      });
  }

  // -------------------------------------------------------------------------
  // Auth gate
  // -------------------------------------------------------------------------
  // dxo.js loads unconditionally per index.html, but the panel must not
  // appear before the user has signed in. Detect post-auth state by
  // checking for the "Sign Out" sidebar item -- present on every screen
  // once the user is logged in (Welcome, All Clients, client workspace),
  // absent on the welcome / sign-in screen. Once detected, bootstrap
  // proceeds; the panel persists for the rest of the session.
  function isAuthed() {
    const text = (document.body && document.body.innerText) || '';
    return text.indexOf('Sign Out') !== -1;
  }

  // -------------------------------------------------------------------------
  // Preflight: silent click sequence before the panel renders. Lets the
  // script land the operator on the right starting screen (eg. Mayo's
  // Welcome page) without showing transitional steps. Each entry is a
  // selector accepted by findTarget. Failures are non-fatal -- the panel
  // still renders so the operator can drive manually.
  // -------------------------------------------------------------------------
  function runPreflight(idx, done) {
    const list = (script && script.meta && script.meta.preflightClicks) || [];
    if (idx >= list.length) {
      done();
      return;
    }
    const selector = list[idx];
    pollForTarget(selector, 4000, (target) => {
      if (target) {
        const clickable = findClickableAncestor(target) || target;
        const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
        try { clickable.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
        try { clickable.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
        try { clickable.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
        clickable.dispatchEvent(new MouseEvent('click', opts));
        console.log('[dXO] preflight clicked', clickable.tagName, (clickable.textContent || '').slice(0, 40));
      } else {
        console.warn('[dXO] preflight selector not found', selector);
      }
      // Give React a beat to re-render after each click before the next.
      setTimeout(() => runPreflight(idx + 1, done), 1500);
    });
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------
  function bootstrap() {
    if (!isAuthed()) {
      setTimeout(bootstrap, 1000);
      return;
    }
    loadScript().then((s) => {
      script = s;
      track('script_loaded', { name: s.name, steps: s.steps.length });
      // Run any preflight clicks silently to land on the starting screen
      // before the panel appears. Then build the UI and render step 1.
      runPreflight(0, () => {
        buildUI();
        // Defer first speak until voices are populated (Chrome quirk)
        if ('speechSynthesis' in window) {
          if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.addEventListener('voiceschanged', () => renderStep(), { once: true });
          } else {
            renderStep();
          }
        } else {
          renderStep();
        }
      });
    }).catch((err) => {
      console.error('[dXO] failed to load script', err);
      // Build the UI anyway so the operator sees the failure mode.
      buildUI();
      document.getElementById('dxo-segment-name').textContent = 'Failed to load demo script';
      document.getElementById('dxo-narration').textContent = String(err);
    });
  }

  function loadScript() {
    if (window.DXO_SCRIPT) return Promise.resolve(window.DXO_SCRIPT);
    if (window.DXO_SCRIPT_URL) {
      return fetch(window.DXO_SCRIPT_URL).then(r => r.json());
    }
    return Promise.resolve(BUNDLED_MFP_SCRIPT);
  }

  // Expose a tiny API for console-driven control during testing.
  window.dxo = { next, prev, restart, togglePause, getState: () => state, getScript: () => script };

  // -------------------------------------------------------------------------
  // Bundled MFP relationship-led demo script (v1 fallback if no JSON loaded)
  // -------------------------------------------------------------------------
  const BUNDLED_MFP_SCRIPT = {
    name: 'MFP Trading — relationship-led demo',
    preset: 'relationship-led',
    closing_message: 'Pick a use case you want prototyped. We come back to you with a working version in days.',
    steps: [
      {
        id: 'open',
        title: 'Welcome to MFP XO Console',
        narration: 'This is what an operator sees first thing in the shift. The throughput strip tracks every event XO is handling. Auto-resolved on the left, awaiting verification in the middle, escalated on the right. Each counter tells you the live state of the workload.',
        navigate: '/',
        target: 'text:AUTO-RESOLVED',
        duration_seconds: 30,
      },
      {
        id: 'verification_queue',
        title: 'Verification Queue — the operator workload',
        narration: 'These are events XO has flagged for human judgement. Q1 credit alerts, Q2 timeouts, Q3 DSU events, Q4 VBAN mismatches, Q5 unreported trades. The same five questions you scoped at our discovery call. Severity, scope, and authority all visible at a glance.',
        navigate: '/verification',
        target: 'text:Verification Queue',
        duration_seconds: 30,
      },
      {
        id: 'q1_credit_case',
        title: 'Q1 Credit Alert — opening a real case',
        narration: 'Let me drop into a credit alert. XO classifies, cites the FX Credit Policy directly, and surfaces the recommended action with every step pre-filled. No hunting, no guessing. The OODA reasoning down the page shows observation, orientation, decision, action. The evidence chain at the bottom shows which cartridge rules fired and how confident the runtime is. No black box.',
        find_case: { scope_question: 'Q1', exception_type: 'CREDIT_ALERT', status: 'OPEN' },
        target: 'text:Recommended action',
        duration_seconds: 75,
      },
      {
        id: 'q3_dsu_case',
        title: 'Q3 DSU TECHNICAL_FAULT — the four-branch decision tree',
        narration: 'A Deal Status Unknown event has four branches. Deal done, deal not done, technical fault, no response. Each one needs a different action. XO classifies the case from the event context, surfaces the matching protocol with the correct prime broker sub-account already selected. The mandatory check is right in the OODA reasoning: DPCE confirmation gate. XO does not auto-resolve a DSU without DPCE trade record verification.',
        find_case: { scope_question: 'Q3', exception_type: 'DSU' },
        target: 'text:Recommended action',
        duration_seconds: 75,
      },
      {
        id: 'q4_bgc_case',
        title: 'Q4 VBAN — BGC and Wells Fargo, embedded as a reference case',
        narration: 'This is the case Misha and Terry West coordinated on Slack with NatWest, April eighth. A BGC voice trade was allocated to Wells Fargo, who was not on the approved VBAN list. XO classifies the violation, surfaces the chase pattern from your own Slack thread verbatim, and the mandatory check fires: per MFP risk policy, XO does not auto-resolve a VBAN mismatch when vban status is NOT APPROVED.',
        find_case: { scope_question: 'Q4', exception_type: 'VBAN_MISMATCH', q: 'WELLS_FARGO' },
        target: 'text:Recommended action',
        duration_seconds: 75,
      },
      {
        id: 'q4_soc_gen_pivot',
        title: 'Soc Gen Paris — the false positive XO catches',
        narration: 'Same broker, same window. But this one XO classifies differently. fx vban mapping issue recheck. The cartridge catches the false positive pattern before any cancellation fires. The system distinguishes a real violation from a mapping error. Even experienced staff misdiagnose this. XO does not.',
        find_case: { scope_question: 'Q4', exception_type: 'VBAN_MISMATCH', q: 'SOC_GEN' },
        target: 'text:Recommended action',
        duration_seconds: 60,
      },
      {
        id: 'audit_log',
        title: 'Audit Log — every decision, immutable',
        narration: 'Every operator action lands here. Operator email, scope, severity, justification, and the silos written. Each row links back to the case detail. The full OODA trail is intact for anyone — including a regulator — who needs to reconstruct why XO made a specific call on a specific day.',
        navigate: '/audit',
        target: 'text:Audit Log',
        duration_seconds: 45,
      },
      {
        id: 'insights',
        title: 'XO Insights — silo write rollup',
        narration: 'Live counter rollups for every silo XO writes to. Credit Console P and L entries, NatWest cancellations, TraderTools log requests, hedge instructions. Each one increments as decisions land. Bedrock latency averages and resolution-path share also surface here.',
        navigate: '/xo-insights',
        target: 'text:Write activity',
        duration_seconds: 30,
      },
      {
        id: 'streamline',
        title: 'Streamline Workflows — configurable automation',
        navigate: '/streamline',
        target: 'text:Streamline',
        narration: 'Each cartridge rule maps to a Streamline workflow that fires after operator approval. Today these are scoped to the seed; production wires them to the real source systems. New workflows are configurable from the admin console. No code changes, no deploys.',
        duration_seconds: 30,
      },
      {
        id: 'close',
        title: 'Your turn',
        narration: 'You have seen what the engine and the cartridge do. Tell us the use case you want prototyped first. Credit alert workflow for the Asian session, voice trade reconciliation, anything. We come back to you with a working version in days, not months.',
        navigate: '/',
        target: null,
        duration_seconds: 45,
      },
    ],
  };

  // Go.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
