export const TRANSIENT_STORAGE_KEY = 'async-db:local-web-app:transient:v1';

const editableFields = new Set(['title', 'note']);
const commitEvents = new Set(['blur', 'change']);

export function normalizeAppState(value = {}) {
  const input = isObject(value) ? value : {};
  return {
    title: stringValue(input.title, 'Local App Notes'),
    note: stringValue(input.note, ''),
    updatedAt: stringValue(input.updatedAt, ''),
  };
}

export function normalizeTransientState(value = {}) {
  const input = isObject(value) ? value : {};
  const drafts = isObject(input.drafts) ? input.drafts : {};
  const active = isObject(input.active) ? input.active : {};
  const field = editableFields.has(active.field) ? active.field : null;

  return {
    drafts: Object.fromEntries([...editableFields].flatMap((name) => (
      typeof drafts[name] === 'string' ? [[name, drafts[name]]] : []
    ))),
    active: field
      ? {
        field,
        selectionStart: numberValue(active.selectionStart, 0),
        selectionEnd: numberValue(active.selectionEnd, numberValue(active.selectionStart, 0)),
      }
      : null,
    scrollY: numberValue(input.scrollY, 0),
  };
}

export function applyTransientState(serverState, transientState) {
  const state = normalizeAppState(serverState);
  const transient = normalizeTransientState(transientState);

  for (const [field, draft] of Object.entries(transient.drafts)) {
    if (editableFields.has(field)) {
      state[field] = draft;
    }
  }

  return {
    state,
    transient,
  };
}

export function shouldCommitFieldEvent(eventType, currentValue, lastSavedValue) {
  return commitEvents.has(eventType) && String(currentValue ?? '') !== String(lastSavedValue ?? '');
}

export function editableFieldNames() {
  return [...editableFields];
}

function stringValue(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
