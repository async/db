import {
  TRANSIENT_STORAGE_KEY,
  applyTransientState,
  editableFieldNames,
  normalizeAppState,
  shouldCommitFieldEvent,
} from './framework/state.js';

const basePath = window.LOCAL_APP_BASE_PATH ?? '';
const initialVersion = window.LOCAL_APP_VERSION ?? null;
const fields = {
  title: document.querySelector('[data-field="title"]'),
  note: document.querySelector('[data-field="note"]'),
};
const status = document.querySelector('[data-status]');
const savedAt = document.querySelector('[data-saved-at]');

let state = normalizeAppState();
let lastSavedState = normalizeAppState();
let currentVersion = initialVersion;
const pendingCommits = new Map();

boot().catch((error) => {
  setStatus(error.message, 'error');
});

async function boot() {
  const transient = readTransientState();
  const response = await fetchJson('/api/state');
  const applied = applyTransientState(response.state, transient);
  state = applied.state;
  lastSavedState = normalizeAppState(response.state);
  render();
  bindFields();
  restoreTransientState(applied.transient);
  setStatus('Loaded from db/appState.json.', 'ok');
  window.addEventListener('beforeunload', saveTransientState);
  window.addEventListener('scroll', saveTransientState, { passive: true });
  window.setInterval(checkForReload, 1000);
}

function bindFields() {
  for (const field of editableFieldNames()) {
    const input = fields[field];
    input.addEventListener('input', () => {
      state[field] = input.value;
      saveTransientState();
      setStatus('Typing locally. Unfocus the field to save.', 'typing');
    });
    input.addEventListener('change', (event) => {
      void commitField(field, event.type).catch(handleSaveError);
    });
    input.addEventListener('blur', (event) => {
      void commitField(field, event.type).catch(handleSaveError);
    });
  }
}

function render() {
  for (const field of editableFieldNames()) {
    if (document.activeElement !== fields[field]) {
      fields[field].value = state[field];
    }
  }
  savedAt.textContent = state.updatedAt ? `Last saved ${state.updatedAt}` : 'Not saved yet';
}

async function commitField(field, eventType) {
  const input = fields[field];
  const nextValue = input.value;
  if (!shouldCommitFieldEvent(eventType, nextValue, lastSavedState[field])) {
    return;
  }
  if (pendingCommits.get(field) === nextValue) {
    return;
  }

  pendingCommits.set(field, nextValue);
  state = {
    ...state,
    [field]: nextValue,
    updatedAt: new Date().toISOString(),
  };
  try {
    setStatus('Saving to db/appState.json...', 'saving');
    const response = await fetchJson('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
    state = normalizeAppState(response.state);
    lastSavedState = normalizeAppState(response.state);
    clearTransientDraft(field);
    render();
    setStatus('Saved to db/appState.json.', 'ok');
  } finally {
    pendingCommits.delete(field);
  }
}

async function checkForReload() {
  try {
    const response = await fetchJson('/api/version');
    if (currentVersion && response.version && response.version !== currentVersion) {
      saveTransientState();
      window.location.reload();
      return;
    }
    currentVersion = response.version;
  } catch {
    // Keep the editor usable if the local server is restarting.
  }
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${basePath}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return body;
}

function saveTransientState() {
  const activeEntry = Object.entries(fields).find(([, input]) => input === document.activeElement);
  const drafts = {};
  for (const [field, input] of Object.entries(fields)) {
    if (input.value !== lastSavedState[field]) {
      drafts[field] = input.value;
    }
  }

  const active = activeEntry
    ? {
      field: activeEntry[0],
      selectionStart: activeEntry[1].selectionStart ?? 0,
      selectionEnd: activeEntry[1].selectionEnd ?? activeEntry[1].selectionStart ?? 0,
    }
    : null;

  window.localStorage.setItem(TRANSIENT_STORAGE_KEY, JSON.stringify({
    drafts,
    active,
    scrollY: window.scrollY,
  }));
}

function readTransientState() {
  try {
    return JSON.parse(window.localStorage.getItem(TRANSIENT_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function restoreTransientState(transient) {
  if (transient.scrollY) {
    window.scrollTo(0, transient.scrollY);
  }

  if (!transient.active?.field) {
    return;
  }

  const input = fields[transient.active.field];
  input?.focus();
  input?.setSelectionRange?.(transient.active.selectionStart, transient.active.selectionEnd);
}

function clearTransientDraft(field) {
  const transient = readTransientState();
  if (transient?.drafts && typeof transient.drafts === 'object') {
    delete transient.drafts[field];
  }
  window.localStorage.setItem(TRANSIENT_STORAGE_KEY, JSON.stringify({
    ...transient,
    scrollY: window.scrollY,
  }));
}

function setStatus(message, tone) {
  status.textContent = message;
  status.dataset.tone = tone;
}

function handleSaveError(error) {
  setStatus(error.message, 'error');
}
