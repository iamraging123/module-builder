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
// Under 60% is a weak spot, 60-79% is getting there, 80% and up is solid. The number is always shown, so colour is not the only cue.
function accBadge(r) {
  if (!r) return '';
  const pct = Math.round(100 * r.c / r.n);
  return `<em class="acc ${pct < 60 ? 'low' : pct < 80 ? 'mid' : 'high'}" title="${r.c} right out of ${r.n} answered">${pct}%</em>`;
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
async function createModule(qs, name, seconds, mode = 'test') {
  const m = { id: uid(), name, mode, qids: qs.map(q => q.id), seconds: mode === 'study' ? null : seconds, section: sectionOf(qs), createdAt: Date.now() };
  await put('modules', m);
  S.modules.push(m);
  return m;
}
async function startAttempt(m) {
  const qids = m.qids.filter(id => S.questions.has(id));
  if (!qids.length) { S.notice = 'That module has no questions left in the bank.'; S.noticeErr = true; return render(); }
  const a = { id: uid(), moduleId: m.id, name: m.name, mode: m.mode || 'test', checked: {}, section: m.section, qids, seconds: m.seconds, remaining: m.seconds, elapsed: 0, idx: 0, answers: {}, marked: {}, struck: {}, self: {}, startedAt: Date.now(), finishedAt: null };
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
function render() {
  const views = { home: viewHome, stats: viewStats, test: viewTest, study: viewStudy, check: viewCheck, results: viewResults, review: viewReview };
  const onMath = (S.view === 'test' || S.view === 'study') && S.cur && S.questions.get(S.cur.qids[S.cur.idx])?.section === 'Math';
  $('#app').innerHTML = views[S.view]() + (S.ref && onMath ? refSheet() : '');
  if (S.view === 'test' || S.view === 'study') { updateClock(); const i = $('#spr'); if (i && !i.disabled) i.focus(); }
  if (S.view === 'check') updateClock();
}

// Filters are drawn as answer-sheet bubbles: filled in means selected.
function bubble(act, val, label, on, count, radio, extra = '') {
  return `<button class="bub ${on ? 'on' : ''}" role="${radio ? 'radio' : 'checkbox'}" aria-checked="${on}" data-act="${act}" data-v="${esc(val)}"><i></i><span>${esc(label)}</span>${count != null ? `<small>${count}</small>` : ''}${extra}</button>`;
}
function appBar(right) {
  return `<header class="bar"><div class="bar-in"><button class="brand" data-act="home">Module Builder</button>${right}</div></header><div class="bb-dash"></div>`;
}
const shortDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function viewHome() {
  const all = [...S.questions.values()], f = S.filter;
  if (S.offline) return appBar('') + `<main class="home solo"><h1>The database is not running.</h1><p class="sub">Close this tab, double-click \u201cStart Module Builder.bat\u201d, and use the page it opens.</p></main>`;
  const bar = appBar(`${all.length ? `<span class="bar-note">${plural(all.length, 'question')} in your bank</span><button class="pill ghost" data-act="stats">Your stats</button>` : ''}<button class="pill" data-act="choose" ${S.busy ? 'disabled' : ''}>Add questions</button>`);
  const status = S.busy || S.notice ? `<div class="status ${!S.busy && S.noticeErr ? 'err' : ''}"><span id="status-text">${esc(S.busy || S.notice)}</span>${S.busy ? '' : '<button class="link" data-act="dismiss">Dismiss</button>'}</div>` : '';
  const veil = `<div class="dropveil">Drop to add these questions to your bank</div>`;
  if (!all.length) return bar + status + `<main class="home solo"><h1>Add questions to start.</h1><p class="sub">Export a set of questions as a PDF from the <a href="https://satsuiteeducatorquestionbank.collegeboard.org/" target="_blank" rel="noopener">College Board question bank</a>, then drop the file anywhere on this page or use Add questions. Everything you add is saved ${where()}, on this device only.</p><p class="sub restore">Moving from another computer? <button class="link" data-act="choose">Restore a backup</button></p></main>` + veil;

  const secs = [...new Set(all.map(q => q.section))];
  const inSec = all.filter(q => !f.section || q.section === f.section);
  const count = (key, v) => inSec.filter(q => q[key] === v).length;
  const diffs = ['Easy', 'Medium', 'Hard'].filter(d => count('difficulty', d));
  const hist = history(), statusCount = k => inSec.filter(q => STATUS[k](hist, q)).length;
  const doms = new Map();
  for (const q of inSec) { if (!doms.has(q.domain)) doms.set(q.domain, new Set()); doms.get(q.domain).add(q.skill); }
  const qs = matching();
  const n = Math.min(S.form.count ?? qs.length, qs.length);
  const mins = S.form.minutes ?? Math.round(defaultSeconds(qs.slice(0, n)) / 60);
  const filtered = f.section || f.diff.size || f.skills.size || f.status !== 'any';
  const acc = accuracy();
  // Weakest skill in the current section, once it has at least three answers behind it.
  const shown = new Set(inSec.map(q => q.skill));
  const weakest = [...acc.skill].filter(([k, r]) => shown.has(k) && r.n >= 3).sort((x, y) => x[1].c / x[1].n - y[1].c / y[1].n)[0];
  const study = S.form.mode === 'study';

  let h = bar + status + `<main class="home"><section><h1>Build a module</h1>`;
  // A row is only shown when it offers a real choice.
  if (secs.length > 1) h += `<div class="frow"><div class="lab">Section</div><div class="bubs" role="radiogroup">${bubble('f-section', '', 'Both', !f.section, all.length, true)}${secs.map(x => bubble('f-section', x, x, f.section === x, all.filter(q => q.section === x).length, true)).join('')}</div></div>`;
  if (diffs.length > 1) h += `<div class="frow"><div class="lab">Difficulty</div><div class="bubs">${diffs.map(d => bubble('f-diff', d, d, f.diff.has(d), count('difficulty', d))).join('')}</div></div>`;
  if (hist.size) h += `<div class="frow"><div class="lab">History</div><div class="bubs" role="radiogroup">${bubble('f-status', 'any', 'Any', f.status === 'any', null, true)}${bubble('f-status', 'unseen', 'New to me', f.status === 'unseen', statusCount('unseen'), true)}${bubble('f-status', 'missed', 'Still missed', f.status === 'missed', statusCount('missed'), true)}${bubble('f-status', 'ever', 'Ever missed', f.status === 'ever', statusCount('ever'), true)}</div></div>`;
  h += `<div class="frow"><div class="lab">Skills</div><div><div class="skillbar"><span>${f.skills.size ? plural(f.skills.size, 'skill') + ' selected' : 'Any skill'}</span><button class="link" data-act="skills-toggle" aria-expanded="${S.skillsOpen}">${S.skillsOpen ? 'Hide skills' : 'Choose skills'}</button></div>
    ${weakest ? `<p class="weak">Weakest so far: ${esc(weakest[0])} ${accBadge(weakest[1])}</p>` : ''}
    ${S.skillsOpen && acc.skill.size ? `<p class="acc-key">Percent right so far: <em class="acc low">under 60%</em> <em class="acc mid">60 to 79%</em> <em class="acc high">80% and up</em></p>` : ''}
    ${S.skillsOpen ? `<div class="skills">${[...doms].map(([d, sk]) => `<div class="dom"><button class="domname" data-act="f-domain" data-v="${esc(d)}" title="Select or clear every skill in ${esc(d)}">${esc(d)}${accBadge(acc.domain.get(d))}</button>${[...sk].map(x => bubble('f-skill', x, x, f.skills.has(x), count('skill', x), false, accBadge(acc.skill.get(x)))).join('')}</div>`).join('')}</div>` : ''}</div></div>
    <div class="go"><p class="match">${qs.length ? `${plural(qs.length, 'question')} match${qs.length === 1 ? 'es' : ''}` : 'No questions match these filters'}${filtered ? ` <button class="link" data-act="clear-filters">Clear filters</button>` : ''}</p>
      ${qs.length ? `<div class="modes" role="radiogroup">${bubble('f-mode', 'test', 'Test: answers and score at the end', !study, null, true)}${bubble('f-mode', 'study', 'Study: check each answer as you go', study, null, true)}</div>
      <div class="opts"><label>Use <input class="num" id="m-count" type="number" min="1" max="${qs.length}" value="${n}"> of them</label>
        <label class="check"><input type="checkbox" id="m-shuffle" ${S.form.shuffle ? 'checked' : ''}> Shuffle the order</label>
        ${study ? '' : `<span class="check"><label class="check"><input type="checkbox" id="m-timed" ${S.form.timed ? 'checked' : ''}> Timed</label><label><input class="num" id="m-min" type="number" min="1" value="${mins}" ${S.form.timed ? '' : 'disabled'}> minutes</label></span>`}</div>
      <button class="pill big" data-act="create">${study ? 'Start studying' : 'Start module'}</button>` : ''}</div></section><aside>`;

  if (S.modules.length) {
    const rows = S.modules.map(m => {
      const mine = S.attempts.filter(a => a.moduleId === m.id);
      const open = mine.find(a => !a.finishedAt);
      const last = mine.filter(a => a.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt)[0];
      return { m, open, last };
    }).sort((a, b) => !!b.open - !!a.open || b.m.createdAt - a.m.createdAt);
    h += `<h2>Your modules</h2>` + rows.map(({ m, open, last }) => {
      const t = last && tally(last);
      const state = open ? `in progress, on question ${open.idx + 1}` : !t ? 'not started' : t.n ? `last score ${t.c}/${t.n}` : 'nothing answered last time';
      return `<div class="item"><div class="name">${esc(m.name)}</div><div class="meta">${plural(m.qids.length, 'question')}, ${m.mode === 'study' ? 'study' : m.seconds ? Math.round(m.seconds / 60) + ' min' : 'untimed'}, ${shortDate(m.createdAt)}</div><div class="meta">${state}</div>
        <div class="acts"><button class="pill small" data-act="${open ? 'resume' : 'start'}" data-id="${open ? open.id : m.id}">${open ? 'Resume' : !last ? 'Start' : m.mode === 'study' ? 'Study again' : 'Retake'}</button>
        ${last ? `<button class="link" data-act="results" data-id="${last.id}">Results</button>` : ''}<button class="link" data-act="del-module" data-id="${m.id}">Delete</button></div></div>`;
    }).join('');
  }
  const sources = [...new Set(all.map(q => q.source))];
  h += `<h2>Files in your bank</h2>` + sources.map(x => `<div class="item file"><div><div class="name" title="${esc(x)}">${esc(x)}</div><div class="meta">${plural(all.filter(q => q.source === x).length, 'question')}</div></div><button class="link" data-act="del-source" data-v="${esc(x)}">Remove</button></div>`).join('') +
    `<h2>Backup</h2><p class="foot">Your questions, modules and results are saved ${where()}.${backend === 'browser' ? ' Clearing browsing data deletes them, so export a backup now and then.' : ''}</p>
    <div class="backup"><button class="link" data-act="export" data-v="all">Export everything</button><button class="link" data-act="export" data-v="results">Export results only</button><button class="link" data-act="choose">Restore a backup</button></div>
    <p class="foot">Everything includes the question images, so the file is large. Results only is small: restore it after adding the same PDFs again.</p></aside></main>` + veil;
  return h;
}
// Modules name themselves after the filters that built them, for example "Hard Math, Linear functions".
function moduleName(qs) {
  const f = S.filter, sec = sectionOf(qs);
  const head = [{ unseen: 'New', missed: 'Still missed', ever: 'Ever missed' }[f.status], f.diff.size ? ['Easy', 'Medium', 'Hard'].filter(d => f.diff.has(d)).join(' and ') : '', sec === 'Mixed' ? 'Both sections' : sec].filter(Boolean).join(' ');
  const skills = [...new Set(qs.map(q => q.skill))];
  return head + (f.skills.size ? `, ${skills.length === 1 ? skills[0] : plural(skills.length, 'skill')}` : '');
}

function topBar(a, tools) {
  return `<div class="bb-top"><div class="bb-title">${esc(a.name)}<small>${esc(a.section || '')}</small></div>
    <div class="bb-timer">${S.cur ? `<span id="clock"></span><button data-act="clock">${S.clockHidden ? 'Show' : 'Hide'}</button>` : ''}</div>
    <div class="bb-tools">${tools || ''}</div></div><div class="bb-dash"></div>`;
}
function navGrid(a, cur) {
  return `<div class="grid">${a.qids.map((id, i) => `<button class="cell ${a.answers[id] ? 'done' : ''} ${a.marked[id] ? 'flag' : ''} ${i === cur ? 'cur' : ''}" data-act="goto" data-i="${i}">${i + 1}</button>`).join('')}</div>`;
}
const legend = `<div class="legend"><span>▢ Unanswered</span><span style="color:var(--blue)">■ Answered</span><span style="color:var(--red)">■ For review</span></div>`;

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
    body = `<div class="spr"><input id="spr" maxlength="6" autocomplete="off" value="${esc(ans || '')}">
      <div class="prev">Answer preview: <span id="sprprev">${esc(ans || '')}</span></div>
      <p class="hint">Enter a whole number, decimal or fraction, such as 3.5 or 7/2. Up to 5 characters, or 6 with a minus sign.</p></div>`;
  }
  const tools = `${q.section === 'Math' ? mathTools() : ''}<button data-act="exit">Save &amp; Exit</button>`;
  return `<div class="bb">${topBar(a, tools)}
    <div class="bb-body"><div class="pane"><div class="inner"><div class="qbar"><span class="qnum">${a.idx + 1}</span>
        <button class="mark ${a.marked[qid] ? 'on' : ''}" data-act="mark"><i class="flag"></i>${a.marked[qid] ? 'Marked for Review' : 'Mark for Review'}</button>
        ${q.type === 'mc' ? crossToggle() : ''}</div>
        <div class="stem">${content(q.stem)}</div>${body}</div></div></div>
    <div class="bb-dash"></div>
    <div class="bb-bottom"><span></span><button class="bb-nav" data-act="nav">Question ${a.idx + 1} of ${n} ${S.nav ? '▾' : '▴'}</button>
      <div class="bb-go"><button class="pill ghost" data-act="back" ${a.idx ? '' : 'disabled'}>Back</button><button class="pill" data-act="next">Next</button></div>
      ${S.nav ? `<div class="pop"><h3>${esc(a.name)}</h3>${legend}${navGrid(a, a.idx)}<div class="foot"><button class="pill ghost" data-act="check">Go to Review Page</button></div></div>` : ''}</div></div>`;
}
// Math questions get the College Board version of the Desmos calculator (opens in its own tab) and a formula panel.
const DESMOS = 'https://www.desmos.com/testing/cb-digital-sat/graphing';
const mathTools = () => `<a class="tool" href="${DESMOS}" target="_blank" rel="noopener" title="Opens the Desmos graphing calculator used on the digital SAT in a new tab">Calculator</a><button class="tool" data-act="ref" aria-expanded="${S.ref}">Reference</button>`;
// The standard geometry facts given on the test, written out as plain formulas.
const REFERENCE = [
  ['Area and circumference', [
    ['Circle, area', 'A = \u03c0r<sup>2</sup>'],
    ['Circle, circumference', 'C = 2\u03c0r'],
    ['Rectangle', 'A = \u2113w'],
    ['Triangle', 'A = \u00bdbh'],
  ]],
  ['Right triangles', [
    ['Pythagorean theorem', 'c<sup>2</sup> = a<sup>2</sup> + b<sup>2</sup>'],
    ['30\u00b0-60\u00b0-90\u00b0 sides', 'x, x\u221a3, 2x'],
    ['45\u00b0-45\u00b0-90\u00b0 sides', 's, s, s\u221a2'],
  ]],
  ['Volume', [
    ['Rectangular box', 'V = \u2113wh'],
    ['Cylinder', 'V = \u03c0r<sup>2</sup>h'],
    ['Sphere', 'V = \u2074\u2044\u2083\u03c0r<sup>3</sup>'],
    ['Cone', 'V = \u2153\u03c0r<sup>2</sup>h'],
    ['Pyramid', 'V = \u2153\u2113wh'],
  ]],
  ['Angles', [
    ['Degrees of arc in a circle', '360'],
    ['Radians of arc in a circle', '2\u03c0'],
    ['Sum of the angles of a triangle', '180\u00b0'],
  ]],
];
function refSheet() {
  return `<aside class="ref" role="dialog" aria-label="Reference sheet"><div class="ref-head"><h3>Reference</h3><button class="link" data-act="ref">Close</button></div>
    ${REFERENCE.map(([title, rows]) => `<h4>${title}</h4><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`).join('')}
    <p class="ref-note">In the 30\u00b0-60\u00b0-90\u00b0 triangle the sides are listed opposite 30\u00b0, 60\u00b0 and 90\u00b0. In the 45\u00b0-45\u00b0-90\u00b0 triangle the last side is the hypotenuse.</p></aside>`;
}
// Cross-out: the toggle shows a button beside each choice; right-clicking a choice does the same without the toggle.
const crossToggle = () => `<button class="cross ${S.elim ? 'on' : ''}" data-act="elim" aria-pressed="${S.elim}" title="Show a cross-out button beside each choice. You can also right-click a choice.">Cross out</button>`;
const strikeBtn = (L, st) => `<button class="strike ${st ? 'undo' : ''}" data-act="strike" data-l="${L}" title="${st ? 'Restore' : 'Cross out'} choice ${L}">${st ? 'Undo' : `<s>${L}</s>`}</button>`;
// Study mode: one question, check it, see the explanation, move on.
function viewStudy() {
  const a = S.cur, qid = a.qids[a.idx], q = S.questions.get(qid), n = a.qids.length;
  const v = a.answers[qid], done = !!a.checked[qid], g = done ? grade(q, a) : null, last = a.idx === n - 1;
  const seen = a.qids.filter(id => a.checked[id]), right = seen.filter(id => grade(S.questions.get(id), a) === true).length;
  let body;
  if (q.type === 'mc') {
    body = q.choices.map((c, i) => {
      const L = 'ABCD'[i];
      const st = (a.struck[qid] || []).includes(L);
      const cls = !done ? (v === L ? 'sel' : '') : L === q.correct ? 'correct' : v === L && g === false ? 'wrong' : v === L ? 'sel' : '';
      // Once checked, a crossed-out choice stays crossed unless it turned out to be the answer.
      return `<div class="choice-row"><button class="choice ${cls} ${st && !(done && L === q.correct) ? 'struck' : ''}" data-act="pick" data-l="${L}" ${done ? 'disabled' : ''}><span class="letter">${L}</span>${content(c)}</button>${S.elim && !done ? strikeBtn(L, st) : ''}</div>`;
    }).join('');
  } else {
    body = `<div class="spr"><input id="spr" maxlength="6" autocomplete="off" value="${esc(v || '')}" ${done ? 'disabled' : ''} aria-label="Your answer">
      <span id="sprprev" hidden></span>${done ? '' : '<p class="hint">Enter a whole number, decimal or fraction, such as 3.5 or 7/2.</p>'}</div>`;
  }
  let feedback = '';
  if (done) {
    const key = q.correct ? ` The answer is ${esc(q.correct)}.` : '';
    feedback = `<div class="fb ${g === true ? 'ok' : g === false ? 'bad' : 'pend'}"><p class="fb-head">${g === true ? 'Correct.' : g === false ? `Not quite.${key}` : 'Compare your answer with the explanation.'}</p>
      ${a.qtime?.[qid] ? `<p class="fb-time">You took ${fmtTime(a.qtime[qid])}.</p>` : ''}
      ${!q.correct ? `${content(q.answerImg)}<div class="selfgrade"><span>Did you get it?</span><button class="btn" data-act="s-self" data-v="1">Yes</button><button class="btn" data-act="s-self" data-v="0">No</button></div>` : ''}
      ${q.rationale ? `<h4>Explanation</h4>${content(q.rationale)}` : ''}</div>`;
  }
  const pct = k => `${100 * k / n}%`;
  return `<header class="bar"><div class="bar-in"><div class="brand">${esc(a.name)}</div><button class="link" data-act="exit">Save and exit</button><button class="pill ghost" data-act="s-finish">End session</button></div></header>
    <div class="sprog" title="${right} correct, ${seen.length - right} missed"><i class="r" style="width:${pct(right)}"></i><i class="w" style="width:${pct(seen.length - right)}"></i></div>
    <main class="study"><p class="s-meta"><b>Question ${a.idx + 1} of ${n}</b><span>${esc([q.skill, q.difficulty].filter(Boolean).join(', '))}</span><span class="s-tally">${right} correct, ${seen.length - right} missed</span></p>
      <div class="s-tools"><span class="s-clock"><span id="clock"></span><button class="link" data-act="clock">${S.clockHidden ? 'Show timer' : 'Hide timer'}</button></span><span class="s-right">${q.section === 'Math' ? mathTools() : ''}${q.type === 'mc' && !done ? crossToggle() : ''}</span></div>
      <div class="stem">${content(q.stem)}</div>${body}${feedback}
      <div class="s-acts">${done ? `<button class="pill big" data-act="s-next">${last ? 'See results' : 'Next question'}</button>` : `<button class="pill big" data-act="s-check" ${v ? '' : 'disabled'}>Check answer</button>${last ? '' : '<button class="link" data-act="s-next">Skip for now</button>'}`}
        ${a.idx ? '<button class="link s-prev" data-act="back">Previous question</button>' : ''}</div></main>`;
}
function viewCheck() {
  const a = S.cur, blank = a.qids.filter(id => !a.answers[id]).length;
  return `<div class="bb">${topBar(a, `<button data-act="exit">Save &amp; Exit</button>`)}
    <div class="checkpage"><div class="box"><h2>Check Your Work</h2>
      <p>${blank ? `${plural(blank, 'question')} unanswered. ` : 'Every question is answered. '}Click a number to go back to it, or submit when you are done.</p>
      <div class="panel">${legend}${navGrid(a, -1)}</div></div></div>
    <div class="bb-dash"></div>
    <div class="bb-bottom"><span></span><span></span><div class="bb-go"><button class="pill ghost" data-act="goto" data-i="${a.qids.length - 1}">Back</button><button class="pill" data-act="submit">Submit</button></div></div></div>`;
}

function breakdown(a, key) {
  const m = new Map();
  for (const q of attemptQs(a)) {
    const r = m.get(q[key]) || { n: 0, c: 0 };
    r.n++; if (grade(q, a) === true) r.c++;
    m.set(q[key], r);
  }
  return `<table class="bd">${[...m].map(([k, r]) => `<tr><td>${esc(k || '—')}</td><td class="n">${r.c}/${r.n}</td><td class="b"><div class="meter"><i style="width:${100 * r.c / r.n}%"></i></div></td></tr>`).join('')}</table>`;
}
function verdict(g, v) {
  if (v == null || v === '') return ['bad', 'Omitted'];
  return g === true ? ['ok', 'Correct'] : g === false ? ['bad', 'Incorrect'] : ['pend', 'Check'];
}
// ---------- stats ----------
const pctOf = r => Math.round(100 * r.c / r.n);
const level = p => p < 60 ? 'low' : p < 80 ? 'mid' : 'high';
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
// Percent right as text plus a thin bar in the same colour; the number carries the meaning, the colour only backs it up.
function rightCell(r) {
  if (!r) return '<td class="num muted">\u2014</td>';
  const p = pctOf(r);
  return `<td class="num"><span class="rc" title="${r.c} right out of ${r.n}"><em class="acc ${level(p)}">${p}%</em><span class="mtr"><i class="${level(p)}" style="width:${p}%"></i></span></span></td>`;
}
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
function viewStats() {
  const all = [...S.questions.values()], acc = accuracy(), hist = history();
  const bar = appBar(`<button class="pill ghost" data-act="home">Back to start</button>`);
  if (!acc.total.n) return bar + `<main class="page stats"><h1>Your stats</h1><p class="sub">Nothing here yet. Finish a test module or check some answers in study mode, and your progress shows up on this page.</p></main>`;
  const still = all.filter(q => STATUS.missed(hist, q)).length;
  const seen = all.filter(q => hist.has(q.id)).length;
  const time = S.attempts.reduce((t, a) => t + (a.elapsed || 0), 0);
  const finished = S.attempts.filter(a => a.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt);
  const fig = (v, l) => `<div><dd>${v}</dd><dt>${l}</dt></div>`;
  let h = bar + `<main class="page stats"><h1>Your stats</h1>
    <dl class="figs">${fig(acc.total.n, 'Answers checked')}${fig(pctOf(acc.total) + '%', 'Right overall')}${fig(still, 'Still missed')}${fig(`${seen} of ${all.length}`, 'Bank questions seen')}${fig(fmtDuration(time), 'Time practising')}${fig(finished.length, 'Sessions finished')}</dl>`;

  // What to study next: weakest skills with enough answers to mean something, then skills never tried.
  const bankBySkill = new Map();
  for (const q of all) bankBySkill.set(q.skill, (bankBySkill.get(q.skill) || 0) + 1);
  const weak = [...acc.skill].filter(([k, r]) => bankBySkill.has(k) && r.n >= 3 && pctOf(r) < 80).sort((x, y) => pctOf(x[1]) - pctOf(y[1]) || y[1].n - x[1].n);
  const untried = [...bankBySkill.keys()].filter(k => !acc.skill.has(k));
  const sectionOfSkill = k => all.find(q => q.skill === k).section;
  const stillIn = k => all.filter(q => q.skill === k && STATUS.missed(hist, q)).length;
  const next = [
    ...weak.slice(0, 4).map(([k, r]) => [k, `${pctOf(r)}% right over ${plural(r.n, 'answer')}${stillIn(k) ? `, ${stillIn(k)} still missed` : ''}`, level(pctOf(r))]),
    ...untried.slice(0, Math.max(1, 5 - Math.min(weak.length, 4))).map(k => [k, `Not tried yet, ${plural(bankBySkill.get(k), 'question')} in your bank`, 'none']),
  ];
  if (next.length) {
    h += `<h2>Study next</h2><div class="next">${next.map(([k, why, lv]) => `<div class="nx"><span class="dot ${lv}" aria-hidden="true"></span><div class="nx-t"><div class="name">${esc(k)}</div><div class="meta">${esc(sectionOfSkill(k))}. ${esc(why)}</div></div><button class="btn" data-act="study-skill" data-v="${esc(k)}">Study 5</button></div>`).join('')}</div>`;
  }

  for (const sec of [...new Set(all.map(q => q.section))]) {
    const qs = all.filter(q => q.section === sec), r = acc.section.get(sec);
    const secStill = qs.filter(q => STATUS.missed(hist, q)).length, secSeen = qs.filter(q => hist.has(q.id)).length;
    const cells = (list, r2) => {
      const st = list.filter(q => STATUS.missed(hist, q)).length, sn = list.filter(q => hist.has(q.id)).length;
      return `<td class="num">${r2 ? r2.n : 0}</td>${rightCell(r2)}<td class="num ${st ? '' : 'muted'}">${st}</td><td class="num">${sn} of ${list.length}</td>`;
    };
    h += `<section class="sec"><div class="sec-head"><h2>${esc(sec)}</h2>${secStill ? `<button class="btn" data-act="study-missed" data-v="${esc(sec)}">Study the ${secStill} still missed</button>` : ''}</div>
      <p class="sub">${r ? `${plural(r.n, 'answer')}, ${pctOf(r)}% right` : 'No answers yet'}. You have seen ${secSeen} of the ${qs.length} questions in your bank for this section.</p>
      <div class="tw"><table class="st"><thead><tr><th>Skill</th><th class="num">Answered</th><th class="num">Right</th><th class="num">Still missed</th><th class="num">Seen</th><th><span class="vh">Action</span></th></tr></thead><tbody>
      ${skillTree(sec, qs).map(([d, sks]) => `<tr class="drow"><th scope="row">${esc(d)}</th>${cells(qs.filter(q => q.domain === d), acc.domain.get(d))}<td></td></tr>` +
        sks.map(k => `<tr><th scope="row" class="sk">${esc(k)}</th>${cells(qs.filter(q => q.skill === k), acc.skill.get(k))}<td class="act"><button class="link" data-act="study-skill" data-v="${esc(k)}">Study</button></td></tr>`).join('')).join('')}
      </tbody></table></div>
      <h3>By difficulty</h3><div class="tw"><table class="st diff"><thead><tr><th>Difficulty</th><th class="num">Answered</th><th class="num">Right</th><th class="num">Still missed</th><th class="num">Seen</th></tr></thead><tbody>
      ${['Easy', 'Medium', 'Hard'].filter(dd => qs.some(q => q.difficulty === dd)).map(dd => `<tr><th scope="row">${dd}</th>${cells(qs.filter(q => q.difficulty === dd), acc.diff.get(`${sec}|${dd}`))}</tr>`).join('')}
      </tbody></table></div></section>`;
  }

  if (finished.length) {
    h += `<h2>Recent sessions</h2><div class="tw"><table class="st"><thead><tr><th>Session</th><th>Date</th><th>Mode</th><th class="num">Score</th></tr></thead><tbody>
      ${finished.slice(0, 10).map(a => { const t = tally(a); return `<tr><th scope="row"><button class="link" data-act="results" data-id="${a.id}">${esc(a.name)}</button></th><td>${shortDate(a.finishedAt)}</td><td>${a.mode === 'study' ? 'Study' : 'Test'}</td><td class="num">${t.n ? `${t.c}/${t.n}` : '\u2014'}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  }
  return h + `</main>`;
}
function viewResults() {
  const a = S.rev.attempt, t = tally(a), qs = attemptQs(a);
  const missed = counted(a).filter(q => grade(q, a) !== true).length;
  const mod = S.modules.find(m => m.id === a.moduleId);
  const others = S.attempts.filter(x => x.moduleId === a.moduleId && x.finishedAt).sort((x, y) => y.finishedAt - x.finishedAt);
  return appBar(`<button class="pill ghost" data-act="home">Back to start</button>`) + `<div class="page">
    <h1>${esc(a.name)}</h1><p class="sub">${new Date(a.finishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}, time used ${fmtTime(a.elapsed)}${a.seconds ? ` of ${fmtTime(a.seconds)}` : ''}</p>
    <div class="score"><b>${t.c}/${t.n}</b><span>${t.n ? Math.round(100 * t.c / t.n) : 0}% correct${a.mode === 'study' && t.n < qs.length ? `, ${qs.length - t.n} not answered` : ''}${t.p ? `, ${t.p} to check yourself` : ''}</span></div>
    <div class="create">${mod ? `<button class="btn primary" data-act="start" data-id="${a.moduleId}">${a.mode === 'study' ? 'Study again' : 'Retake'}</button>` : ''}${missed ? `<button class="btn" data-act="retake-missed">Practice the ${missed} missed</button>` : ''}</div>
    ${others.length > 1 ? `<p class="notice">Attempts: ${others.map(x => { const k = tally(x); return x.id === a.id ? `<b>${k.c}/${k.n}</b>` : `<button class="link" data-act="results" data-id="${x.id}">${k.c}/${k.n}</button>`; }).join(' · ')}</p>` : ''}
    <h2>By domain</h2>${breakdown(a, 'domain')}<h2>By skill</h2>${breakdown(a, 'skill')}<h2>By difficulty</h2>${breakdown(a, 'difficulty')}
    <h2>Questions</h2><div class="rows">${qs.map((q, i) => {
      const [cls, word] = verdict(grade(q, a), a.answers[q.id]);
      return `<button class="qrow" data-act="review" data-i="${i}"><span class="no">${i + 1}</span><span class="res ${cls}">${word}</span><span class="grow">${esc(q.skill)}</span><span class="meta">${esc(q.difficulty)}</span></button>`;
    }).join('')}</div></div>`;
}
function viewReview() {
  const a = S.rev.attempt, qs = attemptQs(a), i = S.rev.idx, q = qs[i];
  const v = a.answers[q.id], g = grade(q, a), [cls, word] = verdict(g, v);
  let body;
  if (q.type === 'mc') {
    body = q.choices.map((c, k) => {
      const L = 'ABCD'[k];
      return `<div class="choice-row"><button class="choice ${L === q.correct ? 'correct' : v === L && g === false ? 'wrong' : v === L ? 'sel' : ''}" disabled><span class="letter">${L}</span>${content(c)}</button></div>`;
    }).join('');
  } else {
    body = `<p class="kv">Your answer: <b>${v ? esc(v) : '—'}</b></p>${q.correct ? `<p class="kv">Correct answer: <b>${esc(q.correct)}</b></p>` : ''}`;
  }
  const needSelf = !q.correct && v;
  return `<div class="bb">${topBar(a, `<button data-act="to-results">Back to results</button>`)}
    <div class="bb-body"><div class="pane"><div class="inner"><div class="qbar"><span class="qnum">${i + 1}</span><span>${esc([q.skill, q.difficulty].filter(Boolean).join(', '))}</span><span class="verdict ${cls}">${word}</span></div>
        <div class="stem">${content(q.stem)}</div>${body}
        ${needSelf ? `${content(q.answerImg)}<div class="selfgrade"><span>The answer key could not be read for this one. Did you get it?</span><button class="btn" data-act="self" data-v="1">Yes</button><button class="btn" data-act="self" data-v="0">No</button></div>` : ''}
        ${q.rationale ? `<div class="expl"><h4>Explanation</h4>${content(q.rationale)}</div>` : ''}</div></div></div>
    <div class="bb-dash"></div>
    <div class="bb-bottom"><span></span><span style="font-weight:700">Question ${i + 1} of ${qs.length}</span>
      <div class="bb-go"><button class="pill ghost" data-act="rev-go" data-d="-1" ${i ? '' : 'disabled'}>Back</button><button class="pill" data-act="rev-go" data-d="1" ${i < qs.length - 1 ? '' : 'disabled'}>Next</button></div></div></div>`;
}

// ---------- actions ----------
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function resetCounts() { S.form.count = null; S.form.minutes = null; }
const A = {
  choose: () => $('#file').click(),
  'f-section': d => { S.filter.section = d.v; S.filter.skills.clear(); resetCounts(); render(); },
  'f-diff': d => { toggle(S.filter.diff, d.v); resetCounts(); render(); },
  'f-skill': d => { toggle(S.filter.skills, d.v); resetCounts(); render(); },
  'f-domain'(d) {
    const f = S.filter, skills = new Set([...S.questions.values()].filter(q => q.domain === d.v && (!f.section || q.section === f.section)).map(q => q.skill));
    const allOn = [...skills].every(s => f.skills.has(s));
    for (const s of skills) allOn ? f.skills.delete(s) : f.skills.add(s);
    resetCounts(); render();
  },
  'f-mode': d => { S.form.mode = d.v; render(); },
  stats: () => { S.view = 'stats'; render(); scrollTo(0, 0); },
  // Five questions from one skill, new ones first. Only once every question in the skill has been answered
  // does it fall back to ones still missed, then ones already right. ("Study the N still missed" covers misses.)
  async 'study-skill'(d) {
    const h = history(), qs = [...S.questions.values()].filter(q => q.skill === d.v);
    const pick = [...shuffle(qs.filter(q => STATUS.unseen(h, q))), ...shuffle(qs.filter(q => STATUS.missed(h, q))), ...shuffle(qs.filter(q => h.get(q.id)?.last === true))].slice(0, 5);
    if (!pick.length) return;
    await startAttempt(await createModule(pick, `Study: ${d.v}`, null, 'study'));
  },
  async 'study-missed'(d) {
    const h = history(), qs = [...S.questions.values()].filter(q => q.section === d.v && STATUS.missed(h, q));
    if (!qs.length) return;
    await startAttempt(await createModule(qs, `Still missed ${d.v}`, null, 'study'));
  },
  'skills-toggle': () => { S.skillsOpen = !S.skillsOpen; render(); },
  'clear-filters'() { const f = S.filter; f.section = ''; f.diff.clear(); f.skills.clear(); f.status = 'any'; resetCounts(); render(); },
  dismiss: () => { S.notice = ''; render(); },
  export: d => exportBackup(d.v === 'all'),
  'f-status': d => { S.filter.status = d.v; resetCounts(); render(); },
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
  home: () => { S.view = 'home'; render(); },
  async 'del-module'(d) {
    const m = S.modules.find(m => m.id === d.id);
    if (!confirm(`Delete “${m.name}”? The questions stay in the bank and your missed-question history is kept.`)) return;
    // Finished attempts are kept (hidden) so the missed-question history survives; only an unfinished one goes.
    for (const a of S.attempts.filter(a => a.moduleId === m.id && !a.finishedAt)) await del('attempts', a.id);
    await del('modules', m.id);
    S.attempts = S.attempts.filter(a => a.moduleId !== m.id || a.finishedAt);
    S.modules = S.modules.filter(x => x !== m);
    render();
  },
  async 'del-source'(d) {
    const qs = [...S.questions.values()].filter(q => q.source === d.v);
    if (!confirm(`Remove ${plural(qs.length, 'question')} from “${d.v}”? Modules that use them will lose those questions.`)) return;
    for (const q of qs) { await del('questions', q.id); S.questions.delete(q.id); }
    render();
  },

  pick(d) {
    const a = S.cur, id = a.qids[a.idx];
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
    put('attempts', a); render();
  },
  's-next'() {
    const a = S.cur;
    if (a.idx < a.qids.length - 1) { a.idx++; put('attempts', a); render(); scrollTo(0, 0); }
    else A['s-finish']();
  },
  's-finish'() {
    const a = S.cur, left = a.qids.filter(id => !a.checked[id]).length;
    if (left && !confirm(`${plural(left, 'question')} not answered yet. End the session and see your results? Use “Save and exit” instead if you want to come back to it.`)) return;
    submit();
  },
  's-self'(d) { const a = S.cur; a.self[a.qids[a.idx]] = d.v === '1'; put('attempts', a); render(); },
  mark() { const a = S.cur, id = a.qids[a.idx]; a.marked[id] = !a.marked[id]; put('attempts', a); render(); },
  clock: () => { S.clockHidden = !S.clockHidden; render(); },
  nav: () => { S.nav = !S.nav; render(); },
  goto(d) { S.cur.idx = +d.i; S.nav = false; S.view = 'test'; render(); },
  back() { if (S.cur.idx) { S.cur.idx--; S.nav = false; render(); if (S.view === 'study') scrollTo(0, 0); } },
  next() { const a = S.cur; S.nav = false; if (a.idx < a.qids.length - 1) a.idx++; else S.view = 'check'; render(); },
  check: () => { S.nav = false; S.view = 'check'; render(); },
  submit() {
    const blank = S.cur.qids.filter(id => !S.cur.answers[id]).length;
    if (blank && !confirm(`${plural(blank, 'question')} unanswered. Submit anyway?`)) return;
    submit();
  },
  exit: leaveTest,

  review(d) { S.rev.idx = +d.i; S.view = 'review'; render(); },
  'rev-go'(d) { S.rev.idx += +d.d; render(); },
  'to-results': () => { S.view = 'results'; render(); },
  async self(d) { const a = S.rev.attempt; a.self[attemptQs(a)[S.rev.idx].id] = d.v === '1'; await put('attempts', a); render(); },
  async 'retake-missed'() {
    const a = S.rev.attempt, qs = counted(a).filter(q => grade(q, a) !== true);
    const m = await createModule(qs, `${a.name.replace(/(, missed| — missed)$/, '')}, missed`, a.seconds ? defaultSeconds(qs) : null, a.mode);
    await startAttempt(m);
  },
};

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
// PDFs can be dropped anywhere on the start page.
document.addEventListener('dragover', e => { if (S.view === 'home' && !S.offline) { e.preventDefault(); document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', e => {
  document.body.classList.remove('dragging');
  if (S.view !== 'home' || S.offline) return;
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
  if (S.view !== 'study' || !S.cur || e.ctrlKey || e.metaKey || e.altKey) return;
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
      const qs = set ? set.questions : await importPdf(f, (i, n) => { S.busy = `Reading ${f.name} — question ${i} of ${n}`; const p = $('#status-text'); if (p && S.view === 'home') p.textContent = S.busy; else render(); });
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
    st = LOCAL || location.protocol.startsWith('http') && !new URLSearchParams(location.search).has('browser') ? await api('GET', '/api/state') : null;
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
