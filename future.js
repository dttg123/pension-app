'use strict';

import { compactMoney, escapeHtml, futureProjection, num } from './state.js';
import { updateState } from './storage.js';
import { bindMoneyInput, closeModal, openModal, toast } from './ui.js';

export function renderFuture(container, ctx) {
  const state = ctx.state();
  const custom = state.ui.futureScenario;
  const projection = futureProjection(state, custom);
  const base = futureProjection(state);
  const goal = num(state.settings.goalMonthly);
  const gap = projection.monthlyPension - goal;
  const scenarioLabel = custom ? '내 가정' : '기준 계획';

  container.innerHTML = `
    <section class="futureHero">
      <div class="sectionHead">
        <div><small>${scenarioLabel}</small><h2>${projection.retirementAge}세 예상</h2></div>
        <button class="btn small" id="editFuture">가정 편집</button>
      </div>
      <strong>${compactMoney(projection.asset)}</strong>
      <span>은퇴 시점 예상자산</span>
      <div class="futureKpis">
        <div><small>오늘 돈 가치 월연금</small><b>${compactMoney(projection.monthlyPension)}</b></div>
        <div><small>목표 대비</small><b class="${gap >= 0 ? 'good' : 'bad'}">${gap >= 0 ? `${compactMoney(gap)} 여유` : `${compactMoney(Math.abs(gap))} 부족`}</b></div>
      </div>
      <p>수익률 ${projection.rate}% · 물가 ${projection.inflation}% · ${projection.withdrawYears}년 수령 · 수령 중 ${projection.withdrawReturn}% 가정</p>
    </section>

    ${custom ? `<section class="sectionCard compareCard"><div class="sectionHead"><div><small>기준과 비교</small><h2>내 가정 차이</h2></div></div><div class="metricGrid"><div><small>예상자산</small><b class="${projection.asset >= base.asset ? 'good' : 'bad'}">${projection.asset >= base.asset ? '+' : ''}${compactMoney(projection.asset - base.asset)}</b></div><div><small>월연금</small><b class="${projection.monthlyPension >= base.monthlyPension ? 'good' : 'bad'}">${projection.monthlyPension >= base.monthlyPension ? '+' : ''}${compactMoney(projection.monthlyPension - base.monthlyPension)}</b></div></div></section>` : ''}

    <section class="sectionCard">
      <div class="sectionHead"><div><small>30년을 길게 펼치지 않음</small><h2>5년 단위 경로</h2></div><span>${projection.years}년</span></div>
      <div class="checkpointList">
        ${projection.checkpoints.map((point, index) => `<div><span>${Math.round(point.age)}세</span><i style="width:${Math.max(2, projection.asset ? point.asset / projection.asset * 100 : 0)}%"></i><b>${compactMoney(point.asset)}</b></div>`).join('')}
      </div>
    </section>

    <section class="sectionCard assumptionSummary">
      <div class="sectionHead"><div><small>보기 전용</small><h2>현재 가정</h2></div></div>
      <div class="statusRows">
        <div><span>월 납입액</span><b>${compactMoney(projection.monthly)}</b></div>
        <div><span>기대수익률</span><b>${projection.rate.toFixed(1)}%</b></div>
        <div><span>연금 개시</span><b>${projection.retirementAge}세</b></div>
        <div><span>물가상승률</span><b>${projection.inflation.toFixed(1)}%</b></div>
        <div><span>수령 기간</span><b>${projection.withdrawYears}년</b></div>
      </div>
    </section>
  `;

  container.querySelector('#editFuture').onclick = () => openFutureEditor(ctx);
}

function openFutureEditor(ctx) {
  const state = ctx.state();
  const saved = state.ui.futureScenario || {
    monthly: num(state.settings.monthly.pension) + num(state.settings.monthly.irp),
    rate: num(state.settings.returnRate),
    retirementAge: num(state.profile.retirementAge),
    inflation: num(state.settings.inflation),
    withdrawYears: num(state.settings.withdrawYears),
    withdrawReturn: num(state.settings.withdrawReturn),
  };
  openModal({
    title: '미래 가정 편집',
    html: `
      <div class="sheetNotice">기준 설정은 바꾸지 않고 미래 화면의 비교에만 적용합니다.</div>
      <div class="field"><label for="futureMonthly">월 납입액</label><input id="futureMonthly" inputmode="numeric" value="${Math.round(saved.monthly).toLocaleString('ko-KR')}"></div>
      <div class="twoFields">
        <div class="field"><label for="futureRate">기대수익률</label><input id="futureRate" type="number" step="0.1" value="${saved.rate}"></div>
        <div class="field"><label for="futureAge">연금 개시 나이</label><input id="futureAge" type="number" value="${saved.retirementAge}"></div>
      </div>
      <div class="twoFields">
        <div class="field"><label for="futureInflation">물가상승률</label><input id="futureInflation" type="number" step="0.1" value="${saved.inflation}"></div>
        <div class="field"><label for="futureYears">수령 기간</label><input id="futureYears" type="number" value="${saved.withdrawYears}"></div>
      </div>
      <div class="field"><label for="futureWithdraw">수령 중 수익률</label><input id="futureWithdraw" type="number" step="0.1" value="${saved.withdrawReturn}"></div>
      <div class="modalActions"><button class="btn" id="futureReset">기준으로 초기화</button><button class="btn primary" id="futureSave">적용</button></div>
    `,
    onMount(body) {
      bindMoneyInput(body.querySelector('#futureMonthly'));
      body.querySelector('#futureSave').onclick = async () => {
        const scenario = {
          monthly: Number(body.querySelector('#futureMonthly').value.replace(/[^0-9.-]/g, '')) || 0,
          rate: Number(body.querySelector('#futureRate').value),
          retirementAge: Number(body.querySelector('#futureAge').value),
          inflation: Number(body.querySelector('#futureInflation').value),
          withdrawYears: Number(body.querySelector('#futureYears').value),
          withdrawReturn: Number(body.querySelector('#futureWithdraw').value),
        };
        if (scenario.monthly < 0 || scenario.rate < -20 || scenario.rate > 20 || scenario.retirementAge < state.profile.age || scenario.retirementAge > 95 || scenario.inflation < 0 || scenario.inflation > 15 || scenario.withdrawYears < 5 || scenario.withdrawYears > 60 || scenario.withdrawReturn < -10 || scenario.withdrawReturn > 20) return toast('가정 값을 확인하세요.', 'error');
        await updateState(draft => { draft.ui.futureScenario = scenario; }, 'future-scenario');
        closeModal();
        toast('내 가정을 적용했습니다.');
      };
      body.querySelector('#futureReset').onclick = async () => {
        await updateState(draft => { draft.ui.futureScenario = null; }, 'future-scenario-reset');
        closeModal();
        toast('기준 계획으로 돌아왔습니다.');
      };
    },
  });
}
