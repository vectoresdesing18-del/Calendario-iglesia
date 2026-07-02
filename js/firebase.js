import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB_BmyjN9kheRyczCoW3Arxl0RpHmDNk9w",
  authDomain: "calendario-iglesia-4517e.firebaseapp.com",
  projectId: "calendario-iglesia-4517e",
  storageBucket: "calendario-iglesia-4517e.firebasestorage.app",
  messagingSenderId: "624610811351",
  appId: "1:624610811351:web:6240fae670fa56e16b3f92"
};

let app;
let auth;
let db;
let unsubscribeData = null;

export async function initFirebase() {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  await setPersistence(auth, browserLocalPersistence);

  db = getFirestore(app);

  try {
    await enableIndexedDbPersistence(db);
  } catch (error) {
    console.warn("Firestore persistence:", error.code || error.message);
  }

  try {
    await getRedirectResult(auth);
  } catch (error) {
    console.warn("Redirect result:", error.code || error.message);
  }

  return { app, auth, db };
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.addScope("email");

  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    const fallbackCodes = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment"
    ];

    if (fallbackCodes.includes(error.code)) {
      return signInWithRedirect(auth, provider);
    }

    throw error;
  }
}

export async function logoutGoogle() {
  return signOut(auth);
}

export async function loadData(uid, defaults) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, defaults, { merge: true });
    return defaults;
  }

  return mergeData(defaults, snap.data());
}

export function subscribeData(uid, callback) {
  if (unsubscribeData) unsubscribeData();

  const ref = doc(db, "users", uid);

  unsubscribeData = onSnapshot(ref, (snap) => {
    if (snap.exists()) callback(snap.data());
  });

  return unsubscribeData;
}

export async function saveData(uid, data) {
  const ref = doc(db, "users", uid);
  return setDoc(ref, data, { merge: true });
}

export function stopDataSubscription() {
  if (unsubscribeData) unsubscribeData();
  unsubscribeData = null;
}

function mergeData(defaults, incoming) {
  return {
    ...defaults,
    ...incoming,
    settings: {
      ...defaults.settings,
      ...(incoming.settings || {}),
      schedules: incoming.settings?.schedules?.length
        ? incoming.settings.schedules
        : defaults.settings.schedules
    },
    people: incoming.people?.length ? incoming.people : defaults.people,
    events: incoming.events || [],
    guests: incoming.guests || [],
    series: incoming.series?.length ? incoming.series : defaults.series
  };
}
