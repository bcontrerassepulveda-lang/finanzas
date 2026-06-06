export const STORE_KEY = "finanzas-claras:v1";
export const STORE_OWNER_KEY = `${STORE_KEY}:legacy-owner`;

export const FIREBASE_CONFIG_KEY = "mi-portal-financiero:firebase-config";
export const GROQ_PROXY_URL = window.FINANCE_GROQ_PROXY_URL || "http://localhost:8787/groq";
export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.1-8b-instant",
];

export const icons = {
  dashboard: "D",
  plus: "+",
  card: "TC",
  goals: "O",
  recurring: "R",
  partners: "S",
  history: "H",
  import: "Import",
  close: "x",
  save: "OK",
  edit: "Editar",
  delete: "x",
  backup: "Backup",
  month: "Mes",
};

export const seedCategories = [
  "Sueldo",
  "Trabajo extra",
  "Honorarios",
  "Venta",
  "Bono",
  "Intereses",
  "Comida",
  "Transporte",
  "Vivienda",
  "Salud",
  "Ocio",
  "Servicios",
  "Deudas",
  "Reembolso",
];

export const distributionGroups = {
  fixed: "Gastos fijos",
  variable: "Gastos variables",
  financial: "Gastos financieros",
  micro: "Gastos hormiga",
  savings: "Ahorro/inversion",
};

export const projectionDetailOptions = [
  ["housing", "Arriendo / vivienda"],
  ["utilities", "Luz, agua, internet"],
  ["supermarket", "Supermercado"],
  ["food", "Comida diaria"],
  ["eating_out", "Salidas a comer"],
  ["leisure", "Ocio / entretencion"],
  ["transport", "Transporte"],
  ["fuel", "Bencina"],
  ["car", "Auto / mantencion"],
  ["health", "Salud"],
  ["education", "Educacion"],
  ["subscriptions", "Suscripciones"],
  ["clothing", "Ropa / compras"],
  ["debt", "Deuda / tarjeta"],
  ["fees", "Comisiones / intereses"],
  ["savings", "Ahorro / inversion"],
  ["income_salary", "Sueldo"],
  ["income_extra", "Ingreso extra"],
  ["partner", "Socios / reembolso"],
  ["other", "Otro"],
];

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function addMonthsToKey(key, delta) {
  const date = new Date(`${key}-01T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  return date.toISOString().slice(0, 7);
}

export function monthKey(date = today()) {
  return String(date).slice(0, 7);
}

export function financialCycleMonth(date = today()) {
  const value = String(date || today());
  const key = value.slice(0, 7);
  const day = Number(value.slice(8, 10));
  if (!key || Number.isNaN(day)) return monthKey(value);
  return day >= 26 ? addMonthsToKey(key, 1) : key;
}

export function financialCycleRangeLabel(key = activeMonth()) {
  const start = addMonthsToKey(key, -1);
  return `Ciclo ${start}-26 al ${key}-25`;
}

export function activeMonth() {
  state.selectedMonth ||= monthKey();
  return state.selectedMonth;
}

export function activeMonthDate(day = "01") {
  return `${activeMonth()}-${String(day).padStart(2, "0")}`;
}

export function activeFinancialCycleDate(day = "01") {
  const normalizedDay = String(day).padStart(2, "0");
  const month = Number(normalizedDay) >= 26 ? addMonthsToKey(activeMonth(), -1) : activeMonth();
  return `${month}-${normalizedDay}`;
}

export function userStorageId() {
  return authUser?.uid || authUser?.email || "";
}

export function currentStoreKey() {
  const id = userStorageId();
  return id ? `${STORE_KEY}:user:${id}` : STORE_KEY;
}

export function legacySharedState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function normalizeLoadedState(incoming) {
  return { ...defaultState(), ...incoming, ui: { ...defaultState().ui, ...(incoming.ui || {}) } };
}

export function ensureSeedCategories(current) {
  const existing = current.categories || [];
  const missing = seedCategories.filter((category) => !existing.includes(category));
  if (!missing.length) return { state: current, changed: false };
  return { state: { ...current, categories: [...existing, ...missing] }, changed: true };
}

export function purgeDemoData(current) {
  if (current.settings?.demoDataPurged) return { state: current, changed: false };
  const isTxDemo = (tx) => {
    const amount = Number(tx.amount || 0);
    return (
      (tx.description === "Sueldo" && amount === 1450000 && tx.kind === "income") ||
      (tx.description === "Arriendo" && amount === 520000 && tx.category === "Vivienda") ||
      (tx.description === "Supermercado" && amount === 118000 && tx.kind === "card_purchase") ||
      (tx.description === "Bencina" && amount === 45000 && tx.category === "Transporte")
    );
  };
  const isRecurringDemo = (item) => ["Sueldo mensual", "Arriendo", "Bencina base", "Luz, agua e internet"].includes(item.name);
  const isDebtDemo = (debt) => ["Visa banco", "Notebook en cuotas"].includes(debt.name);
  const isGoalDemo = (goal) => ["Fondo de emergencia", "Ahorrar para fondo de emergencia", "Ponerme al dia con deudas"].includes(goal.name);
  const isReceivableDemo = (item) => item.description === "Cena compartida" && Number(item.amount || 0) === 32000;
  const isPartnerDemo = (partner) => partner.name === "Socio" && String(partner.notes || "").includes("Reparte gastos");
  const clean = {
    ...current,
    profile: {
      ...current.profile,
      initialBalance: Number(current.profile?.initialBalance || 0) === 420000 ? 0 : current.profile?.initialBalance,
    },
    transactions: (current.transactions || []).filter((tx) => !isTxDemo(tx)),
    recurringItems: (current.recurringItems || []).filter((item) => !isRecurringDemo(item)),
    debts: (current.debts || []).filter((debt) => !isDebtDemo(debt)),
    goals: (current.goals || []).filter((goal) => !isGoalDemo(goal)),
    receivables: (current.receivables || []).filter((item) => !isReceivableDemo(item)),
    partners: (current.partners || []).filter((partner) => !isPartnerDemo(partner)),
    importCandidates: [],
    settings: { ...(current.settings || {}), demoDataPurged: true },
  };
  return { state: clean, changed: true };
}

export function migrateImportedAccountingMonth(current) {
  if (current.settings?.accountingMonthMigrated) return { state: current, changed: false };
  const selected = current.selectedMonth || monthKey();
  const transactions = (current.transactions || []).map((tx) => {
    if (tx.accountingMonth || tx.source !== "archivo modelo") return tx;
    return { ...tx, accountingMonth: selected };
  });
  return {
    state: {
      ...current,
      transactions,
      settings: { ...(current.settings || {}), accountingMonthMigrated: true },
    },
    changed: true,
  };
}

export function migrateFinancialCycleAccountingMonth(current) {
  if (current.settings?.financialCycle26Migrated) return { state: current, changed: false };
  const transactions = (current.transactions || []).map((tx) => {
    if (!tx.date) return tx;
    return { ...tx, accountingMonth: financialCycleMonth(tx.date) };
  });
  const importCandidates = (current.importCandidates || []).map((tx) => {
    if (!tx.date) return tx;
    return { ...tx, accountingMonth: financialCycleMonth(tx.date) };
  });
  return {
    state: {
      ...current,
      transactions,
      importCandidates,
      settings: { ...(current.settings || {}), financialCycle26Migrated: true },
    },
    changed: true,
  };
}

export function defaultState() {
  return {
    version: 1,
    onboardingDone: false,
    activeView: "dashboard",
    selectedMonth: monthKey(),
    profile: {
      name: "",
      currency: "CLP",
      initialBalance: 0,
      privacyMask: false,
    },
    categories: [...seedCategories],
    transactions: [],
    receivables: [],
    debts: [],
    goals: [],
    recurringItems: [],
    partners: [],
    monthlyClosures: [],
    importCandidates: [],
    importDiagnostics: null,
    ui: {
      selectedDistribution: "",
      lastImportSummary: null,
      movementFlowFilter: "all",
      projectionTypes: {},
      projectionDetails: {},
      globalAnalysis: {
        text: "",
        flow: "all",
        bank: "all",
        shared: "all",
        month: "active",
        day: "",
        min: "",
        max: "",
      },
      aiModel: "llama-3.3-70b-versatile",
      aiChat: [],
      aiBusy: false,
      aiFloatingOpen: false,
    },
    settings: {
      storageDriver: "localStorage",
      indexedDbReady: true,
    },
  };
}

export function blankAppState() {
  return {
    ...defaultState(),
    onboardingDone: true,
    activeView: "dashboard",
    selectedMonth: monthKey(),
  };
}

export function consumeResetParam() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("reset")) return false;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {}
  params.delete("reset");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState({}, "", nextUrl);
  return true;
}

export const shouldStartBlank = consumeResetParam();

export let state = defaultState();
export let authReady = false;
export let authUser = null;
export let authError = "";

export function setState(next) {
  state = next;
}

export function setAuthReady(value) {
  authReady = value;
}

export function setAuthUser(value) {
  authUser = value;
}

export function setAuthError(value) {
  authError = value;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(currentStoreKey());
    if (!raw) return defaultState();
    const incoming = JSON.parse(raw);
    return normalizeLoadedState(incoming);
  } catch {
    return defaultState();
  }
}

export function saveState() {
  try {
    localStorage.setItem(currentStoreKey(), JSON.stringify(state));
  } catch {
    // ignore local save failures
  }
  saveRemoteState();
}

export function saveRemoteState() {
  if (!authUser || !window.firebase?.database) return;
  try {
    firebase.database().ref(`users/${authUser.uid}/state`).set(state);
  } catch {
    // ignore remote save failures
  }
}

export async function loadRemoteState() {
  if (!authUser || !window.firebase?.database) return null;
  try {
    const snapshot = await firebase.database().ref(`users/${authUser.uid}/state`).once("value");
    if (!snapshot.exists()) return null;
    return normalizeLoadedState(snapshot.val());
  } catch {
    return null;
  }
}

export async function loadUserState() {
  if (shouldStartBlank) {
    setState(blankAppState());
    saveState();
    return;
  }
  migrateLegacyStateForUser();
  const remoteState = await loadRemoteState();
  if (remoteState) {
    setState(remoteState);
  } else {
    setState(loadState());
  }
  const categoryMigration = ensureSeedCategories(state);
  if (categoryMigration.changed) {
    setState(categoryMigration.state);
    saveState();
  }
  const demoCleanup = purgeDemoData(state);
  if (demoCleanup.changed) {
    setState(demoCleanup.state);
    saveState();
  }
  const monthMigration = migrateImportedAccountingMonth(state);
  if (monthMigration.changed) {
    setState(monthMigration.state);
    saveState();
  }
  const cycleMigration = migrateFinancialCycleAccountingMonth(state);
  if (cycleMigration.changed) {
    setState(cycleMigration.state);
    saveState();
  }
}

export function storedFirebaseConfig() {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
    if (raw) {
      const config = JSON.parse(raw);
      if (hasFirebaseConfig(config)) return config;
      localStorage.removeItem(FIREBASE_CONFIG_KEY);
    }
  } catch {}
  return window.FINANCE_FIREBASE_CONFIG || {};
}

export function hasFirebaseConfig(config = storedFirebaseConfig()) {
  return Boolean(
    config?.apiKey &&
    String(config.apiKey).startsWith("AIza") &&
    config?.authDomain &&
    config?.projectId &&
    config?.appId
  );
}

export function saveFirebaseConfigFromText(text) {
  let clean = String(text || "").trim();
  clean = clean
    .replace(/^const\s+firebaseConfig\s*=\s*/i, "")
    .replace(/^var\s+firebaseConfig\s*=\s*/i, "")
    .replace(/^let\s+firebaseConfig\s*=\s*/i, "")
    .replace(/;$/, "");
  let config;
  try {
    config = JSON.parse(clean);
  } catch {
    const jsonLike = clean
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"');
    config = JSON.parse(jsonLike);
  }
  if (!hasFirebaseConfig(config)) {
    throw new Error('Pega la configuracion web de Firebase. La apiKey suele comenzar con "AIza" y debe incluir appId.');
  }
  localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
  return config;
}

export function migrateLegacyStateForUser() {
  const userKey = currentStoreKey();
  if (userKey === STORE_KEY || localStorage.getItem(userKey)) return;
  const legacy = legacySharedState();
  if (!legacy?.transactions && !legacy?.profile) return;
  const owner = localStorage.getItem(STORE_OWNER_KEY);
  if (owner && owner !== userStorageId()) return;
  localStorage.setItem(userKey, JSON.stringify(legacy));
  localStorage.setItem(STORE_OWNER_KEY, userStorageId());
}
