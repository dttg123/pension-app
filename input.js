'use strict';

import {
  ACCOUNT_CONTRACT, CURRENT_MONTH_KEY, assetClassById, escapeHtml, guessAssetClass,
  num, parseMoney, ymd,
} from './state.js';
import { getState } from './storage.js';
import {
  addOrUpdateHolding, buyAsset, recordContributions, recordDividend, sellAsset,
} from './transactions.js';
import { openOcrInput } from './ocr.js';
import { bindMoneyInput, closeModal, openModal, setBusy, toast } from './ui.js';

export function createInputController(ctx) {
  return {
    open(type, payload = {}) {
      if (type === 'menu') return openInputMenu(ctx);
      if (type === 'contribution') return openContribution(ctx);
      if (type === 'buy') return openBuy(ctx, payload);
      if (type === 'dividend') return openDividend(ctx, payload);
      if (type === 'sell') return openSell(ctx, payload);
      if (type === 'holding') return openHolding(ctx, payload);
      if (type === 'snapshot' || type === 'ocr') return openOcrInput(ctx);
      toast('지원하지 않는 입력입니다.', 'error');
    },
  };
}

function openInputMenu(ctx) {
  openModal({
    title: '기록 추가',
    size: 'compact',
    html: `
      <div class="quickMenu">
        ${menuButton('contribution', '₩', '빠른 납입', '연금저축·IRP를 한 번에')}
        ${menuButton('buy', '+', '매수', '기존 종목 또는 새 종목')}
        ${menuButton('dividend', 'D', '분배금', '현금과 누적 분배금 반영')}
        ${menuButton('sell', '−', '매도', '수량·대금·손익 반영')}
        ${menuButton('ocr', '▣', '자산현황 갱신', '사진 OCR 또는 텍스트')}
      </div>
    `,
    onMount(body, modal) {
      body.querySelectorAll('[data-input]').forEach(button => {
        button.onclick = () => {
          const type = button.dataset.input;
          modal.close();
          setTimeout(() => ctx.input.open(type), 60);
        };
      });
    },
  });
}

function menuButton(type, icon, title, subtitle) {
  return `<button class="quickItem" data-input="${type}"><span>${icon}</span><div><b>${title}</b><small>${subtitle}</small></div><i>›</i></button>`;
}

function openContribution(ctx) {
  const state = getState();
  const status = state.runtime?.contributions?.[CURRENT_MONTH_KEY] || {};
  const plans = state.settings.monthly;
  openModal({
    title: '빠른 납입',
    html: `
      <div class="sheetNotice">이번 달 납입액을 두 계좌에 한 번에 기록합니다. 저장 즉시 현금·원금·분석·미래에 반영됩니다.</div>
      <div class="field"><label for="contributionDate">납입일</label><input id="contributionDate" type="date" max="${ymd()}" value="${ymd()}"></div>
      ${contributionRow('pension', '연금저축', plans.pension, status.pension)}
      ${contributionRow('irp', 'IRP', plans.irp, status.irp)}
      <button class="btn primary full" id="saveContribution">한 번에 저장</button>
    `,
    onMount(body) {
      body.querySelectorAll('[data-money]').forEach(bindMoneyInput);
      body.querySelectorAll('[data-use]').forEach(check => {
        check.onchange = () => body.querySelector(`[data-money="${check.dataset.use}"]`).disabled = !check.checked;
      });
      body.querySelector('#saveContribution').onclick = async () => {
        const entries = {};
        for (const key of Object.keys(ACCOUNT_CONTRACT)) {
          const use = body.querySelector(`[data-use="${key}"]`);
          if (use.checked) entries[key] = parseMoney(body.querySelector(`[data-money="${key}"]`).value);
        }
        const date = body.querySelector('#contributionDate').value;
        if (!date || date > ymd()) return toast('납입일을 확인하세요.', 'error');
        const button = body.querySelector('#saveContribution');
        setBusy(button, true, '저장 중…');
        try {
          await recordContributions(entries, date);
          closeModal();
          toast('납입을 저장했습니다.');
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

function contributionRow(key, label, amount, done) {
  return `
    <div class="contributionRow ${done ? 'done' : ''}">
      <label><input type="checkbox" data-use="${key}" ${done ? 'disabled' : 'checked'}><span><b>${label}</b><small>${done ? '이번 달 입력 완료' : '월 계획 금액'}</small></span></label>
      <input data-money="${key}" inputmode="numeric" value="${done ? '' : Math.round(num(amount)).toLocaleString('ko-KR')}" ${done ? 'disabled' : ''} aria-label="${label} 납입액">
    </div>`;
}

function openBuy(ctx, payload = {}) {
  const state = getState();
  const accountKey = payload.accountKey || state.ui.accountView || 'pension';
  const holdingId = payload.holdingId || '';
  openModal({
    title: '매수 기록',
    html: `
      <div class="field"><label for="buyDate">매수일</label><input id="buyDate" type="date" max="${ymd()}" value="${ymd()}"></div>
      <div class="field"><label for="buyAccount">계좌</label><select id="buyAccount">${accountOptions(accountKey)}</select></div>
      <div class="field"><label for="buyHolding">종목</label><select id="buyHolding"></select><small id="buyCash"></small></div>
      <div id="buyNewFields" hidden>
        <div class="field"><label for="buyName">새 종목명</label><input id="buyName" maxlength="80" placeholder="종목명"></div>
        <div class="field"><label for="buyClass">자산군</label><select id="buyClass">${classOptions(state)}</select></div>
        <div class="field" id="buyRiskField" hidden><label for="buyRisk">IRP 분류</label><select id="buyRisk"><option value="auto">자산군 기준 자동</option><option value="risk">위험자산</option><option value="safe">안전자산</option></select></div>
      </div>
      <div class="twoFields">
        <div class="field"><label for="buyQty">수량</label><input id="buyQty" inputmode="decimal" placeholder="예: 2"></div>
        <div class="field"><label for="buyAmount">매수금액</label><input id="buyAmount" inputmode="numeric" placeholder="예: 100,000"></div>
      </div>
      <button class="btn primary full" id="saveBuy">매수 저장</button>
    `,
    onMount(body) {
      bindMoneyInput(body.querySelector('#buyAmount'));
      const accountSelect = body.querySelector('#buyAccount');
      const holdingSelect = body.querySelector('#buyHolding');
      const newFields = body.querySelector('#buyNewFields');
      const riskField = body.querySelector('#buyRiskField');
      const refreshHoldings = () => {
        const key = accountSelect.value;
        const account = getState().accounts[key];
        holdingSelect.innerHTML = `${account.holdings.map(item => `<option value="${item.id}" ${item.id === holdingId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}<option value="__new__">＋ 새 종목</option>`;
        if (!holdingId && !account.holdings.length) holdingSelect.value = '__new__';
        body.querySelector('#buyCash').textContent = `대기자금 ${Math.round(account.cash).toLocaleString('ko-KR')}원`;
        riskField.hidden = key !== 'irp';
        syncNew();
      };
      const syncNew = () => newFields.hidden = holdingSelect.value !== '__new__';
      accountSelect.onchange = refreshHoldings;
      holdingSelect.onchange = syncNew;
      body.querySelector('#buyName').addEventListener('input', event => {
        const guessed = guessAssetClass(event.target.value);
        body.querySelector('#buyClass').value = guessed;
      });
      refreshHoldings();
      body.querySelector('#saveBuy').onclick = async () => {
        const date = body.querySelector('#buyDate').value;
        if (!date || date > ymd()) return toast('매수일을 확인하세요.', 'error');
        const isNew = holdingSelect.value === '__new__';
        const button = body.querySelector('#saveBuy');
        setBusy(button, true, '저장 중…');
        try {
          await buyAsset({
            date,
            accountKey: accountSelect.value,
            holdingId: isNew ? '' : holdingSelect.value,
            name: body.querySelector('#buyName').value,
            classId: body.querySelector('#buyClass').value,
            riskMode: body.querySelector('#buyRisk').value,
            quantity: Number(body.querySelector('#buyQty').value),
            amount: parseMoney(body.querySelector('#buyAmount').value),
          });
          closeModal();
          toast('매수를 저장했습니다.');
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

function openDividend(ctx, payload = {}) {
  openSimpleHoldingTransaction({
    title: '분배금 기록', payload, buttonText: '분배금 저장', amountLabel: '받은 금액', amountPlaceholder: '예: 120,000',
    async submit({ accountKey, holdingId, amount, date }) { await recordDividend({ accountKey, holdingId, amount, date }); },
    success: '분배금을 저장했습니다.',
  });
}

function openSimpleHoldingTransaction({ title, payload, buttonText, amountLabel, amountPlaceholder, submit, success }) {
  const state = getState();
  const initialAccount = payload.accountKey || state.ui.accountView || 'pension';
  openModal({
    title,
    html: `
      <div class="field"><label for="simpleDate">날짜</label><input id="simpleDate" type="date" max="${ymd()}" value="${ymd()}"></div>
      <div class="field"><label for="simpleAccount">계좌</label><select id="simpleAccount">${accountOptions(initialAccount)}</select></div>
      <div class="field"><label for="simpleHolding">종목</label><select id="simpleHolding"></select></div>
      <div class="field"><label for="simpleAmount">${amountLabel}</label><input id="simpleAmount" inputmode="numeric" placeholder="${amountPlaceholder}"></div>
      <button class="btn primary full" id="simpleSave">${buttonText}</button>
    `,
    onMount(body) {
      bindMoneyInput(body.querySelector('#simpleAmount'));
      const account = body.querySelector('#simpleAccount');
      const holding = body.querySelector('#simpleHolding');
      const refresh = () => {
        const rows = getState().accounts[account.value].holdings;
        holding.innerHTML = rows.length ? rows.map(item => `<option value="${item.id}" ${item.id === payload.holdingId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('') : '<option value="">등록된 종목 없음</option>';
      };
      account.onchange = refresh;
      refresh();
      body.querySelector('#simpleSave').onclick = async () => {
        const date = body.querySelector('#simpleDate').value;
        if (!date || date > ymd()) return toast('날짜를 확인하세요.', 'error');
        const button = body.querySelector('#simpleSave');
        setBusy(button, true, '저장 중…');
        try {
          await submit({ accountKey: account.value, holdingId: holding.value, amount: parseMoney(body.querySelector('#simpleAmount').value), date });
          closeModal();
          toast(success);
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

function openSell(ctx, payload = {}) {
  const state = getState();
  const initialAccount = payload.accountKey || state.ui.accountView || 'pension';
  openModal({
    title: '매도 기록',
    html: `
      <div class="field"><label for="sellDate">매도일</label><input id="sellDate" type="date" max="${ymd()}" value="${ymd()}"></div>
      <div class="field"><label for="sellAccount">계좌</label><select id="sellAccount">${accountOptions(initialAccount)}</select></div>
      <div class="field"><label for="sellHolding">종목</label><select id="sellHolding"></select><small id="sellHoldingMeta"></small></div>
      <div class="twoFields"><div class="field"><label for="sellQty">매도 수량</label><input id="sellQty" inputmode="decimal"></div><div class="field"><label for="sellProceeds">매도 대금</label><input id="sellProceeds" inputmode="numeric"></div></div>
      <div class="twoFields"><div class="field"><label for="sellFee">수수료</label><input id="sellFee" inputmode="numeric" placeholder="0"></div><div class="field"><label for="sellTax">세금</label><input id="sellTax" inputmode="numeric" placeholder="0"></div></div>
      <button class="btn primary full" id="saveSell">매도 저장</button>
    `,
    onMount(body) {
      ['sellProceeds', 'sellFee', 'sellTax'].forEach(id => bindMoneyInput(body.querySelector(`#${id}`)));
      const account = body.querySelector('#sellAccount');
      const holding = body.querySelector('#sellHolding');
      const refresh = () => {
        const rows = getState().accounts[account.value].holdings;
        holding.innerHTML = rows.length ? rows.map(item => `<option value="${item.id}" ${item.id === payload.holdingId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('') : '<option value="">등록된 종목 없음</option>';
        syncMeta();
      };
      const syncMeta = () => {
        const item = getState().accounts[account.value].holdings.find(row => row.id === holding.value);
        body.querySelector('#sellHoldingMeta').textContent = item ? `보유 ${num(item.qty).toLocaleString('ko-KR')}주 · 평가 ${Math.round(num(item.value)).toLocaleString('ko-KR')}원` : '';
      };
      account.onchange = refresh;
      holding.onchange = syncMeta;
      refresh();
      body.querySelector('#saveSell').onclick = async () => {
        const date = body.querySelector('#sellDate').value;
        if (!date || date > ymd()) return toast('매도일을 확인하세요.', 'error');
        const button = body.querySelector('#saveSell');
        setBusy(button, true, '저장 중…');
        try {
          await sellAsset({
            date, accountKey: account.value, holdingId: holding.value,
            quantity: Number(body.querySelector('#sellQty').value),
            proceeds: parseMoney(body.querySelector('#sellProceeds').value),
            fee: parseMoney(body.querySelector('#sellFee').value),
            tax: parseMoney(body.querySelector('#sellTax').value),
          });
          closeModal();
          toast('매도를 저장했습니다.');
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

function openHolding(ctx, payload = {}) {
  const state = getState();
  const accountKey = payload.accountKey || state.ui.accountView || 'pension';
  const holding = state.accounts[accountKey].holdings.find(item => item.id === payload.holdingId);
  const cls = holding?.class || 'growth';
  const riskMode = accountKey === 'irp' ? (holding ? (holding.risk ? 'risk' : 'safe') : 'auto') : 'auto';
  openModal({
    title: holding ? '종목 수정' : '종목 추가',
    html: `
      <div class="field"><label for="holdingAccount">계좌</label><select id="holdingAccount" ${holding ? 'disabled' : ''}>${accountOptions(accountKey)}</select></div>
      <div class="field"><label for="holdingName">종목명</label><input id="holdingName" maxlength="80" value="${escapeHtml(holding?.name || '')}"></div>
      <div class="field"><label for="holdingClass">자산군</label><select id="holdingClass">${classOptions(state, cls)}</select></div>
      <div class="threeFields"><div class="field"><label for="holdingQty">수량</label><input id="holdingQty" inputmode="decimal" value="${holding ? num(holding.qty) : ''}"></div><div class="field"><label for="holdingValue">평가금액</label><input id="holdingValue" inputmode="numeric" value="${holding ? Math.round(num(holding.value)).toLocaleString('ko-KR') : ''}"></div><div class="field"><label for="holdingCost">매입금액</label><input id="holdingCost" inputmode="numeric" value="${holding ? Math.round(num(holding.cost)).toLocaleString('ko-KR') : ''}"></div></div>
      <div class="field" id="holdingRiskField" ${accountKey === 'irp' ? '' : 'hidden'}><label for="holdingRisk">IRP 분류</label><select id="holdingRisk"><option value="auto" ${riskMode === 'auto' ? 'selected' : ''}>자산군 기준 자동</option><option value="risk" ${riskMode === 'risk' ? 'selected' : ''}>위험자산</option><option value="safe" ${riskMode === 'safe' ? 'selected' : ''}>안전자산</option></select></div>
      <button class="btn primary full" id="saveHolding">${holding ? '수정 저장' : '종목 추가'}</button>
    `,
    onMount(body) {
      ['holdingValue', 'holdingCost'].forEach(id => bindMoneyInput(body.querySelector(`#${id}`)));
      const account = body.querySelector('#holdingAccount');
      const riskField = body.querySelector('#holdingRiskField');
      account.onchange = () => riskField.hidden = account.value !== 'irp';
      body.querySelector('#holdingName').addEventListener('input', event => {
        if (!holding) body.querySelector('#holdingClass').value = guessAssetClass(event.target.value);
      });
      body.querySelector('#saveHolding').onclick = async () => {
        const button = body.querySelector('#saveHolding');
        setBusy(button, true, '저장 중…');
        try {
          await addOrUpdateHolding({
            accountKey: account.value, holdingId: holding?.id || '', name: body.querySelector('#holdingName').value,
            classId: body.querySelector('#holdingClass').value, qty: Number(body.querySelector('#holdingQty').value || 0),
            value: parseMoney(body.querySelector('#holdingValue').value), cost: parseMoney(body.querySelector('#holdingCost').value),
            riskMode: body.querySelector('#holdingRisk').value,
          });
          closeModal();
          toast(holding ? '종목을 수정했습니다.' : '종목을 추가했습니다.');
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

function accountOptions(selected = 'pension') {
  return Object.entries(ACCOUNT_CONTRACT).map(([key, account]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${account.name}</option>`).join('');
}

function classOptions(state, selected = 'growth') {
  return state.settings.assetClasses.map(item => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
}
