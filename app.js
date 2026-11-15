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
    <section class="onb center">
      <div class="logo">🔥</div>
      <h1>Costante</h1>
      <p class="muted">Un passo al giorno fino all'esame.<br>Ti preparo un piano di studio, tu tieni viva la fiamma.</p>
      <label class="field"><span>Come ti chiami?</span>
        <input id="f-name" type="text" autocomplete="given-name" placeholder="Il tuo nome" value="${esc(state.name)}"></label>
      <button class="btn primary big" data-a="onbNext">Iniziamo</button>
    </section>`;
  if (ui.onb === 1) return `
    <section class="onb">
      <div class="step">Passo 1 di 2</div>
      <h1>Quando puoi studiare?</h1>
      <p class="muted">Scegli i giorni e quante ore hai a disposizione. Vale per tutti gli esami.</p>
      ${availabilityForm()}
      <button class="btn primary big" data-a="onbNext">Avanti</button>
    </section>`;
  return `
    <section class="onb">
      <div class="step">Passo 2 di 2</div>
      <h1>Il primo esame</h1>
      ${examForm(null)}
      <button class="btn primary big" data-a="saveExam">Crea il piano</button>
    </section>`;
}

function availabilityForm() {
  const days = ui.draftDays;
  return `
    <div class="days">
      ${DAY_ORDER.map(d => {
    const h = +days[d] || 0;
    return `<div class="day-row ${h > 0 ? 'on' : ''}">
          <button class="day-toggle" data-a="dayToggle" data-d="${d}">${DAY_NAMES[d]}</button>
          ${h > 0 ? `<div class="stepper">
              <button data-a="dayHours" data-d="${d}" data-v="-0.5">−</button>
              <span>${String(h).replace('.', ',')} h</span>
              <button data-a="dayHours" data-d="${d}" data-v="0.5">+</button></div>`
        : `<span class="muted small">libero</span>`}
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
  const cap = capacityWarning(e);
  const parts = [];
  parts.push(`<div class="note"><b>Il piano</b><br>
    ${plural(a.studyDays, 'giorno', 'giorni')} di studio, poi ripasso dal <b>${fmtDate(a.rs)}</b>.<br>
    ${isFinite(a.perDay) ? `Circa <b>${a.perDay} pagine</b> per giorno di studio.` : ''}
    ${a.finish ? `<br>Finisci il programma il <b>${fmtDate(a.finish)}</b>.` : ''}</div>`);
  for (const w of a.warnings) parts.push(`<div class="note warn">${w}</div>`);
  if (cap) parts.push(`<div class="note warn">${cap}</div>`);
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
  if (st.todayDone) sub = 'Oggi è fatta ✓ La serie è al sicuro.';
  else if (studyToday) sub = st.streak ? 'Studia oggi per tenere accesa la fiamma.' : 'Oggi è il giorno giusto per iniziare una serie.';
  else sub = 'Oggi è giorno libero: la serie non si rompe.';

  // settimana corrente lun-dom
  const mon = addDays(t, -((dow(t) + 6) % 7));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    let cls = 'future', mark = '';
    if (d <= t) {
      if (st.act.has(d)) { cls = 'done'; mark = '✓'; }
      else if (st.saved.has(d)) { cls = 'saved'; mark = '🛟'; }
      else if (d === t) { cls = 'today'; }
      else if (isStudyDay(d) && hasExamOn(d) && d >= state.createdAt) { cls = 'miss'; mark = '·'; }
      else { cls = 'rest'; mark = '–'; }
    } else if (!isStudyDay(d)) cls = 'future rest';
    week.push(`<div class="wd ${cls} ${d === t ? 'is-today' : ''}"><small>${DAY_SHORT[dow(d)]}</small><i>${mark}</i></div>`);
  }

  const exams = activeExams().sort((a, b) => a.examDate.localeCompare(b.examDate));
  const tasks = exams.map(e => taskCard(e, t)).join('');

  return `
    <header class="top">
      <div><p class="muted small">${hello}${state.name ? ', ' + esc(state.name) : ''}</p>
      <h1>${fmtDay(t).replace(/^\w/, c => c.toUpperCase())}</h1></div>
      <button class="icon-btn" data-a="openSettings" aria-label="Impostazioni">⚙️</button>
    </header>

    <section class="streak-card ${st.todayDone ? 'lit' : ''}" data-a="streakInfo">
      <div class="flame">🔥</div>
      <div class="streak-num">${st.streak}</div>
      <div class="streak-lbl">${st.streak === 1 ? 'giorno di fila' : 'giorni di fila'}</div>
      <p class="streak-sub">${sub}</p>
      <div class="week">${week.join('')}</div>
      <div class="streak-meta"><span>🛟 ${st.jolly} jolly</span><span>Record: ${st.best}</span></div>
    </section>

    <h2>Da fare oggi</h2>
    ${tasks || `<div class="empty">Nessun esame attivo. <button class="link" data-a="newExam">Aggiungine uno</button></div>`}
  `;
}

function taskCard(e, t) {
  const p = planFor(e, t);
  const log = getLog(t, e.id);
  const done = log ? log.pages : 0;
  const daysLeft = diffDays(t, e.examDate);
  const head = `<div class="task-head"><b>${esc(e.name)}</b><span class="pill">${daysLeft > 0 ? 'esame tra ' + plural(daysLeft, 'giorno', 'giorni') : daysLeft === 0 ? 'esame oggi' : 'esame passato'}</span></div>`;
  const total = doneTotal(e);
  const bar = `<div class="bar"><i style="width:${Math.round(total / e.totalPages * 100)}%"></i></div>
    <div class="small muted">${total}/${e.totalPages} pagine del programma</div>`;

  if (p.phase === 'after') return `<div class="task">${head}
      <p>Com'è andato l'esame?</p>
      <div class="btns"><button class="btn primary" data-a="passed" data-id="${e.id}">Superato 🎉</button>
      <button class="btn" data-a="editExam" data-id="${e.id}">Cambia data</button></div></div>`;
  if (p.phase === 'examday') return `<div class="task hl">${head}<p class="big-txt">In bocca al lupo! 🍀</p></div>`;
  if (p.phase === 'rest') return `<div class="task ${done ? 'ok' : 'rest'}">${head}
      <p class="${done ? '' : 'muted'}">${done ? `Giorno libero, ma hai studiato ${plural(done, 'pagina', 'pagine')} 💪` : 'Giorno libero 😌'}</p>${bar}
      <div class="btns"><button class="btn ghost" data-a="checkin" data-id="${e.id}">${done ? 'Aggiorna' : 'Studia lo stesso'}</button></div></div>`;
  if (p.phase === 'review' || p.phase === 'finished') {
    const ok = log && log.review;
    return `<div class="task ${ok ? 'ok' : ''}">${head}
      <p>${p.phase === 'review' ? '🔁 Giorno di ripasso' : '🎉 Programma finito! Puoi già ripassare.'}</p>
      <div class="btns"><button class="btn ${ok ? '' : 'primary'}" data-a="toggleReview" data-id="${e.id}">${ok ? '✓ Ripassato' : 'Ho ripassato oggi'}</button></div></div>`;
  }
  const ok = done >= p.target;
  const pct = Math.min(100, Math.round(done / p.target * 100));
  return `<div class="task ${ok ? 'ok' : ''}">${head}
    <div class="goal">
      <div class="ring" style="--p:${pct}"><span>${done}<small>/${p.target}</small></span></div>
      <div><div class="goal-t">${ok ? 'Obiettivo raggiunto! 🎯' : p.target + ' pagine oggi'}</div>
        <div class="muted small">pag. ${p.from}–${p.to}${p.phase === 'catchup' ? ' · recupero prima del ripasso' : ''}</div></div>
    </div>
    ${bar}
    <div class="btns"><button class="btn ${ok ? '' : 'primary'}" data-a="checkin" data-id="${e.id}">${done ? 'Aggiorna' : 'Segna le pagine'}</button></div>
  </div>`;
}

/* ---------- Esami ---------- */
function renderExams() {
  const list = [...state.exams].sort((a, b) => (a.status !== 'active') - (b.status !== 'active') || a.examDate.localeCompare(b.examDate));
  return `
    <header class="top"><h1>Esami</h1><button class="btn primary sm" data-a="newExam">+ Nuovo</button></header>
    ${list.map(e => {
    const total = doneTotal(e);
    const pct = Math.round(total / e.totalPages * 100);
    const d = diffDays(today(), e.examDate);
    const status = e.status === 'passed' ? '<span class="pill ok">Superato 🏆</span>'
      : d > 0 ? `<span class="pill">tra ${plural(d, 'giorno', 'giorni')}</span>` : d === 0 ? '<span class="pill">oggi</span>' : '<span class="pill warn">da aggiornare</span>';
    return `<button class="card exam" data-a="openExam" data-id="${e.id}">
        <div class="task-head"><b>${esc(e.name)}</b>${status}</div>
        <div class="small muted">Esame il ${fmtDate(e.examDate)} · ${total}/${e.totalPages} pagine</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </button>`;
  }).join('') || '<div class="empty">Ancora nessun esame.</div>'}`;
}

function renderExamDetail(e) {
  if (!e) { ui.examId = null; return renderExams(); }
  const a = analyze(e);
  const total = doneTotal(e);
  const cap = e.status === 'active' ? capacityWarning() : null;
  // proiezione prossimi giorni
  const rows = [];
  if (e.status === 'active') {
    let done = a.done, d = today();
    for (let i = 0; i < 60 && rows.length < 14 && d < e.examDate; i++, d = addDays(d, 1)) {
      const p = dayPlan(e, d, done);
      if (d === today()) { const l = getLog(d, e.id); done += Math.max(p.target, l ? l.pages : 0); if (!p.target) continue; }
      else done += p.target;
      if (p.phase === 'rest') continue;
      const lbl = p.target ? `${p.target} pag. <span class="muted">(${p.from}–${p.to})</span>` : p.phase === 'review' || p.phase === 'finished' ? '🔁 ripasso' : '';
      rows.push(`<li><span>${fmtDay(d)}</span><span>${lbl}</span></li>`);
    }
    if (d === e.examDate || rows.length < 14) rows.push(`<li class="hl"><span>${fmtDay(e.examDate)}</span><span>📝 esame</span></li>`);
  }
  const hist = logsOf(e.id).filter(l => l.pages > 0 || l.review).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 30)
    .map(l => `<li><span>${fmtDay(l.date)}</span><span>${l.pages ? l.pages + ' pag.' : ''}${l.review ? ' 🔁' : ''}</span></li>`).join('');

  return `
    <header class="top"><button class="link back" data-a="backExams">‹ Esami</button>
      <button class="btn sm" data-a="editExam" data-id="${e.id}">Modifica</button></header>
    <h1>${esc(e.name)}</h1>
    <p class="muted">Esame ${fmtDay(e.examDate)}${e.status === 'passed' ? ' · superato 🏆' : ''}</p>
    <div class="stats">
      <div><b>${Math.round(total / e.totalPages * 100)}%</b><small>fatto</small></div>
      <div><b>${e.totalPages - total}</b><small>pagine rimaste</small></div>
      <div><b>${e.status === 'active' && isFinite(a.perDay) ? a.perDay : '–'}</b><small>pag./giorno</small></div>
    </div>
    <div class="bar"><i style="width:${Math.round(total / e.totalPages * 100)}%"></i></div>
    ${e.status === 'active' ? `<p class="small muted">Ripasso dal ${fmtDate(a.rs)} (${plural(e.reviewDays, 'giorno', 'giorni')})${a.finish ? ' · fine programma prevista ' + fmtDate(a.finish) : ''}</p>` : ''}
    ${a.warnings.map(w => `<div class="note warn">${w}</div>`).join('')}
    ${cap ? `<div class="note warn">${cap}</div>` : ''}
    ${rows.length ? `<h2>Prossimi giorni</h2><ul class="plan">${rows.join('')}</ul>` : ''}
    ${hist ? `<h2>Storico</h2><ul class="plan">${hist}</ul>` : ''}
    <button class="btn danger-ghost" data-a="deleteExam" data-id="${e.id}">Elimina esame</button>`;
}

/* ---------- Trofei ---------- */
function renderTrophies() {
  const won = TROPHIES.filter(t => state.trophies[t.id]).length;
  return `
    <header class="top"><h1>Trofei</h1><span class="pill">${won}/${TROPHIES.length}</span></header>
    <div class="trophies">
      ${TROPHIES.map(t => {
    const d = state.trophies[t.id];
    return `<div class="trophy ${d ? 'won' : ''}">
          <div class="t-icon">${d ? t.icon : '🔒'}</div>
          <b>${t.name}</b><small>${t.desc}</small>
          ${d ? `<em>${fmtDate(d)}</em>` : ''}
        </div>`;
  }).join('')}
    </div>`;
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
    <h2>${esc(e.name)}</h2>
    <div class="seg">
      <button class="${date === t ? 'on' : ''}" data-a="ciDate" data-v="0">Oggi</button>
      <button class="${date !== t ? 'on' : ''}" data-a="ciDate" data-v="-1">Ieri</button>
    </div>
    <p class="muted center">${p.target ? `Obiettivo: <b>${p.target} pagine</b> (pag. ${p.from}–${p.to})` : 'Nessun obiettivo per questo giorno: ogni pagina è un bonus.'}</p>
    <p class="center small">Quante pagine hai studiato?</p>
    <div class="counter">
      <button data-a="ciAdd" data-v="-1">−</button>
      <input id="ci-val" type="number" inputmode="numeric" min="0" value="${value}">
      <button data-a="ciAdd" data-v="1">+</button>
    </div>
    <div class="quick">
      <button class="chip" data-a="ciAdd" data-v="5">+5</button>
      <button class="chip" data-a="ciAdd" data-v="10">+10</button>
      ${p.target ? `<button class="chip" data-a="ciSet" data-v="${p.target}">Tutto l'obiettivo</button>` : ''}
    </div>
    <button class="btn primary big" data-a="ciSave">Salva</button>`;
}

function renderSettings() {
  return `
    <h2>Impostazioni</h2>
    <label class="field"><span>Nome</span><input id="f-name" type="text" value="${esc(state.name)}"></label>
    <h3>Disponibilità</h3>
    ${availabilityForm()}
    <button class="btn primary big" data-a="saveSettings">Salva</button>
    <h3>Backup</h3>
    <p class="hint">I dati sono solo su questo telefono. Ogni tanto salva un backup.</p>
    <div class="btns">
      <button class="btn" data-a="exportData">Esporta backup</button>
      <label class="btn">Importa backup<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>
    <button class="btn danger-ghost" data-a="resetAll">Cancella tutti i dati</button>`;
}

function streakInfoSheet() {
  const st = computeStreak();
  return `
    <h2>Come funziona la serie 🔥</h2>
    <ul class="rules">
      <li>Ogni giorno in cui segni almeno una pagina (o un ripasso) la serie sale di 1.</li>
      <li>I giorni liberi non contano: non la rompono e non la fanno salire (a meno che tu studi lo stesso).</li>
      <li>Se salti un giorno di studio, la serie torna a zero…</li>
      <li>…a meno che tu abbia un <b>jolly 🛟</b>: ne guadagni uno ogni 7 giorni di fila (massimo ${MAX_JOLLY}) e si usa da solo.</li>
      <li>Hai dimenticato di segnare ieri? Nella finestra delle pagine puoi scegliere "Ieri".</li>
    </ul>
    <p class="center">Record attuale: <b>${st.best}</b> giorni</p>
    <button class="btn big" data-a="closeSheet">Ok</button>`;
}

/* ---------- feedback ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.innerHTML = msg; el.hidden = false; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.hidden = true, 300); }, 2600);
}
function confetti() {
  const colors = ['#FF6B4A', '#FFC24B', '#4ACB8F', '#5B8DEF', '#E35BB0'];
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
    <div class="center celebrate">
      <p class="muted">${trophies.length > 1 ? 'Nuovi trofei!' : 'Nuovo trofeo!'}</p>
      ${trophies.map(t => `<div class="t-big">${t.icon}</div><h2>${t.name}</h2><p class="muted">${t.desc}</p>`).join('')}
      <button class="btn primary big" data-a="closeSheet">Evvai!</button>
    </div>`);
}

/* Dopo ogni azione: salva, controlla trofei, aggiorna */
function afterChange(prevStreak) {
  save();
  const fresh = checkTrophies();
  render();
  const st = computeStreak();
  if (fresh.length) setTimeout(() => celebrate(fresh), 250);
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
    openSheet(`<h2>Nuovo esame</h2>${examForm(null)}<button class="btn primary big" data-a="saveExam">Crea il piano</button>`);
  },
  editExam(el) {
    const e = examById(el.dataset.id);
    openSheet(`<h2>Modifica esame</h2>${examForm(e)}<button class="btn primary big" data-a="saveExam">Salva</button>`);
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

if (!state.settings) ui.onb = 0;
else if (!state.exams.length) ui.onb = 2;
checkTrophies();
render();
