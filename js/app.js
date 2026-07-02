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

const state = {
  user: null,
  authResolved: false,
  cloudLoaded: false,
  editEventId: null,
  nextEventId: null,
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  data: defaults()
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaults() {
  return {
    theme: "dark",
    settings: {
      schedules: [
        { id: uid(), day: 0, time: "10:30", type: "Culto Dominical" },
        { id: uid(), day: 4, time: "20:00", type: "Estudio Bíblico" }
      ]
    },
    events: [],
    people: [
      { id: uid(), name: "Gabriel Hijo", role: "Predicador", email: "" },
      { id: uid(), name: "Camilo González", role: "Ambos", email: "" },
      { id: uid(), name: "Josué Huaiquio", role: "Predicador", email: "" },
      { id: uid(), name: "Daniel Frías", role: "Coordinador", email: "" },
      { id: uid(), name: "Marcelo Vásquez", role: "Coordinador", email: "" },
      { id: uid(), name: "Gabriel Padre", role: "Coordinador", email: "" }
    ],
    guests: [],
    series: [
      { id: uid(), name: "Hebreos", chapters: 13, done: 0 },
      { id: uid(), name: "2 Pedro", chapters: 3, done: 0 }
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

function toast(message) {
  const el = $("#toast");
  if (!el) return alert(message);
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3200);
}

function showAuthError(error) {
  console.error(error);

  const code = error?.code || "sin-codigo";
  const message = error?.message || "Error desconocido";

  alert(
    "Error al iniciar sesión\n\n" +
    "Código: " + code + "\n\n" +
    message + "\n\n" +
    "Revisa que Firebase Auth tenga Google habilitado y que el dominio esté autorizado."
  );
}

function mergeData(defaultsData, incomingData) {
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
    const raw = localStorage.getItem("liturgica-final");
    if (raw) state.data = mergeData(defaults(), JSON.parse(raw));
  } catch (error) {
    console.warn("Error loading local data:", error);
  }
}

function saveLocal() {
  localStorage.setItem("liturgica-final", JSON.stringify(state.data));
}

async function save() {
  applyTheme();
  saveLocal();

  if (state.user && state.cloudLoaded) {
    await saveData(state.user.uid, state.data);
  }

  render();
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.data.theme || "dark");
}

function setView(viewName) {
  $$(".nav").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  $$(".view").forEach((view) => view.classList.remove("active"));

  const target = $(`#view-${viewName}`);
  if (target) target.classList.add("active");

  render();
}

function openModal(id) {
  $("#" + id)?.classList.remove("hidden");
}

function closeModal(id) {
  $("#" + id)?.classList.add("hidden");
}

function updateStatus() {
  const sessionPill = $("#sessionPill");
  const dbPill = $("#dbPill");
  const calendarPill = $("#calendarPill");
  const loginBtn = $("#loginBtn");
  const logoutBtn = $("#logoutBtn");

  if (sessionPill) {
    sessionPill.textContent = state.authResolved
      ? state.user
        ? `🟢 ${state.user.email}`
        : "⚪ Sin sesión"
      : "🟡 Cargando sesión";
  }

  if (dbPill) {
    dbPill.textContent = state.user
      ? state.cloudLoaded
        ? "🟢 Firebase sincronizado"
        : "🟡 Cargando datos"
      : "⚪ Modo local";
  }

  if (calendarPill) {
    calendarPill.textContent = isCalendarConnected()
      ? "🟢 Calendar conectado"
      : isCalendarReady()
        ? "🟡 Calendar listo"
        : "⚪ Calendar pendiente";
  }

  loginBtn?.classList.toggle("hidden", !!state.user);
  logoutBtn?.classList.toggle("hidden", !state.user);
}

function populateSelects() {
  const preachers = state.data.people.filter(
    (person) => person.role === "Predicador" || person.role === "Ambos"
  );

  const coordinators = state.data.people.filter(
    (person) => person.role === "Coordinador" || person.role === "Ambos"
  );

  const eventPreacher = $("#eventPreacher");
  const eventCoordinator = $("#eventCoordinator");
  const eventGuest = $("#eventGuest");

  if (eventPreacher) {
    eventPreacher.innerHTML =
      '<option value="">— Seleccionar —</option>' +
      preachers.map((person) => `<option>${person.name}</option>`).join("");
  }

  if (eventCoordinator) {
    eventCoordinator.innerHTML =
      '<option value="">— Seleccionar —</option>' +
      coordinators.map((person) => `<option>${person.name}</option>`).join("");
  }

  if (eventGuest) {
    eventGuest.innerHTML =
      '<option value="">— Sin invitado —</option>' +
      state.data.guests.map((guest) => `<option>${guest.name}</option>`).join("");
  }
}

function newMeeting(isGuest = false, date = null) {
  state.editEventId = null;
  populateSelects();

  $("#eventModalTitle").textContent = isGuest
    ? "Nueva reunión con invitado"
    : "Nueva reunión";

  $("#deleteEvent").classList.add("hidden");
  $("#eventDate").value = date || today();
  $("#eventTime").value = "10:30";
  $("#eventType").value = isGuest ? "Invitado" : "Culto Dominical";
  $("#eventPreacher").value = "";
  $("#eventCoordinator").value = "";
  $("#eventGuest").value = "";
  $("#eventPassage").value = "";
  $("#eventTitleInput").value = "";
  $("#eventNotes").value = "";

  openModal("eventModal");
}

function editMeeting(eventData) {
  if (!eventData) return;

  state.editEventId = eventData.id;
  populateSelects();

  $("#eventModalTitle").textContent = "Editar reunión";
  $("#deleteEvent").classList.remove("hidden");
  $("#eventDate").value = eventData.date || today();
  $("#eventTime").value = eventData.time || "10:30";
  $("#eventType").value = eventData.type || "Culto Dominical";
  $("#eventPreacher").value = eventData.preacher || "";
  $("#eventCoordinator").value = eventData.coordinator || "";
  $("#eventGuest").value = eventData.guest || "";
  $("#eventPassage").value = eventData.passage || "";
  $("#eventTitleInput").value = eventData.title || "";
  $("#eventNotes").value = eventData.notes || "";

  openModal("eventModal");
}

async function saveMeeting() {
  const oldEvent = state.editEventId
    ? state.data.events.find((event) => event.id === state.editEventId)
    : null;

  const eventData = {
    id: state.editEventId || uid(),
    date: $("#eventDate").value,
    time: $("#eventTime").value,
    type: $("#eventType").value,
    preacher: $("#eventPreacher").value,
    coordinator: $("#eventCoordinator").value,
    guest: $("#eventGuest").value,
    passage: $("#eventPassage").value.trim(),
    title: $("#eventTitleInput").value.trim(),
    notes: $("#eventNotes").value.trim(),
    calendarId: oldEvent?.calendarId || ""
  };

  if (!eventData.date) {
    toast("Selecciona una fecha.");
    return;
  }

  if (state.editEventId) {
    state.data.events = state.data.events.map((event) =>
      event.id === state.editEventId ? eventData : event
    );
  } else {
    state.data.events.push(eventData);
  }

  closeModal("eventModal");
  await save();
  toast("Reunión guardada.");
}

async function removeMeeting() {
  if (!state.editEventId) return;

  const eventData = state.data.events.find((event) => event.id === state.editEventId);

  if (!confirm("¿Eliminar esta reunión?")) return;

  if (eventData?.calendarId && isCalendarConnected()) {
    try {
      await deleteCalendarEvent(eventData.calendarId);
    } catch (error) {
      console.warn(error);
    }
  }

  state.data.events = state.data.events.filter(
    (event) => event.id !== state.editEventId
  );

  state.editEventId = null;
  closeModal("eventModal");
  await save();
  toast("Reunión eliminada.");
}

async function sendEventToCalendar(id) {
  const eventData = state.data.events.find((event) => event.id === id);
  if (!eventData) return;

  if (!isCalendarConnected()) {
    const ok = await connectCalendar();
    if (!ok) {
      toast("No se pudo conectar Google Calendar.");
      return;
    }
  }

  try {
    const calendarEvent = await upsertCalendarEvent(
      eventData,
      state.data.people,
      state.data.guests
    );

    eventData.calendarId = calendarEvent.id;

    await save();
    toast("Evento enviado a Google Calendar.");
  } catch (error) {
    console.error(error);
    toast("Error al enviar a Calendar.");
  }
}

async function generateMonth() {
  const schedules = state.data.settings?.schedules || [];

  if (!schedules.length) {
    toast("Configura al menos un horario.");
    return;
  }

  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
  let added = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${state.year}-${pad(state.month + 1)}-${pad(d)}`;
    const weekday = new Date(state.year, state.month, d).getDay();

    schedules.forEach((schedule) => {
      if (Number(schedule.day) !== weekday) return;

      const exists = state.data.events.some(
        (event) =>
          event.date === date &&
          event.time === schedule.time &&
          event.type === schedule.type
      );

      if (!exists) {
        state.data.events.push({
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

  await save();
  toast(`${added} reuniones generadas.`);
}

async function savePerson() {
  const name = $("#personName").value.trim();

  if (!name) {
    toast("Escribe un nombre.");
    return;
  }

  state.data.people.push({
    id: uid(),
    name,
    role: $("#personRole").value,
    email: $("#personEmail").value.trim()
  });

  $("#personName").value = "";
  $("#personEmail").value = "";

  closeModal("personModal");
  await save();
}

async function saveGuest() {
  const name = $("#guestName").value.trim();

  if (!name) {
    toast("Escribe el invitado.");
    return;
  }

  state.data.guests.push({
    id: uid(),
    name,
    church: $("#guestChurch").value.trim(),
    email: $("#guestEmail").value.trim(),
    phone: $("#guestPhone").value.trim(),
    notes: $("#guestNotes").value.trim()
  });

  ["guestName", "guestChurch", "guestEmail", "guestPhone", "guestNotes"].forEach(
    (id) => ($("#" + id).value = "")
  );

  closeModal("guestModal");
  await save();
}

async function saveSeries() {
  const name = $("#seriesName").value.trim();

  if (!name) {
    toast("Escribe la serie.");
    return;
  }

  state.data.series.push({
    id: uid(),
    name,
    chapters: Number($("#seriesChapters").value || 1),
    done: Number($("#seriesDone").value || 0)
  });

  $("#seriesName").value = "";
  $("#seriesChapters").value = "1";
  $("#seriesDone").value = "0";

  closeModal("seriesModal");
  await save();
}

function renderDashboard() {
  const events = [...state.data.events].sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );

  const future = events.filter((event) => event.date >= today());
  const nextEvent = future[0] || null;

  state.nextEventId = nextEvent?.id || null;

  const monthly = events.filter((event) => {
    const [y, m] = event.date.split("-").map(Number);
    return y === state.year && m === state.month + 1;
  });

  $("#nextTitle").textContent = nextEvent
    ? `${nextEvent.type} · ${fmt(nextEvent.date)}`
    : "—";

  $("#nextInfo").textContent = nextEvent
    ? `${nextEvent.time || ""} · ${nextEvent.preacher || "Predicador pendiente"} · ${nextEvent.passage || "Pasaje pendiente"}`
    : "No hay reuniones próximas.";

  $("#editNextBtn")?.classList.toggle("hidden", !nextEvent);
  $("#sendNextCalendarBtn")?.classList.toggle(
    "hidden",
    !nextEvent || !!nextEvent.calendarId
  );

  $("#monthCount").textContent = monthly.length;
  $("#pendingCount").textContent = events.filter(
    (event) => !event.preacher || !event.coordinator || !event.passage
  ).length;
  $("#seriesCount").textContent = state.data.series.length;
  $("#agendaMonth").textContent = `${MONTHS[state.month]} ${state.year}`;

  $("#monthlyAgenda").innerHTML = monthly.length
    ? monthly
        .map((event) => {
          const day = Number(event.date.split("-")[2]);
          return `
            <div class="agenda-item">
              <div class="agenda-date">${day}<small>${event.time || ""}</small></div>
              <div class="agenda-main">
                <strong>${event.type}</strong>
                <small>${event.preacher || "Predicador pendiente"} · ${event.coordinator || "Coordinador pendiente"}</small>
              </div>
              <span class="badge">${event.passage || "Sin pasaje"}</span>
            </div>
          `;
        })
        .join("")
    : '<p class="muted">No hay reuniones este mes.</p>';

  const alerts = [];

  future.slice(0, 8).forEach((event) => {
    if (!event.preacher) {
      alerts.push({
        level: "err",
        text: `Falta predicador: ${fmt(event.date)} ${event.type}`
      });
    }

    if (!event.coordinator) {
      alerts.push({
        level: "warn",
        text: `Falta coordinador: ${fmt(event.date)} ${event.type}`
      });
    }

    if (!event.passage) {
      alerts.push({
        level: "warn",
        text: `Falta pasaje: ${fmt(event.date)} ${event.type}`
      });
    }
  });

  if (!alerts.length) {
    alerts.push({ level: "ok", text: "Todo listo en las próximas reuniones." });
  }

  $("#alertsList").innerHTML = alerts
    .map((alert) => `<div class="alert ${alert.level}">${alert.text}</div>`)
    .join("");
}

function renderCalendar() {
  $("#calendarTitle").textContent = `${MONTHS[state.month]} ${state.year}`;

  const calendarGrid = $("#calendarGrid");
  calendarGrid.innerHTML = "";

  const firstDay = new Date(state.year, state.month, 1).getDay();
  const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    calendarGrid.insertAdjacentHTML("beforeend", '<div class="day empty"></div>');
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${state.year}-${pad(state.month + 1)}-${pad(d)}`;
    const events = state.data.events.filter((event) => event.date === date);

    const div = document.createElement("div");
    div.className = `day ${date === today() ? "today" : ""}`;
    div.innerHTML =
      `<div class="day-num">${d}</div>` +
      events
        .map((event) => `<div class="day-event" title="${event.type}">${event.type}</div>`)
        .join("");

    div.addEventListener("click", () => newMeeting(false, date));
    calendarGrid.appendChild(div);
  }
}

function renderEvents() {
  const rows = [...state.data.events].sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );

  $("#eventsTable").innerHTML = rows.length
    ? rows
        .map(
          (event) => `
          <tr>
            <td><strong>${fmt(event.date)}</strong></td>
            <td>${event.time || "—"}</td>
            <td><span class="badge">${event.type}</span></td>
            <td>${event.preacher || "—"}</td>
            <td>${event.coordinator || "—"}</td>
            <td>${event.passage || "—"}</td>
            <td>${event.guest || "—"}</td>
            <td>${event.calendarId ? "✅" : `<button class="btn ghost" data-calendar="${event.id}">Enviar</button>`}</td>
            <td><button class="action" data-edit="${event.id}">✏️</button></td>
          </tr>
        `
        )
        .join("")
    : '<tr><td colspan="9">Sin reuniones.</td></tr>';

  $$("[data-edit]").forEach((button) => {
    button.addEventListener("click", () =>
      editMeeting(state.data.events.find((event) => event.id === button.dataset.edit))
    );
  });

  $$("[data-calendar]").forEach((button) => {
    button.addEventListener("click", () => sendEventToCalendar(button.dataset.calendar));
  });
}

function renderPeople() {
  $("#peopleGrid").innerHTML = state.data.people
    .map(
      (person) => `
      <article class="info-card">
        <div class="avatar">${initials(person.name)}</div>
        <h3>${person.name}</h3>
        <p>${person.role}</p>
        <p>${person.email || "Sin correo"}</p>
      </article>
    `
    )
    .join("");
}

function renderGuests() {
  $("#guestsGrid").innerHTML = state.data.guests.length
    ? state.data.guests
        .map(
          (guest) => `
          <article class="info-card">
            <div class="avatar">${initials(guest.name)}</div>
            <h3>${guest.name}</h3>
            <p>${guest.church || "Sin referencia"}</p>
            <p>${guest.email || "Sin correo"}</p>
          </article>
        `
        )
        .join("")
    : '<p class="muted">Aún no hay invitados guardados.</p>';
}

function renderSeries() {
  $("#seriesGrid").innerHTML = state.data.series
    .map((serie) => {
      const pct = serie.chapters ? Math.round((serie.done / serie.chapters) * 100) : 0;

      return `
        <article class="info-card">
          <h3>${serie.name}</h3>
          <p>${serie.done} de ${serie.chapters} capítulos</p>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <strong>${pct}% completado</strong>
        </article>
      `;
    })
    .join("");
}

function renderSchedules() {
  const scheduleList = $("#scheduleList");

  if (!scheduleList) return;

  scheduleList.innerHTML = (state.data.settings.schedules || [])
    .map(
      (schedule, index) => `
      <div class="schedule-row">
        <select data-schedule-day="${index}">
          ${DAYS.map(
            (day, dayIndex) =>
              `<option value="${dayIndex}" ${Number(schedule.day) === dayIndex ? "selected" : ""}>${day}</option>`
          ).join("")}
        </select>

        <input data-schedule-time="${index}" type="time" value="${schedule.time || "10:30"}" />

        <select data-schedule-type="${index}">
          ${[
            "Culto Dominical",
            "Cena del Señor",
            "Acción de Gracias",
            "Reunión de Oración",
            "Estudio Bíblico",
            "Culto Familiar",
            "Invitado"
          ]
            .map(
              (type) =>
                `<option ${schedule.type === type ? "selected" : ""}>${type}</option>`
            )
            .join("")}
        </select>

        <button class="btn danger" data-schedule-remove="${index}">Eliminar</button>
      </div>
    `
    )
    .join("");

  $$("[data-schedule-day], [data-schedule-time], [data-schedule-type]").forEach(
    (element) => element.addEventListener("change", updateSchedulesFromUI)
  );

  $$("[data-schedule-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.data.settings.schedules.splice(Number(button.dataset.scheduleRemove), 1);
      await save();
    });
  });
}

async function updateSchedulesFromUI() {
  state.data.settings.schedules = state.data.settings.schedules.map((schedule, index) => ({
    ...schedule,
    day: Number($(`[data-schedule-day="${index}"]`).value),
    time: $(`[data-schedule-time="${index}"]`).value,
    type: $(`[data-schedule-type="${index}"]`).value
  }));

  await save();
}

function render() {
  applyTheme();
  updateStatus();
  populateSelects();
  renderDashboard();
  renderCalendar();
  renderEvents();
  renderPeople();
  renderGuests();
  renderSeries();
  renderSchedules();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json"
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `planificacion-liturgica-${today()}.json`;
  link.click();
}

function importBackup(file) {
  const reader = new FileReader();

  reader.onload = async () => {
    try {
      state.data = mergeData(defaults(), JSON.parse(reader.result));
      await save();
      toast("Respaldo importado.");
    } catch (error) {
      toast("Archivo inválido.");
    }
  };

  reader.readAsText(file);
}

function bind() {
  $$(".nav").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.close));
  });

  $("#themeToggle")?.addEventListener("click", async () => {
    state.data.theme = state.data.theme === "dark" ? "light" : "dark";
    await save();
  });

  $("#loginBtn")?.addEventListener("click", async () => {
    try {
      await loginGoogle();
    } catch (error) {
      showAuthError(error);
    }
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    stopDataSubscription();
    await logoutGoogle();
    state.user = null;
    state.cloudLoaded = false;
    render();
  });

  $("#quickNewEvent")?.addEventListener("click", () => newMeeting());
  $("#newEvent")?.addEventListener("click", () => newMeeting());
  $("#newGuestMeeting")?.addEventListener("click", () => newMeeting(true));
  $("#saveEvent")?.addEventListener("click", saveMeeting);
  $("#deleteEvent")?.addEventListener("click", removeMeeting);

  $("#editNextBtn")?.addEventListener("click", () =>
    editMeeting(state.data.events.find((event) => event.id === state.nextEventId))
  );

  $("#sendNextCalendarBtn")?.addEventListener("click", () =>
    sendEventToCalendar(state.nextEventId)
  );

  $("#newPerson")?.addEventListener("click", () => openModal("personModal"));
  $("#savePerson")?.addEventListener("click", savePerson);

  $("#newGuest")?.addEventListener("click", () => openModal("guestModal"));
  $("#saveGuest")?.addEventListener("click", saveGuest);

  $("#newSeries")?.addEventListener("click", () => openModal("seriesModal"));
  $("#saveSeries")?.addEventListener("click", saveSeries);

  $("#prevMonth")?.addEventListener("click", () => {
    state.month--;
    if (state.month < 0) {
      state.month = 11;
      state.year--;
    }
    render();
  });

  $("#nextMonth")?.addEventListener("click", () => {
    state.month++;
    if (state.month > 11) {
      state.month = 0;
      state.year++;
    }
    render();
  });

  $("#generateMonth")?.addEventListener("click", generateMonth);

  $("#addSchedule")?.addEventListener("click", async () => {
    state.data.settings.schedules.push({
      id: uid(),
      day: 0,
      time: "10:30",
      type: "Culto Dominical"
    });

    await save();
  });

  $("#connectCalendar")?.addEventListener("click", async () => {
    const ok = await connectCalendar();
    toast(ok ? "Google Calendar conectado." : "No se pudo conectar Calendar.");
    render();
  });

  $("#exportBackup")?.addEventListener("click", exportBackup);

  $("#importBackup")?.addEventListener("change", (event) => {
    if (event.target.files?.[0]) importBackup(event.target.files[0]);
  });

  $("#clearLocal")?.addEventListener("click", () => {
    if (confirm("¿Borrar solo los datos locales de este navegador?")) {
      localStorage.removeItem("liturgica-final");
      location.reload();
    }
  });
}

async function boot() {
  loadLocal();
  applyTheme();
  bind();
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
      state.data = mergeData(defaults(), cloud);
      state.cloudLoaded = true;
      saveLocal();
      render();

      subscribeData(user.uid, (data) => {
        state.data = mergeData(defaults(), data);
        state.cloudLoaded = true;
        saveLocal();
        render();
      });

      toast("Sesión iniciada y datos sincronizados.");
    } catch (error) {
      console.error(error);
      alert("Error cargando Firebase:\n\n" + (error.message || error));
      render();
    }
  });

  await initCalendar();
  render();
}

boot();
