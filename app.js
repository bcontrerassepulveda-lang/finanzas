import {
  STORE_KEY,
  STORE_OWNER_KEY,
  FIREBASE_CONFIG_KEY,
  GROQ_PROXY_URL,
  GROQ_MODELS,
  icons,
  seedCategories,
  distributionGroups,
  projectionDetailOptions,
  defaultState,
  blankAppState,
  shouldStartBlank,
  state,
  setState,
  authReady,
  authUser,
  authError,
  setAuthReady,
  setAuthUser,
  setAuthError,
  uid,
  today,
  monthKey,
  financialCycleMonth,
  financialCycleRangeLabel,
  activeMonth,
  activeMonthDate,
  activeFinancialCycleDate,
  userStorageId,
  currentStoreKey,
  legacySharedState,
  migrateLegacyStateForUser,
  normalizeLoadedState,
  loadState,
  saveState,
  loadUserState,
  storedFirebaseConfig,
  hasFirebaseConfig,
  saveFirebaseConfigFromText,
  ensureSeedCategories,
  purgeDemoData,
  migrateImportedAccountingMonth,
  migrateFinancialCycleAccountingMonth,
} from "./store.js";
import { showToast } from "./ui.js";

let modal = null;
let editingId = null;





function initializeFirebaseAuth() {
  const config = storedFirebaseConfig();
  if (!hasFirebaseConfig(config)) {
    setAuthReady(true);
    render();
    return;
  }
  if (!window.firebase?.initializeApp || !window.firebase?.auth) {
    setAuthError("No se pudo cargar Firebase. Revisa tu conexion a internet y recarga la app.");
    setAuthReady(true);
    render();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    firebase.auth().onAuthStateChanged((user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (user) {
        loadUserState().then(() => render());
      } else {
        setState(defaultState());
        render();
      }
    }, (error) => {
      setAuthError(error.message || String(error));
      setAuthReady(true);
      render();
    });
  } catch (error) {
    setAuthError(error.message || String(error));
    setAuthReady(true);
    render();
  }
}

function signInWithGoogle() {
  if (!window.firebase?.auth) return showToast("Firebase Auth no esta cargado.", "error");
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch((error) => {
    setAuthError(error.message || String(error));
    render();
  });
}

function signInWithGithub() {
  if (!window.firebase?.auth) return showToast("Firebase Auth no esta cargado.", "error");
  const provider = new firebase.auth.GithubAuthProvider();
  provider.addScope("read:user");
  firebase.auth().signInWithPopup(provider).catch((error) => {
    setAuthError(error.message || String(error));
    render();
  });
}

function signOutGoogle() {
  if (!window.firebase?.auth) return;
  firebase.auth().signOut();
}

const persistence = {
  load: loadState,
  save: saveState,
  driver: () => authUser && window.firebase?.database ? "firebase" : "localStorage",
  canMigrateToIndexedDB: true,
};

function partnerOptionsHtml(selected = "") {
  return `<option value="">Seleccionar socio</option>${state.partners.map((p) => `<option value="${p.id}" ${selected === p.id ? "selected" : ""}>${escapeHtml(p.name)}${p.active === false ? " (inactivo)" : ""}</option>`).join("")}`;
}

function money(value) {
  const visible = !state.profile.privacyMask;
  if (!visible) return "****";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: state.profile.currency || "CLP",
    maximumFractionDigits: state.profile.currency === "CLP" ? 0 : 2,
  }).format(Number(value || 0));
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${money(value)}`;
}

function txMonth(tx) {
  return tx.accountingMonth || financialCycleMonth(tx.date);
}

function currentMonthTransactions() {
  const key = activeMonth();
  return state.transactions.filter((tx) => txMonth(tx) === key);
}

function getDebt(id) {
  return state.debts.find((debt) => debt.id === id);
}

function computeFinance(transactions = state.transactions, receivables = state.receivables, debts = state.debts) {
  let income = 0;
  let cashOut = 0;
  let cashIn = state.profile.initialBalance || 0;
  let grossExpense = 0;
  let consumption = 0;
  let debtPayments = 0;
  let cardConsumption = 0;
  let pendingProjectedRecovery = 0;
  let collectedRecovery = 0;

  transactions.forEach((tx) => {
    const amount = Number(tx.amount || 0);
    if (tx.kind === "income") {
      income += amount;
      cashIn += amount;
    }
    if (tx.kind === "cash_expense") {
      grossExpense += amount;
      consumption += amount;
      cashOut += amount;
    }
    if (tx.kind === "card_purchase") {
      grossExpense += amount;
      consumption += amount;
      cardConsumption += amount;
    }
    if (tx.kind === "debt_payment") {
      debtPayments += amount;
      cashOut += amount;
    }
    if (tx.kind === "receivable_collection") {
      collectedRecovery += amount;
      cashIn += amount;
    }
  });

  receivables.forEach((item) => {
    if (item.status === "pending") pendingProjectedRecovery += Number(item.amount || 0);
  });

  const outstandingDebt = debts.reduce((sum, debt) => sum + Number(debt.balance || 0), 0);
  const netProjectedExpense = Math.max(0, grossExpense - pendingProjectedRecovery - collectedRecovery);
  const netRealExpense = Math.max(0, grossExpense - collectedRecovery);
  const cashBalance = cashIn - cashOut;
  const savingsMargin = income ? (income - netRealExpense) / income : 0;

  return {
    income,
    cashIn,
    cashOut,
    cashBalance,
    grossExpense,
    netProjectedExpense,
    netRealExpense,
    consumption,
    debtPayments,
    cardConsumption,
    pendingProjectedRecovery,
    collectedRecovery,
    outstandingDebt,
    savingsMargin,
  };
}

function inferDistribution(input = {}) {
  if (input.distribution) return input.distribution;
  const category = String(input.category || "").toLowerCase();
  const text = `${category} ${String(input.description || input.name || "").toLowerCase()}`;
  const kind = String(input.kind || "");
  if (kind === "income" || category.includes("sueldo")) return "";
  if (category.includes("ahorro")) return "savings";
  if (kind === "debt_payment" || kind === "card_purchase" || text.includes("tarjeta") || text.includes("credito") || text.includes("cuota") || text.includes("interes") || text.includes("deuda")) return "financial";
  if (text.includes("delivery") || text.includes("snack") || text.includes("cafe") || text.includes("suscripcion") || text.includes("salida")) return "micro";
  if (text.includes("vivienda") || text.includes("arriendo") || text.includes("dividendo") || text.includes("servicio") || text.includes("luz") || text.includes("agua") || text.includes("internet") || text.includes("seguro")) return "fixed";
  if (text.includes("supermercado") || text.includes("bencina") || text.includes("comida") || text.includes("ropa") || text.includes("tag") || text.includes("mantencion") || text.includes("transporte") || text.includes("salud")) return "variable";
  return "variable";
}

function distributionSummary(month = activeMonth()) {
  const txs = state.transactions.filter((tx) => txMonth(tx) === month);
  const totals = { fixed: 0, variable: 0, financial: 0, micro: 0, savings: 0 };
  txs.forEach((tx) => {
    const amount = Number(tx.amount || 0);
    const group = inferDistribution(tx);
    if (tx.kind !== "income" && totals[group] !== undefined) totals[group] += amount;
  });
  return totals;
}

function financialKpis(month = activeMonth()) {
  const finance = monthFinance(month);
  const dist = distributionSummary(month);
  const mandatory = dist.fixed + dist.financial;
  const committedSavings = dist.savings;
  const availableReal = finance.cashBalance - mandatory - committedSavings;
  const expenseRatio = finance.income ? finance.netRealExpense / finance.income : 0;
  const savingsRate = finance.income ? committedSavings / finance.income : 0;
  const debtRatio = finance.income ? finance.outstandingDebt / finance.income : 0;
  return {
    finance,
    dist,
    mandatory,
    committedSavings,
    availableReal,
    expenseRatio,
    savingsRate,
    debtRatio,
    freeFlow: finance.income - mandatory,
  };
}

function kpiStatus(value, greenLimit, yellowLimit, reverse = false) {
  if (!reverse) {
    if (value <= greenLimit) return "good";
    if (value <= yellowLimit) return "warn";
    return "bad";
  }
  if (value >= greenLimit) return "good";
  if (value >= yellowLimit) return "warn";
  return "bad";
}

function monthlyBaseline() {
  const recurring = activeRecurringBaseline();
  if (recurring.hasRecurring) {
    const observed = observedVariableBaseline();
    return {
      income: recurring.income,
      netRealExpense: recurring.expense + observed.variableExpense,
      grossExpense: recurring.expense + observed.variableExpense,
      cardConsumption: observed.cardConsumption,
      debtPayments: recurring.debtPayments,
      cashBalance: recurring.income - recurring.expense - recurring.debtPayments,
      outstandingDebt: computeFinance().outstandingDebt,
      monthsAnalyzed: observed.monthsAnalyzed,
      source: "recurrentes",
    };
  }
  const months = [...new Set(state.transactions.map((tx) => txMonth(tx)))].sort();
  const sampleMonths = months.slice(-3);
  if (!sampleMonths.length) return computeFinance();
  const totals = sampleMonths.map((key) => {
    const txs = state.transactions.filter((tx) => txMonth(tx) === key);
    const recs = state.receivables.filter((r) => financialCycleMonth(r.date) === key || financialCycleMonth(r.collectedDate || r.date) === key);
    return computeFinance(txs, recs, state.debts);
  });
  const avg = (field) => totals.reduce((sum, item) => sum + Number(item[field] || 0), 0) / totals.length;
  return {
    income: avg("income"),
    netRealExpense: avg("netRealExpense"),
    grossExpense: avg("grossExpense"),
    cardConsumption: avg("cardConsumption"),
    debtPayments: avg("debtPayments"),
    cashBalance: avg("cashBalance"),
    outstandingDebt: computeFinance().outstandingDebt,
    monthsAnalyzed: totals.length,
    source: "movimientos",
  };
}

function activeRecurringBaseline() {
  const active = state.recurringItems.filter((item) => item.active !== false);
  const income = active.filter((item) => item.kind === "income").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenseGross = active.filter((item) => item.kind === "expense").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const partnerRecovery = active
    .filter((item) => item.kind === "expense" && item.partnerId && item.partnerSharePercent)
    .reduce((sum, item) => sum + Number(item.amount || 0) * Number(item.partnerSharePercent || 0) / 100, 0);
  const expense = Math.max(0, expenseGross - partnerRecovery);
  const debtPayments = active.filter((item) => item.kind === "debt_payment").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return { hasRecurring: active.length > 0, income, expense, expenseGross, partnerRecovery, debtPayments };
}

function observedVariableBaseline() {
  const fixedCategories = new Set(state.recurringItems.filter((item) => item.active !== false).map((item) => item.category));
  const months = [...new Set(state.transactions.map((tx) => txMonth(tx)))].sort().slice(-3);
  if (!months.length) return { variableExpense: 0, cardConsumption: 0, monthsAnalyzed: 0 };
  const totals = months.map((key) => {
    const txs = state.transactions.filter((tx) => txMonth(tx) === key);
    const variable = txs.filter((tx) => ["cash_expense", "card_purchase"].includes(tx.kind) && !fixedCategories.has(tx.category));
    return {
      variableExpense: variable.reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
      cardConsumption: txs.filter((tx) => tx.kind === "card_purchase").reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
    };
  });
  return {
    variableExpense: totals.reduce((sum, item) => sum + item.variableExpense, 0) / totals.length,
    cardConsumption: totals.reduce((sum, item) => sum + item.cardConsumption, 0) / totals.length,
    monthsAnalyzed: totals.length,
  };
}

function monthsUntil(deadline) {
  const end = new Date(`${deadline || today()}T00:00:00`);
  const now = new Date(`${today()}T00:00:00`);
  const diff = (end.getFullYear() - now.getFullYear()) * 12 + end.getMonth() - now.getMonth();
  return Math.max(1, diff + 1);
}

function goalAnalysis(goal) {
  const base = monthlyBaseline();
  const current = computeFinance();
  const months = monthsUntil(goal.deadline);
  const target = Number(goal.targetAmount || 0);
  const currentAmount = Number(goal.currentAmount || 0);
  const gap = Math.max(0, target - currentAmount);
  const monthlyNeed = gap / months;
  const monthlySurplus = Math.max(0, base.income - base.netRealExpense - base.debtPayments);
  const shortfall = Math.max(0, monthlyNeed - monthlySurplus);
  const recommendedCuts = buildAdjustmentPlan(shortfall, base);
  const debtFocus = state.debts
    .filter((debt) => debt.balance > 0)
    .sort((a, b) => Number(b.balance) - Number(a.balance))[0];
  const feasible = shortfall <= 0;
  const projected = Math.min(target, currentAmount + monthlySurplus * months);

  if (goal.type === "debt") {
    const debtTarget = goal.debtId ? getDebt(goal.debtId) : debtFocus;
    const debtBalance = debtTarget ? Number(debtTarget.balance || 0) : current.outstandingDebt;
    const debtGap = Math.min(target || debtBalance, debtBalance);
    const debtMonthlyNeed = debtGap / months;
    const debtShortfall = Math.max(0, debtMonthlyNeed - monthlySurplus);
    return {
      ...base,
      type: "debt",
      months,
      target,
      gap: debtGap,
      monthlyNeed: debtMonthlyNeed,
      monthlySurplus,
      shortfall: debtShortfall,
      feasible: debtShortfall <= 0,
      progress: debtBalance ? Math.max(0, Math.min(1, 1 - debtGap / debtBalance)) : 1,
      projected: Math.max(0, debtBalance - monthlySurplus * months),
      primaryAction: debtTarget ? `Prioriza ${debtTarget.name} con ${money(debtMonthlyNeed)} al mes.` : "Registra una deuda para crear un plan de puesta al dia.",
      recommendedCuts: buildAdjustmentPlan(debtShortfall, base),
    };
  }

  return {
    ...base,
    type: "savings",
    months,
    target,
    gap,
    monthlyNeed,
    monthlySurplus,
    shortfall,
    feasible,
    progress: target ? Math.min(1, currentAmount / target) : 0,
    projected,
    primaryAction: feasible
      ? `Separa ${money(monthlyNeed)} al inicio de cada mes.`
      : `Libera ${money(shortfall)} mensuales para cumplir la fecha.`,
    recommendedCuts,
  };
}

function goalProjectionSeries(goal, analysis = goalAnalysis(goal)) {
  const months = Math.max(1, analysis.months || 1);
  const contribution = analysis.feasible ? analysis.monthlyNeed : Math.max(0, analysis.monthlySurplus);
  const rows = [];

  if (goal.type === "debt") {
    const startDebt = Number(analysis.gap || goal.targetAmount || 0);
    for (let i = 0; i <= months; i += 1) {
      const paid = Math.min(startDebt, contribution * i);
      rows.push({
        month: addMonthsToKey(activeMonth(), i),
        label: i === 0 ? "Mes base" : monthLabel(addMonthsToKey(activeMonth(), i)),
        value: Math.max(0, startDebt - paid),
        secondary: paid,
      });
    }
    return rows;
  }

  const start = Number(goal.currentAmount || 0);
  const target = Number(goal.targetAmount || 0);
  for (let i = 0; i <= months; i += 1) {
    rows.push({
      month: addMonthsToKey(activeMonth(), i),
      label: i === 0 ? "Mes base" : monthLabel(addMonthsToKey(activeMonth(), i)),
      value: Math.min(target, start + contribution * i),
      secondary: target,
    });
  }
  return rows;
}

function buildAdjustmentPlan(shortfall, base) {
  const current = currentMonthTransactions();
  const variable = current.filter((tx) => ["cash_expense", "card_purchase"].includes(tx.kind));
  const byCategory = {};
  variable.forEach((tx) => {
    byCategory[tx.category] = (byCategory[tx.category] || 0) + Number(tx.amount || 0);
  });
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const plan = [];
  let remaining = shortfall;
  categories.forEach(([category, amount]) => {
    if (remaining <= 0) return;
    const cut = Math.min(remaining, Math.max(0, amount * 0.18));
    if (cut > 0) {
      plan.push({ label: `Reducir ${category}`, amount: cut, detail: `Baja cerca de 18% el gasto mensual en ${category}.` });
      remaining -= cut;
    }
  });
  if (remaining > 0 && base.cardConsumption > 0) {
    const cut = Math.min(remaining, base.cardConsumption * 0.25);
    plan.push({ label: "Frenar tarjeta", amount: cut, detail: "Congela consumos no esenciales con tarjeta este mes." });
    remaining -= cut;
  }
  if (remaining > 0) {
    plan.push({ label: "Ingreso extra o plazo mayor", amount: remaining, detail: "Con los datos actuales no alcanza solo con recortes razonables." });
  }
  if (!plan.length) plan.push({ label: "Mantener ritmo", amount: 0, detail: "Tu flujo actual soporta el objetivo sin recortes adicionales." });
  return plan;
}

function topSpendingCategory(month = activeMonth()) {
  const totals = {};
  state.transactions
    .filter((tx) => txMonth(tx) === month && ["cash_expense", "card_purchase"].includes(tx.kind))
    .forEach((tx) => {
      totals[tx.category || "Otros"] = (totals[tx.category || "Otros"] || 0) + Number(tx.amount || 0);
    });
  const [category, amount] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || ["", 0];
  return { category, amount };
}

function monthlyAdvisorRecommendation() {
  const base = monthlyBaseline();
  const analyses = state.goals.map((goal) => ({ goal, analysis: goalAnalysis(goal) }));
  const required = analyses.reduce((sum, item) => sum + item.analysis.monthlyNeed, 0);
  const capacity = Math.max(0, base.income - base.netRealExpense - base.debtPayments);
  const gap = Math.max(0, required - capacity);
  const focus = analyses
    .filter((item) => item.analysis.shortfall > 0 || item.analysis.monthlyNeed > 0)
    .sort((a, b) => b.analysis.shortfall - a.analysis.shortfall || b.analysis.monthlyNeed - a.analysis.monthlyNeed)[0];
  const top = topSpendingCategory();
  const cardPressure = base.cardConsumption > Math.max(base.income * 0.25, 1);
  if (!state.goals.length) {
    return {
      status: "neutral",
      title: "Define una meta prioritaria",
      required,
      capacity,
      gap,
      action: "Crea un objetivo de ahorro o deuda. Con tus movimientos, la app calculara cuanto puedes apartar al mes.",
      detail: top.amount ? `Tu mayor gasto actual es ${top.category} por ${money(top.amount)}.` : "Aun faltan gastos suficientes para detectar oportunidades.",
    };
  }
  if (gap <= 0) {
    return {
      status: "good",
      title: "Tus objetivos calzan con tu flujo",
      required,
      capacity,
      gap,
      action: focus ? `Aparta ${money(focus.analysis.monthlyNeed)} para "${focus.goal.name}" al inicio del mes.` : "Mantén tu plan actual.",
      detail: cardPressure ? "Aun asi, evita subir consumos con tarjeta para no comer tu capacidad futura." : "Mantén cierres mensuales para confirmar que la proyección se cumple.",
    };
  }
  const possibleCut = top.amount * 0.18;
  const action = possibleCut >= gap
    ? `Reduce ${top.category} cerca de ${money(gap)} este mes para sostener "${focus?.goal.name || "tu meta principal"}".`
    : focus
      ? `Mueve la fecha de "${focus.goal.name}" o baja su aporte mensual: faltan ${money(gap)} al mes.`
      : `Ajusta objetivos: faltan ${money(gap)} al mes.`;
  const detail = top.amount
    ? `Mayor oportunidad detectada: ${top.category} (${money(top.amount)}). Un recorte razonable de 18% libera ${money(possibleCut)}.`
    : cardPressure
      ? `La tarjeta pesa ${money(base.cardConsumption)} al mes. Congela compras no esenciales antes de agregar nuevos objetivos.`
      : "Con los datos actuales, la brecha no se cubre solo con recortes visibles.";
  return { status: "critical", title: "No dan las cuentas para todos los objetivos", required, capacity, gap, action, detail };
}

function monthFinance(key) {
  const txs = state.transactions.filter((tx) => txMonth(tx) === key);
  const receivables = state.receivables.filter((r) => financialCycleMonth(r.date) <= key && (r.status === "pending" || financialCycleMonth(r.collectedDate || r.date) === key));
  return computeFinance(txs, receivables, state.debts);
}

function addMonthsToKey(key, delta) {
  const date = new Date(`${key}-01T00:00:00`);
  date.setMonth(date.getMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function monthLabel(key) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("es-CL", { month: "short", year: "2-digit" });
}

function monthlySeries(pastMonths = 9, futureMonths = 3) {
  const current = activeMonth();
  const baseline = monthlyBaseline();
  const keys = [];
  for (let i = -pastMonths + 1; i <= futureMonths; i += 1) keys.push(addMonthsToKey(current, i));
  return keys.map((key) => {
    const isFuture = key > current;
    const closure = state.monthlyClosures.find((item) => item.month === key);
    const actual = closure?.metrics || monthFinance(key);
    const projection = {
      income: baseline.income,
      netRealExpense: baseline.netRealExpense,
      grossExpense: baseline.grossExpense || baseline.netRealExpense,
      cashBalance: baseline.income - baseline.netRealExpense - baseline.debtPayments,
      outstandingDebt: baseline.outstandingDebt,
    };
    return {
      month: key,
      label: monthLabel(key),
      source: isFuture ? "projected" : "actual",
      income: isFuture ? projection.income : actual.income,
      grossExpense: isFuture ? projection.grossExpense : actual.grossExpense,
      netRealExpense: isFuture ? projection.netRealExpense : actual.netRealExpense,
      cashBalance: isFuture ? projection.cashBalance : actual.cashBalance,
      outstandingDebt: isFuture ? projection.outstandingDebt : actual.outstandingDebt,
      projectedExpense: projection.netRealExpense,
      projectedCash: projection.cashBalance,
    };
  });
}

function diagnostics() {
  const f = computeFinance();
  const current = currentMonthTransactions();
  const oldReceivables = state.receivables.filter((r) => r.status === "pending" && daysBetween(r.date, today()) > 30);
  const activeInstallments = state.debts.filter((d) => d.type === "installment" && d.balance > 0);
  const cats = {};
  current.forEach((tx) => {
    if (["cash_expense", "card_purchase"].includes(tx.kind)) cats[tx.category] = (cats[tx.category] || 0) + Number(tx.amount || 0);
  });
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const list = [];

  if (f.netRealExpense > f.income && f.income > 0) list.push(["Gasto neto mayor al ingreso", "Recorta la categoria mas alta del mes o posterga compras no esenciales."]);
  if (f.cardConsumption > Math.max(f.income * 0.35, 1)) list.push(["Consumo con tarjeta elevado", "Frena nuevas compras con tarjeta hasta pagar parte del pasivo."]);
  if (f.outstandingDebt > Math.max(f.income * 1.2, 1)) list.push(["Pasivos altos frente al ingreso", "Prioriza pagos de deuda antes de asumir nuevas cuotas."]);
  if (oldReceivables.length) list.push(["Cobranzas pendientes antiguas", `Cobra ${oldReceivables.length} reembolso(s) con mas de 30 dias.`]);
  if (activeInstallments.length >= 4) list.push(["Muchas cuotas activas", "Evita nuevas cuotas y revisa cuales puedes prepagar."]);
  if (f.savingsMargin < 0.1 && f.income > 0) list.push(["Bajo margen de ahorro", "Define una meta de ahorro antes de gastos variables."]);
  if (!state.goals.length) list.push(["Sin objetivos activos", "Crea una meta de ahorro o puesta al dia para recibir ajustes automaticos."]);
  if (topCat && topCat[1] > Math.max(f.income * 0.25, 1)) list.push([`Gasto anormal en ${topCat[0]}`, `Revisa movimientos de ${topCat[0]} y fija un limite para el resto del mes.`]);
  if (!state.monthlyClosures.length && state.transactions.length > 5) list.push(["Sin cierre mensual", "Ejecuta un cierre para guardar snapshot e inconsistencias del periodo."]);
  if (!list.length) list.push(["Finanzas sin alertas criticas", "Manten conciliaciones y respaldo JSON al dia."]);
  return list;
}

function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

function addTransaction(input) {
  const tx = {
    id: input.id || uid("tx"),
    date: input.date || activeMonthDate("01"),
    accountingMonth: input.accountingMonth || financialCycleMonth(input.date || activeMonthDate("01")),
    description: input.description || "Movimiento",
    amount: Math.abs(Number(input.amount || 0)),
    kind: input.kind,
    category: input.category || "Otros",
    distribution: inferDistribution(input),
    account: input.account || "Caja",
    bankName: input.bankName || input.banco || "",
    debtId: input.debtId || "",
    debtName: input.debtName || "",
    notes: input.notes || "",
    source: input.source || "manual",
    partnerId: input.partnerId || "",
    partnerSharePercent: Number(input.partnerSharePercent || 0),
    splitDirection: input.splitDirection || "partner_owes_me",
    splits: Array.isArray(input.splits) ? input.splits : [],
  };

  if (!tx.amount || tx.amount < 0) throw new Error("El monto debe ser mayor a cero.");

  if (["card_purchase", "debt_payment"].includes(tx.kind)) {
    const debt = ensureDebtForTransaction(tx);
    tx.debtId = debt.id;
  }

  state.transactions.push(tx);
  createPartnerReceivableFromTransaction(tx);
  recomputeDebtBalances();
  saveState();
}

function ensureDebtForTransaction(tx) {
  const existing = tx.debtId ? getDebt(tx.debtId) : null;
  if (existing) return existing;
  const name = inferDebtName(tx);
  let debt = findDebtByName(name);
  if (!debt) {
    debt = {
      id: uid("debt"),
      name,
      type: "credit_card",
      balance: 0,
      originalAmount: 0,
      startingBalance: tx.kind === "debt_payment" ? Number(tx.amount || 0) : 0,
      installmentTotal: 1,
      installmentPaid: 0,
      dueDate: tx.date,
      createdAt: today(),
    };
    state.debts.push(debt);
  }
  return debt;
}

function inferDebtName(tx) {
  const explicit = tx.debtName || tx.debt || "";
  if (explicit) return String(explicit).trim();
  const source = [tx.bankName, tx.account, tx.notes, tx.description].filter(Boolean).join(" - ");
  const cardMatch = source.match(/(?:tarjeta\s*(?:credito|cr[eé]dito)?\s*)?(visa|mastercard|amex|american express|dinners? club)[^\d]*(\d{3,4})?/i);
  if (cardMatch) return `Tarjeta ${cardMatch[1]}${cardMatch[2] ? ` ${cardMatch[2]}` : ""}`.replace(/\s+/g, " ").trim();
  const bank = tx.bankName || tx.account;
  return bank ? `Tarjeta ${bank}` : "Tarjeta de credito";
}

function createPartnerReceivableFromTransaction(tx) {
  const splits = normalizedSplits(tx);
  if (!splits.length || !["cash_expense", "card_purchase"].includes(tx.kind)) {
    state.receivables = state.receivables.filter((item) => !(item.linkedTransactionId === tx.id && item.partnerId && item.status === "pending"));
    return;
  }
  const validPartnerIds = new Set(splits.map((split) => split.partnerId));
  state.receivables = state.receivables.filter((item) => !(item.linkedTransactionId === tx.id && item.partnerId && item.status === "pending" && !validPartnerIds.has(item.partnerId)));
  splits.forEach((split) => {
    const partner = state.partners.find((item) => item.id === split.partnerId);
    if (!partner) return;
    const amount = Math.round(Number(tx.amount || 0) * Number(split.percent || 0) / 100);
    if (!amount) return;
    const existing = state.receivables.find((item) => item.linkedTransactionId === tx.id && item.partnerId === partner.id && item.status === "pending");
    const payload = {
      date: tx.date,
      description: `Parte de ${partner.name}: ${tx.description}`,
      amount,
      from: partner.name,
      linkedTransactionId: tx.id,
      partnerId: partner.id,
      sharePercent: split.percent,
      direction: "partner_owes_me",
    };
    if (existing) Object.assign(existing, payload);
    else state.receivables.push({ id: uid("rec"), status: "pending", collectedDate: "", ...payload });
  });
}

function normalizedSplits(tx) {
  const source = Array.isArray(tx.splits) && tx.splits.length
    ? tx.splits
    : (tx.partnerId && tx.partnerSharePercent ? [{ partnerId: tx.partnerId, percent: tx.partnerSharePercent }] : []);
  return source
    .map((split) => ({ partnerId: split.partnerId || "", percent: Number(split.percent || split.partnerSharePercent || 0) }))
    .filter((split) => split.partnerId && split.percent > 0);
}

function recomputeDebtBalances() {
  state.debts.forEach((debt) => {
    const starting = Number(debt.startingBalance ?? debt.originalAmount ?? 0);
    const cardPurchases = debt.type === "credit_card"
      ? state.transactions
        .filter((tx) => tx.kind === "card_purchase" && tx.debtId === debt.id)
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
      : 0;
    const payments = state.transactions
      .filter((tx) => tx.kind === "debt_payment" && tx.debtId === debt.id)
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    debt.originalAmount = starting + cardPurchases;
    debt.balance = Math.max(0, debt.originalAmount - payments);
    if (debt.type === "installment") {
      debt.installmentPaid = Math.min(
        Number(debt.installmentTotal || 1),
        state.transactions.filter((tx) => tx.kind === "debt_payment" && tx.debtId === debt.id).length
      );
    }
  });
}

function addReceivable(input) {
  const item = {
    id: uid("rec"),
    date: input.date || activeMonthDate("01"),
    description: input.description || "Cobranza",
    amount: Math.abs(Number(input.amount || 0)),
    from: input.from || "",
    linkedTransactionId: input.linkedTransactionId || "",
    partnerId: input.partnerId || "",
    sharePercent: Number(input.sharePercent || 0),
    status: "pending",
    collectedDate: "",
  };
  if (!item.amount) throw new Error("El monto debe ser mayor a cero.");
  state.receivables.push(item);
  saveState();
}

function addPartner(input) {
  const partner = {
    id: input.id || uid("partner"),
    name: input.name || "Socio",
    notes: input.notes || "",
    active: input.active !== "false",
    createdAt: today(),
  };
  if (!partner.name.trim()) throw new Error("El socio necesita nombre.");
  state.partners.push(partner);
  saveState();
}

function updatePartner(id, input) {
  const partner = state.partners.find((item) => item.id === id);
  if (!partner) return;
  Object.assign(partner, {
    name: input.name || partner.name,
    notes: input.notes || "",
    active: input.active !== "false",
  });
  saveState();
}

function collectReceivable(id) {
  const item = state.receivables.find((r) => r.id === id);
  if (!item || item.status === "collected") return;
  const amount = Number(item.amount || 0);
  item.status = "collected";
  item.collectedDate = today();
  item.collectedAmount = Number(item.collectedAmount || 0) + amount;
  addTransaction({
    date: today(),
    description: `Cobro: ${item.description}`,
    amount,
    kind: "receivable_collection",
    category: "Reembolso",
    source: "collection",
  });
}

function partialCollectReceivable(id) {
  const item = state.receivables.find((r) => r.id === id);
  if (!item || item.status === "collected") return;
  const current = Number(item.amount || 0);
  const raw = prompt(`Monto abonado para "${item.description}"`, String(current));
  if (raw === null) return;
  const amount = Math.round(parseMoney(raw));
  if (!amount || amount <= 0) return showToast("Ingresa un monto de abono valido.", "warning");
  if (amount >= current) {
    collectReceivable(id);
    render();
    return;
  }
  item.amount = current - amount;
  item.collectedAmount = Number(item.collectedAmount || 0) + amount;
  item.lastPaymentDate = today();
  item.notes = [item.notes || "", `Abono ${money(amount)} el ${today()}`].filter(Boolean).join(" | ");
  addTransaction({
    date: today(),
    description: `Abono: ${item.description}`,
    amount,
    kind: "receivable_collection",
    category: "Reembolso",
    source: "partial_collection",
  });
  saveState();
}

function addDebt(input) {
  const amount = Math.abs(Number(input.amount || 0));
  if (!amount) throw new Error("El monto debe ser mayor a cero.");
  state.debts.push({
    id: uid("debt"),
    name: input.name || "Deuda",
    type: input.type || "installment",
    balance: amount,
    originalAmount: amount,
    startingBalance: amount,
    installmentTotal: Number(input.installmentTotal || 1),
    installmentPaid: 0,
    monthlyPayment: Number(input.monthlyPayment || 0),
    interestRate: Number(input.interestRate || 0),
    paymentMethod: input.paymentMethod || "avalancha",
    dueDate: input.dueDate || activeMonthDate("28"),
    createdAt: today(),
  });
  saveState();
}

function addGoal(input) {
  const goal = {
    id: input.id || uid("goal"),
    name: input.name || "Objetivo financiero",
    type: input.type || "savings",
    targetAmount: Math.abs(Number(input.targetAmount || 0)),
    currentAmount: Math.abs(Number(input.currentAmount || 0)),
    deadline: input.deadline || goalDeadlineFromMonth(input.targetMonth),
    targetMonth: input.targetMonth || monthKey(input.deadline || goalDeadlineFromMonth(input.targetMonth)),
    allocationPercent: Number(input.allocationPercent || 0),
    priority: input.priority || "media",
    debtId: input.debtId || "",
    createdAt: today(),
  };
  if (!goal.targetAmount) throw new Error("El objetivo necesita un monto mayor a cero.");
  state.goals.push(goal);
  saveState();
}

function goalDeadlineFromMonth(targetMonth) {
  const key = targetMonth || addMonthsToKey(activeMonth(), 6);
  return `${key}-28`;
}

function savingsAllocationSummary() {
  const savingsGoals = state.goals.filter((goal) => goal.type === "savings");
  const monthlySavingsPool = distributionSummary(activeMonth()).savings;
  const allocatedPercent = savingsGoals.reduce((sum, goal) => sum + Number(goal.allocationPercent || 0), 0);
  const rows = savingsGoals
    .slice()
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .map((goal) => ({
      goal,
      amount: monthlySavingsPool * Number(goal.allocationPercent || 0) / 100,
    }));
  return { monthlySavingsPool, allocatedPercent, rows };
}

function priorityRank(priority) {
  return { alta: 1, media: 2, baja: 3 }[priority] || 2;
}

function addRecurring(input) {
  const item = {
    id: input.id || uid("recurring"),
    name: input.name || "Recurrente",
    kind: input.kind || "expense",
    amount: Math.abs(Number(input.amount || 0)),
    category: input.category || "Otros",
    distribution: inferDistribution(input),
    frequency: "monthly",
    startDate: input.startDate || activeMonthDate("01"),
    active: input.active !== "false",
    notes: input.notes || "",
    partnerId: input.partnerId || "",
    partnerSharePercent: Number(input.partnerSharePercent || 0),
    history: [],
    createdAt: today(),
  };
  if (!item.amount) throw new Error("El monto recurrente debe ser mayor a cero.");
  item.history.push({
    at: new Date().toISOString(),
    action: "created",
    snapshot: recurringSnapshot(item),
  });
  state.recurringItems.push(item);
  saveState();
}

function updateRecurring(id, input) {
  const item = state.recurringItems.find((entry) => entry.id === id);
  if (!item) return;
  const before = recurringSnapshot(item);
  Object.assign(item, {
    name: input.name || item.name,
    kind: input.kind || item.kind,
    amount: Math.abs(Number(input.amount || 0)),
    category: input.category || item.category,
    startDate: input.startDate || item.startDate,
    active: input.active !== "false",
    notes: input.notes || "",
    partnerId: input.partnerId || "",
    partnerSharePercent: Number(input.partnerSharePercent || 0),
  });
  if (!item.amount) throw new Error("El monto recurrente debe ser mayor a cero.");
  item.history ||= [];
  item.history.push({
    at: new Date().toISOString(),
    action: "updated",
    before,
    after: recurringSnapshot(item),
  });
  saveState();
}

function recurringSnapshot(item) {
  return {
    name: item.name,
    kind: item.kind,
    amount: Number(item.amount || 0),
    category: item.category,
    startDate: item.startDate,
    active: item.active !== false,
    notes: item.notes || "",
    partnerId: item.partnerId || "",
    partnerSharePercent: Number(item.partnerSharePercent || 0),
  };
}

function deleteRecurring(id) {
  if (!confirm("Desactivar recurrente? Se conserva su historial.")) return;
  const item = state.recurringItems.find((entry) => entry.id === id);
  if (!item) return;
  const before = recurringSnapshot(item);
  item.active = false;
  item.history ||= [];
  item.history.push({
    at: new Date().toISOString(),
    action: "deactivated",
    before,
    after: recurringSnapshot(item),
  });
  saveState();
  render();
}

function dedupeKey(row) {
  return [row.accountingMonth || financialCycleMonth(row.date), row.date, row.description.trim().toLowerCase(), Number(row.amount || 0).toFixed(2)].join("|");
}

function existingKeys() {
  return new Set(state.transactions.map(dedupeKey));
}

function parseImportText(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  const keys = existingKeys();
  lines.forEach((line) => {
    const parts = line.includes(";") ? line.split(";") : line.split(",");
    if (parts.length < 3) return;
    const cleaned = parts.map((p) => p.trim());
    let dateRaw = activeMonthDate("01");
    let descRaw;
    let amountRaw;
    let kindRaw;
    let categoryRaw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned[0])) {
      [dateRaw, descRaw, amountRaw, kindRaw, categoryRaw] = cleaned;
    } else if (/^\d{1,2}$/.test(cleaned[0])) {
      dateRaw = activeFinancialCycleDate(cleaned[0]);
      [, descRaw, amountRaw, kindRaw, categoryRaw] = cleaned;
    } else {
      [descRaw, amountRaw, kindRaw, categoryRaw] = cleaned;
    }
    const amount = Math.abs(parseMoney(amountRaw));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || !descRaw || !amount) return;
    const kind = normalizeKind(kindRaw, amountRaw);
    const row = {
      id: uid("imp"),
      date: dateRaw,
      accountingMonth: financialCycleMonth(dateRaw),
      description: descRaw,
      amount,
      kind,
      category: categoryRaw || (kind === "income" ? "Sueldo" : "Otros"),
      duplicate: keys.has(dedupeKey({ date: dateRaw, description: descRaw, amount })),
      approved: false,
    };
    candidates.push(row);
  });
  return candidates;
}

function parseDelimitedRows(text) {
  const delimiter = text.includes("\t") ? "\t" : (text.includes(";") ? ";" : ",");
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseExcelModelText(text) {
  return parseExcelModelRows(parseDelimitedRows(text.replace(/^\uFEFF/, "")));
}

function parseExcelModelRows(rows) {
  const diagnostics = {
    sourceRows: Math.max(0, rows.length - 1),
    validRows: 0,
    skippedRows: [],
    headers: [],
  };
  if (rows.length < 2) return { candidates: [], diagnostics };
  const headers = rows[0].map(normalizeHeader);
  diagnostics.headers = headers.filter(Boolean);
  const keys = existingKeys();
  const candidates = [];
  rows.slice(1).forEach((cells, rowIndex) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    if (Object.values(row).every((value) => !String(value || "").trim())) return;
    const day = row.dia || row.day;
    const date = normalizeImportDate(row.fecha || row.date, day);
    const baseDescription = row.descripcion || row.description || row.detalle || row.comercio || row.glosa || row.nombre || row.concepto;
    const quotaText = quotaLabel(row);
    const description = quotaText && baseDescription && !String(baseDescription).includes(quotaText)
      ? `${baseDescription} ${quotaText}`
      : baseDescription;
    const amountRaw = firstFilled(row.monto, row.amount, row.valor, row.cargo, row.abono, row.importe, row.monto_clp, row.monto_pesos);
    const amount = Math.abs(parseMoney(amountRaw));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || !amount) {
      diagnostics.skippedRows.push({
        row: rowIndex + 2,
        reason: !description ? "falta descripcion" : !amount ? "falta monto valido" : "fecha invalida",
        preview: cells.slice(0, 5).filter(Boolean).join(" | "),
      });
      return;
    }
    const debtName = firstFilled(row.deuda, row.tarjeta, row.credito, row.banco, row.bank, row.cuenta, row.account);
    const debt = findDebtByName(debtName);
    const kind = normalizeKind(firstFilled(row.tipo, row.type, row.movimiento, row.tipo_movimiento, row.clase), amountRaw, row);
    const item = {
      id: uid("imp"),
      date,
      accountingMonth: financialCycleMonth(date),
      description,
      amount,
      kind,
      category: row.categoria || row.category || row.rubro || (kind === "income" ? "Sueldo" : "Otros"),
      distribution: normalizeDistribution(row.distribucion || row.distribution || row.grupo),
      account: row.cuenta || row.account || "",
      bankName: row.banco || row.banco_informe || row.bank || row.bank_name || "",
      debtName,
      partnerId: "",
      partnerSharePercent: 0,
      debtId: debt?.id || "",
      notes: [row.notas || row.notes || "", quotaText ? `Cuota ${quotaText}` : ""].filter(Boolean).join(" - "),
      duplicate: keys.has(dedupeKey({ date, description, amount })),
      approved: !keys.has(dedupeKey({ date, description, amount })),
    };
    candidates.push(item);
    diagnostics.validRows += 1;
  });
  return { candidates, diagnostics };
}

function firstFilled(...values) {
  return values.find((value) => String(value ?? "").trim() !== "") ?? "";
}

function normalizeImportDate(value, dayValue) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (parts) {
    const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
    return `${year}-${String(parts[2]).padStart(2, "0")}-${String(parts[1]).padStart(2, "0")}`;
  }
  return dayValue ? activeFinancialCycleDate(dayValue) : activeMonthDate("01");
}

function parseMoney(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-") || /^\(.*\)$/.test(raw) || /\b(cargo|debe|egreso|compra)\b/i.test(raw);
  let clean = raw
    .replace(/\((.*)\)/, "$1")
    .replace(/[^\d,.-]/g, "")
    .replace(/(?!^)-/g, "");
  if (!clean) return 0;

  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    clean = clean.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const pieces = clean.split(sep);
    const tail = pieces.at(-1) || "";
    const looksLikeThousands = pieces.length > 1 && tail.length === 3 && pieces.slice(1).every((part) => part.length === 3);
    clean = looksLikeThousands ? pieces.join("") : clean.replace(sep, ".");
  }

  const amount = Number(clean);
  return Number.isFinite(amount) ? (negative ? -Math.abs(amount) : amount) : 0;
}

function parseExcelModelWorkbook(buffer) {
  if (!window.XLSX) throw new Error("No se pudo cargar el lector Excel. Recarga la app e intenta nuevamente.");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "movimientos") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  return parseExcelModelRows(rows);
}

function quotaLabel(row) {
  const detail = row.detalle_cuota || row.cuota || "";
  if (/^\d+\s*\/\s*\d+$/.test(String(detail).trim())) return String(detail).replace(/\s/g, "");
  const current = row.cuota_actual || row.cuota_pagada || row.numero_cuota;
  const total = row.cuotas_totales || row.total_cuotas;
  if (current && total) return `${current}/${total}`;
  return "";
}

function findPartnerByName(name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  return state.partners.find((partner) => partner.name.toLowerCase() === needle) || null;
}

function findDebtByName(name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  return state.debts.find((debt) => debt.name.toLowerCase() === needle) || null;
}

function normalizeDistribution(value) {
  const raw = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (raw.includes("fijo")) return "fixed";
  if (raw.includes("variable")) return "variable";
  if (raw.includes("financiero")) return "financial";
  if (raw.includes("hormiga")) return "micro";
  if (raw.includes("ahorro")) return "savings";
  if (raw.includes("gusto")) return "variable";
  return "";
}

function excelTemplateCsv() {
  const headers = [
    "fecha",
    "dia",
    "descripcion",
    "monto",
    "tipo",
    "categoria",
    "distribucion",
    "cuenta",
    "banco",
    "deuda",
    "cuota_actual",
    "cuotas_totales",
    "detalle_cuota",
    "notas",
  ];
  const blankRow = headers.map(() => "");
  return [headers, blankRow].map((row) => row.map(csvCell).join(";")).join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadExcelTemplate() {
  const a = document.createElement("a");
  a.href = "modelo-excel-finanzas.xlsx";
  a.download = `modelo-excel-finanzas-${activeMonth()}.xlsx`;
  a.click();
}

function normalizeKind(kindRaw = "", amountRaw = "", row = {}) {
  const raw = String(kindRaw || "").toLowerCase();
  if (raw.includes("ingreso") || raw.includes("income") || String(amountRaw).trim().startsWith("+")) return "income";
  if (raw.includes("tarjeta") || raw.includes("card") || row.tarjeta || row.credito) return "card_purchase";
  if (raw.includes("deuda") || raw.includes("pago")) return "debt_payment";
  return "cash_expense";
}

function closeMonth(key = monthKey()) {
  const f = monthFinance(key);
  const previousKey = addMonthsToKey(key, -1);
  const previous = monthFinance(previousKey);
  const txs = state.transactions.filter((tx) => txMonth(tx) === key);
  const dist = distributionSummary(key);
  const already = state.monthlyClosures.find((c) => c.month === key);
  const snapshot = {
    id: already?.id || uid("close"),
    month: key,
    closedAt: new Date().toISOString(),
    metrics: f,
    transactionCount: txs.length,
    income: f.income,
    netExpense: f.netRealExpense,
    freeFlow: f.income - f.netRealExpense - f.debtPayments,
    distribution: dist,
    trends: {
      incomeDelta: f.income - previous.income,
      expenseDelta: f.netRealExpense - previous.netRealExpense,
      debtDelta: f.outstandingDebt - previous.outstandingDebt,
    },
    pendingReceivables: state.receivables.filter((r) => r.status === "pending").length,
    openDebts: state.debts.filter((d) => d.balance > 0).length,
    note: "El cierre guarda snapshot; no borra cobranzas, cuotas ni pasivos.",
  };
  if (already) Object.assign(already, snapshot);
  else state.monthlyClosures.push(snapshot);
  saveState();
}

function nextMonthDate(months) {
  const date = new Date(`${today()}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function resetAll() {
  setState(blankAppState());
  state.activeView = "dashboard";
  modal = null;
  editingId = null;
  saveState();
  render();
}

function setView(view) {
  state.activeView = view;
  saveState();
  render();
}

function render() {
  const app = document.querySelector("#app");
  if (!authReady) {
    app.innerHTML = renderAuthLoading();
    return;
  }
  if (!authUser) {
    app.innerHTML = renderAuthScreen();
    bindAuthScreen();
    return;
  }
  if (!state.onboardingDone) {
    app.innerHTML = renderOnboarding();
    bindOnboarding();
    return;
  }
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark" aria-hidden="true">$</div><div>Mi Portal Financiero</div></div>
        <nav class="nav">
          ${navButton("dashboard", "Inicio", icons.dashboard)}
          ${navButton("transactions", "Registrar", "+")}
          ${navButton("goals", "Objetivos", icons.goals)}
          ${navButton("partners", "Socios", icons.partners)}
          ${navButton("calendar", "Calendario", icons.month)}
          ${navButton("projection", "Proyectar", icons.history)}
          ${navButton("ai", "IA financiera", "IA")}
          ${navButton("import", "Importar", icons.import)}
          ${navButton("closing", "Cierre", icons.save)}
          ${navButton("settings", "Ajustes", icons.backup)}
        </nav>
        <div class="privacy">Datos guardados localmente en este navegador. No se envian a servidores. Exporta respaldos periodicos y evita computadores compartidos.</div>
        <div class="footer-note">Persistencia actual: ${persistence.driver()}. Capa preparada para migrar a IndexedDB.</div>
      </aside>
      <main class="main">
        ${renderTopbar()}
        ${renderView()}
      </main>
    </div>
    ${modal ? renderModal() : ""}
    ${renderFloatingAiWidget()}
  `;
  bindApp();
  scrollAiMessagesToBottom();
}

function navButton(view, label, icon) {
  return `<button class="${state.activeView === view ? "active" : ""}" data-view="${view}" title="${label}"><span>${label}</span></button>`;
}

function renderAuthLoading() {
  return `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-logo">$</div>
        <h1>Mi Portal Financiero</h1>
        <p>Preparando acceso seguro con Google...</p>
      </div>
    </div>
  `;
}

function renderAuthScreen() {
  const config = storedFirebaseConfig();
  const configured = hasFirebaseConfig(config);
  return `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-logo">$</div>
        <h1>Mi Portal Financiero</h1>
        <p>Ingresa con tu correo de Google para abrir tu portal financiero local.</p>
        ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ""}
        ${configured ? `
          <button class="primary-button auth-main-button" id="googleLogin">Entrar con Google</button>
          <button class="ghost-button auth-main-button auth-github-button" id="githubLogin">Entrar con GitHub</button>
          <button class="ghost-button" id="editFirebaseConfig">Cambiar configuracion Firebase</button>
        ` : `
          <div class="auth-setup">
            <strong>Conectar proyecto Firebase: vamoaver</strong>
            <p>Pega el objeto <code>firebaseConfig</code> de una app web: Configuracion del proyecto > General > Tus apps > SDK setup and configuration. Debe incluir una <code>apiKey</code> que empieza con <code>AIza</code> y un <code>appId</code>.</p>
            <textarea id="firebaseConfigInput" rows="9" placeholder='const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "vamoaver.firebaseapp.com",
  projectId: "vamoaver",
  storageBucket: "vamoaver.appspot.com",
  messagingSenderId: "...",
  appId: "1:..."
};'>${escapeHtml(JSON.stringify(config, null, 2))}</textarea>
            <button class="primary-button" id="saveFirebaseConfig">Guardar configuracion</button>
          </div>
        `}
      </div>
    </div>
  `;
}

function bindAuthScreen() {
  const login = document.querySelector("#googleLogin");
  if (login) login.addEventListener("click", signInWithGoogle);
  const githubLogin = document.querySelector("#githubLogin");
  if (githubLogin) githubLogin.addEventListener("click", signInWithGithub);
  const edit = document.querySelector("#editFirebaseConfig");
  if (edit) edit.addEventListener("click", () => {
    localStorage.removeItem(FIREBASE_CONFIG_KEY);
    setAuthReady(true);
    setAuthUser(null);
    render();
  });
  const save = document.querySelector("#saveFirebaseConfig");
  if (save) save.addEventListener("click", () => {
    try {
      saveFirebaseConfigFromText(document.querySelector("#firebaseConfigInput").value);
      setAuthError("");
      setAuthReady(false);
      initializeFirebaseAuth();
    } catch (error) {
      setAuthError(error.message || String(error));
      render();
    }
  });
}

function renderTopbar() {
  return `
    <div class="topbar">
      <div class="title-block">
        <h1>${viewTitle()}</h1>
        <p>${state.profile.name || "Sistema financiero local"} - ${state.profile.currency}</p>
      </div>
      <div class="actions">
        <span class="user-chip">${escapeHtml(authUser?.email || "")}</span>
        <label class="month-control"><span>Mes financiero</span><input id="selectedMonth" type="month" value="${activeMonth()}"><small>${financialCycleRangeLabel()}</small></label>
        <button class="primary-button" data-modal="transaction">+ Movimiento</button>
        <button class="ghost-button" data-view="import">Importar</button>
        <button class="ghost-button" data-action="logout">Salir</button>
      </div>
    </div>
  `;
}

function viewTitle() {
  return {
    dashboard: "Dashboard financiero",
    settings: "Ajustes",
    goals: "Objetivos y ajustes",
    recurring: "Ingresos y egresos recurrentes",
    partners: "Socios y reparto",
    history: "Historial y proyeccion",
    transactions: "Movimientos",
    debts: "Tarjeta, cuotas y pasivos",
    receivables: "Cobranzas y reembolsos",
    calendar: "Calendario de compras",
    projection: "Proyectar mes siguiente",
    ai: "IA financiera",
    import: "Importacion y conciliacion",
    closing: "Cierre mensual",
    backup: "Respaldo JSON",
  }[state.activeView];
}

function renderView() {
  if (state.activeView === "goals") return renderGoals();
  if (state.activeView === "recurring") return renderRecurring();
  if (state.activeView === "partners") return renderPartners();
  if (state.activeView === "history") return renderHistory();
  if (state.activeView === "transactions") return renderTransactions();
  if (state.activeView === "debts") return renderDebts();
  if (state.activeView === "receivables") return renderReceivables();
  if (state.activeView === "calendar") return renderPurchaseCalendar();
  if (state.activeView === "projection") return renderNextMonthProjection();
  if (state.activeView === "ai") return renderAiAdvisor();
  if (state.activeView === "import") return renderImport();
  if (state.activeView === "closing") return renderClosing();
  if (state.activeView === "backup") return renderBackup();
  if (state.activeView === "settings") return renderSettings();
  return renderDashboard();
}

function renderMetrics(f = computeFinance()) {
  return `
    <section class="grid metrics">
      <div class="card metric"><span>Ingreso mensual</span><strong>${money(f.income)}</strong><small>Entradas registradas del periodo</small></div>
      <div class="card metric"><span>Gasto neto del mes</span><strong>${money(f.netProjectedExpense)}</strong><small>Descuenta cobros esperados</small></div>
      <div class="card metric"><span>Capacidad de ahorro estimada</span><strong>${money(Math.max(0, f.income - f.netProjectedExpense - f.debtPayments))}</strong><small>Disponible antes de nuevas metas</small></div>
      <div class="card metric"><span>Deuda pendiente</span><strong>${money(f.outstandingDebt)}</strong><small>Tarjetas, cuotas y pasivos</small></div>
    </section>
  `;
}

function renderHomeSummaryTiles(f = monthFinance(activeMonth())) {
  const balances = partnerBalances().filter((item) => item.partner.active !== false);
  const partnerNet = balances.reduce((sum, item) => sum + Number(item.net || 0), 0);
  const partnerLabel = partnerNet >= 0 ? "Te deben" : "Les debes";
  const remaining = f.income - f.netProjectedExpense - f.debtPayments;
  const tiles = [
    { tone: "green", modal: "summaryIncome", label: "Total ingresos", value: money(f.income), note: "Entradas del mes seleccionado" },
    { tone: "pink", modal: "summaryExpense", label: "Total egresos", value: money(f.netProjectedExpense + f.debtPayments), note: "Gastos, tarjeta y pagos" },
    { tone: "yellow", modal: "summaryBalance", label: "Saldo restante", value: money(remaining), note: remaining >= 0 ? "Disponible estimado" : "Falta cubrir este mes" },
    { tone: "blue", modal: "summaryPartners", label: "Socios", value: money(Math.abs(partnerNet)), note: `${partnerLabel} - ${balances.length} activo(s)` },
  ];
  return `
    <section class="summary-tiles">
      ${tiles.map((tile) => `
        <button type="button" class="summary-tile ${tile.tone}" data-modal="${tile.modal}">
          <span>${tile.label}</span>
          <strong>${tile.value}</strong>
          <small>${tile.note}</small>
        </button>
      `).join("")}
    </section>
  `;
}

function bankEntityName(tx) {
  return [tx.bankName, tx.account].filter(Boolean).join(" - ") || tx.debtName || "Sin banco";
}

function bankEntitySummary() {
  const rows = {};
  currentMonthTransactions().forEach((tx) => {
    const name = bankEntityName(tx);
    rows[name] ||= { name, income: 0, expense: 0, count: 0 };
    const amount = Number(tx.amount || 0);
    rows[name].count += 1;
    if (["income", "receivable_collection"].includes(tx.kind)) rows[name].income += amount;
    else rows[name].expense += amount;
  });
  return Object.values(rows)
    .map((item) => ({ ...item, net: item.income - item.expense }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

function renderBankEntitySummary() {
  const rows = bankEntitySummary();
  return `
    <section class="card panel bank-summary-panel">
      <div class="panel-head">
        <h2>Resumen por banco</h2>
        <span class="muted">${activeMonth()}</span>
      </div>
      ${rows.length ? `<div class="bank-summary-grid">
        ${rows.slice(0, 6).map((item) => `
          <article class="bank-summary-card">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <span>${item.count} movimiento(s)</span>
            </div>
            <div class="bank-summary-values">
              <span>Ingresos <b>${money(item.income)}</b></span>
              <span>Egresos <b>${money(item.expense)}</b></span>
              <span class="${item.net >= 0 ? "positive" : "negative"}">Neto <b>${money(item.net)}</b></span>
            </div>
          </article>
        `).join("")}
      </div>` : `<div class="empty">Cuando importes o registres movimientos de este mes, aqui aparecera el resumen por banco, cuenta o tarjeta.</div>`}
    </section>
  `;
}

function globalAnalysisFilters() {
  state.ui ||= {};
  state.ui.globalAnalysis ||= {};
  return {
    text: state.ui.globalAnalysis.text || "",
    flow: state.ui.globalAnalysis.flow || "all",
    bank: state.ui.globalAnalysis.bank || "all",
    shared: state.ui.globalAnalysis.shared || "all",
    month: state.ui.globalAnalysis.month || "active",
    day: state.ui.globalAnalysis.day || "",
    min: state.ui.globalAnalysis.min || "",
    max: state.ui.globalAnalysis.max || "",
  };
}

function txIsShared(tx) {
  return normalizedSplits(tx).length > 0 || Boolean(tx.partnerId);
}

function txMatchesGlobalAnalysis(tx, filters) {
  const amount = Number(tx.amount || 0);
  const haystack = [
    tx.description,
    tx.category,
    tx.bankName,
    tx.account,
    tx.notes,
    tx.source,
    distributionGroups[tx.distribution || inferDistribution(tx)],
    kindPillText(tx.kind),
  ].filter(Boolean).join(" ").toLowerCase();
  const text = filters.text.trim().toLowerCase();
  if (text && !haystack.includes(text)) return false;
  if (filters.month === "active" && txMonth(tx) !== activeMonth()) return false;
  if (filters.month && filters.month !== "active" && filters.month !== "all" && txMonth(tx) !== filters.month) return false;
  if (filters.day && tx.date !== filters.day) return false;
  if (filters.bank !== "all" && bankEntityName(tx) !== filters.bank) return false;
  if (filters.shared === "shared" && !txIsShared(tx)) return false;
  if (filters.shared === "not_shared" && txIsShared(tx)) return false;
  if (filters.min !== "" && amount < Number(filters.min || 0)) return false;
  if (filters.max !== "" && amount > Number(filters.max || 0)) return false;
  if (filters.flow === "income" && !["income", "receivable_collection"].includes(tx.kind)) return false;
  if (filters.flow === "expense" && ["income", "receivable_collection"].includes(tx.kind)) return false;
  if (filters.flow === "card" && !["card_purchase", "debt_payment"].includes(tx.kind)) return false;
  if (filters.flow === "shared" && !txIsShared(tx)) return false;
  return true;
}

function kindPillText(kind) {
  const labels = {
    income: "Ingreso",
    cash_expense: "Gasto caja",
    card_purchase: "Consumo tarjeta",
    debt_payment: "Pago de deuda",
    receivable_collection: "Cobro",
  };
  return labels[kind] || kind || "";
}

function renderGlobalAnalysisPanel() {
  const filters = globalAnalysisFilters();
  const txs = state.transactions
    .filter((tx) => txMatchesGlobalAnalysis(tx, filters))
    .sort((a, b) => b.date.localeCompare(a.date));
  const income = txs.filter((tx) => ["income", "receivable_collection"].includes(tx.kind)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const expense = txs.filter((tx) => !["income", "receivable_collection"].includes(tx.kind)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const shared = txs.filter(txIsShared).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const card = txs.filter((tx) => ["card_purchase", "debt_payment"].includes(tx.kind)).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const banks = [...new Set(state.transactions.map(bankEntityName))].sort((a, b) => a.localeCompare(b));
  const months = [...new Set(state.transactions.map(txMonth))].sort().reverse();
  return `
    <section class="card panel global-analysis-panel">
      <div class="panel-head">
        <div>
          <h2>Analisis global</h2>
          <p class="muted">Filtra todos tus registros por banco, tarjeta, socios, fecha, texto o monto.</p>
        </div>
        <button class="ghost-button mini-button" data-analysis-reset>Limpiar filtros</button>
      </div>
      <div class="analysis-filters">
        <label><span>Buscar</span><input data-analysis-filter="text" value="${escapeHtml(filters.text)}" placeholder="comida, tarjeta, arriendo..."></label>
        <label><span>Tipo</span><select data-analysis-filter="flow">
          <option value="all" ${filters.flow === "all" ? "selected" : ""}>Todo</option>
          <option value="income" ${filters.flow === "income" ? "selected" : ""}>Ingresos</option>
          <option value="expense" ${filters.flow === "expense" ? "selected" : ""}>Egresos</option>
          <option value="card" ${filters.flow === "card" ? "selected" : ""}>Tarjeta / deuda</option>
          <option value="shared" ${filters.flow === "shared" ? "selected" : ""}>Gastos compartidos</option>
        </select></label>
        <label><span>Banco o cuenta</span><select data-analysis-filter="bank">
          <option value="all" ${filters.bank === "all" ? "selected" : ""}>Todos</option>
          ${banks.map((bank) => `<option value="${escapeHtml(bank)}" ${filters.bank === bank ? "selected" : ""}>${escapeHtml(bank)}</option>`).join("")}
        </select></label>
        <label><span>Socios</span><select data-analysis-filter="shared">
          <option value="all" ${filters.shared === "all" ? "selected" : ""}>Todos</option>
          <option value="shared" ${filters.shared === "shared" ? "selected" : ""}>Solo compartidos</option>
          <option value="not_shared" ${filters.shared === "not_shared" ? "selected" : ""}>No compartidos</option>
        </select></label>
        <label><span>Mes financiero</span><select data-analysis-filter="month">
          <option value="active" ${filters.month === "active" ? "selected" : ""}>Mes seleccionado</option>
          <option value="all" ${filters.month === "all" ? "selected" : ""}>Todos los meses</option>
          ${months.map((month) => `<option value="${month}" ${filters.month === month ? "selected" : ""}>${month}</option>`).join("")}
        </select></label>
        <label><span>Dia exacto</span><input type="date" data-analysis-filter="day" value="${escapeHtml(filters.day)}"></label>
        <label><span>Monto desde</span><input type="number" min="0" step="1" data-analysis-filter="min" value="${escapeHtml(filters.min)}" placeholder="0"></label>
        <label><span>Monto hasta</span><input type="number" min="0" step="1" data-analysis-filter="max" value="${escapeHtml(filters.max)}" placeholder="Sin limite"></label>
      </div>
      <div class="analysis-summary-grid">
        <article><span>Ingresos filtrados</span><strong class="positive">${money(income)}</strong></article>
        <article><span>Egresos filtrados</span><strong class="negative">${money(expense)}</strong></article>
        <article><span>Tarjeta / deuda</span><strong>${money(card)}</strong></article>
        <article><span>Compartidos</span><strong>${money(shared)}</strong></article>
      </div>
      <div class="analysis-result-head">
        <strong>${txs.length} movimiento(s)</strong>
        <span class="${income - expense >= 0 ? "positive" : "negative"}">Neto ${money(income - expense)}</span>
      </div>
      ${txs.length ? renderTxTable(txs.slice(0, 12)) : `<div class="empty">No hay registros que coincidan con estos filtros.</div>`}
      ${txs.length > 12 ? `<p class="muted analysis-more">Mostrando 12 de ${txs.length}. Ajusta los filtros para acotar el detalle.</p>` : ""}
    </section>
  `;
}

function renderMonthlyAdvisor() {
  const advice = monthlyAdvisorRecommendation();
  const critical = advice.status === "critical";
  return `
    <section class="advisor-card ${critical ? "critical" : advice.status === "good" ? "good" : ""}">
      <div>
        <span>Recomendacion del mes</span>
        <h2>${escapeHtml(advice.title)}</h2>
        <p>Capacidad estimada: ${money(advice.capacity)}. Objetivos activos: ${money(advice.required)}.</p>
      </div>
      <strong>${advice.gap ? `Brecha ${money(advice.gap)}` : "Sin brecha"}</strong>
      <p><b>Accion sugerida:</b> ${escapeHtml(advice.action)}<br><span>${escapeHtml(advice.detail)}</span></p>
    </section>
  `;
}

function renderDashboard() {
  const txs = filterMovementsByFlow(state.transactions.filter((tx) => txMonth(tx) === activeMonth()))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
  const goalCards = state.goals.slice(0, 2).map(renderGoalSummary).join("");
  return `
    <section class="quick-grid home-actions">
      <button class="quick-action primary-quick" data-modal="transaction"><strong>Registrar movimiento</strong><span>Ingreso, gasto o tarjeta.</span></button>
      <button class="quick-action" data-modal="goal"><strong>Crear objetivo</strong><span>Ahorro o deuda.</span></button>
      <button class="quick-action" data-view="import"><strong>Subir cartola</strong><span>Usa el modelo Excel.</span></button>
    </section>
    ${renderHomeSummaryTiles(monthFinance(activeMonth()))}
    ${renderGlobalAnalysisPanel()}
    ${renderBankEntitySummary()}
    ${renderMonthlyAdvisor()}
    ${renderImportStatusNotice()}
    ${renderKpiPanel()}
    ${renderAvailablePanel()}
    ${renderPartnerDebtVisual()}
    ${renderDistributionSummary()}
    ${renderSavingsAllocation()}
    ${renderPaymentCalendar()}
    <section class="grid two-col">
      <div class="card panel">
        <div class="panel-head">
          <h2>Ultimos movimientos</h2>
          ${renderMovementFlowFilter()}
        </div>
        ${txs.length ? renderTxTable(txs) : `<div class="empty">Agrega un ingreso, gasto, compra con tarjeta o importa tu cartola.</div>`}
      </div>
      <div class="card panel">
        <h2>Diagnostico accionable</h2>
        ${diagnostics().map(([title, action]) => `<div class="diagnostic"><strong>${title}</strong><p>${action}</p></div>`).join("")}
      </div>
    </section>
    <section class="card panel goal-strip">
      <div class="panel-head">
        <h2>Objetivos activos</h2>
        <button class="ghost-button" data-view="goals">Ver ajustes</button>
      </div>
      ${goalCards || `<div class="empty">Crea una meta de ahorro o puesta al dia para que la plataforma proponga ajustes automaticos.</div>`}
    </section>
  `;
}

function renderImportStatusNotice() {
  const finance = monthFinance(activeMonth());
  const monthTxs = currentMonthTransactions();
  const expenseCount = monthTxs.filter((tx) => ["cash_expense", "card_purchase"].includes(tx.kind)).length;
  const incomeCount = monthTxs.filter((tx) => tx.kind === "income").length;
  const pending = state.importCandidates?.filter((item) => (item.accountingMonth || financialCycleMonth(item.date)) === activeMonth()) || [];
  if (pending.length) {
    const approved = pending.filter((item) => item.approved && !item.duplicate).length;
    return `
      <section class="notice-panel warn">
        <strong>Hay ${pending.length} movimientos leidos, pero aun no guardados.</strong>
        <span>${approved} estan aprobados. Entra a Importar y presiona "Importar aprobados" para que aparezcan en el dashboard.</span>
        <button class="ghost-button" data-view="import">Ver importacion</button>
      </section>
    `;
  }
  const otherPending = state.importCandidates?.filter((item) => (item.accountingMonth || financialCycleMonth(item.date)) !== activeMonth()) || [];
  if (otherPending.length) {
    const months = [...new Set(otherPending.map((item) => item.accountingMonth || financialCycleMonth(item.date)))].sort().join(", ");
    return `
      <section class="notice-panel warn">
        <strong>Hay movimientos leidos para otro mes financiero.</strong>
        <span>${otherPending.length} fila(s) pertenecen a: ${months}. Entra a Importar para ver el resumen por mes o cambia el mes financiero arriba.</span>
        <button class="ghost-button" data-view="import">Ver importacion</button>
      </section>
    `;
  }
  if (incomeCount > 0 && expenseCount === 0 && finance.income > 0) {
    return `
      <section class="notice-panel warn">
        <strong>Este mes tiene ingresos, pero ningun egreso guardado.</strong>
        <span>Por eso "Gasto bruto" aparece en $0. Si subiste un Excel, revisa que las filas de gastos hayan quedado como candidatos y luego importalas.</span>
        <button class="ghost-button" data-view="import">Revisar importacion</button>
      </section>
    `;
  }
  return "";
}

function renderDistributionSummary() {
  const totals = distributionSummary(activeMonth());
  const max = Math.max(totals.fixed, totals.variable, totals.financial, totals.micro, totals.savings, 1);
  const total = totals.fixed + totals.variable + totals.financial + totals.micro + totals.savings;
  const selected = state.ui?.selectedDistribution || "";
  const parts = [
    { key: "fixed", label: "Gastos fijos", value: totals.fixed, color: "#2563eb" },
    { key: "variable", label: "Variables", value: totals.variable, color: "#06b6d4" },
    { key: "financial", label: "Financieros", value: totals.financial, color: "#d946ef" },
    { key: "micro", label: "Hormiga", value: totals.micro, color: "#f59e0b" },
    { key: "savings", label: "Ahorro/inversion", value: totals.savings, color: "#10b981" },
  ];
  return `
    <section class="card panel distribution-panel colorful-panel">
      <div class="panel-head">
        <h2>Distribucion del mes</h2>
        <span class="muted">Fijos - variables - financieros - hormiga - ahorro</span>
      </div>
      <div class="donut-layout">
        <div class="donut-card">
          <div class="donut" style="${donutStyle(parts)}"><div><strong>${money(total)}</strong><span>Total</span></div></div>
        </div>
        <div class="distribution-grid">
        ${parts.map(({ key, label, value, color }) => `
          <button class="distribution-item ${selected === key ? "active" : ""}" type="button" data-distribution-detail="${key}">
            <span><i class="swatch" style="background:${color}"></i>${label}</span>
            <strong>${money(value)}</strong>
            <small class="muted">${percentOf(value, total)}% del mes</small>
            <div class="bar-track"><div class="bar ${key === "fixed" ? "income" : key === "savings" ? "goal" : key === "financial" ? "debt" : "expense"}" style="width:${Math.max(4, Math.round(value / max * 100))}%"></div></div>
          </button>
        `).join("")}
        </div>
      </div>
      ${selected ? renderDistributionDetail(selected, parts.find((part) => part.key === selected)?.label || "") : ""}
    </section>
  `;
}

function distributionDetailTransactions(group) {
  return currentMonthTransactions()
    .filter((tx) => {
      if (group === "savings") return tx.kind !== "income" && inferDistribution(tx) === "savings";
      return tx.kind !== "income" && inferDistribution(tx) === group;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function movementFlowFilter() {
  return state.ui?.movementFlowFilter || "all";
}

function filterMovementsByFlow(txs) {
  const flow = movementFlowFilter();
  if (flow === "income") return txs.filter((tx) => ["income", "receivable_collection"].includes(tx.kind));
  if (flow === "expense") return txs.filter((tx) => !["income", "receivable_collection"].includes(tx.kind));
  return txs;
}

function renderMovementFlowFilter() {
  const selected = movementFlowFilter();
  const options = [
    ["all", "Todos"],
    ["income", "Ingresos"],
    ["expense", "Egresos"],
  ];
  return `
    <div class="segmented-control" aria-label="Filtrar ingresos y egresos">
      ${options.map(([value, label]) => `<button type="button" class="${selected === value ? "active" : ""}" data-flow-filter="${value}">${label}</button>`).join("")}
    </div>
  `;
}

function renderDistributionDetail(group, label) {
  const rows = distributionDetailTransactions(group);
  const total = rows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  return `
    <div class="distribution-detail">
      <div class="panel-head">
        <h3>Detalle: ${escapeHtml(label)}</h3>
        <span class="muted">${rows.length} movimientos - ${money(total)}</span>
      </div>
      ${rows.length ? `
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>Fecha</th><th>Descripcion</th><th>Tipo</th><th>Categoria</th><th>Banco / cuenta</th><th>Monto</th></tr></thead>
            <tbody>
              ${rows.map((tx) => `
                <tr>
                  <td>${tx.date}${tx.accountingMonth && tx.accountingMonth !== financialCycleMonth(tx.date) ? `<br><span class="muted">Mes resumen ${tx.accountingMonth}</span>` : ""}</td>
                  <td>${escapeHtml(tx.description)}${tx.notes ? `<br><span class="muted">${escapeHtml(tx.notes)}</span>` : ""}</td>
                  <td>${kindPill(tx.kind)}</td>
                  <td>${escapeHtml(tx.category || "")}</td>
                  <td>${escapeHtml([tx.bankName, tx.account].filter(Boolean).join(" - ") || "-")}</td>
                  <td class="amount ${tx.kind === "income" || tx.kind === "receivable_collection" ? "positive" : "negative"}">${tx.kind === "income" || tx.kind === "receivable_collection" ? signed(tx.amount) : money(tx.amount)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty">No hay movimientos en esta categoria durante ${activeMonth()}.</div>`}
    </div>
  `;
}

function renderKpiPanel() {
  const k = financialKpis(activeMonth());
  const kpis = [
    ["% gasto / ingreso", k.expenseRatio, kpiStatus(k.expenseRatio, .8, .95), `${Math.round(k.expenseRatio * 100)}%`],
    ["% ahorro mensual", k.savingsRate, kpiStatus(k.savingsRate, .15, .05, true), `${Math.round(k.savingsRate * 100)}%`],
    ["Flujo libre", k.freeFlow, k.freeFlow >= 0 ? "good" : "bad", money(k.freeFlow)],
    ["Deuda / ingreso", k.debtRatio, kpiStatus(k.debtRatio, .8, 1.5), `${Math.round(k.debtRatio * 100)}%`],
    ["Gastos hormiga", k.dist.micro, k.dist.micro <= k.finance.income * .05 ? "good" : "warn", money(k.dist.micro)],
  ];
  return `
    <section class="card panel kpi-panel">
      <div class="panel-head"><h2>Indicadores clave</h2><span class="muted">Verde bajo control - amarillo revisar - rojo urgente</span></div>
      <div class="kpi-grid">
        ${kpis.map(([label, value, status, display]) => `
          <div class="kpi-card ${status}">
            <span>${label}</span>
            <strong>${display}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderAvailablePanel() {
  const k = financialKpis(activeMonth());
  return `
    <section class="card panel available-panel">
      <div class="panel-head"><h2>Disponible real</h2><span class="muted">Saldo menos compromisos del mes</span></div>
      <div class="available-grid">
        <div><span>Saldo real estimado</span><strong>${money(k.finance.cashBalance)}</strong></div>
        <div><span>Pagos obligatorios</span><strong>-${money(k.mandatory)}</strong></div>
        <div><span>Ahorro comprometido</span><strong>-${money(k.committedSavings)}</strong></div>
        <div class="${k.availableReal >= 0 ? "good" : "bad"}"><span>Disponible para usar</span><strong>${money(k.availableReal)}</strong></div>
      </div>
    </section>
  `;
}

function renderPartnerDebtVisual() {
  const balances = partnerBalances()
    .filter((item) => item.partner.active !== false)
    .filter((item) => item.pending || item.payable || item.net);
  const details = state.receivables
    .filter((item) => item.partnerId && item.status === "pending")
    .filter((item) => state.partners.find((partner) => partner.id === item.partnerId)?.active !== false)
    .sort((a, b) => Math.abs(Number(b.amount || 0)) - Math.abs(Number(a.amount || 0)));
  if (!balances.length && !details.length) return "";
  const totalReceivable = balances.reduce((sum, item) => sum + item.pending, 0);
  const totalPayable = balances.reduce((sum, item) => sum + item.payable, 0);
  const net = totalReceivable - totalPayable;
  const totalMovement = Math.max(totalReceivable + totalPayable, 1);
  const receivablePct = Math.round(totalReceivable / totalMovement * 100);
  const payablePct = Math.round(totalPayable / totalMovement * 100);
  const max = Math.max(...balances.map((item) => Math.abs(item.net)), 1);
  return `
    <section class="card panel partner-visual-panel">
      <div class="panel-head">
        <div>
          <h2>Saldos con socios</h2>
          <p class="muted">${net >= 0 ? "Saldo a favor" : "Saldo en contra"} del total de repartos pendientes.</p>
        </div>
        <div class="partner-net ${net >= 0 ? "positive" : "negative"}">
          <span>${net >= 0 ? "Te deben" : "Les debes"}</span>
          <strong>${money(Math.abs(net))}</strong>
        </div>
      </div>
      <div class="partner-balance-chart">
        <div class="balance-chart-labels">
          <span>Me deben ${money(totalReceivable)}</span>
          <span>Les debo ${money(totalPayable)}</span>
        </div>
        <div class="balance-stack">
          <div class="balance-receivable" style="width:${receivablePct}%"></div>
          <div class="balance-payable" style="width:${payablePct}%"></div>
        </div>
        <div class="balance-axis">
          <span>A favor</span>
          <strong>${net >= 0 ? "+" : "-"}${money(Math.abs(net))}</strong>
          <span>En contra</span>
        </div>
      </div>
      <div class="partner-visual-grid">
        <div class="partner-bars">
          ${balances.map((item) => {
            const positive = item.net >= 0;
            const width = Math.max(6, Math.round(Math.abs(item.net) / max * 100));
            return `
              <div class="partner-bar-card ${positive ? "owed-to-me" : "owed-by-me"}">
                <div class="partner-bar-head">
                  <strong>${escapeHtml(item.partner.name)}</strong>
                  <span class="partner-status-chip">${positive ? "Me debe" : "Le debo"}</span>
                </div>
                <div class="partner-bar-visual">
                  <div class="partner-bar-track"><div style="width:${width}%"></div></div>
                  <strong>${money(Math.abs(item.net))}</strong>
                </div>
                <small>${item.movements} desglose(s) - cobrado ${money(item.collected)}</small>
              </div>
            `;
          }).join("")}
        </div>
        <div class="partner-debt-detail">
          <h3>Detalle de deudas</h3>
          ${details.length ? details.slice(0, 8).map((item) => {
            const partner = state.partners.find((p) => p.id === item.partnerId);
            const payable = item.direction === "i_owe_partner";
            return `
              <div class="debt-detail-row ${payable ? "payable" : "receivable"}">
                <span>${escapeHtml(partner?.name || item.from || "Socio")}</span>
                <strong>${payable ? "Le debo" : "Me debe"} ${money(item.amount)}</strong>
                <small>${escapeHtml(item.description)} - ${Number(item.sharePercent || 0)}%</small>
                <div class="debt-quick-actions">
                  <button class="primary-button mini-button" data-collect="${item.id}">${payable ? "Ya pagué" : "Ya canceló"}</button>
                  <button class="ghost-button mini-button" data-partial-collect="${item.id}">${payable ? "Aboné" : "Abonó"}</button>
                </div>
              </div>
            `;
          }).join("") : `<div class="empty">No hay deudas pendientes con socios.</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderPaymentCalendar() {
  const items = [
    ...state.recurringItems.filter((item) => item.active !== false).map((item) => ({
      date: item.startDate || activeMonthDate("01"),
      label: item.name,
      type: item.kind === "income" ? "Ingreso" : item.kind === "debt_payment" ? "Deuda" : "Pago fijo",
      amount: item.amount,
    })),
    ...state.debts.filter((debt) => debt.balance > 0).map((debt) => ({
      date: debt.dueDate || activeMonthDate("28"),
      label: debt.name,
      type: "Vencimiento deuda",
      amount: debt.balance,
    })),
    ...state.goals.filter((goal) => goal.type === "savings" && Number(goal.allocationPercent || 0) > 0).map((goal) => ({
      date: activeMonthDate("05"),
      label: goal.name,
      type: "Ahorro automatico",
      amount: savingsAllocationSummary().monthlySavingsPool * Number(goal.allocationPercent || 0) / 100,
    })),
  ].filter((item) => (item.accountingMonth || financialCycleMonth(item.date)) === activeMonth()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  if (!items.length) return "";
  return `
    <section class="card panel calendar-panel">
      <div class="panel-head"><h2>Calendario de pagos</h2><span class="muted">${activeMonth()}</span></div>
      <div class="calendar-list">
        ${items.map((item) => `
          <div class="calendar-item">
            <span>${item.date.slice(8, 10)}</span>
            <div><strong>${escapeHtml(item.label)}</strong><small>${item.type}</small></div>
            <strong>${money(item.amount)}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSavingsAllocation() {
  const summary = savingsAllocationSummary();
  if (!summary.rows.length) return "";
  const parts = summary.rows.map(({ goal, amount }, index) => ({
    label: goal.name,
    value: amount,
    color: ["#10b981", "#f59e0b", "#d946ef", "#06b6d4", "#ef4444"][index % 5],
  }));
  return `
    <section class="card panel distribution-panel colorful-panel">
      <div class="panel-head">
        <h2>Reparto de ahorros</h2>
        <span class="muted">${summary.allocatedPercent}% asignado - bolsa mensual ${money(summary.monthlySavingsPool)}</span>
      </div>
      <div class="donut-layout">
        <div class="donut-card">
          <div class="donut savings-donut" style="${donutStyle(parts)}"><div><strong>${money(summary.monthlySavingsPool)}</strong><span>Ahorro</span></div></div>
        </div>
        <div class="distribution-grid">
        ${summary.rows.map(({ goal, amount }, index) => `
          <div class="distribution-item">
            <span><i class="swatch" style="background:${parts[index].color}"></i>${escapeHtml(goal.name)} - prioridad ${goal.priority || "media"}</span>
            <strong>${money(amount)}</strong>
            <div class="bar-track"><div class="bar goal" style="width:${Math.max(4, Math.min(100, Number(goal.allocationPercent || 0)))}%"></div></div>
            <small class="muted">${Number(goal.allocationPercent || 0)}% - meta ${goal.targetMonth || monthKey(goal.deadline)}</small>
          </div>
        `).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderGoals() {
  const baseline = monthlyBaseline();
  return `
    <section class="grid metrics">
      <div class="card metric"><span>Ingreso promedio</span><strong>${money(baseline.income)}</strong><small>${baseline.monthsAnalyzed || 0} mes(es) analizados</small></div>
      <div class="card metric"><span>Gasto neto promedio</span><strong>${money(baseline.netRealExpense)}</strong><small>Base para ajustar metas</small></div>
      <div class="card metric"><span>Capacidad estimada</span><strong>${money(Math.max(0, baseline.income - baseline.netRealExpense - baseline.debtPayments))}</strong><small>Base: ${baseline.source === "recurrentes" ? "recurrentes" : "movimientos"}</small></div>
      <div class="card metric"><span>Pasivo abierto</span><strong>${money(baseline.outstandingDebt)}</strong><small>Deuda a priorizar</small></div>
    </section>
    <div class="toolbar">
      <button class="primary-button" data-modal="goal">+ Objetivo</button>
    </div>
    <section class="grid goal-grid">
      ${state.goals.length ? state.goals.map(renderGoalDetail).join("") : `<div class="card panel"><div class="empty">No hay objetivos. Agrega cuanto quieres ahorrar o que deuda quieres ordenar, con monto y fecha limite.</div></div>`}
    </section>
  `;
}

function renderRecurring() {
  const baseline = activeRecurringBaseline();
  return `
    <section class="grid metrics">
      <div class="card metric"><span>Ingreso fijo mensual</span><strong>${money(baseline.income)}</strong><small>Recurrentes activos</small></div>
      <div class="card metric"><span>Egreso fijo bruto</span><strong>${money(baseline.expenseGross || baseline.expense)}</strong><small>Antes de reparto</small></div>
      <div class="card metric"><span>Parte de socios</span><strong>${money(baseline.partnerRecovery || 0)}</strong><small>Recuperacion proyectada</small></div>
      <div class="card metric"><span>Base disponible</span><strong>${money(baseline.income - baseline.expense - baseline.debtPayments)}</strong><small>Despues de reparto</small></div>
    </section>
    <div class="toolbar">
      <button class="primary-button" data-modal="recurring">+ Recurrente</button>
    </div>
    <section class="grid two-col">
      <div class="card panel">
        <h2>Presupuesto base mensual</h2>
        ${state.recurringItems.length ? renderRecurringTable() : `<div class="empty">Agrega tu sueldo mensual y gastos que siempre se mantienen: arriendo, bencina base, luz, agua, internet, salud, etc.</div>`}
      </div>
      <div class="card panel">
        <h2>Historial de cambios</h2>
        ${renderRecurringHistory()}
      </div>
    </section>
  `;
}

function renderPartners() {
  const balances = partnerBalances().filter((item) => item.partner.active !== false);
  const totalPending = balances.reduce((sum, item) => sum + item.pending, 0);
  const totalCollected = balances.reduce((sum, item) => sum + item.collected, 0);
  const activePartners = state.partners.filter((p) => p.active !== false);
  const deletedPartners = state.partners.filter((p) => p.active === false);
  return `
    <section class="grid metrics">
      <div class="card metric"><span>Socios activos</span><strong>${activePartners.length}</strong><small>Para repartir gastos</small></div>
      <div class="card metric"><span>Te deben</span><strong>${money(totalPending)}</strong><small>Saldo pendiente</small></div>
      <div class="card metric"><span>Cobrado a socios</span><strong>${money(totalCollected)}</strong><small>Reembolso real</small></div>
      <div class="card metric"><span>Regla neta</span><strong>Bruto != neto</strong><small>Se descuenta al cobrar</small></div>
    </section>
    <div class="toolbar">
      <button class="primary-button" data-modal="partner">+ Socio</button>
    </div>
    <section class="grid two-col">
      <div class="card panel">
        <div class="panel-head"><h2>Anadir socio</h2>${deletedPartners.length ? `<button class="tool-button" data-toggle-deleted-partners>Historial de socios eliminados</button>` : ""}</div>
        ${activePartners.length ? renderPartnersTable(activePartners) : `<div class="empty">Agrega un socio y define que porcentaje suele pagar en gastos compartidos.</div>`}
        ${deletedPartners.length ? renderDeletedPartners(deletedPartners) : ""}
      </div>
      <div class="card panel">
        <h2>Saldo por socio</h2>
        ${renderPartnerBalanceTable(balances)}
      </div>
    </section>
  `;
}

function renderPurchaseCalendar() {
  const purchases = filterMovementsByFlow(currentMonthTransactions())
    .filter((tx) => ["cash_expense", "card_purchase", "debt_payment"].includes(tx.kind))
    .sort((a, b) => a.date.localeCompare(b.date));
  const days = {};
  purchases.forEach((tx) => {
    const key = tx.date;
    days[key] ||= [];
    days[key].push(tx);
  });
  const dayEntries = Object.entries(days);
  const monthTotal = purchases.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  return `
    <section class="card panel">
      <div class="panel-head">
        <div>
          <h2>Calendario diario</h2>
          <p class="muted">Compras y pagos registrados durante ${activeMonth()}.</p>
        </div>
        <strong>${purchases.length} movimientos - ${money(monthTotal)}</strong>
      </div>
      ${renderMovementFlowFilter()}
      ${dayEntries.length ? `
        <div class="purchase-calendar">
          ${dayEntries.map(([date, rows]) => {
            const total = rows.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
            return `
              <article class="purchase-day">
                <div class="purchase-day-head">
                  <strong>${date}</strong>
                  <span>${rows.length} movimiento(s) - ${money(total)}</span>
                </div>
                <div class="purchase-list">
                  ${rows.map((tx) => `
                    <div class="purchase-row">
                      <div>
                        <strong>${escapeHtml(tx.description)}</strong>
                        <span>${kindPill(tx.kind)} ${distributionPill(tx.distribution || inferDistribution(tx))}</span>
                      </div>
                      <div class="purchase-card-meta">${escapeHtml([tx.bankName, tx.account, tx.debtName].filter(Boolean).join(" - ") || "Caja / manual")}</div>
                      <strong class="amount ${tx.kind === "income" ? "positive" : "negative"}">${money(tx.amount)}</strong>
                    </div>
                  `).join("")}
                </div>
              </article>
            `;
          }).join("")}
        </div>
      ` : `<div class="empty">No hay compras o pagos registrados en ${activeMonth()} para este filtro.</div>`}
    </section>
  `;
}

function projectionTypeFor(tx) {
  state.ui ||= {};
  state.ui.projectionTypes ||= {};
  if (state.ui.projectionTypes[tx.id]) return state.ui.projectionTypes[tx.id];
  if (tx.kind === "income") return "permanent";
  if (installmentInfo(tx)) return "permanent";
  if (["debt_payment", "receivable_collection"].includes(tx.kind)) return "passenger";
  return inferDistribution(tx) === "fixed" ? "permanent" : "passenger";
}

function projectionDetailFor(tx) {
  state.ui ||= {};
  state.ui.projectionDetails ||= {};
  if (state.ui.projectionDetails[tx.id]) return state.ui.projectionDetails[tx.id];
  return inferProjectionDetail(tx);
}

function inferProjectionDetail(tx) {
  const text = [tx.description, tx.category, tx.notes, tx.account, tx.bankName].filter(Boolean).join(" ").toLowerCase();
  const kind = tx.kind || "";
  if (kind === "income") {
    if (/extra|honorario|venta|bono|freelance|pituto|tef|transferencia recibida/.test(text)) return "income_extra";
    return "income_salary";
  }
  if (["debt_payment"].includes(kind) || /pago credito|pago tarjeta|credito|deuda|cuota|avance/.test(text)) return "debt";
  if (/comision|interes|impuesto|mantencion mensual|administracion/.test(text)) return "fees";
  if (/arriendo|dividendo|hipotec|vivienda/.test(text)) return "housing";
  if (/luz|agua|gas|internet|telefon|celular|wom|entel|movistar|claro|mundo|vtr/.test(text)) return "utilities";
  if (/super|lider|jumbo|unimarc|tottus|mayorista|minimarket|almacen|feria/.test(text)) return "supermarket";
  if (/restaurant|restobar|bar|pub|cafe|cafeteria|sushi|pizza|burger|comida|delivery|uber eats|pedidosya|rappi/.test(text)) return "eating_out";
  if (/bencina|copec|shell|petrobras|combustible/.test(text)) return "fuel";
  if (/uber|cabify|metro|bus|bip|transporte|taxi/.test(text)) return "transport";
  if (/tag|autopista|revision|permiso|mecanico|neumatico|auto|vehiculo|mantencion/.test(text)) return "car";
  if (/farmacia|medic|clinica|doctor|salud|isapre|fonasa/.test(text)) return "health";
  if (/colegio|universidad|curso|educacion|matricula/.test(text)) return "education";
  if (/netflix|spotify|disney|prime|hbo|youtube|suscripcion|patreon|icloud|google storage/.test(text)) return "subscriptions";
  if (/ropa|falabella|ripley|paris|zara|shein|calzado/.test(text)) return "clothing";
  if (/cine|juego|steam|playstation|salida|ocio|entretencion|evento|ticket/.test(text)) return "leisure";
  if (/ahorro|inversion|fondo|deposito/.test(text)) return "savings";
  if (/socio|reembolso|cobranza|transferencia/.test(text)) return "partner";
  if (/pan|cafe|snack|minimarket|kiosko/.test(text)) return "food";
  return "other";
}

function projectionDetailOptionsHtml(selected) {
  return projectionDetailOptions
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function installmentInfo(tx) {
  const text = [tx.description, tx.notes].filter(Boolean).join(" ");
  const match = text.match(/(?:cuota\s*)?(\d{1,3})\s*\/\s*(\d{1,3})/i);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!current || !total || total < current) return null;
  return { current, total, remaining: Math.max(0, total - current) };
}

function projectionRowsForMonth() {
  return currentMonthTransactions()
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

function projectedYearSeries() {
  const rows = projectionRowsForMonth();
  return Array.from({ length: 12 }, (_, index) => {
    const month = addMonthsToKey(activeMonth(), index + 1);
    let income = 0;
    let expense = 0;
    rows.forEach((tx) => {
      const type = projectionTypeFor(tx);
      const quota = installmentInfo(tx);
      const applies = quota ? index < quota.remaining : type === "permanent";
      if (!applies) return;
      if (["income", "receivable_collection"].includes(tx.kind)) income += Number(tx.amount || 0);
      else expense += Number(tx.amount || 0);
    });
    return {
      month,
      label: monthLabel(month),
      income,
      expense,
      balance: income - expense,
    };
  });
}

function renderNextMonthProjection() {
  const rows = projectionRowsForMonth();
  const series = projectedYearSeries();
  const next = series[0] || { income: 0, expense: 0, balance: 0 };
  return `
    <section class="grid metrics">
      <div class="card metric"><span>Mes base</span><strong>${activeMonth()}</strong><small>${rows.length} transacciones a clasificar</small></div>
      <div class="card metric"><span>Ingreso próximo mes</span><strong>${money(next.income)}</strong><small>Solo permanentes o cuotas vigentes</small></div>
      <div class="card metric"><span>Egreso próximo mes</span><strong>${money(next.expense)}</strong><small>Obligatorios + cuotas restantes</small></div>
      <div class="card metric"><span>Saldo proyectado</span><strong>${money(next.balance)}</strong><small>Ingreso menos egreso</small></div>
    </section>
    <section class="grid two-col">
      <div class="card panel">
        <div class="panel-head">
          <div>
            <h2>Clasificar transacciones</h2>
            <p class="muted">Marca cada movimiento como permanente/obligatorio o pasajero, y agrega un detalle para entender mejor el gasto. Las cuotas se proyectan solo por las cuotas restantes.</p>
          </div>
          <button class="primary-button" data-action="save-projection">Finalizar categorizacion</button>
        </div>
        ${rows.length ? `
          <div class="projection-classifier">
            ${rows.map((tx) => {
              const quota = installmentInfo(tx);
              const canShare = ["cash_expense", "card_purchase"].includes(tx.kind);
              const shareCount = normalizedSplits(tx).length;
              return `
                <div class="projection-row">
                  <div>
                    <strong>${escapeHtml(tx.description)}</strong>
                    <span>${tx.date} · ${kindPill(tx.kind)} ${distributionPill(tx.distribution || inferDistribution(tx))}</span>
                    <small>${escapeHtml([tx.bankName, tx.account, quota ? `Cuotas restantes ${quota.remaining}/${quota.total}` : ""].filter(Boolean).join(" · "))}</small>
                    ${shareCount ? `<div class="projection-share-label">${renderShareLabel(tx)}</div>` : ""}
                  </div>
                  <strong>${money(tx.amount)}</strong>
                  <div class="projection-controls">
                    <label><span>Comportamiento</span><select data-projection-type="${tx.id}">
                      <option value="permanent" ${projectionTypeFor(tx) === "permanent" ? "selected" : ""}>Permanente / obligatoria</option>
                      <option value="passenger" ${projectionTypeFor(tx) === "passenger" ? "selected" : ""}>Pasajera</option>
                    </select></label>
                    <label><span>Detalle</span><select data-projection-detail="${tx.id}">
                      ${projectionDetailOptionsHtml(projectionDetailFor(tx))}
                    </select></label>
                    ${canShare ? `<button class="ghost-button mini-button projection-share-button" data-share-tx="${tx.id}">${shareCount ? "Editar socios" : "+ Socio"}</button>` : ""}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        ` : `<div class="empty">No hay transacciones en ${activeMonth()} para proyectar.</div>`}
      </div>
      <div class="card panel">
        <h2>Proyeccion anual</h2>
        ${renderProjectionBars(series)}
      </div>
    </section>
  `;
}

function renderProjectionBars(series) {
  const max = Math.max(...series.flatMap((item) => [item.income, item.expense, Math.abs(item.balance)]), 1);
  return `
    <div class="projection-year-chart">
      ${series.map((item) => `
        <div class="projection-month">
          <div class="projection-bars">
            <span class="month-bar income" title="Ingreso ${money(item.income)}" style="height:${Math.max(4, Math.round(item.income / max * 100))}%"></span>
            <span class="month-bar expense" title="Egreso ${money(item.expense)}" style="height:${Math.max(4, Math.round(item.expense / max * 100))}%"></span>
          </div>
          <strong>${item.label}</strong>
          <small class="${item.balance >= 0 ? "positive" : "negative"}">${money(item.balance)}</small>
        </div>
      `).join("")}
    </div>
    <div class="legend">
      <span><i class="swatch income"></i>Ingresos</span>
      <span><i class="swatch expense"></i>Egresos</span>
    </div>
  `;
}

function renderHistory() {
  const series = monthlySeries();
  const actual = series.filter((item) => item.source === "actual");
  const projected = series.filter((item) => item.source === "projected");
  const totals = actual.reduce((acc, item) => {
    acc.income += item.income;
    acc.expense += item.netRealExpense;
    acc.cash += item.cashBalance;
    return acc;
  }, { income: 0, expense: 0, cash: 0 });
  const avgIncome = actual.length ? totals.income / actual.length : 0;
  const avgExpense = actual.length ? totals.expense / actual.length : 0;
  const avgCash = actual.length ? totals.cash / actual.length : 0;
  return `
    <section class="grid metrics">
      <div class="card metric"><span>Ingreso promedio</span><strong>${money(avgIncome)}</strong><small>${actual.length} meses reales</small></div>
      <div class="card metric"><span>Egreso neto promedio</span><strong>${money(avgExpense)}</strong><small>Despues de cobros reales</small></div>
      <div class="card metric"><span>Flujo promedio</span><strong>${money(avgCash)}</strong><small>Ingreso menos caja salida</small></div>
      <div class="card metric"><span>Proyeccion</span><strong>${projected.length} meses</strong><small>Base recurrente/promedio</small></div>
    </section>
    <section class="card panel history-panel">
      <div class="panel-head">
        <h2>Comparativo mensual</h2>
        <span class="muted">Real hasta ${monthKey()} - proyeccion estable hacia adelante</span>
      </div>
      ${renderMonthlyBars(series)}
    </section>
    <section class="grid two-col">
      <div class="card panel">
        <h2>Tendencia de flujo</h2>
        ${renderCashLine(series)}
      </div>
      <div class="card panel">
        <h2>Lectura rapida</h2>
        ${renderHistoryInsights(series)}
      </div>
    </section>
  `;
}

function renderMonthlyBars(series) {
  const max = Math.max(...series.flatMap((item) => [item.income, item.netRealExpense, item.projectedExpense]), 1);
  return `
    <div class="monthly-chart">
      ${series.map((item) => `
        <div class="month-group ${item.source}">
          <div class="month-bars">
            <span class="month-bar income" title="Ingreso ${money(item.income)}" style="height:${Math.max(3, Math.round(item.income / max * 100))}%"></span>
            <span class="month-bar expense" title="Egreso neto ${money(item.netRealExpense)}" style="height:${Math.max(3, Math.round(item.netRealExpense / max * 100))}%"></span>
            <span class="month-bar projection" title="Proyeccion ${money(item.projectedExpense)}" style="height:${Math.max(3, Math.round(item.projectedExpense / max * 100))}%"></span>
          </div>
          <strong>${item.label}</strong>
          <small>${item.source === "projected" ? "Proy." : money(item.cashBalance)}</small>
        </div>
      `).join("")}
    </div>
    <div class="legend">
      <span><i class="swatch income"></i>Ingreso</span>
      <span><i class="swatch expense"></i>Egreso neto</span>
      <span><i class="swatch projection"></i>Base proyectada estable</span>
    </div>
  `;
}

function renderCashLine(series) {
  const width = 680;
  const height = 220;
  const pad = 26;
  const values = series.map((item) => item.cashBalance);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, values.length - 1);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const zeroY = height - pad - ((0 - min) / range) * (height - pad * 2);
  return `
    <div class="line-chart-wrap">
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia de flujo mensual">
        <line x1="${pad}" x2="${width - pad}" y1="${zeroY}" y2="${zeroY}" class="zero-line"></line>
        <polyline points="${points}" class="cash-line"></polyline>
        ${series.map((item, index) => {
          const [x, y] = points.split(" ")[index].split(",");
          return `<circle cx="${x}" cy="${y}" r="4" class="${item.source === "projected" ? "projected-dot" : "actual-dot"}"><title>${item.label}: ${money(item.cashBalance)}</title></circle>`;
        }).join("")}
      </svg>
    </div>
  `;
}

function renderHistoryInsights(series) {
  const current = series.find((item) => item.month === monthKey()) || series[series.length - 1];
  const previous = series[series.indexOf(current) - 1];
  const insights = [];
  if (previous) {
    const expenseDelta = current.netRealExpense - previous.netRealExpense;
    insights.push([
      expenseDelta > 0 ? "Egreso subiendo" : "Egreso contenido",
      expenseDelta > 0 ? `Subio ${money(expenseDelta)} versus el mes anterior.` : `Bajo o se mantuvo frente al mes anterior.`
    ]);
    const incomeDelta = current.income - previous.income;
    insights.push([
      incomeDelta >= 0 ? "Ingreso estable" : "Ingreso bajando",
      incomeDelta >= 0 ? `Ingreso igual o mejor que el mes anterior.` : `Ingreso bajo ${money(Math.abs(incomeDelta))}.`
    ]);
  }
  const next = series.find((item) => item.source === "projected");
  if (next) insights.push(["Proyeccion siguiente", `Con la base actual, el flujo esperado es ${money(next.projectedCash)}.`]);
  if (current.cashBalance < 0) insights.push(["Flujo negativo", "Revisa gastos variables, cobranzas pendientes y uso de tarjeta."]);
  if (!insights.length) insights.push(["Sin suficiente historia", "Registra movimientos o cierres mensuales para enriquecer el grafico."]);
  return insights.map(([title, body]) => `<div class="diagnostic"><strong>${title}</strong><p>${body}</p></div>`).join("");
}

function renderPartnersTable(partners = state.partners.filter((p) => p.active !== false)) {
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Notas</th><th>Acciones</th></tr></thead>
      <tbody>${partners.map((partner) => {
        return `
          <tr>
            <td>${escapeHtml(partner.name)}</td>
            <td>${escapeHtml(partner.notes || "")}</td>
            <td><button class="tool-button" data-edit-partner="${partner.id}">Editar</button> <button class="danger-button" data-disable-partner="${partner.id}">Eliminar</button></td>
          </tr>
        `;
      }).join("")}</tbody>
    </table></div>
  `;
}

function renderDeletedPartners(partners) {
  if (!state.ui?.showDeletedPartners) return "";
  return `
    <div class="deleted-partners">
      <h3>Historial de socios eliminados</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Eliminado</th><th>Notas</th></tr></thead>
        <tbody>${partners.map((partner) => `
          <tr>
            <td>${escapeHtml(partner.name)}</td>
            <td>${escapeHtml(partner.deletedAt || "Sin fecha")}</td>
            <td>${escapeHtml(partner.notes || "")}</td>
          </tr>
        `).join("")}</tbody>
      </table></div>
    </div>
  `;
}

function renderPartnerReceivables() {
  const items = state.receivables.filter((r) => r.partnerId).sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) return `<div class="empty">Los gastos compartidos crearan cobranzas automaticas aqui.</div>`;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Socio</th><th>Descripcion</th><th>%</th><th>Monto</th><th>Estado</th></tr></thead>
      <tbody>${items.map((r) => `
        <tr>
          <td>${r.date}</td>
          <td>${escapeHtml(r.from)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${Number(r.sharePercent || 0)}%</td>
          <td>${r.direction === "i_owe_partner" ? "Le debo" : "Me debe"}</td>
          <td>${money(r.amount)}</td>
          <td><span class="pill ${r.status === "collected" ? "good" : "warn"}">${r.status === "collected" ? "Cobrado" : "Pendiente"}</span></td>
        </tr>
      `).join("")}</tbody>
    </table></div>
  `;
}

function partnerBalances() {
  return state.partners.map((partner) => {
    const related = state.receivables.filter((r) => r.partnerId === partner.id);
    const pendingReceivable = related.filter((r) => r.status === "pending" && r.direction !== "i_owe_partner").reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const pendingPayable = related.filter((r) => r.status === "pending" && r.direction === "i_owe_partner").reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const collected = related.reduce((sum, r) => sum + Number(r.collectedAmount || (r.status === "collected" ? r.amount : 0) || 0), 0);
    const movements = state.transactions.filter((tx) => normalizedSplits(tx).some((split) => split.partnerId === partner.id) || tx.partnerId === partner.id).length + state.recurringItems.filter((item) => item.partnerId === partner.id).length;
    return { partner, pending: pendingReceivable, payable: pendingPayable, collected, movements, net: pendingReceivable - pendingPayable };
  });
}

function renderPartnerBalanceTable(items) {
  if (!items.length) return `<div class="empty">Aun no hay socios. Agrega uno para ver saldos.</div>`;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Socio</th><th>Me debe</th><th>Le debo</th><th>Neto</th><th>Desgloses</th><th>Estado</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td>${escapeHtml(item.partner.name)}</td>
          <td>${money(item.pending)}</td>
          <td>${money(item.payable)}</td>
          <td>${money(item.net)}</td>
          <td>${item.movements}</td>
          <td><span class="pill ${item.net === 0 ? "good" : "warn"}">${item.net > 0 ? "Me debe" : item.net < 0 ? "Le debo" : "Al dia"}</span></td>
        </tr>
      `).join("")}</tbody>
    </table></div>
    ${renderPartnerReceivables()}
  `;
}

function renderRecurringTable() {
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Tipo</th><th>Categoria</th><th>Monto mensual</th><th>Vigente desde</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${state.recurringItems.map((item) => `
        <tr>
          <td>${escapeHtml(item.name)}<br><span class="muted">${escapeHtml(item.notes || "")}</span><br>${distributionPill(item.distribution || inferDistribution(item))} ${renderShareLabel(item)}</td>
          <td>${recurringKindPill(item.kind)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${money(item.amount)}</td>
          <td>${item.startDate || "-"}</td>
          <td><span class="pill ${item.active !== false ? "good" : "warn"}">${item.active !== false ? "Activo" : "Inactivo"}</span></td>
          <td><button class="tool-button" data-edit-recurring="${item.id}">Editar</button> <button class="danger-button" data-delete-recurring="${item.id}">Eliminar</button></td>
        </tr>
      `).join("")}</tbody>
    </table></div>
  `;
}

function recurringKindPill(kind) {
  const map = {
    income: ["Ingreso fijo", "good"],
    expense: ["Egreso fijo", "cash"],
    debt_payment: ["Pago deuda", "debt"],
  };
  const [label, cls] = map[kind] || [kind, ""];
  return `<span class="pill ${cls}">${label}</span>`;
}

function renderRecurringHistory() {
  const entries = state.recurringItems
    .flatMap((item) => (item.history || []).map((entry) => ({ ...entry, itemName: item.name })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);
  if (!entries.length) return `<div class="empty">Los cambios de recurrentes quedaran registrados aqui.</div>`;
  return `<div class="history-list">${entries.map((entry) => `
    <div class="history-item">
      <strong>${escapeHtml(entry.itemName)}</strong>
      <span class="muted">${new Date(entry.at).toLocaleString("es-CL")} - ${historyActionLabel(entry.action)}</span>
      <p>${historyDescription(entry)}</p>
    </div>
  `).join("")}</div>`;
}

function historyActionLabel(action) {
  return { created: "creado", updated: "editado", deactivated: "desactivado" }[action] || action;
}

function historyDescription(entry) {
  if (entry.action === "created") return `Monto inicial ${money(entry.snapshot.amount)} en ${entry.snapshot.category}.`;
  if (entry.action === "deactivated") return `Quedo inactivo; se conserva para trazabilidad.`;
  const before = entry.before || {};
  const after = entry.after || {};
  const changes = [];
  if (before.amount !== after.amount) changes.push(`monto ${money(before.amount)} -> ${money(after.amount)}`);
  if (before.category !== after.category) changes.push(`categoria ${before.category} -> ${after.category}`);
  if (before.kind !== after.kind) changes.push(`tipo ${before.kind} -> ${after.kind}`);
  if (before.active !== after.active) changes.push(`estado ${before.active ? "activo" : "inactivo"} -> ${after.active ? "activo" : "inactivo"}`);
  if (before.startDate !== after.startDate) changes.push(`vigencia ${before.startDate} -> ${after.startDate}`);
  return changes.length ? changes.join("; ") : "Se actualizaron notas u otros datos.";
}

function renderGoalSummary(goal) {
  const a = goalAnalysis(goal);
  return `
    <div class="goal-summary">
      <div>
        <strong>${escapeHtml(goal.name)}</strong>
        <span class="muted">${goal.type === "debt" ? "Puesta al dia" : "Ahorro"} - ${a.months} mes(es)</span>
      </div>
      <div class="progress"><div style="width:${Math.round(a.progress * 100)}%"></div></div>
      <strong>${money(a.monthlyNeed)}/mes</strong>
    </div>
  `;
}

function renderGoalDetail(goal) {
  const a = goalAnalysis(goal);
  const colorClass = a.feasible ? "good" : "warn";
  const progressPct = Math.round(a.progress * 100);
  return `
    <article class="card panel goal-card">
      <div class="goal-head">
        <div>
          <h2>${escapeHtml(goal.name)}</h2>
          <p class="muted">${goal.type === "debt" ? "Puesta al dia" : "Ahorro"} · meta ${money(goal.targetAmount)} · ${goal.targetMonth || monthKey(goal.deadline)}</p>
        </div>
        <span class="pill ${colorClass}">${a.feasible ? "Alcanzable" : "Ajuste necesario"}</span>
      </div>
      <div class="goal-meta-row">
        <span>Prioridad ${goal.priority || "media"}</span>
        <strong>${progressPct}%</strong>
      </div>
      <div class="progress large"><div style="width:${progressPct}%"></div></div>
      <div class="goal-summary-grid">
        <div><span>Actual</span><strong>${money(Number(goal.currentAmount || 0))}</strong></div>
        <div><span>Falta</span><strong>${money(a.gap)}</strong></div>
        <div><span>Aporte necesario</span><strong>${money(a.monthlyNeed)}/mes</strong></div>
      </div>
      <p class="muted goal-action-text">${a.primaryAction}</p>
      <div class="goal-actions">
        <details class="goal-detail-drawer">
          <summary>Ver detalle</summary>
          ${renderGoalProjection(goal, a)}
          <div class="adjustments">
            <h3>Ajustes sugeridos</h3>
            ${a.recommendedCuts.map((item) => `
              <div class="adjustment">
                <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
                <span>${item.amount ? money(item.amount) : "OK"}</span>
              </div>
            `).join("")}
          </div>
        </details>
        <div class="actions">
          <button class="tool-button" data-edit-goal="${goal.id}">Editar</button>
          <button class="danger-button" data-delete-goal="${goal.id}">Eliminar</button>
        </div>
      </div>
    </article>
  `;
}

function renderGoalProjection(goal, analysis) {
  const series = goalProjectionSeries(goal, analysis);
  const isDebt = goal.type === "debt";
  const values = series.map((item) => item.value);
  const target = isDebt ? 0 : Number(goal.targetAmount || 0);
  const title = isDebt ? "Proyeccion de deuda" : "Proyeccion de ahorro";
  const subtitle = isDebt
    ? `Si pagas ${money(analysis.feasible ? analysis.monthlyNeed : analysis.monthlySurplus)} al mes, la deuda baja asi.`
    : `Si separas ${money(analysis.feasible ? analysis.monthlyNeed : analysis.monthlySurplus)} al mes, el ahorro sube asi.`;
  return `
    <div class="goal-projection">
      <div class="panel-head">
        <h3>${title}</h3>
        <span class="muted">${subtitle}</span>
      </div>
      ${renderGoalLine(series, { isDebt, target })}
      <div class="goal-milestones">
        ${series.filter((_, index) => index === 0 || index === series.length - 1 || index === Math.floor(series.length / 2)).map((item) => `
          <div>
            <span>${item.label}</span>
            <strong>${money(item.value)}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderGoalLine(series, options) {
  const width = 680;
  const height = 210;
  const pad = 28;
  const values = series.map((item) => item.value);
  const max = Math.max(...values, options.target || 0, 1);
  const min = Math.min(...values, options.target || 0, 0);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = pad + (index * (width - pad * 2)) / Math.max(1, values.length - 1);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const targetY = height - pad - (((options.target || 0) - min) / range) * (height - pad * 2);
  return `
    <div class="line-chart-wrap">
      <svg class="line-chart goal-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${options.isDebt ? "Disminucion de deuda" : "Aumento de ahorro"}">
        <line x1="${pad}" x2="${width - pad}" y1="${targetY}" y2="${targetY}" class="target-line"></line>
        <polyline points="${points.join(" ")}" class="${options.isDebt ? "debt-goal-line" : "saving-goal-line"}"></polyline>
        ${points.map((point, index) => {
          const [x, y] = point.split(",");
          return `<circle cx="${x}" cy="${y}" r="4" class="${options.isDebt ? "debt-dot" : "saving-dot"}"><title>${series[index].label}: ${money(series[index].value)}</title></circle>`;
        }).join("")}
      </svg>
    </div>
  `;
}

function renderTransactions() {
  const rows = filterMovementsByFlow(state.transactions.filter((tx) => txMonth(tx) === activeMonth()))
    .sort((a, b) => b.date.localeCompare(a.date));
  return `
    <div class="toolbar">
      <button class="primary-button" data-modal="transaction">+ Agregar</button>
      <button class="ghost-button" data-modal="incomeExtra">+ Ingreso extra</button>
      ${renderMovementFlowFilter()}
    </div>
    <div class="card panel">
      <div class="panel-head">
        <h2>Registro contable</h2>
        <span class="muted">${activeMonth()}</span>
      </div>
      ${rows.length ? renderTxTable(rows, true) : `<div class="empty">No hay movimientos para este filtro.</div>`}
    </div>
  `;
}

function renderTxTable(txs, editable = false) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Descripcion</th><th>Tipo financiero</th><th>Categoria</th><th>Monto</th>${editable ? "<th>Acciones</th>" : ""}</tr></thead>
        <tbody>
          ${txs.map((tx) => `
            <tr>
              <td>${tx.date}${tx.accountingMonth && tx.accountingMonth !== financialCycleMonth(tx.date) ? `<br><span class="muted">Mes resumen ${tx.accountingMonth}</span>` : ""}</td>
              <td>${escapeHtml(tx.description)}<br><span class="muted">${escapeHtml([tx.bankName, tx.account, tx.notes || tx.source].filter(Boolean).join(" - "))}</span><br>${distributionPill(tx.distribution || inferDistribution(tx))} ${renderShareLabel(tx)}</td>
              <td>${kindPill(tx.kind)}</td>
              <td>${escapeHtml(tx.category)}</td>
              <td class="amount ${tx.kind === "income" || tx.kind === "receivable_collection" ? "positive" : "negative"}">${tx.kind === "income" || tx.kind === "receivable_collection" ? signed(tx.amount) : money(tx.amount)}</td>
              ${editable ? `<td>${renderTxActions(tx)}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTxActions(tx) {
  const canShare = ["cash_expense", "card_purchase"].includes(tx.kind);
  return `
    <button class="tool-button" data-edit-tx="${tx.id}">Editar</button>
    ${canShare ? `<button class="tool-button" data-share-tx="${tx.id}">${tx.partnerId ? "Editar socio" : "Añadir socio"}</button>` : ""}
    <button class="danger-button" data-delete-tx="${tx.id}">Eliminar</button>
  `;
}

function kindPill(kind) {
  const map = {
    income: ["Ingreso", "good"],
    cash_expense: ["Gasto caja", "cash"],
    card_purchase: ["Consumo tarjeta", "consumption"],
    debt_payment: ["Pago de deuda", "debt"],
    receivable_collection: ["Cobro", "good"],
  };
  const [label, cls] = map[kind] || [kind, ""];
  return `<span class="pill ${cls}">${label}</span>`;
}

function distributionOptions(selected) {
  return Object.entries(distributionGroups)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function distributionPill(value) {
  const group = value || "wants";
  const cls = group === "fixed" ? "cash" : group === "savings" ? "good" : "warn";
  return `<span class="pill ${cls}">${distributionGroups[group] || "Gustos"}</span>`;
}

function percentOf(value, total) {
  if (!total) return 0;
  return Math.round((Number(value || 0) / total) * 100);
}

function donutStyle(parts) {
  const colors = ["#2563eb", "#f59e0b", "#10b981", "#d946ef", "#ef4444", "#06b6d4"];
  const total = parts.reduce((sum, part) => sum + Number(part.value || 0), 0);
  if (!total) return "background: conic-gradient(#d7e5f8 0 100%);";
  let cursor = 0;
  const stops = parts.map((part, index) => {
    const start = cursor;
    const end = cursor + (Number(part.value || 0) / total) * 100;
    cursor = end;
    return `${part.color || colors[index % colors.length]} ${start}% ${end}%`;
  });
  return `background: conic-gradient(${stops.join(", ")});`;
}

function renderShareLabel(item) {
  const splits = normalizedSplits(item);
  if (!splits.length) return `<span class="muted">Propio</span>`;
  return splits.map((split) => {
    const partner = state.partners.find((p) => p.id === split.partnerId);
    return `<span class="pill consumption">${escapeHtml(partner?.name || "Socio")} ${Number(split.percent || 0)}%</span>`;
  }).join(" ");
}

function renderDebts() {
  const openDebts = state.debts.filter((d) => d.balance > 0);
  const avalanche = openDebts.slice().sort((a, b) => Number(b.interestRate || 0) - Number(a.interestRate || 0))[0];
  const snowball = openDebts.slice().sort((a, b) => Number(a.balance || 0) - Number(b.balance || 0))[0];
  return `
    <div class="toolbar">
      <button class="primary-button" data-modal="card">TC Compra tarjeta</button>
      <button class="ghost-button" data-modal="debt">+ Nueva deuda/cuota</button>
      <button class="ghost-button" data-modal="payment">$ Pagar deuda</button>
    </div>
    <div class="card panel">
      <h2>Pasivos abiertos</h2>
      ${(avalanche || snowball) ? `<div class="diagnostic"><strong>Estrategia sugerida</strong><p>Avalancha: prioriza ${escapeHtml(avalanche?.name || "-")} por tasa. Bola de nieve: prioriza ${escapeHtml(snowball?.name || "-")} por saldo pequeno.</p></div>` : ""}
      ${state.debts.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Saldo</th><th>Cuota</th><th>Tasa/CAE</th><th>Metodo</th><th>Vence</th></tr></thead>
          <tbody>${state.debts.map((d) => `
            <tr>
              <td>${escapeHtml(d.name)}</td>
              <td>${d.type === "credit_card" ? "Tarjeta de credito" : "Cuota/deuda"}</td>
              <td>${money(d.balance)}</td>
              <td>${money(d.monthlyPayment || 0)}</td>
              <td>${Number(d.interestRate || 0)}%</td>
              <td>${d.paymentMethod === "snowball" ? "Bola de nieve" : "Avalancha"}</td>
              <td>${d.dueDate || "-"}</td>
            </tr>`).join("")}</tbody>
        </table></div>
      ` : `<div class="empty">No hay deudas. Una compra con tarjeta creara o aumentara un pasivo, no un segundo gasto.</div>`}
    </div>
  `;
}

function renderReceivables() {
  return `
    <div class="toolbar"><button class="primary-button" data-modal="receivable">+ Cobranza</button></div>
    <div class="card panel">
      <h2>Cobranzas, splits y reembolsos</h2>
      ${state.receivables.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Descripcion</th><th>De</th><th>Estado</th><th>Monto</th><th>Accion</th></tr></thead>
          <tbody>${state.receivables.map((r) => `
            <tr>
              <td>${r.date}</td><td>${escapeHtml(r.description)}</td><td>${escapeHtml(r.from)}</td>
              <td><span class="pill ${r.status === "collected" ? "good" : "warn"}">${r.status === "collected" ? "Cobrado" : "Pendiente"}</span></td>
              <td>${money(r.amount)}</td>
              <td>${r.status === "pending" ? `<button class="primary-button" data-collect="${r.id}">Marcar cobro real</button>` : r.collectedDate}</td>
            </tr>`).join("")}</tbody>
        </table></div>
      ` : `<div class="empty">No hay cobranzas pendientes.</div>`}
    </div>
  `;
}

function renderImport() {
  const approvedImportCount = state.importCandidates.filter((c) => c.approved && !c.duplicate).length;
  const duplicateImportCount = state.importCandidates.filter((c) => c.duplicate).length;
  const monthSummary = importMonthSummary();
  return `
    <section class="grid two-col">
      <div class="card panel">
        <h2>Importar CSV o texto</h2>
        <p class="muted">Formato: fecha, descripcion, monto, tipo, categoria. El monto puede venir como $2.223, 2223, 2.223 o $2223; la app lo normaliza a CLP. El mes financiero usa ciclo 26-25: ${financialCycleRangeLabel()}.</p>
        <div class="import-template-box">
          <div>
            <strong>Archivo Excel modelo</strong>
            <p class="muted">Descarga la plantilla Excel vacia, completala por columnas y subela aqui. Los montos pueden incluir $, puntos de miles o venir sin formato. Los socios se agregan despues dentro de la app. Para cuotas usa cuota_actual/cuotas_totales o detalle_cuota, por ejemplo 1/3.</p>
          </div>
          <div class="toolbar">
            <button class="ghost-button" data-action="download-template">Descargar modelo</button>
            <input id="templateFile" type="file" accept=".xlsx,.xls,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain">
            <button class="primary-button" data-action="read-template">Leer archivo</button>
          </div>
        </div>
        <div class="field full"><textarea id="importText" rows="9" placeholder="Pega aqui filas reales de tu cartola o el contenido exportado como CSV."></textarea></div>
        <div class="toolbar">
          <button class="primary-button" data-action="parse-import">Conciliar</button>
          <button class="ghost-button" disabled title="Pendiente: requiere lector PDF local confiable">PDF pendiente</button>
        </div>
        <p class="muted">Nada se registra automaticamente. Aprueba cada candidato antes de importarlo.</p>
        ${renderImportDiagnostics()}
      </div>
      <div class="card panel">
        <div class="panel-head">
          <h2>Candidatos de conciliacion</h2>
          ${state.importCandidates.length ? `<button class="primary-button" data-action="commit-import">Importar aprobados (${approvedImportCount})</button>` : ""}
        </div>
        ${state.importCandidates.length ? `<p class="muted">Nuevos aprobados: ${approvedImportCount}. Duplicados detectados: ${duplicateImportCount}.</p>` : ""}
        ${monthSummary}
        ${state.importCandidates.length ? `<div class="import-list">${state.importCandidates.map((c) => `
          <label class="candidate">
            <input type="checkbox" data-candidate="${c.id}" ${c.approved ? "checked" : ""} ${c.duplicate ? "disabled" : ""}>
            <span><strong>${c.date} - ${escapeHtml(c.description)}</strong><br><span class="muted">${kindPill(c.kind)} ${distributionPill(c.distribution || inferDistribution(c))} ${money(c.amount)} ${c.duplicate ? "- ya existe, no se importa otra vez" : ""}</span></span>
            <span>${escapeHtml([c.category, c.bankName, c.account, `Mes ${c.accountingMonth || financialCycleMonth(c.date)}`].filter(Boolean).join(" - "))}</span>
          </label>
        `).join("")}</div><div class="toolbar import-actions"><button class="primary-button" data-action="commit-import">Importar aprobados (${approvedImportCount})</button></div>` : `<div class="empty">Aun no hay candidatos conciliados.</div>`}
      </div>
    </section>
  `;
}

function importMonthSummary() {
  if (!state.importCandidates.length) return "";
  const groups = {};
  state.importCandidates.forEach((item) => {
    const key = item.accountingMonth || financialCycleMonth(item.date);
    groups[key] ||= { total: 0, approved: 0, duplicates: 0 };
    groups[key].total += 1;
    if (item.approved && !item.duplicate) groups[key].approved += 1;
    if (item.duplicate) groups[key].duplicates += 1;
  });
  return `
    <div class="import-month-summary">
      <strong>Meses financieros detectados</strong>
      <div class="import-month-buttons">
        ${Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)).map(([key, info]) => `
          <button class="ghost-button mini-button" data-set-month="${key}" data-view="transactions">
            ${key}: ${info.total} fila(s) · ${info.approved} nueva(s) · ${info.duplicates} duplicada(s)
          </button>
        `).join("")}
      </div>
      ${Object.values(groups).every((info) => info.duplicates === info.total) ? `<p class="muted">Todas las filas leidas ya existen como registros. Usa los botones de mes para verlas en Movimientos.</p>` : ""}
    </div>
  `;
}

function renderImportDiagnostics() {
  const info = state.importDiagnostics;
  if (!info) return "";
  return `
    <div class="import-diagnostics">
      <strong>Lectura del archivo</strong>
      <div class="diagnostic-grid">
        <span>Filas leidas: <b>${Number(info.sourceRows || 0)}</b></span>
        <span>Validas: <b>${Number(info.validRows || 0)}</b></span>
        <span>Ignoradas: <b>${Number(info.skippedRows?.length || 0)}</b></span>
      </div>
      ${info.skippedRows?.length ? `
        <details>
          <summary>Ver filas ignoradas</summary>
          <ul>
            ${info.skippedRows.slice(0, 12).map((item) => `<li>Fila ${item.row}: ${escapeHtml(item.reason)}${item.preview ? ` - ${escapeHtml(item.preview)}` : ""}</li>`).join("")}
          </ul>
        </details>
      ` : ""}
    </div>
  `;
}

function importSummaryMessage(items) {
  const count = (kind) => items.filter((item) => item.kind === kind).length;
  const expenses = count("cash_expense");
  const cards = count("card_purchase");
  const incomes = count("income");
  const debtPayments = count("debt_payment");
  const totalExpense = items
    .filter((item) => ["cash_expense", "card_purchase"].includes(item.kind))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (!items.length) return "No se importaron movimientos. Revisa si estaban duplicados o sin aprobar.";
  return [
    `Importados: ${items.length} movimientos.`,
    `Ingresos: ${incomes}. Gastos: ${expenses}. Tarjeta: ${cards}. Pagos deuda: ${debtPayments}.`,
    `Gasto importado: ${money(totalExpense)}.`,
    totalExpense ? "" : "Atencion: no entro ningun egreso. Revisa el tipo o las columnas del Excel.",
  ].filter(Boolean).join("\n");
}

function importSavedSummary(items, errors = []) {
  return {
    count: items.length,
    month: activeMonth(),
    errors,
    income: items
      .filter((item) => item.kind === "income")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    expense: items
      .filter((item) => ["cash_expense", "card_purchase", "debt_payment"].includes(item.kind))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0),
  };
}

function renderClosing() {
  const current = monthFinance(activeMonth());
  const previous = monthFinance(addMonthsToKey(activeMonth(), -1));
  const expenseDelta = current.netRealExpense - previous.netRealExpense;
  const incomeDelta = current.income - previous.income;
  const freeFlow = current.income - current.netRealExpense - current.debtPayments;
  return `
    <div class="toolbar">
      <button class="primary-button" data-action="close-month">Cerrar ${activeMonth()}</button>
    </div>
    <section class="grid four-col">
      <div class="card metric"><span>Ingreso del mes</span><strong>${money(current.income)}</strong><small>${incomeDelta >= 0 ? "+" : "-"}${money(Math.abs(incomeDelta))} vs mes anterior</small></div>
      <div class="card metric"><span>Gasto neto</span><strong>${money(current.netRealExpense)}</strong><small>${expenseDelta >= 0 ? "Subio" : "Bajo"} ${money(Math.abs(expenseDelta))}</small></div>
      <div class="card metric"><span>Flujo libre</span><strong>${money(freeFlow)}</strong><small>Ingreso menos gastos y pagos</small></div>
      <div class="card metric"><span>Pasivo abierto</span><strong>${money(current.outstandingDebt)}</strong><small>Tarjetas, cuotas y deudas</small></div>
    </section>
    <div class="card panel">
      <h2>Historial de cierres</h2>
      ${state.monthlyClosures.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Mes</th><th>Fecha cierre</th><th>Mov.</th><th>Ingreso</th><th>Gasto neto</th><th>Flujo libre</th><th>Tendencia gasto</th><th>Cobranzas</th><th>Pasivos</th></tr></thead>
          <tbody>${state.monthlyClosures.map((c) => `
            <tr><td>${c.month}</td><td>${new Date(c.closedAt).toLocaleString("es-CL")}</td><td>${Number(c.transactionCount || 0)}</td><td>${money(c.income ?? c.metrics?.income)}</td><td>${money(c.netExpense ?? c.metrics?.netRealExpense)}</td><td>${money(c.freeFlow || 0)}</td><td>${Number(c.trends?.expenseDelta || 0) >= 0 ? "+" : "-"}${money(Math.abs(Number(c.trends?.expenseDelta || 0)))}</td><td>${c.pendingReceivables}</td><td>${c.openDebts}</td></tr>
          `).join("")}</tbody>
        </table></div>
      ` : `<div class="empty">El cierre mensual crea un snapshot y conserva pendientes, cuotas y pasivos.</div>`}
    </div>
  `;
}

function renderBackup() {
  return `
    <section class="grid two-col">
      <div class="card panel">
        <h2>Exportar respaldo JSON</h2>
        <p class="muted">Incluye perfil, movimientos, pasivos, cobranzas, importaciones y cierres.</p>
        <button class="primary-button" data-action="export-json">Descargar JSON</button>
      </div>
      <div class="card panel">
        <h2>Importar respaldo JSON</h2>
        <input type="file" id="backupFile" accept="application/json">
        <div class="toolbar"><button class="ghost-button" data-action="import-json">Restaurar respaldo</button></div>
        <button class="danger-button" data-action="open-reset">Eliminar todos los registros</button>
      </div>
    </section>
  `;
}

function clpNumber(value) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function aiFinancialSnapshot() {
  const month = activeMonth();
  const finance = monthFinance(month);
  const globalFinance = computeFinance();
  const distribution = distributionSummary(month);
  const advisor = monthlyAdvisorRecommendation();
  const partnerBalanceItems = partnerBalances();
  const monthTxs = state.transactions
    .filter((tx) => txMonth(tx) === month)
    .sort((a, b) => b.date.localeCompare(a.date));
  const projectionDetailTotals = {};
  state.transactions
    .filter((tx) => txMonth(tx) === month && !["income", "receivable_collection"].includes(tx.kind))
    .forEach((tx) => {
      const key = projectionDetailFor(tx);
      projectionDetailTotals[key] = (projectionDetailTotals[key] || 0) + Number(tx.amount || 0);
    });
  const recentTransactions = monthTxs.slice(0, 25).map((tx) => ({
    fecha: tx.date,
    descripcion: tx.description,
    tipo: tx.kind,
    categoria: tx.category,
    distribucion: inferDistribution(tx),
    comportamientoProyeccion: projectionTypeFor(tx),
    detalleProyeccion: projectionDetailFor(tx),
    monto: Number(tx.amount || 0),
    banco: tx.bank || tx.account || tx.debtName || "",
    cuota: tx.installmentCurrent && tx.installmentTotal ? `${tx.installmentCurrent}/${tx.installmentTotal}` : "",
  }));
  const goals = state.goals.map((goal) => {
    const analysis = goalAnalysis(goal);
    return {
      nombre: goal.name,
      tipo: goal.type,
      meta: Number(goal.targetAmount || 0),
      actual: Number(goal.currentAmount || 0),
      fecha: goal.deadline || goal.targetMonth || "",
      prioridad: goal.priority || "",
      necesitaMensual: Math.round(analysis.monthlyNeed || 0),
      brechaMensual: Math.round(analysis.shortfall || 0),
    };
  });
  const debts = state.debts.map((debt) => ({
    nombre: debt.name,
    tipo: debt.type,
    saldo: Number(debt.balance || 0),
    total: Number(debt.amount || debt.balance || 0),
    cuotaMensual: Number(debt.monthlyPayment || 0),
    tasa: Number(debt.interestRate || 0),
    vencimiento: debt.dueDate || "",
  }));
  const projection = projectedYearSeries().slice(0, 12).map((item) => ({
    mes: item.month,
    ingresos: Math.round(item.income || 0),
    egresos: Math.round(item.expense || 0),
    saldo: Math.round(item.balance || 0),
  }));
  return {
    perfil: {
      nombre: state.profile.name || "",
      moneda: state.profile.currency || "CLP",
      mesSeleccionado: month,
      cicloFinanciero: financialCycleRangeLabel(month),
    },
    resumenMes: {
      ingresos: Math.round(finance.income || 0),
      gastoBruto: Math.round(finance.grossExpense || 0),
      gastoNetoProyectado: Math.round(finance.netProjectedExpense || 0),
      gastoNetoReal: Math.round(finance.netRealExpense || 0),
      pagosDeuda: Math.round(finance.debtPayments || 0),
      pasivoAbierto: Math.round(finance.outstandingDebt || 0),
      flujoLibre: Math.round((finance.income || 0) - (finance.netProjectedExpense || 0) - (finance.debtPayments || 0)),
    },
    resumenGlobal: {
      pasivoTotal: Math.round(globalFinance.outstandingDebt || 0),
      cobranzasPendientes: Math.round(globalFinance.pendingProjectedRecovery || 0),
    },
    distribucionMes: distribution.totals,
    detalleProyeccionMes: projectionDetailTotals,
    recomendacionActual: advisor,
    objetivos: goals,
    deudas: debts,
    socios: partnerBalanceItems.map((row) => ({
      socio: row.partner?.name || "",
      meDebe: Math.round(row.pending || 0),
      leDebo: Math.round(row.payable || 0),
      neto: Math.round(row.net || 0),
    })),
    transaccionesRecientesDelMes: recentTransactions,
    proyeccion12Meses: projection,
  };
}

function renderAiAdvisor() {
  const chat = state.ui.aiChat || [];
  const model = state.ui.aiModel || GROQ_MODELS[0];
  const snapshot = aiFinancialSnapshot();
  const quickQuestions = [
    "Que debo recortar este mes para cumplir mis objetivos?",
    "Estoy en riesgo con mis deudas?",
    "Como se proyecta mi saldo en los proximos 12 meses?",
    "Que gastos parecen permanentes y cuales pasajeros?",
  ];
  return `
    <section class="ai-layout">
      <div class="card panel ai-intro-card">
        <div>
          <span class="eyebrow">Analista senior con IA</span>
          <h2>Pregunta sobre tus finanzas, deudas, socios y proyecciones</h2>
          <p>La IA recibe un resumen estructurado de tus datos locales: movimientos del mes, objetivos, deudas, socios y proyeccion anual. No reemplaza asesoria financiera formal, pero sirve para tomar mejores decisiones.</p>
        </div>
        <div class="ai-model-box">
          <label>Modelo Groq</label>
          <select id="aiModel" data-ai-model>
            ${GROQ_MODELS.map((item) => `<option value="${escapeAttr(item)}" ${item === model ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="grid ai-snapshot-grid">
        <div class="card ai-stat"><span>Ingreso del mes</span><strong>${clpNumber(snapshot.resumenMes.ingresos)}</strong></div>
        <div class="card ai-stat"><span>Gasto neto proyectado</span><strong>${clpNumber(snapshot.resumenMes.gastoNetoProyectado)}</strong></div>
        <div class="card ai-stat"><span>Flujo libre estimado</span><strong>${clpNumber(snapshot.resumenMes.flujoLibre)}</strong></div>
        <div class="card ai-stat"><span>Pasivo abierto</span><strong>${clpNumber(snapshot.resumenMes.pasivoAbierto)}</strong></div>
      </div>
      <div class="card panel ai-chat-card">
        <div class="panel-head">
          <h2>Chat financiero</h2>
          <button class="ghost-button" data-action="clear-ai-chat">Limpiar chat</button>
        </div>
        <div class="ai-quick-questions">
          ${quickQuestions.map((question) => `<button class="ghost-button mini-button" data-ai-question="${escapeAttr(question)}">${escapeHtml(question)}</button>`).join("")}
        </div>
        <div class="ai-messages" id="aiMessages">
          ${chat.length ? chat.map(renderAiMessage).join("") : `<div class="ai-empty">Haz una pregunta concreta. Por ejemplo: "quiero ahorrar 500.000 en 4 meses, que recorto?"</div>`}
          ${state.ui.aiBusy ? `<div class="ai-message assistant"><strong>IA financiera</strong><p>Analizando tus numeros...</p></div>` : ""}
        </div>
        <form id="aiChatForm" class="ai-form">
          <textarea id="aiPrompt" name="aiPrompt" rows="3" placeholder="Escribe tu pregunta: deuda, ahorro, gastos por banco, socios, proyeccion, cierre de mes..." ${state.ui.aiBusy ? "disabled" : ""}></textarea>
          <button class="primary-button" ${state.ui.aiBusy ? "disabled" : ""}>Preguntar</button>
        </form>
        <p class="muted">La consulta se envía a la API de Groq a través del proxy configurado en groq-config.js. Asegura tu clave Groq en el backend antes de publicar.</p>
      </div>
    </section>
  `;
}

function renderFloatingAiWidget() {
  const open = state.ui.aiFloatingOpen;
  const chat = state.ui.aiChat || [];
  const lastMessages = chat.slice(-5);
  const model = state.ui.aiModel || GROQ_MODELS[0];
  return `
    <div class="floating-ai ${open ? "open" : ""}">
      ${open ? `
        <section class="floating-ai-panel" aria-label="Asistente financiero IA">
          <div class="floating-ai-head">
            <div>
              <span>IA financiera</span>
              <strong>Analista senior</strong>
            </div>
            <button class="ghost-button mini-button" data-action="toggle-floating-ai">Cerrar</button>
          </div>
          <div class="floating-ai-model">
            <label>Modelo</label>
            <select data-ai-model>
              ${GROQ_MODELS.map((item) => `<option value="${escapeAttr(item)}" ${item === model ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
            </select>
          </div>
          <div class="floating-ai-messages">
            ${lastMessages.length ? lastMessages.map(renderAiMessage).join("") : `<div class="ai-empty compact">Preguntame por metas, deudas, gastos o proyecciones.</div>`}
            ${state.ui.aiBusy ? `<div class="ai-message assistant"><strong>IA financiera</strong><p>Estoy leyendo tus datos registrados...</p></div>` : ""}
          </div>
          <form class="floating-ai-form" data-ai-chat-form>
            <textarea name="aiPrompt" rows="3" placeholder="Ej: que debo recortar este mes?" ${state.ui.aiBusy ? "disabled" : ""}></textarea>
            <button class="primary-button" ${state.ui.aiBusy ? "disabled" : ""}>Enviar</button>
          </form>
        </section>
      ` : ""}
      <button class="floating-ai-button" data-action="toggle-floating-ai" title="Abrir IA financiera">
        <span>$</span>
        <strong>IA</strong>
      </button>
    </div>
  `;
}

function renderAiMessage(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const label = role === "user" ? "Tu" : "IA financiera";
  return `
    <div class="ai-message ${role}">
      <strong>${label}</strong>
      <p>${escapeHtml(message.content || "").replace(/\n/g, "<br>")}</p>
    </div>
  `;
}

function scrollAiMessagesToBottom() {
  window.setTimeout(() => {
    document.querySelectorAll(".ai-messages, .floating-ai-messages").forEach((box) => {
      box.scrollTop = box.scrollHeight;
    });
  }, 0);
}

async function submitAiQuestion(event) {
  event.preventDefault();
  const promptEl = event.currentTarget.querySelector('[name="aiPrompt"], #aiPrompt');
  const prompt = promptEl?.value.trim();
  if (!prompt || state.ui.aiBusy) return;
  state.ui.aiChat ||= [];
  state.ui.aiChat.push({ role: "user", content: prompt, at: new Date().toISOString() });
  state.ui.aiBusy = true;
  saveState();
  render();
  try {
    const answer = await askGroqFinancialAdvisor(prompt);
    state.ui.aiChat.push({ role: "assistant", content: answer, at: new Date().toISOString() });
  } catch (error) {
    state.ui.aiChat.push({
      role: "assistant",
      content: `No pude conectar con Groq. Detalle: ${error.message || error}. Revisa internet, API key o permisos CORS del navegador.`,
      at: new Date().toISOString(),
    });
  } finally {
    state.ui.aiBusy = false;
    saveState();
    render();
  }
}

async function askGroqFinancialAdvisor(prompt) {
  const model = state.ui.aiModel || GROQ_MODELS[0];
  const snapshot = aiFinancialSnapshot();
  const history = (state.ui.aiChat || []).slice(-8).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: item.content,
  }));
  const messages = [
    {
      role: "system",
      content: [
        "Eres un analista senior de finanzas personales y presupuesto familiar para Chile. Trabajas como un copiloto financiero dentro de una app local.",
        "Usa un lenguaje cercano, amable y humano. Explica como si acompañaras a una persona que quiere ordenar sus finanzas sin sentirse juzgada.",
        "Se claro, directo y cuidadoso. Evita sonar como informe bancario, auditoria o respuesta robotica. Mantiene el analisis serio, pero con tono conversacional.",
        "Puedes usar frases simples como: mi recomendacion seria, ojo con esto, esto esta manejable, aqui conviene ir con calma, o esto requiere ajuste.",
        "No exageres la cercania ni uses relleno emocional. La prioridad es que la persona entienda que decision tomar y por que.",
        "Antes de responder, lee el JSON de contexto financiero completo y basa tu analisis solo en esos datos registrados. No inventes movimientos, bancos, saldos, ingresos, fechas, cuotas, socios ni objetivos.",
        "Distingue con precision: flujo de caja, consumo, pasivo, pago de deuda, gasto bruto, gasto neto proyectado, gasto neto real, cobranzas pendientes, ahorro comprometido, objetivos activos y capacidad estimada de ahorro.",
        "Evita doble contabilizacion de tarjeta: una compra con tarjeta es consumo y aumenta pasivo; el pago de tarjeta baja pasivo y afecta caja, pero no crea un segundo gasto de consumo.",
        "Cuando la persona consulte si puede comprar algo, asumir una nueva cuota o financiar una compra a credito, debes hacer una proyeccion mensual considerando: precio total de la compra; monto contado si existe; numero de cuotas; valor de cada cuota; fecha de inicio del pago; gastos actuales registrados; deudas vigentes; ahorro comprometido; objetivos activos; capacidad estimada de ahorro; y flujo disponible mensual.",
        "Si la compra es al contado, evalua cuanto reduce la caja disponible del mes y si afecta el cumplimiento de objetivos.",
        "Si la compra es a credito, calcula el impacto mensual de la cuota durante todos los meses que dure el credito.",
        "Debes proyectar el efecto de la compra en el presupuesto mensual, indicando: nuevo gasto mensual comprometido; nueva capacidad de ahorro estimada; brecha mensual respecto a los objetivos; meses en que la persona quedara mas ajustada; si la compra retrasa algun objetivo; si aumenta demasiado el uso de deuda o tarjeta; y si conviene comprar ahora, esperar, pagar al contado o elegir menos cuotas.",
        "Nunca analices una compra a credito solo por el valor de la cuota. Siempre considera el total de cuotas y su efecto acumulado en los meses futuros.",
        "Ejemplo obligatorio de criterio: si una compra cuesta $600.000 en 6 cuotas de $100.000, no digas solamente que la cuota es manejable. Debes evaluar que durante 6 meses habra $100.000 menos disponibles para ahorro, deuda u otros gastos.",
        "Cuando falten datos para proyectar, pide el dato exacto que falta.",
        "Datos minimos para proyectar una compra a credito: monto total de la compra; numero de cuotas; valor de la cuota si ya existe; mes de inicio del pago; si la compra sera con tarjeta de credito, credito de consumo u otro medio; y si tiene interes o es sin interes.",
        "Si no se informa el valor de la cuota, calcula una estimacion simple: valor cuota estimada = monto total / numero de cuotas. Indica claramente que es una estimacion y que puede cambiar si existen intereses, comisiones o seguros.",
        "Formato de respuesta recomendado para compras o creditos: 1. Diagnostico de la compra: indica si la compra parece conveniente, riesgosa o posible con ajuste. 2. Impacto mensual: muestra cuanto afectara el flujo mensual. 3. Proyeccion: explica que pasara durante los meses que duren las cuotas. 4. Efecto en objetivos: indica si algun objetivo se atrasa o requiere ajuste. 5. Recomendacion: entrega una accion concreta: comprar, esperar, reducir monto, pagar al contado, elegir menos cuotas, elegir mas cuotas solo si no afecta metas, o no comprar.",
        "Cuando la compra afecte fuertemente el presupuesto, usa una alerta clara: Esta compra no es recomendable en este momento, porque la cuota reduce demasiado tu margen mensual y puede atrasar tus objetivos.",
        "Cuando la compra sea viable, responde de forma positiva pero responsable: La compra es posible, siempre que mantengas el ahorro minimo y no sumes nuevas cuotas durante los proximos meses.",
        "Para consultas generales no relacionadas con compras, responde como analista senior: diagnostica, muestra numeros clave, acciones priorizadas, riesgos/alertas y siguiente paso.",
        "Usa CLP sin decimales y formato chileno. Responde en espanol claro, directo, accionable y con numeros trazables. No uses relleno.",
      ].join(" "),
    },
    {
      role: "user",
      content: `Contexto financiero local en JSON:\n${JSON.stringify(snapshot, null, 2)}`,
    },
    ...history,
    { role: "user", content: prompt },
  ];
  const payload = {
    model,
    messages,
    temperature: 0.25,
    max_tokens: 900,
  };
  const response = await fetch(GROQ_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Groq respondio ${response.status}`);
  }
  return data?.choices?.[0]?.message?.content?.trim() || "No recibi una respuesta util del modelo.";
}

function renderSettings() {
  return `
    <section class="card panel">
      <h2>Herramientas avanzadas</h2>
      <div class="quick-grid">
        <button class="quick-action" data-view="recurring"><strong>Recurrentes</strong><span>Sueldo, arriendo, cuentas y pagos fijos.</span></button>
        <button class="quick-action" data-view="debts"><strong>Tarjeta y deudas</strong><span>Pasivos, cuotas, CAE y estrategia de pago.</span></button>
        <button class="quick-action" data-view="receivables"><strong>Cobranzas</strong><span>Reembolsos y dinero pendiente de socios.</span></button>
        <button class="quick-action" data-view="history"><strong>Historial</strong><span>Meses anteriores y proyecciones.</span></button>
        <button class="quick-action" data-view="closing"><strong>Cierre mensual</strong><span>Guardar snapshot del mes.</span></button>
        <button class="quick-action" data-view="backup"><strong>Respaldo</strong><span>Exportar o restaurar JSON.</span></button>
        <button class="quick-action danger-action" data-action="open-reset"><strong>Eliminar todos los registros</strong><span>Borrar movimientos, socios, objetivos, deudas e importaciones.</span></button>
      </div>
    </section>
  `;
}

function renderOnboarding() {
  const data = state.profile;
  return `
    <div class="onboarding">
      <div class="modal">
        <div class="modal-head"><h2>Configura Mi Portal Financiero</h2><span class="muted">5 pasos</span></div>
        <div class="modal-body">
          <div class="stepper">${[1,2,3,4,5].map((n) => `<div class="done"></div>`).join("")}</div>
          <div class="form-grid">
            <div class="field"><label>Perfil</label><input id="obName" value="${escapeAttr(data.name)}" placeholder="Mi hogar"></div>
            <div class="field"><label>Moneda</label><select id="obCurrency">${["CLP", "USD", "EUR"].map((c) => `<option ${data.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
            <div class="field"><label>Saldo inicial</label><input id="obBalance" type="number" min="0" value="${data.initialBalance || 0}"></div>
            <div class="field"><label>Categorias</label><input id="obCategories" value="${escapeAttr(state.categories.join(", "))}"></div>
            <div class="field full"><label>Privacidad</label><select id="obMask"><option value="false">Mostrar montos</option><option value="true">Ocultar montos al abrir</option></select></div>
          </div>
          <p class="muted">Despues veras acciones iniciales para agregar ingreso, gasto, compra con tarjeta o importar cartola.</p>
        </div>
        <div class="modal-foot">
          <button class="primary-button" id="obStart">Entrar a la app</button>
        </div>
      </div>
    </div>
  `;
}

function renderModal() {
  const body = {
    transaction: transactionForm("Nuevo movimiento"),
    incomeExtra: transactionForm("Ingreso extra", { kind: "income", category: "Trabajo extra", description: "Trabajo extra", account: "Caja" }),
    card: transactionForm("Compra con tarjeta", { kind: "card_purchase", account: "Tarjeta" }),
    payment: transactionForm("Pago de deuda", { kind: "debt_payment" }),
    debt: debtForm(),
    receivable: receivableForm(),
    goal: goalForm(),
    goalTransfer: goalTransferForm(),
    recurring: recurringForm(),
    partner: partnerForm(),
    share: shareForm(),
    resetConfirm: resetConfirmCard(),
    importSaved: importSavedCard(),
    summaryIncome: summaryDetailCard("income"),
    summaryExpense: summaryDetailCard("expense"),
    summaryBalance: summaryDetailCard("balance"),
    summaryPartners: summaryDetailCard("partners"),
  }[modal];
  return `<div class="modal-backdrop"><div class="modal">${body}</div></div>`;
}

function summaryDetailCard(type) {
  const f = monthFinance(activeMonth());
  const txs = currentMonthTransactions();
  const incomeRows = txs.filter((tx) => ["income", "receivable_collection"].includes(tx.kind));
  const expenseRows = txs.filter((tx) => !["income", "receivable_collection"].includes(tx.kind));
  const balances = partnerBalances().filter((item) => item.partner.active !== false);
  const netPartners = balances.reduce((sum, item) => sum + Number(item.net || 0), 0);
  const remaining = f.income - f.netProjectedExpense - f.debtPayments;
  const config = {
    income: {
      title: "Detalle de ingresos",
      total: f.income,
      subtitle: `${incomeRows.length} movimiento(s) de entrada en ${activeMonth()}`,
      body: incomeRows.length ? renderTxTable(incomeRows.sort((a, b) => b.date.localeCompare(a.date))) : `<div class="empty">No hay ingresos registrados en ${activeMonth()}.</div>`,
    },
    expense: {
      title: "Detalle de egresos",
      total: f.netProjectedExpense + f.debtPayments,
      subtitle: `${expenseRows.length} movimiento(s) de salida en ${activeMonth()}`,
      body: expenseRows.length ? renderTxTable(expenseRows.sort((a, b) => b.date.localeCompare(a.date))) : `<div class="empty">No hay egresos registrados en ${activeMonth()}.</div>`,
    },
    balance: {
      title: "Detalle de saldo restante",
      total: remaining,
      subtitle: "Ingreso menos gasto neto y pagos de deuda",
      body: `
        <div class="summary-breakdown">
          <div><span>Total ingresos</span><strong>${money(f.income)}</strong></div>
          <div><span>Gasto neto proyectado</span><strong>-${money(f.netProjectedExpense)}</strong></div>
          <div><span>Pagos de deuda</span><strong>-${money(f.debtPayments)}</strong></div>
          <div class="${remaining >= 0 ? "good" : "bad"}"><span>Saldo restante</span><strong>${money(remaining)}</strong></div>
        </div>
      `,
    },
    partners: {
      title: "Detalle de socios",
      total: Math.abs(netPartners),
      subtitle: netPartners >= 0 ? "Saldo a favor con socios" : "Saldo en contra con socios",
      body: balances.length ? `
        <div class="summary-breakdown">
          ${balances.map((item) => `
            <div class="${Number(item.net || 0) >= 0 ? "good" : "bad"}">
              <span>${escapeHtml(item.partner.name)}</span>
              <strong>${Number(item.net || 0) >= 0 ? "Me debe " : "Le debo "}${money(Math.abs(Number(item.net || 0)))}</strong>
            </div>
          `).join("")}
        </div>
      ` : `<div class="empty">No hay socios activos con saldo en este mes.</div>`,
    },
  }[type];
  return `
    <div class="modal-head">
      <h2>${config.title}</h2>
      <button type="button" class="ghost-button" data-close-modal>x</button>
    </div>
    <div class="modal-body">
      <div class="summary-detail-head">
        <span>${escapeHtml(config.subtitle)}</span>
        <strong>${money(config.total)}</strong>
      </div>
      ${config.body}
    </div>
    <div class="modal-foot">
      <button type="button" class="primary-button" data-close-modal>Cerrar</button>
    </div>
  `;
}

function importSavedCard() {
  const summary = state.ui?.lastImportSummary || {};
  const hasSaved = Number(summary.count || 0) > 0;
  const errors = summary.errors || [];
  return `
    <div class="modal-head success-head">
      <h2>${hasSaved ? "DATOS GUARDADOS" : "SIN REGISTROS NUEVOS"}</h2>
      <button type="button" class="ghost-button" data-close-modal>x</button>
    </div>
    <div class="modal-body">
      <div class="saved-data-card">
        <strong>${hasSaved ? "Importacion completada" : "No se guardaron movimientos nuevos"}</strong>
        <p>${hasSaved ? "Los registros aprobados ya fueron guardados en la aplicacion." : "Las filas estaban duplicadas, desmarcadas o no habia candidatos nuevos aprobados."}</p>
        <div class="saved-data-grid">
          <div><span>Registros guardados</span><strong>${Number(summary.count || 0)}</strong></div>
          <div><span>Ingresos</span><strong>${money(summary.income || 0)}</strong></div>
          <div><span>Gastos y tarjeta</span><strong>${money(summary.expense || 0)}</strong></div>
          <div><span>Mes contable</span><strong>${escapeHtml(summary.month || activeMonth())}</strong></div>
        </div>
        ${errors.length ? `<div class="import-error-list"><strong>Filas no guardadas: ${errors.length}</strong>${errors.slice(0, 6).map((item) => `<p>${escapeHtml(item.description || "Movimiento")} - ${escapeHtml(item.message || "Error")}</p>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="modal-foot">
      <button type="button" class="primary-button" data-close-modal>Aceptar</button>
    </div>
  `;
}

function resetConfirmCard() {
  return `
    <div class="modal-head danger-head">
      <h2>Eliminar todos los registros</h2>
      <button type="button" class="ghost-button" data-close-modal>x</button>
    </div>
    <div class="modal-body">
      <div class="reset-warning-card">
        <strong>Esta accion deja la aplicacion en blanco.</strong>
        <p>Se borraran movimientos, cartolas importadas, socios, repartos, objetivos, deudas, cierres, historiales y configuraciones locales.</p>
        <p class="warning-text">Lo eliminado no volvera a verse nuevamente dentro de la app, salvo que antes descargues y conserves un respaldo JSON.</p>
      </div>
    </div>
    <div class="modal-foot reset-actions">
      <button type="button" class="ghost-button" data-close-modal>Cancelar</button>
      <button type="button" class="danger-button" data-action="reset-delete">Eliminar de todas maneras</button>
      <button type="button" class="primary-button" data-action="reset-backup">Descargar respaldo</button>
    </div>
  `;
}

function transactionForm(title, preset = {}) {
  const tx = editingId ? state.transactions.find((t) => t.id === editingId) : null;
  const val = { date: activeMonthDate("01"), kind: "cash_expense", category: state.categories[0], ...preset, ...(tx || {}) };
  const showSplit = Boolean(val.partnerId);
  return `
    <form id="txForm">
      <div class="modal-head"><h2>${title}</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field"><label>Fecha</label><input name="date" type="date" value="${val.date}" required></div>
        <div class="field"><label>Tipo</label><select name="kind">${kindOptions(val.kind)}</select></div>
        <div class="field full"><label>Descripcion</label><input name="description" value="${escapeAttr(val.description || "")}" required></div>
        <div class="field"><label>Monto</label><input name="amount" type="number" min="1" value="${val.amount || ""}" required></div>
        <div class="field"><label>Categoria</label><select name="category">${state.categories.map((c) => `<option ${val.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
        <details class="advanced-fields field full">
          <summary>Opciones avanzadas</summary>
          <div class="form-grid">
            <div class="field"><label>Distribucion</label><select name="distribution">${distributionOptions(val.distribution || inferDistribution(val))}</select></div>
            <div class="field"><label>Cuenta</label><input name="account" value="${escapeAttr(val.account || "Caja")}"></div>
            <div class="field"><label>Banco</label><input name="bankName" value="${escapeAttr(val.bankName || "")}" placeholder="Ej: Banco Estado, Santander"></div>
            <div class="field"><label>Deuda asociada</label><select name="debtId"><option value="">Crear/ninguna</option>${state.debts.map((d) => `<option value="${d.id}" ${val.debtId === d.id ? "selected" : ""}>${escapeHtml(d.name)} - ${money(d.balance)}</option>`).join("")}</select></div>
            <div class="field"><label>Reparto</label><select name="splitMode" data-split-mode><option value="none" ${!showSplit ? "selected" : ""}>No compartido</option><option value="shared" ${showSplit ? "selected" : ""}>Compartido con socio</option></select></div>
            <div class="field split-field ${showSplit ? "" : "hidden"}"><label>Socio</label><select name="partnerId">${partnerOptionsHtml(val.partnerId)}</select></div>
            <div class="field split-field ${showSplit ? "" : "hidden"}"><label>% que paga socio</label><input name="partnerSharePercent" type="number" min="0" max="100" value="${val.partnerSharePercent || ""}" placeholder="Ej: 30, 50, 70"></div>
            <div class="field split-field ${showSplit ? "" : "hidden"}"><label>Saldo con socio</label><select name="splitDirection"><option value="partner_owes_me" ${val.splitDirection !== "i_owe_partner" ? "selected" : ""}>Socio me debe</option><option value="i_owe_partner" ${val.splitDirection === "i_owe_partner" ? "selected" : ""}>Yo le debo</option></select></div>
          </div>
        </details>
        <div class="field full"><label>Notas</label><textarea name="notes" rows="3">${escapeHtml(val.notes || "")}</textarea></div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function kindOptions(selected) {
  return [
    ["income", "Ingreso sueldo/extra"],
    ["cash_expense", "Gasto caja"],
    ["card_purchase", "Compra tarjeta"],
    ["debt_payment", "Pago deuda"],
    ["receivable_collection", "Cobro recibido"],
  ].map(([v, l]) => `<option value="${v}" ${selected === v ? "selected" : ""}>${l}</option>`).join("");
}

function debtForm() {
  return `
    <form id="debtForm">
      <div class="modal-head"><h2>Nueva deuda o cuota</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field full"><label>Nombre</label><input name="name" required></div>
        <div class="field"><label>Tipo</label><select name="type"><option value="installment">Cuota/deuda</option><option value="credit_card">Tarjeta de credito</option></select></div>
        <div class="field"><label>Monto inicial</label><input name="amount" type="number" min="1" required></div>
        <div class="field"><label>Cuota mensual</label><input name="monthlyPayment" type="number" min="0" value="0"></div>
        <div class="field"><label>Tasa / CAE %</label><input name="interestRate" type="number" min="0" step="0.01" value="0"></div>
        <div class="field"><label>Metodo</label><select name="paymentMethod"><option value="avalancha">Avalancha</option><option value="snowball">Bola de nieve</option></select></div>
        <div class="field"><label>Total cuotas</label><input name="installmentTotal" type="number" min="1" value="1"></div>
        <div class="field"><label>Vencimiento</label><input name="dueDate" type="date" value="${activeMonthDate("28")}"></div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function receivableForm() {
  return `
    <form id="receivableForm">
      <div class="modal-head"><h2>Nueva cobranza</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field"><label>Fecha</label><input name="date" type="date" value="${activeMonthDate("01")}" required></div>
        <div class="field"><label>Monto</label><input name="amount" type="number" min="1" required></div>
        <div class="field full"><label>Descripcion</label><input name="description" required></div>
        <div class="field full"><label>Debe pagar</label><input name="from"></div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function goalForm() {
  const goal = editingId ? state.goals.find((g) => g.id === editingId) : null;
  const val = { type: "savings", deadline: nextMonthDate(6), targetMonth: monthKey(nextMonthDate(6)), priority: "media", allocationPercent: 0, ...(goal || {}) };
  return `
    <form id="goalForm">
      <div class="modal-head"><h2>${goal ? "Editar objetivo" : "Nuevo objetivo"}</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field full"><label>Nombre</label><input name="name" value="${escapeAttr(val.name || "")}" placeholder="Nombre del objetivo" required></div>
        <div class="field"><label>Tipo</label><select name="type"><option value="savings" ${val.type === "savings" ? "selected" : ""}>Ahorrar</option><option value="debt" ${val.type === "debt" ? "selected" : ""}>Ponerme al dia con deudas</option></select></div>
        <div class="field"><label>Mes objetivo</label><input name="targetMonth" type="month" value="${val.targetMonth || monthKey(val.deadline)}" required></div>
        <div class="field"><label>Prioridad</label><select name="priority"><option value="alta" ${val.priority === "alta" ? "selected" : ""}>Alta</option><option value="media" ${val.priority === "media" ? "selected" : ""}>Media</option><option value="baja" ${val.priority === "baja" ? "selected" : ""}>Baja</option></select></div>
        <div class="field"><label>Monto objetivo</label><input name="targetAmount" type="number" min="1" value="${val.targetAmount || ""}" required></div>
        <div class="field"><label>Monto actual</label><input name="currentAmount" type="number" min="0" value="${val.currentAmount || 0}"></div>
        <div class="field"><label>% del ahorro mensual</label><input name="allocationPercent" type="number" min="0" max="100" value="${val.allocationPercent || 0}" placeholder="Ej: 40"></div>
        <input type="hidden" name="deadline" value="${goalDeadlineFromMonth(val.targetMonth || monthKey(val.deadline))}">
        <div class="field full"><label>Deuda asociada</label><select name="debtId"><option value="">Usar deuda prioritaria</option>${state.debts.map((d) => `<option value="${d.id}" ${val.debtId === d.id ? "selected" : ""}>${escapeHtml(d.name)} - ${money(d.balance)}</option>`).join("")}</select></div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function goalTransferForm() {
  const goal = state.goals.find((g) => g.id === editingId);
  if (!goal) return `<div class="modal-body"><div class="empty">Objetivo no encontrado.</div></div>`;
  const amount = Number(goal.currentAmount || 0);
  const savingsGoals = state.goals.filter((g) => g.id !== goal.id && g.type === "savings");
  return `
    <form id="goalTransferForm">
      <div class="modal-head"><h2>Eliminar ahorro</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field full">
          <label>Saldo actual</label>
          <input value="${money(amount)}" disabled>
        </div>
        <div class="field full">
          <label>A que cuenta de ahorro deseas mover este saldo?</label>
          <select name="targetGoalId">
            ${savingsGoals.map((g) => `<option value="${g.id}">${escapeHtml(g.name)} - ${money(g.currentAmount || 0)}</option>`).join("")}
            <option value="free">Crear / usar Ahorro libre</option>
            <option value="discard">Eliminar sin mover saldo</option>
          </select>
        </div>
        <p class="muted field full">Si eliges otra cuenta, el saldo se suma a su monto actual antes de eliminar este objetivo.</p>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="danger-button">Eliminar y mover</button></div>
    </form>
  `;
}

function transferAndDeleteGoal(sourceId, targetId) {
  const source = state.goals.find((goal) => goal.id === sourceId);
  if (!source) return;
  const amount = Number(source.currentAmount || 0);
  if (amount > 0 && targetId && targetId !== "discard") {
    let target = targetId === "free" ? state.goals.find((goal) => goal.type === "savings" && goal.name === "Ahorro libre") : state.goals.find((goal) => goal.id === targetId);
    if (!target) {
      target = {
        id: uid("goal"),
        name: "Ahorro libre",
        type: "savings",
        targetAmount: amount,
        currentAmount: 0,
        deadline: goalDeadlineFromMonth(addMonthsToKey(activeMonth(), 12)),
        targetMonth: addMonthsToKey(activeMonth(), 12),
        allocationPercent: 0,
        priority: "baja",
        debtId: "",
        createdAt: today(),
      };
      state.goals.push(target);
    }
    target.currentAmount = Number(target.currentAmount || 0) + amount;
    target.targetAmount = Math.max(Number(target.targetAmount || 0), Number(target.currentAmount || 0));
  }
  state.goals = state.goals.filter((goal) => goal.id !== sourceId);
  saveState();
}

function recurringForm() {
  const item = editingId ? state.recurringItems.find((entry) => entry.id === editingId) : null;
  const val = { kind: "expense", category: "Servicios", startDate: activeMonthDate("01"), active: true, ...(item || {}) };
  return `
    <form id="recurringForm">
      <div class="modal-head"><h2>${item ? "Editar recurrente" : "Nuevo recurrente"}</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field full"><label>Nombre</label><input name="name" value="${escapeAttr(val.name || "")}" placeholder="Arriendo, sueldo, bencina base" required></div>
        <div class="field"><label>Tipo</label><select name="kind">
          <option value="income" ${val.kind === "income" ? "selected" : ""}>Ingreso mensual</option>
          <option value="expense" ${val.kind === "expense" ? "selected" : ""}>Egreso mensual</option>
          <option value="debt_payment" ${val.kind === "debt_payment" ? "selected" : ""}>Pago deuda mensual</option>
        </select></div>
        <div class="field"><label>Monto mensual</label><input name="amount" type="number" min="1" value="${val.amount || ""}" required></div>
        <div class="field"><label>Categoria</label><select name="category">${state.categories.map((c) => `<option ${val.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></div>
        <div class="field"><label>Distribucion</label><select name="distribution">${distributionOptions(val.distribution || inferDistribution(val))}</select></div>
        <div class="field"><label>Vigente desde</label><input name="startDate" type="date" value="${val.startDate || activeMonthDate("01")}"></div>
        <div class="field"><label>Estado</label><select name="active"><option value="true" ${val.active !== false ? "selected" : ""}>Activo</option><option value="false" ${val.active === false ? "selected" : ""}>Inactivo</option></select></div>
        <div class="field"><label>Reparto</label><select name="splitMode" data-split-mode><option value="none" ${!val.partnerId ? "selected" : ""}>No compartido</option><option value="shared" ${val.partnerId ? "selected" : ""}>Compartido con socio</option></select></div>
        <div class="field split-field ${val.partnerId ? "" : "hidden"}"><label>Socio</label><select name="partnerId">${partnerOptionsHtml(val.partnerId)}</select></div>
        <div class="field split-field ${val.partnerId ? "" : "hidden"}"><label>% que paga socio</label><input name="partnerSharePercent" type="number" min="0" max="100" value="${val.partnerSharePercent || ""}" placeholder="Ej: 30, 50, 70"></div>
        <div class="field full"><label>Notas</label><textarea name="notes" rows="3">${escapeHtml(val.notes || "")}</textarea></div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function partnerForm() {
  const partner = editingId ? state.partners.find((item) => item.id === editingId) : null;
  const val = { active: true, ...(partner || {}) };
  return `
    <form id="partnerForm">
      <div class="modal-head"><h2>${partner ? "Editar socio" : "Nuevo socio"}</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field full"><label>Nombre</label><input name="name" value="${escapeAttr(val.name || "")}" placeholder="Nombre del socio" required></div>
        <div class="field"><label>Estado</label><select name="active"><option value="true" ${val.active !== false ? "selected" : ""}>Activo</option><option value="false" ${val.active === false ? "selected" : ""}>Inactivo</option></select></div>
        <div class="field full"><label>Notas</label><textarea name="notes" rows="3">${escapeHtml(val.notes || "")}</textarea></div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function shareForm() {
  const tx = state.transactions.find((item) => item.id === editingId);
  if (!tx) return `<div class="modal-head"><h2>Gasto no encontrado</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>`;
  const purchaseType = tx.description || tx.category || kindPill(tx.kind).replace(/<[^>]+>/g, "");
  const splits = normalizedSplits(tx);
  const rows = splits.length ? splits : [{ partnerId: "", percent: "" }];
  const partnerOptions = (selected = "") => partnerOptionsHtml(selected);
  return `
    <form id="shareForm">
      <div class="modal-head"><h2>${splits.length ? "Editar socios del gasto" : "Añadir socios al gasto"}</h2><button type="button" class="ghost-button" data-close-modal>x</button></div>
      <div class="modal-body form-grid">
        <div class="field"><label>Fecha de compra</label><input value="${escapeAttr(tx.date)}" readonly></div>
        <div class="field"><label>Tipo de compra</label><input value="${escapeAttr(purchaseType)}" readonly></div>
        <div class="field full">
          <label>Socios y porcentaje a pagar</label>
          <div id="shareRows" class="share-rows">
            ${rows.map((split) => shareRow(partnerOptions(split.partnerId), split.percent)).join("")}
          </div>
          <button class="ghost-button add-share-button" type="button" data-add-share-row>+ Añadir otro socio</button>
          ${state.partners.length ? "" : `<p class="muted">Primero crea socios en la seccion Socios.</p>`}
        </div>
      </div>
      <div class="modal-foot"><button type="button" class="ghost-button" data-close-modal>Cancelar</button><button class="primary-button">Guardar</button></div>
    </form>
  `;
}

function shareRow(options, percent = "") {
  return `
    <div class="share-row">
      <select name="partnerId" required>${options}</select>
      <input name="partnerSharePercent" type="number" min="1" max="100" value="${escapeAttr(percent)}" placeholder="%" required>
      <button class="danger-button" type="button" data-remove-share-row>x</button>
    </div>
  `;
}

function bindOnboarding() {
  document.querySelector("#obStart").addEventListener("click", () => {
    state.profile.name = document.querySelector("#obName").value.trim() || "Mi hogar";
    state.profile.currency = document.querySelector("#obCurrency").value;
    state.profile.initialBalance = Number(document.querySelector("#obBalance").value || 0);
    state.profile.privacyMask = document.querySelector("#obMask").value === "true";
    state.categories = document.querySelector("#obCategories").value.split(",").map((c) => c.trim()).filter(Boolean);
    state.onboardingDone = true;
    saveState();
    render();
  });
}

function bindApp() {
  const selectedMonth = document.querySelector("#selectedMonth");
  if (selectedMonth) selectedMonth.addEventListener("change", () => {
    state.selectedMonth = selectedMonth.value || monthKey();
    saveState();
    render();
  });
  document.querySelectorAll("[data-set-month]").forEach((btn) => btn.addEventListener("click", () => {
    state.selectedMonth = btn.dataset.setMonth || activeMonth();
    if (btn.dataset.view) state.activeView = btn.dataset.view;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  document.querySelectorAll("[data-distribution-detail]").forEach((btn) => btn.addEventListener("click", () => {
    state.ui ||= {};
    const key = btn.dataset.distributionDetail;
    state.ui.selectedDistribution = state.ui.selectedDistribution === key ? "" : key;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-flow-filter]").forEach((btn) => btn.addEventListener("click", () => {
    state.ui ||= {};
    state.ui.movementFlowFilter = btn.dataset.flowFilter || "all";
    saveState();
    render();
  }));
  document.querySelectorAll("[data-analysis-filter]").forEach((input) => input.addEventListener("change", () => {
    state.ui ||= {};
    state.ui.globalAnalysis ||= {};
    state.ui.globalAnalysis[input.dataset.analysisFilter] = input.value;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-analysis-reset]").forEach((btn) => btn.addEventListener("click", () => {
    state.ui ||= {};
    state.ui.globalAnalysis = {
      text: "",
      flow: "all",
      bank: "all",
      shared: "all",
      month: "active",
      day: "",
      min: "",
      max: "",
    };
    saveState();
    render();
  }));
  document.querySelectorAll("[data-projection-type]").forEach((select) => select.addEventListener("change", () => {
    state.ui ||= {};
    state.ui.projectionTypes ||= {};
    state.ui.projectionTypes[select.dataset.projectionType] = select.value;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-projection-detail]").forEach((select) => select.addEventListener("change", () => {
    state.ui ||= {};
    state.ui.projectionDetails ||= {};
    state.ui.projectionDetails[select.dataset.projectionDetail] = select.value;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-ai-model]").forEach((aiModel) => aiModel.addEventListener("change", () => {
    state.ui ||= {};
    state.ui.aiModel = aiModel.value || GROQ_MODELS[0];
    saveState();
    render();
  }));
  document.querySelectorAll("#aiChatForm, [data-ai-chat-form]").forEach((aiChatForm) => aiChatForm.addEventListener("submit", submitAiQuestion));
  document.querySelectorAll("[data-ai-question]").forEach((btn) => btn.addEventListener("click", () => {
    const prompt = document.querySelector("#aiPrompt") || document.querySelector('[name="aiPrompt"]');
    if (prompt) {
      prompt.value = btn.dataset.aiQuestion || "";
      prompt.focus();
    }
  }));
  document.querySelectorAll("[data-modal]").forEach((btn) => btn.addEventListener("click", () => { modal = btn.dataset.modal; editingId = null; render(); }));
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => { modal = null; editingId = null; render(); }));
  document.querySelectorAll("[data-collect]").forEach((btn) => btn.addEventListener("click", () => { collectReceivable(btn.dataset.collect); render(); }));
  document.querySelectorAll("[data-partial-collect]").forEach((btn) => btn.addEventListener("click", () => { partialCollectReceivable(btn.dataset.partialCollect); render(); }));
  document.querySelectorAll("[data-edit-tx]").forEach((btn) => btn.addEventListener("click", () => { editingId = btn.dataset.editTx; modal = "transaction"; render(); }));
  document.querySelectorAll("[data-share-tx]").forEach((btn) => btn.addEventListener("click", () => { editingId = btn.dataset.shareTx; modal = "share"; render(); }));
  document.querySelectorAll("[data-delete-tx]").forEach((btn) => btn.addEventListener("click", () => deleteTransaction(btn.dataset.deleteTx)));
  document.querySelectorAll("[data-toggle-deleted-partners]").forEach((btn) => btn.addEventListener("click", () => {
    state.ui ||= {};
    state.ui.showDeletedPartners = !state.ui.showDeletedPartners;
    saveState();
    render();
  }));
  document.querySelectorAll("[data-edit-goal]").forEach((btn) => btn.addEventListener("click", () => { editingId = btn.dataset.editGoal; modal = "goal"; render(); }));
  document.querySelectorAll("[data-delete-goal]").forEach((btn) => btn.addEventListener("click", () => deleteGoal(btn.dataset.deleteGoal)));
  document.querySelectorAll("[data-edit-recurring]").forEach((btn) => btn.addEventListener("click", () => { editingId = btn.dataset.editRecurring; modal = "recurring"; render(); }));
  document.querySelectorAll("[data-delete-recurring]").forEach((btn) => btn.addEventListener("click", () => deleteRecurring(btn.dataset.deleteRecurring)));
  document.querySelectorAll("[data-edit-partner]").forEach((btn) => btn.addEventListener("click", () => { editingId = btn.dataset.editPartner; modal = "partner"; render(); }));
  document.querySelectorAll("[data-disable-partner]").forEach((btn) => btn.addEventListener("click", () => disablePartner(btn.dataset.disablePartner)));
  document.querySelectorAll("[data-candidate]").forEach((input) => input.addEventListener("change", () => {
    const item = state.importCandidates.find((c) => c.id === input.dataset.candidate);
    if (item) item.approved = input.checked;
    saveState();
  }));
  const txForm = document.querySelector("#txForm");
  if (txForm) txForm.addEventListener("submit", submitTransaction);
  const debtFormEl = document.querySelector("#debtForm");
  if (debtFormEl) debtFormEl.addEventListener("submit", submitDebt);
  const recForm = document.querySelector("#receivableForm");
  if (recForm) recForm.addEventListener("submit", submitReceivable);
  const goalFormEl = document.querySelector("#goalForm");
  if (goalFormEl) goalFormEl.addEventListener("submit", submitGoal);
  const goalTransferFormEl = document.querySelector("#goalTransferForm");
  if (goalTransferFormEl) goalTransferFormEl.addEventListener("submit", submitGoalTransfer);
  const recurringFormEl = document.querySelector("#recurringForm");
  if (recurringFormEl) recurringFormEl.addEventListener("submit", submitRecurring);
  const partnerFormEl = document.querySelector("#partnerForm");
  if (partnerFormEl) partnerFormEl.addEventListener("submit", submitPartner);
  const shareFormEl = document.querySelector("#shareForm");
  if (shareFormEl) shareFormEl.addEventListener("submit", submitShare);
  document.querySelectorAll("[data-add-share-row]").forEach((btn) => btn.addEventListener("click", () => {
    const rows = document.querySelector("#shareRows");
    if (!rows) return;
    const options = partnerOptionsHtml("");
    rows.insertAdjacentHTML("beforeend", shareRow(options, ""));
    const added = rows.lastElementChild?.querySelector("[data-remove-share-row]");
    if (added) added.addEventListener("click", () => {
      if (rows.querySelectorAll(".share-row").length > 1) added.closest(".share-row")?.remove();
    });
  }));
  document.querySelectorAll("[data-remove-share-row]").forEach((btn) => btn.addEventListener("click", () => {
    const rows = btn.closest("#shareRows");
    if (rows && rows.querySelectorAll(".share-row").length > 1) btn.closest(".share-row")?.remove();
  }));

  document.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => handleAction(btn.dataset.action)));
  document.querySelectorAll("[data-split-mode]").forEach((select) => select.addEventListener("change", () => toggleSplitFields(select)));
}

function toggleSplitFields(select) {
  const form = select.closest("form");
  const shared = select.value === "shared";
  form.querySelectorAll(".split-field").forEach((field) => field.classList.toggle("hidden", !shared));
  if (!shared) {
    const partner = form.querySelector('[name="partnerId"]');
    const percent = form.querySelector('[name="partnerSharePercent"]');
    const direction = form.querySelector('[name="splitDirection"]');
    if (partner) partner.value = "";
    if (percent) percent.value = "";
    if (direction) direction.value = "partner_owes_me";
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function normalizeSplitInput(input) {
  if (input.splitMode !== "shared") {
    input.partnerId = "";
    input.partnerSharePercent = 0;
    input.splitDirection = "partner_owes_me";
  }
  delete input.splitMode;
  return input;
}

function submitTransaction(event) {
  event.preventDefault();
  try {
    const input = normalizeSplitInput(formData(event.currentTarget));
    if (editingId) {
      const old = state.transactions.find((t) => t.id === editingId);
      if (old) Object.assign(old, input, { amount: Math.abs(Number(input.amount || 0)) });
      if (old) createPartnerReceivableFromTransaction(old);
      recomputeDebtBalances();
      saveState();
    } else {
      addTransaction(input);
    }
    modal = null;
    editingId = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function submitShare(event) {
  event.preventDefault();
  try {
    const tx = state.transactions.find((item) => item.id === editingId);
    if (!tx) throw new Error("Movimiento no encontrado.");
    const rows = [...event.currentTarget.querySelectorAll(".share-row")];
    const seen = new Set();
    const splits = rows.map((row) => ({
      partnerId: row.querySelector('[name="partnerId"]')?.value || "",
      percent: Number(row.querySelector('[name="partnerSharePercent"]')?.value || 0),
    })).filter((split) => split.partnerId && split.percent > 0);
    if (!splits.length) throw new Error("Selecciona al menos un socio y su porcentaje.");
    if (splits.some((split) => split.percent > 100)) throw new Error("Cada porcentaje debe estar entre 1 y 100.");
    const totalPercent = splits.reduce((sum, split) => sum + split.percent, 0);
    if (totalPercent > 100) throw new Error("La suma de porcentajes no puede superar 100%.");
    if (splits.some((split) => {
      if (seen.has(split.partnerId)) return true;
      seen.add(split.partnerId);
      return false;
    })) throw new Error("No repitas el mismo socio en una transaccion.");
    tx.splits = splits;
    tx.partnerId = splits[0]?.partnerId || "";
    tx.partnerSharePercent = splits[0]?.percent || 0;
    tx.splitDirection = "partner_owes_me";
    createPartnerReceivableFromTransaction(tx);
    saveState();
    modal = null;
    editingId = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function submitDebt(event) {
  event.preventDefault();
  try {
    addDebt(formData(event.currentTarget));
    modal = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function submitReceivable(event) {
  event.preventDefault();
  try {
    addReceivable(formData(event.currentTarget));
    modal = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function submitGoal(event) {
  event.preventDefault();
  try {
    const input = formData(event.currentTarget);
    input.deadline = goalDeadlineFromMonth(input.targetMonth);
    if (editingId) {
      const old = state.goals.find((goal) => goal.id === editingId);
      if (old) Object.assign(old, input, {
        targetAmount: Math.abs(Number(input.targetAmount || 0)),
        currentAmount: Math.abs(Number(input.currentAmount || 0)),
        allocationPercent: Number(input.allocationPercent || 0),
      });
      saveState();
    } else {
      addGoal(input);
    }
    modal = null;
    editingId = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function deleteGoal(id) {
  const goal = state.goals.find((item) => item.id === id);
  if (!goal) return;
  if (goal.type === "savings" && Number(goal.currentAmount || 0) > 0) {
    editingId = id;
    modal = "goalTransfer";
    render();
    return;
  }
  if (!confirm("Eliminar objetivo?")) return;
  state.goals = state.goals.filter((goal) => goal.id !== id);
  saveState();
  render();
}

function submitGoalTransfer(event) {
  event.preventDefault();
  const input = formData(event.currentTarget);
  transferAndDeleteGoal(editingId, input.targetGoalId);
  modal = null;
  editingId = null;
  render();
}

function submitRecurring(event) {
  event.preventDefault();
  try {
    const input = normalizeSplitInput(formData(event.currentTarget));
    if (editingId) updateRecurring(editingId, input);
    else addRecurring(input);
    modal = null;
    editingId = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function submitPartner(event) {
  event.preventDefault();
  try {
    const input = formData(event.currentTarget);
    if (editingId) updatePartner(editingId, input);
    else addPartner(input);
    modal = null;
    editingId = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function disablePartner(id) {
  if (!confirm("Eliminar socio de la vista principal? El historial y cobranzas se conservan.")) return;
  const partner = state.partners.find((item) => item.id === id);
  if (!partner) return;
  partner.active = false;
  partner.deletedAt = new Date().toISOString().slice(0, 10);
  saveState();
  render();
}

function deleteTransaction(id) {
  if (!confirm("Eliminar movimiento? Los pasivos se recalcularan desde el libro de movimientos.")) return;
  state.transactions = state.transactions.filter((tx) => tx.id !== id);
  recomputeDebtBalances();
  saveState();
  render();
}

function handleAction(action) {
  if (action === "logout") {
    signOutGoogle();
  }
  if (action === "open-reset") {
    modal = "resetConfirm";
    render();
  }
  if (action === "reset-delete") {
    resetAll();
  }
  if (action === "reset-backup") {
    exportJson();
  }
  if (action === "toggle-mask") {
    state.profile.privacyMask = !state.profile.privacyMask;
    saveState();
    render();
  }
  if (action === "clear-ai-chat") {
    state.ui ||= {};
    state.ui.aiChat = [];
    state.ui.aiBusy = false;
    saveState();
    render();
  }
  if (action === "toggle-floating-ai") {
    state.ui ||= {};
    state.ui.aiFloatingOpen = !state.ui.aiFloatingOpen;
    saveState();
    render();
  }
  if (action === "parse-import") {
    const text = document.querySelector("#importText").value;
    state.importCandidates = parseImportText(text);
    state.importDiagnostics = {
      sourceRows: text.split(/\r?\n/).filter((line) => line.trim()).length,
      validRows: state.importCandidates.length,
      skippedRows: [],
      headers: [],
    };
    saveState();
    render();
  }
  if (action === "download-template") {
    downloadExcelTemplate();
  }
  if (action === "read-template") {
    readTemplateFile();
  }
  if (action === "save-projection") {
    const series = projectedYearSeries();
    const detailTotals = {};
    projectionRowsForMonth().forEach((tx) => {
      const key = projectionDetailFor(tx);
      detailTotals[key] = (detailTotals[key] || 0) + Number(tx.amount || 0);
    });
    state.ui.lastProjectionSaved = {
      month: activeMonth(),
      savedAt: new Date().toISOString(),
      nextIncome: series[0]?.income || 0,
      nextExpense: series[0]?.expense || 0,
      nextBalance: series[0]?.balance || 0,
      detailTotals,
    };
    saveState();
    showToast("Proyeccion guardada. Puedes volver a ajustar las clasificaciones cuando quieras.", "success");
  }
  if (action === "commit-import") {
    const approved = state.importCandidates.filter((c) => c.approved && !c.duplicate);
    const imported = [];
    const errors = [];
    approved.forEach((c) => {
      try {
        addTransaction({ ...c, source: "archivo modelo" });
        imported.push(c);
      } catch (error) {
        errors.push({ description: c.description, message: error.message || String(error) });
      }
    });
    state.ui.lastImportSummary = importSavedSummary(imported, errors);
    state.importCandidates = [];
    state.importDiagnostics = null;
    modal = "importSaved";
    saveState();
    render();
  }
  if (action === "close-month") {
    closeMonth(activeMonth());
    render();
  }
  if (action === "export-json") exportJson();
  if (action === "import-json") importJson();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finanzas-claras-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function readTemplateFile() {
  const file = document.querySelector("#templateFile")?.files?.[0];
  if (!file) return showToast("Selecciona el archivo modelo completado.", "warning");
  const isWorkbook = /\.(xlsx|xls)$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = isWorkbook
        ? parseExcelModelWorkbook(reader.result)
        : parseExcelModelText(String(reader.result || ""));
      const candidates = result.candidates || [];
      state.importCandidates = candidates;
      state.importDiagnostics = result.diagnostics || {
        sourceRows: candidates.length,
        validRows: candidates.length,
        skippedRows: [],
        headers: [],
      };
      saveState();
      render();
      if (!candidates.length) showToast("No se encontraron filas validas. Revisa encabezados y montos.", "warning");
    } catch (error) {
      showToast(error.message, "error");
    }
  };
  if (isWorkbook) reader.readAsArrayBuffer(file);
  else reader.readAsText(file, "utf-8");
}

function importJson() {
  const file = document.querySelector("#backupFile")?.files?.[0];
  if (!file) return showToast("Selecciona un archivo JSON.", "warning");
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (!incoming.transactions || !incoming.profile) throw new Error("Respaldo invalido.");
      setState({ ...defaultState(), ...incoming });
      saveState();
      render();
    } catch (error) {
      showToast(error.message, "error");
    }
  };
  reader.readAsText(file);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function ensureToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    const target = document.body || document.documentElement;
    target.appendChild(container);
  }
  return container;
}

function dismissToast(toast) {
  if (!toast || toast.dataset.dismissing) return;
  toast.dataset.dismissing = "1";
  toast.classList.add("leaving");
  window.setTimeout(() => toast.remove(), 240);
}

initializeFirebaseAuth();


