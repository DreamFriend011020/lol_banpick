'use client';

import React, { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { RealtimeChannel } from '@supabase/supabase-js';
import { BanPickAction, MatchState, RofsAction } from '../../../types/match';
import { transitionRofsState } from '../../../lib/rofsMachine';
import { transitionBanPickState } from '../../../lib/banpickMachine';
import { supabase } from '../../../lib/supabaseClient';
import RofsSelectionScreen, {
  ViewerRole,
} from '../../../components/match/RofsSelectionScreen';
import BanPickDraftScreen from '../../../components/match/BanPickDraftScreen';

interface StoredSession {
  role: ViewerRole;
  enteredName: string;
}

function getStorageKey(matchId: string): string {
  return `lol_banpick_session_${matchId}`;
}

function saveRoleSession(matchId: string, session: StoredSession) {
  if (typeof window === 'undefined') return;
  const key = getStorageKey(matchId);
  window.localStorage.setItem(key, JSON.stringify(session));
  document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(
    session.role
  )}; path=/; max-age=86400`;
}

function loadRoleSession(matchId: string): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const key = getStorageKey(matchId);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function MatchRoomContent() {
  const params = useParams<{ match_id: string }>();
  const searchParams = useSearchParams();
  const matchId = params?.match_id ?? 'demo-match';

  const [viewerRole, setViewerRole] = useState<ViewerRole>('OBSERVER');
  const [enteredTeamName, setEnteredTeamName] = useState<string>('');
  const [isRoleModalOpen, setIsRoleModalOpen] = useState<boolean>(false);
  const [modalTeamInput, setModalTeamInput] = useState<string>('');
  const [roleNotice, setRoleNotice] = useState<string | null>(null);

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

  const [isLoadingMatch, setIsLoadingMatch] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localBroadcastRef = useRef<BroadcastChannel | null>(null);

  // ===========================================================================
  // 0. 로컬 스토리지 / URL 쿼리에서 세션(Role) 복원 또는 팀 이름 입력 모달 표시
  // ===========================================================================
  useEffect(() => {
    const queryRole = searchParams?.get('role')?.toUpperCase();
    if (
      queryRole === 'FIRST' ||
      queryRole === 'SECOND' ||
      queryRole === 'OBSERVER'
    ) {
      setViewerRole(queryRole);
      saveRoleSession(matchId, { role: queryRole, enteredName: queryRole });
      setIsRoleModalOpen(false);
      return;
    }

    const saved = loadRoleSession(matchId);
    if (saved) {
      setViewerRole(saved.role);
      setEnteredTeamName(saved.enteredName);
      setIsRoleModalOpen(false);
    } else {
      setIsRoleModalOpen(true);
    }
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
            setMatch(data.match as MatchState);
          }
        }
      } catch {
        // ignore
      } finally {
        if (isMounted) setIsLoadingMatch(false);
      }
    };

    fetchFromServerStore();

    // (2) 브라우저 멀티탭 실시간 동기화
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel(`lol_banpick_room_${matchId}`);
      bc.onmessage = (event) => {
        if (event.data?.state) {
          setMatch(event.data.state as MatchState);
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
        setMatch(data as MatchState);
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
            setMatch(payload.new as MatchState);
            setErrorMessage(null);
          }
        }
      )
      .on('broadcast', { event: 'ROFS_STATE_UPDATED' }, ({ payload }) => {
        if (payload?.state) {
          setMatch(payload.state as MatchState);
          setErrorMessage(null);
        }
      })
      .on('broadcast', { event: 'BANPICK_STATE_UPDATED' }, ({ payload }) => {
        if (payload?.state) {
          setMatch(payload.state as MatchState);
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
  // 2. 모달 창에서 '본인의 팀 이름' 입력 시 권한(FIRST / SECOND / OBSERVER) 판별
  // ===========================================================================
  const handleVerifyTeamName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = modalTeamInput.trim();
    const normalizedInput = trimmed.toLowerCase();
    const firstNorm = match.team_first_name.trim().toLowerCase();
    const secondNorm = match.team_second_name.trim().toLowerCase();

    let assignedRole: ViewerRole = 'OBSERVER';
    let noticeText =
      '일치하는 참가 팀 이름이 없어 [옵저버 / 관전(읽기 전용)] 권한으로 입장했습니다.';

    if (normalizedInput && normalizedInput === firstNorm) {
      assignedRole = 'FIRST';
      noticeText = `'${match.team_first_name}' 팀 확인 완료 — [FIRST 팀] 권한이 부여되었습니다.`;
    } else if (normalizedInput && normalizedInput === secondNorm) {
      assignedRole = 'SECOND';
      noticeText = `'${match.team_second_name}' 팀 확인 완료 — [SECOND 팀] 권한이 부여되었습니다.`;
    }

    setViewerRole(assignedRole);
    setEnteredTeamName(trimmed || '옵저버');
    saveRoleSession(matchId, {
      role: assignedRole,
      enteredName: trimmed || '옵저버',
    });
    setRoleNotice(noticeText);
    setIsRoleModalOpen(false);
  };

  const handleEnterAsSpectator = () => {
    setViewerRole('OBSERVER');
    setEnteredTeamName('옵저버/관전');
    saveRoleSession(matchId, {
      role: 'OBSERVER',
      enteredName: '옵저버/관전',
    });
    setRoleNotice('[옵저버 / 관전(운영진)] 읽기 전용 권한으로 입장했습니다.');
    setIsRoleModalOpen(false);
  };

  // ===========================================================================
  // 3. 상태 동기화 공통 헬퍼 (Broadcast + 로컬 서버 스토어 + Supabase DB)
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

      // 로컬 서버 스토어(/api/matches/[match_id]) 영구 반영
      if (persistToDb) {
        fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextState),
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
      {/* =====================================================================
          입장 시 팀 이름 확인 모달 (로컬 스토리지/쿠키에 세션 저장)
      ===================================================================== */}
      {isRoleModalOpen && !isLoadingMatch && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="space-y-1.5 text-center">
              <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {match.tournament_name || '공식 토너먼트'} · {match.round_name || 'Match'}
              </span>
              <h2 className="text-xl font-black text-white pt-1">
                참가 팀 이름 확인
              </h2>
              <p className="text-xs text-slate-400">
                본인의 팀 이름을 입력하면 대진표(
                <strong className="text-amber-300">{match.team_first_name}</strong>{' '}
                vs{' '}
                <strong className="text-cyan-300">{match.team_second_name}</strong>
                )와 대조하여 자동으로 팀장 권한이 부여됩니다.
              </p>
            </div>

            <form onSubmit={handleVerifyTeamName} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">
                  본인의 팀 이름 입력
                </label>
                <input
                  type="text"
                  autoFocus
                  value={modalTeamInput}
                  onChange={(e) => setModalTeamInput(e.target.value)}
                  placeholder={`예: ${match.team_first_name} 또는 ${match.team_second_name}`}
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all"
              >
                팀 이름으로 권한 확인 후 입장
              </button>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-800" />
              <span className="flex-shrink mx-3 text-xs text-slate-500">
                또는
              </span>
              <div className="flex-grow border-t border-slate-800" />
            </div>

            <button
              type="button"
              onClick={handleEnterAsSpectator}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors"
            >
              옵저버 / 관전(운영진) 모드로 입장 (읽기 전용)
            </button>
          </div>
        </div>
      )}

      {/* 상단 상태 & 권한 전환 바 */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin"
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold border border-slate-700"
          >
            관리자(/admin)
          </Link>
          <span>
            현재 권한:{' '}
            <strong className="text-amber-300">
              {viewerRole === 'FIRST'
                ? `FIRST 팀 (${match.team_first_name})`
                : viewerRole === 'SECOND'
                  ? `SECOND 팀 (${match.team_second_name})`
                  : '옵저버/관전 (읽기 전용)'}
            </strong>
            {enteredTeamName && ` (입력값: ${enteredTeamName})`}
          </span>
          {roleNotice && (
            <span className="text-emerald-400 font-medium hidden md:inline">
              · {roleNotice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handleDispatchBanPick({
                type: 'TOGGLE_AUTO_SAVE',
                enabled: match.auto_save_enabled === false ? true : false,
              })
            }
            className={`px-3 py-1 rounded font-bold border transition-colors ${
              match.auto_save_enabled !== false
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
            }`}
          >
            결과 자동 저장: {match.auto_save_enabled !== false ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() => {
              setModalTeamInput('');
              setIsRoleModalOpen(true);
            }}
            className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold"
          >
            팀 이름 다시 입력 (모달)
          </button>

          {(['FIRST', 'SECOND', 'OBSERVER'] as ViewerRole[]).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => {
                setViewerRole(role);
                saveRoleSession(matchId, { role, enteredName: role });
              }}
              className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                viewerRole === role
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {role}
            </button>
          ))}
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
