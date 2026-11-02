import {
  BanPickAction,
  BanPickState,
  DraftTurnStep,
  MatchState,
  SeriesState,
  SideChoice,
  TeamRole,
  TransitionResult,
} from '../types/match';

export const TURN_DURATION_SECONDS = 30;
export const TURN_DURATION_MS = TURN_DURATION_SECONDS * 1000;

export const SWAP_DURATION_SECONDS = 60;
export const SWAP_DURATION_MS = SWAP_DURATION_SECONDS * 1000;

export const TOTAL_DRAFT_TURNS = 20;

/**
 * RoFS 결과(selected_side, pick_turn)에 따라
 * 어느 진영('BLUE' | 'RED')이 선픽(first_pick)이고 후픽(last_pick)인지 판별합니다.
 */
export function resolvePickOrderSides(match?: Pick<MatchState, 'selected_side' | 'pick_turn'> | null): {
  firstPickSide: SideChoice;
  lastPickSide: SideChoice;
} {
  if (
    match?.selected_side &&
    match?.pick_turn &&
    match.pick_turn.first_pick === match.selected_side.red
  ) {
    return {
      firstPickSide: 'RED',
      lastPickSide: 'BLUE',
    };
  }

  return {
    firstPickSide: 'BLUE',
    lastPickSide: 'RED',
  };
}

/**
 * RoFS 결과의 선픽 진영(firstPickSide)과 후픽 진영(lastPickSide)을 반영한
 * 공식 LoL 토너먼트 드래프트 20턴 시퀀스 생성
 *
 * - 1차 밴 (6턴): 선픽 진영부터 교차 3밴 (선1 -> 후1 -> 선2 -> 후2 -> 선3 -> 후3)
 * - 1차 픽 (6턴): 1-2-2-1 순서 (선1 -> 후1 -> 후2 -> 선2 -> 선3 -> 후3)
 * - 2차 밴 (4턴): 후픽 진영부터 교차 2밴 (후4 -> 선4 -> 후5 -> 선5)
 * - 2차 픽 (4턴): 1-2-1 순서 (후4 -> 선4 -> 선5 -> 후5[막픽])
 */
export function getDraftSequence(
  match?: Pick<MatchState, 'selected_side' | 'pick_turn'> | null
): DraftTurnStep[] {
  const { firstPickSide, lastPickSide } = resolvePickOrderSides(match);

  const sideKor = (side: SideChoice) => (side === 'BLUE' ? '블루' : '레드');
  const FP = firstPickSide;
  const LP = lastPickSide;

  return [
    // ======================== 1차 밴 페이즈 (총 6턴: 선픽 진영 선밴) ========================
    { turnIndex: 0, phase: 'PHASE1_BAN', actionType: 'BAN', side: FP, slotIndex: 0, label: `${sideKor(FP)} 1밴 (선픽팀)` },
    { turnIndex: 1, phase: 'PHASE1_BAN', actionType: 'BAN', side: LP, slotIndex: 0, label: `${sideKor(LP)} 1밴 (후픽팀)` },
    { turnIndex: 2, phase: 'PHASE1_BAN', actionType: 'BAN', side: FP, slotIndex: 1, label: `${sideKor(FP)} 2밴 (선픽팀)` },
    { turnIndex: 3, phase: 'PHASE1_BAN', actionType: 'BAN', side: LP, slotIndex: 1, label: `${sideKor(LP)} 2밴 (후픽팀)` },
    { turnIndex: 4, phase: 'PHASE1_BAN', actionType: 'BAN', side: FP, slotIndex: 2, label: `${sideKor(FP)} 3밴 (선픽팀)` },
    { turnIndex: 5, phase: 'PHASE1_BAN', actionType: 'BAN', side: LP, slotIndex: 2, label: `${sideKor(LP)} 3밴 (후픽팀)` },

    // ======================== 1차 픽 페이즈 (1-2-2-1, 총 6턴: 선픽 진영 1픽) ================
    { turnIndex: 6, phase: 'PHASE1_PICK', actionType: 'PICK', side: FP, slotIndex: 0, label: `${sideKor(FP)} 1픽 (선픽)` },
    { turnIndex: 7, phase: 'PHASE1_PICK', actionType: 'PICK', side: LP, slotIndex: 0, label: `${sideKor(LP)} 1픽` },
    { turnIndex: 8, phase: 'PHASE1_PICK', actionType: 'PICK', side: LP, slotIndex: 1, label: `${sideKor(LP)} 2픽` },
    { turnIndex: 9, phase: 'PHASE1_PICK', actionType: 'PICK', side: FP, slotIndex: 1, label: `${sideKor(FP)} 2픽` },
    { turnIndex: 10, phase: 'PHASE1_PICK', actionType: 'PICK', side: FP, slotIndex: 2, label: `${sideKor(FP)} 3픽` },
    { turnIndex: 11, phase: 'PHASE1_PICK', actionType: 'PICK', side: LP, slotIndex: 2, label: `${sideKor(LP)} 3픽` },

    // ======================== 2차 밴 페이즈 (총 4턴: 후픽 진영 선밴) ========================
    { turnIndex: 12, phase: 'PHASE2_BAN', actionType: 'BAN', side: LP, slotIndex: 3, label: `${sideKor(LP)} 4밴 (후픽팀)` },
    { turnIndex: 13, phase: 'PHASE2_BAN', actionType: 'BAN', side: FP, slotIndex: 3, label: `${sideKor(FP)} 4밴 (선픽팀)` },
    { turnIndex: 14, phase: 'PHASE2_BAN', actionType: 'BAN', side: LP, slotIndex: 4, label: `${sideKor(LP)} 5밴 (후픽팀)` },
    { turnIndex: 15, phase: 'PHASE2_BAN', actionType: 'BAN', side: FP, slotIndex: 4, label: `${sideKor(FP)} 5밴 (선픽팀)` },

    // ======================== 2차 픽 페이즈 (1-2-1, 총 4턴: 후픽 진영 막픽) ==================
    { turnIndex: 16, phase: 'PHASE2_PICK', actionType: 'PICK', side: LP, slotIndex: 3, label: `${sideKor(LP)} 4픽` },
    { turnIndex: 17, phase: 'PHASE2_PICK', actionType: 'PICK', side: FP, slotIndex: 3, label: `${sideKor(FP)} 4픽` },
    { turnIndex: 18, phase: 'PHASE2_PICK', actionType: 'PICK', side: FP, slotIndex: 4, label: `${sideKor(FP)} 5픽` },
    { turnIndex: 19, phase: 'PHASE2_PICK', actionType: 'PICK', side: LP, slotIndex: 4, label: `${sideKor(LP)} 5픽 (막픽)` },
  ];
}

/**
 * 하위 호환용 기본 시퀀스 (블루 선픽 기준)
 */
export const TOURNAMENT_DRAFT_SEQUENCE: DraftTurnStep[] = getDraftSequence(null);

/**
 * 초기 밴픽 상태 생성
 */
export function createInitialBanPickState(now: number = Date.now()): BanPickState {
  return {
    current_turn_index: 0,
    turn_deadline_at: now + TURN_DURATION_MS,
    hovered_champion_id: null,
    blue_bans: [null, null, null, null, null],
    red_bans: [null, null, null, null, null],
    blue_picks: [null, null, null, null, null],
    red_picks: [null, null, null, null, null],
    blue_swap_ready: false,
    red_swap_ready: false,
  };
}

/**
 * 현재 20턴 챔피언 선택이 모두 끝나고 60초 '라인 스왑 페이즈'가 진행 중인지 여부 반환
 */
export function isInSwapPhase(match?: MatchState | null): boolean {
  if (!match || match.status !== 'BANPICK_IN_PROGRESS' || !match.banpick_state) {
    return false;
  }
  return match.banpick_state.current_turn_index >= TOTAL_DRAFT_TURNS;
}

/**
 * 현재 진행 중인 턴의 메타데이터 반환 (RoFS의 선픽/후픽 진영을 반영)
 */
export function getCurrentTurnStep(
  banPickState?: BanPickState | null,
  match?: Pick<MatchState, 'selected_side' | 'pick_turn'> | null
): DraftTurnStep | null {
  if (!banPickState) return null;
  const sequence = getDraftSequence(match);
  return sequence[banPickState.current_turn_index] ?? null;
}

/**
 * 경기의 다전제(Series) 및 하드 피어리스 설정 상태를 안전하게 조회합니다.
 */
export function getSeriesState(match?: MatchState | null): SeriesState {
  const raw = match?.rofs_submissions?.series_state ?? match?.series_state;
  const teamA = raw?.team_a_name || match?.team_first_name || 'T1';
  const teamB = raw?.team_b_name || match?.team_second_name || 'GEN';
  const totalGames = Math.max(1, raw?.total_games ?? 1);
  const currentGame = Math.max(1, raw?.current_game ?? 1);

  const defaultSchedule = Array.from({ length: totalGames }, (_, idx) =>
    idx % 2 === 0 ? teamA : teamB
  );

  const resolvedAutoSave =
    typeof match?.auto_save_enabled === 'boolean'
      ? match.auto_save_enabled
      : typeof raw?.auto_save_enabled === 'boolean'
        ? raw.auto_save_enabled
        : false;

  const resolvedIsScrim =
    typeof raw?.is_scrim === 'boolean'
      ? raw.is_scrim
      : Boolean(
          match?.match_id?.startsWith('scrim-') ||
            match?.tournament_name?.includes('스크림')
        );

  return {
    total_games: totalGames,
    current_game: currentGame,
    fearless_enabled: Boolean(raw?.fearless_enabled),
    fearless_used_champions: Array.isArray(raw?.fearless_used_champions)
      ? raw.fearless_used_champions
      : [],
    fearless_picks_by_team:
      raw?.fearless_picks_by_team &&
      typeof raw.fearless_picks_by_team === 'object'
        ? raw.fearless_picks_by_team
        : {},
    game_first_teams:
      Array.isArray(raw?.game_first_teams) && raw.game_first_teams.length > 0
        ? raw.game_first_teams
        : defaultSchedule,
    set_winners: Array.isArray(raw?.set_winners) ? raw.set_winners : [],
    team_a_name: teamA,
    team_b_name: teamB,
    auto_save_enabled: resolvedAutoSave,
    drive_folder_id: match?.drive_folder_id ?? raw?.drive_folder_id,
    drive_webhook_url: match?.drive_webhook_url ?? raw?.drive_webhook_url,
    is_scrim: resolvedIsScrim,
  };
}

/**
 * 스크림(연습) 모드에서 생성된 방인지 판별합니다.
 * 스크림 방은 관리자 인증 없이도 참가자가 직접 세트 승패 및 하드 피어리스 다음 세트를 진행할 수 있습니다.
 */
export function isScrimMatchRoom(match?: MatchState | null): boolean {
  if (!match) return false;
  return Boolean(getSeriesState(match).is_scrim);
}

/**
 * 경기의 자동 저장(auto_save_enabled)이 활성화되어 있는지 정확히 판별합니다.
 * (Supabase 최소 스키마 환경에서도 rofs_submissions.series_state.auto_save_enabled 값을 우선 확인)
 */
export function isMatchAutoSaveEnabled(match?: MatchState | null): boolean {
  if (!match) return false;
  const seriesAuto =
    match.rofs_submissions?.series_state?.auto_save_enabled ??
    match.series_state?.auto_save_enabled;
  if (typeof match.auto_save_enabled === 'boolean') {
    return match.auto_save_enabled;
  }
  if (typeof seriesAuto === 'boolean') {
    return seriesAuto;
  }
  return false;
}

/**
 * 하드 피어리스(Hard Fearless) 룰에 의해 이전 세트에서 이미 픽되어 사용 금지된 챔피언 ID 집합 반환
 */
export function getFearlessChampionIds(match?: MatchState | null): Set<string> {
  const series = getSeriesState(match);
  if (!series.fearless_enabled) {
    return new Set();
  }
  return new Set(
    series.fearless_used_champions.filter((id): id is string =>
      Boolean(id && id !== 'NO_BAN')
    )
  );
}

/**
 * 특정 진영('BLUE' | 'RED')에 배정된 팀이 이전 세트들에서 픽했던 피어리스 금지 챔피언 ID 목록 반환
 */
export function getTeamFearlessChampionIds(
  match: MatchState | null | undefined,
  side: SideChoice
): string[] {
  if (!match) return [];
  const series = getSeriesState(match);
  if (!series.fearless_enabled) return [];

  const teamName =
    side === 'BLUE'
      ? match.selected_side?.blue ?? match.team_first_name
      : match.selected_side?.red ?? match.team_second_name;

  const byTeam = series.fearless_picks_by_team ?? {};
  const teamPicks = byTeam[teamName];
  if (Array.isArray(teamPicks) && teamPicks.length > 0) {
    return teamPicks.filter((id): id is string => Boolean(id && id !== 'NO_BAN'));
  }

  // 이전 버전 데이터 호환 폴백: 10개 단위(블루 5픽 + 레드 5픽)로 저장된 목록에서 분리
  if (
    Object.keys(byTeam).length === 0 &&
    series.fearless_used_champions.length > 0
  ) {
    const result: string[] = [];
    const isTeamA = teamName === series.team_a_name;
    for (let i = 0; i < series.fearless_used_champions.length; i++) {
      const posInSet = i % 10;
      if (isTeamA && posInSet < 5) {
        result.push(series.fearless_used_champions[i]);
      } else if (!isTeamA && posInSet >= 5) {
        result.push(series.fearless_used_champions[i]);
      }
    }
    return result;
  }

  return [];
}

/**
 * 이미 밴되었거나 픽된 챔피언 + 하드 피어리스 금지 챔피언 ID 집합 반환 ('NO_BAN' 및 null 제외)
 */
export function getUnavailableChampionIds(
  banPickState?: BanPickState | null,
  match?: MatchState | null
): Set<string> {
  const fearlessSet = getFearlessChampionIds(match);
  if (!banPickState) return fearlessSet;

  const allSelected = [
    ...Array.from(fearlessSet),
    ...banPickState.blue_bans,
    ...banPickState.red_bans,
    ...banPickState.blue_picks,
    ...banPickState.red_picks,
  ];

  return new Set(
    allSelected.filter((id): id is string => Boolean(id && id !== 'NO_BAN'))
  );
}

/**
 * 현재 접속자의 역할('FIRST' | 'SECOND' | 'OBSERVER')이 RoFS 결과상 어느 진영('BLUE' | 'RED' | null)인지 판별
 */
export function resolveViewerSide(
  match: MatchState,
  viewerRole: TeamRole | 'OBSERVER'
): SideChoice | null {
  if (viewerRole === 'OBSERVER' || !match.selected_side) return null;

  const teamName =
    viewerRole === 'FIRST' ? match.team_first_name : match.team_second_name;

  if (match.selected_side.blue === teamName) return 'BLUE';
  if (match.selected_side.red === teamName) return 'RED';
  return null;
}

/**
 * 밴픽 20턴 + 마지막 60초 라인 스왑 페이즈 상태 전이 함수
 */
export function transitionBanPickState(
  state: MatchState,
  action: BanPickAction
): TransitionResult<MatchState> {
  // 0. 자동 저장 ON/OFF 토글 액션
  if (action.type === 'TOGGLE_AUTO_SAVE') {
    const currentSeries = getSeriesState(state);
    const updatedSeries: SeriesState = {
      ...currentSeries,
      auto_save_enabled: action.enabled,
    };
    return {
      ok: true,
      state: {
        ...state,
        auto_save_enabled: action.enabled,
        series_state: updatedSeries,
        rofs_submissions: {
          first_choice: state.rofs_submissions?.first_choice ?? null,
          second_choice: state.rofs_submissions?.second_choice ?? null,
          series_state: updatedSeries,
        },
      },
    };
  }

  // 0-1. 하드 피어리스(Hard Fearless) ON/OFF 토글 액션
  if (action.type === 'TOGGLE_FEARLESS') {
    const currentSeries = getSeriesState(state);
    const updatedSeries: SeriesState = {
      ...currentSeries,
      fearless_enabled: action.enabled,
    };
    return {
      ok: true,
      state: {
        ...state,
        series_state: updatedSeries,
        rofs_submissions: {
          first_choice: state.rofs_submissions?.first_choice ?? null,
          second_choice: state.rofs_submissions?.second_choice ?? null,
          series_state: updatedSeries,
        },
      },
    };
  }

  // 0-2. 다전제 다음 세트(Game N+1) 시작 및 FIRST/SECOND 배정 전환 액션
  if (action.type === 'START_NEXT_GAME') {
    const currentSeries = getSeriesState(state);
    const prevBlueTeam = state.selected_side?.blue ?? state.team_first_name;
    const prevRedTeam = state.selected_side?.red ?? state.team_second_name;

    const bluePicks = state.banpick_state
      ? state.banpick_state.blue_picks.filter((id): id is string =>
          Boolean(id && id !== 'NO_BAN')
        )
      : [];
    const redPicks = state.banpick_state
      ? state.banpick_state.red_picks.filter((id): id is string =>
          Boolean(id && id !== 'NO_BAN')
        )
      : [];

    const currentPicks = [...bluePicks, ...redPicks];

    const accumulatedFearless = Array.from(
      new Set([...currentSeries.fearless_used_champions, ...currentPicks])
    );

    const prevTeamPicks = currentSeries.fearless_picks_by_team ?? {};
    const updatedTeamPicks: Record<string, string[]> = {
      ...prevTeamPicks,
      [prevBlueTeam]: Array.from(
        new Set([...(prevTeamPicks[prevBlueTeam] ?? []), ...bluePicks])
      ),
      [prevRedTeam]: Array.from(
        new Set([...(prevTeamPicks[prevRedTeam] ?? []), ...redPicks])
      ),
    };

    const nextGameNum = currentSeries.current_game + 1;
    const nextTotalGames = Math.max(currentSeries.total_games, nextGameNum);

    const teamA = currentSeries.team_a_name;
    const teamB = currentSeries.team_b_name;
    const chosenFirst =
      action.nextFirstTeamName === teamB ? teamB : teamA;
    const chosenSecond = chosenFirst === teamA ? teamB : teamA;

    const nextSchedule = [...currentSeries.game_first_teams];
    nextSchedule[nextGameNum - 1] = chosenFirst;

    const nextWinners = [...(currentSeries.set_winners ?? [])];
    // 이전 세트 승리 팀 기록 (패배팀이 chosenFirst이므로 승리 팀은 chosenSecond)
    nextWinners[currentSeries.current_game - 1] = chosenSecond;

    const updatedSeries: SeriesState = {
      ...currentSeries,
      total_games: nextTotalGames,
      current_game: nextGameNum,
      fearless_enabled:
        action.fearlessEnabled !== undefined
          ? action.fearlessEnabled
          : currentSeries.fearless_enabled,
      fearless_used_champions: accumulatedFearless,
      fearless_picks_by_team: updatedTeamPicks,
      game_first_teams: nextSchedule,
      set_winners: nextWinners,
    };

    return {
      ok: true,
      state: {
        ...state,
        team_first_name: chosenFirst,
        team_second_name: chosenSecond,
        status: 'ROFS_FIRST_PICK',
        selected_side: null,
        pick_turn: null,
        banpick_state: null,
        series_state: updatedSeries,
        rofs_submissions: {
          first_choice: null,
          second_choice: null,
          series_state: updatedSeries,
        },
      },
    };
  }

  // 1. 밴픽 시작 액션 ('BANPICK_READY' -> 'BANPICK_IN_PROGRESS')
  if (action.type === 'START_BANPICK') {
    if (state.status !== 'BANPICK_READY' && state.status !== 'BANPICK_IN_PROGRESS') {
      return {
        ok: false,
        error: `현재 상태(${state.status})에서는 밴픽을 시작할 수 없습니다.`,
      };
    }

    if (!state.selected_side || !state.pick_turn) {
      return {
        ok: false,
        error: 'RoFS 진영 및 픽 순서 결정이 완료되지 않았습니다.',
      };
    }

    const now = action.now ?? Date.now();
    return {
      ok: true,
      state: {
        ...state,
        status: 'BANPICK_IN_PROGRESS',
        banpick_state: createInitialBanPickState(now),
      },
    };
  }

  // 진행 중 상태 검증
  if (state.status !== 'BANPICK_IN_PROGRESS' || !state.banpick_state) {
    return {
      ok: false,
      error: '현재 밴픽이 진행 중이지 않습니다.',
    };
  }

  const bp = state.banpick_state;
  const sequence = getDraftSequence(state);

  // =========================================================================
  // 2. 60초 라인 스왑 페이즈 (current_turn_index >= 20) 액션 처리
  // =========================================================================
  if (isInSwapPhase(state)) {
    // (1) 챔피언 라인(슬롯 위치) 변경 액션
    if (action.type === 'SWAP_CHAMPIONS') {
      const { actorSide, fromSlotIndex, toSlotIndex } = action;
      if (
        fromSlotIndex < 0 ||
        fromSlotIndex > 4 ||
        toSlotIndex < 0 ||
        toSlotIndex > 4
      ) {
        return {
          ok: false,
          error: '유효하지 않은 라인 슬롯 번호입니다.',
        };
      }

      if (fromSlotIndex === toSlotIndex) {
        return { ok: true, state };
      }

      if (actorSide === 'BLUE' && bp.blue_swap_ready) {
        return {
          ok: false,
          error: '블루 팀은 이미 라인 스왑 완료(확정)를 눌렀습니다.',
        };
      }
      if (actorSide === 'RED' && bp.red_swap_ready) {
        return {
          ok: false,
          error: '레드 팀은 이미 라인 스왑 완료(확정)를 눌렀습니다.',
        };
      }

      const nextBluePicks = [...bp.blue_picks];
      const nextRedPicks = [...bp.red_picks];

      if (actorSide === 'BLUE') {
        const temp = nextBluePicks[fromSlotIndex];
        nextBluePicks[fromSlotIndex] = nextBluePicks[toSlotIndex];
        nextBluePicks[toSlotIndex] = temp;
      } else {
        const temp = nextRedPicks[fromSlotIndex];
        nextRedPicks[fromSlotIndex] = nextRedPicks[toSlotIndex];
        nextRedPicks[toSlotIndex] = temp;
      }

      return {
        ok: true,
        state: {
          ...state,
          banpick_state: {
            ...bp,
            blue_picks: nextBluePicks,
            red_picks: nextRedPicks,
          },
        },
      };
    }

    // (2) 각 팀의 라인 스왑 조기 완료 버튼 클릭 액션
    if (action.type === 'READY_SWAP_PHASE') {
      const nextBlueReady =
        action.actorSide === 'BLUE' ? true : Boolean(bp.blue_swap_ready);
      const nextRedReady =
        action.actorSide === 'RED' ? true : Boolean(bp.red_swap_ready);
      const bothReady = nextBlueReady && nextRedReady;

      return {
        ok: true,
        state: {
          ...state,
          status: bothReady ? 'COMPLETED' : 'BANPICK_IN_PROGRESS',
          banpick_state: {
            ...bp,
            blue_swap_ready: nextBlueReady,
            red_swap_ready: nextRedReady,
          },
        },
      };
    }

    // (3) 60초 라인 스왑 타이머 종료 시 최종 완료 전환 액션
    if (action.type === 'FINISH_SWAP_PHASE') {
      return {
        ok: true,
        state: {
          ...state,
          status: 'COMPLETED',
          banpick_state: {
            ...bp,
            blue_swap_ready: true,
            red_swap_ready: true,
          },
        },
      };
    }

    return {
      ok: false,
      error: '현재는 라인 스왑 페이즈입니다. 챔피언 라인 변경만 가능합니다.',
    };
  }

  // =========================================================================
  // 3. 20턴 챔피언 밴/픽 단계 처리
  // =========================================================================
  const currentStep = getCurrentTurnStep(bp, state);

  if (!currentStep) {
    return {
      ok: false,
      error: '모든 밴픽 턴이 이미 종료되었습니다.',
    };
  }

  const unavailableIds = getUnavailableChampionIds(bp, state);

  // 챔피언 프리뷰(Hover) 액션
  if (action.type === 'HOVER_CHAMPION') {
    if (action.actorSide !== currentStep.side) {
      return {
        ok: false,
        error: `현재는 ${currentStep.side} 진영의 차례입니다.`,
      };
    }

    if (
      action.championId &&
      action.championId !== 'NO_BAN' &&
      unavailableIds.has(action.championId)
    ) {
      return {
        ok: false,
        error: '이미 밴되었거나 선택된 챔피언입니다.',
      };
    }

    return {
      ok: true,
      state: {
        ...state,
        banpick_state: {
          ...bp,
          hovered_champion_id: action.championId,
        },
      },
    };
  }

  // 챔피언 선택 완료(Lock-in) 및 타이머 종료(Timeout) 처리
  if (action.type === 'LOCK_IN' || action.type === 'TIMEOUT_TURN') {
    if (
      action.type === 'TIMEOUT_TURN' &&
      typeof action.expectedTurnIndex === 'number' &&
      action.expectedTurnIndex !== bp.current_turn_index
    ) {
      return {
        ok: false,
        error: '이미 다음 턴으로 진행되었습니다.',
      };
    }

    if (action.type === 'LOCK_IN' && action.actorSide !== currentStep.side) {
      return {
        ok: false,
        error: `현재는 ${currentStep.side} 진영의 차례입니다.`,
      };
    }

    const chosenId =
      action.type === 'LOCK_IN' ? action.championId : action.fallbackChampionId;

    if (!chosenId) {
      return {
        ok: false,
        error: '챔피언을 먼저 선택해주세요.',
      };
    }

    if (currentStep.actionType === 'PICK' && chosenId === 'NO_BAN') {
      return {
        ok: false,
        error: '픽(PICK) 턴에는 챔피언을 반드시 선택해야 합니다.',
      };
    }

    if (chosenId !== 'NO_BAN' && unavailableIds.has(chosenId)) {
      return {
        ok: false,
        error: '이미 밴되었거나 선택된 챔피언입니다.',
      };
    }

    const nextBlueBans = [...bp.blue_bans];
    const nextRedBans = [...bp.red_bans];
    const nextBluePicks = [...bp.blue_picks];
    const nextRedPicks = [...bp.red_picks];

    if (currentStep.actionType === 'BAN') {
      if (currentStep.side === 'BLUE') {
        nextBlueBans[currentStep.slotIndex] = chosenId;
      } else {
        nextRedBans[currentStep.slotIndex] = chosenId;
      }
    } else {
      if (currentStep.side === 'BLUE') {
        nextBluePicks[currentStep.slotIndex] = chosenId;
      } else {
        nextRedPicks[currentStep.slotIndex] = chosenId;
      }
    }

    const nextTurnIndex = bp.current_turn_index + 1;
    const isEnteringSwapPhase = nextTurnIndex >= sequence.length;
    const now = action.now ?? Date.now();

    return {
      ok: true,
      state: {
        ...state,
        // 20턴이 모두 끝나면 곧바로 COMPLETED가 아니라 60초 라인 스왑 페이즈로 진입!
        status: 'BANPICK_IN_PROGRESS',
        banpick_state: {
          current_turn_index: nextTurnIndex,
          turn_deadline_at: isEnteringSwapPhase
            ? now + SWAP_DURATION_MS
            : now + TURN_DURATION_MS,
          hovered_champion_id: null,
          blue_bans: nextBlueBans,
          red_bans: nextRedBans,
          blue_picks: nextBluePicks,
          red_picks: nextRedPicks,
          blue_swap_ready: false,
          red_swap_ready: false,
        },
      },
    };
  }

  return {
    ok: false,
    error: '알 수 없는 밴픽 액션입니다.',
  };
}
