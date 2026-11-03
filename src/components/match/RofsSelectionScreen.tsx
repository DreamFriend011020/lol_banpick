'use client';

import React, { useState, useEffect } from 'react';
import {
  FirstTeamRofsChoice,
  MatchState,
  PickOrderChoice,
  RofsAction,
  SideChoice,
  TeamRole,
} from '../../types/match';

export type ViewerRole = TeamRole | 'OBSERVER';

interface RofsSelectionScreenProps {
  match: MatchState;
  viewerRole: ViewerRole;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onConfirmAction: (action: RofsAction) => Promise<void> | void;
}

export default function RofsSelectionScreen({
  match,
  viewerRole,
  isSubmitting = false,
  errorMessage = null,
  onConfirmAction,
}: RofsSelectionScreenProps) {
  // FIRST 팀장용 임시 선택 상태 (진영 또는 픽 순서 중 1개만 선택)
  const [firstPending, setFirstPending] =
    useState<FirstTeamRofsChoice | null>(null);

  // SECOND 팀장용 임시 선택 상태 (진영 + 픽 순서 2가지 모두 선택)
  const [secondSidePending, setSecondSidePending] =
    useState<SideChoice | null>(null);
  const [secondPickOrderPending, setSecondPickOrderPending] =
    useState<PickOrderChoice | null>(null);

  const firstSubmittedChoice = match.rofs_submissions?.first_choice ?? null;
  const secondSubmittedChoice = match.rofs_submissions?.second_choice ?? null;

  const hasFirstSubmitted = firstSubmittedChoice !== null;
  const hasSecondSubmitted = secondSubmittedChoice !== null;

  // 매치 초기화(다음 세트 전환 등) 시 각 팀의 로컬 선택값을 개별적으로 리셋
  // (상대 팀이 먼저 제출 완료하더라도 내 로컬 선택값이 풀리지 않도록 분리)
  useEffect(() => {
    if (!hasFirstSubmitted) {
      setFirstPending(null);
    }
  }, [hasFirstSubmitted]);

  useEffect(() => {
    if (!hasSecondSubmitted) {
      setSecondSidePending(null);
      setSecondPickOrderPending(null);
    }
  }, [hasSecondSubmitted]);

  // 현재 뷰어가 조작 가능한 상태인지 판별
  const canFirstInteract =
    viewerRole === 'FIRST' && !hasFirstSubmitted && !isSubmitting;
  const canSecondInteract =
    viewerRole === 'SECOND' && !hasSecondSubmitted && !isSubmitting;

  const isSideButtonEnabled = canFirstInteract || canSecondInteract;
  const isPickOrderButtonEnabled = canFirstInteract || canSecondInteract;

  // 진영 버튼(블루/레드) 클릭 핸들러
  const handleSideClick = (choice: SideChoice) => {
    if (canFirstInteract) {
      // FIRST 팀은 1가지 옵션만 선택하므로 진영 클릭 시 해당 진영으로 단일 설정
      setFirstPending({ category: 'SIDE', choice });
    } else if (canSecondInteract) {
      // SECOND 팀은 2가지 옵션을 모두 고르므로 픽 순서 선택값을 유지한 채 진영 설정
      setSecondSidePending(choice);
    }
  };

  // 픽 순서 버튼(선픽/후픽) 클릭 핸들러
  const handlePickOrderClick = (choice: PickOrderChoice) => {
    if (canFirstInteract) {
      // FIRST 팀은 1가지 옵션만 선택하므로 픽 순서 클릭 시 해당 픽 순서로 단일 설정
      setFirstPending({ category: 'PICK_ORDER', choice });
    } else if (canSecondInteract) {
      // SECOND 팀은 2가지 옵션을 모두 고르므로 진영 선택값을 유지한 채 픽 순서 설정
      setSecondPickOrderPending(choice);
    }
  };

  // 선택 확정 제출 핸들러
  const handleConfirm = async () => {
    if (canFirstInteract && firstPending) {
      await onConfirmAction({
        type: 'SUBMIT_FIRST_ROFS',
        actor: 'FIRST',
        selection: firstPending,
      });
    } else if (
      canSecondInteract &&
      secondSidePending &&
      secondPickOrderPending
    ) {
      await onConfirmAction({
        type: 'SUBMIT_SECOND_ROFS',
        actor: 'SECOND',
        selection: {
          sideChoice: secondSidePending,
          pickOrderChoice: secondPickOrderPending,
        },
      });
    }
  };

  // 현재 뷰어 기준 각 버튼의 선택(하이라이트) 여부 확인
  const isSideOptionSelected = (choice: SideChoice): boolean => {
    if (viewerRole === 'FIRST') {
      const target = firstSubmittedChoice ?? firstPending;
      return target?.category === 'SIDE' && target.choice === choice;
    }
    if (viewerRole === 'SECOND') {
      const targetSide = secondSubmittedChoice?.sideChoice ?? secondSidePending;
      return targetSide === choice;
    }
    return false;
  };

  const isPickOrderOptionSelected = (choice: PickOrderChoice): boolean => {
    if (viewerRole === 'FIRST') {
      const target = firstSubmittedChoice ?? firstPending;
      return target?.category === 'PICK_ORDER' && target.choice === choice;
    }
    if (viewerRole === 'SECOND') {
      const targetOrder =
        secondSubmittedChoice?.pickOrderChoice ?? secondPickOrderPending;
      return targetOrder === choice;
    }
    return false;
  };

  const isConfirmReady =
    (canFirstInteract && firstPending !== null) ||
    (canSecondInteract &&
      secondSidePending !== null &&
      secondPickOrderPending !== null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-6 md:p-10 select-none">
      {/* =====================================================================
          1. 상단 헤더: FIRST 팀 vs SECOND 팀 실시간 선택 상태 및 안내 문구
      ===================================================================== */}
      <header className="max-w-5xl w-full mx-auto space-y-6">
        <div className="flex items-center justify-between text-xs uppercase tracking-widest text-slate-400 border-b border-slate-800 pb-3">
          <span>Match ID: {match.match_id}</span>
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-semibold">
            내 역할:{' '}
            {viewerRole === 'FIRST'
              ? `FIRST 팀장 (${match.team_first_name})`
              : viewerRole === 'SECOND'
                ? `SECOND 팀장 (${match.team_second_name})`
                : '옵저버 (관전 모드)'}
          </span>
        </div>

        {/* 대진표 팀 대결 및 양 팀 제출 상태 배너 */}
        <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
          {/* FIRST 팀 상태 카드 */}
          <div
            className={`flex flex-col items-center md:items-start p-4 rounded-xl border transition-all ${hasFirstSubmitted
              ? 'border-emerald-500/60 bg-emerald-950/20'
              : 'border-amber-500/70 bg-amber-500/10'
              }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                FIRST TEAM (1개 옵션 선택)
              </span>
              {hasFirstSubmitted ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  선택 완료
                </span>
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              )}
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold mt-2 tracking-tight">
              {match.team_first_name}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {hasFirstSubmitted
                ? '선택 확정됨'
                : '선택 중...'}
            </p>
          </div>

          {/* VS 및 동시 선택 규칙 설명 */}
          <div className="flex flex-col items-center justify-center text-center space-y-1">
            <span className="text-xs font-semibold tracking-widest text-amber-400 uppercase">
              Rule of First Selection
            </span>
            <span className="text-3xl font-black text-white-600">VS</span>
            <span className="text-[11px] text-slate-550">
              (FIRST 선택 우선 적용 → 나머지 옵션 SECOND 선택 적용)
            </span>
          </div>

          {/* SECOND 팀 상태 카드 */}
          <div
            className={`flex flex-col items-center md:items-end p-4 rounded-xl border transition-all ${hasSecondSubmitted
              ? 'border-emerald-500/60 bg-emerald-950/20'
              : 'border-cyan-500/70 bg-cyan-500/10'
              }`}
          >
            <div className="flex items-center gap-2">
              {hasSecondSubmitted ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  선택 완료
                </span>
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              )}
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                SECOND TEAM (2개 옵션 모두 선택)
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold mt-2 tracking-tight">
              {match.team_second_name}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {hasSecondSubmitted
                ? '선택 확정됨'
                : '선택 중...'}
            </p>
          </div>
        </div>

        {/* 양 팀 실시간 진행 상태 및 스피너 */}
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-5 md:p-6 text-center shadow-lg">
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 text-sm md:text-base">
            <div className="flex items-center gap-2.5">
              {hasFirstSubmitted ? (
                <span className="text-emerald-400 font-extrabold text-base md:text-lg flex items-center gap-1.5">
                  ✓ FIRST {match.team_first_name}팀 선택 완료
                </span>
              ) : (
                <span className="flex items-center gap-2 text-amber-400 font-bold text-base md:text-lg">
                  <span className="inline-block w-4 h-4 md:w-5 md:h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  FIRST {match.team_first_name}팀 선택 중...
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {hasSecondSubmitted ? (
                <span className="text-emerald-400 font-extrabold text-base md:text-lg flex items-center gap-1.5">
                  ✓ SECOND {match.team_second_name}팀 선택 완료
                </span>
              ) : (
                <span className="flex items-center gap-2 text-cyan-400 font-bold text-base md:text-lg">
                  <span className="inline-block w-4 h-4 md:w-5 md:h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  SECOND {match.team_second_name}팀 선택 중...
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* =====================================================================
          2. 중앙: 선택 카드 UI (옵션 A: 진영 선택 / 옵션 B: 픽 순서 선택)
      ===================================================================== */}
      <main className="max-w-5xl w-full mx-auto my-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 카드 A: 진영(Side) 선택 */}
        <section
          className={`relative rounded-2xl border p-6 flex flex-col justify-between transition-all ${isSideOptionSelected('BLUE') || isSideOptionSelected('RED')
            ? 'border-blue-400/70 bg-slate-900 shadow-lg shadow-blue-500/5'
            : isSideButtonEnabled
              ? 'border-slate-700 bg-slate-900/90 hover:border-slate-500'
              : 'border-slate-800/80 bg-slate-900/40 opacity-75'
            }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xl font-bold uppercase tracking-wider text-white">
                진영
              </span>
              {viewerRole === 'FIRST' && (
                <span className="text-xs font-semibold text-amber-300">
                  {firstPending?.category === 'SIDE' ||
                    firstSubmittedChoice?.category === 'SIDE'
                    ? '✓ 진영 선택됨'
                    : '진영 또는 픽 순서 중 택 1'}
                </span>
              )}
              {viewerRole === 'SECOND' && (
                <span className="text-xs font-semibold text-cyan-300">
                  {secondSidePending || secondSubmittedChoice?.sideChoice
                    ? '✓ 희망 진영 선택됨 (1/2)'
                    : '필수 선택 (1/2)'}
                </span>
              )}
            </div>
          </div>

          {/* 진영 선택 버튼 (블루 / 레드) */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            {/* 블루 진영 버튼 */}
            <button
              type="button"
              disabled={!isSideButtonEnabled}
              onClick={() => handleSideClick('BLUE')}
              className={`group relative rounded-xl p-5 border text-left transition-all ${isSideOptionSelected('BLUE')
                ? 'border-blue-400 bg-blue-600/25 ring-2 ring-blue-400/50'
                : 'border-blue-500/30 bg-blue-950/30 hover:bg-blue-900/40'
                } disabled:cursor-not-allowed disabled:hover:bg-blue-950/30`}
            >
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                BLUE SIDE
              </div>
              <div className="text-lg font-extrabold text-white mt-1">
                블루 진영
              </div>
              {isSideOptionSelected('BLUE') && (
                <div className="mt-3 inline-block text-xs font-bold px-2 py-0.5 rounded bg-blue-500/30 text-blue-200">
                  선택됨
                </div>
              )}
            </button>

            {/* 레드 진영 버튼 */}
            <button
              type="button"
              disabled={!isSideButtonEnabled}
              onClick={() => handleSideClick('RED')}
              className={`group relative rounded-xl p-5 border text-left transition-all ${isSideOptionSelected('RED')
                ? 'border-rose-400 bg-rose-600/25 ring-2 ring-rose-400/50'
                : 'border-rose-500/30 bg-rose-950/30 hover:bg-rose-900/40'
                } disabled:cursor-not-allowed disabled:hover:bg-rose-950/30`}
            >
              <div className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                RED SIDE
              </div>
              <div className="text-lg font-extrabold text-white mt-1">
                레드 진영
              </div>
              {isSideOptionSelected('RED') && (
                <div className="mt-3 inline-block text-xs font-bold px-2 py-0.5 rounded bg-rose-500/30 text-rose-200">
                  선택됨
                </div>
              )}
            </button>
          </div>
        </section>

        {/* 카드 B: 픽 순서(Pick Order) 선택 */}
        <section
          className={`relative rounded-2xl border p-6 flex flex-col justify-between transition-all ${isPickOrderOptionSelected('FIRST_PICK') ||
            isPickOrderOptionSelected('LAST_PICK')
            ? 'border-amber-400/70 bg-slate-900 shadow-lg shadow-amber-500/5'
            : isPickOrderButtonEnabled
              ? 'border-slate-700 bg-slate-900/90 hover:border-slate-500'
              : 'border-slate-800/80 bg-slate-900/40 opacity-75'
            }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xl font-bold uppercase tracking-wider text-white">
                픽 순서
              </span>
              {viewerRole === 'FIRST' && (
                <span className="text-xs font-semibold text-amber-300">
                  {firstPending?.category === 'PICK_ORDER' ||
                    firstSubmittedChoice?.category === 'PICK_ORDER'
                    ? '✓ 픽 순서 선택됨'
                    : '진영 또는 픽 순서 중 택 1'}
                </span>
              )}
              {viewerRole === 'SECOND' && (
                <span className="text-xs font-semibold text-cyan-300">
                  {secondPickOrderPending ||
                    secondSubmittedChoice?.pickOrderChoice
                    ? '✓ 희망 픽 순서 선택됨 (2/2)'
                    : '필수 선택 (2/2)'}
                </span>
              )}
            </div>
          </div>

          {/* 픽 순서 선택 버튼 (선픽 / 후픽) */}
          <div className="grid grid-cols-2 gap-4 mt-6">
            {/* 선픽 버튼 */}
            <button
              type="button"
              disabled={!isPickOrderButtonEnabled}
              onClick={() => handlePickOrderClick('FIRST_PICK')}
              className={`group relative rounded-xl p-5 border text-left transition-all ${isPickOrderOptionSelected('FIRST_PICK')
                ? 'border-amber-400 bg-amber-600/25 ring-2 ring-amber-400/50'
                : 'border-amber-500/30 bg-amber-950/30 hover:bg-amber-900/40'
                } disabled:cursor-not-allowed disabled:hover:bg-amber-950/30`}
            >
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                FIRST PICK
              </div>
              <div className="text-lg font-extrabold text-white mt-1">
                선픽
              </div>
              {isPickOrderOptionSelected('FIRST_PICK') && (
                <div className="mt-3 inline-block text-xs font-bold px-2 py-0.5 rounded bg-amber-500/30 text-amber-200">
                  선택됨
                </div>
              )}
            </button>

            {/* 후픽 버튼 */}
            <button
              type="button"
              disabled={!isPickOrderButtonEnabled}
              onClick={() => handlePickOrderClick('LAST_PICK')}
              className={`group relative rounded-xl p-5 border text-left transition-all ${isPickOrderOptionSelected('LAST_PICK')
                ? 'border-purple-400 bg-purple-600/25 ring-2 ring-purple-400/50'
                : 'border-purple-500/30 bg-purple-950/30 hover:bg-purple-900/40'
                } disabled:cursor-not-allowed disabled:hover:bg-purple-950/30`}
            >
              <div className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                LAST PICK
              </div>
              <div className="text-lg font-extrabold text-white mt-1">
                후픽
              </div>
              {isPickOrderOptionSelected('LAST_PICK') && (
                <div className="mt-3 inline-block text-xs font-bold px-2 py-0.5 rounded bg-purple-500/30 text-purple-200">
                  선택됨
                </div>
              )}
            </button>
          </div>
        </section>
      </main>

      {/* =====================================================================
          3. 하단: 에러 알림 및 팀장별 선택 확정 바
      ===================================================================== */}
      <footer className="max-w-5xl w-full mx-auto space-y-4">
        {errorMessage && (
          <div className="rounded-xl bg-rose-950/60 border border-rose-500/50 p-3 text-center text-sm text-rose-200">
            {errorMessage}
          </div>
        )}

        {/* FIRST 팀장용 하단 확정 바 */}
        {viewerRole === 'FIRST' && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-sm text-slate-300">
              {hasFirstSubmitted && firstSubmittedChoice ? (
                <span className="text-emerald-300 font-semibold">
                  ✓ FIRST 팀 선택 완료:{' '}
                  <strong className="text-white">
                    {firstSubmittedChoice.category === 'SIDE'
                      ? firstSubmittedChoice.choice === 'BLUE'
                        ? '진영 - 블루'
                        : '진영 - 레드'
                      : firstSubmittedChoice.choice === 'FIRST_PICK'
                        ? '픽 순서 - 선픽'
                        : '픽 순서 - 후픽'}
                  </strong>{' '}
                  (SECOND 팀의 선택을 기다리는 중...)
                </span>
              ) : firstPending ? (
                <span>
                  선택 현황:{' '}
                  <strong className="text-amber-300">
                    {firstPending.category === 'SIDE'
                      ? firstPending.choice === 'BLUE'
                        ? '진영 - 블루'
                        : '진영 - 레드'
                      : firstPending.choice === 'FIRST_PICK'
                        ? '픽 순서 - 선픽'
                        : '픽 순서 - 후픽'}
                  </strong>
                </span>
              ) : (
                <span className="text-slate-400">
                  위 두 카드 중 원하는 옵션 1개를 클릭한 뒤 [선택 확정] 버튼을 눌러주세요.
                </span>
              )}
            </div>

            {!hasFirstSubmitted && (
              <button
                type="button"
                disabled={!isConfirmReady || isSubmitting}
                onClick={handleConfirm}
                className="w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '제출 중...' : '선택 확정'}
              </button>
            )}
          </div>
        )}

        {/* SECOND 팀장용 하단 확정 바 */}
        {viewerRole === 'SECOND' && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="text-sm text-slate-300">
              {hasSecondSubmitted && secondSubmittedChoice ? (
                <span className="text-emerald-300 font-semibold">
                  ✓ SECOND 팀 2가지 옵션 선택 완료:{' '}
                  <strong className="text-white">
                    희망 진영({secondSubmittedChoice.sideChoice === 'BLUE' ? '블루' : '레드'}) &{' '}
                    희망 픽 순서(
                    {secondSubmittedChoice.pickOrderChoice === 'FIRST_PICK'
                      ? '선픽'
                      : '후픽'}
                    )
                  </strong>{' '}
                  (FIRST 팀의 선택을 기다리는 중...)
                </span>
              ) : (
                <span>
                  선택 현황:{' '}
                  <strong className="text-cyan-300">
                    진영(
                    {secondSidePending
                      ? secondSidePending === 'BLUE'
                        ? '블루'
                        : '레드'
                      : '미선택'}
                    )
                  </strong>{' '}
                  +{' '}
                  <strong className="text-cyan-300">
                    픽 순서(
                    {secondPickOrderPending
                      ? secondPickOrderPending === 'FIRST_PICK'
                        ? '선픽'
                        : '후픽'
                      : '미선택'}
                    )
                  </strong>
                  {!isConfirmReady && (
                    <span className="text-slate-400 ml-2">
                      — 두 가지 옵션을 모두 선택해주세요.
                    </span>
                  )}
                </span>
              )}
            </div>

            {!hasSecondSubmitted && (
              <button
                type="button"
                disabled={!isConfirmReady || isSubmitting}
                onClick={handleConfirm}
                className="w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-sm bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '제출 중...' : '선택 확정'}
              </button>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
