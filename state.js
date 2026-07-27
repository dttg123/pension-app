'use strict';

export const APP_VERSION = '4.1.0';
export const SCHEMA_VERSION = 6;
export const STORAGE_KEY = 'pension-v1';
export const DB_NAME = 'asset-os-local';
export const DB_STORE = 'apps';
export const DB_KEY = 'pension-v1';
export const APP_ID = 'asset-os-pension';

export const now = new Date();
export const CURRENT_YEAR = now.getFullYear();
export const CURRENT_MONTH = now.getMonth() + 1;
export const CURRENT_MONTH_KEY = `${CURRENT_YEAR}-${String(CURRENT_MONTH).padStart(2, '0')}`;

export const ASSET_CLASSES = [
  { id: 'growth', name: '성장', target: 55, riskWeight: 100, color: '#4f46e5', hint: 'S&P500·나스닥·반도체 등 성장형 자산' },
  { id: 'dividend', name: '배당', target: 15, riskWeight: 85, color: '#0ea5e9', hint: '배당주·배당 ETF' },
  { id: 'bond', name: '채권', target: 20, riskWeight: 15, color: '#10b981', hint: '국채·회사채·단기채' },
  { id: 'cash', name: '현금성', target: 5, riskWeight: 0, color: '#94a3b8', hint: '예수금·머니마켓·단기 대기자금' },
  { id: 'alternative', name: '대체재', target: 5, riskWeight: 50, color: '#f59e0b', hint: '금·원자재 등 대체투자' },
];

export const ACCOUNT_CONTRACT = {
  pension: { id: 'account-pension', accountType: 'pension-savings', name: '연금저축' },
  irp: { id: 'account-irp', accountType: 'irp', name: 'IRP' },
};

export const clone = value => JSON.parse(JSON.stringify(value));
export const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const uid = (prefix = 'id') => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const isoNow = () => new Date().toISOString();
export const ymd = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const displayDate = (date = new Date()) => `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
export const formatMoney = value => `${Math.round(num(value)).toLocaleString('ko-KR')}원`;
export const compactMoney = value => {
  const n = num(value);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e12) return `${sign}${trimDecimal(a / 1e12)}조원`;
  if (a >= 1e8) return `${sign}${trimDecimal(a / 1e8)}억원`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ko-KR')}만원`;
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
};
export const formatPercent = value => `${num(value) > 0 ? '+' : ''}${num(value).toFixed(1)}%`;
export const parseMoney = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
export const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

function trimDecimal(value) {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.[0-9])0+$/, '');
}

export function createBlankState() {
  const created = isoNow();
  return {
    schemaVersion: SCHEMA_VERSION,
    appId: APP_ID,
    dataId: uid('pension-data'),
    profile: { birthYear: 1995, age: CURRENT_YEAR - 1995 + 1, retirementAge: 65 },
    settings: {
      monthly: { pension: 500000, irp: 250000 },
      goalMonthly: 2500000,
      returnRate: 6,
      inflation: 2,
      withdrawYears: 30,
      withdrawReturn: 3.5,
      annualContributionLimit: 18000000,
      taxCreditLimit: 9000000,
      theme: 'auto',
      assetClasses: clone(ASSET_CLASSES),
    },
    ui: {
      screen: 'home',
      accountView: 'pension',
      analysisPanel: 'performance',
      annualPage: 0,
      futureScenario: null,
    },
    accounts: {
      pension: { ...ACCOUNT_CONTRACT.pension, principal: 0, cash: 0, holdings: [] },
      irp: { ...ACCOUNT_CONTRACT.irp, principal: 0, cash: 0, holdings: [] },
    },
    years: {},
    accountYears: { pension: {}, irp: {} },
    dividendsByAsset: {},
    ledger: [],
    snapshots: [],
    runtime: { contributions: {} },
    archives: { holdings: [], records: [], snapshots: [] },
    extensions: { monthlySummaries: [] },
    lastUpdated: displayDate(),
    meta: {
      createdAt: created,
      updatedAt: created,
      revision: 1,
      appVersion: APP_VERSION,
      createdWithSchema: SCHEMA_VERSION,
      migrationHistory: [],
      storage: {
        localStatus: '대기',
        lastLocalSave: '',
        lastBackup: '',
        lastRestore: '',
      },
    },
  };
}

export function normalizeState(input) {
  const original = input && typeof input === 'object' ? clone(input) : createBlankState();
  if (original.appId && original.appId !== APP_ID) throw new Error('다른 앱의 데이터입니다.');
  const state = original;
  state.appId = APP_ID;
  state.schemaVersion = SCHEMA_VERSION;
  state.dataId = String(state.dataId || uid('pension-data'));
  state.profile = { ...createBlankState().profile, ...(isObject(state.profile) ? state.profile : {}) };
  if (!Number.isInteger(num(state.profile.birthYear)) || num(state.profile.birthYear) < 1900) {
    state.profile.birthYear = CURRENT_YEAR - clamp(num(state.profile.age) || 32, 18, 90) + 1;
  }
  state.profile.age = clamp(num(state.profile.age) || CURRENT_YEAR - state.profile.birthYear + 1, 18, 100);
  state.profile.retirementAge = clamp(num(state.profile.retirementAge) || 65, state.profile.age, 95);

  const blankSettings = createBlankState().settings;
  state.settings = { ...blankSettings, ...(isObject(state.settings) ? state.settings : {}) };
  state.settings.monthly = { ...blankSettings.monthly, ...(isObject(state.settings.monthly) ? state.settings.monthly : {}) };
  state.settings.annualContributionLimit = Math.max(0, num(state.settings.annualContributionLimit) || 18000000);
  state.settings.taxCreditLimit = clamp(num(state.settings.taxCreditLimit) || 9000000, 0, state.settings.annualContributionLimit || 18000000);
  state.settings.theme = ['auto', 'light', 'dark'].includes(state.settings.theme) ? state.settings.theme : 'auto';
  state.settings.assetClasses = normalizeAssetClasses(state.settings.assetClasses);

  state.ui = { ...createBlankState().ui, ...(isObject(state.ui) ? state.ui : {}) };
  state.ui.screen = ['home', 'account', 'analysis', 'future'].includes(state.ui.screen) ? state.ui.screen : 'home';
  state.ui.accountView = ['pension', 'irp'].includes(state.ui.accountView) ? state.ui.accountView : 'pension';
  state.ui.analysisPanel = ['performance', 'cashflow', 'annual', 'ai'].includes(state.ui.analysisPanel) ? state.ui.analysisPanel : 'performance';
  state.ui.annualPage = Math.max(0, Math.floor(num(state.ui.annualPage)));

  state.accounts = isObject(state.accounts) ? state.accounts : {};
  for (const key of Object.keys(ACCOUNT_CONTRACT)) {
    const contract = ACCOUNT_CONTRACT[key];
    const account = isObject(state.accounts[key]) ? state.accounts[key] : {};
    account.id = contract.id;
    account.accountType = contract.accountType;
    account.name = account.name || contract.name;
    account.principal = Math.max(0, num(account.principal));
    account.cash = Math.max(0, num(account.cash));
    account.holdings = Array.isArray(account.holdings) ? account.holdings.map(h => normalizeHolding(h, key)).filter(Boolean) : [];
    state.accounts[key] = account;
  }

  state.years = isObject(state.years) ? state.years : {};
  for (const [year, row] of Object.entries(state.years)) state.years[year] = normalizeYear(row, Number(year));
  state.accountYears = isObject(state.accountYears) ? state.accountYears : { pension: {}, irp: {} };
  state.accountYears.pension = isObject(state.accountYears.pension) ? state.accountYears.pension : {};
  state.accountYears.irp = isObject(state.accountYears.irp) ? state.accountYears.irp : {};
  state.dividendsByAsset = isObject(state.dividendsByAsset) ? state.dividendsByAsset : {};
  state.ledger = Array.isArray(state.ledger) ? state.ledger.map(normalizeLedgerRecord).filter(Boolean) : [];
  state.snapshots = Array.isArray(state.snapshots) ? state.snapshots : [];
  state.runtime = isObject(state.runtime) ? state.runtime : {};
  state.runtime.contributions = isObject(state.runtime.contributions) ? state.runtime.contributions : {};
  state.archives = isObject(state.archives) ? state.archives : {};
  state.archives.holdings = Array.isArray(state.archives.holdings) ? state.archives.holdings : [];
  state.archives.records = Array.isArray(state.archives.records) ? state.archives.records : [];
  state.archives.snapshots = Array.isArray(state.archives.snapshots) ? state.archives.snapshots : [];
  state.extensions = isObject(state.extensions) ? state.extensions : {};
  state.extensions.monthlySummaries = Array.isArray(state.extensions.monthlySummaries) ? state.extensions.monthlySummaries : [];
  state.meta = isObject(state.meta) ? state.meta : {};
  state.meta.createdAt = validIso(state.meta.createdAt, isoNow());
  state.meta.updatedAt = validIso(state.meta.updatedAt, isoNow());
  state.meta.revision = Math.max(1, Math.floor(num(state.meta.revision) || 1));
  state.meta.appVersion = APP_VERSION;
  state.meta.createdWithSchema = num(state.meta.createdWithSchema) || SCHEMA_VERSION;
  state.meta.migrationHistory = Array.isArray(state.meta.migrationHistory) ? state.meta.migrationHistory : [];
  state.meta.storage = { ...createBlankState().meta.storage, ...(isObject(state.meta.storage) ? state.meta.storage : {}) };
  state.lastUpdated = state.lastUpdated || displayDate();
  return state;
}

function normalizeAssetClasses(input) {
  const source = Array.isArray(input) ? input : [];
  const aliases = { gold: 'alternative', alternative: 'alternative', growth: 'growth', dividend: 'dividend', bond: 'bond', cash: 'cash' };
  const targetById = {};
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const id = aliases[item.id] || aliases[String(item.name || '').toLowerCase()];
    if (!id) continue;
    targetById[id] = num(targetById[id]) + Math.max(0, num(item.target));
  }
  const result = ASSET_CLASSES.map(base => ({ ...base, target: targetById[base.id] || base.target }));
  const total = result.reduce((sum, item) => sum + item.target, 0);
  if (Math.abs(total - 100) > 0.01 && total > 0) {
    let running = 0;
    result.forEach((item, index) => {
      item.target = index === result.length - 1 ? Math.max(0, 100 - running) : Math.round(item.target / total * 1000) / 10;
      running += item.target;
    });
  }
  return result;
}

function normalizeHolding(value, accountKey) {
  if (!value || typeof value !== 'object') return null;
  const classMap = { gold: 'alternative', alternative: 'alternative', growth: 'growth', dividend: 'dividend', bond: 'bond', cash: 'cash' };
  const name = String(value.name || value.assetName || '').trim();
  if (!name) return null;
  const cls = classMap[value.class] || guessAssetClass(name);
  return {
    ...value,
    id: String(value.id || uid(`holding-${accountKey}`)),
    accountId: ACCOUNT_CONTRACT[accountKey].id,
    name,
    class: cls,
    value: Math.max(0, num(value.value)),
    cost: Math.max(0, num(value.cost)),
    qty: Math.max(0, num(value.qty ?? value.quantity)),
    dividend: num(value.dividend),
    realized: num(value.realized),
    risk: accountKey === 'irp' ? (typeof value.risk === 'boolean' ? value.risk : assetClassById(cls).riskWeight >= 70) : undefined,
    status: value.status || 'active',
    createdAt: validIso(value.createdAt, isoNow()),
    updatedAt: validIso(value.updatedAt, isoNow()),
  };
}

function normalizeLedgerRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const accountKey = value.accountKey || Object.keys(ACCOUNT_CONTRACT).find(key => ACCOUNT_CONTRACT[key].id === value.accountId) || '';
  return {
    ...value,
    id: String(value.id || uid(value.type || 'record')),
    type: String(value.type || 'note'),
    date: validIso(value.date || value.createdAt, isoNow()),
    accountKey,
    accountId: accountKey ? ACCOUNT_CONTRACT[accountKey].id : String(value.accountId || ''),
    assetId: String(value.assetId || ''),
    assetName: String(value.assetName || ''),
    amount: num(value.amount),
    quantity: num(value.quantity),
    principalDelta: num(value.principalDelta),
    cashDelta: num(value.cashDelta),
    fee: num(value.fee),
    tax: num(value.tax),
    status: value.status || 'active',
    createdAt: validIso(value.createdAt || value.date, isoNow()),
    updatedAt: validIso(value.updatedAt || value.createdAt || value.date, isoNow()),
    extensions: isObject(value.extensions) ? value.extensions : {},
  };
}

function normalizeYear(value, year) {
  const row = isObject(value) ? value : {};
  return {
    ...row,
    year,
    start: num(row.start),
    end: num(row.end),
    cumulative: num(row.cumulative),
    contribution: num(row.contribution),
    operating: num(row.operating),
    realized: num(row.realized),
    return: num(row.return),
    dividend: num(row.dividend),
    reinvested: num(row.reinvested),
    monthly: Array.from({ length: 12 }, (_, i) => num(Array.isArray(row.monthly) ? row.monthly[i] : 0)),
  };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validIso(value, fallback) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

export function assetClassById(id, state = null) {
  const classes = state?.settings?.assetClasses || ASSET_CLASSES;
  return classes.find(item => item.id === id) || classes[0] || ASSET_CLASSES[0];
}

export function guessAssetClass(name) {
  const text = String(name || '').toLowerCase();
  if (/배당|다우존스|dividend|커버드콜/.test(text)) return 'dividend';
  if (/채권|국채|머니마켓|단기금리|mmf|cd금리|종합채권/.test(text)) return 'bond';
  if (/금|gold|원자재|원유|은선물/.test(text)) return 'alternative';
  if (/현금|예수금/.test(text)) return 'cash';
  return 'growth';
}

export function accountTotal(account) {
  return Math.max(0, num(account?.cash)) + (account?.holdings || []).reduce((sum, item) => sum + Math.max(0, num(item.value)), 0);
}

export function totalAsset(state) {
  return Object.values(state.accounts || {}).reduce((sum, account) => sum + accountTotal(account), 0);
}

export function totalPrincipal(state) {
  return Object.values(state.accounts || {}).reduce((sum, account) => sum + Math.max(0, num(account.principal)), 0);
}

export function totalProfit(state) {
  return totalAsset(state) - totalPrincipal(state);
}

export function holdingProfit(holding) {
  return num(holding.value) - num(holding.cost) + num(holding.realized) + num(holding.dividend);
}

export function allocation(state, accountKey = 'all') {
  const classes = state.settings.assetClasses;
  const values = Object.fromEntries(classes.map(item => [item.id, 0]));
  const accounts = accountKey === 'all' ? Object.values(state.accounts) : [state.accounts[accountKey]];
  let cash = 0;
  for (const account of accounts) {
    if (!account) continue;
    cash += num(account.cash);
    for (const holding of account.holdings || []) {
      const id = values[holding.class] !== undefined ? holding.class : guessAssetClass(holding.name);
      values[id] += num(holding.value);
    }
  }
  values.cash = num(values.cash) + cash;
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return classes.map(item => ({
    ...item,
    value: values[item.id] || 0,
    current: total ? (values[item.id] || 0) / total * 100 : 0,
    gap: item.target - (total ? (values[item.id] || 0) / total * 100 : 0),
  }));
}

export function irpRiskRatio(state) {
  const account = state.accounts.irp;
  const total = accountTotal(account);
  const risk = (account.holdings || []).reduce((sum, item) => sum + (item.risk ? num(item.value) : 0), 0);
  return total ? risk / total * 100 : 0;
}

export function annualContribution(state, year = CURRENT_YEAR) {
  const activeLedger = (state.ledger || []).filter(item => item.status !== 'void' && item.type === 'contribution' && new Date(item.date).getFullYear() === Number(year));
  if (activeLedger.length) return activeLedger.reduce((sum, item) => sum + Math.max(0, num(item.amount)), 0);
  return Math.max(0, num(state.years?.[year]?.contribution));
}

export function currentContributionStatus(state, monthKey = CURRENT_MONTH_KEY) {
  const preset = state.runtime?.contributions?.[monthKey] || {};
  const result = { pension: Boolean(preset.pension), irp: Boolean(preset.irp) };
  for (const row of state.ledger || []) {
    if (row.status === 'void' || row.type !== 'contribution') continue;
    if (String(row.date).slice(0, 7) !== monthKey) continue;
    if (row.accountKey === 'pension' || row.accountKey === 'irp') result[row.accountKey] = true;
  }
  return result;
}

export function futureProjection(state, custom = null) {
  const cfg = {
    monthly: num(state.settings.monthly.pension) + num(state.settings.monthly.irp),
    rate: num(state.settings.returnRate),
    retirementAge: num(state.profile.retirementAge),
    inflation: num(state.settings.inflation),
    withdrawYears: num(state.settings.withdrawYears),
    withdrawReturn: num(state.settings.withdrawReturn),
    ...(custom || {}),
  };
  const years = Math.max(0, cfg.retirementAge - num(state.profile.age));
  const monthlyRate = Math.pow(Math.max(0.01, 1 + cfg.rate / 100), 1 / 12) - 1;
  let balance = totalAsset(state);
  const checkpoints = [{ age: num(state.profile.age), asset: balance }];
  for (let month = 1; month <= years * 12; month += 1) {
    balance = balance * (1 + monthlyRate) + cfg.monthly;
    if (month % 60 === 0 || month === years * 12) checkpoints.push({ age: num(state.profile.age) + month / 12, asset: balance });
  }
  const inflationFactor = Math.pow(Math.max(0.01, 1 + cfg.inflation / 100), years);
  const todayAsset = balance / inflationFactor;
  const annualReal = (1 + cfg.withdrawReturn / 100) / (1 + cfg.inflation / 100) - 1;
  const months = Math.max(1, cfg.withdrawYears * 12);
  const r = Math.pow(Math.max(0.01, 1 + annualReal), 1 / 12) - 1;
  const denominator = 1 - Math.pow(1 + r, -months);
  const monthlyPension = Math.abs(r) > 1e-10 && Math.abs(denominator) > 1e-10 ? todayAsset * r / denominator : todayAsset / months;
  return { ...cfg, years, asset: balance, todayAsset, monthlyPension, checkpoints };
}

export function portfolioHealth(state) {
  const alloc = allocation(state);
  const total = totalAsset(state);
  const holdings = Object.values(state.accounts).flatMap(account => account.holdings || []);
  const topValue = holdings.length ? Math.max(...holdings.map(item => num(item.value))) : 0;
  const topPct = total ? topValue / total * 100 : 0;
  const targetError = alloc.reduce((sum, item) => sum + Math.abs(item.current - item.target), 0) / 2;
  const years = Object.values(state.years || {});
  const returns = years.map(row => num(row.return));
  const average = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length : 0;
  const volatility = Math.sqrt(variance);
  const cashPct = total ? (num(state.accounts.pension.cash) + num(state.accounts.irp.cash)) / total * 100 : 0;
  const diversification = clamp(100 - Math.max(0, topPct - 20) * 2.5 - Math.max(0, 4 - holdings.length) * 8, 0, 100);
  const balance = clamp(100 - targetError * 2.1, 0, 100);
  const stability = clamp(100 - Math.max(0, volatility - 5) * 3 - Math.max(0, irpRiskRatio(state) - 70) * 1.5, 0, 100);
  const discipline = clamp((num(state.settings.monthly.pension) + num(state.settings.monthly.irp) > 0 ? 75 : 35) + Math.min(25, annualContribution(state) / Math.max(1, state.settings.taxCreditLimit) * 25), 0, 100);
  const liquidity = clamp(cashPct > 20 ? 70 : cashPct < 1 ? 65 : 90, 0, 100);
  const score = Math.round(diversification * 0.22 + balance * 0.28 + stability * 0.2 + discipline * 0.2 + liquidity * 0.1);
  return { score, diversification, balance, stability, discipline, liquidity, topPct, targetError, volatility, cashPct };
}

export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') errors.push('데이터가 객체가 아닙니다.');
  if (state.appId !== APP_ID) errors.push('앱 식별자가 다릅니다.');
  if (num(state.schemaVersion) !== SCHEMA_VERSION) errors.push(`데이터 구조 버전이 ${SCHEMA_VERSION}이 아닙니다.`);
  const ids = new Set();
  const checkId = (id, label) => {
    if (!id) errors.push(`${label} 고유번호가 없습니다.`);
    else if (ids.has(id)) errors.push(`${label} 고유번호가 중복되었습니다: ${id}`);
    else ids.add(id);
  };
  checkId(state.dataId, '데이터');
  for (const [key, account] of Object.entries(state.accounts || {})) {
    checkId(account.id, `${key} 계좌`);
    if (num(account.principal) < 0) errors.push(`${account.name} 원금이 음수입니다.`);
    if (num(account.cash) < 0) errors.push(`${account.name} 현금이 음수입니다.`);
    for (const holding of account.holdings || []) {
      checkId(holding.id, `${account.name} 종목`);
      if (!holding.name) errors.push(`${account.name} 종목명이 비어 있습니다.`);
      if (num(holding.qty) < 0 || num(holding.value) < 0 || num(holding.cost) < 0) errors.push(`${holding.name} 수량·금액에 음수가 있습니다.`);
    }
  }
  for (const row of state.ledger || []) {
    checkId(row.id, '원장');
    if (Number.isNaN(Date.parse(row.date))) errors.push(`원장 날짜가 잘못되었습니다: ${row.id}`);
    if (row.accountKey && !state.accounts[row.accountKey]) errors.push(`원장 계좌 연결이 잘못되었습니다: ${row.id}`);
  }
  try { JSON.stringify(state); } catch (error) { errors.push(`JSON 변환 실패: ${error.message}`); }
  return { ok: errors.length === 0, errors };
}
