/* DAL Feedback Widget — v1.0
 * Usage: <script src="https://dal-tracker.vercel.app/widget/feedback-widget.js"
 *               data-project-id="my-project" data-project-name="My Project"></script>
 */
(function () {
  'use strict';

  var API_BASE = 'https://dal-tracker.vercel.app/api/feedback';
  var BRAND_COLOR = '#4CC1F3';
  var PREFIX = 'dal-widget-';

  // Read config from script tag
  var scripts = document.getElementsByTagName('script');
  var thisScript = scripts[scripts.length - 1];
  // Also search by src containing feedback-widget
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.indexOf('feedback-widget') !== -1) {
      thisScript = scripts[i];
      break;
    }
  }
  var PROJECT_ID = thisScript.getAttribute('data-project-id') || '';
  var PROJECT_NAME = thisScript.getAttribute('data-project-name') || '';

  if (!PROJECT_ID) return;

  // ── Storage helpers ──────────────────────────────────────────────────────────
  function genUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem('dal_feedback_session');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function saveSession(data) {
    try { localStorage.setItem('dal_feedback_session', JSON.stringify(data)); } catch (e) {}
  }

  // ── Inject pin styles into main document (shadow CSS can't reach body children) ──
  var pinStyle = document.createElement('style');
  pinStyle.textContent = [
    '.dal-pin { position: absolute; width: 28px; height: 28px; border-radius: 50%;',
    '  display: flex; align-items: center; justify-content: center;',
    '  font-size: 12px; font-weight: 700; cursor: pointer; transform: translate(-50%, -50%);',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 2147483644; border: 2px solid #fff;',
    '  transition: box-shadow 0.2s; font-family: -apple-system,sans-serif; }',
    '.dal-pin:hover { box-shadow: 0 0 0 4px rgba(76,193,243,0.3); }',
    '.dal-pin.open-pin { background: ' + BRAND_COLOR + '; color: #000; }',
    '.dal-pin.resolved-pin { background: #22c55e; color: #fff; }',
    '.dal-pin.pulse { animation: dal-pulse 1.2s ease-out 3; }',
    '@keyframes dal-pulse { 0%{box-shadow:0 2px 8px rgba(0,0,0,0.3)} 60%{box-shadow:0 0 0 20px rgba(253,224,71,0.5),0 2px 8px rgba(253,224,71,0.4)} 100%{box-shadow:0 2px 8px rgba(0,0,0,0.3)} }',
  ].join('\n');
  (document.head || document.documentElement).appendChild(pinStyle);

  // ── Shadow DOM container (FAB, popups, modals only) ──────────────────────────
  var host = document.createElement('div');
  host.id = 'dal-feedback-host';
  document.body.appendChild(host);
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var style = document.createElement('style');
  style.textContent = [
    '*, *::before, *::after { box-sizing: border-box; }',
    '.dal-btn { cursor: pointer; border: none; outline: none; font-family: inherit; }',
    // Floating toggle button
    '.dal-fab { position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;',
    '  background: #1a1a2e; color: #fff; border-radius: 24px; padding: 10px 18px;',
    '  font-size: 14px; font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,0.4);',
    '  transition: background 0.2s; display: flex; align-items: center; gap: 6px; }',
    '.dal-fab.active { background: ' + BRAND_COLOR + '; color: #000; }',
    '.dal-fab:hover { opacity: 0.9; }',
    // Popup
    '.dal-popup { position: absolute; background: #0f172a; border: 1px solid #334155;',
    '  border-radius: 10px; padding: 14px; min-width: 220px; max-width: 280px;',
    '  z-index: 2147483645; box-shadow: 0 8px 32px rgba(0,0,0,0.5); color: #e2e8f0; font-size: 13px; }',
    '.dal-popup h4 { margin: 0 0 6px; font-size: 13px; color: ' + BRAND_COLOR + '; }',
    '.dal-popup p { margin: 0 0 6px; line-height: 1.5; }',
    '.dal-popup .dal-meta { font-size: 11px; color: #94a3b8; }',
    '.dal-popup .dal-badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }',
    '.dal-popup .dal-badge.open { background:rgba(76,193,243,0.15); color:' + BRAND_COLOR + '; }',
    '.dal-popup .dal-badge.resolved { background:rgba(34,197,94,0.15); color:#22c55e; }',
    '.dal-popup textarea { width:100%; background:#1e293b; border:1px solid #334155; border-radius:6px;',
    '  color:#e2e8f0; padding:8px; font-size:13px; resize:vertical; min-height:72px; margin-bottom:8px;',
    '  font-family:inherit; outline:none; }',
    '.dal-popup textarea:focus { border-color:' + BRAND_COLOR + '; }',
    '.dal-popup .dal-actions { display:flex; gap:8px; justify-content:flex-end; }',
    '.dal-popup .dal-submit { background:' + BRAND_COLOR + '; color:#000; padding:6px 14px; border-radius:6px; font-weight:600; font-size:12px; }',
    '.dal-popup .dal-cancel { background:#1e293b; color:#94a3b8; padding:6px 14px; border-radius:6px; font-size:12px; }',
    '.dal-popup .dal-close { position:absolute; top:8px; right:10px; background:none; color:#94a3b8; font-size:16px; cursor:pointer; border:none; }',
    // Identity modal
    '.dal-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:2147483647;',
    '  display:flex; align-items:center; justify-content:center; }',
    '.dal-modal { background:#0f172a; border:1px solid #334155; border-radius:14px; padding:28px;',
    '  min-width:300px; max-width:380px; color:#e2e8f0; }',
    '.dal-modal h3 { margin:0 0 8px; font-size:17px; }',
    '.dal-modal p { margin:0 0 16px; font-size:13px; color:#94a3b8; }',
    '.dal-modal input { width:100%; background:#1e293b; border:1px solid #334155; border-radius:6px;',
    '  color:#e2e8f0; padding:9px 12px; font-size:13px; margin-bottom:10px; outline:none; font-family:inherit; }',
    '.dal-modal input:focus { border-color:' + BRAND_COLOR + '; }',
    '.dal-modal .dal-start-btn { width:100%; background:' + BRAND_COLOR + '; color:#000; padding:10px;',
    '  border-radius:8px; font-weight:700; font-size:14px; margin-top:4px; }',
  ].join('\n');
  shadow.appendChild(style);

  // ── State ────────────────────────────────────────────────────────────────────
  var session = loadSession();
  var feedbackMode = false;
  var pins = [];
  var pinEls = {};   // pin_id -> {pinEl, popupEl}
  var activePinId = null;
  var fabEl, overlayEl;

  // ── Build identity modal ─────────────────────────────────────────────────────
  function showIdentityModal(onDone) {
    var overlay = document.createElement('div');
    overlay.className = 'dal-modal-overlay';
    var modal = document.createElement('div');
    modal.className = 'dal-modal';
    modal.innerHTML = [
      '<h3>💬 Leave Feedback</h3>',
      '<p>Enter your name and email so we know who the feedback is from.</p>',
      '<input id="dal-name" type="text" placeholder="Your name" autocomplete="name" />',
      '<input id="dal-email" type="email" placeholder="Your email" autocomplete="email" />',
      '<button class="dal-btn dal-start-btn" id="dal-start">Start leaving feedback</button>',
    ].join('');
    overlay.appendChild(modal);
    shadow.appendChild(overlay);
    overlayEl = overlay;

    var startBtn = shadow.querySelector('#dal-start') || shadow.getElementById('dal-start');
    startBtn.addEventListener('click', function () {
      var nameEl = shadow.querySelector('#dal-name') || shadow.getElementById('dal-name');
      var emailEl = shadow.querySelector('#dal-email') || shadow.getElementById('dal-email');
      var name = (nameEl && nameEl.value || '').trim();
      var email = (emailEl && emailEl.value || '').trim();
      if (!name) { nameEl && nameEl.focus(); return; }
      session = { session_id: genUUID(), client_name: name, client_email: email };
      saveSession(session);
      overlay.remove();
      overlayEl = null;
      onDone();
    });
  }

  // ── FAB (floating action button) ────────────────────────────────────────────
  function buildFab() {
    fabEl = document.createElement('button');
    fabEl.className = 'dal-btn dal-fab';
    fabEl.textContent = '💬 Feedback';
    fabEl.addEventListener('click', function () {
    if (!session) {
      showIdentityModal(function () {
        loadPins();
        toggleFeedbackMode(); // enter feedback mode immediately after identity
      });
      return;
    }
    toggleFeedbackMode();
    });
    shadow.appendChild(fabEl);
  }

  function toggleFeedbackMode() {
    feedbackMode = !feedbackMode;
    fabEl.classList.toggle('active', feedbackMode);
    document.body.style.cursor = feedbackMode ? 'crosshair' : '';
  }

  // ── Render a single pin ───────────────────────────────────────────────────────
  function renderPin(pin, index) {
    if (pinEls[pin.id]) {
      // Update existing
      var existing = pinEls[pin.id];
      existing.pinEl.className = 'dal-pin ' + (pin.resolved ? 'resolved-pin' : 'open-pin');
      existing.pinEl.textContent = pin.resolved ? '✓' : String(index + 1);
      return;
    }

    var pinEl = document.createElement('div');
    pinEl.className = 'dal-pin ' + (pin.resolved ? 'resolved-pin' : 'open-pin');
    pinEl.textContent = pin.resolved ? '✓' : String(index + 1);
    pinEl.style.left = pin.x_percent + '%';
    pinEl.style.top = pin.y_percent + '%';
    pinEl.style.position = 'absolute';
    document.body.style.position = document.body.style.position || 'relative';

    var popupEl = null;

    pinEl.addEventListener('click', function (e) {
      e.stopPropagation();
      closeAllPopups();
      if (activePinId === pin.id) { activePinId = null; return; }
      activePinId = pin.id;
      popupEl = buildPinPopup(pin, pinEl);
    });

    pinEl.setAttribute('data-pin-id', pin.id);
    document.body.appendChild(pinEl);
    pinEls[pin.id] = { pinEl: pinEl, getPopup: function () { return popupEl; } };

    // Deep-link: pulse immediately if this pin matches the URL hash
    var hashMatch = (window.location.hash || '').match(/^#dal-pin-([\w]+)$/);
    if (hashMatch && hashMatch[1] === pin.id) {
      setTimeout(function () {
        pinEl.classList.add('pulse');
        pinEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function () { pinEl.classList.remove('pulse'); }, 5000);
      }, 50);
    }
  }

  function closeAllPopups() {
    shadow.querySelectorAll('.dal-popup').forEach(function (el) { el.remove(); });
    activePinId = null;
  }

  function buildPinPopup(pin, anchorEl) {
    var popup = document.createElement('div');
    popup.className = 'dal-popup';
    var rect = anchorEl.getBoundingClientRect();
    var scrollY = window.scrollY || window.pageYOffset;
    var scrollX = window.scrollX || window.pageXOffset;
    var top = rect.bottom + scrollY + 8;
    var left = rect.left + scrollX;
    popup.style.position = 'absolute';
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.zIndex = '2147483645';

    var date = new Date(pin.created_at).toLocaleDateString();
    var badge = pin.resolved
      ? '<span class="dal-badge resolved">✓ Resolved</span>'
      : '<span class="dal-badge open">● Open</span>';
    popup.innerHTML = [
      '<button class="dal-btn dal-close" title="Close">×</button>',
      '<h4>' + escHtml(pin.client_name || 'Anonymous') + '</h4>',
      '<p>' + escHtml(pin.note) + '</p>',
      '<p class="dal-meta">' + escHtml(pin.page_url || '') + ' · ' + date + '</p>',
      '<p>' + badge + '</p>',
      pin.screenshot_url ? '<p><img src="' + escHtml(pin.screenshot_url) + '" style="max-width:100%;border-radius:6px;" /></p>' : '',
    ].join('');

    popup.querySelector('.dal-close').addEventListener('click', function () {
      popup.remove();
      activePinId = null;
    });

    shadow.appendChild(popup);
    return popup;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Load pins from API ───────────────────────────────────────────────────────
  function loadPins() {
    var url = API_BASE + '/pins?project_id=' + encodeURIComponent(PROJECT_ID);
    if (session) url += '&session_id=' + encodeURIComponent(session.session_id);
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return;
        pins = data.pins || [];
        pins.forEach(function (pin, i) { renderPin(pin, i); });
        checkHighlight();
      })
      .catch(function () {});
  }

  // ── Deep-link highlight (#dal-pin-{id}) ─────────────────────────────────────
  function pulsePin(pinId) {
    var pinEl = document.querySelector('[data-pin-id="' + pinId + '"]');
    if (!pinEl) return false;
    pinEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pinEl.classList.remove('pulse');
    void pinEl.offsetWidth;
    pinEl.classList.add('pulse');
    setTimeout(function () { pinEl.classList.remove('pulse'); }, 5000);
    return true;
  }

  function checkHighlight() {
    var hash = window.location.hash || '';
    var match = hash.match(/^#dal-pin-([\w]+)$/);
    if (!match) return;
    var pinId = match[1];
    if (!pulsePin(pinId)) {
      // Element not yet in DOM — observe until it appears
      var observer = new MutationObserver(function () {
        if (pulsePin(pinId)) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); }, 5000); // give up after 5s
    }
  }

  // React to hash changes in the same session
  window.addEventListener('hashchange', function () { checkHighlight(); });

  // ── Click handler for dropping a new pin ─────────────────────────────────────
  function handlePageClick(e) {
    if (!feedbackMode) return;
    if (!session) return;
    // Ignore clicks inside the shadow host
    if (e.target.closest && e.target.closest('#dal-feedback-host')) return;

    var xPct = ((e.pageX / document.documentElement.scrollWidth) * 100).toFixed(4);
    var yPct = ((e.pageY / document.documentElement.scrollHeight) * 100).toFixed(4);

    // Get selector
    var selector = '';
    try {
      var el = e.target;
      if (el && el.tagName) {
        selector = el.tagName.toLowerCase();
        if (el.id) selector += '#' + el.id;
        else if (el.className && typeof el.className === 'string') {
          selector += '.' + el.className.trim().split(/\s+/).join('.');
        }
      }
    } catch (err) {}

    closeAllPopups();
    toggleFeedbackMode(); // turn off mode

    showNewPinPopup(parseFloat(xPct), parseFloat(yPct), e.pageX, e.pageY, selector);
  }

  function showNewPinPopup(xPct, yPct, pageX, pageY, selector) {
    // Temporary pin marker
    var tempPin = document.createElement('div');
    tempPin.className = 'dal-pin open-pin';
    tempPin.style.left = xPct + '%';
    tempPin.style.top = yPct + '%';
    tempPin.style.position = 'absolute';
    tempPin.style.opacity = '0.6';
    tempPin.textContent = '+';
    document.body.appendChild(tempPin);

    var popup = document.createElement('div');
    popup.className = 'dal-popup';
    popup.style.position = 'absolute';
    popup.style.top = (pageY + 20) + 'px';
    popup.style.left = (pageX - 10) + 'px';

    popup.innerHTML = [
      '<button class="dal-btn dal-close" title="Close">×</button>',
      '<h4>What would you like to change?</h4>',
      '<textarea id="dal-note-input" placeholder="Describe the change or issue..." rows="3"></textarea>',
      '<div class="dal-actions">',
        '<button class="dal-btn dal-cancel" id="dal-cancel-pin">Cancel</button>',
        '<button class="dal-btn dal-submit" id="dal-submit-pin">Submit</button>',
      '</div>',
    ].join('');

    shadow.appendChild(popup);

    var textarea = shadow.getElementById('dal-note-input');
    if (textarea) setTimeout(function () { textarea.focus(); }, 50);

    function cleanup() {
      popup.remove();
      tempPin.remove();
    }

    popup.querySelector('.dal-close').addEventListener('click', cleanup);
    shadow.getElementById('dal-cancel-pin').addEventListener('click', cleanup);

    shadow.getElementById('dal-submit-pin').addEventListener('click', function () {
      var note = shadow.getElementById('dal-note-input').value.trim();
      if (!note) { shadow.getElementById('dal-note-input').focus(); return; }
      submitPin(xPct, yPct, selector, note, cleanup, tempPin);
    });
  }

  function submitPin(xPct, yPct, selector, note, cleanup, tempPin) {
    // Try to capture screenshot via html2canvas
    var doSubmit = function (screenshotBase64) {
      var payload = {
        project_id: PROJECT_ID,
        session_id: session.session_id,
        client_name: session.client_name,
        client_email: session.client_email,
        page_url: window.location.href,
        page_title: document.title,
        x_percent: xPct,
        y_percent: yPct,
        selector: selector,
        note: note,
      };
      if (screenshotBase64) payload.screenshot_base64 = screenshotBase64;

      cleanup();

      fetch(API_BASE + '/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok && data.pin) {
            pins.push(data.pin);
            renderPin(data.pin, pins.length - 1);
          }
        })
        .catch(function () {});
    };

    // Submit immediately — attempt screenshot in background (non-blocking)
    // If html2canvas is already loaded, capture then submit; otherwise submit first
    var TIMEOUT = 4000; // max wait for html2canvas
    var submitted = false;
    function safeSubmit(dataUrl) {
      if (submitted) return;
      submitted = true;
      doSubmit(dataUrl || null);
    }

    // Failsafe: always submit within timeout
    var timer = setTimeout(function () { safeSubmit(null); }, TIMEOUT);

    function tryCapture() {
      try {
        html2canvas(document.body, { useCORS: true, scale: 0.4, logging: false })
          .then(function (canvas) { clearTimeout(timer); safeSubmit(canvas.toDataURL('image/jpeg', 0.7)); })
          .catch(function () { clearTimeout(timer); safeSubmit(null); });
      } catch (e) { clearTimeout(timer); safeSubmit(null); }
    }

    if (typeof html2canvas !== 'undefined') {
      tryCapture();
    } else {
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = tryCapture;
      script.onerror = function () { clearTimeout(timer); safeSubmit(null); };
      document.head.appendChild(script);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    buildFab();
    // Always load existing pins — session only needed for submitting new ones
    loadPins();
    document.addEventListener('click', handlePageClick, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
