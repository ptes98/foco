"use strict";

// Claves guardadas en el navegador. Se mantiene el prefijo v1 para no perder los recuentos de antes.
const prefix = "foco:v1:";
const sessionKey = `${prefix}session`;
const deckKey = `${prefix}card`;
const contextKey = `${prefix}context`;
const openingKey = `${prefix}opening`;
const hiddenAtKey = `${prefix}hiddenAt`;
const logKey = `${prefix}log`;
const visitsPrefix = `${prefix}visits:`;
const restsPrefix = `${prefix}rests:`;
const restDonePrefix = `${prefix}restdone:`;
const donePrefix = `${prefix}done:`;

const OPENING_GAP = 2 * 60_000; // volver tras 2 min o más fuera cuenta como apertura nueva
const STALE_AFTER = 30 * 60_000; // sesión o tarjeta de hace más de 30 min: se pregunta
const TAP_GUARD = 600; // ms en los que se ignoran toques tras cambiar de pantalla
const LOG_DAYS = 21; // días que se guarda el registro (se pidieron al menos 14)
const DECK_SIZE = 3; // tarjetas como mucho por apertura y contexto
const CONTEXTS = ["Casa", "Taller", "Campo", "Cansado"];

const $ = (selector) => document.querySelector(selector);
const screens = {
  inicio: $("#inicio"),
  sesion: $("#sesion"),
  tarjeta: $("#tarjeta"),
  pregunta: $("#pregunta"),
};
const homeTitle = $("#titulo-inicio");
const sessionTitle = $("#titulo-sesion");
const taskButton = $("#tarea");
const restButton = $("#descanso");
const clock = $("#reloj");
const finish = $("#fin");
const doneButton = $("#hecho");
const backButton = $("#volver");
const error = $("#error");
const cardEl = $("#carta");
const cardText = $("#carta-texto");
const cardMinutes = $("#carta-min");
const cardDoneText = $("#carta-hecha");
const dots = $("#puntos");
const hint = $("#pista");
const endView = $("#fin-mazo");
const endTitle = $("#fin-mazo-titulo");
const endList = $("#lista-mazo");
const actions = $("#acciones");
const deckDoneButton = $("#hecho-tarjeta");
const anotherButton = $("#otra");
const today = $("#hoy");
const todayList = $("#hoy-lista");
const pill = $("#pill-hechas");
const chips = [...document.querySelectorAll("[data-ctx]")];
const ghosts = [$("#fantasma-1"), $("#fantasma-2")];
const questionTitle = $("#pregunta-titulo");
const questionText = $("#pregunta-texto");

const temporaryStorage = new Map();
let currentScreen = null;
let screenShownAt = Date.now();
let guardUntil = 0;
let currentSession = null;
let clockTimeout;
let midnightTimeout;
let tasks;
let taskRequest = 0;
let cards = null;
let cardsPromise = null;
let deck = null;
let opening = null;
let pending = null;
let away = false;
let coldPending = false;
let drag = null;

// ---------- Almacenamiento ----------

function read(key) {
  if (temporaryStorage.has(key)) return temporaryStorage.get(key);
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    temporaryStorage.delete(key);
  } catch {
    temporaryStorage.set(key, value);
  }
}

function readJSON(key) {
  try {
    return JSON.parse(read(key));
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  write(key, value === null ? null : JSON.stringify(value));
}

function storedKeys() {
  const keys = new Set(temporaryStorage.keys());
  try {
    for (let index = 0; index < localStorage.length; index += 1) keys.add(localStorage.key(index));
  } catch {
    // La visita sigue funcionando aunque el almacenamiento esté bloqueado.
  }
  return keys;
}

function bump(key) {
  const count = Number(read(key));
  write(key, String((Number.isSafeInteger(count) && count >= 0 ? count : 0) + 1));
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ---------- Fechas ----------

function pad(number) {
  return String(Math.floor(Math.abs(number))).padStart(2, "0");
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localISO(ms) {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

function secondsSince(ms) {
  return Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 1000)) : null;
}

// ---------- Registro de eventos ----------

function readLog() {
  const list = readJSON(logKey);
  return Array.isArray(list) ? list : [];
}

function writeLog(list) {
  try {
    localStorage.setItem(logKey, JSON.stringify(list));
    temporaryStorage.delete(logKey);
  } catch {
    // Si no cabe, se queda la mitad más reciente.
    const newest = JSON.stringify(list.slice(Math.floor(list.length / 2)));
    try {
      localStorage.setItem(logKey, newest);
      temporaryStorage.delete(logKey);
    } catch {
      temporaryStorage.set(logKey, newest);
    }
  }
}

function log(ev, data = {}) {
  const entry = { t: localISO(Date.now()), ev };
  if (opening) {
    entry.ap = opening.id;
    if (opening.variant) entry.var = opening.variant;
  }
  Object.assign(entry, data);
  const list = readLog();
  list.push(entry);
  writeLog(list);
}

function pruneLog() {
  const limit = Date.now() - LOG_DAYS * 86_400_000;
  const list = readLog();
  const kept = list.filter((entry) => !(Date.parse(entry.t) < limit));
  if (kept.length !== list.length) writeLog(kept);
}

async function copyLog(button) {
  const payload = JSON.stringify({ app: "Foco", version: 2, exportado: localISO(Date.now()), eventos: readLog() });
  let copied = false;
  try {
    await navigator.clipboard.writeText(payload);
    copied = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = payload;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, payload.length);
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
  }
  button.dataset.label ??= button.textContent;
  button.textContent = copied ? "Copiado" : "No se pudo copiar";
  setTimeout(() => {
    button.textContent = button.dataset.label;
  }, 1600);
}

// ---------- Pantallas y toques ----------

function guard() {
  guardUntil = Date.now() + TAP_GUARD;
}

function show(name, focusTarget) {
  for (const [key, element] of Object.entries(screens)) element.hidden = key !== name;
  currentScreen = name;
  screenShownAt = Date.now();
  guard();
  focusTarget?.focus({ preventScroll: true });
}

// Tras cambiar de pantalla, el segundo toque de un doble toque cae en otro botón: se ignora.
for (const type of ["click", "pointerdown"]) {
  document.addEventListener(type, (event) => {
    if (Date.now() < guardUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

// ---------- Recuentos ----------

function parseDone(value) {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { d: value, t: null, at: 0 };
  try {
    const data = JSON.parse(value);
    return data && typeof data.d === "string" ? data : null;
  } catch {
    return null;
  }
}

function recordDone(id, { text, variant, day = dateKey(new Date()), late = false }) {
  const key = donePrefix + id;
  if (read(key)) return false;
  const record = { d: day, t: text, v: variant, at: Date.now() };
  if (late) record.tarde = true;
  writeJSON(key, record);
  return true;
}

function stats() {
  const now = new Date();
  const todayKey = dateKey(now);
  const monday = new Date(now);
  monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const startOfWeek = dateKey(monday);
  const doneToday = [];
  let completedThisWeek = 0;

  for (const key of storedKeys()) {
    if (!key?.startsWith(donePrefix)) continue;
    const record = parseDone(read(key));
    if (!record) continue;
    if (record.d === todayKey) doneToday.push(record);
    if (record.d >= startOfWeek && record.d <= todayKey) completedThisWeek += 1;
  }
  doneToday.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return {
    visits: read(visitsPrefix + todayKey) ?? "0",
    rests: read(restsPrefix + todayKey) ?? "0",
    doneToday,
    completedThisWeek,
  };
}

function paintStats() {
  const data = stats();
  $("#entradas-hoy").textContent = data.visits;
  $("#hechas-hoy").textContent = data.doneToday.length;
  $("#hechas-semana").textContent = data.completedThisWeek;
  $("#descansos-hoy").textContent = data.rests;
  pill.textContent = `${data.doneToday.length} ${data.doneToday.length === 1 ? "hecha" : "hechas"} hoy`;
  return data;
}

function refreshStats() {
  paintStats();
  clearTimeout(midnightTimeout);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnightTimeout = setTimeout(refreshStats, midnight - now + 100);
}

function markRestDone(session) {
  const key = restDonePrefix + session.id;
  if (read(key)) return;
  const day = dateKey(new Date(session.deadline));
  write(key, day);
  bump(restsPrefix + day);
  log("descanso_fin", { var: "menu" });
  paintStats();
}

// ---------- Menú (variante de control) ----------

function showHome() {
  show("inicio", homeTitle);
  error.hidden = true;
  refreshStats();
  log("ver_menu");
}

function restoreSession() {
  try {
    const saved = JSON.parse(read(sessionKey));
    if (!saved || !["task", "rest"].includes(saved.kind) || typeof saved.title !== "string" ||
        typeof saved.id !== "string" || !Number.isFinite(saved.deadline)) return null;
    if (saved.kind === "task" && read(donePrefix + saved.id)) return null;
    return saved;
  } catch {
    return null;
  }
}

function paintTimer() {
  clearTimeout(clockTimeout);
  if (!currentSession) return;

  const remaining = Math.max(0, currentSession.deadline - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (seconds === 0) {
    finish.textContent = currentSession.kind === "task" ? "Han pasado 10 minutos." : "Descanso terminado.";
    if (currentSession.kind === "rest") markRestDone(currentSession);
  } else if (!document.hidden) {
    clockTimeout = setTimeout(paintTimer, remaining % 1000 || 1000);
  }
}

function showSession() {
  show("sesion", sessionTitle);
  sessionTitle.textContent = currentSession.title;
  finish.textContent = "";
  doneButton.hidden = currentSession.kind !== "task";
  paintTimer();
}

function startSession(kind, title, minutes) {
  const start = Date.now();
  currentSession = { id: newId(), kind, title, start, deadline: start + minutes * 60_000 };
  write(sessionKey, JSON.stringify(currentSession));
  showSession();
}

function clearSession(id) {
  const saved = restoreSession();
  if (!saved || saved.id === id) write(sessionKey, null);
}

function leaveSession() {
  clearSession(currentSession?.id);
  currentSession = null;
  clearTimeout(clockTimeout);
  showHome();
}

async function startTask() {
  const request = ++taskRequest;
  taskButton.disabled = true;
  error.hidden = true;
  try {
    if (!tasks) {
      const response = await fetch("./tareas.json");
      if (!response.ok) throw new Error("No se pudieron cargar las tareas");
      const data = await response.json();
      if (!Array.isArray(data) || !data.length || data.some((title) => typeof title !== "string" || !title.trim())) {
        throw new Error("La lista de tareas no es válida");
      }
      if (request !== taskRequest) return;
      tasks = data;
    }
    if (!currentSession && currentScreen === "inicio") {
      log("elegir", { opcion: "tarea", s: secondsSince(screenShownAt) });
      startSession("task", tasks[Math.floor(Math.random() * tasks.length)], 10);
    }
  } catch {
    if (request === taskRequest && currentScreen === "inicio") {
      error.textContent = "No se pudieron cargar las tareas. Prueba otra vez.";
      error.hidden = false;
    }
  } finally {
    if (request === taskRequest) taskButton.disabled = false;
  }
}

taskButton.addEventListener("click", startTask);
restButton.addEventListener("click", () => {
  taskRequest += 1;
  taskButton.disabled = false;
  log("elegir", { opcion: "descanso", s: secondsSince(screenShownAt) });
  startSession("rest", "Descanso sin móvil", 5);
});
backButton.addEventListener("click", () => {
  if (currentSession) log("volver", { s: secondsSince(currentSession.start ?? screenShownAt) });
  leaveSession();
});
doneButton.addEventListener("click", () => {
  if (currentSession?.kind !== "task") return;
  recordDone(currentSession.id, { text: currentSession.title, variant: "menu" });
  log("hecho", { s: secondsSince(currentSession.start ?? screenShownAt), texto: currentSession.title });
  leaveSession();
});

// ---------- Tarjeta (variante nueva) ----------

function slug(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function validateCards(data) {
  const list = Array.isArray(data) ? data : data?.tarjetas;
  if (!Array.isArray(list)) throw new Error("tarjetas.json no es una lista");
  const valid = list
    .filter((card) => card && typeof card.texto === "string" && card.texto.trim() && CONTEXTS.includes(card.contexto))
    .map((card) => ({
      id: typeof card.id === "string" && card.id.trim() ? card.id.trim() : slug(`${card.contexto}-${card.texto}`),
      contexto: card.contexto,
      tipo: typeof card.tipo === "string" ? card.tipo : "",
      texto: card.texto.trim(),
      min: Number.isFinite(card.min) && card.min > 0 ? card.min : 1,
    }));
  if (!valid.length) throw new Error("tarjetas.json no tiene tarjetas válidas");
  return valid;
}

function loadCards() {
  cardsPromise ??= fetch("./tarjetas.json")
    .then((response) => {
      if (!response.ok) throw new Error("No se pudieron cargar las tarjetas");
      return response.json();
    })
    .then(validateCards)
    .then((list) => {
      cards = list;
      return list;
    })
    .catch((reason) => {
      cardsPromise = null;
      throw reason;
    });
  return cardsPromise;
}

function cardById(id) {
  return cards?.find((card) => card.id === id) ?? null;
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function lastContext() {
  const saved = read(contextKey);
  return CONTEXTS.includes(saved) ? saved : CONTEXTS[0];
}

function loadDeck() {
  const saved = readJSON(deckKey);
  if (!saved || typeof saved.id !== "string" || !CONTEXTS.includes(saved.ctx) || !Array.isArray(saved.order) ||
      !Number.isInteger(saved.pos) || !Number.isFinite(saved.shownAt)) return null;
  return saved;
}

function saveDeck() {
  writeJSON(deckKey, deck);
}

function clearDeck() {
  deck = null;
  write(deckKey, null);
}

function deckCard() {
  return deck && deck.pos >= 0 ? cardById(deck.order[deck.pos]) : null;
}

function newDeck(ctx) {
  const pool = shuffle(cards.filter((card) => card.contexto === ctx)).slice(0, DECK_SIZE);
  deck = { id: newId(), ctx, order: pool.map((card) => card.id), pos: pool.length ? 0 : -1, shownAt: Date.now(), done: null };
  saveDeck();
}

async function startDeck() {
  try {
    await loadCards();
  } catch {
    log("error_tarjetas");
    if (opening) opening.variant = "menu";
    saveOpening();
    showHome();
    return;
  }
  newDeck(lastContext());
  show("tarjeta");
  renderDeck({ enter: true });
  logCardSeen();
}

function logCardSeen() {
  if (deck?.pos >= 0) log("ver_tarjeta", { ctx: deck.ctx, tarjeta: deck.order[deck.pos], n: deck.pos + 1 });
  else if (deck) log("fin_mazo", { ctx: deck.ctx });
}

function renderDots() {
  dots.replaceChildren(...deck.order.map((_, index) => {
    const dot = document.createElement("i");
    if (index === deck.pos) dot.className = "on";
    return dot;
  }));
}

function renderToday() {
  const { doneToday } = paintStats();
  todayList.replaceChildren(...doneToday.slice(0, 6).map((record) => {
    const item = document.createElement("li");
    item.textContent = record.t || "Tarea del menú";
    return item;
  }));
}

function renderDeck({ enter = false, flip = false } = {}) {
  paintStats();
  const done = Boolean(deck.done);
  const ending = !done && deck.pos < 0;
  for (const chip of chips) {
    chip.setAttribute("aria-pressed", String(chip.dataset.ctx === deck.ctx));
    chip.disabled = done;
  }
  $("#contextos").hidden = done;

  const remaining = ending ? 0 : Math.max(0, deck.order.length - deck.pos - 1);
  ghosts[0].hidden = done || ending || remaining < 1;
  ghosts[1].hidden = done || ending || remaining < 2;

  endView.hidden = !ending;
  cardEl.hidden = ending;
  actions.hidden = done || ending;
  today.hidden = !done;

  if (ending) {
    endList.replaceChildren(...deck.order.map((id, index) => {
      const card = cardById(id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "end-item";
      button.textContent = card ? card.texto : id;
      button.addEventListener("click", () => chooseAgain(index));
      return button;
    }));
    endTitle.focus({ preventScroll: true });
    return;
  }

  const card = done ? cardById(deck.done.tarjeta) : deckCard();
  if (!card) {
    clearDeck();
    newDeck(lastContext());
    renderDeck();
    return;
  }
  cardText.textContent = card.texto;
  cardMinutes.textContent = `${card.min} min`;
  cardDoneText.textContent = card.texto;
  hint.textContent = deck.pos < deck.order.length - 1 ? "Desliza para otra →" : "Es la última de aquí";
  renderDots();

  cardEl.style.transform = "";
  cardEl.classList.remove("leaving", "dragging");
  if (done) {
    if (!flip) cardEl.classList.add("instant");
    cardEl.classList.add("flipped");
    if (!flip) requestAnimationFrame(() => cardEl.classList.remove("instant"));
    renderToday();
  } else {
    cardEl.classList.remove("flipped");
    if (enter) {
      cardEl.classList.add("instant", "entering");
      requestAnimationFrame(() => requestAnimationFrame(() => cardEl.classList.remove("instant", "entering")));
    }
    cardText.focus({ preventScroll: true });
  }
}

function nextCard(mode) {
  if (!deck || deck.done || deck.pos < 0) return;
  log("deslizar", { ctx: deck.ctx, de: deck.order[deck.pos], s: secondsSince(deck.shownAt), modo: mode });
  deck.pos = deck.pos + 1 < deck.order.length ? deck.pos + 1 : -1;
  deck.shownAt = Date.now();
  saveDeck();
  renderDeck({ enter: true });
  logCardSeen();
  guard();
}

function flyOut(direction, mode) {
  if (!deck || deck.done || deck.pos < 0 || cardEl.classList.contains("leaving")) return;
  guard();
  cardEl.classList.remove("dragging");
  cardEl.classList.add("leaving");
  cardEl.style.transform = `translateX(${direction * 130}%) rotate(${direction * 14}deg)`;
  setTimeout(() => nextCard(mode), 190);
}

function chooseAgain(index) {
  if (!deck || deck.done) return;
  deck.pos = index;
  deck.shownAt = Date.now();
  saveDeck();
  log("elegir", { opcion: "tarjeta_de_nuevo", tarjeta: deck.order[index] });
  renderDeck({ enter: true });
  guard();
}

function changeContext(ctx) {
  if (!deck || deck.done || !CONTEXTS.includes(ctx) || ctx === deck.ctx) return;
  write(contextKey, ctx);
  log("contexto", { ctx, s: secondsSince(deck.shownAt) });
  newDeck(ctx);
  renderDeck({ enter: true });
  logCardSeen();
  guard();
}

function finishCard() {
  const card = deckCard();
  if (!deck || deck.done || !card) return;
  recordDone(deck.id, { text: card.texto, variant: "tarjeta" });
  deck.done = { at: Date.now(), tarjeta: card.id };
  saveDeck();
  write(contextKey, deck.ctx);
  log("hecho", { ctx: deck.ctx, tarjeta: card.id, s: secondsSince(deck.shownAt), texto: card.texto });
  renderDeck({ flip: true });
  guard();
}

deckDoneButton.addEventListener("click", finishCard);
anotherButton.addEventListener("click", () => flyOut(-1, "boton"));
for (const chip of chips) chip.addEventListener("click", () => changeContext(chip.dataset.ctx));

cardEl.addEventListener("pointerdown", (event) => {
  if (!deck || deck.done || deck.pos < 0 || cardEl.classList.contains("leaving")) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, active: false };
  try {
    cardEl.setPointerCapture(event.pointerId);
  } catch {
    // Sin captura el gesto sigue funcionando mientras el dedo esté sobre la tarjeta.
  }
});

cardEl.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    drag.active = true;
    cardEl.classList.add("dragging");
  }
  drag.dx = dx;
  cardEl.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const { dx, active } = drag;
  drag = null;
  cardEl.classList.remove("dragging");
  if (active && Math.abs(dx) > 90) flyOut(dx > 0 ? 1 : -1, "deslizar");
  else cardEl.style.transform = "";
}

cardEl.addEventListener("pointerup", endDrag);
cardEl.addEventListener("pointercancel", endDrag);

// ---------- Pregunta por lo que quedó a medias ----------

function askAbout(item) {
  pending = item;
  if (item.kind === "sesion") {
    questionTitle.textContent = `¿Hiciste «${item.text.replace(/\.$/, "")}»?`;
    questionText.textContent = "";
  } else {
    questionTitle.textContent = "¿Lo hiciste?";
    questionText.textContent = `«${item.text}»`;
  }
  show("pregunta", questionTitle);
  log("pregunta", { tipo: item.kind, texto: item.text });
}

function answer(yes) {
  if (!pending) return;
  const item = pending;
  pending = null;
  if (yes) {
    recordDone(item.id, { text: item.text, variant: item.variant, day: item.day, late: true });
    log("hecho", { var: item.variant, tarde: true, texto: item.text });
  } else {
    log("no_hecho", { var: item.variant, texto: item.text });
  }
  if (item.kind === "sesion") clearSession(item.id);
  else clearDeck();
  showVariant();
}

$("#si").addEventListener("click", () => answer(true));
$("#no").addEventListener("click", () => answer(false));

// ---------- Aperturas ----------

function saveOpening() {
  writeJSON(openingKey, opening);
}

function forcedVariant() {
  const forced = new URLSearchParams(location.search).get("variante");
  return forced === "menu" || forced === "tarjeta" ? forced : null;
}

function rollVariant() {
  const forced = forcedVariant();
  if (forced) return { variant: forced, forced: true };
  return { variant: Math.random() < 0.5 ? "menu" : "tarjeta", forced: false };
}

function showVariant() {
  if (opening?.variant === "tarjeta") startDeck();
  else showHome();
}

// Decide qué se ve: lo que quedó en marcha, una pregunta por lo que quedó a medias o la variante sorteada.
function resolveView({ fresh, cold }) {
  const now = Date.now();
  const logOpen = (extra = {}) => {
    if (fresh) log("abrir", { frio: cold, ...extra });
  };

  const session = restoreSession();
  if (session) {
    if (now - session.deadline > STALE_AFTER) {
      if (session.kind === "rest") {
        markRestDone(session);
        clearSession(session.id);
      } else {
        logOpen();
        askAbout({
          kind: "sesion",
          id: session.id,
          text: session.title,
          variant: "menu",
          day: dateKey(new Date(session.start ?? session.deadline - 10 * 60_000)),
        });
        return;
      }
    } else {
      currentSession = session;
      opening.variant = "menu";
      saveOpening();
      logOpen({ reanuda: "sesion" });
      showSession();
      return;
    }
  }

  // Un enlace con ?variante=menu enseña el menú aunque hubiera una tarjeta abierta (solo para vistas previas).
  if (forcedVariant() === "menu") clearDeck();
  const savedDeck = loadDeck();
  if (savedDeck && !savedDeck.done && savedDeck.pos >= 0) {
    if (now - savedDeck.shownAt > STALE_AFTER) {
      deck = savedDeck;
      logOpen();
      const ask = () => {
        const card = deckCard();
        askAbout({
          kind: "tarjeta",
          id: deck.id,
          text: card?.texto ?? "la tarjeta de antes",
          variant: "tarjeta",
          day: dateKey(new Date(deck.shownAt)),
        });
      };
      loadCards().then(ask, ask);
      return;
    }
    deck = savedDeck;
    opening.variant = "tarjeta";
    saveOpening();
    logOpen({ reanuda: "tarjeta" });
    loadCards()
      .then(() => {
        show("tarjeta");
        renderDeck();
      })
      .catch(() => {
        clearDeck();
        opening.variant = "menu";
        saveOpening();
        showHome();
      });
    return;
  }

  if (savedDeck && (savedDeck.done || savedDeck.pos < 0) && !fresh) {
    // Vuelta rápida a una tarjeta ya hecha o al final del mazo: se queda como estaba.
    deck = savedDeck;
    opening.variant = "tarjeta";
    loadCards()
      .then(() => {
        show("tarjeta");
        renderDeck();
      })
      .catch(() => showHome());
    return;
  }

  clearDeck();
  logOpen({ forzada: opening.forced || undefined });
  showVariant();
}

function startOpening(cold) {
  const now = Date.now();
  bump(visitsPrefix + dateKey(new Date(now)));
  const { variant, forced } = rollVariant();
  opening = { id: newId().slice(0, 8), at: now, variant, forced };
  saveOpening();
  resolveView({ fresh: true, cold });
  refreshStats();
}

function restoreView() {
  // Recarga en menos de 2 min: misma apertura y misma variante, salvo que el enlace pida una concreta.
  const forced = forcedVariant();
  if (forced && opening.variant !== forced) {
    opening.variant = forced;
    opening.forced = true;
    saveOpening();
  }
  resolveView({ fresh: false, cold: true });
  refreshStats();
}

function handleHidden() {
  if (away) return;
  away = true;
  write(hiddenAtKey, String(Date.now()));
  log("salir", { pantalla: currentScreen, s: opening ? secondsSince(opening.at) : null });
  clearTimeout(clockTimeout);
}

function handleVisible() {
  if (!away) return;
  away = false;
  const cold = coldPending;
  coldPending = false;
  const hiddenAt = Number(read(hiddenAtKey));
  if (!opening || !(hiddenAt > 0) || Date.now() - hiddenAt >= OPENING_GAP) {
    startOpening(cold);
  } else {
    refreshStats();
    if (currentSession) paintTimer();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) handleHidden();
  else handleVisible();
});
window.addEventListener("pagehide", handleHidden);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) handleVisible();
});
window.addEventListener("storage", (event) => {
  if (event.key === null || event.key.startsWith(prefix)) paintStats();
});

document.addEventListener("click", (event) => {
  const copy = event.target.closest?.("[data-copiar]");
  if (copy) {
    copyLog(copy);
    return;
  }
  if (event.target.closest?.("[data-mi-hoy]")) {
    log("elegir", { opcion: "mi_hoy", s: secondsSince(screenShownAt) });
  }
});

// ---------- Arranque ----------

function init() {
  pruneLog();
  loadCards().catch(() => {});
  const saved = readJSON(openingKey);
  opening = saved && typeof saved.id === "string" && Number.isFinite(saved.at) ? saved : null;

  if (document.hidden) {
    away = true;
    coldPending = true;
    return;
  }
  // La hora de la última salida se conserva: una recarga o un aviso tardío no cuentan como apertura.
  const hiddenAt = Number(read(hiddenAtKey));
  if (!opening || !(hiddenAt > 0) || Date.now() - hiddenAt >= OPENING_GAP) startOpening(true);
  else restoreView();
}

init();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
