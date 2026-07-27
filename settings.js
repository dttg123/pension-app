'use strict';

import {
  APP_VERSION, SCHEMA_VERSION, ASSET_CLASSES, createBlankState, escapeHtml, num, parseMoney,
} from './state.js';
import { applyTheme, getState, replaceState, snapshotState, storeSafetyCopy, updateState } from './storage.js';
import { openDataCenter } from './backup.js';
import { bindMoneyInput, closeModal, confirmAction, openModal, setBusy, toast } from './ui.js';

export function openSettings(ctx) {
  const state = getState();
  openModal({
    title: '설정',
    size: 'large',
    html: `
      <section class="settingsSection">
        <h3>기본 계획</h3>
        <div class="twoFields"><div class="field"><label for="setBirthYear">출생연도</label><input id="setBirthYear" type="number" min="1900" max="2100" value="${state.profile.birthYear}"></div><div class="field"><label for="setRetirementAge">연금 개시 나이</label><input id="setRetirementAge" type="number" min="40" max="95" value="${state.profile.retirementAge}"></div></div>
        <div class="twoFields"><div class="field"><label for="setPensionMonthly">연금저축 월 납입</label><input id="setPensionMonthly" inputmode="numeric" value="${Math.round(num(state.settings.monthly.pension)).toLocaleString('ko-KR')}"></div><div class="field"><label for="setIrpMonthly">IRP 월 납입</label><input id="setIrpMonthly" inputmode="numeric" value="${Math.round(num(state.settings.monthly.irp)).toLocaleString('ko-KR')}"></div></div>
        <div class="field"><label for="setGoalMonthly">목표 월연금</label><input id="setGoalMonthly" inputmode="numeric" value="${Math.round(num(state.settings.goalMonthly)).toLocaleString('ko-KR')}"></div>
      </section>

      <section class="settingsSection">
        <h3>미래 계산 기준</h3>
        <div class="threeFields"><div class="field"><label for="setReturnRate">기대수익률</label><input id="setReturnRate" type="number" step="0.1" value="${state.settings.returnRate}"></div><div class="field"><label for="setInflation">물가</label><input id="setInflation" type="number" step="0.1" value="${state.settings.inflation}"></div><div class="field"><label for="setWithdrawReturn">수령 중 수익률</label><input id="setWithdrawReturn" type="number" step="0.1" value="${state.settings.withdrawReturn}"></div></div>
        <div class="field"><label for="setWithdrawYears">연금 수령 기간</label><input id="setWithdrawYears" type="number" min="5" max="60" value="${state.settings.withdrawYears}"></div>
      </section>

      <section class="settingsSection">
        <h3>연도별 변경 가능 한도</h3>
        <div class="twoFields"><div class="field"><label for="setAnnualLimit">연간 총 납입 한도</label><input id="setAnnualLimit" inputmode="numeric" value="${Math.round(num(state.settings.annualContributionLimit)).toLocaleString('ko-KR')}"></div><div class="field"><label for="setTaxLimit">세액공제 설정 한도</label><input id="setTaxLimit" inputmode="numeric" value="${Math.round(num(state.settings.taxCreditLimit)).toLocaleString('ko-KR')}"></div></div>
        <small>법과 제도는 코드에 고정하지 않고 직접 수정할 수 있게 유지합니다.</small>
      </section>

      <section class="settingsSection">
        <h3>목표 자산배분</h3>
        <div class="targetRows" id="targetRows">
          ${state.settings.assetClasses.map(item => `<div class="targetRow"><span><i style="--asset:${item.color}"></i><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.hint)}</small></span><input data-target="${item.id}" type="number" min="0" max="100" step="1" value="${item.target}" aria-label="${escapeHtml(item.name)} 목표 비중"><em>%</em></div>`).join('')}
        </div>
        <div class="targetSum" id="targetSum"></div>
      </section>

      <section class="settingsSection">
        <h3>화면</h3>
        <div class="segmented themeTabs"><button data-theme="auto" class="${state.settings.theme === 'auto' ? 'active' : ''}">자동</button><button data-theme="light" class="${state.settings.theme === 'light' ? 'active' : ''}">라이트</button><button data-theme="dark" class="${state.settings.theme === 'dark' ? 'active' : ''}">다크</button></div>
      </section>

      <section class="settingsSection">
        <h3>데이터</h3>
        <button class="dataLaunch" id="openData"><span><b>백업·복원</b><small>JSON·CSV·ZIP·프로젝트 백업</small></span><i>›</i></button>
        <button class="dataLaunch dangerLaunch" id="resetData"><span><b>모든 데이터 초기화</b><small>현재 데이터는 안전백업 후 비웁니다.</small></span><i>›</i></button>
      </section>

      <div class="saveBar"><button class="btn primary full" id="saveSettings">설정 저장</button></div>
      <div class="dataFoot">앱 ${APP_VERSION} · 데이터 구조 ${SCHEMA_VERSION} · 덧씌우기 패치 없음</div>
    `,
    onMount(body) {
      ['setPensionMonthly', 'setIrpMonthly', 'setGoalMonthly', 'setAnnualLimit', 'setTaxLimit'].forEach(id => bindMoneyInput(body.querySelector(`#${id}`)));
      let selectedTheme = state.settings.theme;
      body.querySelectorAll('[data-theme]').forEach(button => {
        button.onclick = () => {
          selectedTheme = button.dataset.theme;
          body.querySelectorAll('[data-theme]').forEach(item => item.classList.toggle('active', item === button));
        };
      });
      const refreshTargetSum = () => {
        const sum = [...body.querySelectorAll('[data-target]')].reduce((total, input) => total + num(input.value), 0);
        const el = body.querySelector('#targetSum');
        el.textContent = `합계 ${sum.toFixed(sum % 1 ? 1 : 0)}%`;
        el.classList.toggle('bad', Math.abs(sum - 100) > 0.01);
      };
      body.querySelectorAll('[data-target]').forEach(input => input.oninput = refreshTargetSum);
      refreshTargetSum();

      body.querySelector('#openData').onclick = () => {
        closeModal();
        setTimeout(() => openDataCenter(ctx), 60);
      };
      body.querySelector('#resetData').onclick = () => resetData(ctx);
      body.querySelector('#saveSettings').onclick = async () => {
        const targets = Object.fromEntries([...body.querySelectorAll('[data-target]')].map(input => [input.dataset.target, num(input.value)]));
        const targetSum = Object.values(targets).reduce((sum, value) => sum + value, 0);
        if (Math.abs(targetSum - 100) > 0.01) return toast('목표 자산배분 합계를 100%로 맞추세요.', 'error');
        const birthYear = Number(body.querySelector('#setBirthYear').value);
        const currentYear = new Date().getFullYear();
        const age = currentYear - birthYear + 1;
        const retirementAge = Number(body.querySelector('#setRetirementAge').value);
        const pensionMonthly = parseMoney(body.querySelector('#setPensionMonthly').value);
        const irpMonthly = parseMoney(body.querySelector('#setIrpMonthly').value);
        const goalMonthly = parseMoney(body.querySelector('#setGoalMonthly').value);
        const returnRate = Number(body.querySelector('#setReturnRate').value);
        const inflation = Number(body.querySelector('#setInflation').value);
        const withdrawReturn = Number(body.querySelector('#setWithdrawReturn').value);
        const withdrawYears = Number(body.querySelector('#setWithdrawYears').value);
        const annualLimit = parseMoney(body.querySelector('#setAnnualLimit').value);
        const taxLimit = parseMoney(body.querySelector('#setTaxLimit').value);
        if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear - 18) return toast('출생연도를 확인하세요.', 'error');
        if (!Number.isFinite(retirementAge) || retirementAge < age || retirementAge > 95) return toast('연금 개시 나이를 확인하세요.', 'error');
        if ([pensionMonthly, irpMonthly, goalMonthly].some(value => value < 0)) return toast('납입액과 목표액은 음수로 입력할 수 없습니다.', 'error');
        if (!Number.isFinite(returnRate) || returnRate < -20 || returnRate > 20) return toast('기대수익률은 -20%~20% 범위로 입력하세요.', 'error');
        if (!Number.isFinite(inflation) || inflation < 0 || inflation > 15) return toast('물가상승률은 0%~15% 범위로 입력하세요.', 'error');
        if (!Number.isFinite(withdrawReturn) || withdrawReturn < -10 || withdrawReturn > 20) return toast('수령 중 수익률은 -10%~20% 범위로 입력하세요.', 'error');
        if (!Number.isFinite(withdrawYears) || withdrawYears < 5 || withdrawYears > 60) return toast('연금 수령 기간은 5~60년으로 입력하세요.', 'error');
        if (annualLimit <= 0) return toast('연간 총 납입 한도를 확인하세요.', 'error');
        if (taxLimit < 0 || taxLimit > annualLimit) return toast('세액공제 설정 한도는 총 납입 한도보다 클 수 없습니다.', 'error');
        const button = body.querySelector('#saveSettings');
        setBusy(button, true, '저장 중…');
        try {
          await updateState(draft => {
            draft.profile.birthYear = birthYear;
            draft.profile.age = age;
            draft.profile.retirementAge = retirementAge;
            draft.settings.monthly.pension = pensionMonthly;
            draft.settings.monthly.irp = irpMonthly;
            draft.settings.goalMonthly = goalMonthly;
            draft.settings.returnRate = returnRate;
            draft.settings.inflation = inflation;
            draft.settings.withdrawReturn = withdrawReturn;
            draft.settings.withdrawYears = withdrawYears;
            draft.settings.annualContributionLimit = annualLimit;
            draft.settings.taxCreditLimit = taxLimit;
            draft.settings.theme = selectedTheme;
            draft.settings.assetClasses = draft.settings.assetClasses.map(item => ({ ...item, target: targets[item.id] }));
          }, 'settings-save');
          applyTheme(selectedTheme);
          closeModal();
          toast('설정을 저장했습니다.');
        } catch (error) {
          toast(error.message, 'error', 3500);
          setBusy(button, false);
        }
      };
    },
  });
}

async function resetData(ctx) {
  const first = await confirmAction({ title: '데이터 초기화', message: '계좌·종목·원장·설정을 모두 비울까요? 현재 데이터는 안전백업합니다.', confirmText: '계속', danger: true });
  if (!first) return;
  const second = await confirmAction({ title: '마지막 확인', message: '이 작업은 화면에서 되돌릴 수 없습니다. 정말 초기화할까요?', confirmText: '초기화', danger: true });
  if (!second) return;
  try {
    await storeSafetyCopy({ createdAt: new Date().toISOString(), reason: 'manual-reset', data: snapshotState() });
    const blank = createBlankState();
    await replaceState(blank, 'reset');
    closeModal();
    ctx.navigate('home');
    toast('데이터를 초기화했습니다. 이전 데이터는 안전복사본에 보관했습니다.');
  } catch (error) {
    toast(error.message, 'error', 4000);
  }
}
