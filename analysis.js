'use strict';

import {
  CURRENT_YEAR, allocation, annualContribution, compactMoney, escapeHtml, formatMoney,
  formatPercent, futureProjection, irpRiskRatio, num, portfolioHealth, totalAsset,
} from './state.js';
import { updateView } from './storage.js';
import { svgLine, toast } from './ui.js';

const PAGE_SIZE = 5;

export function renderAnalysis(container, ctx) {
  const state = ctx.state();
  const panel = state.ui.analysisPanel;
  container.innerHTML = `
    <div class="segmented analysisTabs" role="tablist" aria-label="분석 메뉴">
      ${tab('performance', '성과', panel)}
      ${tab('cashflow', '현금흐름', panel)}
      ${tab('annual', '연도', panel)}
      ${tab('ai', 'AI 분석', panel)}
    </div>
    <section id="analysisPanel"></section>
  `;
  container.querySelectorAll('[data-panel]').forEach(button => {
    button.onclick = () => ctx.setAnalysisPanel(button.dataset.panel);
  });
  const panelHost = container.querySelector('#analysisPanel');
  if (panel === 'performance') renderPerformance(panelHost, state);
  else if (panel === 'cashflow') renderCashflow(panelHost, state);
  else if (panel === 'annual') renderAnnual(panelHost, state, ctx);
  else renderAi(panelHost, state, ctx);
}

function tab(id, label, active) {
  return `<button role="tab" data-panel="${id}" class="${active === id ? 'active' : ''}" aria-selected="${active === id}">${label}</button>`;
}

function renderPerformance(host, state) {
  const years = Object.entries(state.years || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const values = years.map(([, row]) => num(row.end));
  const latest = years.at(-1)?.[1] || {};
  const returns = years.map(([, row]) => num(row.return));
  const avg = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const best = returns.length ? Math.max(...returns) : 0;
  const worst = returns.length ? Math.min(...returns) : 0;
  const health = portfolioHealth(state);
  const alloc = allocation(state);
  host.innerHTML = `
    <section class="sectionCard chartCard">
      <div class="sectionHead"><div><small>총자산 추이</small><h2>${compactMoney(totalAsset(state))}</h2></div><span>${years.length ? `${years[0][0]}~${years.at(-1)[0]}` : '기록 없음'}</span></div>
      ${values.length ? svgLine(values) : `<div class="emptyInline">연도별 데이터가 쌓이면 추이를 보여줍니다.</div>`}
    </section>
    <section class="metricGrid">
      <div><small>최근 연도 수익률</small><b class="${num(latest.return) >= 0 ? 'good' : 'bad'}">${formatPercent(latest.return)}</b></div>
      <div><small>연평균</small><b>${formatPercent(avg)}</b></div>
      <div><small>최고 연도</small><b class="good">${formatPercent(best)}</b></div>
      <div><small>최저 연도</small><b class="bad">${formatPercent(worst)}</b></div>
    </section>
    <section class="sectionCard">
      <div class="sectionHead"><div><small>목표 비중 점검</small><h2>균형 점수 ${Math.round(health.balance)}점</h2></div><span>현재 입력값 기준</span></div>
      <div class="balanceBars">${alloc.map(row => `<div><span>${escapeHtml(row.name)}</span><div><i style="width:${Math.min(100, row.current)}%;--asset:${row.color}"></i><em style="left:${Math.min(100, row.target)}%"></em></div><b>${row.current.toFixed(1)}%</b></div>`).join('')}</div>
    </section>
  `;
}

function renderCashflow(host, state) {
  const years = Object.entries(state.years || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const recent = years.slice(-5);
  const contribution = annualContribution(state);
  const dividend = recent.reduce((sum, [, row]) => sum + num(row.dividend), 0);
  host.innerHTML = `
    <section class="metricGrid">
      <div><small>${CURRENT_YEAR} 납입</small><b>${compactMoney(contribution)}</b></div>
      <div><small>최근 5년 분배금</small><b>${compactMoney(dividend)}</b></div>
      <div><small>월 납입 계획</small><b>${compactMoney(num(state.settings.monthly.pension) + num(state.settings.monthly.irp))}</b></div>
      <div><small>대기자금</small><b>${compactMoney(num(state.accounts.pension.cash) + num(state.accounts.irp.cash))}</b></div>
    </section>
    <section class="sectionCard">
      <div class="sectionHead"><div><small>최근 5년</small><h2>납입·분배금</h2></div></div>
      <div class="cashflowRows">
        ${recent.length ? recent.map(([year, row]) => `<div><b>${year}</b><span>납입 ${compactMoney(row.contribution)}</span><span>분배금 ${compactMoney(row.dividend)}</span></div>`).join('') : `<div class="emptyInline">현금흐름 기록이 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderAnnual(host, state, ctx) {
  const entries = Object.entries(state.years || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
  const maxPage = Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1);
  const page = Math.min(maxPage, Math.max(0, num(state.ui.annualPage)));
  const rows = entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const newest = rows[0]?.[0];
  const oldest = rows.at(-1)?.[0];
  host.innerHTML = `
    <section class="sectionCard annualCard">
      <div class="sectionHead"><div><small>5년씩 보기</small><h2>${newest && oldest ? `${oldest}~${newest}` : '연도별 기록'}</h2></div><span>총 ${entries.length}개 연도</span></div>
      <div class="annualRows">
        ${rows.length ? rows.map(([year, row]) => `
          <button class="annualRow" data-year="${year}">
            <b>${year}</b>
            <span><small>연말 자산</small><strong>${compactMoney(row.end)}</strong></span>
            <span><small>수익률</small><strong class="${num(row.return) >= 0 ? 'good' : 'bad'}">${formatPercent(row.return)}</strong></span>
            <i>›</i>
          </button>`).join('') : `<div class="emptyInline">연도별 기록이 없습니다.</div>`}
      </div>
      <div class="pager">
        <button class="btn" id="annualNewer" ${page === 0 ? 'disabled' : ''}>최근 5년</button>
        <span>${entries.length ? `${page + 1} / ${maxPage + 1}` : '0 / 0'}</span>
        <button class="btn" id="annualOlder" ${page >= maxPage ? 'disabled' : ''}>이전 5년</button>
      </div>
    </section>
    <div class="sheetNotice">30년이 쌓여도 한 번에 5개 연도만 표시합니다. 연도를 누르면 상세를 확인할 수 있습니다.</div>
  `;
  host.querySelector('#annualNewer').onclick = () => setPage(state, Math.max(0, page - 1), ctx);
  host.querySelector('#annualOlder').onclick = () => setPage(state, Math.min(maxPage, page + 1), ctx);
  host.querySelectorAll('[data-year]').forEach(button => {
    button.onclick = () => ctx.openAnnualDetail(button.dataset.year);
  });
}

function setPage(state, page, ctx) {
  try {
    updateView(ui => { ui.annualPage = page; }, 'annual-page');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderAi(host, state, ctx) {
  host.innerHTML = `
    <section class="sectionCard aiCenter">
      <div class="aiHeader"><div><small>내 데이터 기반</small><h2>AI 투자센터</h2></div><span>실시간 시장 미반영</span></div>
      <p>현재 저장된 비중·손익·납입·목표를 근거로 냉정하게 분석합니다.</p>
      <div class="aiQuick">
        <button data-question="buy">지금 무엇을 매수할까?</button>
        <button data-question="sell">매도가 필요한가?</button>
        <button data-question="rebalance">리밸런싱할까?</button>
        <button data-question="health">내가 잘하고 있나?</button>
        <button data-question="pension">연금 목표는 가능한가?</button>
      </div>
      <div class="aiAsk">
        <label for="aiQuestion">직접 질문</label>
        <div><input id="aiQuestion" placeholder="예: 지금 반도체 비중이 너무 큰가?"><button class="btn primary" id="aiAskButton">분석</button></div>
      </div>
      <div class="aiAnswer" id="aiAnswer" aria-live="polite">
        <div class="emptyInline">질문을 선택하거나 직접 입력하세요.</div>
      </div>
    </section>
  `;
  const answer = host.querySelector('#aiAnswer');
  host.querySelectorAll('[data-question]').forEach(button => {
    button.onclick = () => paintAiAnswer(answer, analyzeQuestion(state, button.dataset.question));
  });
  host.querySelector('#aiAskButton').onclick = () => {
    const question = host.querySelector('#aiQuestion').value.trim();
    if (!question) return toast('질문을 입력하세요.');
    paintAiAnswer(answer, analyzeQuestion(state, question));
  };
  host.querySelector('#aiQuestion').addEventListener('keydown', event => {
    if (event.key === 'Enter') host.querySelector('#aiAskButton').click();
  });
}

function paintAiAnswer(host, result) {
  host.innerHTML = `
    <div class="aiVerdict ${result.level}"><small>${escapeHtml(result.label)}</small><strong>${escapeHtml(result.verdict)}</strong></div>
    <div class="aiReason"><b>판단 근거</b>${result.reasons.map(reason => `<p>• ${escapeHtml(reason)}</p>`).join('')}</div>
    <div class="aiAction"><b>지금 할 일</b><p>${escapeHtml(result.action)}</p></div>
    <small class="aiTime">${new Date().toLocaleString('ko-KR')}의 앱 입력값 기준 · 시장 가격·뉴스는 반영하지 않음</small>
  `;
}

export function analyzeQuestion(state, rawQuestion) {
  const question = String(rawQuestion || '').toLowerCase();
  const alloc = allocation(state);
  const health = portfolioHealth(state);
  const projection = futureProjection(state);
  const holdings = Object.entries(state.accounts).flatMap(([accountKey, account]) => account.holdings.map(holding => ({ ...holding, accountKey })));
  const total = totalAsset(state);
  const cash = num(state.accounts.pension.cash) + num(state.accounts.irp.cash);
  const cashPct = total ? cash / total * 100 : 0;
  const gaps = [...alloc].sort((a, b) => b.gap - a.gap);
  const overweight = [...alloc].sort((a, b) => a.gap - b.gap);
  const top = [...holdings].sort((a, b) => num(b.value) - num(a.value))[0];
  const topPct = total && top ? num(top.value) / total * 100 : 0;

  if (rawQuestion === 'buy' || /매수|어디.*넣|추가.*사/.test(question)) {
    const target = gaps.find(item => item.gap > 1);
    if (cash <= 0) return result('주의', '지금은 매수보다 납입 또는 현금 확보가 먼저입니다.', [`대기자금이 ${compactMoney(cash)}입니다.`, `목표보다 가장 부족한 자산군은 ${target?.name || '없음'}입니다.`], '새 돈이 들어오면 목표보다 부족한 자산군부터 분할 매수하세요.', 'warn');
    if (!target) return result('유지', '현재 비중은 목표와 크게 어긋나지 않습니다.', [`대기자금 ${compactMoney(cash)} (${cashPct.toFixed(1)}%)`, `전체 비중 오차 ${health.targetError.toFixed(1)}%p`], '한 종목에 몰지 말고 기존 목표 비중대로 나눠 매수하세요.', 'good');
    return result('매수 후보', `${target.name} 자산이 목표보다 ${target.gap.toFixed(1)}%p 부족합니다.`, [`대기자금 ${compactMoney(cash)} (${cashPct.toFixed(1)}%)`, `${target.name} 현재 ${target.current.toFixed(1)}% · 목표 ${target.target}%`, `가장 큰 종목 비중 ${topPct.toFixed(1)}%`], `${target.name} 계열을 우선하되 한 번에 전액 매수하지 말고 분할하세요.`, 'good');
  }

  if (rawQuestion === 'sell' || /매도|팔아|익절|손절/.test(question)) {
    const heavyClass = overweight[0];
    const candidate = [...holdings].filter(item => num(item.value) > num(item.cost)).sort((a, b) => (num(b.value) - num(b.cost)) - (num(a.value) - num(a.cost)))[0];
    if (heavyClass.gap > -3 && topPct < 30) return result('보유 우선', '현재 데이터만 보면 강한 매도 신호는 없습니다.', [`최대 자산군 초과 폭 ${Math.abs(Math.min(0, heavyClass.gap)).toFixed(1)}%p`, `최대 종목 비중 ${topPct.toFixed(1)}%`, `건강점수 ${health.score}점`], '현금이 필요하지 않다면 새 납입금으로 부족 자산을 채우는 편이 세금·타이밍 위험을 줄입니다.', 'good');
    return result('일부 조정 검토', `${heavyClass.name} 비중이 목표보다 ${Math.abs(heavyClass.gap).toFixed(1)}%p 높습니다.`, [`${heavyClass.name} 현재 ${heavyClass.current.toFixed(1)}% · 목표 ${heavyClass.target}%`, `최대 종목 ${top?.name || '없음'} ${topPct.toFixed(1)}%`, candidate ? `${candidate.name} 평가차익 ${compactMoney(num(candidate.value) - num(candidate.cost))}` : '평가차익 종목 없음'], `전량 매도보다 초과 비중만 줄이거나, 새 납입금을 부족 자산에 넣어 자연스럽게 맞추는 방법을 우선하세요.`, 'warn');
  }

  if (rawQuestion === 'rebalance' || /리밸|비중|분산/.test(question)) {
    if (health.targetError < 5) return result('양호', '지금 당장 큰 리밸런싱은 필요하지 않습니다.', [`목표 비중 총 오차 ${health.targetError.toFixed(1)}%p`, `가장 부족한 자산 ${gaps[0].name} ${gaps[0].gap.toFixed(1)}%p`, `IRP 위험자산 ${irpRiskRatio(state).toFixed(1)}%`], '다음 납입금으로 가장 부족한 자산군을 채우세요.', 'good');
    return result('리밸런싱 필요', `목표 비중 총 오차가 ${health.targetError.toFixed(1)}%p입니다.`, [`${gaps[0].name} ${gaps[0].gap.toFixed(1)}%p 부족`, `${overweight[0].name} ${Math.abs(overweight[0].gap).toFixed(1)}%p 초과`, `IRP 위험자산 ${irpRiskRatio(state).toFixed(1)}%`], '매도보다 신규 납입금을 부족 자산군에 우선 배분하고, 그래도 오차가 남으면 초과 자산 일부 매도를 검토하세요.', 'warn');
  }

  if (rawQuestion === 'pension' || /연금|목표|은퇴|월.*만원/.test(question)) {
    const goal = num(state.settings.goalMonthly);
    const gap = projection.monthlyPension - goal;
    if (gap >= 0) return result('목표권', `현재 가정이면 월연금 목표를 ${compactMoney(gap)} 웃돕니다.`, [`예상 월연금 ${compactMoney(projection.monthlyPension)}`, `목표 ${compactMoney(goal)}`, `${projection.retirementAge}세 개시 · ${projection.withdrawYears}년 수령`], '가정 수익률을 과신하지 말고 보수적 시나리오도 함께 확인하세요.', 'good');
    return result('부족', `현재 가정이면 월연금 목표보다 ${compactMoney(Math.abs(gap))} 부족합니다.`, [`예상 월연금 ${compactMoney(projection.monthlyPension)}`, `목표 ${compactMoney(goal)}`, `월 납입 ${compactMoney(projection.monthly)}`], '납입액·연금 개시 나이·목표 월연금 중 하나를 조정해 미래 화면에서 다시 비교하세요.', 'bad');
  }

  if (rawQuestion === 'health' || /잘하고|건강|괜찮|위험/.test(question)) {
    const verdict = health.score >= 85 ? '전체적으로 잘하고 있습니다.' : health.score >= 70 ? '기본은 괜찮지만 비중 조정이 필요합니다.' : '현재 구조는 집중도와 목표 오차를 줄여야 합니다.';
    return result('건강검진', `${verdict} 종합 ${health.score}점입니다.`, [`분산 ${Math.round(health.diversification)}점`, `목표 비중 ${Math.round(health.balance)}점`, `안정성 ${Math.round(health.stability)}점`, `납입 규율 ${Math.round(health.discipline)}점`], health.targetError > 5 ? '다음 납입금을 목표보다 부족한 자산군에 집중하세요.' : '현재 원칙을 유지하고 반기마다 점검하세요.', health.score >= 80 ? 'good' : health.score >= 65 ? 'warn' : 'bad');
  }

  if (top && question.includes(top.name.toLowerCase().split(' ')[0])) {
    const profit = num(top.value) - num(top.cost);
    return result('종목 점검', `${top.name}은 전체의 ${topPct.toFixed(1)}%입니다.`, [`평가금액 ${compactMoney(top.value)}`, `평가차익 ${compactMoney(profit)}`, `자산군 ${top.class}`], topPct > 25 ? '추가 매수는 멈추고 다른 자산군을 먼저 채우세요.' : '목표 비중을 넘지 않는 범위에서만 분할 매수하세요.', topPct > 25 ? 'warn' : 'good');
  }

  return result('데이터 분석', `현재 포트폴리오 건강점수는 ${health.score}점입니다.`, [`총자산 ${compactMoney(total)}`, `목표 비중 오차 ${health.targetError.toFixed(1)}%p`, `가장 큰 종목 비중 ${topPct.toFixed(1)}%`, `대기자금 ${compactMoney(cash)}`], '질문에 매수·매도·리밸런싱·연금 목표 중 하나를 넣으면 더 구체적으로 분석합니다.', 'neutral');
}

function result(label, verdict, reasons, action, level) {
  return { label, verdict, reasons, action, level };
}
