'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RealtimeChannel } from '@supabase/supabase-js';
import { BanPickAction, MatchState, RofsAction } from '../../../types/match';
import { resolveFinalRofsResult, transitionRofsState } from '../../../lib/rofsMachine';
import {
  getSeriesState,
  isMatchAutoSaveEnabled,
  isScrimMatchRoom,
  transitionBanPickState,
} from '../../../lib/banpickMachine';
import { resolveRoleFromKey } from '../../../lib/roleToken';
import { supabase } from '../../../lib/supabaseClient';
import { fetchLatestChampions } from '../../../lib/ddragon';
import { ChampionInfo } from '../../../types/match';
import RofsSelectionScreen, {
  ViewerRole,
} from '../../../components/match/RofsSelectionScreen';
import BanPickDraftScreen from '../../../components/match/BanPickDraftScreen';

interface StoredSession {
  key: string;
}

function getStorageKey(matchId: string): string {
  return `lol_banpick_key_${matchId}`;
}

function saveRoleKeySession(matchId: string, accessKey: string) {
  if (typeof window === 'undefined') return;
  const storageKey = getStorageKey(matchId);
  const payload: StoredSession = { key: accessKey };
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

function loadRoleKeySession(matchId: string): string | null {
  if (typeof window === 'undefined') return null;
  const storageKey = getStorageKey(matchId);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.key ?? null;
  } catch {
    return null;
  }
}

const STATUS_PRIORITY: Record<MatchState['status'], number> = {
  ROFS_FIRST_PICK: 0,
  ROFS_SECOND_PICK: 0,
  BANPICK_READY: 2,
  BANPICK_IN_PROGRESS: 3,
  COMPLETED: 4,
};

/**
 * 실시간 브로드캐스트와 DB(postgres_changes) 이벤트가 시간차로 중복 도착할 때
 * 이전 턴으로 롤백되거나 동일 턴의 타이머(turn_deadline_at) 및 프리뷰(hover)가 덮어씌워지는 현상을 방지합니다.
 */
function mergeIncomingMatchState(
  prev: MatchState,
  incomingRaw: MatchState,
  source: 'broadcast' | 'db' | 'init'
): MatchState {
  const resolvedAutoSave =
    typeof incomingRaw.auto_save_enabled === 'boolean'
      ? incomingRaw.auto_save_enabled
      : typeof incomingRaw.rofs_submissions?.series_state?.auto_save_enabled ===
        'boolean'
        ? incomingRaw.rofs_submissions.series_state.auto_save_enabled
        : isMatchAutoSaveEnabled(prev);

  const incoming: MatchState = {
    ...incomingRaw,
    auto_save_enabled: resolvedAutoSave,
    drive_folder_id:
      incomingRaw.drive_folder_id ??
      incomingRaw.rofs_submissions?.series_state?.drive_folder_id ??
      prev.drive_folder_id,
    drive_webhook_url:
      incomingRaw.drive_webhook_url ??
      incomingRaw.rofs_submissions?.series_state?.drive_webhook_url ??
      prev.drive_webhook_url,
  };

  const prevGame = getSeriesState(prev).current_game;
  const nextGame = getSeriesState(incoming).current_game;

  // 다전제 다음 세트로 넘어간 경우 즉시 새 세트 상태 수락
  if (nextGame > prevGame) {
    return incoming;
  }
  // 이전 세트의 지연 패킷은 무시
  if (nextGame < prevGame) {
    return prev;
  }

  if (source === 'init') {
    const prevRank = STATUS_PRIORITY[prev.status] ?? 0;
    const nextRank = STATUS_PRIORITY[incoming.status] ?? 0;
    if (prevRank > nextRank) return prev;
    if (
      prev.status === 'BANPICK_IN_PROGRESS' &&
      incoming.status === 'BANPICK_IN_PROGRESS' &&
      prev.banpick_state &&
      incoming.banpick_state &&
      prev.banpick_state.current_turn_index >
      incoming.banpick_state.current_turn_index
    ) {
      return prev;
    }
    return incoming;
  }

  const prevRank = STATUS_PRIORITY[prev.status] ?? 0;
  const nextRank = STATUS_PRIORITY[incoming.status] ?? 0;

  // 이미 더 진행된 단계(예: COMPLETED -> BANPICK_IN_PROGRESS)로 역행하는 지연 패킷 무시
  if (nextRank < prevRank) {
    return prev;
  }

  // RoFS 동시 선택 단계에서 양 팀의 제출값이 서로 덮어씌워져 해제되지 않도록 병합
  if (prevRank === 0 && nextRank === 0) {
    const mergedFirst =
      incoming.rofs_submissions?.first_choice ??
      prev.rofs_submissions?.first_choice ??
      null;
    const mergedSecond =
      incoming.rofs_submissions?.second_choice ??
      prev.rofs_submissions?.second_choice ??
      null;

    const mergedSubmissions = {
      ...(prev.rofs_submissions ?? {}),
      ...(incoming.rofs_submissions ?? {}),
      first_choice: mergedFirst,
      second_choice: mergedSecond,
    };

    if (mergedFirst !== null && mergedSecond !== null) {
      const { selected_side, pick_turn } = resolveFinalRofsResult(
        incoming.team_first_name,
        incoming.team_second_name,
        mergedFirst,
        mergedSecond
      );
      const readyState: MatchState = {
        ...incoming,
        selected_side,
        pick_turn,
        rofs_submissions: mergedSubmissions,
        status: 'BANPICK_READY',
      };
      const bpStart = transitionBanPickState(readyState, {
        type: 'START_BANPICK',
        now: Date.now(),
      });
      return bpStart.ok ? bpStart.state : readyState;
    }

    return {
      ...incoming,
      rofs_submissions: mergedSubmissions,
      status:
        mergedFirst !== null && mergedSecond === null
          ? 'ROFS_SECOND_PICK'
          : 'ROFS_FIRST_PICK',
    };
  }

  // 밴픽 진행 중일 때 턴 인덱스 및 타이머 중복 보호
  if (
    prev.status === 'BANPICK_IN_PROGRESS' &&
    incoming.status === 'BANPICK_IN_PROGRESS' &&
    prev.banpick_state &&
    incoming.banpick_state
  ) {
    const prevTurn = prev.banpick_state.current_turn_index;
    const nextTurn = incoming.banpick_state.current_turn_index;

    // 이미 지나간 턴의 지연 패킷은 무시
    if (nextTurn < prevTurn) {
      return prev;
    }

    // 동일한 턴(0~19)에 대한 패킷이 중복 도착한 경우:
    // - 처음 설정된 turn_deadline_at을 유지하여 타이머가 다시 30초로 튀거나 흔들리지 않게 고정
    // - DB(postgres_changes) 지연 패킷이 현재 프리뷰(hovered_champion_id)를 지우지 않도록 보호
    if (nextTurn === prevTurn && nextTurn < 20) {
      return {
        ...incoming,
        banpick_state: {
          ...incoming.banpick_state,
          turn_deadline_at: prev.banpick_state.turn_deadline_at,
          hovered_champion_id:
            source === 'db'
              ? prev.banpick_state.hovered_champion_id
              : incoming.banpick_state.hovered_champion_id,
        },
      };
    }

    // 동일한 60초 라인 스왑 페이즈(turn 20) 중일 때: 타이머 마감 시각 고정
    if (nextTurn === prevTurn && nextTurn >= 20) {
      return {
        ...incoming,
        banpick_state: {
          ...incoming.banpick_state,
          turn_deadline_at: prev.banpick_state.turn_deadline_at,
        },
      };
    }
  }

  return incoming;
}

function MatchRoomContent() {
  const params = useParams<{ match_id: string }>();
  const searchParams = useSearchParams();
  const matchId = params?.match_id ?? 'demo-match';

  const [viewerRole, setViewerRole] = useState<ViewerRole>('OBSERVER');

  const [match, setMatch] = useState<MatchState>({
    match_id: matchId,
    tournament_name: '공식 토너먼트',
    round_name: 'Match',
    team_first_name: 'T1',
    team_second_name: 'GEN',
    status: 'ROFS_FIRST_PICK',
    selected_side: null,
    pick_turn: null,
    rofs_submissions: {
      first_choice: null,
      second_choice: null,
    },
    banpick_state: null,
    auto_save_enabled: false,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localBroadcastRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    fetchLatestChampions()
      .then((res) => setChampions(res.champions))
      .catch(() => { });
  }, []);

  // ===========================================================================
  // 0. 팀별 전용 초대 링크(?key=...) 보안 키를 검증하여 권한(FIRST / SECOND / OBSERVER) 고정
  // ===========================================================================
  useEffect(() => {
    const queryKey = searchParams?.get('key');
    if (queryKey) {
      const assignedRole = resolveRoleFromKey(matchId, queryKey);
      setViewerRole(assignedRole);
      saveRoleKeySession(matchId, queryKey);
      return;
    }

    const savedKey = loadRoleKeySession(matchId);
    const assignedRole = resolveRoleFromKey(matchId, savedKey);
    setViewerRole(assignedRole);
  }, [matchId, searchParams]);

  // ===========================================================================
  // 1. 초기 경기 데이터 로드 (로컬 서버 API + Supabase) 및 실시간 구독
  // ===========================================================================
  useEffect(() => {
    let isMounted = true;

    // (1) 서버 스토어(/api/matches/[match_id])에서 관리자가 생성한 경기 정보 조회
    const fetchFromServerStore = async () => {
      try {
        const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.ok && data.match && isMounted) {
            setMatch((prev) =>
              mergeIncomingMatchState(prev, data.match as MatchState, 'init')
            );
          }
        }
      } catch {
        // ignore
      }
    };

    fetchFromServerStore();

    // (2) 브라우저 멀티탭 실시간 동기화
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel(`lol_banpick_room_${matchId}`);
      bc.onmessage = (event) => {
        if (event.data?.state) {
          setMatch((prev) =>
            mergeIncomingMatchState(
              prev,
              event.data.state as MatchState,
              'broadcast'
            )
          );
          setErrorMessage(null);
        }
      };
      localBroadcastRef.current = bc;
    }

    const sb = supabase;
    if (!sb) {
      return () => {
        isMounted = false;
        localBroadcastRef.current?.close();
        localBroadcastRef.current = null;
      };
    }

    // (3) Supabase DB 조회 (설정된 경우)
    const fetchInitialSupabaseMatch = async () => {
      const { data, error } = await sb
        .from('matches')
        .select('*')
        .eq('match_id', matchId)
        .single();

      if (!error && data && isMounted) {
        setMatch((prev) =>
          mergeIncomingMatchState(prev, data as MatchState, 'init')
        );
      }
    };

    fetchInitialSupabaseMatch();

    // (4) Supabase Realtime 채널 구독
    const channel = sb
      .channel(`match_room:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          if (payload.new) {
            setMatch((prev) =>
              mergeIncomingMatchState(prev, payload.new as MatchState, 'db')
            );
            setErrorMessage(null);
          }
        }
      )
      .on('broadcast', { event: 'ROFS_STATE_UPDATED' }, ({ payload }) => {
        if (payload?.state) {
          setMatch((prev) =>
            mergeIncomingMatchState(
              prev,
              payload.state as MatchState,
              'broadcast'
            )
          );
          setErrorMessage(null);
        }
      })
      .on('broadcast', { event: 'BANPICK_STATE_UPDATED' }, ({ payload }) => {
        if (payload?.state) {
          setMatch((prev) =>
            mergeIncomingMatchState(
              prev,
              payload.state as MatchState,
              'broadcast'
            )
          );
          setErrorMessage(null);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      isMounted = false;
      localBroadcastRef.current?.close();
      localBroadcastRef.current = null;
      sb.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId]);

  // ===========================================================================
  // 2. 상태 동기화 공통 헬퍼 (Broadcast + 로컬 서버 스토어 + Supabase DB)
  // ===========================================================================
  const broadcastAndPersistState = useCallback(
    async (
      nextState: MatchState,
      eventName: 'ROFS_STATE_UPDATED' | 'BANPICK_STATE_UPDATED',
      persistToDb: boolean = true
    ) => {
      // 낙관적 업데이트 (내 화면 즉시 반영)
      setMatch(nextState);

      // 로컬 브라우저 탭 간 즉시 브로드캐스트
      localBroadcastRef.current?.postMessage({
        event: eventName,
        state: nextState,
      });

      // 로컬 서버 스토어(/api/matches/[match_id]) 영구 반영 (Supabase 중복 쓰기 방지)
      if (persistToDb) {
        fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...nextState,
            skipSupabase: Boolean(supabase),
          }),
        }).catch(() => { });
      }

      if (!supabase) return;

      // (1) 모든 클라이언트에게 Supabase Broadcast 즉시 전송
      if (channelRef.current) {
        await channelRef.current.send({
          type: 'broadcast',
          event: eventName,
          payload: { state: nextState },
        });
      }

      // (2) Supabase DB 저장
      if (persistToDb) {
        const { error } = await supabase
          .from('matches')
          .update({
            team_first_name: nextState.team_first_name,
            team_second_name: nextState.team_second_name,
            status: nextState.status,
            selected_side: nextState.selected_side,
            pick_turn: nextState.pick_turn,
            rofs_submissions: nextState.rofs_submissions ?? null,
            banpick_state: nextState.banpick_state ?? null,
          })
          .eq('match_id', matchId);

        if (error) {
          throw new Error(error.message);
        }
      }
    },
    [matchId]
  );

  // ===========================================================================
  // 4. RoFS 선택 확정 핸들러
  // ===========================================================================
  const handleConfirmRofsAction = useCallback(
    async (action: RofsAction) => {
      setErrorMessage(null);

      const result = transitionRofsState(match, action);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      let nextState = result.state;

      // 양 팀 선택이 완료되어 'BANPICK_READY'가 되면 곧바로 밴픽 초기 상태 준비
      if (nextState.status === 'BANPICK_READY') {
        const bpStartResult = transitionBanPickState(nextState, {
          type: 'START_BANPICK',
          now: Date.now(),
        });
        if (bpStartResult.ok) {
          nextState = bpStartResult.state;
        }
      }

      setIsSubmitting(true);
      try {
        await broadcastAndPersistState(nextState, 'ROFS_STATE_UPDATED', true);
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? `동기화 중 오류가 발생했습니다: ${err.message}`
            : '동기화 중 알 수 없는 오류가 발생했습니다.'
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [match, broadcastAndPersistState]
  );

  // ===========================================================================
  // 5. 5:5 토너먼트 드래프트 밴픽 액션 핸들러
  // ===========================================================================
  const handleDispatchBanPick = useCallback(
    async (action: BanPickAction) => {
      setErrorMessage(null);

      const result = transitionBanPickState(match, action);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      const nextState = result.state;
      const isHoverOnly = action.type === 'HOVER_CHAMPION';

      if (!isHoverOnly) {
        setIsSubmitting(true);
      }

      try {
        await broadcastAndPersistState(
          nextState,
          'BANPICK_STATE_UPDATED',
          !isHoverOnly
        );
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? `밴픽 동기화 중 오류가 발생했습니다: ${err.message}`
            : '밴픽 동기화 중 알 수 없는 오류가 발생했습니다.'
        );
      } finally {
        if (!isHoverOnly) {
          setIsSubmitting(false);
        }
      }
    },
    [match, broadcastAndPersistState]
  );

  const seriesState = getSeriesState(match);

  const fearlessChampionMap = React.useMemo(() => {
    const map = new Map<string, ChampionInfo>();
    for (const c of champions) {
      map.set(c.id, c);
    }
    return map;
  }, [champions]);

  const fearlessList = React.useMemo(() => {
    return seriesState.fearless_used_champions
      .filter((id) => Boolean(id && id !== 'NO_BAN'))
      .map((id) => ({
        id,
        info: fearlessChampionMap.get(id),
      }));
  }, [seriesState.fearless_used_champions, fearlessChampionMap]);

  // 다전제에서 세트별로 FIRST/SECOND 팀이 바뀌더라도,
  // 각 팀장이 처음 발급받은 본인 팀 전용 링크 하나로 자기 팀의 현재 세트 역할(FIRST 또는 SECOND)을 그대로 수행하도록 매핑
  const effectiveViewerRole: ViewerRole = React.useMemo(() => {
    if (viewerRole === 'OBSERVER') return 'OBSERVER';

    // 현재 세트의 FIRST 역할을 맡은 고유 팀 식별자 ('TEAM_A' | 'TEAM_B')
    const currentFirstRole: 'TEAM_A' | 'TEAM_B' =
      seriesState.game_first_roles?.[seriesState.current_game - 1] ??
      (match.team_first_name === seriesState.team_b_name ? 'TEAM_B' : 'TEAM_A');

    // viewerRole이 'FIRST'인 사용자는 초기 1팀장 링크(?key=f1...)로 들어온 TEAM_A
    // viewerRole이 'SECOND'인 사용자는 초기 2팀장 링크(?key=s2...)로 들어온 TEAM_B
    const myRole: 'TEAM_A' | 'TEAM_B' =
      viewerRole === 'FIRST' ? 'TEAM_A' : 'TEAM_B';

    return myRole === currentFirstRole ? 'FIRST' : 'SECOND';
  }, [
    viewerRole,
    seriesState.game_first_roles,
    seriesState.current_game,
    seriesState.team_b_name,
    match.team_first_name,
  ]);

  return (
    <div className="relative">
      {/* 상단 고정 상태 바 (전용 초대 링크로 부여된 권한만 표시, 임의 변경 불가) */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold border border-slate-700"
          >
            ← 메인 홈
          </Link>
          <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-extrabold">
            세트 {seriesState.current_game} / {seriesState.total_games}
          </span>
          <span>
            접속 권한 (전용 링크 인증됨):{' '}
            <strong
              className={
                effectiveViewerRole === 'FIRST'
                  ? 'text-amber-300'
                  : effectiveViewerRole === 'SECOND'
                    ? 'text-cyan-300'
                    : 'text-slate-300'
              }
            >
              {effectiveViewerRole === 'FIRST'
                ? `🔒 이번 세트 FIRST 팀장 ${match.team_first_name}`
                : effectiveViewerRole === 'SECOND'
                  ? `🔒 이번 세트 SECOND 팀장 ${match.team_second_name}`
                  : '👀 옵저버 / 관전 전용 (읽기 전용)'}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 하드 피어리스 버튼/배너 + 호버 툴팁 */}
          <div className="relative group/fearless">
            {isScrimMatchRoom(match) ? (
              <button
                type="button"
                onClick={() =>
                  handleDispatchBanPick({
                    type: 'TOGGLE_FEARLESS',
                    enabled: !seriesState.fearless_enabled,
                  })
                }
                className={`px-3 py-1 rounded font-bold border transition-colors ${seriesState.fearless_enabled
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:bg-slate-700'
                  }`}
                title="클릭 시 피어리스 ON/OFF 전환"
              >
                🔥 하드 피어리스: {seriesState.fearless_enabled ? `ON (${fearlessList.length}명 금지)` : 'OFF'}
              </button>
            ) : (
              <span
                className={`px-3 py-1 rounded font-bold border inline-block cursor-help ${seriesState.fearless_enabled
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700'
                  }`}
                title="공식 경기에서는 관리자만 설정을 변경할 수 있습니다. 마우스를 올려 금지 목록을 확인하세요."
              >
                🔥 하드 피어리스: {seriesState.fearless_enabled ? `ON (${fearlessList.length}명 금지)` : 'OFF'}
              </span>
            )}

            {/* 마우스 호버 시 피어리스 금지 챔피언 목록 팝업 */}
            {seriesState.fearless_enabled && (
              <div className="absolute right-0 top-full pt-1.5 hidden group-hover/fearless:block hover:block z-50">
                <div className="w-80 sm:w-96 p-3 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl backdrop-blur-md relative before:content-[''] before:absolute before:-top-3 before:left-0 before:right-0 before:h-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                    <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                      🔥 피어리스 금지 챔피언 목록
                    </span>
                    <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                      총 {fearlessList.length}명
                    </span>
                  </div>

                  {fearlessList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-3">
                      이전 세트에서 선택된 챔피언이 없습니다. (2세트부터 누적)
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto grid grid-cols-5 gap-1.5 pr-1">
                      {fearlessList.map(({ id, info }) => (
                        <div
                          key={`fearless-popup-${id}`}
                          className="flex flex-col items-center bg-slate-950/80 rounded-lg p-1.5 border border-slate-800"
                          title={info?.name ?? id}
                        >
                          <div className="relative w-10 h-10 rounded overflow-hidden bg-slate-900 border border-slate-700">
                            {info ? (
                              <img
                                src={info.imageUrl}
                                alt={info.name}
                                className="w-full h-full object-cover grayscale opacity-75"
                              />
                            ) : (
                              <span className="text-[9px] text-slate-500 flex items-center justify-center h-full">
                                {id.slice(0, 3)}
                              </span>
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-rose-950/30">
                              <div className="w-full h-0.5 bg-rose-500/80 rotate-45" />
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-slate-300 truncate w-full text-center mt-1">
                            {info?.name ?? id}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <span
            className={`px-3 py-1 rounded font-bold border ${isMatchAutoSaveEnabled(match)
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-slate-800/80 text-slate-400 border-slate-700'
              }`}
          >
            결과 자동 저장: {isMatchAutoSaveEnabled(match) ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      {/* 1단계: RoFS 진영/픽 순서 결정 화면 */}
      {(match.status === 'ROFS_FIRST_PICK' ||
        match.status === 'ROFS_SECOND_PICK') && (
          <RofsSelectionScreen
            match={match}
            viewerRole={effectiveViewerRole}
            isSubmitting={isSubmitting}
            errorMessage={errorMessage}
            onConfirmAction={handleConfirmRofsAction}
          />
        )}

      {/* 2단계: RoFS 완료 후 5:5 토너먼트 드래프트 밴픽 화면 */}
      {(match.status === 'BANPICK_READY' ||
        match.status === 'BANPICK_IN_PROGRESS' ||
        match.status === 'COMPLETED') && (
          <BanPickDraftScreen
            match={match}
            viewerRole={effectiveViewerRole}
            isSubmitting={isSubmitting}
            errorMessage={errorMessage}
            onDispatchBanPick={handleDispatchBanPick}
          />
        )}
    </div>
  );
}

export default function MatchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">
          경기 방 데이터를 불러오는 중입니다...
        </div>
      }
    >
      <MatchRoomContent />
    </Suspense>
  );
}
