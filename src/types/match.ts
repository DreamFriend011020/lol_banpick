export type MatchStatus =
  | 'ROFS_FIRST_PICK'
  | 'ROFS_SECOND_PICK'
  | 'BANPICK_READY'
  | 'BANPICK_IN_PROGRESS'
  | 'COMPLETED';

export type TeamRole = 'FIRST' | 'SECOND';
export type SideChoice = 'BLUE' | 'RED';
export type PickOrderChoice = 'FIRST_PICK' | 'LAST_PICK';

export interface SelectedSide {
  blue: string; // 블루 진영 팀 이름
  red: string;  // 레드 진영 팀 이름
}

export interface PickTurn {
  first_pick: string; // 선픽 팀 이름
  last_pick: string;  // 후픽 팀 이름
}

/**
 * FIRST 팀장의 RoFS 선택 (진영 또는 픽 순서 중 1개만 선택)
 */
export type FirstTeamRofsChoice =
  | { category: 'SIDE'; choice: SideChoice }
  | { category: 'PICK_ORDER'; choice: PickOrderChoice };

/**
 * SECOND 팀장의 RoFS 사전 선택 (진영 + 픽 순서 2가지 모두 선택)
 * - FIRST 팀이 선택하지 않은 나머지 카테고리에 SECOND 팀의 선택값이 자동 적용됨
 */
export interface SecondTeamRofsChoice {
  sideChoice: SideChoice;
  pickOrderChoice: PickOrderChoice;
}

/**
 * 다전제(Bo3/Bo5 등) 및 하드 피어리스(Hard Fearless) 진행 상태
 * (Supabase JSONB 컬럼인 rofs_submissions 내부에도 함께 저장되어 별도 DB 스키마 변경 없이 완벽 동기화됨)
 */
export interface SeriesState {
  total_games: number;               // 총 진행 판수 (예: 1, 2, 3, 5)
  current_game: number;              // 현재 진행 중인 세트 번호 (1 ~ total_games)
  fearless_enabled: boolean;         // 하드 피어리스 룰 ON/OFF (이전 세트에서 픽된 모든 챔피언 금지)
  fearless_used_champions: string[]; // 이전 세트들에서 픽된 누적 챔피언 ID 목록
  fearless_picks_by_team?: Record<string, string[]>; // 각 팀별 이전 세트들에서 선택한 누적 챔피언 ID 목록
  game_first_teams: string[];        // 각 세트별(인덱스 0 = 1세트) FIRST 권한을 가진 팀 기록
  set_winners?: string[];            // 각 세트별 승리 팀 기록 (패배팀이 다음 세트 FIRST가 됨)
  team_a_name: string;               // 1번 고정 링크(?key=f1...)를 발급받은 기준 팀 이름 (1세트 FIRST)
  team_b_name: string;               // 2번 고정 링크(?key=s2...)를 발급받은 기준 팀 이름 (1세트 SECOND)
  auto_save_enabled?: boolean;       // 밴픽 종료 시 자동 저장 ON/OFF (Supabase JSONB 동기화용)
  drive_folder_id?: string;          // 지정 구글 드라이브 폴더 ID/링크
  drive_webhook_url?: string;        // 지정 구글 드라이브 웹앱 URL
  is_scrim?: boolean;                // 스크림(연습) 방 여부 (true일 경우 관리자 없이도 다음 세트 및 피어리스 진행 가능)
}

/**
 * 양 팀의 동시 RoFS 제출 상태
 */
export interface RofsSubmissions {
  first_choice: FirstTeamRofsChoice | null;
  second_choice: SecondTeamRofsChoice | null;
  series_state?: SeriesState;
}

/**
 * Data Dragon 챔피언 정보
 */
export interface ChampionInfo {
  id: string;        // 영문 키 (예: 'Ahri', 'LeeSin')
  key: string;       // 숫자 문자열 ID (예: '103')
  name: string;      // 한글 이름 (예: '아리', '리 신')
  title: string;     // 칭호
  tags: string[];    // 역할군 (예: ['Mage', 'Assassin'])
  imageUrl: string;  // 정사각형 초상화 URL
  splashUrl: string; // 스플래시 이미지 URL
}

export type BanPickPhase =
  | 'PHASE1_BAN'   // 1차 밴 (블루 3밴 / 레드 3밴, 총 6턴)
  | 'PHASE1_PICK'  // 1차 픽 (1-2-2-1, 총 6턴)
  | 'PHASE2_BAN'   // 2차 밴 (각 2밴, 총 4턴)
  | 'PHASE2_PICK'  // 2차 픽 (1-2-1, 총 4턴)
  | 'SWAP_PHASE';  // 모든 챔피언 선택 완료 후 60초 라인 스왑 페이즈

export type DraftActionType = 'BAN' | 'PICK';

/**
 * 공식 토너먼트 드래프트 20턴 중 단일 턴의 정의
 */
export interface DraftTurnStep {
  turnIndex: number;        // 0 ~ 19 (총 20턴)
  phase: BanPickPhase;
  actionType: DraftActionType;
  side: SideChoice;         // 'BLUE' | 'RED'
  slotIndex: number;        // 해당 팀의 밴(0~4) 또는 픽(0~4) 슬롯 번호
  label: string;            // 화면 표시용 라벨 (예: '블루 1밴', '레드 1픽')
}

/**
 * 진행 중인 5:5 토너먼트 드래프트 상태 데이터
 */
export interface BanPickState {
  current_turn_index: number;           // 현재 진행 중인 턴 (0 ~ 19: 밴픽 진행, 20: 60초 라인 스왑 페이즈)
  turn_deadline_at: number;             // 현재 턴 또는 라인 스왑 종료 시각 (Unix timestamp ms)
  hovered_champion_id: string | null;   // 현재 턴 팀이 프리뷰(Hover) 중인 챔피언 ID
  blue_bans: (string | null)[];         // 길이 5 (챔피언 ID 또는 'NO_BAN' 또는 null)
  red_bans: (string | null)[];          // 길이 5
  blue_picks: (string | null)[];        // 길이 5 (슬롯 0~4: TOP, JGL, MID, BOT, SUP)
  red_picks: (string | null)[];         // 길이 5 (슬롯 0~4: TOP, JGL, MID, BOT, SUP)
  blue_swap_ready?: boolean;            // 블루 팀 라인 스왑 완료 여부
  red_swap_ready?: boolean;             // 레드 팀 라인 스왑 완료 여부
}

/**
 * 경기 방(Match) 기본 데이터 모델
 */
export interface MatchState {
  match_id: string;
  tournament_name?: string; // 대회명 (예: 2026 LCK 서머)
  round_name?: string;      // 라운드 (예: 4강 1경기)
  team_first_name: string;  // 대진표상 FIRST 팀
  team_second_name: string; // 대진표상 SECOND 팀
  status: MatchStatus;
  selected_side: SelectedSide | null;
  pick_turn: PickTurn | null;
  rofs_submissions?: RofsSubmissions | null;
  banpick_state?: BanPickState | null;
  auto_save_enabled?: boolean;  // 밴픽 종료 시 자동 저장 활성화 여부
  drive_folder_id?: string;     // 이 경기를 저장할 특정 구글 드라이브 폴더 링크 또는 ID (미지정 시 기본 폴더)
  drive_webhook_url?: string;   // 다른 구글 계정의 드라이브 웹앱 URL (선택)
  series_state?: SeriesState;   // 다전제 및 하드 피어리스 상태
  created_at?: string;
}

/**
 * RoFS 단계에서 발생할 수 있는 액션 정의
 * - FIRST 팀장: 옵션 A(진영) 또는 옵션 B(픽 순서) 중 하나 선택 ('SUBMIT_FIRST_ROFS')
 * - SECOND 팀장: 옵션 A(진영)와 옵션 B(픽 순서) 두 가지 모두 선택 ('SUBMIT_SECOND_ROFS')
 */
export type RofsAction =
  | {
      type: 'SUBMIT_FIRST_ROFS';
      actor: 'FIRST';
      selection: FirstTeamRofsChoice;
    }
  | {
      type: 'SUBMIT_SECOND_ROFS';
      actor: 'SECOND';
      selection: SecondTeamRofsChoice;
    };

/**
 * 밴픽 및 라인 스왑 단계에서 발생할 수 있는 액션 정의
 */
export type BanPickAction =
  | {
      type: 'START_BANPICK';
      now?: number;
    }
  | {
      type: 'HOVER_CHAMPION';
      actorSide: SideChoice;
      championId: string | null;
    }
  | {
      type: 'LOCK_IN';
      actorSide: SideChoice;
      championId: string; // 밴 기권 시 'NO_BAN' 허용
      now?: number;
    }
  | {
      type: 'TIMEOUT_TURN';
      fallbackChampionId: string; // 시간 초과 시 자동 픽/노밴 처리용
      expectedTurnIndex?: number; // 중복 타임아웃 방지용 현재 턴 번호
      now?: number;
    }
  | {
      type: 'SWAP_CHAMPIONS';
      actorSide: SideChoice;
      fromSlotIndex: number; // 0 ~ 4 (TOP, JGL, MID, BOT, SUP)
      toSlotIndex: number;   // 0 ~ 4 (TOP, JGL, MID, BOT, SUP)
    }
  | {
      type: 'READY_SWAP_PHASE';
      actorSide: SideChoice;
    }
  | {
      type: 'FINISH_SWAP_PHASE';
    }
  | {
      type: 'TOGGLE_AUTO_SAVE';
      enabled: boolean;
    }
  | {
      type: 'TOGGLE_FEARLESS';
      enabled: boolean;
    }
  | {
      type: 'START_NEXT_GAME';
      nextFirstTeamName: string;
      fearlessEnabled?: boolean;
    };

/**
 * 상태 전이 결과 타입 (성공/실패 명시적 처리)
 */
export type TransitionResult<T> =
  | { ok: true; state: T }
  | { ok: false; error: string };
