import {
  initFirebase,
  onAuth,
  loginGoogle,
  logoutGoogle,
  loadData,
  subscribeData,
  saveData,
  stopDataSubscription
} from "./firebase.js";

import {
  initCalendar,
  connectCalendar,
  isCalendarReady,
  isCalendarConnected,
  upsertCalendarEvent,
  deleteCalendarEvent
} from "./calendar.js";

import { pericopesFor } from "./pericopes.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const DAYS = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"
];

const TYPES = [
  "Culto Dominical",
  "Cena del Señor",
  "Acción de Gracias",
  "Reunión de Oración",
  "Estudio Bíblico",
  "Culto Familiar",
  "Invitado"
];

const NAV = [
  ["dashboard", "🏠", "Inicio"],
  ["calendar", "📅", "Calendario"],
  ["events", "📋", "Reuniones"],
  ["people", "🎤", "Equipo"],
  ["guests", "🙋", "Invitados"],
  ["series", "📖", "Series"],
  ["settings", "⚙", "Config."]
];

const app = $("#app");

const state = {
  user: null,
  authResolved: false,
  cloudLoaded: false,
  view: "dashboard",
  modal: null,
  toast: "",
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selectedSeriesId: null,
  data: createDefaults()
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createDefaults() {
  return {
    theme: "dark",
    churchName: "Iglesia Bautista Fe y Gracia de Dios",
    settings: {
      autoCalendarOnSave: false,
      schedules: [
        { id: uid(), day: 0, time: "10:30", type: "Culto Dominical" },
        { id: uid(), day: 4, time: "20:00", type: "Estudio Bíblico" }
      ]
    },
    events: [],
    people: [
      { id: uid(), name: "Gabriel Hijo", role: "Predicador", email: "", phone: "", notes: "" },
      { id: uid(), name: "Camilo González", role: "Ambos", email: "", phone: "", notes: "" },
      { id: uid(), name: "Josué Huaiquio", role: "Predicador", email: "", phone: "", notes: "" },
      { id: uid(), name: "Daniel Frías", role: "Coordinador", email: "", phone: "", notes: "" },
      { id: uid(), name: "Marcelo Vásquez", role: "Coordinador", email: "", phone: "", notes: "" },
      { id: uid(), name: "Gabriel Padre", role: "Coordinador", email: "", phone: "", notes: "" }
    ],
    guests: [],
    series: [
      { id: uid(), name: "Hebreos", chapters: 13, done: 0, pericopeIndex: 0, passageNotes: {}, notes: "" },
      { id: uid(), name: "2 Pedro", chapters: 3, done: 0, pericopeIndex: 0, passageNotes: {}, notes: "" }
    ]
  };
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmt(dateString) {
  if (!dateString) return "—";
  const [y, m, d] = dateString.split("-");
  return `${d}/${m}/${y}`;
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mergeData(defaultsData, incomingData = {}) {
  return {
    ...defaultsData,
    ...incomingData,
    settings: {
      ...defaultsData.settings,
      ...(incomingData.settings || {}),
      schedules: incomingData.settings?.schedules?.length
        ? incomingData.settings.schedules
        : defaultsData.settings.schedules
    },
    people: incomingData.people?.length ? incomingData.people : defaultsData.people,
    events: incomingData.events || [],
    guests: incomingData.guests || [],
    series: (incomingData.series?.length ? incomingData.series : defaultsData.series)
      .map((serie) => ({ pericopeIndex: 0, passageNotes: {}, ...serie }))
  };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem("liturgica-v7");
    if (raw) {
      state.data = mergeData(createDefaults(), JSON.parse(raw));
    }
  } catch (error) {
    console.warn("No se pudo cargar localStorage:", error);
  }
}

function saveLocal() {
  localStorage.setItem("liturgica-v7", JSON.stringify(state.data));
}

async function persist() {
  document.documentElement.setAttribute("data-theme", state.data.theme || "dark");
  saveLocal();

  if (state.user && state.cloudLoaded) {
    await saveData(state.user.uid, state.data);
  }

  render();
}

function setData(updater) {
  state.data = typeof updater === "function" ? updater(state.data) : updater;
  persist().catch(console.error);
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = "";
    render();
  }, 3200);
}

function setView(view) {
  state.view = view;
  state.modal = null;
  render();
}

function openModal(type, payload = {}) {
  state.modal = { type, ...payload };
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

function sortedEvents() {
  return [...state.data.events].sort((a, b) =>
    `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
  );
}

function monthlyEvents() {
  return sortedEvents().filter((event) => {
    const [y, m] = event.date.split("-").map(Number);
    return y === state.year && m === state.month + 1;
  });
}

function currentMonthLabel() {
  return `${MONTHS[state.month]} ${state.year}`;
}

function sanitizeFilePart(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agenda";
}

function monthlyShareEvents() {
  return monthlyEvents().map((event) => {
    const [y, m, d] = event.date.split("-").map(Number);
    const jsDate = new Date(y, m - 1, d);
    return {
      ...event,
      day: d,
      weekday: DAYS[jsDate.getDay()]
    };
  });
}

function futureEvents() {
  return sortedEvents().filter((event) => event.date >= today());
}

function eventClass(type = "") {
  const t = type.toLowerCase();
  if (t.includes("cena")) return "cena";
  if (t.includes("acción")) return "accion";
  if (t.includes("estudio")) return "estudio";
  if (t.includes("oración")) return "oracion";
  return "";
}

function seriesPercent(serie) {
  const chapters = Math.max(1, Number(serie.chapters || 1));
  const done = Math.min(chapters, Math.max(0, Number(serie.done || 0)));
  return Math.round((done / chapters) * 100);
}

// Extrae el capítulo final de una referencia de pericopa, ej:
// "Hebreos 5:11-6:12" -> 6, "Hebreos 1:1-4" -> 1, "Salmos 1" -> 1
function pericopeEndChapter(ref = "") {
  const chapterVerse = [...ref.matchAll(/(\d+):(\d+)/g)];
  if (chapterVerse.length) return Number(chapterVerse[chapterVerse.length - 1][1]);
  const trailingNumber = ref.match(/(\d+)\s*$/);
  return trailingNumber ? Number(trailingNumber[1]) : 0;
}

// Calcula hasta qué pericopa deberíamos ir según "capítulos completados",
// para que la sugerencia avance sola cuando editas ese campo en la serie.
function chapterSyncIndex(serie) {
  const list = pericopesFor(serie);
  const done = Number(serie.done || 0);
  let index = 0;
  while (index < list.length && pericopeEndChapter(list[index].ref) <= done) {
    index++;
  }
  return index;
}

// Índice real a usar: el mayor entre el cursor guardado (avanzado manualmente
// o por "Generar mes") y el que corresponde según capítulos completados.
function effectivePericopeIndex(serie) {
  const list = pericopesFor(serie);
  const stored = Number(serie.pericopeIndex || 0);
  const synced = chapterSyncIndex(serie);
  return Math.min(list.length, Math.max(stored, synced));
}

// Busca la serie vinculada al tipo de reunión (según Config. > Horarios)
// y devuelve la próxima pericopa sugerida en orden, o null si no aplica.
function suggestedPericopeForType(type) {
  const schedule = (state.data.settings.schedules || []).find((s) => s.type === type && s.seriesId);
  if (!schedule) return null;
  const serie = state.data.series.find((s) => s.id === schedule.seriesId);
  if (!serie) return null;
  const list = pericopesFor(serie);
  const index = effectivePericopeIndex(serie);
  return index < list.length ? list[index] : null;
}

function renderDashboardSeriesProgress() {
  const series = state.data.series || [];

  if (!series.length) {
    return `<p class="muted">Aún no hay series bíblicas registradas.</p>`;
  }

  return series.map((serie) => {
    const chapters = Math.max(1, Number(serie.chapters || 1));
    const done = Math.min(chapters, Math.max(0, Number(serie.done || 0)));
    const pct = seriesPercent(serie);
    const remaining = Math.max(0, chapters - done);

    return `
      <div class="series-progress-item">
        <div class="series-progress-head">
          <strong>${escapeHtml(serie.name)}</strong>
          <span>${pct}%</span>
        </div>
        <div class="series-progress-bar">
          <i style="width:${pct}%"></i>
        </div>
        <div class="series-progress-meta">
          <span>${done} de ${chapters} completados</span>
          <span>${remaining ? `Restan ${remaining}` : "Serie completada"}</span>
        </div>
      </div>
    `;
  }).join("");
}

function nextEventForType(type) {
  return futureEvents().find((event) => event.type === type) || null;
}

const TYPE_ICON = {
  "Culto Dominical": "⛪",
  "Cena del Señor": "🍞",
  "Acción de Gracias": "🙏",
  "Reunión de Oración": "🕊",
  "Estudio Bíblico": "📖",
  "Culto Familiar": "🏡",
  "Invitado": "🙋"
};

function seriesStats() {
  const series = state.data.series || [];
  if (!series.length) {
    return { count: 0, avgPct: 0, doneChapters: 0, active: 0, feature: null };
  }
  const pctList = series.map(seriesPercent);
  const avgPct = Math.round(pctList.reduce((a, b) => a + b, 0) / series.length);
  const doneChapters = series.reduce((sum, s) => sum + Math.min(Number(s.chapters || 0), Math.max(0, Number(s.done || 0))), 0);
  const active = series.filter((s) => seriesPercent(s) < 100).length;
  const feature = series.find((s) => seriesPercent(s) < 100) || series[0];
  return { count: series.length, avgPct, doneChapters, active, feature };
}

function renderHeroMeetingCard(schedule, colorClass) {
  const next = nextEventForType(schedule.type);
  const icon = TYPE_ICON[schedule.type] || "📌";
  const complete = next && (next.preacher || next.guest) && next.coordinator && next.passage;

  return `
    <article class="hero-card ${colorClass}">
      <div class="hero-card-top">
        <div class="hero-avatars">
          ${next && next.preacher ? `<span class="mini-avatar">${initials(next.preacher)}</span>` : ""}
          ${next && !next.preacher && next.guest ? `<span class="mini-avatar guest-avatar">${initials(next.guest)}</span>` : ""}
          ${next && next.coordinator ? `<span class="mini-avatar">${initials(next.coordinator)}</span>` : ""}
          ${!next ? `<span class="mini-avatar muted-avatar">${icon}</span>` : ""}
        </div>
        <span class="status-chip ${next ? (complete ? "ok" : "warn") : "off"}">
          ${next ? (complete ? "Confirmado" : "Faltan datos") : "Sin programar"}
        </span>
      </div>
      <div class="hero-card-bottom">
        <p class="hero-day">${DAYS[schedule.day].toUpperCase()}</p>
        <div class="hero-card-row">
          <div class="hero-card-info">
            <strong>${escapeHtml(schedule.type)}</strong>
            <small>${next ? escapeHtml(next.passage || "Pasaje pendiente") : "Aún no hay reunión generada"}</small>
            <small class="hero-card-meta">${next ? `${fmt(next.date)} · ${escapeHtml(next.time || schedule.time)}` : `Cada ${DAYS[schedule.day].toLowerCase()} · ${schedule.time}`}</small>
          </div>
          <button class="hero-arrow" data-action="${next ? "event-edit" : "event-new"}" ${next ? `data-id="${next.id}"` : ""}>↗</button>
        </div>
      </div>
    </article>
  `;
}

function renderMiniCalendar() {
  const firstDow = new Date(state.year, state.month, 1).getDay();
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  const startPad = (firstDow + 6) % 7; // Monday-first grid
  const eventDates = new Set(monthlyEvents().map((event) => Number(event.date.split("-")[2])));
  const todayStr = today();

  let cells = "";
  for (let i = 0; i < startPad; i++) cells += `<span></span>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(state.year, state.month, d).getDay();
    const isMainDay = dow === 0 || dow === 4;
    const dateStr = `${state.year}-${pad(state.month + 1)}-${pad(d)}`;
    const isToday = dateStr === todayStr;
    const cls = isToday ? "mini-today" : isMainDay ? "mini-main" : "";
    cells += `
      <button class="mini-day ${cls}" data-action="calendar-jump" data-date="${dateStr}">
        ${d}${eventDates.has(d) ? `<i class="mini-dot"></i>` : ""}
      </button>
    `;
  }

  return `
    <div class="mini-cal">
      <div class="mini-cal-head">
        <strong class="v12-current-month">${MONTHS[state.month]} ${state.year}</strong>
        <div class="mini-cal-nav">
          <button data-action="month-prev">‹</button>
          <button data-action="month-next">›</button>
        </div>
      </div>
      <div class="mini-cal-weekdays">
        ${["LU", "MA", "MI", "JU", "VI", "SA", "DO"].map((d) => `<span>${d}</span>`).join("")}
      </div>
      <div class="mini-cal-grid">${cells}</div>
    </div>
  `;
}


function dashboardPersonCounts(field) {
  const counts = {};
  state.data.events.forEach((event) => {
    const name = event[field];
    if (name) counts[name] = (counts[name] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function dashboardSeriesMetrics() {
  const series = state.data.series || [];
  const studied = series.filter((serie) => Number(serie.done || 0) > 0).length;
  const completed = series.filter((serie) => seriesPercent(serie) >= 100).length;
  const active = series.filter((serie) => seriesPercent(serie) < 100).length;
  return { studied, completed, active, total: series.length };
}

function dashboardMiniCalendar() {
  const firstDay = new Date(state.year, state.month, 1);
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  let cells = "";

  for (let i = 0; i < mondayOffset; i++) {
    cells += `<span class="v10-mini-day empty"></span>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${state.year}-${pad(state.month + 1)}-${pad(day)}`;
    const dayEvents = state.data.events.filter((event) => event.date === date);
    const dots = dayEvents.slice(0, 3).map((event) => {
      const cls = eventClass(event.type) || "default";
      return `<i class="${cls}"></i>`;
    }).join("");

    cells += `
      <button class="v10-mini-day ${date === today() ? "today" : ""}" data-action="event-new-date" data-date="${date}">
        <span>${day}</span>
        <small>${dots}</small>
      </button>
    `;
  }

  return `
    <div class="v10-mini-calendar">
      <div class="v10-mini-calendar-head">
        <strong>${MONTHS[state.month]} ${state.year}</strong>
        <div>
          <button class="v10-mini-arrow" data-action="month-prev">‹</button>
          <button class="v10-mini-arrow" data-action="month-next">›</button>
        </div>
      </div>
      <div class="v10-mini-weekdays">
        ${["LU", "MA", "MI", "JU", "VI", "SÁ", "DO"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="v10-mini-days">${cells}</div>
      <div class="v10-mini-legend">
        <span><i class="default"></i> Reuniones</span>
        <span><i class="estudio"></i> Estudios</span>
        <span><i class="oracion"></i> Oración</span>
      </div>
    </div>
  `;
}

function dashboardBooksPanel() {
  const series = state.data.series || [];
  if (!series.length) return `<p class="muted">Aún no hay libros registrados.</p>`;

  return series.slice(0, 4).map((serie, index) => {
    const chapters = Math.max(1, Number(serie.chapters || 1));
    const done = Math.min(chapters, Math.max(0, Number(serie.done || 0)));
    const pct = seriesPercent(serie);
    const tones = ["violet", "green", "amber", "blue"];
    return `
      <div class="v10-book-row">
        <span class="v10-book-icon ${tones[index % tones.length]}">▤</span>
        <div class="v10-book-main">
          <div class="v10-book-head">
            <strong>${escapeHtml(serie.name)}</strong>
            <b>${pct}%</b>
          </div>
          <div class="v10-book-track"><i class="${tones[index % tones.length]}" style="width:${pct}%"></i></div>
          <small>${done} de ${chapters} capítulos</small>
        </div>
      </div>
    `;
  }).join("");
}

function dashboardPendingItems() {
  const future = futureEvents();
  const items = [];

  future.slice(0, 12).forEach((event) => {
    if (!event.preacher && !event.guest) {
      items.push(["red", "Confirmar predicador", `${fmt(event.date)} · ${event.type}`]);
    }
    if (!event.coordinator) {
      items.push(["green", "Asignar coordinador", `${fmt(event.date)} · ${event.type}`]);
    }
    if (!event.passage) {
      items.push(["amber", "Agregar pasaje bíblico", `${fmt(event.date)} · ${event.type}`]);
    }
  });

  if (!items.length) {
    items.push(["violet", "Planificación completa", "No hay datos pendientes"]);
  }

  return items.slice(0, 5).map(([tone, title, sub]) => `
    <div class="v10-pending-item">
      <span class="v10-pending-icon ${tone}">✓</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(sub)}</small>
      </div>
    </div>
  `).join("");
}

function statusPills() {
  const session = state.authResolved
    ? state.user
      ? `🟢 ${escapeHtml(state.user.email)}`
      : "⚪ Sin sesión"
    : "🟡 Cargando sesión";

  const db = state.user
    ? state.cloudLoaded
      ? "🟢 Firebase sincronizado"
      : "🟡 Cargando datos"
    : "⚪ Modo local";

  const calendar = isCalendarConnected()
    ? "🟢 Calendar conectado"
    : isCalendarReady()
      ? "🟡 Calendar listo"
      : "⚪ Calendar pendiente";

  return `
    <div class="mini-status">
      <span>${session}</span>
      <span>${db}</span>
      <span>${calendar}</span>
    </div>
  `;
}

function render() {
  document.documentElement.setAttribute("data-theme", state.data.theme || "dark");

  app.innerHTML = `
    ${renderTopbar()}
    ${renderMobileTabs()}
    <main class="shell">
      ${renderSidebar()}
      <section class="workspace">
        ${renderCurrentView()}
      </section>
    </main>
    ${renderModal()}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
}

function renderTopbar() {
  const displayName = state.user?.displayName || state.user?.email?.split("@")[0] || "Administrador";
  const avatar = state.user?.photoURL
    ? `<img src="${escapeHtml(state.user.photoURL)}" alt="">`
    : `<span>${initials(displayName)}</span>`;

  return `
    <header class="topbar v10-topbar">
      <div class="v10-mobile-brand">
        <div class="brand-mark">✝</div>
        <strong>Planificación Litúrgica</strong>
      </div>

      <div class="v10-search">
        <span>⌕</span>
        <input type="search" placeholder="Buscar reuniones, personas, series..." aria-label="Buscar">
      </div>

      <div class="top-actions v10-top-actions">
        <button class="v10-round-btn" data-action="export-month-image" title="Descargar imagen mensual">⇩</button>
        <button class="v10-round-btn" data-action="theme" title="Cambiar apariencia">${state.data.theme === "dark" ? "◐" : "◑"}</button>
        <div class="v10-profile">
          <div class="v10-avatar">${avatar}</div>
          <div class="v10-profile-copy">
            <strong>${escapeHtml(displayName)}</strong>
            <small>${state.user ? "Administrador" : "Sin sesión"}</small>
          </div>
        </div>
        ${
          state.user
            ? `<button class="btn ghost small" data-action="logout">Salir</button>`
            : `<button class="btn primary small" data-action="login">Ingresar</button>`
        }
      </div>
    </header>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar v10-sidebar">
      <div class="v10-side-brand">
        <div class="v10-side-logo">✝</div>
        <div>
          <strong>Planificación</strong>
          <span>Litúrgica</span>
        </div>
      </div>

      <nav class="v10-side-nav" aria-label="Navegación principal">
        ${NAV.map(([id, icon, label]) => `
          <button class="nav ${state.view === id ? "active" : ""}" data-view="${id}">
            <span class="nav-icon">${icon}</span>
            <span>${label === "Inicio" ? "Dashboard" : label === "Config." ? "Configuración" : label}</span>
          </button>
        `).join("")}
      </nav>

      <div class="v10-side-footer">
        <div class="v10-church-icon">⌂</div>
        <div>
          <strong>${escapeHtml(state.data.churchName || "Iglesia local")}</strong>
          <span>Administrador</span>
        </div>
      </div>
    </aside>
  `;
}

function renderMobileTabs() {
  return `
    <nav class="mobile-tabs">
      ${NAV.map(([id, icon, label]) => `
        <button class="nav ${state.view === id ? "active" : ""}" data-view="${id}">
          ${icon}<span>${label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function pageHead(title, subtitle, actions = "") {
  const meta = {
    "Calendario": ["▦", "PLANIFICACIÓN MENSUAL"],
    "Reuniones": ["▣", "SERVICIOS Y RESPONSABLES"],
    "Equipo": ["♙", "DISTRIBUCIÓN MINISTERIAL"],
    "Invitados": ["✦", "PASTORES Y COLABORADORES"],
    "Configuración": ["⚙", "AJUSTES DEL SISTEMA"]
  }[title] || ["✦", "PLANIFICACIÓN LITÚRGICA"];

  return `
    <div class="page-head v12-page-head">
      <div class="v12-page-title">
        <span class="v12-page-icon">${meta[0]}</span>
        <div>
          <small>${meta[1]}</small>
          <h2>${title}</h2>
          <p>${subtitle}</p>
        </div>
      </div>
      <div class="inline v12-page-actions">${actions}</div>
    </div>
  `;
}

function renderCurrentView() {
  switch (state.view) {
    case "calendar": return renderCalendarView();
    case "events": return renderEventsView();
    case "people": return renderPeopleView();
    case "guests": return renderGuestsView();
    case "series": return renderSeriesView();
    case "settings": return renderSettingsView();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  const future = futureEvents();
  const monthly = monthlyEvents();
  const next = future[0] || null;
  const pendingCount = future.slice(0, 12).reduce((total, event) => {
    return total
      + (!event.preacher && !event.guest ? 1 : 0)
      + (!event.coordinator ? 1 : 0)
      + (!event.passage ? 1 : 0);
  }, 0);

  const preacherCounts = dashboardPersonCounts("preacher").slice(0, 5);
  const coordinatorCounts = dashboardPersonCounts("coordinator");
  const maxPreach = Math.max(1, ...preacherCounts.map(([, count]) => count));
  const totalCoord = coordinatorCounts.reduce((sum, [, count]) => sum + count, 0);
  const assignedCoord = state.data.events.filter((event) => event.coordinator).length;
  const coordPct = state.data.events.length
    ? Math.round((assignedCoord / state.data.events.length) * 100)
    : 0;
  const seriesMetric = dashboardSeriesMetrics();
  const displayName = state.user?.displayName || state.user?.email?.split("@")[0] || "Administrador";

  return `
    <section class="view dashboard-view v10-dashboard">
      <div class="v10-welcome">
        <div>
          <h1>Hola, ${escapeHtml(displayName)} <span>👋</span></h1>
          <p>Centro de control ministerial</p>
        </div>
        <button class="btn primary" data-action="event-new">＋ Nueva reunión</button>
      </div>

      <div class="v10-summary-grid">
        <button class="v10-summary-card" data-action="${next ? "event-edit" : "event-new"}" ${next ? `data-id="${next.id}"` : ""}>
          <span class="v10-summary-icon violet">▣</span>
          <div>
            <small>Próxima reunión</small>
            <strong>${next ? `${fmt(next.date)} · ${escapeHtml(next.time || "")}` : "Sin reuniones"}</strong>
            <em>${next ? escapeHtml(next.type) : "Crear reunión"}</em>
          </div>
          <b>›</b>
        </button>

        <button class="v10-summary-card" data-view="events">
          <span class="v10-summary-icon blue">♙</span>
          <div>
            <small>Reuniones del mes</small>
            <strong>${monthly.length}</strong>
            <em>Programadas</em>
          </div>
          <b>›</b>
        </button>

        <button class="v10-summary-card" data-view="series">
          <span class="v10-summary-icon green">▤</span>
          <div>
            <small>Series activas</small>
            <strong>${seriesMetric.active}</strong>
            <em>En progreso</em>
          </div>
          <b>›</b>
        </button>

        <button class="v10-summary-card" data-view="series">
          <span class="v10-summary-icon amber">▥</span>
          <div>
            <small>Libros estudiados</small>
            <strong>${seriesMetric.studied}</strong>
            <em>${seriesMetric.completed} completados</em>
          </div>
          <b>›</b>
        </button>
      </div>

      <div class="v10-dashboard-grid">
        <div class="v10-left-column">
          <section class="v10-panel v10-events-panel">
            <div class="v10-panel-head">
              <div>
                <span class="v10-panel-icon">▣</span>
                <h2>Próximos eventos</h2>
              </div>
              <button class="v10-soft-btn" data-view="calendar">Ver calendario</button>
            </div>

            <div class="v10-event-header">
              <span>Fecha</span><span>Hora</span><span>Tipo</span><span>Predicador</span><span>Coordinador</span><span>Pasaje bíblico</span>
            </div>

            <div class="v10-event-list">
              ${
                future.length
                  ? future.slice(0, 5).map((event) => {
                      const [year, month, day] = event.date.split("-").map(Number);
                      return `
                        <button class="v10-event-row" data-action="event-edit" data-id="${event.id}">
                          <span class="v10-event-date"><small>${MONTHS[month - 1].slice(0, 3).toUpperCase()}</small><b>${pad(day)}</b></span>
                          <span class="v10-event-time"><b>${escapeHtml(event.time || "—")}</b><small>hrs.</small></span>
                          <span><em class="v10-type-pill ${eventClass(event.type)}">${escapeHtml(event.type)}</em></span>
                          <span class="v10-person-cell"><i>${initials(event.preacher || event.guest || "?")}</i>${escapeHtml(event.preacher || event.guest || "Pendiente")}</span>
                          <span class="v10-person-cell"><i>${initials(event.coordinator || "?")}</i>${escapeHtml(event.coordinator || "Pendiente")}</span>
                          <span class="v10-passage">${escapeHtml(event.passage || "Sin pasaje")}</span>
                        </button>
                      `;
                    }).join("")
                  : `<div class="v10-empty">No hay próximos eventos.</div>`
              }
            </div>

            <button class="v10-bottom-link" data-view="events">Ver todos los eventos <span>›</span></button>
          </section>

          <section class="v10-panel v10-overview-panel">
            <div class="v10-panel-head">
              <div><h2>Resumen general</h2></div>
            </div>
            <div class="v10-overview-grid">
              <div><span class="violet">♙</span><strong>${state.data.people.length}</strong><small>Integrantes del equipo</small></div>
              <div><span class="green">↗</span><strong>${monthly.length}</strong><small>Reuniones este mes</small></div>
              <div><span class="amber">◷</span><strong>${state.data.series.length}</strong><small>Libros registrados</small></div>
              <div><span class="blue">＋</span><strong>${state.data.guests.length}</strong><small>Invitados guardados</small></div>
            </div>
          </section>
        </div>

        <div class="v10-right-column">
          <section class="v10-panel v10-workload">
            <div class="v10-panel-head">
              <div><h2>Carga ministerial</h2></div>
            </div>

            <div class="v10-workload-grid">
              <div class="v10-bars-area">
                <h3>Predicaciones por persona</h3>
                <div class="v10-bars">
                  ${
                    preacherCounts.length
                      ? preacherCounts.map(([name, count]) => `
                          <div class="v10-bar-item">
                            <div class="v10-bar-wrap">
                              <b>${count}</b>
                              <i style="height:${Math.max(18, Math.round((count / maxPreach) * 118))}px"></i>
                            </div>
                            <span>${escapeHtml(name.split(" ").slice(0, 2).join(" "))}</span>
                          </div>
                        `).join("")
                      : `<p class="muted">Sin predicaciones registradas.</p>`
                  }
                </div>
              </div>

              <div class="v10-donut-area">
                <h3>Coordinaciones</h3>
                <div class="v10-donut" style="--value:${coordPct}">
                  <div><strong>${coordPct}%</strong><span>Asignadas</span></div>
                </div>
                <div class="v10-donut-legend">
                  <span><i></i> Asignadas (${assignedCoord})</span>
                  <span><i></i> Pendientes (${Math.max(0, state.data.events.length - assignedCoord)})</span>
                </div>
              </div>
            </div>
          </section>

          <div class="v10-bottom-widgets">
            <section class="v10-panel v10-calendar-widget">
              ${dashboardMiniCalendar()}
            </section>

            <section class="v10-panel v10-books-widget">
              <div class="v10-panel-head">
                <div><h2>Métrica de libros estudiados</h2></div>
              </div>
              <div class="v10-books-list">${dashboardBooksPanel()}</div>
              <button class="v10-bottom-link" data-view="series">Ver todos los libros <span>›</span></button>
            </section>

            <section class="v10-panel v10-pending-widget">
              <div class="v10-panel-head">
                <div><h2>Pendientes</h2></div>
                <span class="v10-count-badge">${pendingCount}</span>
              </div>
              <div class="v10-pending-list">${dashboardPendingItems()}</div>
              <button class="v10-bottom-link" data-view="events">Ver todos <span>›</span></button>
            </section>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCalendarView() {
  const first = new Date(state.year, state.month, 1).getDay();
  const days = new Date(state.year, state.month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < first; i++) {
    cells.push(`<div class="day empty"></div>`);
  }

  for (let d = 1; d <= days; d++) {
    const date = `${state.year}-${pad(state.month + 1)}-${pad(d)}`;
    const events = state.data.events.filter((event) => event.date === date);

    cells.push(`
      <div class="day ${date === today() ? "today" : ""}" data-action="event-new-date" data-date="${date}">
        <div class="day-num">${d}</div>
        ${events.map((event) => `
          <div class="day-event ${eventClass(event.type)}" title="${escapeHtml(event.type)}">
            ${escapeHtml(event.type)}
          </div>
        `).join("")}
      </div>
    `);
  }

  return `
    <section class="view v12-standard-view v12-calendar-view">
      ${pageHead(
        "Calendario",
        "Vista mensual con generación automática.",
        `
          <button class="btn ghost" data-action="month-prev">‹</button>
          <strong>${MONTHS[state.month]} ${state.year}</strong>
          <button class="btn ghost" data-action="month-next">›</button>
          <button class="btn secondary" data-action="month-generate">Generar mes</button>
          <button class="btn gold" data-action="export-month-image">Descargar imagen</button>
        `
      )}

      <div class="weekdays">
        ${DAYS.map((day) => `<span>${day.slice(0, 3)}</span>`).join("")}
      </div>

      <div class="calendar-grid">
        ${cells.join("")}
      </div>
    </section>
  `;
}

function renderEventsView() {
  const rows = sortedEvents();

  return `
    <section class="view v12-standard-view v12-events-view">
      ${pageHead(
        "Reuniones",
        "Listado completo de reuniones.",
        `
          <button class="btn secondary" data-action="event-new-guest">＋ Invitado</button>
          <button class="btn primary" data-action="event-new">＋ Reunión</button>
        `
      )}

      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Predicador</th>
              <th>Coordinador</th>
              <th>Pasaje</th>
              <th>Invitado</th>
              <th>Calendar</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map((event) => `
                    <tr>
                      <td><strong>${fmt(event.date)}</strong></td>
                      <td>${escapeHtml(event.time || "—")}</td>
                      <td><span class="badge v12-type-badge ${eventClass(event.type)}">${escapeHtml(event.type)}</span></td>
                      <td>${escapeHtml(event.preacher || "—")}</td>
                      <td>${escapeHtml(event.coordinator || "—")}</td>
                      <td>${escapeHtml(event.passage || "—")}</td>
                      <td>${escapeHtml(event.guest || "—")}</td>
                      <td>
                        ${
                          event.calendarId
                            ? "✅"
                            : `<button class="btn ghost small" data-action="calendar-send" data-id="${event.id}">Enviar</button>`
                        }
                      </td>
                      <td><button class="action" data-action="event-edit" data-id="${event.id}">✏️</button></td>
                    </tr>
                  `).join("")
                : `<tr><td colspan="9"><div class="v12-empty-state"><span>▣</span><strong>No hay reuniones registradas</strong><small>Crea una reunión para comenzar la planificación.</small><button class="btn primary" data-action="event-new">＋ Nueva reunión</button></div></td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPeopleView() {
  return `
    <section class="view v12-standard-view v12-people-view">
      ${pageHead(
        "Equipo",
        "Predicadores, coordinadores e invitados que predican.",
        `
          <button class="btn secondary" data-action="guest-new">＋ Invitado</button>
          <button class="btn primary" data-action="person-new">＋ Persona</button>
        `
      )}

      <div class="grid-cards">
        ${state.data.people.map((person) => {
          const preachCount = state.data.events.filter((event) => event.preacher === person.name).length;
          const coordCount = state.data.events.filter((event) => event.coordinator === person.name).length;

          return `
            <article class="info-card editable-card v12-person-card">
              <div class="v12-card-top"><div class="avatar">${initials(person.name)}</div><span class="v12-card-status">Equipo</span></div>
              <h3>${escapeHtml(person.name)}</h3>
              <p>${escapeHtml(person.role)}</p>
              <p>${escapeHtml(person.email || "Sin correo")}</p>
              <p>${escapeHtml(person.phone || "Sin teléfono")}</p>
              <div class="inline" style="margin-top:10px">
                <span class="badge blue">Predica: ${preachCount}</span>
                <span class="badge green">Coordina: ${coordCount}</span>
              </div>
              <div class="card-actions">
                <button class="btn ghost" data-action="person-edit" data-id="${person.id}">Editar</button>
                <button class="btn danger" data-action="person-delete" data-id="${person.id}">Eliminar</button>
              </div>
            </article>
          `;
        }).join("")}

        ${state.data.guests.map((guest) => {
          const preachCount = state.data.events.filter((event) => event.guest === guest.name).length;

          return `
            <article class="info-card editable-card v12-person-card">
              <div class="v12-card-top"><div class="avatar guest-avatar">${initials(guest.name)}</div><span class="v12-card-status guest">Invitado</span></div>
              <h3>${escapeHtml(guest.name)} <span class="badge gold">Invitado</span></h3>
              <p>${escapeHtml(guest.church || "Sin referencia")}</p>
              <p>${escapeHtml(guest.email || "Sin correo")}</p>
              <p>${escapeHtml(guest.phone || "Sin teléfono")}</p>
              <div class="inline" style="margin-top:10px">
                <span class="badge blue">Predica: ${preachCount}</span>
              </div>
              <div class="card-actions">
                <button class="btn ghost" data-action="guest-edit" data-id="${guest.id}">Editar</button>
                <button class="btn danger" data-action="guest-delete" data-id="${guest.id}">Eliminar</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderGuestsView() {
  return `
    <section class="view v12-standard-view v12-guests-view">
      ${pageHead(
        "Invitados",
        "Predicadores invitados, iglesias y notas.",
        `<button class="btn primary" data-action="guest-new">＋ Invitado</button>`
      )}

      <div class="grid-cards">
        ${
          state.data.guests.length
            ? state.data.guests.map((guest) => `
                <article class="info-card editable-card v12-person-card v12-guest-card">
                  <div class="avatar">${initials(guest.name)}</div>
                  <h3>${escapeHtml(guest.name)}</h3>
                  <p>${escapeHtml(guest.church || "Sin referencia")}</p>
                  <p>${escapeHtml(guest.email || "Sin correo")}</p>
                  <p>${escapeHtml(guest.phone || "Sin teléfono")}</p>
                  <div class="card-actions">
                    <button class="btn ghost" data-action="guest-edit" data-id="${guest.id}">Editar</button>
                    <button class="btn danger" data-action="guest-delete" data-id="${guest.id}">Eliminar</button>
                  </div>
                </article>
              `).join("")
            : `<p class="muted">Aún no hay invitados guardados.</p>`
        }
      </div>
    </section>
  `;
}


function literaryStructureFor(serie) {
  const name = String(serie?.name || "").toLowerCase();

  if (name.includes("hebreos")) {
    return [
      { title: "El Hijo: revelación suprema de Dios", range: "Hebreos 1:1–4", chapters: [1] },
      { title: "Cristo superior a los ángeles", range: "Hebreos 1:5–2:18", chapters: [1, 2] },
      { title: "Cristo superior a Moisés", range: "Hebreos 3:1–4:13", chapters: [3, 4] },
      { title: "El gran Sumo Sacerdote", range: "Hebreos 4:14–7:28", chapters: [4, 5, 6, 7] },
      { title: "El nuevo y mejor pacto", range: "Hebreos 8:1–10:18", chapters: [8, 9, 10] },
      { title: "Perseverar por la fe", range: "Hebreos 10:19–12:29", chapters: [10, 11, 12] },
      { title: "Exhortaciones finales", range: "Hebreos 13", chapters: [13] }
    ];
  }

  if (name.includes("2 pedro")) {
    return [
      { title: "Crecer en el conocimiento de Cristo", range: "2 Pedro 1:1–11", chapters: [1] },
      { title: "La Palabra profética segura", range: "2 Pedro 1:12–21", chapters: [1] },
      { title: "Advertencia contra falsos maestros", range: "2 Pedro 2", chapters: [2] },
      { title: "La venida del Señor", range: "2 Pedro 3:1–13", chapters: [3] },
      { title: "Crecer en gracia", range: "2 Pedro 3:14–18", chapters: [3] }
    ];
  }

  const chapters = Math.max(1, Number(serie?.chapters || 1));
  return Array.from({ length: chapters }, (_, index) => ({
    title: `Capítulo ${index + 1}`,
    range: `${serie.name} ${index + 1}`,
    chapters: [index + 1]
  }));
}

function passageWorkspaceData(serie, ref) {
  return serie?.passageNotes?.[ref] || {
    observation: "",
    interpretation: "",
    application: "",
    outline: "",
    teacherGuide: "",
    studentMaterial: "",
    videoUrl: "",
    resources: ""
  };
}

function renderPassageWorkspaceModal() {
  const serie = state.data.series.find((item) => item.id === state.modal.seriesId);
  if (!serie) return "";

  const ref = state.modal.ref || "";
  const title = state.modal.title || "Pasaje de la serie";
  const notes = passageWorkspaceData(serie, ref);

  return `
    <div class="modal-wrap v11-workspace-wrap">
      <div class="modal v11-workspace-modal">
        <header>
          <div>
            <small>${escapeHtml(serie.name)}</small>
            <h3>${escapeHtml(ref)}</h3>
            <p>${escapeHtml(title)}</p>
          </div>
          <button class="close" data-action="modal-close">×</button>
        </header>

        <div class="v11-workspace-intro">
          <span>📖</span>
          <div>
            <strong>Centro de preparación bíblica</strong>
            <small>Organiza el estudio, el bosquejo y los materiales vinculados con este pasaje.</small>
          </div>
        </div>

        <div class="v11-study-grid">
          <label>
            <span>👀 Observación</span>
            <textarea id="passageObservation" rows="5" placeholder="¿Qué dice el texto? Personas, verbos, conectores, repeticiones y estructura.">${escapeHtml(notes.observation)}</textarea>
          </label>

          <label>
            <span>🧠 Interpretación</span>
            <textarea id="passageInterpretation" rows="5" placeholder="¿Qué quiso comunicar el autor a sus primeros lectores?">${escapeHtml(notes.interpretation)}</textarea>
          </label>

          <label>
            <span>❤️ Aplicación</span>
            <textarea id="passageApplication" rows="5" placeholder="¿Cómo debe responder la iglesia a esta verdad?">${escapeHtml(notes.application)}</textarea>
          </label>

          <label>
            <span>📝 Bosquejo</span>
            <textarea id="passageOutline" rows="5" placeholder="Idea central, divisiones y énfasis del mensaje.">${escapeHtml(notes.outline)}</textarea>
          </label>

          <label>
            <span>👨‍🏫 Guía del profesor</span>
            <textarea id="passageTeacherGuide" rows="4" placeholder="Preguntas, explicaciones y dinámica de la clase.">${escapeHtml(notes.teacherGuide)}</textarea>
          </label>

          <label>
            <span>🖨 Material para estudiantes</span>
            <textarea id="passageStudentMaterial" rows="4" placeholder="Contenido para la hoja de trabajo o guía imprimible.">${escapeHtml(notes.studentMaterial)}</textarea>
          </label>

          <label class="full">
            <span>🎥 Enlace de la predicación</span>
            <input id="passageVideoUrl" type="url" value="${escapeHtml(notes.videoUrl)}" placeholder="YouTube, Drive u otro enlace">
          </label>

          <label class="full">
            <span>📚 Recursos e InkFaith</span>
            <textarea id="passageResources" rows="3" placeholder="Libros, PDFs, presentaciones, guías InkFaith y otros recursos.">${escapeHtml(notes.resources)}</textarea>
          </label>
        </div>

        <footer class="right">
          <button class="btn ghost" data-action="modal-close">Cancelar</button>
          <button
            class="btn primary"
            data-action="passage-save"
            data-series-id="${serie.id}"
            data-ref="${escapeHtml(ref)}"
          >Guardar preparación</button>
        </footer>
      </div>
    </div>
  `;
}

function renderSeriesView() {
  const series = state.data.series || [];

  if (!series.length) {
    return `
      <section class="view">
        ${pageHead(
          "Series de estudio",
          "Planifica y conserva el avance de la enseñanza bíblica.",
          `<button class="btn primary" data-action="series-new">＋ Nueva serie</button>`
        )}
        <section class="v101-empty-series">
          <span>📖</span>
          <h2>Crea tu primera serie de estudio</h2>
          <p>Registra un libro bíblico, su avance, próximos pasajes y reuniones relacionadas.</p>
          <button class="btn primary" data-action="series-new">Crear serie</button>
        </section>
      </section>
    `;
  }

  const selected =
    series.find((item) => item.id === state.selectedSeriesId) ||
    series[0];

  const chapters = Math.max(1, Number(selected.chapters || 1));
  const done = Math.min(chapters, Math.max(0, Number(selected.done || 0)));
  const pct = Math.round((done / chapters) * 100);
  const pericopes = pericopesFor(selected);
  const cursor = effectivePericopeIndex(selected);
  const next = cursor < pericopes.length ? pericopes[cursor] : null;

  const linkedEvents = [...state.data.events]
    .filter((event) =>
      String(event.series || "").toLowerCase() === String(selected.name || "").toLowerCase()
      || String(event.passage || "").toLowerCase().includes(String(selected.name || "").toLowerCase())
    )
    .sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`));

  const pastEvents = linkedEvents.filter((event) => event.date < today());
  const futureLinked = linkedEvents.filter((event) => event.date >= today());

  const chapterMap = Array.from({ length: chapters }, (_, index) => {
    const chapter = index + 1;
    const status = chapter <= done ? "done" : chapter === done + 1 ? "active" : "pending";
    return `
      <button class="v101-chapter ${status}" title="Capítulo ${chapter}">
        <b>${chapter}</b>
        <span>${status === "done" ? "✓" : status === "active" ? "◷" : "•"}</span>
      </button>
    `;
  }).join("");

  const timeline = pericopes.length
    ? pericopes.slice(0, 9).map((item, index) => {
        const status = index < cursor ? "done" : index === cursor ? "active" : "pending";
        const event = linkedEvents.find((linked) =>
          String(linked.passage || "").replace(/\s/g, "") === String(item.ref || "").replace(/\s/g, "")
        );
        return `
          <button class="v101-timeline-item ${status}" data-action="passage-open" data-series-id="${selected.id}" data-ref="${escapeHtml(item.ref)}" data-title="${escapeHtml(item.title || "Pasaje de la serie")}">
            <span class="v101-timeline-dot">${status === "done" ? "✓" : status === "active" ? "" : ""}</span>
            <div class="v101-timeline-copy">
              <strong>${escapeHtml(item.ref)}</strong>
              <small>${escapeHtml(item.title || "Pasaje de la serie")}</small>
            </div>
            <div class="v101-timeline-meta">
              <span>${event ? fmt(event.date) : status === "done" ? "Completado" : "Por programar"}</span>
              <b>${escapeHtml(event?.preacher || event?.guest || "Por asignar")}</b>
            </div>
          </button>
        `;
      }).join("")
    : `
      <div class="v101-no-pericopes">
        <strong>Sin división de pasajes configurada</strong>
        <span>Puedes continuar registrando el avance por capítulos.</span>
      </div>
    `;

  return `
    <section class="view v101-series-view">
      <div class="v101-series-topline">
        <div>
          <span>Series de estudio</span>
          <b>/</b>
          <strong>${escapeHtml(selected.name)}</strong>
        </div>
        <button class="btn primary" data-action="series-new">＋ Nueva serie</button>
      </div>

      <div class="v101-series-switcher">
        ${series.map((item) => `
          <button
            class="v101-series-tab ${item.id === selected.id ? "active" : ""}"
            data-action="series-open"
            data-id="${item.id}"
          >
            <span>📖</span>
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <small>${seriesPercent(item)}% completado</small>
            </div>
          </button>
        `).join("")}
      </div>

      <div class="v101-series-layout">
        <main class="v101-series-main">
          <section class="v101-series-hero">
            <div class="v101-book-cover">
              <span>SERIE EXPOSITIVA</span>
              <strong>${escapeHtml(selected.name)}</strong>
              <small>La Palabra estudiada con orden y fidelidad</small>
            </div>

            <div class="v101-hero-copy">
              <div class="v101-title-line">
                <h1>${escapeHtml(selected.name)}</h1>
                <span>En progreso</span>
              </div>
              <p>${escapeHtml(selected.notes || `Estudio expositivo del libro de ${selected.name}.`)}</p>

              <div class="v101-hero-metrics">
                <div><span>▣</span><small>Inicio</small><strong>${pastEvents[0] ? fmt(pastEvents[0].date) : "Por definir"}</strong></div>
                <div><span>▤</span><small>Capítulos</small><strong>${chapters}</strong></div>
                <div><span>◉</span><small>Predicaciones</small><strong>${linkedEvents.length}</strong></div>
                <div><span>◔</span><small>Progreso</small><strong>${pct}%</strong></div>
              </div>
            </div>

            <div class="v101-progress-area">
              <div class="v101-progress-ring" style="--progress:${pct}">
                <div><strong>${pct}%</strong><span>Completado</span></div>
              </div>
              <button class="btn primary" data-action="series-edit" data-id="${selected.id}">✎ Editar serie</button>
            </div>
          </section>

          <section class="v101-panel v101-map-panel">
            <div class="v101-panel-head">
              <div><h2>Mapa del libro</h2><p>Progreso por capítulos</p></div>
              <div class="v101-map-legend">
                <span><i class="done"></i>Completado</span>
                <span><i class="active"></i>En progreso</span>
                <span><i></i>Pendiente</span>
              </div>
            </div>
            <div class="v101-chapter-map">${chapterMap}</div>
            <div class="v101-map-progress">
              <i style="width:${pct}%"></i>
            </div>
            <small>${done} de ${chapters} capítulos completados</small>
          </section>

          <section class="v101-panel v11-structure-panel">
            <div class="v101-panel-head">
              <div>
                <h2>Estructura del libro</h2>
                <p>Sigue el argumento y las unidades literarias, no solo los capítulos.</p>
              </div>
            </div>
            <div class="v11-structure-list">
              ${literaryStructureFor(selected).map((unit, index) => {
                const maxChapter = Math.max(...unit.chapters);
                const minChapter = Math.min(...unit.chapters);
                const status = maxChapter <= done ? "done" : minChapter <= done + 1 ? "active" : "pending";
                return `
                  <button
                    class="v11-structure-item ${status}"
                    data-action="passage-open"
                    data-series-id="${selected.id}"
                    data-ref="${escapeHtml(unit.range)}"
                    data-title="${escapeHtml(unit.title)}"
                  >
                    <span>${status === "done" ? "✓" : status === "active" ? "◷" : index + 1}</span>
                    <div>
                      <strong>${escapeHtml(unit.title)}</strong>
                      <small>${escapeHtml(unit.range)}</small>
                    </div>
                    <b>›</b>
                  </button>
                `;
              }).join("")}
            </div>
          </section>

          <div class="v101-content-grid">
            <section class="v101-panel v101-timeline">
              <div class="v101-panel-head">
                <div><h2>Línea de tiempo de predicaciones</h2><p>Pasajes enseñados y próximos a enseñar</p></div>
              </div>
              <div>${timeline}</div>
              <button class="v101-full-button" data-action="series-edit" data-id="${selected.id}">Administrar orden de la serie</button>
            </section>

            <div class="v101-middle-column">
              <section class="v101-next-card">
                <div class="v101-next-head">Próxima predicación sugerida</div>
                <div class="v101-next-body">
                  <span class="v101-next-icon">📖</span>
                  <div>
                    <h2>${next ? escapeHtml(next.ref) : "Serie completada"}</h2>
                    <p>${next ? escapeHtml(next.title || "Próximo pasaje") : "No quedan pasajes pendientes"}</p>
                  </div>
                </div>
                <div class="v101-next-meta">
                  <div><small>Capítulo</small><strong>${next ? String(next.ref).match(/\d+/)?.[0] || "—" : "—"}</strong></div>
                  <div><small>Lección</small><strong>${Math.min(cursor + 1, pericopes.length || 1)}</strong></div>
                  <div><small>Estado</small><strong>${next ? "Por programar" : "Finalizada"}</strong></div>
                </div>
                <button class="btn primary" data-action="event-new">Asignar a una reunión</button>
              </section>

              <section class="v101-panel v101-stats-panel">
                <div class="v101-panel-head"><div><h2>Estadísticas de la serie</h2></div></div>
                <div class="v101-stats-grid">
                  <div><span>◉</span><small>Predicaciones</small><strong>${linkedEvents.length}</strong></div>
                  <div><span>◷</span><small>Capítulos avanzados</small><strong>${done}</strong></div>
                  <div><span>▥</span><small>Próximas reuniones</small><strong>${futureLinked.length}</strong></div>
                  <div><span>♙</span><small>Participantes</small><strong>${new Set(linkedEvents.map(e => e.preacher || e.guest).filter(Boolean)).size}</strong></div>
                </div>
              </section>
            </div>
          </div>
        </main>

        <aside class="v101-series-aside">
          <section class="v101-panel">
            <div class="v101-panel-head">
              <div><h2>Recursos de la serie</h2></div>
              <button class="v101-text-button">Ver todo</button>
            </div>
            <div class="v101-resource-list">
              <div><span class="pdf">PDF</span><p><strong>Guía de estudio</strong><small>Material de la serie</small></p></div>
              <div><span class="doc">DOC</span><p><strong>Bosquejo general</strong><small>Estructura del libro</small></p></div>
              <div><span class="ppt">PPT</span><p><strong>Presentación</strong><small>Diapositivas de apoyo</small></p></div>
              <div><span class="pdf green">PDF</span><p><strong>Hoja de observación</strong><small>Método inductivo</small></p></div>
            </div>
            <button class="v101-full-button">＋ Agregar recurso</button>
          </section>

          <section class="v101-panel">
            <div class="v101-panel-head">
              <div><h2>Reuniones vinculadas</h2></div>
              <button class="v101-text-button" data-view="calendar">Ver calendario</button>
            </div>
            <div class="v101-linked-list">
              ${
                futureLinked.length
                  ? futureLinked.slice(0, 4).map((event) => `
                      <button data-action="event-edit" data-id="${event.id}">
                        <span><small>${MONTHS[Number(event.date.slice(5,7))-1].slice(0,3).toUpperCase()}</small><b>${event.date.slice(8,10)}</b></span>
                        <div>
                          <strong>${escapeHtml(event.type)}</strong>
                          <small>${escapeHtml(event.passage || "Pasaje por definir")}</small>
                          <em>${escapeHtml(event.preacher || event.guest || "Predicador por confirmar")}</em>
                        </div>
                        <time>${escapeHtml(event.time || "")}</time>
                      </button>
                    `).join("")
                  : `<p class="muted">No hay reuniones futuras vinculadas.</p>`
              }
            </div>
          </section>

          <section class="v101-inkfaith-card">
            <div class="v101-inkfaith-head">
              <span>✒</span>
              <div><strong>Integrado con InkFaith</strong><small>Recursos para preparar y enseñar</small></div>
            </div>
            <div class="v101-inkfaith-tools">
              <div><span>📖</span><small>Guías de estudio</small></div>
              <div><span>▤</span><small>Hojas de observación</small></div>
              <div><span>▥</span><small>Cuadernos de notas</small></div>
              <div><span>📚</span><small>Material imprimible</small></div>
            </div>
          </section>

          <div class="v101-series-actions">
            <button class="btn ghost" data-action="series-reset-order" data-id="${selected.id}">Reiniciar orden</button>
            <button class="btn danger" data-action="series-delete" data-id="${selected.id}">Eliminar serie</button>
          </div>
        </aside>
      </div>
    </section>
  `;
}

function renderSettingsView() {
  return `
    <section class="view v12-standard-view v12-settings-view">
      ${pageHead("Configuración", "Horarios, sincronización y respaldo.")}

      <div class="settings-grid">
        <section class="panel">
          <div class="v12-settings-title"><span>⌂</span><div><h3>Datos de iglesia</h3><small>Identidad principal</small></div></div>
          <label class="full" style="display:block;margin-top:12px">
            Nombre de la iglesia
            <input id="churchNameInput" value="${escapeHtml(state.data.churchName || "")}" style="width:100%;margin-top:6px;border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:13px;padding:11px">
          </label>
          <button class="btn primary" style="margin-top:10px" data-action="settings-save-church">Guardar</button>
        </section>

        <section class="panel">
          <div class="v12-settings-title"><span>◷</span><div><h3>Horarios por defecto</h3><small>Automatización mensual</small></div></div>
          <p class="muted">Estos horarios se usan al generar el mes.</p>

          <div class="schedule-list">
            ${state.data.settings.schedules.map((schedule, index) => `
              <div class="schedule-row schedule-row-wide">
                <select data-schedule-day="${index}">
                  ${DAYS.map((day, dayIndex) => `
                    <option value="${dayIndex}" ${Number(schedule.day) === dayIndex ? "selected" : ""}>${day}</option>
                  `).join("")}
                </select>

                <input data-schedule-time="${index}" type="time" value="${escapeHtml(schedule.time || "10:30")}">

                <select data-schedule-type="${index}">
                  ${TYPES.map((type) => `
                    <option ${schedule.type === type ? "selected" : ""}>${type}</option>
                  `).join("")}
                </select>

                <select data-schedule-series="${index}">
                  <option value="">— Sin serie —</option>
                  ${state.data.series.map((serie) => `
                    <option value="${serie.id}" ${schedule.seriesId === serie.id ? "selected" : ""}>${escapeHtml(serie.name)}</option>
                  `).join("")}
                </select>

                <button class="btn danger" data-action="schedule-delete" data-index="${index}">Eliminar</button>
              </div>
            `).join("")}
          </div>

          <p class="muted" style="margin-top:6px">
            Si asocias una serie, al generar el mes se sugiere automáticamente el siguiente pasaje según su pericopa, en orden.
          </p>

          <button class="btn secondary" data-action="schedule-add">＋ Agregar horario</button>

          <div class="switch-row">
            <div>
              <strong>Enviar a Calendar al guardar</strong>
              <p class="muted">Solo funciona si Calendar está conectado.</p>
            </div>
            <input type="checkbox" id="autoCalendarOnSave" ${state.data.settings.autoCalendarOnSave ? "checked" : ""}>
          </div>
        </section>

        <section class="panel">
          <div class="v12-settings-title"><span>▦</span><div><h3>Google Calendar</h3><small>Sincronización externa</small></div></div>
          <p class="muted">Crea eventos con recordatorio por correo 1 día antes y notificación 1 hora antes.</p>
          <button class="btn secondary" data-action="calendar-connect">Conectar Calendar</button>
        </section>

        <section class="panel">
          <div class="v12-settings-title"><span>⇩</span><div><h3>Respaldo</h3><small>Protección de datos</small></div></div>
          <div class="inline" style="margin-top:10px">
            <button class="btn ghost" data-action="backup-export">Exportar JSON</button>
            <label class="btn ghost">
              Importar JSON
              <input id="backupImport" type="file" accept="application/json" hidden>
            </label>
          </div>
        </section>

        <section class="panel danger-zone">
          <h3>Reiniciar datos locales</h3>
          <p class="muted">Solo borra la copia de este navegador. Firebase no se elimina.</p>
          <button class="btn danger" data-action="local-clear">Borrar datos locales</button>
        </section>
      </div>
    </section>
  `;
}

function renderModal() {
  if (!state.modal) return "";

  if (state.modal.type === "event") return renderEventModal();
  if (state.modal.type === "person") return renderPersonModal();
  if (state.modal.type === "guest") return renderGuestModal();
  if (state.modal.type === "series") return renderSeriesModal();
  if (state.modal.type === "passage") return renderPassageWorkspaceModal();

  return "";
}

function renderEventModal() {
  const item = state.modal.id
    ? state.data.events.find((event) => event.id === state.modal.id)
    : null;

  const isGuest = state.modal.isGuest;
  const event = item || {
    date: state.modal.date || today(),
    time: "10:30",
    type: isGuest ? "Invitado" : "Culto Dominical",
    preacher: "",
    coordinator: "",
    guest: "",
    passage: "",
    title: "",
    notes: ""
  };

  const preachers = state.data.people.filter((person) => person.role === "Predicador" || person.role === "Ambos");
  const coordinators = state.data.people.filter((person) => person.role === "Coordinador" || person.role === "Ambos");
  const guestPreachers = state.data.guests;

  const initialSuggestion = !item ? suggestedPericopeForType(event.type) : null;
  if (initialSuggestion && !event.passage) {
    event.passage = initialSuggestion.ref;
    event.title = initialSuggestion.title || "";
  }

  return `
    <div class="modal-wrap">
      <div class="modal">
        <header>
          <h3>${item ? "Editar reunión" : isGuest ? "Nueva reunión con invitado" : "Nueva reunión"}</h3>
          <button class="close" data-action="modal-close">×</button>
        </header>

        <div class="form-grid">
          ${inputField("Fecha", "eventDate", "date", event.date)}
          ${inputField("Hora", "eventTime", "time", event.time)}

          <label>
            Tipo
            <select id="eventType">
              ${TYPES.map((type) => `<option ${event.type === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>

          <label>
            Predicador
            <select id="eventPreacher">
              <option value="">— Seleccionar —</option>
              ${
                preachers.length
                  ? `<optgroup label="Equipo">
                      ${preachers.map((person) => `<option ${event.preacher === person.name ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}
                    </optgroup>`
                  : ""
              }
              ${
                guestPreachers.length
                  ? `<optgroup label="Invitados">
                      ${guestPreachers.map((guest) => `<option value="${escapeHtml(guest.name)}" ${event.preacher === guest.name ? "selected" : ""}>🙋 ${escapeHtml(guest.name)}</option>`).join("")}
                    </optgroup>`
                  : ""
              }
            </select>
          </label>

          <label>
            Coordinador
            <select id="eventCoordinator">
              <option value="">— Seleccionar —</option>
              ${coordinators.map((person) => `<option ${event.coordinator === person.name ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}
            </select>
          </label>

          <label>
            Invitado
            <select id="eventGuest">
              <option value="">— Sin invitado —</option>
              ${state.data.guests.map((guest) => `<option ${event.guest === guest.name ? "selected" : ""}>${escapeHtml(guest.name)}</option>`).join("")}
            </select>
          </label>

          <label class="full">
            Pasaje
            <div class="inline-field">
              <input id="eventPassage" type="text" value="${escapeHtml(event.passage || "")}" placeholder="Ej: Hebreos 2:11–15">
              <button type="button" class="btn ghost small" data-action="event-suggest-passage">📖 Sugerir</button>
            </div>
          </label>
          ${inputField("Título", "eventTitle", "text", event.title, "full", "Ej: Jesús comparte nuestra humanidad")}

          <label class="full">
            Notas
            <textarea id="eventNotes" rows="3">${escapeHtml(event.notes || "")}</textarea>
          </label>
        </div>

        <footer>
          ${
            item
              ? `<button class="btn danger" data-action="event-delete" data-id="${item.id}">Eliminar</button>`
              : `<span></span>`
          }

          <div class="inline">
            <button class="btn ghost" data-action="modal-close">Cancelar</button>
            <button class="btn primary" data-action="event-save" data-id="${item?.id || ""}">Guardar</button>
          </div>
        </footer>
      </div>
    </div>
  `;
}

function renderPersonModal() {
  const item = state.modal.id
    ? state.data.people.find((person) => person.id === state.modal.id)
    : null;

  const person = item || {
    name: "",
    role: "Predicador",
    email: "",
    phone: "",
    notes: ""
  };

  return `
    <div class="modal-wrap">
      <div class="modal small">
        <header>
          <h3>${item ? "Editar persona" : "Nueva persona"}</h3>
          <button class="close" data-action="modal-close">×</button>
        </header>

        <div class="form-grid">
          ${inputField("Nombre", "personName", "text", person.name, "full")}
          <label>
            Rol
            <select id="personRole">
              ${["Predicador", "Coordinador", "Ambos"].map((role) => `<option ${person.role === role ? "selected" : ""}>${role}</option>`).join("")}
            </select>
          </label>
          ${inputField("Correo", "personEmail", "email", person.email)}
          ${inputField("Teléfono", "personPhone", "text", person.phone, "full")}
          <label class="full">
            Notas
            <textarea id="personNotes" rows="3">${escapeHtml(person.notes || "")}</textarea>
          </label>
        </div>

        <footer class="right">
          ${item ? `<button class="btn danger" data-action="person-delete" data-id="${item.id}">Eliminar</button>` : ""}
          <button class="btn ghost" data-action="modal-close">Cancelar</button>
          <button class="btn primary" data-action="person-save" data-id="${item?.id || ""}">Guardar</button>
        </footer>
      </div>
    </div>
  `;
}

function renderGuestModal() {
  const item = state.modal.id
    ? state.data.guests.find((guest) => guest.id === state.modal.id)
    : null;

  const guest = item || {
    name: "",
    church: "",
    email: "",
    phone: "",
    notes: ""
  };

  return `
    <div class="modal-wrap">
      <div class="modal small">
        <header>
          <h3>${item ? "Editar invitado" : "Nuevo invitado"}</h3>
          <button class="close" data-action="modal-close">×</button>
        </header>

        <div class="form-grid">
          ${inputField("Nombre", "guestName", "text", guest.name, "full")}
          ${inputField("Iglesia / referencia", "guestChurch", "text", guest.church, "full")}
          ${inputField("Correo", "guestEmail", "email", guest.email)}
          ${inputField("Teléfono", "guestPhone", "text", guest.phone)}
          <label class="full">
            Notas
            <textarea id="guestNotes" rows="3">${escapeHtml(guest.notes || "")}</textarea>
          </label>
        </div>

        <footer class="right">
          ${item ? `<button class="btn danger" data-action="guest-delete" data-id="${item.id}">Eliminar</button>` : ""}
          <button class="btn ghost" data-action="modal-close">Cancelar</button>
          <button class="btn primary" data-action="guest-save" data-id="${item?.id || ""}">Guardar</button>
        </footer>
      </div>
    </div>
  `;
}

function renderSeriesModal() {
  const item = state.modal.id
    ? state.data.series.find((serie) => serie.id === state.modal.id)
    : null;

  const serie = item || {
    name: "",
    chapters: 1,
    done: 0,
    notes: ""
  };

  return `
    <div class="modal-wrap">
      <div class="modal small">
        <header>
          <h3>${item ? "Editar serie" : "Nueva serie"}</h3>
          <button class="close" data-action="modal-close">×</button>
        </header>

        <div class="form-grid">
          ${inputField("Libro / Serie", "seriesName", "text", serie.name, "full", "Ej: Hebreos")}
          ${inputField("Capítulos", "seriesChapters", "number", serie.chapters)}
          ${inputField("Completados", "seriesDone", "number", serie.done)}
          <label class="full">
            Notas
            <textarea id="seriesNotes" rows="3">${escapeHtml(serie.notes || "")}</textarea>
          </label>
        </div>

        <footer class="right">
          ${item ? `<button class="btn danger" data-action="series-delete" data-id="${item.id}">Eliminar</button>` : ""}
          <button class="btn ghost" data-action="modal-close">Cancelar</button>
          <button class="btn primary" data-action="series-save" data-id="${item?.id || ""}">Guardar</button>
        </footer>
      </div>
    </div>
  `;
}

function inputField(label, id, type, value, className = "", placeholder = "") {
  return `
    <label class="${className}">
      ${label}
      <input id="${id}" type="${type}" value="${escapeHtml(value || "")}" placeholder="${escapeHtml(placeholder)}">
    </label>
  `;
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action], [data-view]");
  if (!target) return;

  const action = target.dataset.action;
  const view = target.dataset.view;
  const id = target.dataset.id;

  if (view) {
    setView(view);
    return;
  }

  try {
    if (action === "theme") {
      setData((data) => ({
        ...data,
        theme: data.theme === "dark" ? "light" : "dark"
      }));
    }

    if (action === "login") {
      await loginGoogle();
    }

    if (action === "logout") {
      stopDataSubscription();
      await logoutGoogle();
      state.user = null;
      state.cloudLoaded = false;
      render();
    }

    if (action === "modal-close") closeModal();

    if (action === "month-prev") {
      state.month--;
      if (state.month < 0) {
        state.month = 11;
        state.year--;
      }
      render();
    }

    if (action === "month-next") {
      state.month++;
      if (state.month > 11) {
        state.month = 0;
        state.year++;
      }
      render();
    }

    if (action === "calendar-jump") {
      const dateStr = target.dataset.date;
      const match = state.data.events.find((event) => event.date === dateStr);
      if (match) openModal("event", { id: match.id });
      else openModal("event", { date: dateStr });
    }

    if (action === "month-generate") await generateMonth();
    if (action === "export-month-image") await downloadMonthlyScheduleImage();

    if (action === "event-new") openModal("event");
    if (action === "event-new-guest") openModal("event", { isGuest: true });
    if (action === "event-new-date") openModal("event", { date: target.dataset.date });
    if (action === "event-edit") openModal("event", { id });
    if (action === "event-save") await saveEvent(id);
    if (action === "event-delete") await deleteEvent(id);

    if (action === "event-suggest-passage") {
      const type = $("#eventType").value;
      const suggestion = suggestedPericopeForType(type);
      if (!suggestion) {
        showToast("Ese tipo de reunión no tiene una serie vinculada en Config.");
      } else {
        $("#eventPassage").value = suggestion.ref;
        $("#eventTitle").value = suggestion.title || "";
        showToast(`Sugerido: ${suggestion.ref}`);
      }
    }

    if (action === "calendar-connect") await handleConnectCalendar();
    if (action === "calendar-send") await sendEventToCalendar(id);

    if (action === "person-new") openModal("person");
    if (action === "person-edit") openModal("person", { id });
    if (action === "person-save") await savePerson(id);
    if (action === "person-delete") await deletePerson(id);

    if (action === "guest-new") openModal("guest");
    if (action === "guest-edit") openModal("guest", { id });
    if (action === "guest-save") await saveGuest(id);
    if (action === "guest-delete") await deleteGuest(id);

    if (action === "passage-open") {
      openModal("passage", {
        seriesId: target.dataset.seriesId,
        ref: target.dataset.ref || "",
        title: target.dataset.title || ""
      });
    }

    if (action === "passage-save") {
      const seriesId = target.dataset.seriesId;
      const ref = target.dataset.ref || "";
      const passageData = {
        observation: $("#passageObservation")?.value.trim() || "",
        interpretation: $("#passageInterpretation")?.value.trim() || "",
        application: $("#passageApplication")?.value.trim() || "",
        outline: $("#passageOutline")?.value.trim() || "",
        teacherGuide: $("#passageTeacherGuide")?.value.trim() || "",
        studentMaterial: $("#passageStudentMaterial")?.value.trim() || "",
        videoUrl: $("#passageVideoUrl")?.value.trim() || "",
        resources: $("#passageResources")?.value.trim() || ""
      };

      const series = state.data.series.map((serie) =>
        serie.id === seriesId
          ? {
              ...serie,
              passageNotes: {
                ...(serie.passageNotes || {}),
                [ref]: passageData
              }
            }
          : serie
      );

      await setData((data) => ({ ...data, series }));
      closeModal();
      showToast("Preparación bíblica guardada.");
    }

    if (action === "series-open") {
      state.selectedSeriesId = id;
      render();
    }
    if (action === "series-new") openModal("series");
    if (action === "series-edit") openModal("series", { id });
    if (action === "series-save") await saveSeries(id);
    if (action === "series-delete") await deleteSeries(id);

    if (action === "series-reset-order") {
      const series = state.data.series.map((serie) =>
        serie.id === id ? { ...serie, pericopeIndex: 0 } : serie
      );
      setData((data) => ({ ...data, series }));
      showToast("Orden de pericopas reiniciado.");
    }

    if (action === "schedule-add") {
      setData((data) => ({
        ...data,
        settings: {
          ...data.settings,
          schedules: [
            ...data.settings.schedules,
            { id: uid(), day: 0, time: "10:30", type: "Culto Dominical" }
          ]
        }
      }));
    }

    if (action === "schedule-delete") {
      const index = Number(target.dataset.index);
      setData((data) => ({
        ...data,
        settings: {
          ...data.settings,
          schedules: data.settings.schedules.filter((_, i) => i !== index)
        }
      }));
    }

    if (action === "settings-save-church") {
      const churchName = $("#churchNameInput").value.trim();
      setData((data) => ({ ...data, churchName }));
      showToast("Datos guardados.");
    }

    if (action === "backup-export") exportBackup();

    if (action === "local-clear") {
      if (confirm("¿Borrar solo los datos locales de este navegador?")) {
        localStorage.removeItem("liturgica-v7");
        location.reload();
      }
    }
  } catch (error) {
    console.error(error);
    alert(`Error:\n\n${error.code || ""}\n\n${error.message || error}`);
  }
});

document.addEventListener("change", (event) => {
  const el = event.target;

  if (el.matches("[data-schedule-day], [data-schedule-time], [data-schedule-type], [data-schedule-series]")) {
    updateSchedulesFromUI();
  }

  if (el.id === "autoCalendarOnSave") {
    setData((data) => ({
      ...data,
      settings: {
        ...data.settings,
        autoCalendarOnSave: el.checked
      }
    }));
  }

  if (el.id === "backupImport" && el.files?.[0]) {
    importBackup(el.files[0]);
  }
});

function updateSchedulesFromUI() {
  const schedules = state.data.settings.schedules.map((schedule, index) => ({
    ...schedule,
    day: Number($(`[data-schedule-day="${index}"]`).value),
    time: $(`[data-schedule-time="${index}"]`).value,
    type: $(`[data-schedule-type="${index}"]`).value,
    seriesId: $(`[data-schedule-series="${index}"]`).value || ""
  }));

  setData((data) => ({
    ...data,
    settings: {
      ...data.settings,
      schedules
    }
  }));
}

async function generateMonth() {
  const schedules = state.data.settings?.schedules || [];

  if (!schedules.length) {
    showToast("Configura al menos un horario.");
    return;
  }

  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  const events = [...state.data.events];
  const cursors = {}; // seriesId -> índice local de pericopa, avanza en orden cronológico
  let added = 0;
  let assigned = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${state.year}-${pad(state.month + 1)}-${pad(d)}`;
    const weekday = new Date(state.year, state.month, d).getDay();

    schedules.forEach((schedule) => {
      if (Number(schedule.day) !== weekday) return;

      const exists = events.some((event) =>
        event.date === date &&
        event.time === schedule.time &&
        event.type === schedule.type
      );

      if (exists) return;

      let passage = "";
      let title = "";

      if (schedule.seriesId) {
        const serie = state.data.series.find((s) => s.id === schedule.seriesId);
        if (serie) {
          const list = pericopesFor(serie);
          const cursorIndex = cursors[serie.id] ?? effectivePericopeIndex(serie);
          if (cursorIndex < list.length) {
            const pericope = list[cursorIndex];
            passage = pericope.ref;
            title = pericope.title;
            cursors[serie.id] = cursorIndex + 1;
            assigned++;
          }
        }
      }

      events.push({
        id: uid(),
        date,
        time: schedule.time,
        type: schedule.type,
        preacher: "",
        coordinator: "",
        guest: "",
        passage,
        title,
        notes: "",
        calendarId: ""
      });

      added++;
    });
  }

  const series = state.data.series.map((serie) =>
    cursors[serie.id] !== undefined ? { ...serie, pericopeIndex: cursors[serie.id] } : serie
  );

  setData((data) => ({ ...data, events, series }));
  showToast(
    assigned
      ? `${added} reuniones generadas, ${assigned} con pasaje sugerido.`
      : `${added} reuniones generadas.`
  );
}

async function saveEvent(id) {
  const oldEvent = id ? state.data.events.find((event) => event.id === id) : null;
  const preacherValue = $("#eventPreacher").value;
  const isGuestPreacher = state.data.guests.some((guest) => guest.name === preacherValue);
  const guestValue = $("#eventGuest").value || (isGuestPreacher ? preacherValue : "");

  const eventData = {
    id: id || uid(),
    date: $("#eventDate").value,
    time: $("#eventTime").value,
    type: $("#eventType").value,
    preacher: preacherValue,
    coordinator: $("#eventCoordinator").value,
    guest: guestValue,
    passage: $("#eventPassage").value.trim(),
    title: $("#eventTitle").value.trim(),
    notes: $("#eventNotes").value.trim(),
    calendarId: oldEvent?.calendarId || ""
  };

  if (!eventData.date) {
    showToast("Selecciona una fecha.");
    return;
  }

  const events = id
    ? state.data.events.map((event) => event.id === id ? eventData : event)
    : [...state.data.events, eventData];

  state.modal = null;
  setData((data) => ({ ...data, events }));

  if (state.data.settings.autoCalendarOnSave && isCalendarConnected()) {
    await sendEventObjectToCalendar(eventData);
  }

  showToast("Reunión guardada.");
}

async function deleteEvent(id) {
  const eventData = state.data.events.find((event) => event.id === id);
  if (!eventData) return;

  if (!confirm("¿Eliminar esta reunión?")) return;

  if (eventData.calendarId && isCalendarConnected()) {
    try {
      await deleteCalendarEvent(eventData.calendarId);
    } catch (error) {
      console.warn(error);
    }
  }

  state.modal = null;
  setData((data) => ({
    ...data,
    events: data.events.filter((event) => event.id !== id)
  }));

  showToast("Reunión eliminada.");
}

async function savePerson(id) {
  const personData = {
    id: id || uid(),
    name: $("#personName").value.trim(),
    role: $("#personRole").value,
    email: $("#personEmail").value.trim(),
    phone: $("#personPhone").value.trim(),
    notes: $("#personNotes").value.trim()
  };

  if (!personData.name) {
    showToast("Escribe un nombre.");
    return;
  }

  const oldPerson = id ? state.data.people.find((person) => person.id === id) : null;

  const people = id
    ? state.data.people.map((person) => person.id === id ? personData : person)
    : [...state.data.people, personData];

  const events = oldPerson && oldPerson.name !== personData.name
    ? state.data.events.map((event) => ({
        ...event,
        preacher: event.preacher === oldPerson.name ? personData.name : event.preacher,
        coordinator: event.coordinator === oldPerson.name ? personData.name : event.coordinator
      }))
    : state.data.events;

  state.modal = null;
  setData((data) => ({ ...data, people, events }));
  showToast("Equipo actualizado.");
}

async function deletePerson(id) {
  const person = state.data.people.find((item) => item.id === id);
  if (!person) return;

  const used = state.data.events.some((event) =>
    event.preacher === person.name || event.coordinator === person.name
  );

  const message = used
    ? `Esta persona está asignada en reuniones.\n\nSi la eliminas, quedará vacío donde aparecía.\n\n¿Eliminar a ${person.name}?`
    : `¿Eliminar a ${person.name}?`;

  if (!confirm(message)) return;

  state.modal = null;

  setData((data) => ({
    ...data,
    people: data.people.filter((item) => item.id !== id),
    events: data.events.map((event) => ({
      ...event,
      preacher: event.preacher === person.name ? "" : event.preacher,
      coordinator: event.coordinator === person.name ? "" : event.coordinator
    }))
  }));

  showToast("Persona eliminada.");
}

async function saveGuest(id) {
  const guestData = {
    id: id || uid(),
    name: $("#guestName").value.trim(),
    church: $("#guestChurch").value.trim(),
    email: $("#guestEmail").value.trim(),
    phone: $("#guestPhone").value.trim(),
    notes: $("#guestNotes").value.trim()
  };

  if (!guestData.name) {
    showToast("Escribe el invitado.");
    return;
  }

  const oldGuest = id ? state.data.guests.find((guest) => guest.id === id) : null;

  const guests = id
    ? state.data.guests.map((guest) => guest.id === id ? guestData : guest)
    : [...state.data.guests, guestData];

  const events = oldGuest && oldGuest.name !== guestData.name
    ? state.data.events.map((event) => ({
        ...event,
        guest: event.guest === oldGuest.name ? guestData.name : event.guest
      }))
    : state.data.events;

  state.modal = null;
  setData((data) => ({ ...data, guests, events }));
  showToast("Invitado guardado.");
}

async function deleteGuest(id) {
  const guest = state.data.guests.find((item) => item.id === id);
  if (!guest) return;

  const used = state.data.events.some((event) => event.guest === guest.name);

  const message = used
    ? `Este invitado está asignado en reuniones.\n\nSi lo eliminas, quedará vacío donde aparecía.\n\n¿Eliminar a ${guest.name}?`
    : `¿Eliminar a ${guest.name}?`;

  if (!confirm(message)) return;

  state.modal = null;

  setData((data) => ({
    ...data,
    guests: data.guests.filter((item) => item.id !== id),
    events: data.events.map((event) => ({
      ...event,
      guest: event.guest === guest.name ? "" : event.guest
    }))
  }));

  showToast("Invitado eliminado.");
}

async function saveSeries(id) {
  const chapters = Number($("#seriesChapters").value || 1);
  const done = Math.min(Number($("#seriesDone").value || 0), chapters);
  const existing = id ? state.data.series.find((serie) => serie.id === id) : null;

  const serieData = {
    id: id || uid(),
    name: $("#seriesName").value.trim(),
    chapters,
    done,
    pericopeIndex: Number(existing?.pericopeIndex || 0),
    notes: $("#seriesNotes").value.trim()
  };

  // Si "capítulos completados" avanzó más allá del cursor guardado, la
  // sugerencia de pericopa se sincroniza con lo que realmente ya estudiaron.
  serieData.pericopeIndex = effectivePericopeIndex(serieData);

  if (!serieData.name) {
    showToast("Escribe la serie.");
    return;
  }

  const series = id
    ? state.data.series.map((serie) => serie.id === id ? serieData : serie)
    : [...state.data.series, serieData];

  state.modal = null;
  setData((data) => ({ ...data, series }));
  showToast("Serie guardada.");
}

async function deleteSeries(id) {
  const serie = state.data.series.find((item) => item.id === id);
  if (!serie) return;

  if (!confirm(`¿Eliminar la serie ${serie.name}?`)) return;

  state.modal = null;

  setData((data) => ({
    ...data,
    series: data.series.filter((item) => item.id !== id)
  }));

  showToast("Serie eliminada.");
}

async function handleConnectCalendar() {
  const ok = await connectCalendar();
  showToast(ok ? "Google Calendar conectado." : "No se pudo conectar Calendar.");
  render();
}

async function sendEventToCalendar(id) {
  const eventData = state.data.events.find((event) => event.id === id);
  if (!eventData) return;

  await sendEventObjectToCalendar(eventData);
}

async function sendEventObjectToCalendar(eventData) {
  if (!isCalendarConnected()) {
    const ok = await connectCalendar();

    if (!ok) {
      showToast("No se pudo conectar Google Calendar.");
      return;
    }
  }

  try {
    const calendarEvent = await upsertCalendarEvent(
      eventData,
      state.data.people,
      state.data.guests
    );

    setData((data) => ({
      ...data,
      events: data.events.map((event) =>
        event.id === eventData.id
          ? { ...event, calendarId: calendarEvent.id }
          : event
      )
    }));

    showToast("Evento enviado a Google Calendar.");
  } catch (error) {
    console.error(error);
    showToast("Error al enviar a Calendar.");
  }
}

function renderMonthlyShareCard(events) {
  const compact = events.length >= 7 ? " compact" : "";
  const churchName = escapeHtml(state.data.churchName || "Iglesia local");

  return `
    <div class="share-card${compact}">
      <div class="share-topline"></div>
      <div class="share-heading">
        <p class="share-kicker">PROGRAMACIÓN</p>
        <h1 class="share-title">DEL MES</h1>
        <div class="share-meta">
          <span>${escapeHtml(currentMonthLabel().toUpperCase())}</span>
          <span>${churchName}</span>
        </div>
      </div>

      <div class="share-list">
        ${events.map((event, index) => `
          <article class="share-item ${index % 2 ? "accent" : "dark"}">
            <div class="share-date-box">
              <div class="share-date-weekday">${escapeHtml(event.weekday.slice(0, 3).toUpperCase())}</div>
              <div class="share-date-day">${pad(event.day)}</div>
              <div class="share-date-time">${escapeHtml(event.time || "--:--")}</div>
            </div>
            <div class="share-body">
              <h3>${escapeHtml(event.type || "Reunión")}</h3>
              <p><strong>Predicador:</strong> ${escapeHtml(event.preacher || "Por confirmar")}</p>
              <p><strong>Coordinador:</strong> ${escapeHtml(event.coordinator || "Por confirmar")}</p>
              <p><strong>Pasaje bíblico:</strong> ${escapeHtml(event.passage || "Por confirmar")}</p>
            </div>
          </article>
        `).join("")}
      </div>

      <div class="share-footer">
        <span>${churchName}</span>
        <span>Resumen para compartir por WhatsApp</span>
      </div>
    </div>
  `;
}

async function downloadMonthlyScheduleImage() {
  const events = monthlyShareEvents();

  if (!events.length) {
    showToast("No hay reuniones en este mes para exportar.");
    return;
  }

  if (!window.html2canvas) {
    showToast("No se pudo cargar el exportador de imagen.");
    return;
  }

  const stage = document.createElement("div");
  stage.className = "share-stage";
  stage.innerHTML = renderMonthlyShareCard(events);
  document.body.appendChild(stage);

  try {
    if (document.fonts?.ready) await document.fonts.ready;

    const card = stage.querySelector(".share-card");
    const canvas = await window.html2canvas(card, {
      backgroundColor: null,
      scale: 2,
      useCORS: true
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `programacion-${sanitizeFilePart(currentMonthLabel())}.png`;
    link.click();

    showToast("Imagen descargada correctamente.");
  } catch (error) {
    console.error(error);
    showToast("No se pudo generar la imagen.");
  } finally {
    stage.remove();
  }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `planificacion-liturgica-v9-${today()}.json`;
  link.click();
}

function importBackup(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = mergeData(createDefaults(), JSON.parse(reader.result));
      setData(imported);
      showToast("Respaldo importado.");
    } catch (error) {
      showToast("Archivo inválido.");
    }
  };

  reader.readAsText(file);
}

async function boot() {
  loadLocal();
  document.documentElement.setAttribute("data-theme", state.data.theme || "dark");
  render();

  try {
    await initFirebase();
  } catch (error) {
    console.error(error);
    alert("Error inicializando Firebase:\n\n" + (error.message || error));
    return;
  }

  onAuth(async (user) => {
    state.authResolved = true;
    state.user = user;

    if (!user) {
      state.cloudLoaded = false;
      render();
      return;
    }

    try {
      const cloud = await loadData(user.uid, state.data);
      state.data = mergeData(createDefaults(), cloud);
      state.cloudLoaded = true;
      saveLocal();
      render();

      subscribeData(user.uid, (data) => {
        state.data = mergeData(createDefaults(), data);
        state.cloudLoaded = true;
        saveLocal();
        render();
      });

      showToast("Sesión iniciada y datos sincronizados.");
    } catch (error) {
      console.error(error);
      alert("Error cargando Firebase:\n\n" + (error.message || error));
      render();
    }
  });

  await initCalendar();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});

    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }
}

boot();
