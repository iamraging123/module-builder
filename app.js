'use strict';

// Pages are rendered at SCALE px per PDF point; crops are shown at ZOOM css px per point.
const SCALE = 2.5, ZOOM = 1.75, PT = SCALE;

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nos = s => String(s).replace(/\s+/g, '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const TAXONOMY = {
  'Reading and Writing': {
    'Information and Ideas': ['Central Ideas and Details', 'Command of Evidence', 'Inferences'],
    'Craft and Structure': ['Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections'],
    'Expression of Ideas': ['Rhetorical Synthesis', 'Transitions'],
    'Standard English Conventions': ['Boundaries', 'Form, Structure, and Sense'],
  },
  'Math': {
    'Algebra': ['Linear equations in one variable', 'Linear functions', 'Linear equations in two variables', 'Systems of two linear equations in two variables', 'Linear inequalities in one or two variables'],
    'Advanced Math': ['Nonlinear functions', 'Nonlinear equations in one variable and systems of equations in two variables', 'Equivalent expressions'],
    'Problem-Solving and Data Analysis': ['Ratios, rates, proportional relationships, and units', 'Percentages', 'One-variable data: Distributions and measures of center and spread', 'Two-variable data: Models and scatterplots', 'Probability and conditional probability', 'Inference from sample statistics and margin of error', 'Evaluating statistical claims: Observational studies and experiments'],
    'Geometry and Trigonometry': ['Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles'],
  },
};
// The PDF text layer has stray spaces ("Algebr a"), so names are matched with whitespace removed.
const CANON = new Map();
for (const [sec, doms] of Object.entries(TAXONOMY)) {
  for (const [dom, skills] of Object.entries(doms)) {
    CANON.set(nos(dom).toLowerCase(), dom);
    for (const sk of skills) CANON.set(nos(sk).toLowerCase(), sk);
  }
}
for (const d of ['Easy', 'Medium', 'Hard']) CANON.set(d.toLowerCase(), d);
const canon = s => CANON.get(nos(s).toLowerCase()) || s.replace(/\s+/g, ' ').trim();

// ---------- storage ----------
// Two homes for the database. Run locally with server.py, it lives in the data folder next to the app.
// On the hosted site (GitHub Pages) there is no server, so it lives in this browser's IndexedDB.
// "?browser" in the address forces browser storage, for testing the hosted mode locally.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !new URLSearchParams(location.search).has('browser');
let backend = 'server';
// Inside a preview frame (a Claude artifact) the browser blocks file downloads, so backup export is unavailable there.
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();
const where = () => backend === 'browser' ? 'in this browser' : 'in the data folder next to this app';
let bdbp;
function browserDb() {
  return bdbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('module-builder-browser', 1);
    r.onupgradeneeded = () => { for (const s of ['questions', 'modules', 'attempts']) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb(store, mode, fn) {
  const d = await browserDb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
async function api(method, path, body) {
  const r = await fetch(path, {
    method, body: body && JSON.stringify(body),
    headers: { 'X-Module-Builder': '1', 'Content-Type': 'application/json' },
    keepalive: !!body && path.startsWith('/api/attempts'),   // lets the last save finish when the tab closes
  });
  if (!r.ok) throw new Error(`${method} ${path} failed (${r.status})`);
  return r.json();
}
const put = (store, v) => (backend === 'browser' ? idb(store, 'readwrite', o => o.put(v)) : api('PUT', `/api/${store}/${v.id}`, v)).catch(saveFailed);
const del = (store, id) => backend === 'browser' ? idb(store, 'readwrite', o => o.delete(id)) : api('DELETE', `/api/${store}/${id}`);
function saveFailed(err) {
  console.error(err);
  S.notice = backend === 'browser' ? 'Could not save in this browser. It may be out of storage space, or blocking site data.' : 'Could not save. Is the Module Builder window (the server) still open?';
  S.noticeErr = true;
}
const toDataUrl = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
const cropsOf = q => ({ stem: q.stem, answer: q.answerImg, rationale: q.rationale, c0: q.choices[0], c1: q.choices[1], c2: q.choices[2], c3: q.choices[3] });
// On disk, records keep only each image's size and the URL follows from the question id.
// In the browser, the images are stored inside the record and shown through object URLs.
function hydrate(q) {
  if (q.kind === 'text') return q;
  for (const [name, c] of Object.entries(cropsOf(q))) {
    if (!c) continue;
    c.url = backend === 'browser' ? URL.createObjectURL(c.blob) : `data/questions/${q.id}/${name}.png?v=${q.updatedAt}`;
  }
  return q;
}
async function saveQuestion(q) {
  if (backend === 'browser') {
    const rec = structuredClone({ ...q, updatedAt: Date.now() });
    for (const c of Object.values(cropsOf(rec))) if (c) delete c.url;
    await idb('questions', 'readwrite', o => o.put(rec));
    return hydrate(rec);
  }
  // Questions imported from a JSON set are plain text and are stored as they are.
  if (q.kind === 'text') { const meta = { ...q, updatedAt: Date.now() }; await api('PUT', `/api/questions/${q.id}`, { meta, images: {} }); return meta; }
  const images = {}, size = c => c && { w: c.w, h: c.h };
  for (const [name, c] of Object.entries(cropsOf(q))) if (c) images[name] = await toDataUrl(c.blob);
  const meta = { ...q, updatedAt: Date.now(), stem: size(q.stem), answerImg: size(q.answerImg), rationale: size(q.rationale), choices: q.choices.map(size) };
  await api('PUT', `/api/questions/${q.id}`, { meta, images });
  return hydrate(meta);
}

// ---------- state ----------
const S = {
  questions: new Map(), modules: [], attempts: [],
  view: 'home', busy: '', notice: '', noticeErr: false,
  filter: { section: '', diff: new Set(), skills: new Set(), status: 'any' },
  skillsOpen: false,
  form: { mode: 'test', count: null, minutes: null, timed: true, shuffle: false },
  cur: null, elim: false, nav: false, clockHidden: false, ref: false,
  rev: null,
  todayN: (() => { try { return +localStorage.getItem('mb-today-n') || 10; } catch { return 10; } })(),
  plan: null, anotherSet: false, mistakeFilter: '', showCleared: false, skillSel: null, skillsOpen: false,
};

// ---------- PDF import ----------
function toLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const L = lines.at(-1);
    if (L && Math.abs(it.y - L.y) < 2 * PT) L.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    L.text = L.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    L.key = nos(L.text);
    L.x = L.items[0].x;
    L.h = Math.max(...L.items.map(i => i.h)) || 10 * PT;
  }
  return lines;
}

async function importPdf(file, progress) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const groups = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: SCALE });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      items.push({ str: it.str, x, y, w: it.width * SCALE, h: Math.hypot(it.transform[2], it.transform[3]) * 10 * SCALE });
      // ^ the export's text matrix scale is a tenth of the font size in points (0.9 for 9pt body text)
    }
    // A page without a "Question ID" line continues the previous question.
    const starts = nos(items.map(i => i.str).join('')).includes('QuestionID:');
    if (starts || !groups.length) groups.push([]);
    groups.at(-1).push({ page, vp, items });
  }
  const out = [], addedAt = Date.now();
  for (const [i, g] of groups.entries()) {
    progress(i + 1, groups.length);
    const q = await buildQuestion(g, file.name);
    if (q) out.push({ ...q, addedAt, seq: i });
  }
  return out;
}

async function buildQuestion(pages, source) {
  // Stack the question's pages into one tall canvas so every region shares one coordinate space.
  const W = Math.round(pages[0].vp.width);
  const H = pages.reduce((s, p) => s + Math.round(p.vp.height), 0);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const items = [];
  let off = 0;
  for (const p of pages) {
    const pc = document.createElement('canvas');
    pc.width = Math.round(p.vp.width); pc.height = Math.round(p.vp.height);
    // intent 'print' makes pdf.js render without requestAnimationFrame, which stalls in a background tab.
    await p.page.render({ canvasContext: pc.getContext('2d'), viewport: p.vp, intent: 'print' }).promise;
    ctx.drawImage(pc, 0, off);
    for (const it of p.items) items.push({ ...it, y: it.y + off });
    off += pc.height;
  }
  const lines = toLines(items);
  const px = ctx.getImageData(0, 0, W, H).data;
  const dark = o => px[o] < 235 || px[o + 1] < 235 || px[o + 2] < 235;
  const ink = new Uint8Array(H);
  const ix0 = Math.round(10 * PT), ix1 = W - Math.round(8 * PT);
  for (let y = 0; y < H; y++) {
    let o = (y * W + ix0) * 4;
    for (let x = ix0; x < ix1; x++, o += 4) if (dark(o)) { ink[y] = 1; break; }
  }

  // Section labels sit at the left margin.
  const left = L => L.x < 26 * PT;
  const find = (pred, after = -1) => lines.findIndex((L, i) => i > after && pred(L));
  const iId = find(L => L.key.startsWith('QuestionID:'));
  if (iId < 0) return null;
  const id = lines[iId].key.slice('QuestionID:'.length);
  const iQ = find(L => left(L) && L.key === 'Question', iId);
  if (iQ < 0 || !id) return null;
  const iR = find(L => left(L) && L.key === 'Rationale', iQ);
  const iC = find(L => left(L) && L.key.startsWith('CorrectAnswer:'), iQ);
  const iA = find(L => left(L) && L.key === 'Answer', iQ);

  // Header table: map each value to the column whose heading starts at or before it.
  const meta = ['', '', '', '', ''];
  const iH = find(L => L.key.startsWith('AssessmentTest'), iId);
  if (iH >= 0 && iH < iQ) {
    const words = ['Assessment', 'Test', 'Domain', 'Skill', 'Difficulty'], starts = [];
    let acc = 0, wi = 0, target = 0;
    for (const it of lines[iH].items) {
      const len = nos(it.str).length;
      while (wi < 5 && target < acc + len) { starts.push(it.x + (target - acc) / len * it.w); target += words[wi].length; wi++; }
      acc += len;
    }
    if (starts.length === 5) {
      for (const L of lines.slice(iH + 1, iQ)) for (const it of L.items) {
        let c = 0;
        for (let k = 0; k < 5; k++) if (starts[k] <= it.x + 6 * PT) c = k;
        meta[c] += ' ' + it.str;
      }
    }
  }
  const testKey = nos(meta[1]).toLowerCase();
  let section = testKey.includes('math') ? 'Math' : testKey.includes('reading') ? 'Reading and Writing' : '';
  const domain = canon(meta[2]), skill = canon(meta[3]), difficulty = canon(meta[4]);
  if (!section) section = Object.keys(TAXONOMY).find(s => TAXONOMY[s][domain]) || 'Other';

  // Answer choices: four left-margin lines starting A. B. C. D. in order.
  const endIdx = iC >= 0 ? iC : iR >= 0 ? iR : lines.length;
  let choiceLines = [];
  for (let i = (iA >= 0 ? iA : iQ) + 1; i < endIdx && choiceLines.length < 4; i++) {
    if (left(lines[i]) && lines[i].key.startsWith('ABCD'[choiceLines.length] + '.')) choiceLines.push(lines[i]);
  }
  if (choiceLines.length !== 4) choiceLines = [];

  const below = L => Math.round(L.y + 0.35 * L.h);
  const above = L => Math.round(L.y - 1.05 * L.h);
  // Boundary between two labelled blocks: the lowest blank band that is about as tall as the tallest one.
  // (Text choices have even line gaps, so the lowest wins; a tall fraction has only hairline gaps inside it.)
  const splitBetween = (prev, next) => {
    const ya = Math.round(prev.y + 0.3 * prev.h), yb = Math.round(next.y - 0.3 * next.h);
    const runs = [];
    for (let y = ya; y < yb;) {
      if (ink[y]) { y++; continue; }
      let e = y; while (e < yb && !ink[e]) e++;
      runs.push([y, e]); y = e;
    }
    if (!runs.length) return above(next);
    const big = Math.max(...runs.map(r => r[1] - r[0]));
    const r = runs.filter(r => r[1] - r[0] >= 0.6 * big).at(-1);
    return Math.round((r[0] + r[1]) / 2);
  };

  async function crop(y0, y1, opt = {}) {
    y0 = Math.max(0, y0); y1 = Math.min(H, y1);
    while (y0 < y1 && !ink[y0]) y0++;
    while (y1 > y0 && !ink[y1 - 1]) y1--;
    if (y1 <= y0) return null;
    // Collapse page-break sized blank bands.
    const maxGap = Math.round(30 * PT), keep = Math.round(6 * PT), segs = [];
    let s = y0;
    for (let y = y0; y < y1;) {
      if (ink[y]) { y++; continue; }
      let e = y; while (e < y1 && !ink[e]) e++;
      if (e - y > maxGap) { segs.push([s, y + keep]); s = e - keep; }
      y = e;
    }
    segs.push([s, y1]);
    const xa = Math.round(opt.x0 ?? 14 * PT), xb = ix1;
    let xmin = W, xmax = -1;
    for (const [a, b] of segs) for (let y = a; y < b; y++) {
      if (!ink[y]) continue;
      for (let x = xa; x < xb; x++) if (dark((y * W + x) * 4)) { if (x < xmin) xmin = x; break; }
      for (let x = xb - 1; x >= xa; x--) if (dark((y * W + x) * 4)) { if (x > xmax) xmax = x; break; }
    }
    if (xmax < xmin) return null;
    const pad = 6, xl = opt.trimLeft ? xmin : xa;
    const out = document.createElement('canvas');
    out.width = xmax - xl + 1 + pad * 2;
    out.height = segs.reduce((n, [a, b]) => n + b - a, 0) + pad * 2;
    const o = out.getContext('2d');
    o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
    let dy = pad;
    for (const [a, b] of segs) { o.drawImage(cv, xl, a, xmax - xl + 1, b - a, pad, dy, xmax - xl + 1, b - a); dy += b - a; }
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    return { blob, w: out.width, h: out.height };
  }

  const endL = iC >= 0 ? lines[iC] : iR >= 0 ? lines[iR] : null;
  const bodyEnd = endL ? above(endL) : H;
  let stemEnd = bodyEnd;
  const choices = [];
  if (choiceLines.length) {
    stemEnd = iA >= 0 ? above(lines[iA]) : splitBetween(lines[iQ], choiceLines[0]);
    // The letter is drawn by the UI, so cut each choice just right of its "A." label.
    const base = choiceLines[0].items[0].x + 10 * PT;
    const bounds = [iA >= 0 ? below(lines[iA]) : stemEnd];
    for (let i = 1; i < 4; i++) bounds.push(splitBetween(choiceLines[i - 1], choiceLines[i]));
    bounds.push(bodyEnd);
    for (let i = 0; i < 4; i++) {
      const L = choiceLines[i];
      let cut = Math.round(base), best = Infinity;
      for (let x = Math.round(base - 1.2 * PT); x <= base + 0.4 * PT; x++) {
        let blank = true;
        for (let y = Math.round(L.y - 0.8 * L.h); y < L.y + 0.25 * L.h && blank; y++) if (dark((y * W + x) * 4)) blank = false;
        if (blank && Math.abs(x - base) < best) { best = Math.abs(x - base); cut = x; }
      }
      choices.push(await crop(bounds[i], bounds[i + 1], { x0: cut, trimLeft: true }));
    }
  }
  const stem = await crop(below(lines[iQ]), stemEnd);
  if (!stem) return null;
  const answerImg = iC >= 0 ? await crop(above(lines[iC]), iR >= 0 ? above(lines[iR]) : H) : null;
  const rationale = iR >= 0 ? await crop(below(lines[iR]), H) : null;

  // Answer key: the "Correct Answer:" line, or the opening of the rationale on older questions.
  const ratText = iR >= 0 ? lines.slice(iR + 1).map(L => L.text).join(' ') : '';
  const raw = (iC >= 0 ? lines[iC].key.slice('CorrectAnswer:'.length) : '').replace(/[−–]/g, '-');
  const type = choices.length === 4 && choices.every(Boolean) ? 'mc' : 'spr';
  let correct = null, accepted = [];
  if (type === 'mc') {
    const m = /^[A-D]$/.exec(raw) || /Choice\s*([A-D])\s*is\s*(?:the\s*)?(?:corr\s*ect|best)/i.exec(ratText);
    correct = m ? m[1] || m[0] : null;
  } else {
    let r = raw;
    if (!r) {
      const m = /corr\s*ect\s*answer\s*is\s*([-−]?[\d\s.,\/]*\d)\s*\./i.exec(ratText);
      if (m) r = nos(m[1]).replace(/−/g, '-');
    }
    accepted = r.split(',').filter(t => !isNaN(parseNum(t)));
    correct = accepted.length ? accepted.join(' or ') : null;
  }
  return { id, source, section, domain, skill, difficulty, type, correct, accepted, stem, choices: type === 'mc' ? choices : [], answerImg, rationale };
}

// ---------- grading ----------
function parseNum(s) {
  s = nos(s).replace(/[−–]/g, '-');
  const m = /^(-?)(\d+)\/(\d+)$/.exec(s);
  if (m) return +m[3] ? (m[1] ? -1 : 1) * m[2] / m[3] : NaN;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : NaN;
}
function gradeSpr(input, accepted) {
  const u = parseNum(input);
  if (isNaN(u)) return false;
  const s = nos(input), dec = (s.split('.')[1] || '').length;
  return accepted.some(a => {
    const v = parseNum(a);
    if (isNaN(v)) return false;
    if (Math.abs(u - v) < 1e-9) return true;
    // A long decimal may be truncated or rounded (2/3 as .666 or .667), but not shortened further.
    if (s.includes('/') || dec < 3) return false;
    const f = 10 ** dec;
    return Math.abs(u - Math.trunc(v * f) / f) < 1e-9 || Math.abs(u - Math.round(v * f) / f) < 1e-9;
  });
}
// true / false, or null when there is no readable key and the user has not marked it yet.
function grade(q, a) {
  const v = a.answers[q.id];
  if (v == null || v === '') return false;
  if (q.type === 'mc') return q.correct ? v === q.correct : a.self[q.id] ?? null;
  return q.accepted.length ? gradeSpr(v, q.accepted) : a.self[q.id] ?? null;
}
const attemptQs = a => a.qids.map(id => S.questions.get(id)).filter(Boolean);
// Questions that count toward a score: all of them in a test, only the checked ones in a study session.
const counted = a => attemptQs(a).filter(q => a.mode !== 'study' || a.checked[q.id]);
function tally(a) {
  const qs = counted(a);
  let c = 0, p = 0;
  for (const q of qs) { const g = grade(q, a); if (g === true) c++; else if (g === null) p++; }
  return { n: qs.length, c, p };
}
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function defaultSeconds(qs) {
  let s = 0;
  for (const q of qs) s += q.section === 'Math' ? 35 * 60 / 22 : 32 * 60 / 27;
  return Math.max(60, Math.round(s / 60) * 60);
}

// ---------- module building ----------
// Per question, across every finished attempt: how many times it was wrong, and the latest result.
function history() {
  const h = new Map();
  // Study sessions count as soon as an answer is checked, even if the session is never finished.
  const when = a => a.finishedAt || a.startedAt;
  for (const a of S.attempts.filter(a => a.finishedAt || a.mode === 'study').sort((x, y) => when(x) - when(y))) {
    for (const q of counted(a)) {
      const g = grade(q, a);
      if (g === null) continue;
      const r = h.get(q.id) || { wrong: 0, last: null };
      if (!g) r.wrong++;
      r.last = g;
      h.set(q.id, r);
    }
  }
  return h;
}
// 'missed' = wrong (or omitted) the last time it was answered; 'ever' = wrong at least once, even if fixed since.
// Accuracy per skill and per domain over every answer that counted (each time a question was answered, not just the latest).
function accuracy() {
  const by = { skill: new Map(), domain: new Map(), section: new Map(), diff: new Map(), total: { n: 0, c: 0 } };
  const add = (map, k, g) => { const r = map.get(k) || { n: 0, c: 0 }; r.n++; if (g) r.c++; map.set(k, r); };
  for (const a of S.attempts.filter(a => a.finishedAt || a.mode === 'study')) {
    for (const q of counted(a)) {
      const g = grade(q, a);
      if (g === null) continue;
      add(by.skill, q.skill, g); add(by.domain, q.domain, g); add(by.section, q.section, g);
      add(by.diff, `${q.section}|${q.difficulty}`, g);
      by.total.n++; if (g) by.total.c++;
    }
  }
  return by;
}
const STATUS = {
  unseen: (h, q) => !h.has(q.id),
  missed: (h, q) => h.get(q.id)?.last === false,
  ever: (h, q) => h.get(q.id)?.wrong > 0,
};
function matching() {
  const f = S.filter, h = f.status === 'any' ? null : history();
  return [...S.questions.values()].filter(q =>
    (!f.section || q.section === f.section) &&
    (!f.diff.size || f.diff.has(q.difficulty)) &&
    (!f.skills.size || f.skills.has(q.skill)) &&
    (!h || STATUS[f.status](h, q)));
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const sectionOf = qs => { const s = new Set(qs.map(q => q.section)); return s.size === 1 ? [...s][0] : 'Mixed'; };

// mode 'test' = Bluebook-style module graded at the end; 'study' = one question at a time, checked as you go.
// extra: { today, kinds, auto } for sets the app builds itself.
async function createModule(qs, name, seconds, mode = 'test', extra = {}) {
  const m = { ...extra, id: uid(), name, mode, qids: qs.map(q => q.id), seconds: mode === 'study' ? null : seconds, section: sectionOf(qs), createdAt: Date.now() };
  await put('modules', m);
  S.modules.push(m);
  return m;
}
async function startAttempt(m) {
  const qids = m.qids.filter(id => S.questions.has(id));
  if (!qids.length) { S.notice = 'That module has no questions left in the bank.'; S.noticeErr = true; return render(); }
  const a = { id: uid(), moduleId: m.id, name: m.name, mode: m.mode || 'test', checked: {}, checkedAt: {}, why: {}, section: m.section, qids, seconds: m.seconds, remaining: m.seconds, elapsed: 0, idx: 0, answers: {}, marked: {}, struck: {}, self: {}, startedAt: Date.now(), finishedAt: null };
  await put('attempts', a);
  S.attempts.push(a);
  openAttempt(a);
}
function openAttempt(a) {
  S.cur = a; S.elim = false; S.nav = false; S.ref = false; S.view = a.mode === 'study' ? 'study' : 'test';
  startTimer();
  render();
}
let tick = null;
function startTimer() {
  clearInterval(tick);
  // Count wall-clock seconds: browsers slow timers down in background tabs.
  let n = 0, last = Date.now();
  tick = setInterval(() => {
    const a = S.cur, dt = Math.floor((Date.now() - last) / 1000);
    if (!a || a.finishedAt || dt < 1) return;
    last += dt * 1000;
    a.elapsed += dt;
    // Study mode also times each question, until its answer is checked.
    if (a.mode === 'study') { const id = a.qids[a.idx]; a.qtime ||= {}; if (!a.checked[id]) a.qtime[id] = (a.qtime[id] || 0) + dt; }
    if (a.remaining != null && (a.remaining -= dt) <= 0) { a.remaining = 0; return submit(); }
    updateClock();
    if (++n % 5 === 0) put('attempts', a);
  }, 250);
}
function updateClock() {
  const el = $('#clock'), a = S.cur;
  if (!el || !a) return;
  if (a.mode === 'study') {
    el.textContent = S.clockHidden ? '' : `${fmtTime(a.qtime?.[a.qids[a.idx]] || 0)} on this question, ${fmtTime(a.elapsed)} in total`;
    return;
  }
  el.textContent = S.clockHidden ? '' : fmtTime(a.remaining ?? a.elapsed);
  el.classList.toggle('low', a.remaining != null && a.remaining < 300);
}
async function submit() {
  const a = S.cur;
  clearInterval(tick);
  // In study mode only checked answers count; a choice that was picked but never checked is dropped.
  if (a.mode === 'study') for (const id of a.qids) if (!a.checked[id]) delete a.answers[id];
  a.finishedAt = Date.now();
  await put('attempts', a);
  S.cur = null; S.rev = { attempt: a, idx: null };
  S.view = 'results';
  render();
}
async function leaveTest() {
  clearInterval(tick);
  if (S.cur) await put('attempts', S.cur);
  S.cur = null; S.view = 'home';
  render();
}

// ---------- review schedule ----------
// A missed question comes back the day after the miss, then 3 days after the next right answer,
// and is cleared after two right answers in a row.
const DAY = 864e5;
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dateKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
function reviewState() {
  const ev = new Map(), why = new Map();
  for (const a of S.attempts.filter(a => a.finishedAt || a.mode === 'study')) {
    for (const q of counted(a)) {
      const g = grade(q, a);
      if (g === null) continue;
      const t = a.checkedAt?.[q.id] || a.finishedAt || a.startedAt;
      if (!ev.has(q.id)) ev.set(q.id, []);
      ev.get(q.id).push({ t, g });
      const w = a.why?.[q.id];
      if (w && (!why.has(q.id) || why.get(q.id).t < t)) why.set(q.id, { ...w, t });
    }
  }
  const out = new Map(), today = startOfDay(Date.now());
  for (const [id, list] of ev) {
    list.sort((x, y) => x.t - y.t);
    const wrongs = list.filter(e => !e.g).length;
    if (!wrongs) continue;
    let streak = 0;
    for (let i = list.length - 1; i >= 0 && list[i].g; i--) streak++;
    const last = list[list.length - 1];
    const due = startOfDay(last.t) + (streak === 0 ? 1 : 3) * DAY;
    const status = streak >= 2 ? 'cleared' : due <= today ? 'due' : 'later';
    out.set(id, { wrongs, streak, last: last.t, due, status, why: why.get(id) || null });
  }
  return out;
}
const REASONS = {
  rule: 'Didn’t know the rule',
  trap: 'Fell for a trap answer',
  misread: 'Misread the question',
  rushed: 'Rushed or ran out of time',
  slip: 'Careless slip',
};

// ---------- today's set ----------
// The set is built the same way all day (the shuffle is seeded with the date), so reloading doesn't reshuffle it.
function seeded(str) {
  let t = [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ t >>> 15, 1 | t); r ^= r + Math.imul(r ^ r >>> 7, 61 | r); return ((r ^ r >>> 14) >>> 0) / 4294967296; };
}
function shuffleWith(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pctOf = r => Math.round(100 * r.c / r.n);
const level = p => p < 60 ? 'low' : p < 80 ? 'mid' : 'high';
function weakSkills(acc) {
  return [...acc.skill].filter(([k, r]) => r.n >= 3 && pctOf(r) < 80 && [...S.questions.values()].some(q => q.skill === k))
    .sort((x, y) => pctOf(x[1]) - pctOf(y[1]) || y[1].n - x[1].n);
}
function todayPlan(N) {
  const all = [...S.questions.values()], h = history(), rs = reviewState(), acc = accuracy();
  const rnd = seeded(`${dateKey()}|${N}`);
  const used = new Set(), take = (list, n) => { const out = []; for (const q of list) { if (out.length >= n) break; if (!used.has(q.id)) { used.add(q.id); out.push(q); } } return out; };
  const due = take(shuffleWith(all.filter(q => rs.get(q.id)?.status === 'due'), rnd), Math.ceil(N * 0.4));
  const weakList = weakSkills(acc).slice(0, 2);
  const weakNames = weakList.map(([k]) => k);
  const weak = take(shuffleWith(all.filter(q => weakNames.includes(q.skill) && STATUS.unseen(h, q)), rnd), Math.ceil(N * 0.3));
  // New questions, dealt one skill at a time so the set covers as many skills as it can.
  const bySkill = new Map();
  for (const q of shuffleWith(all.filter(q => STATUS.unseen(h, q)), rnd)) { if (!bySkill.has(q.skill)) bySkill.set(q.skill, []); bySkill.get(q.skill).push(q); }
  const fresh = [], decks = shuffleWith([...bySkill.values()], rnd);
  while (due.length + weak.length + fresh.length < N && decks.some(d => d.length)) {
    for (const d of decks) { const q = d.shift(); if (q && !used.has(q.id) && due.length + weak.length + fresh.length < N) { used.add(q.id); fresh.push(q); } }
  }
  // A bank that is mostly answered already tops up with anything not yet in the set.
  const extra = take(shuffleWith(all, rnd), N - due.length - weak.length - fresh.length);
  return { due, weak, weakList, fresh: [...fresh, ...extra], items: [...due.map(q => [q, 'review']), ...weak.map(q => [q, 'weak']), ...fresh.map(q => [q, 'new']), ...extra.map(q => [q, 'new'])] };
}

// ---------- rendering ----------
// One piece of a question: a cropped image from a PDF, or text (passage, prompt, choice, explanation, rule) from a JSON set.
function content(c) {
  if (!c) return '';
  if (c.url) return img(c);
  return `<span class="tq">${c.note ? `<span class="tq-note">Based on ${esc(c.note)}</span>` : ''}${c.passage ? `<span class="tq-passage">${esc(c.passage)}</span>` : ''}${c.text ? `<span class="tq-text">${esc(c.text)}</span>` : ''}${c.rule ? `<span class="tq-rule"><b>Rule:</b> ${esc(c.rule)}</span>` : ''}</span>`;
}
function img(c) {
  if (!c) return '';
  return `<img src="${c.url}" alt="" width="${c.w}" height="${c.h}" style="width:${Math.round(c.w / SCALE * ZOOM)}px">`;
}
const SHELL = ['home', 'practice', 'mistakes', 'skills', 'bank', 'results'];
function render() {
  const views = { home: viewToday, practice: viewPractice, mistakes: viewMistakes, skills: viewSkills, bank: viewBank, results: viewResults, test: viewTest, study: viewStudy, check: viewCheck, review: viewReview };
  const onMath = (S.view === 'test' || S.view === 'study') && S.cur && S.questions.get(S.cur.qids[S.cur.idx])?.section === 'Math';
  const html = views[S.view]();
  $('#app').innerHTML = SHELL.includes(S.view) ? shell(html) : html + (S.ref && onMath ? refSheet() : '');
  if (S.view === 'test' || S.view === 'study') { updateClock(); const i = $('#spr'); if (i && !i.disabled) i.focus(); }
  if (S.view === 'check') updateClock();
}
const ICONS = {
  home: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  practice: '<path d="M4 3.5h12v13H4z"/><path d="M7 7.5h6M7 10.5h6M7 13.5h3.5"/>',
  mistakes: '<path d="M5.5 3h9v14l-4.5-3-4.5 3z"/><path d="M8.3 7l3.4 3.4M11.7 7l-3.4 3.4"/>',
  skills: '<path d="M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z"/>',
  bank: '<path d="M3 6.5l7-3.5 7 3.5-7 3.5z"/><path d="M3 10l7 3.5 7-3.5M3 13.5l7 3.5 7-3.5"/>',
};
const icon = k => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICONS[k]}</svg>`;
const NAV = [['home', 'Today'], ['practice', 'Practice'], ['mistakes', 'Mistakes'], ['skills', 'Skills'], ['bank', 'Question bank']];
function shell(main) {
  const due = [...reviewState().values()].filter(r => r.status === 'due').length;
  const here = S.view === 'results' ? 'practice' : S.view;
  const nav = NAV.map(([v, label]) => `<button class="nav-i" data-act="go" data-v="${v}" ${here === v ? 'aria-current="page"' : ''}>${icon(v)}<span>${label}</span>${v === 'mistakes' && due ? `<em class="badge" title="${due} due for review">${due}</em>` : ''}</button>`).join('');
  const status = S.busy || S.notice ? `<div class="status ${!S.busy && S.noticeErr ? 'err' : ''}" role="status"><span id="status-text">${esc(S.busy || S.notice)}</span>${S.busy ? '' : '<button class="link" data-act="dismiss">Dismiss</button>'}</div>` : '';
  return `<div class="shell"><nav class="side" aria-label="Main"><div class="brand">Module Builder</div><div class="nav">${nav}</div>
      <div class="side-foot"><span>${S.questions.size ? plural(S.questions.size, 'question') + ' in your bank' : 'Your bank is empty'}</span><button class="btn ghost small" data-act="choose" ${S.busy ? 'disabled' : ''}>Add questions</button></div></nav>
    <main class="main">${status}${main}</main></div><div class="dropveil" aria-hidden="true">Drop to add these questions to your bank</div>`;
}
const shortDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (t = Date.now()) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
// Short names for the test's longest skill names, for tiles and tight spaces.
const SHORT = {
  'Nonlinear equations in one variable and systems of equations in two variables': 'Nonlinear equations',
  'Systems of two linear equations in two variables': 'Systems of linear equations',
  'Linear inequalities in one or two variables': 'Linear inequalities',
  'Ratios, rates, proportional relationships, and units': 'Ratios, rates, units',
  'One-variable data: Distributions and measures of center and spread': 'One-variable data',
  'Two-variable data: Models and scatterplots': 'Two-variable data',
  'Inference from sample statistics and margin of error': 'Sample statistics',
  'Evaluating statistical claims: Observational studies and experiments': 'Statistical claims',
  'Probability and conditional probability': 'Probability',
};
const short = k => SHORT[k] || k;
function seg(act, options, current) {
  return `<div class="seg" role="radiogroup">${options.map(([v, label, n]) => `<button role="radio" aria-checked="${v === current}" data-act="${act}" data-v="${esc(v)}">${esc(label)}${n != null ? `<small>${n}</small>` : ''}</button>`).join('')}</div>`;
}
function tick_(act, val, label, on, extra = '') {
  return `<button class="tick" role="checkbox" aria-checked="${on}" data-act="${act}" data-v="${esc(val)}"><i aria-hidden="true"></i><span>${esc(label)}</span>${extra}</button>`;
}
function accBadge(r) {
  if (!r) return '';
  const p = pctOf(r);
  return `<em class="acc ${level(p)}" title="${r.c} right out of ${r.n} answered">${p}%</em>`;
}
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

// ---------- Today ----------
function stripHtml(items, attempt) {
  return `<div class="strip" role="img" aria-label="${items.length} questions">${items.map(([q, kind], i) => {
    let st = '';
    if (attempt?.checked?.[q.id]) st = grade(q, attempt) === true ? 'ok' : 'bad';
    const now = attempt && !attempt.finishedAt && attempt.idx === i ? 'now' : '';
    return `<i class="slot ${kind} ${st} ${now}" title="${i + 1}. ${esc(short(q.skill))}"></i>`;
  }).join('')}</div>`;
}
const KIND_LABEL = { review: 'Review', weak: 'Weakest skill', new: 'New' };
const stripKey = `<div class="strip-key"><span><i class="k review"></i>Review</span><span><i class="k weak"></i>Weakest skill</span><span><i class="k new"></i>New</span></div>`;
function viewToday() {
  const all = [...S.questions.values()];
  if (S.offline) return `<h1 class="title">The database is not running.</h1><p class="lede">Close this tab, double-click “Start Module Builder.bat”, and use the page it opens.</p>`;
  if (!all.length) return `<p class="eyebrow-date">${longDate()}</p><h1 class="title">Start by adding questions.</h1>
    <p class="lede">Module Builder plans a short study set for you every day from the questions you add, then brings back anything you miss until you’ve got it.</p>
    <ol class="steps"><li>Export a set of questions as a PDF from the <a href="https://satsuiteeducatorquestionbank.collegeboard.org/" target="_blank" rel="noopener">College Board question bank</a>. It’s free.</li><li>Drop the PDF anywhere on this page, or use Add questions.</li><li>Come back here for today’s set.</li></ol>
    <div class="row"><button class="btn" data-act="choose">Add questions</button><button class="link" data-act="choose">Restore a backup</button></div>
    <p class="fine">Everything is saved ${where()}, on this device only.</p>`;

  const key = dateKey();
  const mine = S.modules.filter(m => m.today === key);
  const tAttempts = S.attempts.filter(a => mine.some(m => m.id === a.moduleId));
  const open = tAttempts.find(a => !a.finishedAt);
  const done = tAttempts.filter(a => a.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt)[0];
  let hero;
  if (open) {
    const m = S.modules.find(x => x.id === open.moduleId), items = open.qids.map(id => [S.questions.get(id), m.kinds?.[id] || 'new']).filter(([q]) => q);
    const left = open.qids.filter(id => !open.checked[id]).length;
    hero = `<h1 class="title">Pick up where you stopped.</h1><p class="lede">${left} of ${open.qids.length} questions left in today’s set.</p>${stripHtml(items, open)}${stripKey}
      <div class="row"><button class="btn big" data-act="resume" data-id="${open.id}">Continue today’s set</button></div>`;
  } else if (done && !S.anotherSet) {
    const m = S.modules.find(x => x.id === done.moduleId), items = done.qids.map(id => [S.questions.get(id), m?.kinds?.[id] || 'new']).filter(([q]) => q);
    const t = tally(done);
    hero = `<h1 class="title">Done for today.</h1><p class="lede">${t.c} of ${t.n} right${t.n < done.qids.length ? `, ${done.qids.length - t.n} skipped` : ''}. Anything you missed comes back tomorrow.</p>${stripHtml(items, done)}${stripKey}
      <div class="row"><button class="btn big" data-act="results" data-id="${done.id}">See today’s results</button><button class="link" data-act="another-set">Do another set</button></div>`;
  } else {
    const N = S.todayN, plan = todayPlan(N), hasHistory = accuracy().total.n > 0;
    S.plan = plan;
    const rows = [];
    if (plan.due.length) rows.push(['review', plan.due.length, 'Questions you missed, due again', 'A miss comes back the next day, then 3 days later, and clears after two right answers in a row.']);
    if (plan.weak.length) rows.push(['weak', plan.weak.length, 'Your weakest skills', plan.weakList.map(([k, r]) => `${short(k)} at ${pctOf(r)}% right`).join(', ') + '.']);
    if (plan.fresh.length) rows.push(['new', plan.fresh.length, 'New questions', hasHistory ? `Spread across ${new Set(plan.fresh.map(q => q.skill)).size} skills you haven’t finished seeing.` : 'Answer these and the app learns where you need practice.']);
    hero = `<h1 class="title">Today’s set is ready.</h1>
      <p class="lede">${plural(plan.items.length, 'question')}, about ${Math.max(1, Math.round(defaultSeconds(plan.items.map(([q]) => q)) / 60))} minutes. You check each answer as you go.</p>
      ${stripHtml(plan.items)}${stripKey}
      <div class="row"><button class="btn big" data-act="today-start" ${plan.items.length ? '' : 'disabled'}>Start today’s set</button><span class="sizes"><span class="fine">Size</span>${seg('today-n', [[5, '5'], [10, '10'], [20, '20']].map(([v, l]) => [String(v), l]), String(N))}</span></div>
      <div class="why">${rows.map(([k, n, h, p]) => `<div class="why-row"><b class="n ${k}">${n}</b><div><h3>${h}</h3><p>${esc(p)}</p></div></div>`).join('')}</div>`;
  }
  const others = S.modules.filter(m => !m.today).map(m => [m, S.attempts.find(a => a.moduleId === m.id && !a.finishedAt)]).filter(([, a]) => a).slice(-3).reverse();
  const cont = others.length ? `<section class="block"><h2>Unfinished</h2><div class="list">${others.map(([m, a]) => `<div class="li"><div class="li-main"><div class="li-title">${esc(m.name)}</div><div class="li-meta">${m.mode === 'study' ? 'Study' : 'Test'}, question ${a.idx + 1} of ${a.qids.length}</div></div><button class="btn ghost small" data-act="resume" data-id="${a.id}">Resume</button></div>`).join('')}</div></section>` : '';
  return `<p class="eyebrow-date">${longDate()}</p>${hero}${cont}`;
}

// ---------- Practice ----------
function viewPractice() {
  const all = [...S.questions.values()], f = S.filter;
  if (!all.length) return `<h1 class="title">Practice</h1><p class="lede">Add questions to your bank first, then build modules from them here.</p><div class="row"><button class="btn" data-act="choose">Add questions</button></div>`;
  const secs = [...new Set(all.map(q => q.section))];
  const inSec = all.filter(q => !f.section || q.section === f.section);
  const count = (key, v) => inSec.filter(q => q[key] === v).length;
  const diffs = ['Easy', 'Medium', 'Hard'].filter(d => count('difficulty', d));
  const hist = history(), statusCount = k => inSec.filter(q => STATUS[k](hist, q)).length;
  const doms = new Map();
  for (const q of inSec) { if (!doms.has(q.domain)) doms.set(q.domain, new Set()); doms.get(q.domain).add(q.skill); }
  const qs = matching(), acc = accuracy();
  const n = Math.min(S.form.count ?? qs.length, qs.length);
  const mins = S.form.minutes ?? Math.round(defaultSeconds(qs.slice(0, n)) / 60);
  const filtered = f.section || f.diff.size || f.skills.size || f.status !== 'any';
  const study = S.form.mode === 'study';
  let h = `<h1 class="title">Practice</h1><p class="lede">Build a module from your bank: a timed test like the real thing, or a study session that checks each answer.</p><div class="builder">`;
  if (secs.length > 1) h += `<div class="field"><span class="lab">Section</span>${seg('f-section', [['', 'Both', all.length], ...secs.map(x => [x, x, all.filter(q => q.section === x).length])], f.section)}</div>`;
  if (diffs.length > 1) h += `<div class="field"><span class="lab">Difficulty</span><div class="ticks">${diffs.map(d => tick_('f-diff', d, d, f.diff.has(d), `<small>${count('difficulty', d)}</small>`)).join('')}</div></div>`;
  if (hist.size) h += `<div class="field"><span class="lab">History</span>${seg('f-status', [['any', 'Any'], ['unseen', 'New to me', statusCount('unseen')], ['missed', 'Still missed', statusCount('missed')], ['ever', 'Ever missed', statusCount('ever')]], f.status)}</div>`;
  h += `<div class="field"><span class="lab">Skills</span><div><div class="row tight"><span>${f.skills.size ? plural(f.skills.size, 'skill') + ' chosen' : 'Any skill'}</span><button class="link" data-act="skills-toggle" aria-expanded="${!!S.skillsOpen}">${S.skillsOpen ? 'Hide the list' : 'Choose skills'}</button></div>
    ${S.skillsOpen ? `<div class="skill-list">${[...doms].map(([d, sk]) => `<div class="dom"><button class="dom-name" data-act="f-domain" data-v="${esc(d)}" title="Choose or clear every skill in ${esc(d)}">${esc(d)}</button>${[...sk].map(x => tick_('f-skill', x, x, f.skills.has(x), `<small>${count('skill', x)}</small>${accBadge(acc.skill.get(x))}`)).join('')}</div>`).join('')}</div>` : ''}</div></div>`;
  h += `<div class="field"><span class="lab">Mode</span><div class="modes" role="radiogroup">
      <button class="mode" role="radio" aria-checked="${!study}" data-act="f-mode" data-v="test"><b>Test</b><span>Timed like the real thing. You see your score and answers at the end.</span></button>
      <button class="mode" role="radio" aria-checked="${study}" data-act="f-mode" data-v="study"><b>Study</b><span>No clock pressure. Check each answer as you go and read why.</span></button></div></div>`;
  h += `<div class="go"><p class="match">${qs.length ? `${plural(qs.length, 'question')} match${qs.length === 1 ? 'es' : ''}` : 'No questions match these filters.'}${filtered ? ` <button class="link" data-act="clear-filters">Clear filters</button>` : ''}</p>
    ${qs.length ? `<div class="opts"><label for="m-count">Use <input class="num" id="m-count" type="number" min="1" max="${qs.length}" value="${n}"> of them</label>
      <label class="check" for="m-shuffle"><input type="checkbox" id="m-shuffle" ${S.form.shuffle ? 'checked' : ''}> Shuffle</label>
      ${study ? '' : `<span class="check"><label class="check" for="m-timed"><input type="checkbox" id="m-timed" ${S.form.timed ? 'checked' : ''}> Timed</label><label for="m-min"><input class="num" id="m-min" type="number" min="1" value="${mins}" ${S.form.timed ? '' : 'disabled'}> min</label></span>`}</div>
    <button class="btn big" data-act="create">${study ? 'Start studying' : 'Start the test'}</button>` : ''}</div></div>`;

  {
    const rows = S.modules.map(m => {
      const mine = S.attempts.filter(a => a.moduleId === m.id);
      return { m, open: mine.find(a => !a.finishedAt), last: mine.filter(a => a.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt)[0] };
    }).filter(r => !r.m.auto || r.open).sort((a, b) => !!b.open - !!a.open || b.m.createdAt - a.m.createdAt);
    if (rows.length) h += `<section class="block"><h2>Your modules</h2><div class="list">${rows.map(({ m, open, last }) => {
      const t = last && tally(last);
      const state = open ? `On question ${open.idx + 1} of ${open.qids.length}` : !t ? 'Not started' : t.n ? `Last score ${t.c}/${t.n}` : 'Nothing answered last time';
      return `<div class="li"><div class="li-main"><div class="li-title">${esc(m.name)}</div><div class="li-meta">${plural(m.qids.length, 'question')}, ${m.mode === 'study' ? 'study' : m.seconds ? Math.round(m.seconds / 60) + ' min test' : 'untimed test'}, ${shortDate(m.createdAt)}. ${state}.</div></div>
        <div class="li-acts">${last ? `<button class="link" data-act="results" data-id="${last.id}">Results</button>` : ''}<button class="link danger" data-act="del-module" data-id="${m.id}">Delete</button>
        <button class="btn ${open ? '' : 'ghost'} small" data-act="${open ? 'resume' : 'start'}" data-id="${open ? open.id : m.id}">${open ? 'Resume' : !last ? 'Start' : m.mode === 'study' ? 'Study again' : 'Retake'}</button></div></div>`;
    }).join('')}</div></section>`;
  }
  return h;
}
// Modules name themselves after the filters that built them, for example "Hard Math, Linear functions".
function moduleName(qs) {
  const f = S.filter, sec = sectionOf(qs);
  const head = [{ unseen: 'New', missed: 'Still missed', ever: 'Ever missed' }[f.status], f.diff.size ? ['Easy', 'Medium', 'Hard'].filter(d => f.diff.has(d)).join(' and ') : '', sec === 'Mixed' ? 'Both sections' : sec].filter(Boolean).join(' ');
  const skills = [...new Set(qs.map(q => q.skill))];
  return head + (f.skills.size ? `, ${skills.length === 1 ? short(skills[0]) : plural(skills.length, 'skill')}` : '');
}

// ---------- Mistakes ----------
function viewMistakes() {
  const rs = reviewState();
  const items = [...rs].map(([id, r]) => [S.questions.get(id), r]).filter(([q]) => q);
  if (!items.length) return `<h1 class="title">Mistakes</h1><p class="lede">Nothing here yet. Every question you get wrong lands here, comes back for review the next day, and clears after two right answers in a row.</p>`;
  const due = items.filter(([, r]) => r.status === 'due'), later = items.filter(([, r]) => r.status === 'later'), cleared = items.filter(([, r]) => r.status === 'cleared');
  const open = [...due, ...later];
  const counts = Object.keys(REASONS).map(k => [k, open.filter(([, r]) => r.why?.reason === k).length]).filter(([, n]) => n);
  const untagged = open.filter(([, r]) => !r.why?.reason).length;
  const f = S.mistakeFilter;
  const show = list => list.filter(([, r]) => !f || (f === 'none' ? !r.why?.reason : r.why?.reason === f));
  const row = ([q, r]) => `<div class="li mistake ${r.why?.reason ? 'r-' + r.why.reason : ''}">
      <div class="li-main"><div class="li-title">${esc(short(q.skill))}</div>
        <div class="li-meta">${esc([q.section, q.difficulty, q.source].filter(Boolean).join(', '))}</div>
        <div class="li-meta">Missed ${r.wrongs === 1 ? 'once' : `${r.wrongs} times`}, last answered ${shortDate(r.last)}.${r.streak ? ` Right ${r.streak === 1 ? 'once' : 'twice'} since.` : ''}</div>
        ${r.why ? `<p class="why-note"><mark class="r-${r.why.reason}">${esc(REASONS[r.why.reason] || '')}</mark>${r.why.note ? ` ${esc(r.why.note)}` : ''}</p>` : ''}</div>
      <div class="li-acts"><span class="when ${r.status}">${r.status === 'due' ? 'Due now' : r.status === 'later' ? `Back ${shortDate(r.due)}` : 'Cleared'}</span>${r.status === 'cleared' ? '' : `<button class="btn ghost small" data-act="practise-one" data-id="${q.id}">Practise</button>`}</div></div>`;
  let h = `<h1 class="title">Mistakes</h1><p class="lede">${due.length ? `${plural(due.length, 'question')} due for review now` : 'Nothing is due right now'}${later.length ? `, ${later.length} coming back later` : ''}${cleared.length ? `, ${cleared.length} cleared` : ''}.</p>`;
  if (due.length) h += `<div class="row"><button class="btn big" data-act="retest-due">Review the ${due.length} due now</button></div>`;
  if (counts.length) {
    const total = open.length;
    h += `<section class="block"><h2>Why you missed them</h2><div class="reason-bar" role="img" aria-label="Reasons">${counts.map(([k, n]) => `<i class="r-${k}" style="flex:${n}" title="${REASONS[k]}: ${n}"></i>`).join('')}${untagged ? `<i class="r-none" style="flex:${untagged}" title="No reason noted: ${untagged}"></i>` : ''}</div>
      <div class="reason-key">${seg('m-filter', [['', 'All', total], ...counts.map(([k, n]) => [k, REASONS[k], n]), ...(untagged ? [['none', 'No reason noted', untagged]] : [])], f || '')}</div></section>`;
  }
  if (show(due).length) h += `<section class="block"><h2>Due now</h2><div class="list">${show(due).map(row).join('')}</div></section>`;
  if (show(later).length) h += `<section class="block"><h2>Coming back later</h2><div class="list">${show(later).sort((a, b) => a[1].due - b[1].due).map(row).join('')}</div></section>`;
  if (cleared.length && !f) h += `<section class="block"><h2>Cleared</h2>${S.showCleared ? `<div class="list">${cleared.map(row).join('')}</div>` : `<button class="link" data-act="show-cleared">Show ${plural(cleared.length, 'cleared question')}</button>`}</section>`;
  h += `<p class="fine">In study mode, the app asks why you missed a question right after you check it. Your answer shows up here.</p>`;
  return h;
}

// ---------- Skills ----------
// Skills of a section in the official order, followed by any the bank has that the list does not know.
function skillTree(sec, qs) {
  const tree = new Map();
  for (const [d, sks] of Object.entries(TAXONOMY[sec] || {})) tree.set(d, [...sks]);
  for (const q of qs) {
    if (!tree.has(q.domain)) tree.set(q.domain, []);
    if (!tree.get(q.domain).includes(q.skill)) tree.get(q.domain).push(q.skill);
  }
  return [...tree].map(([d, sks]) => [d, sks.filter(k => qs.some(q => q.skill === k))]).filter(([, sks]) => sks.length);
}
function viewSkills() {
  const all = [...S.questions.values()], acc = accuracy(), hist = history(), rs = reviewState();
  if (!all.length) return `<h1 class="title">Skills</h1><p class="lede">Add questions to your bank and answer a few, and every skill on the test shows up here with how you’re doing.</p>`;
  const still = all.filter(q => STATUS.missed(hist, q)).length, seen = all.filter(q => hist.has(q.id)).length;
  const time = S.attempts.reduce((t, a) => t + (a.elapsed || 0), 0);
  const fig = (v, l) => `<div><dd>${v}</dd><dt>${l}</dt></div>`;
  if (!S.skillSel || !all.some(q => q.skill === S.skillSel)) S.skillSel = weakSkills(acc)[0]?.[0] || all[0].skill;
  const tile = k => {
    const r = acc.skill.get(k), p = r ? pctOf(r) : null, step = p == null ? 'none' : `m${Math.min(4, Math.floor(p / 20))}`;
    return `<button class="tile ${step}" data-act="skill-sel" data-v="${esc(k)}" aria-pressed="${S.skillSel === k}" title="${esc(k)}"><span class="t-name">${esc(short(k))}</span><span class="t-pc">${p == null ? 'New' : p + '%'}</span><span class="t-n">${r ? r.n + ' answered' : 'not tried'}</span></button>`;
  };
  const sections = [...new Set(all.map(q => q.section))].map(sec => {
    const qs = all.filter(q => q.section === sec), r = acc.section.get(sec);
    return `<section class="map-sec"><h2>${esc(sec)}<span>${r ? `${pctOf(r)}% right over ${plural(r.n, 'answer')}` : 'No answers yet'}</span></h2>
      <div class="map">${skillTree(sec, qs).map(([d, sks]) => `<div class="map-dom"><h3>${esc(d)}</h3>${sks.map(tile).join('')}</div>`).join('')}</div></section>`;
  }).join('');
  const k = S.skillSel, r = acc.skill.get(k), qs = all.filter(q => q.skill === k);
  const kSeen = qs.filter(q => hist.has(q.id)).length, kDue = qs.filter(q => rs.get(q.id) && rs.get(q.id).status !== 'cleared').length;
  const rules = [...new Set(qs.map(q => q.rationale?.rule).filter(Boolean))];
  const panel = `<aside class="panel" aria-live="polite"><p class="p-dom">${esc(qs[0].domain)}</p><h2>${esc(k)}</h2>
    ${r ? `<div class="p-big"><b>${pctOf(r)}%</b><span>right, ${r.c} of ${r.n}</span></div><div class="mtr"><i class="${level(pctOf(r))}" style="width:${pctOf(r)}%"></i></div>` : '<div class="p-big"><b>New</b><span>no answers yet</span></div>'}
    <dl class="p-facts"><div><dt>Seen</dt><dd>${kSeen} of ${qs.length} in your bank</dd></div><div><dt>Mistakes open</dt><dd>${kDue}</dd></div></dl>
    ${rules.length ? `<h4>Rules from your question sets</h4>${rules.map(t => `<p class="rule">${esc(t)}</p>`).join('')}` : ''}
    <div class="row"><button class="btn" data-act="study-skill" data-v="${esc(k)}" ${qs.length ? '' : 'disabled'}>Study 5 new</button>${kDue ? `<button class="btn ghost" data-act="study-skill-missed" data-v="${esc(k)}">Review ${kDue} missed</button>` : ''}</div></aside>`;
  const finished = S.attempts.filter(a => a.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt);
  return `<h1 class="title">Skills</h1>
    ${acc.total.n ? `<dl class="figs">${fig(acc.total.n, 'Answers checked')}${fig(pctOf(acc.total) + '%', 'Right overall')}${fig(still, 'Still missed')}${fig(`${seen} of ${all.length}`, 'Bank questions seen')}${fig(fmtDuration(time), 'Time practising')}</dl>` : '<p class="lede">Answer some questions and your accuracy fills in here, skill by skill.</p>'}
    <div class="map-key"><span>Percent right</span><span class="ramp"><i class="m0"></i><i class="m1"></i><i class="m2"></i><i class="m3"></i><i class="m4"></i></span><span>0 to 100%</span><span class="none-key"></span><span>Not tried</span></div>
    <div class="skills-layout"><div class="maps">${sections}</div>${panel}</div>
    ${finished.length ? `<section class="block"><h2>Recent sessions</h2><div class="list">${finished.slice(0, 8).map(a => { const t = tally(a); return `<button class="li li-btn" data-act="results" data-id="${a.id}"><div class="li-main"><div class="li-title">${esc(a.name)}</div><div class="li-meta">${a.mode === 'study' ? 'Study' : 'Test'}, ${shortDate(a.finishedAt)}</div></div><span class="score-s">${t.n ? `${t.c}/${t.n}` : '—'}</span></button>`; }).join('')}</div></section>` : ''}`;
}

// ---------- Question bank ----------
function viewBank() {
  const all = [...S.questions.values()];
  const sources = [...new Set(all.map(q => q.source))];
  const by = sec => all.filter(q => q.section === sec).length;
  return `<h1 class="title">Question bank</h1>
    <p class="lede">${all.length ? `${plural(all.length, 'question')}: ${by('Reading and Writing')} Reading and Writing, ${by('Math')} Math.` : 'Your bank is empty.'}</p>
    <button class="drop" data-act="choose"><b>Add questions</b><span>Drop question bank PDFs or JSON question sets here, or click to choose files. A question you already have is updated, not added twice.</span></button>
    <p class="fine">Get PDFs from the <a href="https://satsuiteeducatorquestionbank.collegeboard.org/" target="_blank" rel="noopener">College Board question bank</a>: pick questions, then export them as a PDF.</p>
    ${sources.length ? `<section class="block"><h2>Files</h2><div class="list">${sources.map(x => `<div class="li"><div class="li-main"><div class="li-title" title="${esc(x)}">${esc(x)}</div><div class="li-meta">${plural(all.filter(q => q.source === x).length, 'question')}</div></div><div class="li-acts"><button class="link danger" data-act="del-source" data-v="${esc(x)}">Remove</button></div></div>`).join('')}</div></section>` : ''}
    <section class="block"><h2>Backup</h2><p class="body">Your questions, modules and results are saved ${where()}.${backend === 'browser' ? ' Clearing your browsing data deletes them, so export a backup now and then.' : ''}</p>
      ${FRAMED ? `<p class="fine">Exporting a backup doesn’t work in this preview, because it can’t save files. Open the app at <a href="https://iamraging123.github.io/module-builder/" target="_blank" rel="noopener">iamraging123.github.io/module-builder</a> to export.</p><div class="row"><button class="link" data-act="choose">Restore a backup</button></div>`
        : `<div class="row"><button class="btn ghost" data-act="export" data-v="all">Export everything</button><button class="btn ghost" data-act="export" data-v="results">Export results only</button><button class="link" data-act="choose">Restore a backup</button></div>
      <p class="fine">Everything includes the question images, so the file is large. Results only is small: restore it after adding the same PDFs again.</p>`}</section>`;
}

// ---------- test mode (Bluebook-style) ----------
function topBar(a, tools) {
  return `<div class="bb-top"><div class="bb-title">${esc(a.name)}<small>${esc(a.section || '')}</small></div>
    <div class="bb-timer">${S.cur ? `<span id="clock"></span><button data-act="clock">${S.clockHidden ? 'Show' : 'Hide'}</button>` : ''}</div>
    <div class="bb-tools">${tools || ''}</div></div>`;
}
function navGrid(a, cur) {
  return `<div class="grid">${a.qids.map((id, i) => `<button class="cell ${a.answers[id] ? 'done' : ''} ${a.marked[id] ? 'flag' : ''} ${i === cur ? 'cur' : ''}" data-act="goto" data-i="${i}">${i + 1}</button>`).join('')}</div>`;
}
const legend = `<div class="legend"><span><i class="lg-open"></i>Unanswered</span><span><i class="lg-done"></i>Answered</span><span><i class="lg-flag"></i>For review</span></div>`;
function viewTest() {
  const a = S.cur, qid = a.qids[a.idx], q = S.questions.get(qid), n = a.qids.length;
  const ans = a.answers[qid], struck = a.struck[qid] || [];
  let body;
  if (q.type === 'mc') {
    body = q.choices.map((c, i) => {
      const L = 'ABCD'[i], st = struck.includes(L);
      return `<div class="choice-row"><button class="choice ${ans === L ? 'sel' : ''} ${st ? 'struck' : ''}" data-act="pick" data-l="${L}"><span class="letter">${L}</span>${content(c)}</button>
        ${S.elim ? strikeBtn(L, st) : ''}</div>`;
    }).join('');
  } else {
    body = `<div class="spr"><input id="spr" maxlength="6" autocomplete="off" value="${esc(ans || '')}" aria-label="Your answer">
      <div class="prev">Answer preview: <span id="sprprev">${esc(ans || '')}</span></div>
      <p class="hint">Enter a whole number, decimal or fraction, such as 3.5 or 7/2. Up to 5 characters, or 6 with a minus sign.</p></div>`;
  }
  const tools = `${q.section === 'Math' ? mathTools() : ''}<button data-act="exit">Save and exit</button>`;
  return `<div class="bb">${topBar(a, tools)}
    <div class="bb-body"><div class="pane"><div class="inner"><div class="qbar"><span class="qnum">${a.idx + 1}</span>
        <button class="mark ${a.marked[qid] ? 'on' : ''}" data-act="mark"><i class="flag"></i>${a.marked[qid] ? 'Marked for review' : 'Mark for review'}</button>
        ${q.type === 'mc' ? crossToggle() : ''}</div>
        <div class="stem">${content(q.stem)}</div>${body}</div></div></div>
    <div class="bb-bottom"><span></span><button class="bb-nav" data-act="nav">Question ${a.idx + 1} of ${n} ${S.nav ? '▾' : '▴'}</button>
      <div class="bb-go"><button class="btn ghost" data-act="back" ${a.idx ? '' : 'disabled'}>Back</button><button class="btn" data-act="next">Next</button></div>
      ${S.nav ? `<div class="pop"><h3>${esc(a.name)}</h3>${legend}${navGrid(a, a.idx)}<div class="foot"><button class="btn ghost" data-act="check">Go to the review page</button></div></div>` : ''}</div></div>`;
}
// Math questions get the College Board version of the Desmos calculator (opens in its own tab) and a formula panel.
const DESMOS = 'https://www.desmos.com/testing/cb-digital-sat/graphing';
const mathTools = () => `<a class="tool" href="${DESMOS}" target="_blank" rel="noopener" title="Opens the Desmos graphing calculator used on the digital SAT in a new tab">Calculator</a><button class="tool" data-act="ref" aria-expanded="${S.ref}">Reference</button>`;
// The standard geometry facts given on the test, written out as plain formulas.
const REFERENCE = [
  ['Area and circumference', [['Circle, area', 'A = πr<sup>2</sup>'], ['Circle, circumference', 'C = 2πr'], ['Rectangle', 'A = ℓw'], ['Triangle', 'A = ½bh']]],
  ['Right triangles', [['Pythagorean theorem', 'c<sup>2</sup> = a<sup>2</sup> + b<sup>2</sup>'], ['30°-60°-90° sides', 'x, x√3, 2x'], ['45°-45°-90° sides', 's, s, s√2']]],
  ['Volume', [['Rectangular box', 'V = ℓwh'], ['Cylinder', 'V = πr<sup>2</sup>h'], ['Sphere', 'V = ⁴⁄₃πr<sup>3</sup>'], ['Cone', 'V = ⅓πr<sup>2</sup>h'], ['Pyramid', 'V = ⅓ℓwh']]],
  ['Angles', [['Degrees of arc in a circle', '360'], ['Radians of arc in a circle', '2π'], ['Sum of the angles of a triangle', '180°']]],
];
function refSheet() {
  return `<aside class="ref" role="dialog" aria-label="Reference sheet"><div class="ref-head"><h3>Reference</h3><button class="link" data-act="ref">Close</button></div>
    ${REFERENCE.map(([title, rows]) => `<h4>${title}</h4><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`).join('')}
    <p class="ref-note">In the 30°-60°-90° triangle the sides are listed opposite 30°, 60° and 90°. In the 45°-45°-90° triangle the last side is the hypotenuse.</p></aside>`;
}
// Cross-out: the toggle shows a button beside each choice; right-clicking a choice does the same without the toggle.
const crossToggle = () => `<button class="cross ${S.elim ? 'on' : ''}" data-act="elim" aria-pressed="${S.elim}" title="Show a cross-out button beside each choice. You can also right-click a choice.">Cross out</button>`;
const strikeBtn = (L, st) => `<button class="strike ${st ? 'undo' : ''}" data-act="strike" data-l="${L}" title="${st ? 'Restore' : 'Cross out'} choice ${L}">${st ? 'Undo' : `<s>${L}</s>`}</button>`;

// ---------- study mode: one question, check it, see why, move on ----------
function viewStudy() {
  const a = S.cur, qid = a.qids[a.idx], q = S.questions.get(qid), n = a.qids.length;
  const v = a.answers[qid], done = !!a.checked[qid], g = done ? grade(q, a) : null, last = a.idx === n - 1;
  const seen = a.qids.filter(id => a.checked[id]), right = seen.filter(id => grade(S.questions.get(id), a) === true).length;
  const kind = S.modules.find(m => m.id === a.moduleId)?.kinds?.[qid];
  let body;
  if (q.type === 'mc') {
    body = `<div class="choices">${q.choices.map((c, i) => {
      const L = 'ABCD'[i], st = (a.struck[qid] || []).includes(L);
      const cls = !done ? (v === L ? 'sel' : '') : L === q.correct ? 'correct' : v === L && g === false ? 'wrong' : v === L ? 'sel' : '';
      // Once checked, a crossed-out choice stays crossed unless it turned out to be the answer.
      return `<div class="choice-row"><button class="choice ${cls} ${st && !(done && L === q.correct) ? 'struck' : ''}" data-act="pick" data-l="${L}" ${done ? 'disabled' : ''}><span class="letter">${L}</span>${content(c)}</button>${S.elim && !done ? strikeBtn(L, st) : ''}</div>`;
    }).join('')}</div>`;
  } else {
    body = `<div class="spr"><input id="spr" maxlength="6" autocomplete="off" value="${esc(v || '')}" ${done ? 'disabled' : ''} aria-label="Your answer">
      <span id="sprprev" hidden></span>${done ? '' : '<p class="hint">Enter a whole number, decimal or fraction, such as 3.5 or 7/2.</p>'}</div>`;
  }
  let feedback = '';
  if (done) {
    const key = q.correct ? ` The answer is ${esc(q.correct)}.` : '';
    const w = a.why?.[qid];
    feedback = `<div class="fb ${g === true ? 'ok' : g === false ? 'bad' : 'pend'}"><p class="fb-head">${g === true ? 'Right.' : g === false ? `Not this time.${key}` : 'Compare your answer with the explanation.'}</p>
      ${a.qtime?.[qid] ? `<p class="fb-time">You took ${fmtTime(a.qtime[qid])}.</p>` : ''}
      ${!q.correct ? `${content(q.answerImg)}<div class="row"><span>Did you get it?</span><button class="btn ghost small" data-act="s-self" data-v="1">Yes</button><button class="btn ghost small" data-act="s-self" data-v="0">No</button></div>` : ''}
      ${g === false ? `<div class="whybox"><p class="whyq">Why did you miss it?</p><div class="why-opts">${Object.entries(REASONS).map(([k, label]) => `<button class="why-opt r-${k}" aria-pressed="${w?.reason === k}" data-act="s-why" data-v="${k}">${label}</button>`).join('')}</div>
        <label class="fine" for="why-note">A note for next time (optional)</label><input id="why-note" class="why-note-in" value="${esc(w?.note || '')}" placeholder="What will you look for next time?" autocomplete="off"></div>` : ''}
      ${q.rationale ? `<div class="expl"><h4>Explanation</h4>${content(q.rationale)}</div>` : ''}</div>`;
  }
  const pct = k => `${100 * k / n}%`;
  return `<div class="focus"><header class="focus-bar"><div class="fb-title">${esc(a.name)}</div><span class="fine">${right} right, ${seen.length - right} missed</span><button class="link" data-act="exit">Save and exit</button><button class="btn ghost small" data-act="s-finish">End session</button></header>
    <div class="sprog" title="${right} right, ${seen.length - right} missed"><i class="r" style="width:${pct(right)}"></i><i class="w" style="width:${pct(seen.length - right)}"></i></div>
    <main class="study"><div class="s-meta"><b>Question ${a.idx + 1} of ${n}</b>${kind ? `<span class="kind ${kind}">${KIND_LABEL[kind]}</span>` : ''}<span>${esc([short(q.skill), q.difficulty].filter(Boolean).join(', '))}</span></div>
      <div class="s-tools"><span class="s-clock"><span id="clock"></span><button class="link" data-act="clock">${S.clockHidden ? 'Show timer' : 'Hide timer'}</button></span><span class="s-right">${q.section === 'Math' ? mathTools() : ''}${q.type === 'mc' && !done ? crossToggle() : ''}</span></div>
      <div class="stem">${content(q.stem)}</div>${body}${feedback}
      <div class="s-acts">${done ? `<button class="btn big" data-act="s-next">${last ? 'See how it went' : 'Next question'}</button>` : `<button class="btn big" data-act="s-check" ${v ? '' : 'disabled'}>Check answer</button>${last ? '' : '<button class="link" data-act="s-next">Skip for now</button>'}`}
        ${a.idx ? '<button class="link s-prev" data-act="back">Previous question</button>' : ''}</div></main></div>`;
}
function viewCheck() {
  const a = S.cur, blank = a.qids.filter(id => !a.answers[id]).length;
  return `<div class="bb">${topBar(a, `<button data-act="exit">Save and exit</button>`)}
    <div class="checkpage"><div class="box"><h2>Check your work</h2>
      <p>${blank ? `${plural(blank, 'question')} unanswered. ` : 'Every question is answered. '}Click a number to go back to it, or submit when you’re done.</p>
      <div class="panel-c">${legend}${navGrid(a, -1)}</div></div></div>
    <div class="bb-bottom"><span></span><span></span><div class="bb-go"><button class="btn ghost" data-act="goto" data-i="${a.qids.length - 1}">Back</button><button class="btn" data-act="submit">Submit</button></div></div></div>`;
}

// ---------- results and review ----------
function breakdown(a, key) {
  const m = new Map();
  for (const q of counted(a)) {
    const r = m.get(q[key]) || { n: 0, c: 0 };
    r.n++; if (grade(q, a) === true) r.c++;
    m.set(q[key], r);
  }
  return `<table class="bd">${[...m].map(([k, r]) => `<tr><td>${esc(short(k) || '—')}</td><td class="n">${r.c}/${r.n}</td><td class="b"><div class="mtr"><i class="${level(pctOf(r))}" style="width:${pctOf(r)}%"></i></div></td></tr>`).join('')}</table>`;
}
function verdict(g, v) {
  if (v == null || v === '') return ['skip', 'Skipped'];
  return g === true ? ['ok', 'Right'] : g === false ? ['bad', 'Missed'] : ['pend', 'Check'];
}
function viewResults() {
  const a = S.rev.attempt, t = tally(a), qs = attemptQs(a);
  const missed = counted(a).filter(q => grade(q, a) !== true).length;
  const mod = S.modules.find(m => m.id === a.moduleId);
  const others = S.attempts.filter(x => x.moduleId === a.moduleId && x.finishedAt).sort((x, y) => y.finishedAt - x.finishedAt);
  return `<button class="link back" data-act="go" data-v="${mod?.today ? 'home' : 'practice'}">${mod?.today ? 'Back to Today' : 'Back to Practice'}</button>
    <h1 class="title">${esc(a.name)}</h1><p class="lede">${new Date(a.finishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}, ${fmtDuration(a.elapsed)}${a.seconds ? ` of ${fmtDuration(a.seconds)}` : ''}.</p>
    <div class="score"><b>${t.c}/${t.n}</b><span>${t.n ? pctOf({ c: t.c, n: t.n }) : 0}% right${a.mode === 'study' && t.n < qs.length ? `, ${qs.length - t.n} skipped` : ''}${t.p ? `, ${t.p} to check yourself` : ''}</span></div>
    <div class="row">${missed ? `<button class="btn" data-act="retake-missed">Practise the ${missed} missed</button>` : ''}${mod ? `<button class="btn ghost" data-act="start" data-id="${a.moduleId}">${a.mode === 'study' ? 'Study again' : 'Retake'}</button>` : ''}</div>
    ${others.length > 1 ? `<p class="fine">Earlier attempts: ${others.filter(x => x.id !== a.id).map(x => { const k = tally(x); return `<button class="link" data-act="results" data-id="${x.id}">${k.c}/${k.n} on ${shortDate(x.finishedAt)}</button>`; }).join(', ')}</p>` : ''}
    <section class="block"><h2>Questions</h2><div class="list">${qs.map((q, i) => {
      const [cls, word] = verdict(grade(q, a), a.answers[q.id]);
      return `<button class="li li-btn" data-act="review" data-i="${i}"><span class="qno">${i + 1}</span><span class="res ${cls}">${word}</span><div class="li-main"><div class="li-title">${esc(short(q.skill))}</div><div class="li-meta">${esc([q.section, q.difficulty].filter(Boolean).join(', '))}</div></div></button>`;
    }).join('')}</div></section>
    <div class="cols"><section class="block"><h2>By skill</h2>${breakdown(a, 'skill')}</section><section class="block"><h2>By domain</h2>${breakdown(a, 'domain')}</section></div>`;
}
function viewReview() {
  const a = S.rev.attempt, qs = attemptQs(a), i = S.rev.idx, q = qs[i];
  const v = a.answers[q.id], g = grade(q, a), [cls, word] = verdict(g, v);
  let body;
  if (q.type === 'mc') {
    body = `<div class="choices">${q.choices.map((c, k) => {
      const L = 'ABCD'[k];
      return `<div class="choice-row"><button class="choice ${L === q.correct ? 'correct' : v === L && g === false ? 'wrong' : v === L ? 'sel' : ''}" disabled><span class="letter">${L}</span>${content(c)}</button></div>`;
    }).join('')}</div>`;
  } else {
    body = `<p class="kv">Your answer: <b>${v ? esc(v) : '—'}</b></p>${q.correct ? `<p class="kv">Correct answer: <b>${esc(q.correct)}</b></p>` : ''}`;
  }
  const needSelf = !q.correct && v;
  return `<div class="focus"><header class="focus-bar"><div class="fb-title">${esc(a.name)}</div><span class="fine">Question ${i + 1} of ${qs.length}</span><button class="btn ghost small" data-act="to-results">Back to results</button></header>
    <main class="study"><div class="s-meta"><b class="res ${cls}">${word}</b><span>${esc([short(q.skill), q.difficulty].filter(Boolean).join(', '))}</span></div>
      <div class="stem">${content(q.stem)}</div>${body}
      ${needSelf ? `${content(q.answerImg)}<div class="row"><span>The answer key couldn’t be read for this one. Did you get it?</span><button class="btn ghost small" data-act="self" data-v="1">Yes</button><button class="btn ghost small" data-act="self" data-v="0">No</button></div>` : ''}
      ${q.rationale ? `<div class="expl"><h4>Explanation</h4>${content(q.rationale)}</div>` : ''}
      <div class="s-acts"><button class="btn ghost" data-act="rev-go" data-d="-1" ${i ? '' : 'disabled'}>Previous</button><button class="btn" data-act="rev-go" data-d="1" ${i < qs.length - 1 ? '' : 'disabled'}>Next</button></div></main></div>`;
}

// ---------- confirmations ----------
// An in-page dialog, because the browser's confirm() is blocked when the app runs inside a preview frame.
function ask(text, ok, danger = false) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'ask';
    box.innerHTML = `<div class="ask-card" role="alertdialog" aria-modal="true" aria-labelledby="ask-t"><p id="ask-t">${esc(text)}</p><div class="row end"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    const done = r => { box.remove(); document.removeEventListener('keydown', key, true); resolve(r); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    box.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === box) done(false); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(box);
    box.querySelector('[data-r="1"]').focus();
  });
}

// ---------- actions ----------
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function resetCounts() { S.form.count = null; S.form.minutes = null; }
async function studySet(qs, name, kinds) {
  if (!qs.length) return;
  await startAttempt(await createModule(qs, name, null, 'study', { auto: true, ...(kinds ? { kinds } : {}) }));
}
const A = {
  go: d => { S.view = d.v; S.anotherSet = false; render(); scrollTo(0, 0); },
  home: () => A.go({ v: 'home' }),
  choose: () => $('#file').click(),
  dismiss: () => { S.notice = ''; render(); },
  export: d => exportBackup(d.v === 'all'),

  // Today
  'today-n': d => { S.todayN = +d.v; try { localStorage.setItem('mb-today-n', d.v); } catch {} render(); },
  async 'today-start'() {
    const plan = S.plan || todayPlan(S.todayN);
    if (!plan.items.length) return;
    const kinds = Object.fromEntries(plan.items.map(([q, k]) => [q.id, k]));
    const m = await createModule(plan.items.map(([q]) => q), `Today, ${shortDate(Date.now())}`, null, 'study', { today: dateKey(), kinds, auto: true });
    S.anotherSet = false;
    await startAttempt(m);
  },
  'another-set': () => { S.anotherSet = true; render(); },

  // Practice
  'f-section': d => { S.filter.section = d.v; S.filter.skills.clear(); resetCounts(); render(); },
  'f-diff': d => { toggle(S.filter.diff, d.v); resetCounts(); render(); },
  'f-skill': d => { toggle(S.filter.skills, d.v); resetCounts(); render(); },
  'f-domain'(d) {
    const f = S.filter, skills = new Set([...S.questions.values()].filter(q => q.domain === d.v && (!f.section || q.section === f.section)).map(q => q.skill));
    const allOn = [...skills].every(s => f.skills.has(s));
    for (const s of skills) allOn ? f.skills.delete(s) : f.skills.add(s);
    resetCounts(); render();
  },
  'f-status': d => { S.filter.status = d.v; resetCounts(); render(); },
  'f-mode': d => { S.form.mode = d.v; render(); },
  'skills-toggle': () => { S.skillsOpen = !S.skillsOpen; render(); },
  'clear-filters'() { const f = S.filter; f.section = ''; f.diff.clear(); f.skills.clear(); f.status = 'any'; resetCounts(); render(); },
  async create() {
    let qs = matching();
    if (!qs.length) return;
    const n = Math.max(1, Math.min(+$('#m-count').value || qs.length, qs.length));
    if (S.form.shuffle) qs = shuffle(qs);
    qs = qs.slice(0, n);
    const study = S.form.mode === 'study';
    const seconds = !study && S.form.timed ? Math.max(1, Math.round(+$('#m-min').value || defaultSeconds(qs) / 60)) * 60 : null;
    const m = await createModule(qs, moduleName(qs), seconds, S.form.mode);
    resetCounts(); S.notice = '';
    await startAttempt(m);
  },
  start: d => startAttempt(S.modules.find(m => m.id === d.id)),
  resume: d => openAttempt(S.attempts.find(a => a.id === d.id)),
  results: d => { S.rev = { attempt: S.attempts.find(a => a.id === d.id), idx: null }; S.view = 'results'; render(); scrollTo(0, 0); },
  async 'del-module'(d) {
    const m = S.modules.find(m => m.id === d.id);
    if (!await ask(`Delete “${m.name}”? The questions stay in your bank and your results still count toward Mistakes and Skills.`, 'Delete', true)) return;
    // Finished attempts are kept (hidden) so the history survives; only an unfinished one goes.
    for (const a of S.attempts.filter(a => a.moduleId === m.id && !a.finishedAt)) await del('attempts', a.id);
    await del('modules', m.id);
    S.attempts = S.attempts.filter(a => a.moduleId !== m.id || a.finishedAt);
    S.modules = S.modules.filter(x => x !== m);
    render();
  },
  async 'del-source'(d) {
    const qs = [...S.questions.values()].filter(q => q.source === d.v);
    if (!await ask(`Remove ${plural(qs.length, 'question')} from “${d.v}”? Modules that use them lose those questions.`, 'Remove', true)) return;
    for (const q of qs) { await del('questions', q.id); S.questions.delete(q.id); }
    render();
  },

  // Mistakes and Skills
  'retest-due'() { const rs = reviewState(); const qs = [...S.questions.values()].filter(q => rs.get(q.id)?.status === 'due'); studySet(shuffle(qs), `Review, ${shortDate(Date.now())}`, Object.fromEntries(qs.map(q => [q.id, 'review']))); },
  'practise-one': d => { const q = S.questions.get(d.id); studySet([q], `Review: ${short(q.skill)}`, { [q.id]: 'review' }); },
  'm-filter': d => { S.mistakeFilter = d.v; render(); },
  'show-cleared': () => { S.showCleared = true; render(); },
  'skill-sel': d => { S.skillSel = d.v; render(); if (innerWidth < 980) $('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  // Five questions from one skill, new ones first, then ones still missed, then ones already right.
  'study-skill'(d) {
    const h = history(), qs = [...S.questions.values()].filter(q => q.skill === d.v);
    const pick = [...shuffle(qs.filter(q => STATUS.unseen(h, q))), ...shuffle(qs.filter(q => STATUS.missed(h, q))), ...shuffle(qs.filter(q => h.get(q.id)?.last === true))].slice(0, 5);
    studySet(pick, `Study: ${short(d.v)}`, Object.fromEntries(pick.map(q => [q.id, STATUS.unseen(h, q) ? 'new' : 'review'])));
  },
  'study-skill-missed'(d) {
    const rs = reviewState(), qs = [...S.questions.values()].filter(q => q.skill === d.v && rs.get(q.id) && rs.get(q.id).status !== 'cleared');
    studySet(shuffle(qs), `Review: ${short(d.v)}`, Object.fromEntries(qs.map(q => [q.id, 'review'])));
  },

  // In a session
  pick(d) {
    const a = S.cur, id = a.qids[a.idx];
    if (a.checked?.[id]) return;
    a.answers[id] = a.answers[id] === d.l ? '' : d.l;
    a.struck[id] = (a.struck[id] || []).filter(l => l !== d.l);
    put('attempts', a); render();
  },
  strike(d) {
    const a = S.cur, id = a.qids[a.idx], s = new Set(a.struck[id] || []);
    if (a.checked?.[id]) return;
    toggle(s, d.l);
    if (s.has(d.l) && a.answers[id] === d.l) a.answers[id] = '';
    a.struck[id] = [...s];
    put('attempts', a); render();
  },
  elim: () => { S.elim = !S.elim; render(); },
  ref: () => { S.ref = !S.ref; render(); },
  's-check'() {
    const a = S.cur, id = a.qids[a.idx];
    if (!a.answers[id] || a.checked[id]) return;
    a.checked[id] = true;
    (a.checkedAt ||= {})[id] = Date.now();
    put('attempts', a); render();
  },
  's-why'(d) {
    const a = S.cur, id = a.qids[a.idx], w = (a.why ||= {})[id] || {};
    a.why[id] = { reason: w.reason === d.v ? '' : d.v, note: $('#why-note')?.value.trim() || w.note || '' };
    put('attempts', a); render();
  },
  's-next'() {
    const a = S.cur;
    saveWhyNote();
    if (a.idx < a.qids.length - 1) { a.idx++; put('attempts', a); render(); scrollTo(0, 0); }
    else A['s-finish']();
  },
  async 's-finish'() {
    const a = S.cur, left = a.qids.filter(id => !a.checked[id]).length;
    saveWhyNote();
    if (left && !await ask(`${plural(left, 'question')} not answered yet. End the session and see your results? Use “Save and exit” instead to come back to it later.`, 'End session')) return;
    submit();
  },
  's-self'(d) { const a = S.cur; a.self[a.qids[a.idx]] = d.v === '1'; put('attempts', a); render(); },
  mark() { const a = S.cur, id = a.qids[a.idx]; a.marked[id] = !a.marked[id]; put('attempts', a); render(); },
  clock: () => { S.clockHidden = !S.clockHidden; render(); },
  nav: () => { S.nav = !S.nav; render(); },
  goto(d) { S.cur.idx = +d.i; S.nav = false; S.view = 'test'; render(); },
  back() { saveWhyNote(); if (S.cur.idx) { S.cur.idx--; S.nav = false; render(); if (S.view === 'study') scrollTo(0, 0); } },
  next() { const a = S.cur; S.nav = false; if (a.idx < a.qids.length - 1) a.idx++; else S.view = 'check'; render(); },
  check: () => { S.nav = false; S.view = 'check'; render(); },
  async submit() {
    const blank = S.cur.qids.filter(id => !S.cur.answers[id]).length;
    if (blank && !await ask(`${plural(blank, 'question')} unanswered. Submit anyway?`, 'Submit')) return;
    submit();
  },
  exit() { saveWhyNote(); leaveTest(); },

  // Results
  review(d) { S.rev.idx = +d.i; S.view = 'review'; render(); scrollTo(0, 0); },
  'rev-go'(d) { S.rev.idx += +d.d; render(); scrollTo(0, 0); },
  'to-results': () => { S.view = 'results'; render(); },
  async self(d) { const a = S.rev.attempt; a.self[attemptQs(a)[S.rev.idx].id] = d.v === '1'; await put('attempts', a); render(); },
  async 'retake-missed'() {
    const a = S.rev.attempt, qs = counted(a).filter(q => grade(q, a) !== true);
    const m = await createModule(qs, `${a.name.replace(/(, missed| — missed)$/, '')}, missed`, a.seconds ? defaultSeconds(qs) : null, a.mode, a.mode === 'study' ? { kinds: Object.fromEntries(qs.map(q => [q.id, 'review'])) } : {});
    await startAttempt(m);
  },
};
// The note under "Why did you miss it?" is kept when moving on.
function saveWhyNote() {
  const a = S.cur, el = $('#why-note');
  if (!a || !el) return;
  const id = a.qids[a.idx], w = (a.why ||= {})[id] || {};
  if (el.value.trim() !== (w.note || '')) { a.why[id] = { reason: w.reason || '', note: el.value.trim() }; put('attempts', a); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && A[el.dataset.act]) A[el.dataset.act](el.dataset, el);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'spr') {
    // Bluebook rule: digits, one slash or decimal point, optional leading minus; 5 characters, 6 if negative.
    let v = t.value.replace(/[^0-9./-]/g, '').replace(/(?!^)-/g, '');
    v = v.slice(0, v.startsWith('-') ? 6 : 5);
    t.value = v;
    S.cur.answers[S.cur.qids[S.cur.idx]] = v;
    $('#sprprev').textContent = v;
    const chk = $('[data-act=s-check]'); if (chk) chk.disabled = !v;
    put('attempts', S.cur);
  } else if (t.id === 'm-count') {
    S.form.count = +t.value || null;
    if (S.form.minutes == null && $('#m-min')) { const qs = matching(); $('#m-min').value = Math.round(defaultSeconds(qs.slice(0, Math.min(S.form.count ?? qs.length, qs.length))) / 60); }
  } else if (t.id === 'm-min') S.form.minutes = +t.value || null;
  else if (t.id === 'm-shuffle') S.form.shuffle = t.checked;
  else if (t.id === 'm-timed') { S.form.timed = t.checked; $('#m-min').disabled = !t.checked; }
});
document.addEventListener('change', e => {
  if (e.target.id === 'file') { handleFiles([...e.target.files]); e.target.value = ''; }
});
// Files can be dropped anywhere outside a session.
const canDrop = () => SHELL.includes(S.view) && !S.offline;
document.addEventListener('dragover', e => { if (canDrop()) { e.preventDefault(); document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', e => {
  document.body.classList.remove('dragging');
  if (!canDrop()) return;
  e.preventDefault();
  handleFiles([...e.dataTransfer.files].filter(f => /\.(pdf|json|jsonl)$/i.test(f.name)));
});
// Right-click a choice to cross it out or restore it, in either mode.
document.addEventListener('contextmenu', e => {
  const el = e.target.closest('.choice[data-l]');
  if (!el || !S.cur || (S.view !== 'test' && S.view !== 'study') || el.disabled) return;
  e.preventDefault();
  A.strike({ l: el.dataset.l });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.ref) { S.ref = false; render(); } });
// Study mode keys: A-D pick a choice, Enter checks the answer and then moves on.
document.addEventListener('keydown', e => {
  if (S.view !== 'study' || !S.cur || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.ask')) return;
  if (e.target.id === 'why-note') { if (e.key === 'Enter') { e.preventDefault(); A['s-next'](); } return; }
  const a = S.cur, id = a.qids[a.idx], q = S.questions.get(id);
  if (e.key === 'Enter') { e.preventDefault(); a.checked[id] ? A['s-next']() : A['s-check'](); }
  else if (q.type === 'mc' && !a.checked[id] && /^[a-d]$/i.test(e.key)) { const L = e.key.toUpperCase(); if (a.answers[id] !== L) A.pick({ l: L }); }
});
window.addEventListener('beforeunload', () => { if (S.cur) put('attempts', S.cur); });

async function handleFiles(files) {
  if (!files.length || S.busy) return;
  const msgs = [];
  S.noticeErr = false;
  for (const f of files) {
    try {
      if (/\.jsonl$/i.test(f.name)) { msgs.push(await restoreBackup(f)); continue; }
      const isJson = /\.json$/i.test(f.name);
      if (!isJson && !window.pdfjsLib) throw new Error('the PDF reader could not be loaded; check your internet connection and reload');
      const set = isJson ? await importJsonSet(f) : null;
      const qs = set ? set.questions : await importPdf(f, (i, n) => { S.busy = `Reading ${f.name} — question ${i} of ${n}`; const p = $('#status-text'); if (p) p.textContent = S.busy; else render(); });
      if (!qs.length) { msgs.push(`${f.name}: no questions found. Is it a question bank export?`); S.noticeErr = true; continue; }
      let fresh = 0;
      for (const [i, q] of qs.entries()) {
        S.busy = `Saving ${f.name} — question ${i + 1} of ${qs.length}`;
        const p = $('#status-text'); if (p) p.textContent = S.busy;
        // A question already in the bank keeps its place and is updated, not duplicated.
        const old = S.questions.get(q.id);
        if (old) { q.addedAt = old.addedAt; q.seq = old.seq; } else fresh++;
        S.questions.set(q.id, await saveQuestion(q));
      }
      // A JSON set becomes a study module straight away, in the set's own order (once, even if imported again).
      let added = '';
      if (set) {
        const ids = qs.map(q => q.id).join();
        if (!S.modules.some(m => m.name === set.title && m.qids.join() === ids)) { await createModule(qs, set.title, null, 'study'); added = ' Study module added.'; }
      }
      const manual = qs.filter(q => !q.correct).length;
      msgs.push(`${set ? set.title : f.name}: ${fresh} new${qs.length - fresh ? `, ${qs.length - fresh} already in the bank (updated)` : ''}${manual ? ` (${manual} without a readable answer key; you mark those yourself)` : ''}.${added}`);
    } catch (err) {
      console.error(err);
      msgs.push(`${f.name}: could not be imported (${err.message}).`); S.noticeErr = true;
    }
  }
  S.busy = ''; S.notice = msgs.join(' ');
  render();
}

// ---------- backup files ----------
// A backup is JSON Lines: a header line, then one line per question, module and attempt. One record per line keeps
// both writing and reading streamable, so a bank of hundreds of question images never has to sit in one string.
async function packQuestion(q) {
  if (q.kind === 'text') return q;
  const enc = async c => c && { w: c.w, h: c.h, data: await toDataUrl(c.blob || await (await fetch(c.url)).blob()) };
  return { ...q, stem: await enc(q.stem), answerImg: await enc(q.answerImg), rationale: await enc(q.rationale), choices: await Promise.all(q.choices.map(enc)) };
}
async function writeBackup(withQuestions, write) {
  await write(JSON.stringify({ app: 'module-builder', version: 2, contents: withQuestions ? 'everything' : 'results', exportedAt: new Date().toISOString() }) + '\n');
  if (withQuestions) {
    const qs = [...S.questions.values()];
    for (const [i, q] of qs.entries()) {
      if (i % 10 === 0) { S.busy = `Exporting question ${i + 1} of ${qs.length}`; const p = $('#status-text'); if (p) p.textContent = S.busy; }
      await write(JSON.stringify({ t: 'question', v: await packQuestion(q) }) + '\n');
    }
  }
  for (const m of S.modules) await write(JSON.stringify({ t: 'module', v: m }) + '\n');
  for (const a of S.attempts) await write(JSON.stringify({ t: 'attempt', v: a }) + '\n');
}
async function exportBackup(withQuestions) {
  if (S.busy) return;
  const name = `module-builder-${withQuestions ? 'everything' : 'results'}-${new Date().toISOString().slice(0, 10)}.jsonl`;
  S.busy = 'Preparing your backup'; S.notice = ''; render();
  try {
    if (window.showSaveFilePicker) {
      // Chrome and Edge: write straight to the chosen file, a line at a time.
      let handle;
      try { handle = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Module Builder backup', accept: { 'application/x-ndjson': ['.jsonl'] } }] }); }
      catch (err) { if (err.name === 'AbortError') { S.busy = ''; return render(); } throw err; }
      const out = await handle.createWritable();
      await writeBackup(withQuestions, s => out.write(s));
      await out.close();
    } else {
      const parts = [];
      await writeBackup(withQuestions, s => parts.push(s));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts, { type: 'application/x-ndjson' }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    S.notice = `Backup saved: ${withQuestions ? `${plural(S.questions.size, 'question')}, ` : ''}${plural(S.modules.length, 'module')} and ${plural(S.attempts.length, 'session')}.`; S.noticeErr = false;
  } catch (err) {
    console.error(err);
    S.notice = `The backup could not be saved (${err.message}).`; S.noticeErr = true;
  }
  S.busy = ''; render();
}
function fromDataUrl(u) {
  const [head, b64] = u.split(','), bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: /data:([^;]+)/.exec(head)[1] });
}
// Merges a backup into the current bank: same ids are replaced, everything else is added.
async function restoreBackup(file) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  const n = { question: 0, module: 0, attempt: 0 };
  let buf = '', header = null;
  const handle = async line => {
    if (!line.trim()) return;
    const rec = JSON.parse(line);
    if (!header) {
      if (rec.app !== 'module-builder') throw new Error('this is not a Module Builder backup');
      header = rec; return;
    }
    if (rec.t === 'question') {
      const q = rec.v;
      if (q.kind !== 'text') {
        const dec = c => c && { w: c.w, h: c.h, blob: fromDataUrl(c.data) };
        Object.assign(q, { stem: dec(q.stem), answerImg: dec(q.answerImg), rationale: dec(q.rationale), choices: q.choices.map(dec) });
      }
      S.questions.set(q.id, await saveQuestion(q));
      if (++n.question % 10 === 0) { S.busy = `Restoring question ${n.question}`; const p = $('#status-text'); if (p) p.textContent = S.busy; }
    } else if (rec.t === 'module' || rec.t === 'attempt') {
      const list = rec.t === 'module' ? S.modules : S.attempts, v = rec.v, i = list.findIndex(x => x.id === v.id);
      await put(rec.t + 's', v);
      if (i >= 0) list[i] = v; else list.push(v);
      n[rec.t]++;
    }
  };
  S.busy = 'Restoring your backup'; render();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    for (let i; (i = buf.indexOf('\n')) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 1); await handle(line); }
  }
  await handle(buf);
  if (!header) throw new Error('the file is empty');
  S.modules.sort((a, b) => a.createdAt - b.createdAt);
  return `Backup restored: ${n.question ? `${plural(n.question, 'question')}, ` : ''}${plural(n.module, 'module')} and ${plural(n.attempt, 'session')}.`;
}

// ---------- JSON question sets ----------
// Format: { module: { id, title }, rules: [{ id, text }], questions: [{ id, rule_id, based_on, section, domain, skill,
//   type: 'multiple_choice' | 'student_produced', passage, prompt, choices: [{ id, text }], answer, accepted_answers, explanation }] }
// See imports/practice-1-retest.json.
async function importJsonSet(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('it is not valid JSON'); }
  if (!Array.isArray(data?.questions) || !data.questions.length) throw new Error('it has no "questions" list');
  const info = data.module || {};
  const setId = String(info.id || file.name.replace(/\.json$/i, '')).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 30);
  const rules = new Map((data.rules || []).map(r => [r.id, r.text]));
  const addedAt = Date.now();
  const questions = data.questions.map((x, i) => {
    const mc = x.type === 'multiple_choice';
    if (mc && (x.choices || []).length !== 4) throw new Error(`question ${x.id} needs four choices`);
    if (mc && !/^[A-D]$/.test(x.answer)) throw new Error(`question ${x.id} needs an answer from A to D`);
    const sec = nos(x.section || '').toLowerCase().includes('math') ? 'Math' : 'Reading and Writing';
    return {
      id: `${setId}-${x.id ?? i}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64), kind: 'text', source: info.title || file.name,
      section: sec, domain: canon(x.domain || ''), skill: canon(x.skill || ''), difficulty: x.difficulty ? canon(x.difficulty) : '',
      type: mc ? 'mc' : 'spr', correct: x.answer == null ? null : String(x.answer),
      accepted: mc ? [] : (x.accepted_answers || [x.answer]).map(String).filter(t => !isNaN(parseNum(t))),
      stem: { note: x.based_on || x.source || '', passage: x.passage || '', text: x.prompt || '' },
      choices: mc ? x.choices.map(c => ({ text: String(c.text) })) : [],
      answerImg: null, rationale: { text: x.explanation || '', rule: rules.get(x.rule_id) || '' },
      addedAt, seq: i,
    };
  });
  return { title: info.title || file.name.replace(/\.json$/i, ''), questions };
}

// ---------- one-time migration ----------
// The first version kept everything in this browser's IndexedDB. Move it into the on-disk database.
async function migrateBrowserStore() {
  const NAME = 'sat-module-builder';
  if (!indexedDB.databases || !(await indexedDB.databases()).some(d => d.name === NAME)) return;
  const idb = await new Promise((res, rej) => { const r = indexedDB.open(NAME); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = store => new Promise((res, rej) => {
    if (!idb.objectStoreNames.contains(store)) return res([]);
    const r = idb.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  try {
    const qs = (await all('questions')).filter(q => !S.questions.has(q.id) && q.stem && q.stem.blob);
    for (const [i, q] of qs.entries()) {
      S.busy = `Moving saved questions into the database — ${i + 1} of ${qs.length}`; render();
      S.questions.set(q.id, await saveQuestion(q));
    }
    for (const [store, list] of [['modules', S.modules], ['attempts', S.attempts]]) {
      for (const v of await all(store)) if (!list.some(x => x.id === v.id)) { await api('PUT', `/api/${store}/${v.id}`, v); list.push(v); }
    }
    idb.close();
    indexedDB.deleteDatabase(NAME);
    if (qs.length) S.notice = `${plural(qs.length, 'question')} moved from this browser into the database.`;
  } catch (err) {
    console.error(err);
    idb.close();
  }
  S.busy = ''; render();
}

// ---------- boot ----------
(async () => {
  render();
  let st = null;
  try {
    // Only a copy running on this computer has the local server to ask.
    st = LOCAL ? await api('GET', '/api/state') : null;
  } catch (err) {
    if (LOCAL) { console.error(err); S.offline = true; }
  }
  if (!st && !S.offline) {
    backend = 'browser';
    st = { questions: await idb('questions', 'readonly', o => o.getAll()), modules: await idb('modules', 'readonly', o => o.getAll()), attempts: await idb('attempts', 'readonly', o => o.getAll()) };
    // Ask the browser not to clear this site's storage when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  }
  if (st) {
    // Keep the order the questions had in their PDFs.
    for (const q of st.questions.sort((a, b) => a.addedAt - b.addedAt || a.seq - b.seq)) S.questions.set(q.id, hydrate(q));
    S.modules = st.modules.sort((a, b) => a.createdAt - b.createdAt);
    S.attempts = st.attempts;
  }
  render();
  if (backend === 'server' && !S.offline) await migrateBrowserStore();
  // Dev hook: index.html?load=a.pdf,b.pdf imports files served next to the page.
  const load = new URLSearchParams(location.search).get('load');
  if (load) {
    const files = [];
    for (const u of load.split(',')) files.push(new File([await (await fetch(u)).blob()], u.split('/').pop()));
    await handleFiles(files);
  }
})();
