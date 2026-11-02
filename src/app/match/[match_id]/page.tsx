'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RealtimeChannel } from '@supabase/supabase-js';
import { BanPickAction, MatchState, RofsAction } from '../../../types/match';
import { transitionRofsState } from '../../../lib/rofsMachine';
import { transitionBanPickState } from '../../../lib/banpickMachine';
import { resolveRoleFromKey } from '../../../lib/roleToken';
import { supabase } from '../../../lib/supabaseClient';
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
  ROFS_SECOND_PICK: 1,
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
  incoming: MatchState,
  source: 'broadcast' | 'db' | 'init'
): MatchState {
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
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localBroadcastRef = useRef<BroadcastChannel | null>(null);

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
        }).catch(() => {});
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
          <span>
            접속 권한 (전용 링크 인증됨):{' '}
            <strong
              className={
                viewerRole === 'FIRST'
                  ? 'text-amber-300'
                  : viewerRole === 'SECOND'
                    ? 'text-cyan-300'
                    : 'text-slate-300'
              }
            >
              {viewerRole === 'FIRST'
                ? `🔒 FIRST 팀장 (${match.team_first_name})`
                : viewerRole === 'SECOND'
                  ? `🔒 SECOND 팀장 (${match.team_second_name})`
                  : '👀 옵저버 / 관전 전용 (읽기 전용)'}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded font-bold border ${
              match.auto_save_enabled !== false
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-slate-800/80 text-slate-400 border-slate-700'
            }`}
          >
            결과 자동 저장: {match.auto_save_enabled !== false ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      {/* 1단계: RoFS 진영/픽 순서 결정 화면 */}
      {(match.status === 'ROFS_FIRST_PICK' ||
        match.status === 'ROFS_SECOND_PICK') && (
        <RofsSelectionScreen
          match={match}
          viewerRole={viewerRole}
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
          viewerRole={viewerRole}
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
