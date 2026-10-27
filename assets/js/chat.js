'use strict';
/* Forge Guide widget — the chat UI. Answering is done by
 * chat-engine.js from the site's recorded data (catalog/*.json), and
 * the local recorded answer is ALWAYS the default: instant, and the
 * only answer whenever no live endpoint is configured.
 *
 * Live-model hook: when a deployment configures the live endpoint
 * (window.RF_LIVE.endpoint, from assets/js/live-config.js — empty in
 * the committed site) and /health answers, a question the local
 * engine honestly cannot answer (its `fallback: true` result) is
 * offered to the live model at POST /chat. The reply is rendered
 * escaped and badged "LIVE MODEL — not from recorded RobotForge
 * data". If the endpoint errors or is over budget, the Guide says
 * so plainly and keeps the local answer. No API keys ever live in
 * this file or any page: the endpoint holds them server-side.
 */
(function () {
  var FG = window.ForgeGuide;
  var box = document.getElementById('forge-chat');
  if (!FG || !box) return;

  var launcher = document.getElementById('fc-launcher');
  var panel = document.getElementById('fc-panel');
  var closeBtn = document.getElementById('fc-close');
  var msgs = document.getElementById('fc-msgs');
  var chipsRow = document.getElementById('fc-chips');
  var form = document.getElementById('fc-form');
  var input = document.getElementById('fc-input');

  /* Fetch base: this script's own URL, so data loads at any depth.
   * Link root: the app shell stamps data-root on <html>; the landing
   * page is at the root, where '' is correct. */
  var script = document.currentScript;
  var BASE = script && script.src
    ? script.src.replace(/assets\/js\/chat\.js(\?.*)?$/, '') : '';
  var ROOT = document.documentElement.dataset.root || '';

  var DEFAULT_CHIPS = ['Which robots passed the gate?',
    'What are the gate thresholds?', 'Tell me about Andino',
    'How does RobotForge work?'];

  var engine = null;
  var loading = null;
  var greeted = false;

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.json();
    });
  }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetchJSON(BASE + 'catalog/robots.json').catch(function () { return null; }),
      fetchJSON(BASE + 'catalog/parts.json').catch(function () { return null; }),
      fetchJSON(BASE + 'catalog/gate-reports.json').catch(function () { return null; }),
      fetchJSON(BASE + 'assets/js/chat-intents.json').catch(function () { return null; })
    ]).then(function (got) {
      var robots = got[0], parts = got[1], reports = got[2], intents = got[3];
      engine = FG.createEngine({
        robots: robots && robots.robots ? robots.robots : [],
        parts: parts && parts.parts ? parts.parts : [],
        templates: parts && parts.templates ? parts.templates.length : 0,
        reports: reports,
        intents: intents,
        root: ROOT
      });
      return engine;
    });
    return loading;
  }

  function bubble(who, html) {
    var d = document.createElement('div');
    d.className = 'fc-msg ' + who;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function userBubble(text) {
    var d = document.createElement('div');
    d.className = 'fc-msg user';
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setChips(list) {
    chipsRow.innerHTML = '';
    (list && list.length ? list : DEFAULT_CHIPS).forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = q;
      b.addEventListener('click', function () { ask(q); });
      chipsRow.appendChild(b);
    });
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    bubble('bot', '<p>Hello — I&rsquo;m the <strong>Forge Guide</strong>. I answer ' +
      'from RobotForge&rsquo;s recorded data (the Robodex, the parts catalogue ' +
      'and the recorded gate reports), not from a live AI.</p>' +
      '<p>Ask about a robot by name or number, a catalogue part, or how the ' +
      'gate works — or tap a suggestion.</p>');
    setChips(engine ? engine.suggestions : null);
  }

  /* A real in-page action, not just an answer: on the Robots page,
   * "find lidar" / "show servos" drives the catalogue's own search
   * box, so the page itself responds to the conversation. */
  function filterPartsHere(q) {
    var ps = document.getElementById('part-search');
    if (!ps) return;
    var m = q.match(/^(?:find|search|show(?: me)?|filter)\s+(.+)$/i);
    if (!m) return;
    ps.value = m[1].trim();
    ps.dispatchEvent(new Event('input', { bubbles: true }));
    var note = document.createElement('div');
    note.className = 'fc-msg bot';
    var p = document.createElement('p');
    p.textContent = 'I filtered the parts catalogue on this page for \u201c' +
      m[1].trim() + '\u201d — it is just below.';
    note.appendChild(p);
    msgs.appendChild(note);
    msgs.scrollTop = msgs.scrollHeight;
    var sec = document.getElementById('parts');
    if (sec) sec.scrollIntoView({ behavior: 'smooth' });
  }

  function localAnswer(question) {
    return engine.answer(question);
  }

  function escText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------------- live model (deployment-configured) ------------ */

  var LIVE_BADGE = 'LIVE MODEL — not from recorded RobotForge data; check numbers on the Evidence page';

  function liveBase() {
    var fromConfig = window.RF_LIVE && window.RF_LIVE.endpoint;
    var base = fromConfig || FG.CONFIG.endpoint || '';
    return String(base).replace(/\/+$/, '');
  }

  var healthPromise = null;
  function checkLive() {
    /* Cached /health probe: resolves to the health JSON when the
     * endpoint is configured AND answering AND able to run chat;
     * resolves to null otherwise (not configured, down, kill switch
     * on, or over budget — the caller distinguishes via the JSON it
     * keeps in liveHealth for the note wording). */
    if (!liveBase()) return Promise.resolve(null);
    if (!healthPromise) {
      healthPromise = fetch(liveBase() + '/health', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (h) {
          window.__rfLiveHealth = h;
          if (h && h.ok && h.mode === 'live' && h.routes && h.routes.chat) {
            var sub = document.querySelector('.fc-sub');
            if (sub) {
              sub.textContent = 'Recorded data first — the Robodex, the ' +
                'parts catalogue and the recorded gate reports. Questions ' +
                'they can\u2019t answer go to a live model, badged LIVE MODEL.';
            }
          }
          return h;
        })
        .catch(function () { window.__rfLiveHealth = null; return null; });
    }
    return healthPromise;
  }

  function liveUsable(h) {
    return Boolean(h && h.ok && h.mode === 'live' && h.routes &&
      h.routes.chat && !(h.budget && h.budget.exhausted));
  }

  function liveChat(q) {
    return fetch(liveBase() + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) {
          var e = new Error((body && body.error) || ('endpoint -> ' + r.status));
          e.code = body && body.code;
          e.status = r.status;
          throw e;
        }
        if (!body || typeof body.answer !== 'string') {
          throw new Error('endpoint returned no answer');
        }
        return body.answer;
      });
    });
  }

  function ask(question) {
    var q = String(question || '').trim();
    if (!q) return;
    userBubble(q);
    input.value = '';
    var wait = bubble('bot', '<p class="fc-dim">Checking the recorded data&hellip;</p>');
    var done = function (ans) {
      wait.innerHTML = ans.html;
      msgs.scrollTop = msgs.scrollHeight;
      setChips(ans.chips || (engine ? engine.suggestions : null));
      filterPartsHere(q);
    };
    load().then(function () {
      var ans = localAnswer(q);
      /* Recorded answers stay the default and stay instant: only
       * the engine's honest fallback may go live. */
      if (!ans.fallback || !liveBase()) { done(ans); return; }
      checkLive().then(function (h) {
        if (!liveUsable(h)) {
          /* Endpoint configured but not usable: say so only when
           * the reason is budget/kill-switch (a plain note under
           * the local answer); a silent endpoint keeps the plain
           * local behavior. */
          if (h && h.ok && (h.mode === 'off' || (h.budget && h.budget.exhausted))) {
            ans = { html: ans.html +
              '<p class="fc-live-note">The live model is ' +
              (h.mode === 'off' ? 'switched off at the endpoint'
                                : 'out of budget for today') +
              ', so this answer is from the recorded data only.</p>',
              chips: ans.chips };
          }
          done(ans);
          return;
        }
        wait.innerHTML = '<p class="fc-dim">The recorded data ' +
          'doesn&rsquo;t have that &mdash; asking the live model&hellip;</p>';
        liveChat(q).then(function (answer) {
          done({
            html: '<p><span class="fc-live-badge">' + LIVE_BADGE +
              '</span></p><p>' +
              escText(answer).replace(/\n{2,}/g, '</p><p>')
                .replace(/\n/g, '<br>') + '</p>',
            chips: ans.chips
          });
        }).catch(function (e) {
          var note = (e && e.code === 'budget_exhausted')
            ? 'The live model&rsquo;s budget for today is used up, so ' +
              'this answer is from the recorded data only.'
            : 'The live endpoint isn&rsquo;t answering, so this answer ' +
              'is from the recorded data only.';
          done({ html: ans.html +
            '<p class="fc-live-note">' + note + '</p>', chips: ans.chips });
        });
      });
    });
  }

  /* Docked mode (app pages, wide screens): the panel is a fixed
   * left rail and is simply open — there is nothing to toggle. The
   * media query mirrors the one in chat.css / app.css. */
  var dockMQ = window.matchMedia('(min-width: 1280px)');
  function isDocked() {
    return box.classList.contains('docked') && dockMQ.matches;
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      load().then(function () {
        greet();
        checkLive(); // updates the header disclosure when live is on
        if (!isDocked()) input.focus();
      });
    }
  }

  function applyMode() {
    if (box.classList.contains('docked')) setOpen(isDocked());
  }
  if (dockMQ.addEventListener) dockMQ.addEventListener('change', applyMode);
  applyMode();

  launcher.addEventListener('click', function () {
    if (!isDocked()) setOpen(panel.hidden);
  });
  closeBtn.addEventListener('click', function () {
    if (!isDocked()) setOpen(false);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !panel.hidden && !isDocked()) setOpen(false);
  });
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ask(input.value);
  });
})();
