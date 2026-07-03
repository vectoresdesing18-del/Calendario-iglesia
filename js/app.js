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
      { id: uid(), name: "Hebreos", chapters: 13, done: 0, notes: "" },
      { id: uid(), name: "2 Pedro", chapters: 3, done: 0, notes: "" }
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
    series: incomingData.series?.length ? incomingData.series : defaultsData.series
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
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">✝</div>
        <div>
          <h1>Planificación Litúrgica V7.3.3</h1>
          <p>${escapeHtml(state.data.churchName || "Sistema ministerial")}</p>
        </div>
      </div>

      <div class="top-actions">
        <button class="btn gold export-top-btn" data-action="export-month-image">Imagen</button>
        <button class="icon-btn" data-action="theme">${state.data.theme === "dark" ? "🌙" : "☀️"}</button>
        ${
          state.user
            ? `<button class="btn danger" data-action="logout">Salir</button>`
            : `<button class="btn primary" data-action="login">Iniciar sesión</button>`
        }
      </div>
    </header>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      ${NAV.map(([id, icon, label]) => `
        <button class="nav ${state.view === id ? "active" : ""}" data-view="${id}">
          ${icon} ${label}
        </button>
      `).join("")}
    </aside>
  `;
}

function renderMobileTabs() {
  return `
    <nav class="mobile-tabs">
      ${NAV.slice(0, 4).map(([id, icon, label]) => `
        <button class="nav ${state.view === id ? "active" : ""}" data-view="${id}">
          ${icon}<span>${label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function pageHead(title, subtitle, actions = "") {
  return `
    <div class="page-head">
      <div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      <div class="inline">${actions}</div>
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
  const events = sortedEvents();
  const future = futureEvents();
  const next = future[0] || null;
  const monthly = monthlyEvents();
  const pending = events.filter((event) => !event.preacher || !event.coordinator || !event.passage).length;

  const preacherCount = {};
  events.forEach((event) => {
    if (event.preacher) {
      preacherCount[event.preacher] = (preacherCount[event.preacher] || 0) + 1;
    }
  });

  const topPreachers = Object.entries(preacherCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const alerts = [];

  future.slice(0, 8).forEach((event) => {
    if (!event.preacher) alerts.push(["err", `Falta predicador: ${fmt(event.date)} ${event.type}`]);
    if (!event.coordinator) alerts.push(["warn", `Falta coordinador: ${fmt(event.date)} ${event.type}`]);
    if (!event.passage) alerts.push(["warn", `Falta pasaje: ${fmt(event.date)} ${event.type}`]);
  });

  if (!alerts.length) alerts.push(["ok", "Todo listo en las próximas reuniones."]);

  return `
    <section class="view">
      ${pageHead(
        "Dashboard",
        "Centro de control ministerial.",
        `<button class="btn primary" data-action="event-new">＋ Reunión</button>`
      )}

      ${statusPills()}

      <div class="cards">
        <article class="card hero">
          <span>Próxima reunión</span>
          <h3>${next ? `${escapeHtml(next.type)} · ${fmt(next.date)}` : "—"}</h3>
          <p>
            ${
              next
                ? `${escapeHtml(next.time || "")} · ${escapeHtml(next.preacher || "Predicador pendiente")} · ${escapeHtml(next.passage || "Pasaje pendiente")}`
                : "No hay reuniones próximas."
            }
          </p>
          ${
            next
              ? `<div class="hero-actions">
                  <button class="btn light" data-action="event-edit" data-id="${next.id}">Editar</button>
                  ${next.calendarId ? "" : `<button class="btn light" data-action="calendar-send" data-id="${next.id}">Enviar a Calendar</button>`}
                </div>`
              : ""
          }
        </article>

        <article class="card">
          <span>Este mes</span>
          <h3>${monthly.length}</h3>
          <p>reuniones</p>
        </article>

        <article class="card">
          <span>Pendientes</span>
          <h3>${pending}</h3>
          <p>faltan datos</p>
        </article>

        <article class="card">
          <span>Series</span>
          <h3>${state.data.series.length}</h3>
          <p>en seguimiento</p>
        </article>
      </div>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head">
            <h3>Agenda mensual</h3>
            <strong>${MONTHS[state.month]} ${state.year}</strong>
          </div>
          <div class="agenda">
            ${
              monthly.length
                ? monthly.map((event) => `
                    <div class="agenda-item">
                      <div class="agenda-date">
                        ${Number(event.date.split("-")[2])}
                        <small>${escapeHtml(event.time || "")}</small>
                      </div>
                      <div class="agenda-main">
                        <strong>${escapeHtml(event.type)}</strong>
                        <small>${escapeHtml(event.preacher || "Predicador pendiente")} · ${escapeHtml(event.coordinator || "Coordinador pendiente")}</small>
                      </div>
                      <span class="badge">${escapeHtml(event.passage || "Sin pasaje")}</span>
                    </div>
                  `).join("")
                : `<p class="muted">No hay reuniones este mes.</p>`
            }
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Alertas</h3>
            <strong>Estado</strong>
          </div>
          <div class="alerts">
            ${alerts.map(([level, text]) => `<div class="alert ${level}">${escapeHtml(text)}</div>`).join("")}
          </div>

          <div class="series-dashboard-box">
            <div class="panel-head compact-head">
              <h3>Avance de series bíblicas</h3>
              <strong>Porcentaje</strong>
            </div>
            ${renderDashboardSeriesProgress()}
          </div>

          <div class="premium-stats">
            <h3>Predicaciones por persona</h3>
            ${
              topPreachers.length
                ? topPreachers.map(([name, count]) => `
                    <div class="stat-bar">
                      <span>${escapeHtml(name)}</span>
                      <strong>${count}</strong>
                      <i style="width:${Math.max(12, count * 16)}px"></i>
                    </div>
                  `).join("")
                : `<p class="muted">Aún no hay predicaciones asignadas.</p>`
            }
          </div>
        </section>
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
    <section class="view">
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
    <section class="view">
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
                      <td><span class="badge">${escapeHtml(event.type)}</span></td>
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
                : `<tr><td colspan="9">Sin reuniones.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPeopleView() {
  return `
    <section class="view">
      ${pageHead(
        "Equipo",
        "Predicadores y coordinadores.",
        `<button class="btn primary" data-action="person-new">＋ Persona</button>`
      )}

      <div class="grid-cards">
        ${state.data.people.map((person) => {
          const preachCount = state.data.events.filter((event) => event.preacher === person.name).length;
          const coordCount = state.data.events.filter((event) => event.coordinator === person.name).length;

          return `
            <article class="info-card editable-card">
              <div class="avatar">${initials(person.name)}</div>
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
      </div>
    </section>
  `;
}

function renderGuestsView() {
  return `
    <section class="view">
      ${pageHead(
        "Invitados",
        "Predicadores invitados, iglesias y notas.",
        `<button class="btn primary" data-action="guest-new">＋ Invitado</button>`
      )}

      <div class="grid-cards">
        ${
          state.data.guests.length
            ? state.data.guests.map((guest) => `
                <article class="info-card editable-card">
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

function renderSeriesView() {
  return `
    <section class="view">
      ${pageHead(
        "Series bíblicas",
        "Seguimiento del avance expositivo.",
        `<button class="btn primary" data-action="series-new">＋ Serie</button>`
      )}

      <div class="grid-cards">
        ${state.data.series.map((serie) => {
          const chapters = Number(serie.chapters || 1);
          const done = Number(serie.done || 0);
          const pct = chapters ? Math.round((done / chapters) * 100) : 0;

          return `
            <article class="info-card editable-card">
              <h3>${escapeHtml(serie.name)}</h3>
              <p>${done} de ${chapters} capítulos</p>
              <div class="progress"><span style="width:${pct}%"></span></div>
              <strong>${pct}% completado</strong>
              <p>${escapeHtml(serie.notes || "")}</p>
              <div class="card-actions">
                <button class="btn ghost" data-action="series-edit" data-id="${serie.id}">Editar</button>
                <button class="btn danger" data-action="series-delete" data-id="${serie.id}">Eliminar</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderSettingsView() {
  return `
    <section class="view">
      ${pageHead("Configuración", "Horarios, sincronización y respaldo.")}

      <div class="settings-grid">
        <section class="panel">
          <h3>Datos de iglesia</h3>
          <label class="full" style="display:block;margin-top:12px">
            Nombre de la iglesia
            <input id="churchNameInput" value="${escapeHtml(state.data.churchName || "")}" style="width:100%;margin-top:6px;border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:13px;padding:11px">
          </label>
          <button class="btn primary" style="margin-top:10px" data-action="settings-save-church">Guardar</button>
        </section>

        <section class="panel">
          <h3>Horarios por defecto</h3>
          <p class="muted">Estos horarios se usan al generar el mes.</p>

          <div class="schedule-list">
            ${state.data.settings.schedules.map((schedule, index) => `
              <div class="schedule-row">
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

                <button class="btn danger" data-action="schedule-delete" data-index="${index}">Eliminar</button>
              </div>
            `).join("")}
          </div>

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
          <h3>Google Calendar</h3>
          <p class="muted">Crea eventos con recordatorio por correo 1 día antes y notificación 1 hora antes.</p>
          <button class="btn secondary" data-action="calendar-connect">Conectar Calendar</button>
        </section>

        <section class="panel">
          <h3>Respaldo</h3>
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
              ${preachers.map((person) => `<option ${event.preacher === person.name ? "selected" : ""}>${escapeHtml(person.name)}</option>`).join("")}
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

          ${inputField("Pasaje", "eventPassage", "text", event.passage, "full", "Ej: Hebreos 2:11–15")}
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

    if (action === "month-generate") await generateMonth();
    if (action === "export-month-image") await downloadMonthlyScheduleImage();

    if (action === "event-new") openModal("event");
    if (action === "event-new-guest") openModal("event", { isGuest: true });
    if (action === "event-new-date") openModal("event", { date: target.dataset.date });
    if (action === "event-edit") openModal("event", { id });
    if (action === "event-save") await saveEvent(id);
    if (action === "event-delete") await deleteEvent(id);

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

    if (action === "series-new") openModal("series");
    if (action === "series-edit") openModal("series", { id });
    if (action === "series-save") await saveSeries(id);
    if (action === "series-delete") await deleteSeries(id);

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

  if (el.matches("[data-schedule-day], [data-schedule-time], [data-schedule-type]")) {
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
    type: $(`[data-schedule-type="${index}"]`).value
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
  let added = 0;

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

      if (!exists) {
        events.push({
          id: uid(),
          date,
          time: schedule.time,
          type: schedule.type,
          preacher: "",
          coordinator: "",
          guest: "",
          passage: "",
          title: "",
          notes: "",
          calendarId: ""
        });

        added++;
      }
    });
  }

  setData((data) => ({ ...data, events }));
  showToast(`${added} reuniones generadas.`);
}

async function saveEvent(id) {
  const oldEvent = id ? state.data.events.find((event) => event.id === id) : null;

  const eventData = {
    id: id || uid(),
    date: $("#eventDate").value,
    time: $("#eventTime").value,
    type: $("#eventType").value,
    preacher: $("#eventPreacher").value,
    coordinator: $("#eventCoordinator").value,
    guest: $("#eventGuest").value,
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

  const serieData = {
    id: id || uid(),
    name: $("#seriesName").value.trim(),
    chapters,
    done,
    notes: $("#seriesNotes").value.trim()
  };

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
  link.download = `planificacion-liturgica-v7-${today()}.json`;
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
  }
}

boot();
