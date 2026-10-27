'use strict';
/* Forge Guide answer engine — pure and DOM-free.
 *
 * Every answer is assembled from RobotForge's recorded data at runtime:
 * catalog/robots.json, catalog/parts.json and catalog/gate-reports.json,
 * plus the intent table in chat-intents.json. Robot and part facts are
 * never hardcoded here; if the data doesn't say it, the answer says so.
 *
 * Live-model hook: this local engine ALWAYS answers first, from the
 * recorded data, and its answers stay the default. Only when an
 * answer is the honest fallback (flagged `fallback: true` below) may
 * chat.js offer the question to a live model — and only when a
 * deployment has configured the live endpoint (window.RF_LIVE, from
 * assets/js/live-config.js; CONFIG.endpoint here stays '' and is a
 * legacy override). Live replies are badged as model output in the
 * UI; this module's contract ({html, chips}) is unchanged.
 */
(function (global) {
  var CONFIG = { endpoint: '' };

  var VLABEL = { PASS: 'Pass', MARGINAL: 'Marginal', FAIL: 'Fail', NOT_GATED: 'Not gated' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[^a-z0-9#]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function tokens(s) {
    var n = normalize(s);
    return n ? n.split(' ') : [];
  }

  /* True when phrase's tokens appear consecutively in qtoks. */
  function phraseIn(qtoks, phrase) {
    var pt = tokens(phrase);
    if (!pt.length || pt.length > qtoks.length) return false;
    for (var i = 0; i + pt.length <= qtoks.length; i++) {
      var ok = true;
      for (var j = 0; j < pt.length; j++) {
        if (qtoks[i + j] !== pt[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function fmt(v) {
    return v == null ? null : String(parseFloat(Number(v).toFixed(3)));
  }

  function dexId(robot) {
    var n = String(robot.number);
    return '#' + ('00' + n).slice(-3);
  }

  function robotPage(root, robot) {
    return root + 'app/robots/' + slugify(robot.name) + '/';
  }

  /* ---------------- robot matching ---------------- */

  function robotKeys(robot) {
    var toks = tokens(robot.name);
    var keys = [{ text: robot.name, score: 10 }];
    if (toks.length > 1) {
      var last = toks[toks.length - 1];
      /* >= 3 so model designators like "go2" and "op3" resolve; both
         are distinctive, unlike a bare "g1" (2 chars, stays unmatched) */
      if (last.length >= 3) keys.push({ text: last, score: 8 });
      if (toks.length > 2) {
        keys.push({ text: toks.slice(-2).join(' '), score: 8 });
        /* distinctive middle token: "waffle" in TurtleBot3 Waffle Pi */
        toks.slice(1, -1).forEach(function (t) {
          if (t.length >= 5) keys.push({ text: t, score: 8 });
        });
      }
    }
    var num = String(robot.number);
    keys.push({ text: '#' + ('00' + num).slice(-3), score: 6 });
    keys.push({ text: ('00' + num).slice(-3), score: 6 });
    return keys;
  }

  function findRobots(qt, robots) {
    var hits = [];
    robots.forEach(function (r) {
      var best = 0;
      robotKeys(r).forEach(function (k) {
        if (phraseIn(qt, k.text)) best = Math.max(best, k.score);
      });
      if (best) hits.push({ robot: r, score: best });
    });
    return hits.sort(function (a, b) { return b.score - a.score; });
  }

  /* Brand token shared by 2+ robots (e.g. "turtlebot3", or "turtlebot"
     with the model number dropped) with no qualifier — the honest move
     is to list the candidates. */
  function brandAmbiguity(qt, robots) {
    var first = {};
    robots.forEach(function (r) {
      var t = tokens(r.name)[0];
      if (!t) return;
      [t, t.replace(/\d+$/, '')].forEach(function (brand) {
        if (brand.length >= 4) (first[brand] = first[brand] || []).push(r);
      });
    });
    for (var brand in first) {
      var group = first[brand].filter(function (r, i, a) {
        return a.indexOf(r) === i;
      });
      if (group.length > 1 && qt.indexOf(brand) !== -1) return group;
    }
    return null;
  }

  /* ---------------- robot answers ---------------- */

  function runLine(run) {
    var bits = ['drive error ' + fmt(run.drive_error_pct) + '%'];
    if (run.heading_error_deg != null) bits.push('turn error ' + fmt(run.heading_error_deg) + '°');
    if (run.odometry_distance_error_pct != null) {
      bits.push('odometry distance error ' + fmt(run.odometry_distance_error_pct) + '%');
    }
    if (run.odometry_heading_error_deg != null) {
      bits.push('odometry heading error ' + fmt(run.odometry_heading_error_deg) + '°');
    }
    return bits.join(' · ');
  }

  function gateBlock(robot) {
    var gs = robot.gate_status || {};
    var status = gs.status || 'NOT_GATED';
    var runs = gs.runs || [];
    var out = '';
    if (status === 'NOT_GATED' || !runs.length) {
      out += '<p><strong>Gate: not gated yet</strong> — no recorded runs, so no verdict.</p>';
    } else {
      out += '<p><strong>Gate: ' + esc(VLABEL[status]) + '</strong> — ' +
        runs.length + ' recorded run' + (runs.length === 1 ? '' : 's') +
        ' at the locked thresholds (pass ≤ 5% / 5°):</p><ul>' +
        runs.map(function (run, i) {
          return '<li>Run ' + (i + 1) + ': ' + esc(runLine(run)) + '</li>';
        }).join('') + '</ul>';
    }
    if (gs.note) out += '<p>' + esc(gs.note) + '</p>';
    return out;
  }

  function staticCheckOf(robot) {
    var checks = robot.checks || [];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].type === 'static_stability') return checks[i];
    }
    return null;
  }

  function stabilityBlock(robot) {
    var c = staticCheckOf(robot);
    if (!c) return '';
    var gs = robot.gate_status || {};
    return '<p><strong>Static stability check: ' + esc(c.grade) + '</strong>' +
      ' — a computation from the spec (support-polygon statics), not a ' +
      'gate run. Weakest tip margin ' +
      fmt(Math.round(c.tip_angle_deg * 10) / 10) + '° (' +
      fmt(c.weakest_margin_mm) + ' mm, ' + esc(c.weakest_direction) +
      '), checked ' + esc(c.date) + '. The gate status is unchanged by ' +
      'it: still ' + esc(VLABEL[gs.status || 'NOT_GATED']) + '.</p>';
  }

  function specsBlock(robot) {
    var ks = robot.key_specs || {};
    var keys = Object.keys(ks);
    if (!keys.length) return '<p>No key specs recorded for this robot.</p>';
    return '<p><strong>Key specs</strong></p><ul>' + keys.map(function (k) {
      return '<li>' + esc(k.replace(/_/g, ' ')) + ': ' + esc(ks[k]) + '</li>';
    }).join('') + '</ul>';
  }

  function provBlock(robot) {
    var p = robot.provenance || {};
    var out = '<p><strong>Provenance</strong></p><ul>';
    if (p.source_name) {
      out += '<li>Source: ' + esc(p.source_name) +
        (p.source_url ? ' (<a href="' + esc(p.source_url) + '">link</a>)' : '') + '</li>';
    }
    if (p.license) out += '<li>License: ' + esc(p.license) + '</li>';
    if (robot.spec_file) out += '<li>Spec file: <code>' + esc(robot.spec_file) + '</code></li>';
    if (p.note) out += '<li>' + esc(p.note) + '</li>';
    return out + '</ul>';
  }

  function robotAnswer(robot, qt, root) {
    var gs = robot.gate_status || {};
    var status = gs.status || 'NOT_GATED';
    var wantsGate = ['gate', 'verdict', 'passed', 'pass', 'failed', 'fail',
      'measured', 'run', 'runs', 'score', 'why'].some(function (w) {
        return qt.indexOf(w) !== -1;
      });
    var wantsSpecs = ['spec', 'specs', 'size', 'dimension', 'dimensions',
      'mass', 'weight', 'heavy', 'wheel', 'wheels', 'battery', 'motor',
      'motors', 'sensor', 'sensors', 'big'].some(function (w) {
        return qt.indexOf(w) !== -1;
      });
    var wantsProv = ['license', 'licence', 'source', 'provenance', 'made',
      'maker', 'manufacturer', 'designed', 'built'].some(function (w) {
        return qt.indexOf(w) !== -1;
      });
    var wantsStability = ['stable', 'stability', 'tip', 'balance',
      'fall over', 'upright'].some(function (w) {
        return qt.indexOf(w) !== -1;
      });
    var out = '<p><strong>' + esc(dexId(robot)) + ' ' + esc(robot.name) + '</strong> · ' +
      esc(robot.class) + '</p><p>' + esc(robot.description) + '</p>';
    if (wantsGate || (!wantsSpecs && !wantsProv)) {
      out += gateBlock(robot);
    } else {
      out += '<p><strong>Gate: ' + esc(VLABEL[status]) + '</strong>' +
        (gs.runs && gs.runs.length
          ? ' — ' + gs.runs.length + ' recorded run' + (gs.runs.length === 1 ? '' : 's') + '.'
          : ' — no recorded runs.') + '</p>';
    }
    if (staticCheckOf(robot)) {
      if (wantsStability || (!wantsSpecs && !wantsProv)) {
        out += stabilityBlock(robot);
      }
    } else if (wantsStability) {
      out += '<p>No static stability check is recorded for this robot' +
        ' — that check covers legged robots only.</p>';
    }
    if (wantsSpecs) out += specsBlock(robot);
    if (wantsProv) out += provBlock(robot);
    out += '<p><a href="' + esc(robotPage(root, robot)) + '">Open ' +
      esc(robot.name) + '&rsquo;s page &rarr;</a>';
    if (wantsGate) {
      out += ' · <a href="' + esc(root + 'app/evidence/') + '">Gate evidence</a>';
    }
    return out + '</p>';
  }

  function compareAnswer(hits, root) {
    var out = '<p>Here is what the recorded data says about each:</p>';
    hits.forEach(function (h) {
      var r = h.robot;
      var gs = r.gate_status || {};
      var runs = gs.runs || [];
      var latest = runs.length ? runs[runs.length - 1] : null;
      out += '<p><strong>' + esc(dexId(r)) + ' ' + esc(r.name) + '</strong> — gate: <strong>' +
        esc(VLABEL[gs.status || 'NOT_GATED']) + '</strong>' +
        (latest ? '; latest run: ' + esc(runLine(latest)) : '; no recorded runs') +
        '. <a href="' + esc(robotPage(root, r)) + '">Its page &rarr;</a></p>';
    });
    return out;
  }

  function brandAnswer(group, root) {
    var out = '<p>More than one robot matches that name:</p><ul>' + group.map(function (r) {
      var gs = r.gate_status || {};
      return '<li><a href="' + esc(robotPage(root, r)) + '">' + esc(dexId(r)) + ' ' +
        esc(r.name) + '</a> — ' + esc(r.class) + '; gate: ' +
        esc(VLABEL[gs.status || 'NOT_GATED']) + '</li>';
    }).join('') + '</ul><p>Ask about one by its full name or number.</p>';
    return out;
  }

  /* ---------------- part matching + answers ---------------- */

  var STOP = { mm: 1, cm: 1, kg: 1, per: 1, metre: 1, meter: 1, inch: 1,
               size: 1, class: 1, with: 1, the: 1, for: 1, and: 1 };

  function headName(name) {
    return String(name).split('(')[0].split(',')[0].trim();
  }

  function scorePart(part, q, qt) {
    var nameN = normalize(part.name);
    var headN = normalize(headName(part.name));
    if (phraseIn(qt, nameN)) return 10;
    if (headN && headN !== nameN && phraseIn(qt, headN)) return 9;
    if (phraseIn(qt, String(part.id).replace(/_/g, ' '))) return 8;
    /* An accessory (mount/bracket/post/holder) must not outrank the
     * part itself on a bare type word: "lidar" is the RPLIDAR first,
     * its mount post second — unless the question names the accessory. */
    var accessory = /(mount|bracket|post|holder)/.test(headN) &&
      qt.indexOf('mount') === -1 && qt.indexOf('bracket') === -1 &&
      qt.indexOf('post') === -1 && qt.indexOf('holder') === -1;
    var segs = String(part.id).split('_');
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].length >= 4 && qt.indexOf(segs[i]) !== -1) return accessory ? 4 : 7;
    }
    var headToks = tokens(headN);
    tokens(String((part.specs || {}).kind || '').replace(/_/g, ' '))
      .forEach(function (tk) {
        if (headToks.indexOf(tk) === -1) headToks.push(tk);
      });
    if (headToks.length >= 2) {
      /* a run of >= 2 question tokens that starts the part's head name
         ("lidar mount" -> "Lidar mount post (3D-printed)") */
      for (var s = 0; s + 1 < qt.length; s++) {
        if (qt[s] === headToks[0] && qt[s + 1] === headToks[1]) return 7;
      }
      var sig = headToks.filter(function (t) { return t.length >= 3 && !STOP[t]; });
      var matched = sig.filter(function (t) { return qt.indexOf(t) !== -1; });
      if (matched.length >= 2 && matched.length / sig.length >= 0.75) return 5;
      if (matched.length >= 1 && matched.length / sig.length >= 0.5) return accessory ? 3 : 5;
    } else if (headToks.length === 1 && headToks[0].length >= 4 &&
               qt.indexOf(headToks[0]) !== -1) {
      return 6;
    }
    return 0;
  }

  function findParts(q, qt, parts) {
    var hits = [];
    parts.forEach(function (p) {
      var s = scorePart(p, q, qt);
      if (s) hits.push({ part: p, score: s });
    });
    return hits.sort(function (a, b) { return b.score - a.score; });
  }

  /* ---------------- query cards: hits + catalogue filters ----------------
   * Answers carry structured hits (kind/id/label/route) alongside the
   * HTML, so the UI can render result buttons that pop the entity up
   * in the app — a robot's page, or the part's own catalogue card. */

  function partHit(part) {
    return { kind: 'part', id: part.id, label: part.name };
  }

  function robotHit(robot, root) {
    return { kind: 'robot', id: slugify(robot.name),
             label: dexId(robot) + ' ' + robot.name,
             route: robotPage(root, robot) };
  }

  function partText(part) {
    var bits = [part.name, String(part.id).replace(/_/g, ' '),
      String(part.part_class || '').replace(/_/g, ' '),
      part.blurb || '', part.used_for || '', part.source || '',
      (part.robot_types || []).join(' ')];
    var specs = part.specs || {};
    Object.keys(specs).forEach(function (k) {
      var v = specs[k];
      bits.push(k.replace(/_/g, ' ') + ' ' +
        (Array.isArray(v) ? v.join(' ') : String(v)));
    });
    return normalize(bits.join(' '));
  }

  var FILTER_STOP = { what: 1, how: 1, does: 1, do: 1, did: 1, is: 1,
    are: 1, was: 1, were: 1, which: 1, who: 1, why: 1, when: 1, where: 1,
    the: 1, a: 1, an: 1, of: 1, for: 1, with: 1, on: 1, in: 1, me: 1,
    about: 1, tell: 1, show: 1, find: 1, search: 1, list: 1, filter: 1,
    give: 1, get: 1, parts: 1, part: 1, robots: 1, robot: 1, used: 1,
    use: 1, using: 1, there: 1, any: 1, and: 1, or: 1, to: 1, from: 1,
    work: 1, works: 1, i: 1, want: 1, need: 1, have: 1, has: 1, can: 1,
    could: 1, please: 1, all: 1, one: 1, ones: 1 };

  /* Class words a question might use, mapped to catalogue classes.
   * `any` tokens offer a text route in for parts filed elsewhere
   * (a battery charger lives under power, a BMS board does not). */
  var CLASS_SYNONYMS = [
    { words: ['battery', 'batteries'], classes: ['power'], any: ['battery', 'pack'] },
    { words: ['lidar'], classes: ['cameras_sensors'], any: ['lidar'] },
    { words: ['camera', 'cameras'], classes: ['cameras_sensors'], any: ['camera'] },
    { words: ['sensor', 'sensors'], classes: ['cameras_sensors'], any: [] },
    { words: ['imu'], classes: ['cameras_sensors'], any: ['imu'] },
    { words: ['motor', 'motors'], classes: ['actuators'], any: ['motor'] },
    { words: ['servo', 'servos'], classes: ['actuators'], any: ['servo'] },
    { words: ['stepper'], classes: ['actuators'], any: ['stepper'] },
    { words: ['wheel', 'wheels'], classes: ['wheels'], any: ['wheel'] },
    { words: ['caster', 'casters'], classes: ['wheels'], any: ['caster'] },
    { words: ['driver', 'drivers'], classes: ['drivers'], any: ['driver'] },
    { words: ['esc'], classes: ['drivers'], any: ['esc'] },
    { words: ['charger', 'chargers'], classes: ['power'], any: ['charger'] },
    { words: ['connector', 'connectors'], classes: ['cables_connectors'], any: [] },
    { words: ['wire', 'wires', 'cable', 'cables'], classes: ['cables_connectors'], any: [] },
    { words: ['microcontroller', 'microcontrollers'], classes: ['microcontrollers'], any: [] },
    { words: ['frame', 'frames'], classes: ['structure'], any: ['frame'] },
    { words: ['filament'], classes: ['materials'], any: ['filament'] },
    { words: ['gripper', 'grippers'], classes: ['end_effectors'], any: ['gripper'] },
    { words: ['propeller', 'propellers', 'prop', 'props'], classes: ['propulsion_air'], any: ['propeller'] },
    { words: ['fuse', 'fuses'], classes: ['safety_protection'], any: ['fuse'] }
  ];

  function filterPartsQuery(q, qt, parts) {
    var qn = normalize(q);
    var typePhrase = null;
    parts.forEach(function (p) {
      (p.robot_types || []).forEach(function (tp) {
        if (normalize(tp) && qn.indexOf(normalize(tp)) !== -1) typePhrase = tp;
      });
    });
    var syn = null;
    var synWords = {};
    CLASS_SYNONYMS.forEach(function (d) {
      d.words.forEach(function (w) {
        synWords[w] = 1;
        if (qt.indexOf(w) !== -1) syn = d;
      });
    });
    var attrs = qt.filter(function (tk) {
      return !FILTER_STOP[tk] && !synWords[tk];
    });
    var intentVerb = ['show', 'find', 'search', 'filter', 'list']
      .some(function (v) { return qt.indexOf(v) !== -1; });
    var signal = syn || typePhrase ||
      (attrs.length >= 1 && (intentVerb || qt.indexOf('parts') !== -1)) ||
      attrs.length >= 2;
    if (!signal) return null;
    var hits = parts.filter(function (p) {
      if (typePhrase && (p.robot_types || []).indexOf(typePhrase) === -1) {
        return false;
      }
      var text = partText(p);
      var toks = tokens(text);
      if (syn) {
        if (syn.any.length) {
          /* A specific type word must be named by the part itself
           * (name, id, kind or a spec value) — class membership alone
           * is too broad: every sensor in the class is not a lidar. */
          var corpus = tokens([p.name, String(p.id).replace(/_/g, ' '),
            String((p.specs || {}).kind || '').replace(/_/g, ' ')].join(' '));
          var squash = normalize(p.name + ' ' + p.id).replace(/ /g, '');
          var named = syn.any.some(function (tk) {
            return corpus.indexOf(tk) !== -1 || squash.indexOf(tk) !== -1;
          });
          if (!named) return false;
        } else if (syn.classes.indexOf(p.part_class) === -1) {
          return false;
        }
      }
      var squash = text.replace(/ /g, '');
      return attrs.every(function (a) {
        return toks.indexOf(a) !== -1 || squash.indexOf(a) !== -1;
      });
    });
    if (!hits.length) return null;
    if (hits.length === 1) {
      return { html: partAnswer(hits[0]), hits: [partHit(hits[0])] };
    }
    var shown = hits.slice(0, 8);
    var out = '<p><strong>' + hits.length + ' catalogue parts</strong> match' +
      (typePhrase ? ' for ' + esc(typePhrase) : '') + ':</p><ul>' +
      shown.map(function (p) {
        var specs = p.specs || {};
        var ks = Object.keys(specs).slice(0, 3).map(function (k) {
          var v = specs[k];
          return esc(k.replace(/_/g, ' ')) + ': ' +
            esc(Array.isArray(v) ? v.join(' / ') : v);
        }).join(' · ');
        return '<li><strong>' + esc(p.name) + '</strong> — ' +
          esc(String(p.part_class || '').replace(/_/g, ' ')) +
          (ks ? ' · ' + ks : '') + '</li>';
      }).join('') + '</ul>' +
      (hits.length > shown.length
        ? '<p>…and ' + (hits.length - shown.length) +
          ' more. Narrow it with a spec (voltage, connector, size), ' +
          'or tap a result button below.</p>'
        : '<p>Tap a result button below to pop one up in the catalogue.</p>');
    return { html: out, hits: hits.slice(0, 6).map(partHit) };
  }

  function partAnswer(part) {
    var out = '<p><strong>' + esc(part.name) + '</strong> · ' +
      esc(String(part.part_class || '').replace(/_/g, ' ')) + '</p>';
    if (part.blurb) out += '<p>' + esc(part.blurb) + '</p>';
    if (part.used_for) out += '<p><strong>Used for:</strong> ' + esc(part.used_for) + '</p>';
    if (part.robot_types && part.robot_types.length) {
      out += '<p><strong>Found on:</strong> ' + esc(part.robot_types.join(', ')) + '</p>';
    }
    var specs = part.specs || {};
    var keys = Object.keys(specs).slice(0, 5);
    if (keys.length) {
      out += '<p><strong>Recorded specs:</strong> ' + keys.map(function (k) {
        var v = specs[k];
        return esc(k.replace(/_/g, ' ')) + ': ' +
          esc(Array.isArray(v) ? v.join(' / ') : v);
      }).join(' · ') + '</p>';
    }
    if (part.notes) out += '<p>' + esc(part.notes) + '</p>';
    out += '<p><span class="fc-dim">Source: ' + esc(part.source || 'not recorded') +
      ' · License: ' + esc(part.license || 'not recorded') + '</span></p>';
    return out;
  }

  function partAmbiguous(hits) {
    return '<p>That matches more than one catalogue part:</p><ul>' +
      hits.slice(0, 5).map(function (h) {
        return '<li>' + esc(h.part.name) + ' (' +
          esc(String(h.part.part_class || '').replace(/_/g, ' ')) + ')</li>';
      }).join('') + '</ul><p>Ask again with the fuller name.</p>';
  }


  /* ---------------- build planning ----------------
   * Planning answers are assembled from two recorded sources:
   * the starter kinds (catalog/kinds.json — kind, gate badge,
   * starter parameters) and the class templates in parts.json
   * (the reference BOM as required part ids x qty). Nothing here
   * invents a part or a verdict: a kind with no gate pack says
   * so in its own badge. */

  var KIND_TEMPLATE = {
    differential: 'rover_diff_drive',
    'skid-steer': 'rover_skid_steer',
    mecanum: 'rover_skid_steer',
    tracked: 'rover_skid_steer',
    ackermann: 'rc_car',
    quadcopter: 'quadcopter_5inch',
    arm: 'robot_arm_6dof'
  };
  var KIND_TEMPLATE_NOTE = {
    mecanum: 'Uses the skid-steer template; its plain wheels become mecanum wheels (the template lists one as an optional part).',
    tracked: 'Uses the skid-steer template; tracks are not a catalogue part yet, so the template\u2019s wheels stand in for the track units.'
  };
  var KIND_PHRASES = [
    { id: 'differential', phrases: ['differential'] },
    { id: 'skid-steer', phrases: ['skid steer', 'skidsteer'] },
    { id: 'mecanum', phrases: ['mecanum'] },
    { id: 'tracked', phrases: ['tracked', 'treads', 'tank'] },
    { id: 'ackermann', phrases: ['ackermann', 'rc car'] },
    { id: 'quadcopter', phrases: ['quadcopter', 'quad', 'drone'] },
    { id: 'arm', phrases: ['robot arm', 'robotic arm'] }
  ];

  function findKindId(qt) {
    for (var i = 0; i < KIND_PHRASES.length; i++) {
      var ps = KIND_PHRASES[i].phrases;
      for (var j = 0; j < ps.length; j++) {
        if (phraseIn(qt, ps[j])) return KIND_PHRASES[i].id;
      }
    }
    return null;
  }
  function kindById(ctx, id) {
    var found = null;
    (ctx.data.kinds || []).forEach(function (k) {
      if (k.id === id) found = k;
    });
    return found;
  }
  function templateByName(ctx, name) {
    var found = null;
    (ctx.data.templateList || []).forEach(function (t) {
      if (t.name === name) found = t;
    });
    return found;
  }
  function partById(ctx, id) {
    var found = null;
    ctx.data.parts.forEach(function (p) { if (p.id === id) found = p; });
    return found;
  }
  function gateBadge(pack) {
    return { live: 'gate pack LIVE', partial: 'gate pack PARTIAL',
      'catalogue-only': 'CATALOGUE ONLY \u2014 no gate pack yet',
      roadmap: 'no gate pack yet (roadmap)' }[pack] || pack;
  }
  function kindHit(kind, root) {
    return { kind: 'kind', id: kind.id,
             label: kind.label + ' \u2014 starter kind',
             route: root + 'app/forge/' };
  }
  function bomItems(ctx, template) {
    return Object.keys(template.required || {}).map(function (id) {
      return { id: id, qty: template.required[id],
               part: partById(ctx, id) };
    }).map(function (it) {
      it.name = it.part ? it.part.name : it.id;
      return it;
    });
  }

  function planAnswer(ctx, kind) {
    var out = '<p><strong>' + esc(kind.label) + '</strong> \u2014 ' +
      esc(kind.one_liner) + '</p>';
    out += '<p><strong>' + esc(gateBadge(kind.gate_pack)) + '</strong>' +
      (kind.gate_note ? ' ' + esc(kind.gate_note) : '') +
      '<br><span class="fc-dim">Reference: ' + esc(kind.reference) +
      '</span></p>';
    var hits = [kindHit(kind, ctx.root)];
    var tname = KIND_TEMPLATE[kind.id];
    var template = tname ? templateByName(ctx, tname) : null;
    if (template) {
      var items = bomItems(ctx, template);
      out += '<p><strong>The reference build</strong> (the ' +
        esc(template.label) + ' template):</p><ul>' +
        items.map(function (it) {
          return '<li>' + esc(it.name) + ' \u00d7' + it.qty + '</li>';
        }).join('') + '</ul>';
      items.slice(0, 5).forEach(function (it) {
        if (it.part) hits.push(partHit(it.part));
      });
      var opt = (template.optional || []).length;
      if (opt) {
        out += '<p>Plus ' + opt + ' optional parts in the template ' +
          '(sensors, safety, upgrades).</p>';
      }
      if (KIND_TEMPLATE_NOTE[kind.id]) {
        out += '<p>' + esc(KIND_TEMPLATE_NOTE[kind.id]) + '</p>';
      }
    } else if (kind.bom_hints && kind.bom_hints.length) {
      out += '<p><strong>The build, at BOM level:</strong></p><ul>' +
        kind.bom_hints.map(function (h) {
          return '<li>' + esc(h) + '</li>';
        }).join('') + '</ul>';
    }
    var params = (kind.params || []).slice(0, 5);
    if (params.length) {
      out += '<p><strong>Starter parameters</strong> (defaults): ' +
        params.map(function (p) {
          return esc(p.label) + ' ' + esc(p.default) +
            (p.unit ? ' ' + esc(p.unit) : '');
        }).join(' \u00b7 ') + '</p>';
    }
    out += '<p>Start from this kind in the <a href="' +
      esc(ctx.root + 'app/forge/') + '">Forge</a>, or ask me what ' +
      'you still need: \u2018I have wheels and motors, what else do ' +
      'I need for a ' + esc(kind.id) + ' build?\u2019</p>';
    return { html: out, hits: hits };
  }

  function kindPickerAnswer(ctx, lead) {
    var kinds = ctx.data.kinds || [];
    if (!kinds.length) return null;
    var out = '<p>' + esc(lead) + '</p><ul>' + kinds.map(function (k) {
      return '<li><strong>' + esc(k.label) + '</strong> \u2014 ' +
        esc(k.one_liner) + ' <em>' + esc(gateBadge(k.gate_pack)) +
        '</em></li>';
    }).join('') + '</ul><p>Name a kind and I\u2019ll lay out its ' +
      'reference build.</p>';
    return { html: out,
             hits: kinds.map(function (k) {
               return kindHit(k, ctx.root);
             }) };
  }

  function haveNeedAnswer(ctx, q, qt, kind) {
    var ownedIds = {}, ownedClasses = {}, classWords = [];
    findParts(q, qt, ctx.data.parts).forEach(function (h) {
      if (h.score >= 7) ownedIds[h.part.id] = 1;
    });
    CLASS_SYNONYMS.forEach(function (d) {
      if (d.words.some(function (w) { return qt.indexOf(w) !== -1; })) {
        d.classes.forEach(function (c) {
          ownedClasses[c] = 1;
          if (classWords.indexOf(c) === -1) classWords.push(c);
        });
      }
    });
    var tname = KIND_TEMPLATE[kind.id];
    var template = tname ? templateByName(ctx, tname) : null;
    if (!template) {
      return { html: '<p>For a ' + esc(kind.label) + ' there is no ' +
          'part-by-part template yet \u2014 it is a BOM-level kind (' +
          esc(gateBadge(kind.gate_pack)) + '). Its build list:</p><ul>' +
          (kind.bom_hints || []).map(function (h) {
            return '<li>' + esc(h) + '</li>';
          }).join('') + '</ul>',
        hits: [kindHit(kind, ctx.root)] };
    }
    var missing = [], covered = [];
    bomItems(ctx, template).forEach(function (it) {
      var cls = it.part ? it.part.part_class : null;
      if (ownedIds[it.id] || (cls && ownedClasses[cls])) {
        covered.push(it);
      } else { missing.push(it); }
    });
    var haveBits = [];
    Object.keys(ownedIds).forEach(function (id) {
      var p = partById(ctx, id);
      if (p) haveBits.push(p.name);
    });
    classWords.forEach(function (c) {
      haveBits.push(c.replace(/_/g, ' ') + ' (class)');
    });
    var out = '<p><strong>' + esc(kind.label) + '</strong> \u2014 ' +
      esc(gateBadge(kind.gate_pack)) + '</p>';
    out += '<p>Counting what you named (' +
      (haveBits.length ? esc(haveBits.join(', ')) : 'nothing specific') +
      '), the ' + esc(template.label) + ' template still needs:</p>';
    if (missing.length) {
      out += '<ul>' + missing.map(function (it) {
        return '<li>' + esc(it.name) + ' \u00d7' + it.qty + '</li>';
      }).join('') + '</ul>';
    } else {
      out += '<p><strong>Nothing \u2014 the required list is ' +
        'covered.</strong> The template also lists ' +
        ((template.optional || []).length) + ' optional parts.</p>';
    }
    if (covered.length && missing.length) {
      out += '<p>Already covered: ' + covered.map(function (it) {
        return esc(it.name);
      }).join(', ') + '.</p>';
    }
    out += '<p><span class="fc-dim">Counting is by part class: ' +
      'naming \u2018wheels\u2019 covers the template\u2019s wheel line, ' +
      'whatever the specific wheel. Quantities are the ' +
      'template\u2019s.</span></p>';
    var hits = [kindHit(kind, ctx.root)];
    missing.slice(0, 5).forEach(function (it) {
      if (it.part) hits.push(partHit(it.part));
    });
    return { html: out, hits: hits };
  }

  var BUILD_VERBS = ['build', 'building', 'plan', 'planning',
    'assemble', 'assembling'];
  function planningAnswer(ctx, q, qt) {
    /* Pricing questions belong to the topics table, not planning. */
    if (qt.indexOf('cost') !== -1 || qt.indexOf('price') !== -1 ||
        qt.indexOf('expensive') !== -1) return null;
    var kindId = findKindId(qt);
    var kind = kindId ? kindById(ctx, kindId) : null;
    var hasBuild = BUILD_VERBS.some(function (v) {
      return qt.indexOf(v) !== -1;
    }) || (qt.indexOf('start') !== -1 &&
           (qt.indexOf('robot') !== -1 || !!kind)) ||
      (qt.indexOf('new') !== -1 && qt.indexOf('robot') !== -1) ||
      (qt.indexOf('custom') !== -1 && qt.indexOf('robot') !== -1);
    var needPhrase = phraseIn(qt, 'what do i need') ||
      phraseIn(qt, 'parts do i need') || phraseIn(qt, 'do i need') ||
      phraseIn(qt, 'what else') || phraseIn(qt, 'whats missing') ||
      phraseIn(qt, 'am i missing');
    var havePhrase = phraseIn(qt, 'i have') ||
      phraseIn(qt, 'i already have') || phraseIn(qt, 'i own') ||
      phraseIn(qt, 'i got');
    var missingAsk = havePhrase ||
      (needPhrase && (qt.indexOf('else') !== -1 ||
                      qt.indexOf('missing') !== -1));

    if (missingAsk) {
      if (kind) return haveNeedAnswer(ctx, q, qt, kind);
      return kindPickerAnswer(ctx, 'Tell me which kind you are ' +
        'building and I will diff what you have against its ' +
        'reference build. The starter kinds:');
    }
    if (kind && (hasBuild || needPhrase)) return planAnswer(ctx, kind);
    if (needPhrase && !kind) {
      /* "What motors do I need for a rover?" is a catalogue
       * question in planning clothes — the filter answers it. */
      var fq = filterPartsQuery(q, qt, ctx.data.parts);
      if (fq) return fq;
    }
    /* Recommendation routing runs before the generic picker:
     * "what battery should I use for a 4S build?" names a build
     * but asks a catalogue question — strip the modal words and
     * let the filter answer with the attribute that is meant. */
    if (qt.indexOf('should') !== -1 ||
        qt.indexOf('recommend') !== -1) {
      var cleaned = qt.filter(function (tk) {
        return ['should', 'would', 'recommend', 'best', 'pick',
          'choose', 'use', 'get', 'buy', 'build'].indexOf(tk) === -1;
      }).join(' ');
      var rf = filterPartsQuery(cleaned, tokens(cleaned),
        ctx.data.parts);
      if (rf) {
        rf.html = '<p>From the catalogue:</p>' + rf.html;
        return rf;
      }
    }
    if (hasBuild || needPhrase) {
      return kindPickerAnswer(ctx, 'Every custom build starts ' +
        'from a starter kind \u2014 a body plan with real defaults ' +
        'and an honest gate badge. Pick one:');
    }
    return null;
  }

  /* ---------------- data-driven topic handlers ---------------- */

  var HANDLERS = {
    robodex_list: function (ctx) {
      if (!ctx.data.robots.length) return ctx.noData('app/robots/', 'the Robodex page');
      var out = '<p>The Robodex — ' + ctx.data.robots.length +
        ' robots, numbered in the order the forge learned them:</p><ul>';
      ctx.data.robots.forEach(function (r) {
        var gs = r.gate_status || {};
        out += '<li><a href="' + esc(robotPage(ctx.root, r)) + '">' +
          esc(dexId(r)) + ' ' + esc(r.name) + '</a> — ' + esc(r.class) +
          '; gate: ' + esc(VLABEL[gs.status || 'NOT_GATED']) + '</li>';
      });
      return { html: out + '</ul>',
               hits: ctx.data.robots.map(function (r) {
                 return robotHit(r, ctx.root);
               }) };
    },

    passed_list: function (ctx) {
      if (!ctx.data.robots.length) return ctx.noData('app/robots/', 'the Robodex page');
      var passed = ctx.data.robots.filter(function (r) {
        return (r.gate_status || {}).status === 'PASS';
      });
      if (!passed.length) return '<p>No robot in the Robodex has a recorded PASS yet.</p>';
      var out = '<p>' + passed.length + ' of ' + ctx.data.robots.length +
        ' robots hold a recorded gate PASS:</p><ul>';
      passed.forEach(function (r) {
        var runs = (r.gate_status || {}).runs || [];
        var latest = runs[runs.length - 1];
        out += '<li><a href="' + esc(robotPage(ctx.root, r)) + '">' +
          esc(dexId(r)) + ' ' + esc(r.name) + '</a> — ' + runs.length +
          ' recorded run' + (runs.length === 1 ? '' : 's') +
          (latest ? '; latest: ' + esc(runLine(latest)) : '') + '</li>';
      });
      return { html: out + '</ul><p><a href="' + esc(ctx.root + 'app/evidence/') +
        '">See the gate evidence &rarr;</a></p>',
        hits: passed.map(function (r) { return robotHit(r, ctx.root); }) };
    },

    failed_list: function (ctx) {
      if (!ctx.data.robots.length) return ctx.noData('app/robots/', 'the Robodex page');
      var failed = ctx.data.robots.filter(function (r) {
        return (r.gate_status || {}).status === 'FAIL';
      });
      var ungated = ctx.data.robots.filter(function (r) {
        return (r.gate_status || {}).status === 'NOT_GATED';
      });
      var out = '';
      if (failed.length) {
        out += '<p>Recorded gate FAIL:</p><ul>' + failed.map(function (r) {
          var runs = (r.gate_status || {}).runs || [];
          var latest = runs[runs.length - 1];
          return '<li><a href="' + esc(robotPage(ctx.root, r)) + '">' +
            esc(dexId(r)) + ' ' + esc(r.name) + '</a>' +
            (latest ? ' — latest run: ' + esc(runLine(latest)) : '') +
            '. Ask me &lsquo;why did it fail?&rsquo; for the recorded diagnosis.</li>';
        }).join('') + '</ul>';
      } else {
        out += '<p>No robot in the Robodex has a recorded FAIL.</p>';
      }
      if (ungated.length) {
        out += '<p>Not gated yet (no runs, so no verdict): ' + ungated.map(function (r) {
          return '<a href="' + esc(robotPage(ctx.root, r)) + '">' +
            esc(dexId(r)) + ' ' + esc(r.name) + '</a>';
        }).join(', ') + '.</p>';
      }
      return { html: out,
               hits: failed.concat(ungated).map(function (r) {
                 return robotHit(r, ctx.root);
               }) };
    },

    parts_overview: function (ctx) {
      if (!ctx.data.parts.length) return ctx.noData('app/robots/#parts', 'the parts catalogue');
      var byClass = {};
      ctx.data.parts.forEach(function (p) {
        byClass[p.part_class] = (byClass[p.part_class] || 0) + 1;
      });
      var classes = Object.keys(byClass).sort();
      var out = '<p>The parts catalogue holds <strong>' + ctx.data.parts.length +
        ' real parts</strong> in ' + classes.length + ' classes, plus ' +
        ctx.data.templates + ' robot-class templates (reference BOMs):</p><ul>' +
        classes.map(function (c) {
          return '<li>' + esc(c.replace(/_/g, ' ')) + ': ' + byClass[c] + '</li>';
        }).join('') + '</ul>' +
        '<p>Ask me about any part by name — for example &lsquo;What is a TB6612FNG?&rsquo;</p>';
      return out;
    },

    reports_list: function (ctx) {
      var runs = (ctx.data.reports && ctx.data.reports.runs) || [];
      if (!runs.length) return ctx.noData('app/evidence/', 'the Evidence page');
      var out = '<p>' + runs.length + ' recorded gate reports:</p><ul>';
      runs.forEach(function (rep) {
        var doc = rep.doc || {};
        var checks = doc.checks || [];
        var worst = checks.slice().sort(function (a, b) {
          return Number(b.error) - Number(a.error);
        })[0];
        out += '<li><strong>' + esc(rep.title || rep.id) + '</strong> — verdict <strong>' +
          esc(doc.verdict || 'not recorded') + '</strong>' +
          (worst ? '; largest error: ' + esc(worst.name.replace(/_/g, ' ')) + ' ' +
            fmt(worst.error) + esc(worst.unit === 'deg' ? '°' : worst.unit) : '') + '</li>';
      });
      return { html: out + '</ul><p><a href="' + esc(ctx.root + 'app/evidence/') +
        '">Open the Evidence page &rarr;</a></p>',
        hits: [{ kind: 'route', label: 'Open the Evidence page',
                 route: ctx.root + 'app/evidence/' }] };
    }
  };

  /* ---------------- topics ---------------- */

  function scoreTopic(topic, qt) {
    var score = 0, longest = 0;
    (topic.keywords || []).forEach(function (kw) {
      if (phraseIn(qt, kw)) {
        var w = Math.max(2, tokens(kw).length);
        score += w;
        longest = Math.max(longest, tokens(kw).length);
      }
    });
    return { score: score, longest: longest };
  }

  function textAnswer(text, link, root) {
    var out = text.split(/\n\n+/).map(function (para) {
      return '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    if (link) {
      out += '<p><a href="' + esc(root + link.route) + '">' +
        esc(link.label) + ' &rarr;</a></p>';
    }
    return out;
  }

  /* ---------------- the engine ---------------- */

  function createEngine(data) {
    var ctx = {
      data: {
        robots: (data.robots || []).slice().sort(function (a, b) {
          return a.number - b.number;
        }),
        parts: data.parts || [],
        templates: data.templates || 0,
        templateList: data.templateList || [],
        kinds: data.kinds || [],
        reports: data.reports || null
      },
      root: data.root || '',
      noData: function (route, label) {
        return '<p>I couldn&rsquo;t load the recorded catalogue just now, so I can&rsquo;t ' +
          'answer that from data. The full record is on <a href="' +
          esc(this.root + route) + '">' + esc(label) + '</a>.</p>';
      }
    };
    var topics = (data.intents && data.intents.topics) || [];
    var suggestions = (data.intents && data.intents.suggestions) || [];

    function answer(question) {
      var q = String(question || '');
      var qt = tokens(q);
      if (!qt.length) {
        return { html: '<p>Ask me about a robot, a part, or the gate.</p>',
                 chips: suggestions };
      }

      /* 1. robots: strong entity match wins */
      var rHits = findRobots(qt, ctx.data.robots).filter(function (h) {
        return h.score >= 6;
      });
      if (rHits.length === 1) {
        return { html: robotAnswer(rHits[0].robot, qt, ctx.root),
                 hits: [robotHit(rHits[0].robot, ctx.root)] };
      }
      if (rHits.length > 1) {
        return { html: compareAnswer(rHits, ctx.root),
                 hits: rHits.map(function (h) {
                   return robotHit(h.robot, ctx.root);
                 }) };
      }
      var brand = brandAmbiguity(qt, ctx.data.robots);
      if (brand) return { html: brandAnswer(brand, ctx.root),
                          hits: brand.map(function (r) {
                            return robotHit(r, ctx.root);
                          }) };

      /* 2. parts with a confident match beat generic topics */
      var pHits = findParts(q, qt, ctx.data.parts);
      var topPart = pHits.length ? pHits[0] : null;
      if (topPart && topPart.score >= 8) {
        var tied = pHits.filter(function (h) { return h.score === topPart.score; });
        var near = pHits.filter(function (h) {
          return h.score >= topPart.score - 2;
        }).slice(0, 4);
        return { html: tied.length > 1 ? partAmbiguous(tied) : partAnswer(topPart.part),
                 hits: (tied.length > 1 ? tied : near).map(function (h) {
                   return partHit(h.part);
                 }) };
      }

      /* 2.2 build planning: kinds + templates + have-vs-need.
       * "What do I need to build..." plans a build here instead
       * of falling through to word matches or the fallback. */
      var plan = planningAnswer(ctx, q, qt);
      if (plan) return plan;

      /* 2.5 query cards: catalogue filter questions ("show me 4S
       * batteries", "parts with xt60", bare "lidar"). Only fires on a
       * real filter signal and only when it finds something; otherwise
       * the topic/fallback flow below decides as before. */
      var fq = filterPartsQuery(q, qt, ctx.data.parts);
      if (fq) return fq;

      /* 3. intent topics */
      var best = null, bestScore = 0, bestLong = 0;
      topics.forEach(function (t) {
        var s = scoreTopic(t, qt);
        if (s.score > bestScore || (s.score === bestScore && s.score > 0 &&
            s.longest > bestLong)) {
          best = t; bestScore = s.score; bestLong = s.longest;
        }
      });
      if (best && bestScore >= 2) {
        if (best.handler && HANDLERS[best.handler]) {
          var hr = HANDLERS[best.handler](ctx);
          return typeof hr === 'string' ? { html: hr } : hr;
        }
        if (best.answer) return { html: textAnswer(best.answer, best.link, ctx.root) };
      }

      /* 4. weaker part match */
      if (topPart && topPart.score >= 5) {
        var tied2 = pHits.filter(function (h) { return h.score === topPart.score; });
        var near2 = pHits.filter(function (h) {
          return h.score >= topPart.score - 2;
        }).slice(0, 4);
        return { html: tied2.length > 1 ? partAmbiguous(tied2) : partAnswer(topPart.part),
                 hits: (tied2.length > 1 ? tied2 : near2).map(function (h) {
                   return partHit(h.part);
                 }) };
      }

      /* 5. honest fallback, with the nearest topics as suggestions */
      var near = topics.map(function (t) {
        return { t: t, s: scoreTopic(t, qt).score };
      }).filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; }).slice(0, 2);
      var chips = near.length
        ? near.map(function (x) { return (x.t.samples || [])[0]; }).filter(Boolean)
        : suggestions;
      return {
        html: '<p>I don&rsquo;t have that in RobotForge&rsquo;s recorded data, and ' +
          'I&rsquo;d rather say so than guess.</p>' +
          '<p>I can answer about the Robodex robots and their gate verdicts, the ' +
          'parts catalogue, planning a build from a starter kind, how the gate works and its thresholds, and how ' +
          'RobotForge works. Try one of these:</p>',
        chips: chips.length ? chips : suggestions,
        /* The one answer chat.js may route to a live model when a
         * deployment configures one: the local engine honestly
         * could not answer from recorded data. */
        fallback: true
      };
    }

    return { answer: answer, suggestions: suggestions, CONFIG: CONFIG };
  }

  var ForgeGuide = {
    CONFIG: CONFIG,
    normalize: normalize,
    tokens: tokens,
    phraseIn: phraseIn,
    slugify: slugify,
    createEngine: createEngine,
    HANDLERS: HANDLERS
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ForgeGuide;
  }
  global.ForgeGuide = ForgeGuide;
})(typeof window !== 'undefined' ? window : this);
