const prefix = "foco:v1:";
const sessionKey = `${prefix}session`;
const visitsPrefix = `${prefix}visits:`;
const donePrefix = `${prefix}done:`;

const home = document.querySelector("#inicio");
const homeTitle = document.querySelector("#titulo-inicio");
const sessionScreen = document.querySelector("#sesion");
const sessionTitle = document.querySelector("#titulo-sesion");
const taskButton = document.querySelector("#tarea");
const restButton = document.querySelector("#descanso");
const clock = document.querySelector("#reloj");
const finish = document.querySelector("#fin");
const doneButton = document.querySelector("#hecho");
const backButton = document.querySelector("#volver");
const error = document.querySelector("#error");

const temporaryStorage = new Map();
let currentSession = restoreSession();
let clockTimeout;
let midnightTimeout;
let tasks;
let wasAway = false;
let taskRequest = 0;

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

function storedKeys() {
  const keys = new Set(temporaryStorage.keys());
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      keys.add(localStorage.key(index));
    }
  } catch {
    // The current visit still works when storage is blocked.
  }
  return keys;
}

function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function paintStats() {
  const now = new Date();
  const today = dateKey(now);
  const monday = new Date(now);
  monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const startOfWeek = dateKey(monday);
  let completedToday = 0;
  let completedThisWeek = 0;

  for (const key of storedKeys()) {
    if (!key?.startsWith(donePrefix)) continue;
    const completedOn = read(key);
    if (completedOn === today) completedToday += 1;
    if (completedOn >= startOfWeek && completedOn <= today) completedThisWeek += 1;
  }

  document.querySelector("#entradas-hoy").textContent = read(visitsPrefix + today) ?? "0";
  document.querySelector("#hechas-hoy").textContent = completedToday;
  document.querySelector("#hechas-semana").textContent = completedThisWeek;
}

function refreshStats() {
  paintStats();
  clearTimeout(midnightTimeout);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnightTimeout = setTimeout(refreshStats, midnight - now + 100);
}

function recordEntry() {
  const key = visitsPrefix + dateKey(new Date());
  const count = Number(read(key));
  write(key, String((Number.isSafeInteger(count) && count >= 0 ? count : 0) + 1));
}

function resumeWhenVisible() {
  if (document.hidden) return;
  if (wasAway && !currentSession) recordEntry();
  wasAway = false;
  refreshStats();
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
  } else if (!document.hidden) {
    clockTimeout = setTimeout(paintTimer, remaining % 1000 || 1000);
  }
}

function showSession() {
  home.hidden = true;
  sessionScreen.hidden = false;
  sessionTitle.textContent = currentSession.title;
  finish.textContent = "";
  doneButton.hidden = currentSession.kind !== "task";
  paintTimer();
  sessionTitle.focus();
}

function startSession(kind, title, minutes) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  currentSession = { id, kind, title, deadline: Date.now() + minutes * 60_000 };
  write(sessionKey, JSON.stringify(currentSession));
  showSession();
}

function leaveSession() {
  const saved = restoreSession();
  if (!saved || saved.id === currentSession?.id) write(sessionKey, null);
  currentSession = null;
  clearTimeout(clockTimeout);
  sessionScreen.hidden = true;
  home.hidden = false;
  error.hidden = true;
  refreshStats();
  homeTitle.focus();
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
    if (!currentSession) startSession("task", tasks[Math.floor(Math.random() * tasks.length)], 10);
  } catch {
    if (request === taskRequest && !home.hidden) {
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
  startSession("rest", "Descanso sin móvil", 5);
});
backButton.addEventListener("click", leaveSession);
doneButton.addEventListener("click", () => {
  if (currentSession?.kind !== "task") return;
  const completed = donePrefix + currentSession.id;
  if (!read(completed)) write(completed, dateKey(new Date()));
  leaveSession();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) wasAway = true;
  else resumeWhenVisible();
  paintTimer();
});

window.addEventListener("pagehide", () => {
  wasAway = true;
});

window.addEventListener("pageshow", () => {
  resumeWhenVisible();
  paintTimer();
});

window.addEventListener("storage", (event) => {
  if (event.key === null || event.key.startsWith(prefix)) paintStats();
});

recordEntry();
refreshStats();
if (currentSession) showSession();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
