'use strict';

import {
  CURRENT_YEAR, accountTotal, allocation, annualContribution, compactMoney, escapeHtml, formatMoney,
  formatPercent, futureProjection, irpRiskRatio, num, portfolioHealth, totalAsset,
} from './state.js';
import { updateView } from './storage.js';
import { barChart, bindChart, lineChart } from './charts.js';
import { toast } from './ui.js';

const PAGE_SIZE = 5;
const performanceView = { account: 'all', period: 'all' };
const cashflowView = { account: 'all', period: 'all', metric: 'dividend' };

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
  const host = container.querySelector('#analysisPanel');
  if (panel === 'performance') renderPerformance(host, state);
  else if (panel === 'cashflow') renderCashflow(host, state);
  else if (panel === 'annual') renderAnnual(host, state, ctx);
  else renderAi(host, state);
}

function tab(id, label, active) {
  return `<button role="tab" data-panel="${id}" class="${active === id ? 'active' : ''}" aria-selected="${active === id}">${label}</button>`;
}

function renderPerformance(host, state) {
  const allEntries = yearEntries(state, performanceView.account);
  const entries = selectPeriod(allEntries, performanceView.period);
  const labels = entries.map(([year]) => year);
  const actual = entries.map(([, row]) => num(row.end));
  const expected = expectedPath(entries, num(state.settings.returnRate));
  const cumulative = cumulativePath(entries);
  const chart = lineChart({
    id: 'performanceChart', labels,
    series: [
      { name: '실제 자산', values: actual, color: '#1677d2', area: true },
      { name: '기대 경로', values: expected, color: '#8b5fd3', dashed: true },
      { name: '누적 순납입', values: cumulative, color: '#9aa8b8' },
    ],
    ariaLabel: '실제 자산, 기대 경로, 누적 순납입 비교 그래프',
  });
  const latest = entries.at(-1)?.[1] || {};
  const currentAsset = performanceView.account === 'all' ? totalAsset(state) : accountTotal(state.accounts[performanceView.account]);
  const currentLabel = performanceView.account === 'all' ? '현재 총자산' : `${state.accounts[performanceView.account]?.name || '선택 계좌'} 자산`;
  host.innerHTML = `
    <div class="analysisControls">
      <label><span>계좌</span><select id="performanceAccount"><option value="all">전체</option><option value="pension">연금저축</option><option value="irp">IRP</option></select></label>
      <div class="segmented periodTabs" role="tablist" aria-label="성과 기간">${periodButtons(performanceView.period)}</div>
    </div>
    <section class="sectionCard chartPanel">
      <div class="sectionHead"><div><small>실제·기대·납입 비교</small><h2>자산 성과</h2></div><span>${labels.length ? `${labels[0]}~${labels.at(-1)}` : '기록 없음'}</span></div>
      <div class="chartLegend"><span style="--series:#1677d2">실제 자산</span><span class="dashed" style="--series:#8b5fd3">기대 경로</span><span style="--series:#9aa8b8">누적 순납입</span></div>
      ${labels.length ? chart.html : `<div class="emptyInline">연도별 자산 기록이 쌓이면 그래프를 보여줍니다.</div>`}
      <div class="chartDetail" id="performanceDetail"></div>
    </section>
    <section class="metricGrid">
      <div><small>${escapeHtml(currentLabel)}</small><b>${compactMoney(currentAsset)}</b></div>
      <div><small>최근 수익률</small><b class="${num(latest.return) >= 0 ? 'good' : 'bad'}">${formatPercent(latest.return)}</b></div>
    </section>
  `;
  const account = host.querySelector('#performanceAccount');
  account.value = performanceView.account;
  account.onchange = () => { performanceView.account = account.value; renderPerformance(host, state); };
  host.querySelectorAll('[data-period]').forEach(button => {
    button.onclick = () => { performanceView.period = button.dataset.period; renderPerformance(host, state); };
  });
  if (labels.length) bindChart(host, chart.model, index => paintPerformanceDetail(host, entries[index], actual[index], expected[index], cumulative[index]));
}

function paintPerformanceDetail(host, entry, actual, expected, cumulative) {
  const detail = host.querySelector('#performanceDetail');
  if (!detail || !entry) return;
  const [year, row] = entry;
  const operating = num(row.operating) || actual - cumulative;
  detail.innerHTML = `
    <div class="detailTitle"><span>${year}년</span><strong>${compactMoney(actual)}</strong></div>
    <div class="chartDetailGrid">
      <div><small>기대 경로</small><b>${compactMoney(expected)}</b></div>
      <div><small>누적 순납입</small><b>${compactMoney(cumulative)}</b></div>
      <div><small>운용손익</small><b class="${operating >= 0 ? 'good' : 'bad'}">${operating >= 0 ? '+' : ''}${compactMoney(operating)}</b></div>
      <div><small>수익률</small><b class="${num(row.return) >= 0 ? 'good' : 'bad'}">${formatPercent(row.return)}</b></div>
    </div>`;
}

function renderCashflow(host, state) {
  const allEntries = yearEntries(state, cashflowView.account);
  const entries = selectPeriod(allEntries, cashflowView.period);
  const labels = entries.map(([year]) => year);
  const values = entries.map(([, row]) => num(row[cashflowView.metric]));
  const chart = barChart({ id: 'cashflowChart', labels, values, color: cashflowView.metric === 'dividend' ? '#76b7e8' : '#4f46e5', ariaLabel: cashflowView.metric === 'dividend' ? '연도별 배당과 분배금 그래프' : '연도별 매도손익 그래프' });
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  const max = values.length ? Math.max(...values) : 0;
  host.innerHTML = `
    <div class="analysisControls">
      <label><span>계좌</span><select id="cashflowAccount"><option value="all">전체</option><option value="pension">연금저축</option><option value="irp">IRP</option></select></label>
      <div class="segmented periodTabs" role="tablist" aria-label="현금흐름 기간">${periodButtons(cashflowView.period)}</div>
    </div>
    <section class="sectionCard chartPanel">
      <div class="sectionHead"><div><small>기간과 항목을 바꿔 확인</small><h2>현금흐름</h2></div>
        <div class="miniToggle"><button data-metric="dividend" class="${cashflowView.metric === 'dividend' ? 'active' : ''}">배당·분배금</button><button data-metric="realized" class="${cashflowView.metric === 'realized' ? 'active' : ''}">매도손익</button></div>
      </div>
      <div class="chartSummary"><div><small>합계</small><b>${compactMoney(total)}</b></div><div><small>연평균</small><b>${compactMoney(average)}</b></div><div><small>최대 연도</small><b>${compactMoney(max)}</b></div></div>
      ${labels.length ? chart.html : `<div class="emptyInline">현금흐름 기록이 없습니다.</div>`}
      <div class="chartDetail" id="cashflowDetail"></div>
    </section>
  `;
  const account = host.querySelector('#cashflowAccount');
  account.value = cashflowView.account;
  account.onchange = () => { cashflowView.account = account.value; renderCashflow(host, state); };
  host.querySelectorAll('[data-period]').forEach(button => { button.onclick = () => { cashflowView.period = button.dataset.period; renderCashflow(host, state); }; });
  host.querySelectorAll('[data-metric]').forEach(button => { button.onclick = () => { cashflowView.metric = button.dataset.metric; renderCashflow(host, state); }; });
  if (labels.length) bindChart(host, chart.model, index => paintCashflowDetail(host, entries[index], cashflowView.metric));
}

function paintCashflowDetail(host, entry, metric) {
  const detail = host.querySelector('#cashflowDetail');
  if (!detail || !entry) return;
  const [year, row] = entry;
  const value = num(row[metric]);
  detail.innerHTML = `
    <div class="detailTitle"><span>${year}년</span><strong class="${value >= 0 ? 'good' : 'bad'}">${value >= 0 ? '+' : ''}${compactMoney(value)}</strong></div>
    <div class="chartDetailGrid">
      <div><small>납입</small><b>${compactMoney(row.contribution)}</b></div>
      <div><small>분배금</small><b>${compactMoney(row.dividend)}</b></div>
      <div><small>매도손익</small><b class="${num(row.realized) >= 0 ? 'good' : 'bad'}">${num(row.realized) >= 0 ? '+' : ''}${compactMoney(row.realized)}</b></div>
      <div><small>연간 수익률</small><b class="${num(row.return) >= 0 ? 'good' : 'bad'}">${formatPercent(row.return)}</b></div>
    </div>`;
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
    <div class="sheetNotice">30년 이상 쌓여도 5개 연도씩 나눠 봅니다. 연도를 누르면 월별 분배금까지 확인합니다.</div>
  `;
  host.querySelector('#annualNewer').onclick = () => setPage(Math.max(0, page - 1));
  host.querySelector('#annualOlder').onclick = () => setPage(Math.min(maxPage, page + 1));
  host.querySelectorAll('[data-year]').forEach(button => { button.onclick = () => ctx.openAnnualDetail(button.dataset.year); });
}

function setPage(page) {
  try { updateView(ui => { ui.annualPage = page; }, 'annual-page'); } catch (error) { toast(error.message, 'error'); }
}

function renderAi(host, state) {
  const health = portfolioHealth(state);
  const diagnosis = oneLineDiagnosis(state);
  const alloc = allocation(state);
  const shortage = [...alloc].sort((a, b) => b.gap - a.gap)[0];
  const excess = [...alloc].sort((a, b) => a.gap - b.gap)[0];
  host.innerHTML = `
    <section class="diagnosisCard ${diagnosis.level}">
      <small>오늘의 한 줄 진단</small><strong>${escapeHtml(diagnosis.text)}</strong><span>${escapeHtml(diagnosis.action)}</span>
    </section>
    <section class="sectionCard aiCenter">
      <div class="aiHeader"><div><small>내 데이터 기반</small><h2>AI 투자센터</h2></div><span>시장 실시간 정보 미반영</span></div>
      <div class="aiScoreGrid"><div><small>건강점수</small><b>${health.score}점</b></div><div><small>비중 오차</small><b>${health.targetError.toFixed(1)}%p</b></div><div><small>우선 보완</small><b>${escapeHtml(shortage?.name || '-')}</b></div></div>
      <div class="rebalanceBrief"><div><span class="good">부족</span><b>${escapeHtml(shortage?.name || '-')} ${Math.max(0, shortage?.gap || 0).toFixed(1)}%p</b></div><div><span class="bad">초과</span><b>${escapeHtml(excess?.name || '-')} ${Math.max(0, -(excess?.gap || 0)).toFixed(1)}%p</b></div></div>
      <p>매수·매도·비중·연금 목표를 질문하면 저장된 자산과 기록을 근거로 답합니다.</p>
      <div class="aiQuick">
        <button data-question="buy">지금 무엇을 매수할까?</button><button data-question="sell">매도가 필요한가?</button><button data-question="rebalance">리밸런싱할까?</button><button data-question="health">내가 잘하고 있나?</button><button data-question="pension">연금 목표는 가능한가?</button>
      </div>
      <div class="aiAsk"><label for="aiQuestion">직접 질문</label><div><input id="aiQuestion" placeholder="예: 성장 비중이 너무 큰가?"><button class="btn primary" id="aiAskButton">분석</button></div></div>
      <div class="aiAnswer" id="aiAnswer" aria-live="polite"><div class="emptyInline">질문을 선택하거나 직접 입력하세요.</div></div>
    </section>`;
  const answer = host.querySelector('#aiAnswer');
  host.querySelectorAll('[data-question]').forEach(button => { button.onclick = () => paintAiAnswer(answer, analyzeQuestion(state, button.dataset.question)); });
  host.querySelector('#aiAskButton').onclick = () => {
    const question = host.querySelector('#aiQuestion').value.trim();
    if (!question) return toast('질문을 입력하세요.');
    paintAiAnswer(answer, analyzeQuestion(state, question));
  };
  host.querySelector('#aiQuestion').addEventListener('keydown', event => { if (event.key === 'Enter') host.querySelector('#aiAskButton').click(); });
}

function oneLineDiagnosis(state) {
  const health = portfolioHealth(state);
  const alloc = allocation(state);
  const shortage = [...alloc].sort((a, b) => b.gap - a.gap)[0];
  const excess = [...alloc].sort((a, b) => a.gap - b.gap)[0];
  if (irpRiskRatio(state) > 70) return { level: 'bad', text: `IRP 위험자산이 ${irpRiskRatio(state).toFixed(1)}%로 참고 한도 70%를 넘습니다.`, action: '증권사 법정 분류를 확인하고 다음 납입은 안전자산을 우선하세요.' };
  if (health.targetError > 8) return { level: 'warn', text: `${shortage.name}은 부족하고 ${excess.name}은 초과해 목표 비중에서 멀어졌습니다.`, action: `다음 납입금을 ${shortage.name}에 우선 배분하세요.` };
  if (health.topPct > 30) return { level: 'warn', text: `가장 큰 종목 비중이 ${health.topPct.toFixed(1)}%로 집중도가 높습니다.`, action: '같은 종목 추가 매수보다 다른 자산군을 먼저 채우세요.' };
  return { level: 'good', text: `현재 포트폴리오는 목표 비중과 크게 어긋나지 않았습니다.`, action: '지금 원칙을 유지하고 다음 납입 때만 비중을 다시 확인하세요.' };
}

function paintAiAnswer(host, result) {
  host.innerHTML = `<div class="aiVerdict ${result.level}"><small>${escapeHtml(result.label)}</small><strong>${escapeHtml(result.verdict)}</strong></div><div class="aiReason"><b>판단 근거</b>${result.reasons.map(reason => `<p>• ${escapeHtml(reason)}</p>`).join('')}</div><div class="aiAction"><b>지금 할 일</b><p>${escapeHtml(result.action)}</p></div><small class="aiTime">${new Date().toLocaleString('ko-KR')}의 앱 입력값 기준 · 시장 가격·뉴스 미반영</small>`;
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
    if (heavyClass.gap > -3 && topPct < 30) return result('보유 우선', '현재 데이터만 보면 강한 매도 신호는 없습니다.', [`최대 자산군 초과 폭 ${Math.abs(Math.min(0, heavyClass.gap)).toFixed(1)}%p`, `최대 종목 비중 ${topPct.toFixed(1)}%`, `건강점수 ${health.score}점`], '현금이 필요하지 않다면 새 납입금으로 부족 자산을 채우는 편이 타이밍 위험을 줄입니다.', 'good');
    return result('일부 조정 검토', `${heavyClass.name} 비중이 목표보다 ${Math.abs(heavyClass.gap).toFixed(1)}%p 높습니다.`, [`${heavyClass.name} 현재 ${heavyClass.current.toFixed(1)}% · 목표 ${heavyClass.target}%`, `최대 종목 ${top?.name || '없음'} ${topPct.toFixed(1)}%`, candidate ? `${candidate.name} 평가차익 ${compactMoney(num(candidate.value) - num(candidate.cost))}` : '평가차익 종목 없음'], '전량 매도보다 초과 비중만 줄이거나 새 납입금을 부족 자산에 넣는 방법을 먼저 검토하세요.', 'warn');
  }
  if (rawQuestion === 'rebalance' || /리밸|비중|분산/.test(question)) {
    if (health.targetError < 5) return result('양호', '지금 당장 큰 리밸런싱은 필요하지 않습니다.', [`목표 비중 총 오차 ${health.targetError.toFixed(1)}%p`, `가장 부족한 자산 ${gaps[0].name} ${gaps[0].gap.toFixed(1)}%p`, `IRP 위험자산 ${irpRiskRatio(state).toFixed(1)}%`], '다음 납입금으로 가장 부족한 자산군을 채우세요.', 'good');
    return result('리밸런싱 필요', `목표 비중 총 오차가 ${health.targetError.toFixed(1)}%p입니다.`, [`${gaps[0].name} ${gaps[0].gap.toFixed(1)}%p 부족`, `${overweight[0].name} ${Math.abs(overweight[0].gap).toFixed(1)}%p 초과`, `IRP 위험자산 ${irpRiskRatio(state).toFixed(1)}%`], '매도보다 신규 납입금을 부족 자산군에 우선 배분하고 그래도 오차가 남으면 초과 자산 일부 매도를 검토하세요.', 'warn');
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
  const matched = holdings.find(item => question.includes(item.name.toLowerCase().split(' ')[0]));
  if (matched) {
    const matchedPct = total ? num(matched.value) / total * 100 : 0;
    const profit = num(matched.value) - num(matched.cost);
    return result('종목 점검', `${matched.name}은 전체의 ${matchedPct.toFixed(1)}%입니다.`, [`평가금액 ${compactMoney(matched.value)}`, `평가차익 ${compactMoney(profit)}`, `자산군 ${matched.class}`], matchedPct > 25 ? '추가 매수는 멈추고 다른 자산군을 먼저 채우세요.' : '목표 비중을 넘지 않는 범위에서만 분할 매수하세요.', matchedPct > 25 ? 'warn' : 'good');
  }
  return result('데이터 분석', `현재 포트폴리오 건강점수는 ${health.score}점입니다.`, [`총자산 ${compactMoney(total)}`, `목표 비중 오차 ${health.targetError.toFixed(1)}%p`, `가장 큰 종목 비중 ${topPct.toFixed(1)}%`, `대기자금 ${compactMoney(cash)}`], '질문에 매수·매도·리밸런싱·연금 목표 중 하나를 넣으면 더 구체적으로 분석합니다.', 'neutral');
}

function result(label, verdict, reasons, action, level) { return { label, verdict, reasons, action, level }; }
function yearEntries(state, account) { const source = account === 'all' ? state.years : state.accountYears?.[account]; return Object.entries(source || {}).sort((a, b) => Number(a[0]) - Number(b[0])); }
function selectPeriod(entries, period) { const count = period === '1' ? 2 : period === '3' ? 4 : period === '5' ? 6 : entries.length; return entries.slice(-Math.max(1, count)); }
function periodButtons(active) { return [['1','1년'],['3','3년'],['5','5년'],['all','전체']].map(([id,label]) => `<button data-period="${id}" class="${active === id ? 'active' : ''}">${label}</button>`).join(''); }
function cumulativePath(entries) { let running = 0; return entries.map(([, row]) => { running = num(row.cumulative) || running + Math.max(0, num(row.contribution)); return running; }); }
function expectedPath(entries, rate) {
  if (!entries.length) return [];
  let balance = num(entries[0][1].start);
  if (!balance) balance = Math.max(0, num(entries[0][1].end) - num(entries[0][1].contribution) - num(entries[0][1].operating));
  return entries.map(([, row]) => { balance = balance * (1 + rate / 100) + Math.max(0, num(row.contribution)); return balance; });
}
