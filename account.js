'use strict';

import {
  accountTotal, allocation, assetClassById, compactMoney, escapeHtml, formatMoney,
  formatPercent, holdingProfit, irpRiskRatio, num,
} from './state.js';
import { confirmAction, openModal, toast } from './ui.js';
import { deleteHolding } from './transactions.js';

export function renderAccount(container, ctx) {
  const state = ctx.state();
  const key = state.ui.accountView;
  const account = state.accounts[key];
  const total = accountTotal(account);
  const profit = total - num(account.principal);
  const profitRate = account.principal ? profit / account.principal * 100 : 0;
  const holdings = [...account.holdings].sort((a, b) => num(b.value) - num(a.value));

  container.innerHTML = `
    <div class="segmented accountTabs" role="tablist" aria-label="계좌 선택">
      <button role="tab" data-key="pension" class="${key === 'pension' ? 'active' : ''}" aria-selected="${key === 'pension'}">연금저축</button>
      <button role="tab" data-key="irp" class="${key === 'irp' ? 'active' : ''}" aria-selected="${key === 'irp'}">IRP</button>
    </div>

    <section class="accountSummary">
      <div><small>${escapeHtml(account.name)} 총액</small><strong>${formatMoney(total)}</strong></div>
      <div class="summaryStats">
        <span>원금 <b>${compactMoney(account.principal)}</b></span>
        <span>손익 <b class="${profit >= 0 ? 'good' : 'bad'}">${profit >= 0 ? '+' : ''}${compactMoney(profit)} · ${formatPercent(profitRate)}</b></span>
        <span>대기자금 <b>${compactMoney(account.cash)}</b></span>
        ${key === 'irp' ? `<span>위험자산 <b>${irpRiskRatio(state).toFixed(1)}%</b></span>` : ''}
      </div>
    </section>

    <section class="sectionCard holdingsCard">
      <div class="sectionHead">
        <div><small>메인</small><h2>보유상품 ${holdings.length}개</h2></div>
        <button class="textButton" id="addHolding">종목 추가</button>
      </div>
      <div class="holdingList" id="holdingList">
        ${holdings.length ? holdings.map(holding => holdingRow(holding, state)).join('') : `<button class="emptyState" id="emptyAdd"><b>보유상품이 없습니다.</b><span>종목을 직접 추가하거나 자산현황을 불러오세요.</span></button>`}
      </div>
    </section>

    <button class="allocationLaunch" id="allocationLaunch">
      <span><b>자산 구성 보기</b><small>원그래프·목표 비중·${key === 'irp' ? '위험자산' : '자산군'} 확인</small></span><i>›</i>
    </button>
  `;

  container.querySelectorAll('[data-key]').forEach(button => {
    button.onclick = () => ctx.setAccount(button.dataset.key);
  });
  container.querySelector('#addHolding').onclick = () => ctx.input.open('holding', { accountKey: key });
  container.querySelector('#emptyAdd')?.addEventListener('click', () => ctx.input.open('holding', { accountKey: key }));
  container.querySelectorAll('[data-holding]').forEach(button => {
    button.onclick = () => openHoldingDetail(key, button.dataset.holding, ctx);
  });
  container.querySelector('#allocationLaunch').onclick = () => openAllocation(key, ctx);
}

function holdingRow(holding, state) {
  const profit = holdingProfit(holding);
  const rate = holding.cost ? (holding.value - holding.cost) / holding.cost * 100 : 0;
  const cls = assetClassById(holding.class, state);
  return `
    <button class="holdingRow" data-holding="${escapeHtml(holding.id)}">
      <span class="assetDot" style="--asset:${cls.color}"></span>
      <span class="holdingMain"><b>${escapeHtml(holding.name)}</b><small>${escapeHtml(cls.name)} · ${num(holding.qty).toLocaleString('ko-KR')}주</small></span>
      <span class="holdingValue"><b>${compactMoney(holding.value)}</b><small class="${profit >= 0 ? 'good' : 'bad'}">${profit >= 0 ? '+' : ''}${compactMoney(profit)} · ${formatPercent(rate)}</small></span>
      <i>›</i>
    </button>`;
}

function openHoldingDetail(accountKey, holdingId, ctx) {
  const state = ctx.state();
  const account = state.accounts[accountKey];
  const holding = account.holdings.find(item => item.id === holdingId);
  if (!holding) return;
  const cls = assetClassById(holding.class, state);
  const profit = holdingProfit(holding);
  openModal({
    title: holding.name,
    html: `
      <div class="detailHero"><span class="assetDot large" style="--asset:${cls.color}"></span><div><small>${escapeHtml(account.name)} · ${escapeHtml(cls.name)}</small><strong>${formatMoney(holding.value)}</strong></div></div>
      <div class="detailGrid">
        <div><small>수량</small><b>${num(holding.qty).toLocaleString('ko-KR')}</b></div>
        <div><small>매입금액</small><b>${formatMoney(holding.cost)}</b></div>
        <div><small>누적 분배금</small><b>${formatMoney(holding.dividend)}</b></div>
        <div><small>총 손익</small><b class="${profit >= 0 ? 'good' : 'bad'}">${profit >= 0 ? '+' : ''}${formatMoney(profit)}</b></div>
      </div>
      <div class="actionGrid three"><button class="btn" id="detailBuy">매수</button><button class="btn" id="detailDividend">분배금</button><button class="btn" id="detailSell">매도</button></div>
      <div class="modalActions"><button class="btn" id="detailEdit">종목 수정</button><button class="btn danger ghost" id="detailDelete">삭제</button></div>
    `,
    onMount(body, modal) {
      body.querySelector('#detailBuy').onclick = () => { modal.close(); ctx.input.open('buy', { accountKey, holdingId }); };
      body.querySelector('#detailDividend').onclick = () => { modal.close(); ctx.input.open('dividend', { accountKey, holdingId }); };
      body.querySelector('#detailSell').onclick = () => { modal.close(); ctx.input.open('sell', { accountKey, holdingId }); };
      body.querySelector('#detailEdit').onclick = () => { modal.close(); ctx.input.open('holding', { accountKey, holdingId }); };
      body.querySelector('#detailDelete').onclick = async () => {
        modal.close();
        const okay = await confirmAction({ title: '종목 삭제', message: `${holding.name}을 목록에서 삭제할까요? 기록은 보관됩니다.`, confirmText: '삭제', danger: true });
        if (!okay) return;
        try { await deleteHolding(accountKey, holdingId); toast('종목을 삭제하고 보관 기록을 남겼습니다.'); } catch (error) { toast(error.message, 'error'); }
      };
    },
  });
}

function openAllocation(accountKey, ctx) {
  const state = ctx.state();
  const rows = allocation(state, accountKey);
  const active = rows.filter(row => row.value > 0);
  const gradient = active.length ? buildGradient(active) : '#e2e8f0 0 100%';
  const holdingCount = state.accounts[accountKey].holdings.length;
  openModal({
    title: `${state.accounts[accountKey].name} 자산 구성`,
    size: 'compact',
    html: `
      <div class="donutWrap">
        <div class="donut compactDonut" style="background:conic-gradient(${gradient})"><div><b>${holdingCount}</b><span>종목</span></div></div>
      </div>
      <div class="allocationList">
        ${rows.map(row => `<div><span><i style="--asset:${row.color}"></i>${escapeHtml(row.name)}</span><b>${row.current.toFixed(1)}%</b><small>목표 ${row.target}% · ${row.gap > 0 ? `${row.gap.toFixed(1)}% 부족` : `${Math.abs(row.gap).toFixed(1)}% 초과`}</small></div>`).join('')}
      </div>
      ${accountKey === 'irp' ? `<div class="sheetNotice">IRP 위험자산 비중 ${irpRiskRatio(state).toFixed(1)}% · 앱에 저장된 분류 기준입니다.</div>` : ''}
    `,
  });
}

function buildGradient(rows) {
  const total = rows.reduce((sum, row) => sum + row.current, 0) || 100;
  let cursor = 0;
  return rows.map(row => {
    const start = cursor;
    cursor += row.current / total * 100;
    return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  }).join(',');
}
