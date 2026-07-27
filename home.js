'use strict';

import {
  CURRENT_MONTH_KEY, accountTotal, annualContribution, compactMoney, currentContributionStatus,
  formatMoney, formatPercent, futureProjection, totalAsset, totalPrincipal, totalProfit,
} from './state.js';

export function renderHome(container, ctx) {
  const state = ctx.state();
  const total = totalAsset(state);
  const principal = totalPrincipal(state);
  const profit = totalProfit(state);
  const profitRate = principal ? profit / principal * 100 : 0;
  const status = currentContributionStatus(state);
  const projection = futureProjection(state);
  const yearly = annualContribution(state);
  const taxLimit = Number(state.settings.taxCreditLimit) || 0;
  const remaining = Math.max(0, taxLimit - yearly);
  const holdingCount = Object.values(state.accounts).reduce((sum, account) => sum + account.holdings.length, 0);

  container.innerHTML = `
    <section class="heroCard">
      <div class="eyebrow">개인연금 총자산</div>
      <div class="heroValue">${formatMoney(total)}</div>
      <div class="heroMeta">
        <span>누적 원금 ${compactMoney(principal)}</span>
        <b class="${profit >= 0 ? 'good' : 'bad'}">${profit >= 0 ? '+' : ''}${formatMoney(profit)} · ${formatPercent(profitRate)}</b>
      </div>
      <div class="heroAccounts">
        <button data-account="pension"><span>연금저축</span><b>${compactMoney(accountTotal(state.accounts.pension))}</b></button>
        <button data-account="irp"><span>IRP</span><b>${compactMoney(accountTotal(state.accounts.irp))}</b></button>
      </div>
    </section>

    <section class="homeGrid">
      <button class="infoCard actionCard" id="quickContribution">
        <div class="cardIcon">₩</div>
        <div><small>${CURRENT_MONTH_KEY} 납입</small><b>${status.pension && status.irp ? '두 계좌 완료' : '빠르게 기록하기'}</b><span>연금저축·IRP를 한 번에 저장</span></div>
        <i>›</i>
      </button>
      <button class="infoCard actionCard" id="futureCard">
        <div class="cardIcon">◎</div>
        <div><small>예상 월연금</small><b>${compactMoney(projection.monthlyPension)}</b><span>${projection.retirementAge}세 개시 · 오늘 돈 가치</span></div>
        <i>›</i>
      </button>
    </section>

    <section class="sectionCard">
      <div class="sectionHead"><div><small>올해 납입</small><h2>${compactMoney(yearly)}</h2></div><span>${taxLimit ? `세액공제 설정 한도까지 ${compactMoney(remaining)}` : '설정에서 한도를 입력하세요'}</span></div>
      <div class="progress"><i style="width:${taxLimit ? Math.min(100, yearly / taxLimit * 100) : 0}%"></i></div>
    </section>

    <section class="sectionCard compactList">
      <div class="sectionHead"><div><small>현재 상태</small><h2>보유상품 ${holdingCount}개</h2></div><button class="textButton" id="goAccount">계좌 보기</button></div>
      <div class="statusRows">
        <div><span>연금저축 이번 달</span><b class="${status.pension ? 'good' : 'muted'}">${status.pension ? '완료' : '미입력'}</b></div>
        <div><span>IRP 이번 달</span><b class="${status.irp ? 'good' : 'muted'}">${status.irp ? '완료' : '미입력'}</b></div>
        <div><span>마지막 기기 저장</span><b>${state.meta.storage?.lastLocalSave || '저장 전'}</b></div>
      </div>
    </section>
  `;

  container.querySelectorAll('[data-account]').forEach(button => {
    button.onclick = () => ctx.navigate('account', button.dataset.account);
  });
  container.querySelector('#quickContribution').onclick = () => ctx.input.open('contribution');
  container.querySelector('#futureCard').onclick = () => ctx.navigate('future');
  container.querySelector('#goAccount').onclick = () => ctx.navigate('account');
}
