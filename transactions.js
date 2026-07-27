'use strict';

import {
  ACCOUNT_CONTRACT, CURRENT_MONTH, CURRENT_MONTH_KEY, CURRENT_YEAR, accountTotal, annualContribution, assetClassById,
  clone, guessAssetClass, isoNow, num, totalAsset, totalPrincipal, uid, ymd,
} from './state.js';
import { updateState } from './storage.js';

export async function recordContributions(entries, date = ymd()) {
  const recordDate = assertRecordDate(date);
  const valid = Object.entries(entries).filter(([key, amount]) => ACCOUNT_CONTRACT[key] && num(amount) > 0);
  if (!valid.length) throw new Error('납입할 금액을 입력하세요.');
  const monthKey = recordDate.slice(0, 7);
  await updateState(state => {
    const annualUsed = annualContribution(state, Number(recordDate.slice(0, 4)));
    const incoming = valid.reduce((sum, [, amount]) => sum + num(amount), 0);
    if (annualUsed + incoming > num(state.settings.annualContributionLimit)) throw new Error('연간 납입 한도를 초과합니다.');
    state.runtime.contributions[monthKey] = state.runtime.contributions[monthKey] || {};
    for (const [key, amountRaw] of valid) {
      const amount = num(amountRaw);
      const duplicate = Boolean(state.runtime?.contributions?.[monthKey]?.[key]) || state.ledger.some(row => row.status !== 'void' && row.type === 'contribution' && row.accountKey === key && String(row.date).slice(0, 7) === monthKey);
      if (duplicate) throw new Error(`${ACCOUNT_CONTRACT[key].name}은 ${monthKey} 납입이 이미 기록되어 있습니다.`);
      const account = state.accounts[key];
      account.principal += amount;
      account.cash += amount;
      state.runtime.contributions[monthKey][key] = true;
      addLedger(state, {
        type: 'contribution', date: recordDate, accountKey: key, amount, principalDelta: amount, cashDelta: amount,
        note: '연금계좌 납입', source: 'v4-quick-contribution',
      });
    }
    refreshCurrentYear(state);
  }, 'contribution');
}

export async function buyAsset(payload) {
  const { accountKey, holdingId, name, classId, quantity, amount, date = ymd(), riskMode = 'auto' } = payload;
  const recordDate = assertRecordDate(date);
  const qty = num(quantity);
  const purchase = num(amount);
  if (!ACCOUNT_CONTRACT[accountKey]) throw new Error('계좌를 확인하세요.');
  if (qty <= 0 || purchase <= 0) throw new Error('수량과 매수금액을 0보다 크게 입력하세요.');
  await updateState(state => {
    const account = state.accounts[accountKey];
    if (account.cash < purchase) throw new Error('대기자금보다 큰 금액은 매수할 수 없습니다.');
    let holding = account.holdings.find(item => item.id === holdingId);
    if (!holding) {
      const cleanName = String(name || '').trim();
      if (!cleanName) throw new Error('종목명을 입력하세요.');
      if (account.holdings.some(item => item.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('같은 종목이 이미 있습니다. 기존 종목을 선택하세요.');
      const resolvedClass = classId || guessAssetClass(cleanName);
      holding = {
        id: uid(`holding-${accountKey}`), accountId: account.id, name: cleanName, class: resolvedClass,
        qty: 0, value: 0, cost: 0, dividend: 0, realized: 0,
        risk: accountKey === 'irp' ? (riskMode === 'risk' || (riskMode === 'auto' && assetClassById(resolvedClass, state).riskWeight >= 70)) : undefined,
        status: 'active', createdAt: isoNow(), updatedAt: isoNow(),
      };
      account.holdings.push(holding);
    }
    account.cash -= purchase;
    holding.qty += qty;
    holding.cost += purchase;
    holding.value += purchase;
    holding.updatedAt = isoNow();
    addLedger(state, {
      type: 'buy', date: recordDate, accountKey, assetId: holding.id, assetName: holding.name,
      amount: purchase, quantity: qty, cashDelta: -purchase,
      extensions: { costDelta: purchase, valueDelta: purchase }, note: '매수', source: 'v4-buy',
    });
    refreshCurrentYear(state);
  }, 'buy');
}

export async function sellAsset(payload) {
  const { accountKey, holdingId, quantity, proceeds, fee = 0, tax = 0, date = ymd() } = payload;
  const recordDate = assertRecordDate(date);
  const qty = num(quantity);
  const gross = num(proceeds);
  const feeAmount = Math.max(0, num(fee));
  const taxAmount = Math.max(0, num(tax));
  if (qty <= 0 || gross <= 0) throw new Error('매도 수량과 매도금액을 0보다 크게 입력하세요.');
  await updateState(state => {
    const account = state.accounts[accountKey];
    const holding = account?.holdings.find(item => item.id === holdingId);
    if (!holding) throw new Error('매도할 종목을 선택하세요.');
    if (qty > holding.qty + 1e-9) throw new Error('보유 수량보다 많이 매도할 수 없습니다.');
    const ratio = holding.qty > 0 ? qty / holding.qty : 0;
    const costBasis = holding.cost * ratio;
    const valueReduction = holding.value * ratio;
    const net = gross - feeAmount - taxAmount;
    if (net < 0) throw new Error('수수료와 세금이 매도 대금보다 클 수 없습니다.');
    const realized = net - costBasis;
    account.cash += Math.max(0, net);
    holding.qty = Math.max(0, holding.qty - qty);
    holding.cost = Math.max(0, holding.cost - costBasis);
    holding.value = Math.max(0, holding.value - valueReduction);
    holding.realized += realized;
    holding.updatedAt = isoNow();
    addLedger(state, {
      type: 'sell', date: recordDate, accountKey, assetId: holding.id, assetName: holding.name,
      amount: gross, quantity: qty, fee: feeAmount, tax: taxAmount, cashDelta: net,
      extensions: { costBasis, realizedProfit: realized, valueDelta: -valueReduction }, note: '매도', source: 'v4-sell',
    });
    if (holding.qty <= 1e-9) archiveAndRemoveHolding(state, accountKey, holding.id, 'sold-out');
    refreshCurrentYear(state);
  }, 'sell');
}

export async function recordDividend(payload) {
  const { accountKey, holdingId, amount, date = ymd() } = payload;
  const recordDate = assertRecordDate(date);
  const cash = num(amount);
  if (cash <= 0) throw new Error('분배금은 0원보다 크게 입력하세요.');
  await updateState(state => {
    const account = state.accounts[accountKey];
    const holding = account?.holdings.find(item => item.id === holdingId);
    if (!holding) throw new Error('종목을 선택하세요.');
    account.cash += cash;
    holding.dividend += cash;
    holding.updatedAt = isoNow();
    addLedger(state, {
      type: 'dividend', date: recordDate, accountKey, assetId: holding.id, assetName: holding.name,
      amount: cash, cashDelta: cash, note: '배당·분배금', source: 'v4-dividend',
    });
    refreshCurrentYear(state);
  }, 'dividend');
}

export async function addOrUpdateHolding(payload) {
  const { accountKey, holdingId, name, classId, qty, value, cost, riskMode = 'auto' } = payload;
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('종목명을 입력하세요.');
  if ([qty, value, cost].some(item => num(item) < 0)) throw new Error('수량과 금액은 음수로 입력할 수 없습니다.');
  await updateState(state => {
    const account = state.accounts[accountKey];
    if (!account) throw new Error('계좌를 확인하세요.');
    const duplicate = account.holdings.find(item => item.id !== holdingId && item.name.toLowerCase() === cleanName.toLowerCase());
    if (duplicate) throw new Error('같은 계좌에 동일한 종목이 있습니다.');
    let holding = account.holdings.find(item => item.id === holdingId);
    if (!holding) {
      holding = { id: uid(`holding-${accountKey}`), accountId: account.id, dividend: 0, realized: 0, status: 'active', createdAt: isoNow() };
      account.holdings.push(holding);
    }
    const resolvedClass = classId || guessAssetClass(cleanName);
    Object.assign(holding, {
      name: cleanName, class: resolvedClass, qty: num(qty), value: num(value), cost: num(cost), updatedAt: isoNow(),
      risk: accountKey === 'irp' ? (riskMode === 'risk' || (riskMode === 'auto' && assetClassById(resolvedClass, state).riskWeight >= 70)) : undefined,
    });
    refreshCurrentYear(state);
  }, holdingId ? 'holding-update' : 'holding-add');
}

export async function deleteHolding(accountKey, holdingId) {
  await updateState(state => {
    const account = state.accounts[accountKey];
    const holding = account?.holdings.find(item => item.id === holdingId);
    if (!holding) throw new Error('삭제할 종목을 찾지 못했습니다.');
    archiveAndRemoveHolding(state, accountKey, holdingId, 'manual-delete');
    refreshCurrentYear(state);
  }, 'holding-delete');
}

export async function applySnapshot(accountKey, rows, total = 0, date = ymd()) {
  const recordDate = assertRecordDate(date);
  if (!ACCOUNT_CONTRACT[accountKey]) throw new Error('계좌를 확인하세요.');
  if (!Array.isArray(rows) || !rows.length) throw new Error('반영할 종목이 없습니다.');
  const names = rows.map(row => String(row.name || '').trim());
  const duplicate = names.find((name, index) => name && names.indexOf(name) !== index);
  if (duplicate) throw new Error(`중복 종목을 확인하세요: ${duplicate}`);
  if (rows.some(row => !String(row.name || '').trim() || num(row.qty) < 0 || num(row.value) < 0 || num(row.cost) < 0)) throw new Error('종목명·수량·금액을 확인하세요.');
  const sum = rows.reduce((totalValue, row) => totalValue + num(row.value), 0);
  const accountTotalValue = num(total) || sum;
  if (accountTotalValue < sum) throw new Error('계좌 총액이 종목 평가금액 합계보다 작습니다.');
  await updateState(state => {
    const account = state.accounts[accountKey];
    const previous = Object.fromEntries(account.holdings.map(item => [item.name, item]));
    for (const old of account.holdings) {
      if (!names.includes(old.name)) state.archives.holdings.push({ ...clone(old), archivedAt: isoNow(), archiveReason: 'snapshot-replaced' });
    }
    account.holdings = rows.map(row => {
      const old = previous[row.name] || {};
      const classId = row.classId || row.class || old.class || guessAssetClass(row.name);
      return {
        ...old,
        id: old.id || uid(`holding-${accountKey}`), accountId: account.id, name: String(row.name).trim(), class: classId,
        qty: num(row.qty), value: num(row.value), cost: num(row.cost), dividend: num(old.dividend), realized: num(old.realized),
        risk: accountKey === 'irp' ? (typeof old.risk === 'boolean' ? old.risk : assetClassById(classId, state).riskWeight >= 70) : undefined,
        status: 'active', createdAt: old.createdAt || isoNow(), updatedAt: isoNow(),
      };
    });
    account.cash = accountTotalValue - sum;
    if (!account.principal) account.principal = rows.reduce((s, row) => s + num(row.cost), 0) + account.cash;
    const snapshot = {
      id: uid('snapshot'), type: 'snapshot', date: new Date(`${recordDate}T12:00:00`).toISOString(),
      accountKey, accountId: account.id, totalAsset: accountTotal(account), cash: account.cash,
      holdings: account.holdings.map(item => ({ id: item.id, name: item.name, qty: item.qty, value: item.value, cost: item.cost, class: item.class })),
      createdAt: isoNow(),
    };
    state.snapshots.push(snapshot);
    addLedger(state, { type: 'snapshot', date: recordDate, accountKey, note: '자산현황 갱신', source: 'v4-snapshot', extensions: { snapshotId: snapshot.id } });
    refreshCurrentYear(state);
  }, 'snapshot');
}

export async function updateSettings(mutator) {
  await updateState(state => mutator(state), 'settings');
}

function assertRecordDate(value) {
  const clean = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new Error('날짜를 확인하세요.');
  const parsed = new Date(`${clean}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || ymd(parsed) !== clean) throw new Error('날짜를 확인하세요.');
  if (clean > ymd()) throw new Error('미래 날짜는 기록할 수 없습니다.');
  return clean;
}

function archiveAndRemoveHolding(state, accountKey, holdingId, reason) {
  const account = state.accounts[accountKey];
  const index = account.holdings.findIndex(item => item.id === holdingId);
  if (index < 0) return;
  const [holding] = account.holdings.splice(index, 1);
  state.archives.holdings.push({ ...clone(holding), archivedAt: isoNow(), archiveReason: reason });
}

function addLedger(state, payload) {
  const accountKey = payload.accountKey || '';
  const date = new Date(`${String(payload.date || ymd()).slice(0, 10)}T12:00:00`).toISOString();
  state.ledger.push({
    id: uid(payload.type || 'record'), type: payload.type || 'note', date,
    accountKey, accountId: accountKey ? ACCOUNT_CONTRACT[accountKey].id : '',
    assetId: payload.assetId || '', assetName: payload.assetName || '',
    amount: num(payload.amount), quantity: num(payload.quantity), fee: num(payload.fee), tax: num(payload.tax),
    principalDelta: num(payload.principalDelta), cashDelta: num(payload.cashDelta),
    note: payload.note || '', source: payload.source || 'v4', status: 'active',
    createdAt: isoNow(), updatedAt: isoNow(), extensions: payload.extensions || {},
  });
}

function refreshCurrentYear(state) {
  const year = CURRENT_YEAR;
  const existing = state.years[year] || {};
  const yearRecords = state.ledger.filter(row => row.status !== 'void' && new Date(row.date).getFullYear() === year);
  const contributionFromLedger = yearRecords.filter(row => row.type === 'contribution').reduce((sum, row) => sum + Math.max(0, num(row.amount)), 0);
  const dividendFromLedger = yearRecords.filter(row => row.type === 'dividend').reduce((sum, row) => sum + Math.max(0, num(row.amount)), 0);
  const contribution = Math.max(num(existing.contribution), contributionFromLedger);
  const dividend = Math.max(num(existing.dividend), dividendFromLedger);
  const realized = yearRecords.filter(row => row.type === 'sell').reduce((sum, row) => sum + num(row.extensions?.realizedProfit), 0);
  const monthly = Array.from({ length: 12 }, (_, index) => yearRecords.filter(row => row.type === 'dividend' && new Date(row.date).getMonth() === index).reduce((sum, row) => sum + Math.max(0, num(row.amount)), 0));
  const end = totalAsset(state);
  const cumulative = totalPrincipal(state);
  const start = num(existing.start) || Math.max(0, end - contribution - (end - cumulative));
  const operating = end - start - contribution;
  const denominator = start + contribution / 2;
  state.years[year] = {
    ...existing, year, start, end, cumulative, contribution, operating, realized,
    return: denominator ? operating / denominator * 100 : 0,
    dividend, reinvested: num(existing.reinvested), monthly,
  };
}
