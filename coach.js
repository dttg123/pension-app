/* 개인연금 V2.0 RC6 - 연금 진단 */
'use strict';
function pensionDiagnosis(){
  const outlook=retirementOutlook(),status=currentContributionStatus(),fresh=freshnessDays(),irp=irpRiskStatus(),top=topHolding('all'),consistency=contributionConsistency(12),yearsLeft=Math.max(0,state.profile.retirementAge-state.profile.age),missing=['pension','irp'].filter(k=>Number(state.settings.monthly[k])>0&&!status[k]);
  const evidence=[
    ['개인연금 월인출 추정',man(outlook.base.realMonthly)],
    ['보수 시나리오',man(outlook.conservative.realMonthly)],
    ['목표까지',outlook.gap>0?`${man(outlook.gap)} 부족`:'달성 범위'],
    ['연금 개시까지',`${yearsLeft}년`]
  ];
  if(state.meta?.sampleData)return {tone:'info',state:'검토용 데이터',title:'먼저 내 데이터로 시작하세요',reason:'현재 보이는 금액과 상품은 화면 검토를 위한 샘플입니다. 실제 판단에는 사용하지 않습니다.',action:'샘플 데이터를 지우고 내 자산 입력',actionType:'clear-sample',avoid:'샘플 수치를 기준으로 투자 결정을 내리지 마세요.',evidence};
  if(totalAsset()<=0)return {tone:'info',state:'입력 필요',title:'현재 자산부터 한 번만 등록하세요',reason:'연금 상태와 미래 추정은 현재 연금저축·IRP 잔고가 있어야 계산할 수 있습니다.',action:'자산현황 갱신',actionType:'snapshot',avoid:'과거 거래를 전부 입력하려고 시작을 미룰 필요는 없습니다.',evidence};
  if(fresh>45)return {tone:'watch',state:'점검 필요',title:'잔고가 오래됐습니다',reason:`마지막 자산 갱신 후 ${fresh}일이 지나 성과와 미래 추정의 신뢰도가 낮아졌습니다.`,action:'자산현황 갱신',actionType:'snapshot',avoid:'오래된 평가금액으로 비중을 조정하지 마세요.',evidence:[...evidence,['마지막 갱신',`${fresh}일 전`]]};
  if(missing.length)return {tone:'action',state:'이번 달 할 일',title:`${missing.map(k=>ACCOUNT_LABEL[k]).join('·')} 납입을 확인하세요`,reason:`이번 달 계획 금액은 ${missing.map(k=>`${ACCOUNT_LABEL[k]} ${man(state.settings.monthly[k])}`).join(', ')}입니다.`,action:'이번 달 납입 기록',actionType:'contribution',avoid:'기록 여부가 불명확한 상태에서 중복 납입하지 마세요.',evidence:[...evidence,['최근 12개월 납입 기록',`${Math.round(consistency.pct)}%`]]};
  if(irp.riskPct>70.1)return {tone:'watch',state:'확인 필요',title:'IRP 위험자산 한도를 확인하세요',reason:`앱에 저장된 분류 기준 위험자산이 ${irp.riskPct.toFixed(1)}%입니다. 법정 분류는 증권사 주문 화면이 최종 기준입니다.`,action:'IRP 상품 분류 확인',actionType:'account-irp',avoid:'상품명이나 자산군 이름만 보고 한도 초과로 단정하지 마세요.',evidence:[...evidence,['IRP 위험자산 추정',`${irp.riskPct.toFixed(1)}%`],['분류 미확인',`${irp.unknownPct.toFixed(1)}%`]]};
  if(irp.unknownPct>10)return {tone:'info',state:'분류 확인',title:'IRP 상품의 위험자산 분류를 확인하세요',reason:`IRP의 ${irp.unknownPct.toFixed(1)}%가 위험·안전자산 분류 미확인 상태입니다.`,action:'IRP 계좌에서 분류 확인',actionType:'account-irp',avoid:'미확인 상품을 모두 위험자산 또는 안전자산으로 간주하지 마세요.',evidence:[...evidence,['분류 미확인',`${irp.unknownPct.toFixed(1)}%`]]};
  if(top.pct>35)return {tone:'watch',state:'집중 점검',title:'다음 납입은 한 종목 집중을 줄이는 데 쓰세요',reason:`가장 큰 상품이 전체 개인연금의 ${top.pct.toFixed(1)}%를 차지합니다. 기존 보유분을 급히 팔기보다 신규 납입으로 조정하는 편이 단순합니다.`,action:'계좌 비중 확인',actionType:'account',avoid:'단순히 비중이 높다는 이유만으로 즉시 매도할 필요는 없습니다.',evidence:[...evidence,['최대 상품 비중',`${top.pct.toFixed(1)}%`]]};
  if(consistency.pct<80)return {tone:'action',state:'납입 점검',title:'수익률보다 납입 지속성을 먼저 고치세요',reason:`최근 12개월 계획 대비 기록률이 ${Math.round(consistency.pct)}%입니다. 장기 결과에는 기대수익률을 높이는 것보다 실행 가능한 납입 계획이 더 중요합니다.`,action:'월 납입 계획 조정',actionType:'settings',avoid:'지키기 어려운 계획액을 유지한 채 기대수익률만 높이지 마세요.',evidence:[...evidence,['최근 12개월 납입 기록',`${Math.round(consistency.pct)}%`]]};
  if(outlook.progress<70)return {tone:'action',state:'계획 조정 필요',title:'목표와 현재 계획의 간격이 큽니다',reason:`기준 시나리오의 개인연금 월인출 추정은 목표의 ${Math.round(outlook.progress)}%입니다. 납입액과 개시 나이를 함께 비교해야 합니다.`,action:'미래 시나리오 비교',actionType:'future',avoid:'목표를 맞추기 위해 기대수익률만 공격적으로 높이지 마세요.',evidence};
  if(outlook.progress<90)return {tone:'info',state:'작은 조정',title:'목표는 납입액이나 개시 시점으로 보완하세요',reason:`기준 시나리오는 목표의 ${Math.round(outlook.progress)}%, 보수 시나리오는 ${Math.round(outlook.conservative.realMonthly/Math.max(1,outlook.goal)*100)}%입니다.`,action:'미래 시나리오 비교',actionType:'future',avoid:'부족분을 메우려고 기존 자산을 급하게 매도할 필요는 없습니다.',evidence};
  return {tone:'good',state:'유지 가능',title:'현재 계획을 유지해도 됩니다',reason:`기준 시나리오는 목표의 ${Math.round(outlook.progress)}%이며 최근 납입 기록과 자산 갱신 상태도 정상 범위입니다.`,action:'이번 달 계획 유지',actionType:'none',avoid:'단기 수익률만 보고 계획을 자주 바꾸지 마세요.',evidence};
}
function homeAction(){return pensionDiagnosis()}
window.PensionCoach={pensionDiagnosis,homeAction};
