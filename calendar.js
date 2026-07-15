export const GOOGLE_CLIENT_ID = "636584219049-doqeu47pcle33b3o7p005s2d1mb1u3a9.apps.googleusercontent.com";
export const CALENDAR_ID = "primary";
export const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient = null;
let ready = false;
let connected = false;

export async function initCalendar() {
  return new Promise((resolve) => {
    if (!window.gapi || !window.google || GOOGLE_CLIENT_ID.includes("PEGA_AQUI")) {
      ready = false;
      resolve(false);
      return;
    }

    window.gapi.load("client", async () => {
      try {
        await window.gapi.client.init({
          discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"]
        });

        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            if (response.error) {
              connected = false;
              return;
            }
            connected = true;
          }
        });

        ready = true;
        resolve(true);
      } catch (error) {
        console.warn("Calendar init error:", error);
        ready = false;
        resolve(false);
      }
    });
  });
}

export function isCalendarReady() {
  return ready;
}

export function isCalendarConnected() {
  return connected;
}

export async function connectCalendar() {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(false);
      return;
    }

    tokenClient.callback = (response) => {
      if (response.error) {
        connected = false;
        resolve(false);
        return;
      }
      connected = true;
      resolve(true);
    };

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

function byName(list, name) {
  return list.find((item) => item.name === name);
}

export async function upsertCalendarEvent(event, people = [], guests = []) {
  if (!connected) return null;

  const preacher = byName(people, event.preacher);
  const coordinator = byName(people, event.coordinator);
  const guest = byName(guests, event.guest);

  const attendees = [];

  if (preacher?.email) attendees.push({ email: preacher.email });
  if (coordinator?.email && coordinator.email !== preacher?.email) {
    attendees.push({ email: coordinator.email });
  }
  if (guest?.email) attendees.push({ email: guest.email });

  const [h, m] = (event.time || "10:30").split(":").map(Number);
  const duration = event.type?.includes("Culto") ? 2 : 1;

  const start = `${event.date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  const end = `${event.date}T${String(Math.min(h + duration, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;

  const resource = {
    summary: `${event.type}${event.passage ? " · " + event.passage : ""}`,
    description: [
      event.passage ? `Pasaje: ${event.passage}` : "",
      event.preacher ? `Predicador: ${event.preacher}` : "",
      event.coordinator ? `Coordinador: ${event.coordinator}` : "",
      event.guest ? `Invitado: ${event.guest}` : "",
      event.title ? `Título: ${event.title}` : "",
      event.notes ? `Notas: ${event.notes}` : "",
      "",
      "Creado desde Planificación Litúrgica V7"
    ].filter(Boolean).join("\n"),
    start: {
      dateTime: start,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: end,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    attendees,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 },
        { method: "popup", minutes: 60 }
      ]
    }
  };

  if (event.calendarId) {
    const response = await window.gapi.client.calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: event.calendarId,
      resource,
      sendUpdates: "all"
    });

    return response.result;
  }

  const response = await window.gapi.client.calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource,
    sendUpdates: "all"
  });

  return response.result;
}

export async function deleteCalendarEvent(calendarId) {
  if (!connected || !calendarId) return false;

  await window.gapi.client.calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId: calendarId,
    sendUpdates: "all"
  });

  return true;
}
