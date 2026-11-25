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
const setupKey = `${prefix}setup`; // primera configuración y sitios elegidos
const mineKey = `${prefix}mias`; // tarjetas propias: solo viven en este dispositivo
const hiddenKey = `${prefix}ocultas`; // tarjetas de ejemplo que se han quitado

const OPENING_GAP = 2 * 60_000; // volver tras 2 min o más fuera cuenta como apertura nueva
const STALE_AFTER = 30 * 60_000; // sesión o tarjeta de hace más de 30 min: se pregunta
const TAP_GUARD = 600; // ms en los que se ignoran toques tras cambiar de pantalla
const LOG_DAYS = 21; // días que se guarda el registro (se pidieron al menos 14)
const DECK_SIZE = 3; // tarjetas como mucho por apertura y contexto
const DEFAULT_SITES = ["Casa", "Taller", "Campo"];
const TIRED = "Cansado"; // siempre existe, con otras tarjetas
const MAX_TEXT = 160;
const MAX_MINE = 300;
const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const $ = (selector) => document.querySelector(selector);
const screens = {
  inicio: $("#inicio"),
  sesion: $("#sesion"),
  tarjeta: $("#tarjeta"),
  config: $("#config"),
  mis: $("#mis"),
  semana: $("#semana"),
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
const chipBox = $("#contextos");
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
let poolChanged = false;
let cfg = null;

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

async function copyText(payload) {
  try {
    await navigator.clipboard.writeText(payload);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = payload;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, payload.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

function flash(button, ok) {
  button.dataset.label ??= button.textContent;
  button.textContent = ok ? "Copiado" : "No se pudo copiar";
  setTimeout(() => {
    button.textContent = button.dataset.label;
  }, 1600);
}

async function copyLog(button) {
  const payload = JSON.stringify({ app: "Foco", version: 3, exportado: localISO(Date.now()), eventos: readLog() });
  flash(button, await copyText(payload));
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

// ----- Sitios -----

function cleanName(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 20) : "";
}

function sameName(a, b) {
  return a.localeCompare(b, "es", { sensitivity: "base" }) === 0;
}

function has(list, name) {
  return list.some((item) => sameName(item, name));
}

function unique(list) {
  const out = [];
  for (const name of list) if (!has(out, name)) out.push(name);
  return out;
}

function readSetup() {
  const saved = readJSON(setupKey);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

function sites() {
  const saved = readSetup().sitios;
  const list = Array.isArray(saved) ? saved.map(cleanName).filter((name) => name && !sameName(name, TIRED)) : [];
  return unique(list.length ? list : DEFAULT_SITES);
}

function contexts() {
  return [...sites(), TIRED];
}

function canonContext(name) {
  const clean = cleanName(name);
  return clean ? contexts().find((known) => sameName(known, clean)) ?? clean : null;
}

function addSite(name) {
  if (sameName(name, TIRED) || has(sites(), name)) return false;
  writeJSON(setupKey, { ...readSetup(), sitios: [...sites(), name] });
  return true;
}

// ----- Tarjetas de ejemplo (tarjetas.json), propias y ocultas -----

function norm(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanCard(card) {
  if (!card || typeof card.texto !== "string") return null;
  const texto = card.texto.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  const contexto = cleanName(card.contexto);
  if (!texto || !contexto) return null;
  const min = Number(card.min);
  return {
    id: typeof card.id === "string" && card.id.trim() ? card.id.trim().slice(0, 64) : slug(`${contexto}-${texto}`),
    contexto,
    tipo: typeof card.tipo === "string" ? card.tipo.slice(0, 20) : "",
    texto,
    min: Number.isFinite(min) && min > 0 ? Math.min(Math.round(min), 10) : 1,
  };
}

function validateCards(data) {
  const list = Array.isArray(data) ? data : data?.tarjetas;
  if (!Array.isArray(list)) throw new Error("tarjetas.json no es una lista");
  const valid = list.map(cleanCard).filter(Boolean);
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

function mineCards() {
  const list = readJSON(mineKey);
  return Array.isArray(list) ? list.map(cleanCard).filter(Boolean) : [];
}

function hiddenIds() {
  const list = readJSON(hiddenKey);
  return new Set(Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
}

function allCards() {
  return [...(cards ?? []), ...mineCards()];
}

function cardById(id) {
  return allCards().find((card) => card.id === id) ?? null;
}

function playableCards(ctx) {
  const hidden = hiddenIds();
  return allCards().filter((card) => !hidden.has(card.id) && sameName(card.contexto, ctx));
}

// Añade tarjetas propias. Un sitio nuevo se crea solo. Devuelve cuántas entraron y cuántas se descartaron.
function addMine(items) {
  const list = mineCards();
  const seen = new Set(list.map((card) => `${norm(card.contexto)}|${norm(card.texto)}`));
  const newSites = [];
  let added = 0;
  let repeated = 0;
  let invalid = 0;
  for (const item of items) {
    if (list.length >= MAX_MINE) break;
    const card = cleanCard({ ...item, id: `m-${newId().slice(0, 8)}` });
    if (!card) {
      invalid += 1;
      continue;
    }
    card.contexto = canonContext(card.contexto);
    const key = `${norm(card.contexto)}|${norm(card.texto)}`;
    if (seen.has(key)) {
      repeated += 1;
      continue;
    }
    seen.add(key);
    if (!has(contexts(), card.contexto) && addSite(card.contexto)) newSites.push(card.contexto);
    list.push(card);
    added += 1;
  }
  if (added) {
    writeJSON(mineKey, list);
    poolChanged = true;
  }
  return { added, repeated, invalid, newSites };
}

// Texto pegado: una tarjeta por línea con «Sitio | min | texto», o un JSON con una lista.
function parseImport(text) {
  const raw = text.trim();
  if (!raw) return [];
  if (raw[0] === "[" || raw[0] === "{") {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : data?.tarjetas;
    return Array.isArray(list) ? list : [];
  }
  return raw
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length >= 3) return { contexto: parts[0], min: parseInt(parts[1], 10), texto: parts.slice(2).join(" | ") };
      if (parts.length === 2) return { contexto: parts[0], texto: parts[1] };
      return { contexto: lastContext(), texto: parts[0] };
    });
}

function formatMine() {
  return mineCards().map((card) => `${card.contexto} | ${card.min} | ${card.texto}`).join("\n");
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
  const list = contexts();
  const saved = read(contextKey);
  return list.find((name) => saved && sameName(name, saved)) ?? list[0];
}

function loadDeck() {
  const saved = readJSON(deckKey);
  if (!saved || typeof saved.id !== "string" || typeof saved.ctx !== "string" || !Array.isArray(saved.order) ||
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
  const pool = shuffle(playableCards(ctx)).slice(0, DECK_SIZE);
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
  if (!readSetup().hecho) {
    showConfig({ first: true });
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
  paintWall($("#pared-mini"), { compact: true });
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
  chipBox.replaceChildren(...contexts().map((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.ctx = name;
    chip.textContent = name;
    chip.setAttribute("aria-pressed", String(sameName(name, deck.ctx)));
    chip.disabled = done;
    return chip;
  }));
  chipBox.hidden = done;

  const remaining = ending ? 0 : Math.max(0, deck.order.length - deck.pos - 1);
  ghosts[0].hidden = done || ending || remaining < 1;
  ghosts[1].hidden = done || ending || remaining < 2;

  endView.hidden = !ending;
  cardEl.hidden = ending;
  actions.hidden = done || ending;
  today.hidden = !done;

  if (ending) {
    endTitle.textContent = deck.order.length ? "Ya está: elige una o cierra." : "No hay tarjetas aquí. Añade alguna en «Mis tarjetas».";
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
  if (!deck || deck.done || !has(contexts(), ctx) || ctx === deck.ctx) return;
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
chipBox.addEventListener("click", (event) => {
  const chip = event.target.closest?.("[data-ctx]");
  if (chip) changeContext(chip.dataset.ctx);
});

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

// ---------- Pared de la semana ----------

function weekData() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  const days = DAY_NAMES.map((name, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return { key: dateKey(date), name, label: name[0], items: [] };
  });
  const previousStart = dateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7));
  let previous = 0;
  for (const key of storedKeys()) {
    if (!key?.startsWith(donePrefix)) continue;
    const record = parseDone(read(key));
    if (!record) continue;
    const day = days.find((candidate) => candidate.key === record.d);
    if (day) day.items.push(record);
    else if (record.d >= previousStart && record.d < days[0].key) previous += 1;
  }
  for (const day of days) day.items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return { days, previous, total: days.reduce((sum, day) => sum + day.items.length, 0), todayKey: dateKey(now) };
}

// Una pared de ladrillos: cada «Hecho» pone uno en su día. Los de hace unos segundos entran con un pequeño salto.
function paintWall(root, { compact = false } = {}) {
  const week = weekData();
  const rows = compact ? 5 : 10;
  root.style.setProperty("--rows", String(rows));
  root.setAttribute("aria-label", `Hechas esta semana: ${week.days.map((day) => `${day.name} ${day.items.length}`).join(", ")}`);
  root.replaceChildren(...week.days.map((day) => {
    const column = document.createElement("div");
    column.className = day.key === week.todayKey ? "col today-col" : "col";
    const more = document.createElement("span");
    more.className = "more";
    more.textContent = day.items.length > rows ? `+${day.items.length - rows}` : "";
    const bricks = document.createElement("div");
    bricks.className = "bricks";
    for (const item of day.items.slice(-rows)) {
      const brick = document.createElement("i");
      if (Date.now() - (item.at ?? 0) < 15_000) brick.className = "new";
      bricks.append(brick);
    }
    const label = document.createElement("span");
    label.className = "lab";
    label.textContent = day.label;
    column.append(more, bricks, label);
    return column;
  }));
}

function showWeek() {
  const week = weekData();
  paintWall($("#pared"));
  $("#semana-resumen").textContent =
    `${week.total} ${week.total === 1 ? "hecha" : "hechas"} esta semana · semana pasada: ${week.previous}`;
  const list = $("#semana-lista");
  const groups = [...week.days].reverse().filter((day) => day.items.length).map((day) => {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.className = "sub";
    heading.textContent = day.key === week.todayKey ? "Hoy" : day.name;
    const items = document.createElement("ul");
    items.className = "list plain";
    for (const item of [...day.items].reverse()) {
      const entry = document.createElement("li");
      entry.textContent = item.t || "Tarea del menú";
      items.append(entry);
    }
    section.append(heading, items);
    return section;
  });
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "feedback";
    empty.textContent = "Todavía no hay nada hecho esta semana.";
    groups.push(empty);
  }
  list.replaceChildren(...groups);
  show("semana", $("#semana-titulo"));
  log("semana_ver", { n: week.total });
}

// ---------- Volver a la tarjeta desde los ajustes ----------

function leaveToDeck() {
  const stale = deck && !deck.done && !has(contexts(), deck.ctx);
  if (!deck || stale || (poolChanged && !deck.done)) {
    poolChanged = false;
    clearDeck();
    newDeck(lastContext());
    show("tarjeta");
    renderDeck({ enter: true });
    logCardSeen();
    return;
  }
  poolChanged = false;
  show("tarjeta");
  renderDeck();
}

// ---------- Primera vez y cambio de sitios ----------

const cfgSites = $("#cfg-sitios");
const cfgTired = $("#cfg-cansado");
const cfgSiteSelect = $("#cfg-aficion-sitio");
const cfgOther = $("#cfg-otro");

function renderConfig() {
  cfgSites.replaceChildren(...cfg.options.map((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.site = name;
    chip.textContent = name;
    chip.setAttribute("aria-pressed", String(has(cfg.on, name)));
    return chip;
  }));
  const chosen = cfg.options.filter((name) => has(cfg.on, name));
  const previous = cfgSiteSelect.value;
  cfgSiteSelect.replaceChildren(...(chosen.length ? chosen : DEFAULT_SITES).map((name) => new Option(name, name)));
  if ([...cfgSiteSelect.options].some((option) => option.value === previous)) cfgSiteSelect.value = previous;
}

function renderTired() {
  const hidden = hiddenIds();
  const own = (cards ?? []).filter((card) => sameName(card.contexto, TIRED));
  cfgTired.replaceChildren(...own.map((card) => {
    const row = document.createElement("label");
    row.className = "check-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = card.id;
    input.checked = !hidden.has(card.id);
    const text = document.createElement("span");
    text.textContent = card.texto;
    row.append(input, text);
    return row;
  }));
  $("#cfg-cansado-bloque").hidden = !own.length;
}

function showConfig({ first = false } = {}) {
  cfg = { first, options: unique([...DEFAULT_SITES, ...sites()]), on: sites() };
  $("#config-kicker").hidden = !first;
  $("#cfg-listo").textContent = first ? "Empezar" : "Guardar";
  $("#cfg-saltar").textContent = first ? "Saltar por ahora" : "Cancelar";
  $("#cfg-aficiones").value = "";
  cfgOther.value = "";
  renderTired();
  renderConfig();
  show("config", $("#config-titulo"));
  log("config_ver", { primera: first });
}

function addOtherSite() {
  const name = cleanName(cfgOther.value);
  cfgOther.value = "";
  if (!name || sameName(name, TIRED)) return;
  const known = cfg.options.find((option) => sameName(option, name));
  if (!known) cfg.options.push(name);
  const target = known ?? name;
  if (!has(cfg.on, target)) cfg.on.push(target);
  renderConfig();
}

function finishConfig(skip) {
  if (!cfg) return;
  const first = cfg.first;
  let added = 0;
  if (skip) {
    if (first) writeJSON(setupKey, { ...readSetup(), hecho: true });
  } else {
    const chosen = cfg.options.filter((name) => has(cfg.on, name));
    const next = chosen.length ? chosen : DEFAULT_SITES;
    const hidden = hiddenIds();
    for (const input of cfgTired.querySelectorAll("input")) {
      if (input.checked) hidden.delete(input.value);
      else hidden.add(input.value);
    }
    writeJSON(hiddenKey, [...hidden]);
    writeJSON(setupKey, { ...readSetup(), hecho: true, sitios: next });
    const place = cfgSiteSelect.value || next[0];
    const lines = $("#cfg-aficiones").value.split(/\r\n|[\r\n\u2028\u2029]/).slice(0, 10);
    added = addMine(lines.map((texto) => ({ contexto: place, tipo: "Afición", texto, min: 2 }))).added;
    poolChanged = true;
  }
  log("config", { primera: first, saltada: skip, sitios: sites().length, propias: added });
  cfg = null;
  if (first) startDeck();
  else leaveToDeck();
}

cfgSites.addEventListener("click", (event) => {
  const chip = event.target.closest?.("[data-site]");
  if (!chip || !cfg) return;
  const name = chip.dataset.site;
  if (has(cfg.on, name)) cfg.on = cfg.on.filter((other) => !sameName(other, name));
  else cfg.on.push(name);
  renderConfig();
});
$("#cfg-otro-add").addEventListener("click", addOtherSite);
cfgOther.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addOtherSite();
  }
});
$("#cfg-listo").addEventListener("click", () => finishConfig(false));
$("#cfg-saltar").addEventListener("click", () => finishConfig(true));

// ---------- Mis tarjetas ----------

const mineList = $("#mis-lista");
const mineExamples = $("#mis-ejemplo");
const mineNote = $("#mis-aviso");

function note(text) {
  mineNote.textContent = text;
  mineNote.hidden = !text;
}

function renderMine() {
  const select = $("#mis-sitio");
  const list = contexts();
  const keep = select.value || lastContext();
  select.replaceChildren(...list.map((name) => new Option(name, name)));
  select.value = list.find((name) => sameName(name, keep)) ?? list[0];

  const mine = mineCards();
  $("#mis-n").textContent = String(mine.length);
  mineList.replaceChildren(...(mine.length ? mine : [null]).map((card) => {
    const item = document.createElement("li");
    if (!card) {
      item.textContent = "Todavía no tienes ninguna.";
      return item;
    }
    const body = document.createElement("span");
    body.className = "item-body";
    const text = document.createElement("span");
    text.className = "item-text";
    text.textContent = card.texto;
    const meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = `${card.contexto} · ${card.min} min`;
    body.append(text, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini";
    remove.dataset.borrar = card.id;
    remove.textContent = "Borrar";
    item.append(body, remove);
    return item;
  }));

  const hidden = hiddenIds();
  mineExamples.replaceChildren(...(cards ?? []).map((card) => {
    const row = document.createElement("label");
    row.className = "check-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = card.id;
    input.checked = !hidden.has(card.id);
    const text = document.createElement("span");
    text.textContent = `${card.texto} (${card.contexto})`;
    row.append(input, text);
    return row;
  }));
}

function showMine() {
  note("");
  renderMine();
  show("mis", $("#mis-titulo"));
  log("mis_ver", { propias: mineCards().length });
}

$("#mis-anadir").addEventListener("click", () => {
  const area = $("#mis-texto");
  const result = addMine([{
    contexto: $("#mis-sitio").value,
    min: Number($("#mis-min").value),
    texto: area.value,
    tipo: "Propia",
  }]);
  if (result.added) {
    area.value = "";
    note("Añadida.");
    log("tarjeta_nueva", { origen: "mano" });
  } else {
    note(result.repeated ? "Ya la tienes." : "Escribe algo primero.");
  }
  renderMine();
});

$("#mis-importar-ok").addEventListener("click", () => {
  const area = $("#mis-importar");
  let items;
  try {
    items = parseImport(area.value);
  } catch {
    note("No he entendido el texto. Una tarjeta por línea: Sitio | min | texto.");
    return;
  }
  if (!items.length) {
    note("No hay nada que importar.");
    return;
  }
  const result = addMine(items);
  if (result.added) area.value = "";
  const parts = [`${result.added} importadas`];
  if (result.repeated) parts.push(`${result.repeated} repetidas ignoradas`);
  if (result.invalid) parts.push(`${result.invalid} no válidas`);
  if (result.newSites.length) parts.push(`sitios nuevos: ${result.newSites.join(", ")}`);
  note(`${parts.join(" · ")}.`);
  log("importar", { n: result.added, repetidas: result.repeated, no_validas: result.invalid });
  renderMine();
});

$("#mis-copiar").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const text = formatMine();
  if (!text) {
    note("Todavía no tienes tarjetas propias que copiar.");
    return;
  }
  flash(button, await copyText(text));
});

mineList.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-borrar]");
  if (!button) return;
  if (button.dataset.armed !== "1") {
    button.dataset.armed = "1";
    button.textContent = "¿Seguro?";
    setTimeout(() => {
      if (button.isConnected) {
        button.dataset.armed = "";
        button.textContent = "Borrar";
      }
    }, 3000);
    return;
  }
  writeJSON(mineKey, mineCards().filter((card) => card.id !== button.dataset.borrar));
  poolChanged = true;
  note("Borrada.");
  renderMine();
});

mineExamples.addEventListener("change", (event) => {
  const input = event.target.closest?.("input[type=checkbox]");
  if (!input) return;
  const hidden = hiddenIds();
  if (input.checked) hidden.delete(input.value);
  else hidden.add(input.value);
  writeJSON(hiddenKey, [...hidden]);
  poolChanged = true;
});

$("#mis-sitios").addEventListener("click", () => showConfig({ first: false }));
$("#mis-volver").addEventListener("click", leaveToDeck);
$("#abrir-mis").addEventListener("click", showMine);
$("#abrir-semana").addEventListener("click", showWeek);
$("#pill-hechas").addEventListener("click", showWeek);
$("#semana-volver").addEventListener("click", () => {
  show("tarjeta");
  renderDeck();
});

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
