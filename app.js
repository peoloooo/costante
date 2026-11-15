'use strict';
/* ============================================================
   Costante — piano di studio con streak e trofei
   Tutti i dati restano sul telefono (localStorage).
   ============================================================ */

const KEY = 'costante-v1';
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lun → dom
const DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const DAY_SHORT = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MAX_JOLLY = 2;

/* ---------- date ---------- */
const pad = n => String(n).padStart(2, '0');
const ds = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ds(new Date());
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000); // b - a
const dow = s => pd(s).getDay();
const fmtDate = s => { const d = pd(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const fmtDay = s => { const d = pd(s); return DAY_NAMES[d.getDay()].slice(0, 3).toLowerCase() + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ---------- stato ---------- */
function freshState() {
  return { version: 1, name: '', settings: null, exams: [], logs: [], trophies: {}, createdAt: today() };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version) return s; } catch (e) { }
  return freshState();
}
let state = load();
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

/* ---------- disponibilità ---------- */
const hoursOn = s => state.settings ? (+state.settings.days[dow(s)] || 0) : 0;
const isStudyDay = s => hoursOn(s) > 0;
function countStudyDays(from, toExcl) {
  let n = 0;
  for (let d = from; d < toExcl; d = addDays(d, 1)) if (isStudyDay(d)) n++;
  return n;
}

/* ---------- esami e registrazioni ---------- */
const examById = id => state.exams.find(e => e.id === id);
const activeExams = () => state.exams.filter(e => e.status === 'active');
const logsOf = id => state.logs.filter(l => l.examId === id);
const getLog = (date, examId) => state.logs.find(l => l.date === date && l.examId === examId);

function doneBefore(exam, date) {
  let n = exam.initialDone || 0;
  for (const l of state.logs) if (l.examId === exam.id && l.date < date) n += l.pages;
  return Math.min(n, exam.totalPages);
}
function doneTotal(exam) {
  let n = exam.initialDone || 0;
  for (const l of state.logs) if (l.examId === exam.id) n += l.pages;
  return Math.min(n, exam.totalPages);
}
const reviewStart = exam => addDays(exam.examDate, -exam.reviewDays);
function suggestReview(examDate) {
  const days = diffDays(today(), examDate);
  return Math.max(1, Math.min(14, Math.round(days * 0.15)));
}

/* Cosa c'è da fare per un esame in una certa data, dato quante pagine erano fatte prima.
   Il piano si ricalcola ogni giorno: le pagine rimaste vengono divise sui giorni di studio rimasti. */
function dayPlan(exam, date, done) {
  if (date > exam.examDate) return { phase: 'after', target: 0 };
  if (date === exam.examDate) return { phase: 'examday', target: 0 };
  const remaining = exam.totalPages - done;
  const rs = reviewStart(exam);
  if (!isStudyDay(date)) return { phase: 'rest', target: 0 };
  if (remaining <= 0) return { phase: date >= rs ? 'review' : 'finished', target: 0 };
  const end = date < rs ? rs : exam.examDate;
  const days = Math.max(1, countStudyDays(date, end));
  const required = Math.ceil(remaining / days);
  const target = Math.min(remaining, date < rs ? Math.max(exam.pagesPerDay, required) : required);
  return { phase: date < rs ? 'study' : 'catchup', target, from: done + 1, to: done + target };
}
const planFor = (exam, date) => dayPlan(exam, date, doneBefore(exam, date));

/* Analisi del piano a partire da oggi (per anteprima e schermata esame) */
function analyze(exam) {
  const t = today();
  const done = doneBefore(exam, t);
  const remaining = Math.max(0, exam.totalPages - done);
  const rs = reviewStart(exam);
  const studyDays = t < rs ? countStudyDays(t, rs) : 0;
  const required = remaining === 0 ? 0 : studyDays ? Math.ceil(remaining / studyDays) : Infinity;
  const perDay = remaining ? Math.max(exam.pagesPerDay, required) : 0;
  const warnings = [];
  if (exam.examDate <= t) {
    // niente da analizzare
  } else if (remaining > 0 && studyDays === 0) {
    warnings.push('Non ci sono giorni di studio prima del ripasso. Riduci i giorni di ripasso o aggiungi giorni disponibili.');
  } else if (exam.pagesPerDay < required) {
    warnings.push(`Con ${exam.pagesPerDay} pagine al giorno non finiresti in tempo: ne servono almeno <b>${required}</b>. Il piano userà ${required} pagine al giorno.`);
  }
  // simulazione: quando finisce il programma seguendo il piano?
  let finish = null, d = t, left = remaining, guard = 0;
  while (left > 0 && d < exam.examDate && guard++ < 1000) {
    const p = dayPlan(exam, d, exam.totalPages - left);
    left -= p.target;
    if (left <= 0) finish = d;
    d = addDays(d, 1);
  }
  return { done, remaining, rs, studyDays, required, perDay, finish, warnings };
}

/* Il carico di tutti gli esami insieme sta nelle ore disponibili? */
function capacityWarning(extraExam) {
  if (!state.settings) return null;
  const speed = +state.settings.speed || 1;
  const t = today();
  const list = activeExams().filter(e => !extraExam || e.id !== extraExam.id);
  if (extraExam) list.push(extraExam);
  let load = 0;
  for (const e of list) {
    if (t >= reviewStart(e)) continue;
    const a = analyze(e);
    if (isFinite(a.perDay)) load += a.perDay;
  }
  if (!load) return null;
  const short = DAY_ORDER.filter(d => { const h = +state.settings.days[d] || 0; return h > 0 && load > h * speed; });
  if (!short.length) return null;
  const hrs = String(Math.round(load / speed * 10) / 10).replace('.', ',');
  const allStudy = DAY_ORDER.filter(d => (+state.settings.days[d] || 0) > 0).length === short.length;
  const names = short.map(d => DAY_NAMES[d].toLowerCase()).join(', ');
  return `In totale sono circa <b>${load} pagine al giorno</b> (≈ ${hrs} ore alla tua velocità): troppe per le ore che hai ${allStudy ? 'nei tuoi giorni di studio' : 'il ' + names}. Valuta di aggiungere ore, giorni o spostare qualche esame.`;
}

/* ---------- streak ---------- */
function activeDates() {
  const set = new Set();
  for (const l of state.logs) if (l.pages > 0 || l.review) set.add(l.date);
  return set;
}
const hasExamOn = d => state.exams.some(e => e.createdAt <= d && d <= e.examDate);

/* Regole: un giorno di studio senza attività rompe la serie, a meno che ci sia un jolly.
   Ogni 7 giorni di fila si guadagna un jolly (max 2). I giorni liberi non contano. */
function computeStreak() {
  const act = activeDates();
  const t = today();
  let streak = 0, best = 0, jolly = 0;
  const saved = new Set(), missed = new Set();
  const start = state.createdAt;
  const gain = () => { streak++; if (streak % 7 === 0) jolly = Math.min(MAX_JOLLY, jolly + 1); best = Math.max(best, streak); };
  for (let d = start; d < t; d = addDays(d, 1)) {
    if (act.has(d)) gain();
    else if (isStudyDay(d) && hasExamOn(d)) {
      if (jolly > 0) { jolly--; saved.add(d); }
      else { if (streak > 0) missed.add(d); streak = 0; }
    }
  }
  const todayDone = act.has(t);
  if (todayDone) gain();
  return { streak, best, jolly, saved, missed, todayDone, act };
}

/* ---------- trofei ---------- */
const TROPHIES = [
  { id: 'first', icon: '🌱', name: 'Primo passo', desc: 'Registra il primo giorno di studio' },
  { id: 's3', icon: '🔥', name: 'Si scalda', desc: '3 giorni di fila' },
  { id: 's7', icon: '🗓️', name: 'Settimana di fuoco', desc: '7 giorni di fila' },
  { id: 's14', icon: '⚡', name: 'Due settimane', desc: '14 giorni di fila' },
  { id: 's30', icon: '🏔️', name: 'Inarrestabile', desc: '30 giorni di fila' },
  { id: 's60', icon: '👑', name: 'Leggenda', desc: '60 giorni di fila' },
  { id: 't1', icon: '🎯', name: 'Centro!', desc: "Raggiungi l'obiettivo del giorno" },
  { id: 't10', icon: '🏹', name: 'Infallibile', desc: "Raggiungi l'obiettivo 10 volte" },
  { id: 't30', icon: '💎', name: 'Precisione svizzera', desc: "Raggiungi l'obiettivo 30 volte" },
  { id: 'double', icon: '🚀', name: 'Turbo', desc: 'Fai il doppio delle pagine previste in un giorno' },
  { id: 'multi', icon: '🤹', name: 'Multitasking', desc: 'Studia due materie nello stesso giorno' },
  { id: 'p100', icon: '📄', name: '100 pagine', desc: 'Studia 100 pagine in totale' },
  { id: 'p500', icon: '📚', name: '500 pagine', desc: 'Studia 500 pagine in totale' },
  { id: 'p1000', icon: '🏛️', name: 'Mille pagine', desc: 'Studia 1000 pagine in totale' },
  { id: 'half', icon: '⛳', name: 'Giro di boa', desc: 'Arriva a metà di un programma' },
  { id: 'full', icon: '✅', name: 'Programma finito', desc: 'Studia tutte le pagine di un esame' },
  { id: 'early', icon: '⏰', name: 'In anticipo', desc: 'Finisci il programma prima dei giorni di ripasso' },
  { id: 'review', icon: '🔁', name: 'Ripasso', desc: 'Completa un giorno di ripasso' },
  { id: 'jolly', icon: '🛟', name: 'Salvataggio', desc: 'Un jolly ha salvato la tua serie' },
  { id: 'passed', icon: '🏆', name: 'Esame superato!', desc: 'Supera un esame' },
  { id: 'passed3', icon: '🎓', name: 'Tris', desc: 'Supera 3 esami' },
];

function trophyStats() {
  const st = computeStreak();
  let pages = 0, hits = 0, doubles = 0, reviews = 0;
  const perDate = {};
  for (const l of state.logs) {
    pages += l.pages;
    if (l.review) reviews++;
    if (l.pages > 0) {
      perDate[l.date] = (perDate[l.date] || 0) + 1;
      const ex = examById(l.examId);
      if (ex) {
        const p = planFor(ex, l.date);
        if (p.target > 0 && l.pages >= p.target) hits++;
        if (p.target > 0 && l.pages >= 2 * p.target) doubles++;
      }
    }
  }
  let half = false, full = false, early = false;
  for (const e of state.exams) {
    const done = doneTotal(e);
    if (done >= e.totalPages / 2 && (e.initialDone || 0) < e.totalPages / 2) half = true;
    if (done >= e.totalPages && (e.initialDone || 0) < e.totalPages) {
      full = true;
      // data di completamento
      let acc = e.initialDone || 0;
      for (const l of logsOf(e.id).sort((a, b) => a.date.localeCompare(b.date))) {
        acc += l.pages;
        if (acc >= e.totalPages) { if (l.date < reviewStart(e)) early = true; break; }
      }
    }
  }
  const passed = state.exams.filter(e => e.status === 'passed').length;
  return { st, pages, hits, doubles, reviews, multi: Object.values(perDate).some(n => n >= 2), half, full, early, passed };
}

function trophyEarned(id, s) {
  switch (id) {
    case 'first': return s.st.act.size > 0;
    case 's3': return s.st.best >= 3;
    case 's7': return s.st.best >= 7;
    case 's14': return s.st.best >= 14;
    case 's30': return s.st.best >= 30;
    case 's60': return s.st.best >= 60;
    case 't1': return s.hits >= 1;
    case 't10': return s.hits >= 10;
    case 't30': return s.hits >= 30;
    case 'double': return s.doubles >= 1;
    case 'multi': return s.multi;
    case 'p100': return s.pages >= 100;
    case 'p500': return s.pages >= 500;
    case 'p1000': return s.pages >= 1000;
    case 'half': return s.half;
    case 'full': return s.full;
    case 'early': return s.early;
    case 'review': return s.reviews >= 1;
    case 'jolly': return s.st.saved.size >= 1;
    case 'passed': return s.passed >= 1;
    case 'passed3': return s.passed >= 3;
  }
  return false;
}

/* I trofei, una volta vinti, restano. Restituisce i nuovi. */
function checkTrophies() {
  const s = trophyStats();
  const fresh = [];
  for (const t of TROPHIES) {
    if (!state.trophies[t.id] && trophyEarned(t.id, s)) { state.trophies[t.id] = today(); fresh.push(t); }
  }
  if (fresh.length) save();
  return fresh;
}

/* ============================================================
   INTERFACCIA
   ============================================================ */
const $ = sel => document.querySelector(sel);
const app = $('#app');
const ui = { tab: 'today', onb: 0, draftDays: null, draftSpeed: 6, examId: null, checkin: null };

/* ---------- icone (linea) ---------- */
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  book: '<path d="M4 5.5C4 4.1 5.1 3 6.5 3H20v15H6.5C5.1 18 4 19.1 4 20.5z"/><path d="M4 20.5C4 21.9 5.1 23 6.5 23H20v-5"/>',
  flame: '<path d="M12 2.5c.8 3.6 5.5 5.7 5.5 11a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4 2-6.5 1.6 1 2.6 2.6 2.8 4.6 1.2-2.6 1.4-5.6.7-9.1z"/>',
  trophy: '<path d="M8 3.5h8v6a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.2c0 2.6 1.3 4.2 3.1 4.5M16 5.5h2.8c0 2.6-1.3 4.2-3.1 4.5M12 13.5v4M8.5 21h7M10 17.5h4"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  pages: '<path d="M3.5 5.5c3-1.4 5.5-1.4 8.5.3v14c-3-1.7-5.5-1.7-8.5-.3zM20.5 5.5c-3-1.4-5.5-1.4-8.5.3v14c3-1.7 5.5-1.7 8.5-.3z"/>',
  review: '<path d="M4.5 10a8 8 0 0 1 14.2-3.3L20.5 9M20.5 4v5h-5M19.5 14a8 8 0 0 1-14.2 3.3L3.5 15M3.5 20v-5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M7 17L17 7M9 7h8v8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const circleBtn = (icon, action, label, attrs = '') => `<button class="circle" data-a="${action}" aria-label="${label}" ${attrs}>${ic(icon)}</button>`;
const cta = (label, action, opts = {}) => `<button class="cta ${opts.cls || ''}" data-a="${action}" ${opts.id ? `data-id="${opts.id}"` : ''}>
    <span class="cta-ic">${ic(opts.icon || 'pages')}</span><span class="cta-l">${label}</span><span class="cta-chev"><i>›</i><i>›</i><i>›</i></span></button>`;
const STAR = (() => {
  const pts = [];
  for (let i = 0; i < 36; i++) { const r = i % 2 ? 39 : 50, a = Math.PI * 2 * i / 36; pts.push((50 + r * Math.cos(a)).toFixed(1) + ',' + (50 + r * Math.sin(a)).toFixed(1)); }
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${pts.join(' ')}"/></svg>`;
})();
const sticker = (html, cls = '') => `<div class="sticker ${cls}">${STAR}<span>${html}</span></div>`;
const hero = (left, title, right, body = '') => `
  <header class="hero">
    <div class="hero-bar">${left || '<span class="sp"></span>'}<span class="hero-t">${title}</span>${right || '<span class="sp"></span>'}</div>
    ${body}
  </header>`;
function progress(done, total, label = 'pagine') {
  const pct = Math.round(done / total * 100);
  return `<div class="prog"><span>${pct}%</span><span>${done}/${total} ${label}</span></div>
    <div class="bar"><i style="width:${pct}%" ${pct ? '' : 'hidden'}></i></div>`;
}
const dpill = (txt, dot = true) => `<span class="dpill">${dot ? '<i class="dot"></i>' : ''}${txt}</span>`;
const cap = s => s.replace(/^\w/, c => c.toUpperCase());

function render() {
  const nav = $('#tabs');
  if (!state.settings || !state.exams.length && ui.onb > 0) { nav.hidden = true; app.innerHTML = renderOnboarding(); return; }
  nav.hidden = false;
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  if (ui.tab === 'today') app.innerHTML = renderToday();
  else if (ui.tab === 'exams') app.innerHTML = ui.examId ? renderExamDetail(examById(ui.examId)) : renderExams();
  else app.innerHTML = renderTrophies();
}

/* ---------- onboarding ---------- */
function renderOnboarding() {
  if (ui.onb === 0) return `
    <section class="welcome">
      <div class="hero-bar"><span class="sp"></span><span class="hero-t">COSTANTE</span><span class="sp"></span></div>
      <h1 class="mega xl">UN PASSO<br>AL GIORNO</h1>
      ${sticker('STREAK<br>&amp; TROFEI', 'welcome-st')}
      <p class="hero-sub">Ti preparo un piano di studio fino all'esame.<br>Tu tieni accesa la fiamma.</p>
      <label class="field on-dark"><span>Come ti chiami?</span>
        <input id="f-name" type="text" autocomplete="given-name" placeholder="Il tuo nome" value="${esc(state.name)}"></label>
      ${cta('Iniziamo', 'onbNext', { icon: 'flame' })}
    </section>`;
  if (ui.onb === 1) return hero(null, 'PASSO 1 DI 2', null, `
      <h1 class="mega">QUANDO<br>STUDI?</h1>
      <p class="hero-sub">Giorni e ore a disposizione. Vale per tutti gli esami.</p>`) + `
    <div class="wrap">${availabilityForm()}${cta('Avanti', 'onbNext', { icon: 'calendar' })}</div>`;
  return hero(null, 'PASSO 2 DI 2', null, `<h1 class="mega">IL PRIMO<br>ESAME</h1>`) + `
    <div class="wrap">${examForm(null)}${cta('Crea il piano', 'saveExam', { icon: 'flame' })}</div>`;
}

function availabilityForm() {
  const days = ui.draftDays;
  return `
    <div class="days">
      ${DAY_ORDER.map(d => {
    const h = +days[d] || 0;
    return `<div class="day-row ${h > 0 ? 'on' : ''}">
          <button class="day-toggle" data-a="dayToggle" data-d="${d}"><i class="tick">${h > 0 ? ic('check') : ''}</i>${DAY_NAMES[d]}</button>
          ${h > 0 ? `<div class="stepper">
              <button data-a="dayHours" data-d="${d}" data-v="-0.5" aria-label="meno">−</button>
              <span>${String(h).replace('.', ',')} h</span>
              <button data-a="dayHours" data-d="${d}" data-v="0.5" aria-label="più">+</button></div>`
        : `<span class="off-lbl">libero</span>`}
        </div>`;
  }).join('')}
    </div>
    <label class="field"><span>Quante pagine studi in media in un'ora?</span>
      <input id="f-speed" type="number" inputmode="numeric" min="1" value="${ui.draftSpeed}"></label>
    <p class="hint">Serve per capire se il piano sta nelle tue ore. Se non lo sai, lascia 6 e correggi dopo.</p>`;
}

function examForm(exam) {
  const e = exam || {};
  const minDate = addDays(today(), 1);
  return `
    <div class="form" id="exam-form" data-id="${e.id || ''}">
      <label class="field"><span>Materia</span>
        <input id="f-ename" type="text" placeholder="Es. Diritto privato" value="${esc(e.name || '')}"></label>
      <div class="row2">
        <label class="field"><span>Pagine del programma</span>
          <input id="f-total" type="number" inputmode="numeric" min="1" placeholder="Es. 450" value="${e.totalPages || ''}"></label>
        <label class="field"><span>Già studiate</span>
          <input id="f-initial" type="number" inputmode="numeric" min="0" value="${e.initialDone || 0}"></label>
      </div>
      <label class="field"><span>Data dell'esame</span>
        <input id="f-date" type="date" min="${exam ? '' : minDate}" value="${e.examDate || ''}"></label>
      <div class="row2">
        <label class="field"><span>Pagine al giorno</span>
          <input id="f-ppd" type="number" inputmode="numeric" min="1" placeholder="Es. 15" value="${e.pagesPerDay || ''}"></label>
        <label class="field"><span>Giorni di ripasso</span>
          <input id="f-review" type="number" inputmode="numeric" min="0" placeholder="auto" value="${e.reviewDays ?? ''}"></label>
      </div>
      <p class="hint">I giorni di ripasso sono gli ultimi prima dell'esame: lì non ci sono pagine nuove. Lascia vuoto per un valore automatico.</p>
      <div id="preview">${examPreview()}</div>
    </div>`;
}

function readExamForm() {
  const v = id => ($('#' + id) || {}).value;
  const id = $('#exam-form').dataset.id || null;
  const old = id ? examById(id) : null;
  const examDate = v('f-date');
  const reviewRaw = v('f-review');
  return {
    id: id || 'draft-' + uid(),
    name: (v('f-ename') || '').trim(),
    totalPages: parseInt(v('f-total')) || 0,
    initialDone: parseInt(v('f-initial')) || 0,
    examDate,
    pagesPerDay: parseInt(v('f-ppd')) || 0,
    reviewDays: reviewRaw === '' || reviewRaw == null ? (examDate ? suggestReview(examDate) : 0) : Math.max(0, parseInt(reviewRaw) || 0),
    createdAt: old ? old.createdAt : today(),
    status: old ? old.status : 'active',
  };
}

function examError(e) {
  if (!e.name) return 'Scrivi il nome della materia.';
  if (e.totalPages < 1) return 'Inserisci il numero di pagine del programma.';
  if (e.initialDone >= e.totalPages) return 'Le pagine già studiate devono essere meno di quelle totali.';
  if (!e.examDate) return "Scegli la data dell'esame.";
  if (e.pagesPerDay < 1) return 'Quante pagine vuoi studiare al giorno?';
  return null;
}

function examPreview() {
  const form = $('#exam-form');
  if (!form) return '';
  const e = readExamForm();
  if (!e.totalPages || !e.examDate || !e.pagesPerDay) return '';
  if (e.examDate <= today()) return `<div class="note warn">La data dell'esame deve essere nel futuro.</div>`;
  const a = analyze(e);
  const capW = capacityWarning(e);
  const parts = [];
  parts.push(`<div class="note"><div class="note-t">IL PIANO</div>
    <div class="note-grid">
      <div><b>${a.studyDays}</b><small>giorni di studio</small></div>
      <div><b>${isFinite(a.perDay) ? a.perDay : '–'}</b><small>pagine al giorno</small></div>
      <div><b>${fmtDate(a.rs)}</b><small>inizio ripasso</small></div>
    </div>
    ${a.finish ? `<p>Finisci il programma il <b>${fmtDate(a.finish)}</b>.</p>` : ''}</div>`);
  for (const w of a.warnings) parts.push(`<div class="note warn">${w}</div>`);
  if (capW) parts.push(`<div class="note warn">${capW}</div>`);
  return parts.join('');
}

/* ---------- Oggi ---------- */
function renderToday() {
  const t = today();
  const st = computeStreak();
  const studyToday = isStudyDay(t);
  const hour = new Date().getHours();
  const hello = hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  let sub;
  if (st.todayDone) sub = 'Oggi è fatta. La serie è al sicuro.';
  else if (studyToday) sub = st.streak ? 'Studia oggi per tenere accesa la fiamma.' : 'Oggi è il giorno giusto per iniziare una serie.';
  else sub = 'Giorno libero: la serie non si rompe.';

  const mon = addDays(t, -((dow(t) + 6) % 7));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    let cls = 'future', mark = '';
    if (d <= t) {
      if (st.act.has(d)) { cls = 'done'; mark = ic('check'); }
      else if (st.saved.has(d)) { cls = 'saved'; mark = '🛟'; }
      else if (d === t) cls = 'today';
      else if (isStudyDay(d) && hasExamOn(d) && d >= state.createdAt) cls = 'miss';
      else cls = 'rest';
    } else if (!isStudyDay(d)) cls = 'future rest';
    week.push(`<div class="wd ${cls} ${d === t ? 'is-today' : ''}"><small>${DAY_SHORT[dow(d)]}</small><i>${mark}</i></div>`);
  }

  const exams = activeExams().sort((a, b) => a.examDate.localeCompare(b.examDate));
  const tasks = exams.map(e => taskCard(e, t)).join('');

  return hero(circleBtn('info', 'streakInfo', 'Come funziona la serie'), cap(fmtDay(t)).toUpperCase(), circleBtn('sliders', 'openSettings', 'Impostazioni'), `
      <p class="hero-hello">${hello}${state.name ? ', ' + esc(state.name) : ''}</p>
      <div class="streak-row ${st.todayDone ? 'lit' : ''}">
        <div class="mega num">${st.streak}</div>
        ${sticker(`RECORD<b>${st.best}</b>`)}
      </div>
      <div class="mega-sub">${st.streak === 1 ? 'GIORNO DI FILA' : 'GIORNI DI FILA'}</div>
      <p class="hero-sub">${sub}</p>
      <div class="week">${week.join('')}</div>
      <div class="hero-foot">${dpill(`${st.jolly} ${st.jolly === 1 ? 'jolly' : 'jolly'} 🛟`)}${st.todayDone ? dpill('Oggi fatto ✓') : dpill(studyToday ? 'Da fare oggi' : 'Giorno libero')}</div>`) + `
    <div class="wrap">
      <h2 class="sec">DA FARE OGGI</h2>
      ${tasks || `<div class="empty">Nessun esame attivo.${cta('Aggiungi un esame', 'newExam', { icon: 'plus' })}</div>`}
    </div>`;
}

function taskCard(e, t) {
  const p = planFor(e, t);
  const log = getLog(t, e.id);
  const done = log ? log.pages : 0;
  const daysLeft = diffDays(t, e.examDate);
  const when = daysLeft > 0 ? 'tra ' + plural(daysLeft, 'giorno', 'giorni') : daysLeft === 0 ? 'esame oggi' : 'esame passato';
  const head = `<div class="card-h"><h3>${esc(e.name)}</h3>${dpill(when)}</div>`;
  const prog = progress(doneTotal(e), e.totalPages);

  if (p.phase === 'after') return `<article class="card">${head}
      <p class="card-p">Com'è andato l'esame?</p>
      ${cta('Superato!', 'passed', { id: e.id, icon: 'trophy' })}
      <button class="btn-line" data-a="editExam" data-id="${e.id}">Cambia data</button></article>`;
  if (p.phase === 'examday') return `<article class="card hl">${head}<p class="big-txt">IN BOCCA AL LUPO! 🍀</p></article>`;
  if (p.phase === 'rest') return `<article class="card ${done ? 'ok' : 'soft'}">${head}
      <p class="card-p">${done ? `Giorno libero, ma hai studiato ${plural(done, 'pagina', 'pagine')} 💪` : 'Giorno libero 😌'}</p>${prog}
      <button class="btn-line" data-a="checkin" data-id="${e.id}">${done ? 'Aggiorna le pagine' : 'Studia lo stesso'}</button></article>`;
  if (p.phase === 'review' || p.phase === 'finished') {
    const ok = log && log.review;
    return `<article class="card ${ok ? 'ok' : ''}">${head}
      <p class="card-p">${p.phase === 'review' ? 'Giorno di ripasso' : 'Programma finito! Puoi già ripassare.'}</p>${prog}
      ${cta(ok ? 'Ripassato ✓' : 'Ho ripassato oggi', 'toggleReview', { id: e.id, icon: 'review', cls: ok ? 'done' : '' })}</article>`;
  }
  const ok = done >= p.target;
  const pct = Math.min(100, Math.round(done / p.target * 100));
  return `<article class="card ${ok ? 'ok' : ''}">${head}
    <div class="goal">
      <div class="ring" style="--p:${pct}"><span>${done}<small>/${p.target}</small></span></div>
      <div><div class="goal-t">${ok ? 'OBIETTIVO RAGGIUNTO' : p.target + ' PAGINE OGGI'}</div>
        <div class="goal-s">pag. ${p.from}–${p.to}${p.phase === 'catchup' ? ' · recupero prima del ripasso' : ''}</div></div>
    </div>
    ${prog}
    ${cta(done ? 'Aggiorna' : 'Segna le pagine', 'checkin', { id: e.id, cls: ok ? 'done' : '' })}
  </article>`;
}

/* ---------- Esami ---------- */
function renderExams() {
  const list = [...state.exams].sort((a, b) => (a.status !== 'active') - (b.status !== 'active') || a.examDate.localeCompare(b.examDate));
  return hero(null, 'I MIEI ESAMI', circleBtn('plus', 'newExam', 'Nuovo esame'), `<h1 class="mega">ESAMI</h1>
      <p class="hero-sub">${plural(activeExams().length, 'esame in corso', 'esami in corso')}</p>`) + `
    <div class="wrap">
    ${list.map(e => {
    const total = doneTotal(e);
    const d = diffDays(today(), e.examDate);
    const status = e.status === 'passed' ? dpill('Superato 🏆', false)
      : d > 0 ? dpill('tra ' + plural(d, 'giorno', 'giorni')) : d === 0 ? dpill('oggi') : dpill('da aggiornare');
    return `<button class="card exam-card" data-a="openExam" data-id="${e.id}">
        <div class="card-h">${status}<span class="go">${ic('arrow')}</span></div>
        <h3 class="exam-name">${esc(e.name)}</h3>
        <div class="goal-s">Esame ${fmtDay(e.examDate)}</div>
        ${progress(total, e.totalPages)}
      </button>`;
  }).join('') || `<div class="empty">Ancora nessun esame.${cta('Aggiungi un esame', 'newExam', { icon: 'plus' })}</div>`}
    </div>`;
}

function renderExamDetail(e) {
  if (!e) { ui.examId = null; return renderExams(); }
  const a = analyze(e);
  const total = doneTotal(e);
  const capW = e.status === 'active' ? capacityWarning() : null;
  const rows = [];
  if (e.status === 'active') {
    let done = a.done, d = today();
    for (let i = 0; i < 60 && rows.length < 14 && d < e.examDate; i++, d = addDays(d, 1)) {
      const p = dayPlan(e, d, done);
      if (d === today()) { const l = getLog(d, e.id); done += Math.max(p.target, l ? l.pages : 0); if (!p.target) continue; }
      else done += p.target;
      if (p.phase === 'rest') continue;
      const lbl = p.target ? `<b>${p.target} pag.</b> <span>${p.from}–${p.to}</span>` : p.phase === 'review' || p.phase === 'finished' ? '<b>ripasso</b>' : '';
      rows.push(`<li><span>${fmtDay(d)}</span><span>${lbl}</span></li>`);
    }
    if (d === e.examDate || rows.length < 14) rows.push(`<li class="hl"><span>${fmtDay(e.examDate)}</span><span><b>ESAME</b></span></li>`);
  }
  const hist = logsOf(e.id).filter(l => l.pages > 0 || l.review).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 30)
    .map(l => `<li><span>${fmtDay(l.date)}</span><span><b>${l.pages ? l.pages + ' pag.' : ''}${l.review ? ' ripasso' : ''}</b></span></li>`).join('');

  return hero(circleBtn('back', 'backExams', 'Indietro'), e.status === 'passed' ? 'SUPERATO 🏆' : 'ESAME', circleBtn('pencil', 'editExam', 'Modifica', `data-id="${e.id}"`), `
      <h1 class="mega md">${esc(e.name).toUpperCase()}</h1>
      <p class="hero-sub">Esame ${fmtDay(e.examDate)}</p>
      <div class="stats">
        <div><b>${Math.round(total / e.totalPages * 100)}%</b><small>fatto</small></div>
        <div><b>${e.totalPages - total}</b><small>pagine rimaste</small></div>
        <div><b>${e.status === 'active' && isFinite(a.perDay) ? a.perDay : '–'}</b><small>pag. al giorno</small></div>
      </div>`) + `
    <div class="wrap">
      <article class="card">
        <div class="card-h"><h3>PROGRESSO</h3>${ic('book')}</div>
        ${progress(total, e.totalPages)}
        ${e.status === 'active' ? `<p class="card-p small">Ripasso dal ${fmtDate(a.rs)} (${plural(e.reviewDays, 'giorno', 'giorni')})${a.finish ? ' · fine programma prevista il ' + fmtDate(a.finish) : ''}</p>` : ''}
      </article>
      ${a.warnings.map(w => `<div class="note warn">${w}</div>`).join('')}
      ${capW ? `<div class="note warn">${capW}</div>` : ''}
      ${rows.length ? `<article class="card"><div class="card-h"><h3>PROSSIMI GIORNI</h3>${ic('calendar')}</div><ul class="plan">${rows.join('')}</ul></article>` : ''}
      ${hist ? `<article class="card"><div class="card-h"><h3>STORICO</h3>${ic('review')}</div><ul class="plan">${hist}</ul></article>` : ''}
      <button class="btn-danger" data-a="deleteExam" data-id="${e.id}">${ic('trash')} Elimina esame</button>
    </div>`;
}

/* ---------- Trofei ---------- */
function renderTrophies() {
  const won = TROPHIES.filter(t => state.trophies[t.id]).length;
  return hero(null, 'BACHECA', `<span class="count">${won}/${TROPHIES.length}</span>`, `<h1 class="mega">TROFEI</h1>
      ${progress(won, TROPHIES.length, 'sbloccati')}`) + `
    <div class="wrap">
    <div class="trophies">
      ${TROPHIES.map(t => {
    const d = state.trophies[t.id];
    return `<div class="trophy ${d ? 'won' : ''}">
          <div class="t-icon">${d ? t.icon : ic('lock')}</div>
          <b>${t.name}</b><small>${t.desc}</small>
          ${d ? `<em>${fmtDate(d)}</em>` : ''}
        </div>`;
  }).join('')}
    </div></div>`;
}

/* ---------- sheet (finestre dal basso) ---------- */
function openSheet(html) { $('#sheet').innerHTML = `<div class="grab"></div>` + html; $('#sheet-wrap').hidden = false; requestAnimationFrame(() => $('#sheet-wrap').classList.add('open')); }
function closeSheet() { const w = $('#sheet-wrap'); w.classList.remove('open'); setTimeout(() => { w.hidden = true; $('#sheet').innerHTML = ''; }, 250); }

function renderCheckin() {
  const { examId, date, value } = ui.checkin;
  const e = examById(examId);
  const p = planFor(e, date);
  const t = today();
  return `
    <h2 class="sheet-t">${esc(e.name).toUpperCase()}</h2>
    <div class="seg">
      <button class="${date === t ? 'on' : ''}" data-a="ciDate" data-v="0">Oggi</button>
      <button class="${date !== t ? 'on' : ''}" data-a="ciDate" data-v="-1">Ieri</button>
    </div>
    <p class="center sheet-p">${p.target ? `Obiettivo: <b>${p.target} pagine</b> · pag. ${p.from}–${p.to}` : 'Nessun obiettivo per questo giorno: ogni pagina è un bonus.'}</p>
    <div class="counter">
      <button data-a="ciAdd" data-v="-1" aria-label="meno">−</button>
      <div><input id="ci-val" type="number" inputmode="numeric" min="0" value="${value}"><small>pagine</small></div>
      <button data-a="ciAdd" data-v="1" aria-label="più">+</button>
    </div>
    <div class="quick">
      <button class="chip" data-a="ciAdd" data-v="5">+5</button>
      <button class="chip" data-a="ciAdd" data-v="10">+10</button>
      ${p.target ? `<button class="chip lime" data-a="ciSet" data-v="${p.target}">Tutto l'obiettivo</button>` : ''}
    </div>
    ${cta('Salva', 'ciSave', { icon: 'check' })}`;
}

function renderSettings() {
  return `
    <h2 class="sheet-t">IMPOSTAZIONI</h2>
    <label class="field"><span>Nome</span><input id="f-name" type="text" value="${esc(state.name)}"></label>
    <h3 class="sub-t">DISPONIBILITÀ</h3>
    ${availabilityForm()}
    ${cta('Salva', 'saveSettings', { icon: 'check' })}
    <h3 class="sub-t">BACKUP</h3>
    <p class="hint">I dati sono solo su questo telefono. Ogni tanto salva un backup.</p>
    <div class="btn-row">
      <button class="btn-line dark" data-a="exportData">Esporta backup</button>
      <label class="btn-line dark">Importa backup<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>
    <button class="btn-danger" data-a="resetAll">${ic('trash')} Cancella tutti i dati</button>`;
}

function streakInfoSheet() {
  const st = computeStreak();
  return `
    <h2 class="sheet-t">COME FUNZIONA LA SERIE</h2>
    <ul class="rules">
      <li><b>+1</b><span>Ogni giorno in cui segni almeno una pagina (o un ripasso) la serie sale di 1.</span></li>
      <li><b>😌</b><span>I giorni liberi non la rompono. Se studi lo stesso, contano!</span></li>
      <li><b>0</b><span>Se salti un giorno di studio, la serie torna a zero…</span></li>
      <li><b>🛟</b><span>…a meno che tu abbia un jolly: ne guadagni uno ogni 7 giorni di fila (massimo ${MAX_JOLLY}) e si usa da solo.</span></li>
      <li><b>↩</b><span>Hai dimenticato di segnare ieri? Nella finestra delle pagine scegli "Ieri".</span></li>
    </ul>
    <p class="center sheet-p">Record attuale: <b>${st.best}</b> giorni</p>
    ${cta('Ok, ci sto', 'closeSheet', { icon: 'flame' })}`;
}

/* ---------- feedback ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.innerHTML = msg; el.hidden = false; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.hidden = true, 300); }, 2600);
}
function confetti() {
  const colors = ['#D9F43B', '#5B4FE6', '#FFFFFF', '#8F86FF', '#232228'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetto';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
}
function celebrate(trophies) {
  if (!trophies.length) return;
  confetti();
  if (navigator.vibrate) navigator.vibrate(60);
  openSheet(`
    <div class="celebrate">
      <p class="hero-t dark">${trophies.length > 1 ? 'NUOVI TROFEI' : 'NUOVO TROFEO'}</p>
      ${trophies.map(t => `${sticker(t.icon, 't-big')}<h2 class="sheet-t">${t.name.toUpperCase()}</h2><p class="sheet-p">${t.desc}</p>`).join('')}
      ${cta('Evvai!', 'closeSheet', { icon: 'trophy' })}
    </div>`);
}

/* Dopo ogni azione: salva, controlla trofei, aggiorna */
function afterChange(prevStreak) {
  save();
  const fresh = checkTrophies();
  render();
  const st = computeStreak();
  if (fresh.length) setTimeout(() => celebrate(fresh), 380);
  else if (prevStreak != null && st.streak > prevStreak) toast(`🔥 ${st.streak} ${st.streak === 1 ? 'giorno' : 'giorni'} di fila!`);
  return fresh;
}

function setLog(date, examId, patch) {
  let l = getLog(date, examId);
  if (!l) { l = { date, examId, pages: 0, review: false }; state.logs.push(l); }
  Object.assign(l, patch);
  if (!l.pages && !l.review) state.logs = state.logs.filter(x => x !== l);
}

/* ---------- azioni ---------- */
const actions = {
  tab(el) { ui.tab = el.dataset.tab; ui.examId = null; render(); window.scrollTo(0, 0); },
  closeSheet,

  onbNext() {
    if (ui.onb === 0) {
      state.name = ($('#f-name').value || '').trim();
      if (!ui.draftDays) ui.draftDays = { 0: 0, 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 0 };
      ui.onb = 1;
    } else if (ui.onb === 1) {
      if (!Object.values(ui.draftDays).some(h => h > 0)) return toast('Scegli almeno un giorno');
      ui.draftSpeed = Math.max(1, parseInt($('#f-speed').value) || 6);
      state.settings = { days: { ...ui.draftDays }, speed: ui.draftSpeed };
      state.createdAt = today();
      save();
      ui.onb = 2;
    }
    render(); window.scrollTo(0, 0);
  },
  dayToggle(el) {
    const d = el.dataset.d;
    ui.draftDays[d] = ui.draftDays[d] > 0 ? 0 : 2;
    rerenderAvailability();
  },
  dayHours(el) {
    const d = el.dataset.d;
    ui.draftDays[d] = Math.max(0, Math.min(14, (+ui.draftDays[d] || 0) + parseFloat(el.dataset.v)));
    rerenderAvailability();
  },

  newExam() {
    openSheet(`<h2 class="sheet-t">NUOVO ESAME</h2>${examForm(null)}${cta('Crea il piano', 'saveExam', { icon: 'flame' })}`);
  },
  editExam(el) {
    const e = examById(el.dataset.id);
    openSheet(`<h2 class="sheet-t">MODIFICA ESAME</h2>${examForm(e)}${cta('Salva', 'saveExam', { icon: 'check' })}`);
  },
  saveExam() {
    const e = readExamForm();
    const err = examError(e);
    if (err) return toast(err);
    const existing = state.exams.find(x => x.id === e.id);
    if (existing) {
      if (e.examDate > today() && existing.status !== 'passed') e.status = 'active';
      Object.assign(existing, e);
    } else {
      if (e.examDate <= today()) return toast("La data dell'esame deve essere nel futuro");
      e.id = uid();
      state.exams.push(e);
    }
    const wasOnb = ui.onb === 2;
    ui.onb = 0;
    if (!wasOnb) closeSheet();
    ui.tab = wasOnb ? 'today' : ui.tab;
    afterChange();
    if (wasOnb) toast('Piano pronto! 🔥');
  },
  openExam(el) { ui.examId = el.dataset.id; render(); window.scrollTo(0, 0); },
  backExams() { ui.examId = null; render(); },
  deleteExam(el) {
    const e = examById(el.dataset.id);
    if (!confirm(`Eliminare "${e.name}" e tutto il suo storico?`)) return;
    state.exams = state.exams.filter(x => x.id !== e.id);
    state.logs = state.logs.filter(l => l.examId !== e.id);
    ui.examId = null;
    afterChange();
  },
  passed(el) {
    const e = examById(el.dataset.id);
    e.status = 'passed';
    if (!afterChange().length) confetti();
  },

  checkin(el) {
    const t = today();
    const log = getLog(t, el.dataset.id);
    ui.checkin = { examId: el.dataset.id, date: t, value: log ? log.pages : 0 };
    openSheet(renderCheckin());
  },
  ciDate(el) {
    const d = addDays(today(), parseInt(el.dataset.v));
    const log = getLog(d, ui.checkin.examId);
    ui.checkin.date = d; ui.checkin.value = log ? log.pages : 0;
    $('#sheet').innerHTML = '<div class="grab"></div>' + renderCheckin();
  },
  ciAdd(el) {
    const inp = $('#ci-val');
    inp.value = Math.max(0, (parseInt(inp.value) || 0) + parseInt(el.dataset.v));
    ui.checkin.value = +inp.value;
  },
  ciSet(el) { $('#ci-val').value = el.dataset.v; ui.checkin.value = +el.dataset.v; },
  ciSave() {
    const { examId, date } = ui.checkin;
    const e = examById(examId);
    const pages = Math.max(0, parseInt($('#ci-val').value) || 0);
    const maxPages = e.totalPages - doneBefore(e, date) - state.logs.filter(l => l.examId === examId && l.date > date).reduce((s, l) => s + l.pages, 0);
    const prev = computeStreak().streak;
    setLog(date, examId, { pages: Math.min(pages, Math.max(0, maxPages)) });
    closeSheet();
    afterChange(prev);
  },
  toggleReview(el) {
    const t = today();
    const log = getLog(t, el.dataset.id);
    const prev = computeStreak().streak;
    setLog(t, el.dataset.id, { review: !(log && log.review) });
    afterChange(prev);
  },

  streakInfo() { openSheet(streakInfoSheet()); },
  openSettings() {
    ui.draftDays = { ...state.settings.days };
    ui.draftSpeed = state.settings.speed;
    openSheet(renderSettings());
  },
  saveSettings() {
    if (!Object.values(ui.draftDays).some(h => h > 0)) return toast('Scegli almeno un giorno');
    state.name = ($('#f-name').value || '').trim();
    state.settings = { days: { ...ui.draftDays }, speed: Math.max(1, parseInt($('#f-speed').value) || 6) };
    closeSheet();
    afterChange();
    toast('Salvato');
  },
  async exportData() {
    const json = JSON.stringify(state, null, 2);
    const name = `costante-backup-${today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Backup Costante' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  resetAll() {
    if (!confirm('Cancellare davvero tutti i dati? Esami, storico e trofei andranno persi.')) return;
    localStorage.removeItem(KEY);
    state = freshState();
    ui.onb = 0; ui.tab = 'today'; ui.examId = null;
    closeSheet(); render();
  },
};

function rerenderAvailability() {
  const speed = $('#f-speed') ? $('#f-speed').value : ui.draftSpeed;
  ui.draftSpeed = speed;
  const tmp = document.createElement('div');
  tmp.innerHTML = availabilityForm();
  $('.days').replaceWith(tmp.querySelector('.days'));
}

/* ---------- eventi ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || !actions[el.dataset.a]) return;
  e.preventDefault();
  actions[el.dataset.a](el);
});
document.addEventListener('input', e => {
  if (e.target.closest('#exam-form')) { const p = $('#preview'); if (p) p.innerHTML = examPreview(); }
  if (e.target.id === 'ci-val') ui.checkin.value = parseInt(e.target.value) || 0;
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'import-file') return;
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data.version || !Array.isArray(data.exams)) throw new Error();
    if (!confirm('Sostituire i dati attuali con quelli del backup?')) return;
    state = data; save(); closeSheet(); render(); toast('Backup importato');
  } catch { toast('File di backup non valido'); }
});
// Se l'app resta aperta oltre la mezzanotte o torna in primo piano, aggiorna
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkTrophies(); render(); } });

$('#tabs').innerHTML = `
  <button data-a="tab" data-tab="exams" aria-label="Esami">${ic('book')}<small>Esami</small></button>
  <button data-a="tab" data-tab="today" class="center" aria-label="Oggi">${ic('flame')}</button>
  <button data-a="tab" data-tab="trophies" aria-label="Trofei">${ic('trophy')}<small>Trofei</small></button>`;
if (!state.settings) ui.onb = 0;
else if (!state.exams.length) ui.onb = 2;
checkTrophies();
render();
