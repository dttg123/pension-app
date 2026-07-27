'use strict';

import { APP_VERSION, DB_KEY, DB_NAME, DB_STORE, STORAGE_KEY, clone, displayDate, isoNow, normalizeState, validateState } from './state.js';

let state = normalizeState(null);
let saveQueue = Promise.resolve();
let indexedDbUsable = true;
const listeners = new Set();

export function getState() {
  return state;
}

export function snapshotState() {
  return clone(state);
}

export async function loadState() {
  let local = null;
  let indexed = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) local = normalizeState(JSON.parse(raw));
  } catch (error) {
    console.warn('localStorage load failed', error);
  }
  if (indexedDbUsable) {
    try {
      indexed = await idbGet(DB_KEY);
      if (indexed) indexed = normalizeState(indexed);
    } catch (error) {
      indexedDbUsable = false;
      console.warn('IndexedDB load failed; this session will use localStorage only.', error);
    }
  }
  state = chooseNewest(local, indexed) || normalizeState(null);
  applyTheme(state.settings.theme);
  await persistState({ reason: 'load-sync', notify: false, increment: false });
  return state;
}

function chooseNewest(a, b) {
  if (!a) return b;
  if (!b) return a;
  const revA = Number(a.meta?.revision) || 0;
  const revB = Number(b.meta?.revision) || 0;
  if (revA !== revB) return revA > revB ? a : b;
  return Date.parse(a.meta?.updatedAt || 0) >= Date.parse(b.meta?.updatedAt || 0) ? a : b;
}

export async function updateState(mutator, reason = 'update') {
  const draft = clone(state);
  const result = await mutator(draft);
  const normalized = normalizeState(draft);
  const validation = validateState(normalized);
  if (!validation.ok) throw new Error(validation.errors[0]);
  state = normalized;
  await persistState({ reason, notify: true, increment: true });
  return result;
}


export function updateView(mutator, reason = 'view') {
  const nextUi = clone(state.ui || {});
  mutator(nextUi);
  state.ui = nextUi;
  emit({ reason, transient: true });
}

export async function replaceState(nextState, reason = 'restore') {
  const normalized = normalizeState(nextState);
  const validation = validateState(normalized);
  if (!validation.ok) throw new Error(validation.errors[0]);
  state = normalized;
  await persistState({ reason, notify: true, increment: true });
}

export async function persistState({ reason = 'save', notify = true, increment = true } = {}) {
  saveQueue = saveQueue.then(async () => {
    if (increment) state.meta.revision = Math.max(1, Number(state.meta.revision) || 1) + 1;
    state.meta.updatedAt = isoNow();
    state.meta.appVersion = APP_VERSION;
    state.meta.storage = state.meta.storage || {};
    state.meta.storage.localStatus = '저장 중';
    state.lastUpdated = displayDate();
    const payload = clone(state);
    let localOk = false;
    let idbOk = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      localOk = true;
    } catch (error) {
      console.warn('localStorage save failed', error);
    }
    if (indexedDbUsable) {
      try {
        await idbPut(DB_KEY, payload);
        idbOk = true;
      } catch (error) {
        indexedDbUsable = false;
        console.warn('IndexedDB save failed; this session will use localStorage only.', error);
      }
    }
    state.meta.storage.localStatus = localOk || idbOk ? '정상' : '실패';
    state.meta.storage.lastLocalSave = displayDateTime();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    if (!localOk && !idbOk) throw new Error('기기 저장에 실패했습니다.');
    if (notify) emit({ reason });
  });
  return saveQueue;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(detail) {
  for (const listener of listeners) {
    try { listener(state, detail); } catch (error) { console.error(error); }
  }
}

export function applyTheme(mode = state.settings.theme) {
  const resolved = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
}

function displayDateTime(date = new Date()) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB를 사용할 수 없습니다.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 열기 실패'));
  });
}

async function idbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key, value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 저장 취소'));
    });
  } finally {
    db.close();
  }
}

export async function storeSafetyCopy(copy) {
  try { await idbPut('pension-v4-safety', copy); } catch (_) {
    localStorage.setItem('pension-v4-safety', JSON.stringify(copy));
  }
}

export async function readSafetyCopy() {
  try { return await idbGet('pension-v4-safety'); } catch (_) {
    const raw = localStorage.getItem('pension-v4-safety');
    return raw ? JSON.parse(raw) : null;
  }
}
