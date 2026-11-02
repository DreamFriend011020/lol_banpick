import {
  FirstTeamRofsChoice,
  MatchState,
  PickOrderChoice,
  PickTurn,
  RofsAction,
  RofsSubmissions,
  SecondTeamRofsChoice,
  SelectedSide,
  SideChoice,
  TransitionResult,
} from '../types/match';

/**
 * 진영 선택에 따른 SelectedSide 객체 생성
 */
function buildSelectedSide(
  choosingTeam: string,
  opponentTeam: string,
  choice: SideChoice
): SelectedSide {
  return choice === 'BLUE'
    ? { blue: choosingTeam, red: opponentTeam }
    : { blue: opponentTeam, red: choosingTeam };
}

/**
 * 픽 순서 선택에 따른 PickTurn 객체 생성
 */
function buildPickTurn(
  choosingTeam: string,
  opponentTeam: string,
  choice: PickOrderChoice
): PickTurn {
  return choice === 'FIRST_PICK'
    ? { first_pick: choosingTeam, last_pick: opponentTeam }
    : { first_pick: opponentTeam, last_pick: choosingTeam };
}

/**
 * FIRST 팀의 선택(1개 옵션)과 SECOND 팀의 선택(2개 옵션 전부)이 모두 완료되었을 때
 * 최종 진영(selected_side)과 픽 순서(pick_turn)를 산출하는 함수
 *
 * 규칙:
 * 1. FIRST 팀이 선택한 옵션(진영 또는 픽 순서)을 최우선으로 적용한다.
 * 2. FIRST 팀이 선택하지 않은 나머지 옵션에 대해서는 SECOND 팀이 미리 정한 옵션을 그대로 적용한다.
 */
export function resolveFinalRofsResult(
  firstTeamName: string,
  secondTeamName: string,
  firstChoice: FirstTeamRofsChoice,
  secondChoice: SecondTeamRofsChoice
): { selected_side: SelectedSide; pick_turn: PickTurn } {
  if (firstChoice.category === 'SIDE') {
    // FIRST 팀이 '진영(Side)'을 선택한 경우:
    // -> 진영은 FIRST 팀의 선택대로 결정
    // -> 나머지 '픽 순서(Pick Order)'는 SECOND 팀이 정한 pickOrderChoice대로 결정
    const selected_side = buildSelectedSide(
      firstTeamName,
      secondTeamName,
      firstChoice.choice
    );
    const pick_turn = buildPickTurn(
      secondTeamName,
      firstTeamName,
      secondChoice.pickOrderChoice
    );
    return { selected_side, pick_turn };
  } else {
    // FIRST 팀이 '픽 순서(Pick Order)'를 선택한 경우:
    // -> 픽 순서는 FIRST 팀의 선택대로 결정
    // -> 나머지 '진영(Side)'은 SECOND 팀이 정한 sideChoice대로 결정
    const pick_turn = buildPickTurn(
      firstTeamName,
      secondTeamName,
      firstChoice.choice
    );
    const selected_side = buildSelectedSide(
      secondTeamName,
      firstTeamName,
      secondChoice.sideChoice
    );
    return { selected_side, pick_turn };
  }
}

/**
 * RoFS 동시 선택 상태 전이 함수 (Reducer / Handler)
 */
export function transitionRofsState(
  state: MatchState,
  action: RofsAction
): TransitionResult<MatchState> {
  if (
    state.status !== 'ROFS_FIRST_PICK' &&
    state.status !== 'ROFS_SECOND_PICK'
  ) {
    return {
      ok: false,
      error: `현재 경기 상태(${state.status})에서는 RoFS 선택을 진행할 수 없습니다.`,
    };
  }

  const currentSubmissions: RofsSubmissions = state.rofs_submissions ?? {
    first_choice: null,
    second_choice: null,
  };

  let nextFirstChoice = currentSubmissions.first_choice;
  let nextSecondChoice = currentSubmissions.second_choice;

  // =========================================================================
  // 1. FIRST 팀장의 선택 제출 (진영 또는 픽 순서 중 택 1)
  // =========================================================================
  if (action.type === 'SUBMIT_FIRST_ROFS') {
    if (action.actor !== 'FIRST') {
      return {
        ok: false,
        error: 'FIRST 팀장만 이 선택을 제출할 수 있습니다.',
      };
    }

    if (nextFirstChoice !== null) {
      return {
        ok: false,
        error: 'FIRST 팀은 이미 RoFS 선택을 완료했습니다.',
      };
    }

    nextFirstChoice = action.selection;
  }

  // =========================================================================
  // 2. SECOND 팀장의 선택 제출 (진영 + 픽 순서 두 가지 옵션 모두 선택)
  // =========================================================================
  if (action.type === 'SUBMIT_SECOND_ROFS') {
    if (action.actor !== 'SECOND') {
      return {
        ok: false,
        error: 'SECOND 팀장만 이 선택을 제출할 수 있습니다.',
      };
    }

    if (nextSecondChoice !== null) {
      return {
        ok: false,
        error: 'SECOND 팀은 이미 RoFS 선택을 완료했습니다.',
      };
    }

    if (!action.selection.sideChoice || !action.selection.pickOrderChoice) {
      return {
        ok: false,
        error: 'SECOND 팀장은 진영(블루/레드)과 픽 순서(선픽/후픽) 두 가지 옵션을 모두 선택해야 합니다.',
      };
    }

    nextSecondChoice = action.selection;
  }

  const nextSubmissions: RofsSubmissions = {
    ...currentSubmissions,
    first_choice: nextFirstChoice,
    second_choice: nextSecondChoice,
  };

  // =========================================================================
  // 3. 두 팀 모두 선택을 마친 경우 -> FIRST 우선 적용 + 나머지 SECOND 적용 후 BANPICK_READY 전환
  // =========================================================================
  if (nextFirstChoice !== null && nextSecondChoice !== null) {
    const { selected_side, pick_turn } = resolveFinalRofsResult(
      state.team_first_name,
      state.team_second_name,
      nextFirstChoice,
      nextSecondChoice
    );

    return {
      ok: true,
      state: {
        ...state,
        selected_side,
        pick_turn,
        rofs_submissions: nextSubmissions,
        status: 'BANPICK_READY',
      },
    };
  }

  // =========================================================================
  // 4. 한 팀만 선택을 마친 경우 -> 상대 팀 선택 대기 상태 유지
  // =========================================================================
  const nextStatus =
    nextFirstChoice !== null && nextSecondChoice === null
      ? 'ROFS_SECOND_PICK'
      : 'ROFS_FIRST_PICK';

  return {
    ok: true,
    state: {
      ...state,
      rofs_submissions: nextSubmissions,
      status: nextStatus,
    },
  };
}
