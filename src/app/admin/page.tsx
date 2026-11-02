'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { MatchState } from '../../types/match';
import { buildMatchRolePath, InviteRole } from '../../lib/roleToken';
import {
  getSeriesState,
  transitionBanPickState,
} from '../../lib/banpickMachine';
import { supabase } from '../../lib/supabaseClient';

interface CsvRowPreview {
  tournament_name: string;
  round_name: string;
  team_first_name: string;
  team_second_name: string;
  total_games: number;
  fearless_enabled: boolean;
  match_id?: string;
  auto_save_enabled?: boolean;
  drive_folder_id?: string;
}

const ADMIN_AUTH_STORAGE_KEY = 'lol_banpick_admin_authenticated';

export default function AdminPage() {
  // 관리자 암호 인증 상태
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isVerifyingPassword, setIsVerifyingPassword] =
    useState<boolean>(false);

  const [matches, setMatches] = useState<MatchState[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 단일 경기 생성 폼 상태
  const [tournamentName, setTournamentName] = useState('2026 LoL 챔피언스 컵');
  const [roundName, setRoundName] = useState('8강 1경기');
  const [firstTeamName, setFirstTeamName] = useState('');
  const [secondTeamName, setSecondTeamName] = useState('');
  const [customMatchId, setCustomMatchId] = useState('');
  const [totalGames, setTotalGames] = useState<number>(3);
  const [fearlessEnabled, setFearlessEnabled] = useState<boolean>(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);
  const [driveFolderId, setDriveFolderId] = useState<string>('');
  const [driveWebhookUrl, setDriveWebhookUrl] = useState<string>('');

  // CSV 일괄 업로드 상태
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvRowPreview[]>([]);

  const fetchMatches = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/matches');
      const data = await res.json();
      if (data?.ok && Array.isArray(data.matches)) {
        setMatches(data.matches);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAuth = window.sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
      if (savedAuth === 'true') {
        setIsAuthenticated(true);
        fetchMatches();
      }
      setIsCheckingAuth(false);
    }
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsVerifyingPassword(true);

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();

      if (res.ok && data?.ok) {
        window.sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'true');
        setIsAuthenticated(true);
        setPasswordInput('');
        await fetchMatches();
      } else {
        setAuthError(data?.error || '관리자 암호가 올바르지 않습니다.');
      }
    } catch {
      setAuthError('암호 확인 중 오류가 발생했습니다.');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handleAdminLogout = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
    }
    setIsAuthenticated(false);
    setPasswordInput('');
  };

  // 단일 경기 추가 핸들러
  const handleCreateSingleMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNotice(null);

    if (!firstTeamName.trim() || !secondTeamName.trim()) {
      setErrorMsg('FIRST 팀 이름과 SECOND 팀 이름을 모두 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const first = firstTeamName.trim();
      const second = secondTeamName.trim();

      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_name: tournamentName.trim() || '공식 토너먼트',
          round_name: roundName.trim() || '1라운드',
          team_first_name: first,
          team_second_name: second,
          match_id: customMatchId.trim() || undefined,
          total_games: totalGames,
          fearless_enabled: fearlessEnabled,
          auto_save_enabled: autoSaveEnabled,
          drive_folder_id: driveFolderId.trim() || undefined,
          drive_webhook_url: driveWebhookUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || '경기 생성 실패');
      }

      setFirstTeamName('');
      setSecondTeamName('');
      setCustomMatchId('');
      setNotice(
        `경기가 생성되었습니다! 고유 링크: /match/${data.created[0].match_id}`
      );
      await fetchMatches();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : '경기 생성 중 오류가 발생했습니다.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // CSV 파싱 헬퍼
  // 권장 형식: 대회명,라운드,1세트FIRST팀,1세트SECOND팀,진행판수(1~5),피어리스(ON/OFF),고유ID(선택),드라이브폴더ID(선택)
  // (하위 호환: 대회명,라운드,FIRST팀,SECOND팀[,고유ID] 또는 FIRST팀,SECOND팀 형식도 자동 인식)
  const parseCsvContent = (raw: string): CsvRowPreview[] => {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parseGamesCount = (val?: string): number | null => {
      if (!val) return null;
      const cleaned = val.trim().toLowerCase().replace(/^bo/, '').replace(/판$/, '');
      const num = Number(cleaned);
      if (Number.isInteger(num) && num >= 1 && num <= 5) {
        return num;
      }
      return null;
    };

    const parseFearlessFlag = (val?: string): boolean => {
      if (!val) return fearlessEnabled;
      const v = val.trim().toLowerCase();
      if (['on', 'true', 'y', 'yes', '1', '사용', '피어리스'].includes(v)) {
        return true;
      }
      if (['off', 'false', 'n', 'no', '0', '미사용', '일반'].includes(v)) {
        return false;
      }
      return fearlessEnabled;
    };

    const rows: CsvRowPreview[] = [];
    lines.forEach((line, idx) => {
      const cols = line.split(',').map((c) => c.trim());
      if (cols.length < 2) return;

      if (
        idx === 0 &&
        (cols[0].includes('대회') ||
          cols[0].toLowerCase().includes('tournament') ||
          cols[2]?.toLowerCase().includes('first') ||
          cols[4]?.includes('판수'))
      ) {
        return;
      }

      if (cols.length >= 4) {
        const parsedGames = parseGamesCount(cols[4]);
        // cols[4]가 판수(1~5, Bo3 등)인 신규 공식 CSV 양식
        if (parsedGames !== null || cols.length >= 6) {
          rows.push({
            tournament_name: cols[0] || '공식 토너먼트',
            round_name: cols[1] || `Round ${idx + 1}`,
            team_first_name: cols[2],
            team_second_name: cols[3],
            total_games: parsedGames ?? totalGames,
            fearless_enabled: parseFearlessFlag(cols[5]),
            match_id: cols[6] || undefined,
            drive_folder_id: cols[7] || driveFolderId.trim() || undefined,
            auto_save_enabled: autoSaveEnabled,
          });
        } else {
          // 기존 4~5열 양식 (대회명,라운드,FIRST팀,SECOND팀[,고유ID])
          rows.push({
            tournament_name: cols[0] || '공식 토너먼트',
            round_name: cols[1] || `Round ${idx + 1}`,
            team_first_name: cols[2],
            team_second_name: cols[3],
            total_games: totalGames,
            fearless_enabled: fearlessEnabled,
            match_id: cols[4] || undefined,
            drive_folder_id: driveFolderId.trim() || undefined,
            auto_save_enabled: autoSaveEnabled,
          });
        }
      } else if (cols.length === 2) {
        rows.push({
          tournament_name: tournamentName || '공식 토너먼트',
          round_name: `Match ${idx + 1}`,
          team_first_name: cols[0],
          team_second_name: cols[1],
          total_games: totalGames,
          fearless_enabled: fearlessEnabled,
          drive_folder_id: driveFolderId.trim() || undefined,
          auto_save_enabled: autoSaveEnabled,
        });
      }
    });

    return rows.filter((r) => r.team_first_name && r.team_second_name);
  };

  // CSV 파일 선택 시 읽기
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '');
      setCsvText(text);
      setCsvPreview(parseCsvContent(text));
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleCsvTextChange = (val: string) => {
    setCsvText(val);
    setCsvPreview(parseCsvContent(val));
  };

  // CSV 일괄 생성 제출
  const handleBulkCreateFromCsv = async () => {
    if (csvPreview.length === 0) {
      setErrorMsg('업로드할 유효한 CSV 대진표 데이터가 없습니다.');
      return;
    }

    setErrorMsg(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const payload = csvPreview.map((r) => ({
        ...r,
        auto_save_enabled: autoSaveEnabled,
      }));
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: payload }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'CSV 일괄 생성 실패');
      }

      setCsvText('');
      setCsvPreview([]);
      setNotice(
        `총 ${data.created.length}개의 경기가 일괄 생성되고 고유 링크가 발급되었습니다!`
      );
      await fetchMatches();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'CSV 일괄 생성 중 오류가 발생했습니다.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 샘플 CSV 다운로드
  const handleDownloadSampleCsv = () => {
    const sample = [
      '대회명,라운드,1세트FIRST팀,1세트SECOND팀,진행판수(1~5),피어리스(ON/OFF),고유ID(선택),드라이브폴더ID(선택)',
      '2026 LCK 서머,8강 1경기,T1,GEN,3,ON,lck-qf-1,',
      '2026 LCK 서머,8강 2경기,HLE,DK,3,ON,lck-qf-2,',
      '2026 LCK 서머,4강 1경기,KT,KDF,5,ON,lck-sf-1,',
      '2026 공식 스크림,연습 1경기,T1,GEN,3,OFF,scrim-01,',
    ].join('\n');

    const blob = new Blob(['\uFEFF' + sample], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample_matches.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 경기 역할별 전용 링크 클립보드 복사
  const handleCopyRoleLink = async (matchId: string, role: InviteRole) => {
    const path = buildMatchRolePath(matchId, role);
    const fullUrl = `${window.location.origin}${path}`;
    const copyTag = `${matchId}:${role}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(copyTag);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  // 관리자 전용: 경기 상태 업데이트 + 실시간 브로드캐스트 공통 헬퍼
  const syncAdminMatchUpdate = async (nextState: MatchState) => {
    await fetch(`/api/matches/${encodeURIComponent(nextState.match_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextState),
    });

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel(`lol_banpick_room_${nextState.match_id}`);
      bc.postMessage({
        event: 'BANPICK_STATE_UPDATED',
        state: nextState,
      });
      bc.close();
    }

    if (supabase) {
      const ch = supabase.channel(`match_room:${nextState.match_id}`);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({
            type: 'broadcast',
            event: 'BANPICK_STATE_UPDATED',
            payload: { state: nextState },
          }).finally(() => {
            supabase?.removeChannel(ch);
          });
        }
      });
    }

    await fetchMatches();
  };

  // 특정 경기의 자동 저장 ON/OFF 토글
  const handleToggleMatchAutoSave = async (m: MatchState) => {
    const nextVal = m.auto_save_enabled === false ? true : false;
    await fetch(`/api/matches/${encodeURIComponent(m.match_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_save_enabled: nextVal }),
    });
    await fetchMatches();
  };

  // 특정 경기의 하드 피어리스 ON/OFF 토글 (관리자 전용)
  const handleToggleMatchFearless = async (m: MatchState) => {
    const series = getSeriesState(m);
    const res = transitionBanPickState(m, {
      type: 'TOGGLE_FEARLESS',
      enabled: !series.fearless_enabled,
    });
    if (res.ok) {
      await syncAdminMatchUpdate(res.state);
    }
  };

  // 관리자 전용: 현재 세트 패배팀을 지정하여 다음 세트(패배팀 = FIRST) RoFS 시작
  const handleAdminConfirmSetLoserAndStartNext = async (
    m: MatchState,
    loserTeamName: string
  ) => {
    const series = getSeriesState(m);
    const winnerTeamName =
      loserTeamName === series.team_a_name
        ? series.team_b_name
        : series.team_a_name;

    const res = transitionBanPickState(m, {
      type: 'START_NEXT_GAME',
      nextFirstTeamName: loserTeamName,
      fearlessEnabled: series.fearless_enabled,
    });

    if (res.ok) {
      await syncAdminMatchUpdate(res.state);
      setNotice(
        `[${m.match_id}] ${series.current_game}세트 결과 확정 (${winnerTeamName} 승 / ${loserTeamName} 패) → ${series.current_game + 1}세트 FIRST 팀으로 '${loserTeamName}' 배정 및 RoFS가 시작되었습니다!`
      );
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
      method: 'DELETE',
    });
    await fetchMatches();
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center">
        관리자 권한을 확인하는 중입니다...
      </div>
    );
  }

  // 암호 미인증 시 관리자 암호 입력 화면 표시
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="space-y-2 text-center">
            <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Admin Protected
            </span>
            <h1 className="text-2xl font-black text-white pt-2">
              관리자(운영진) 암호 입력
            </h1>
            <p className="text-xs text-slate-400">
              대진표 등록 및 경기 링크 발급 페이지에 접근하려면 운영진 암호를 입력하세요.
            </p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Admin Password
              </label>
              <input
                type="password"
                autoFocus
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="관리자 암호 입력"
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            {authError && (
              <div className="rounded-xl bg-rose-950/60 border border-rose-500/50 p-3 text-xs text-rose-200 text-center font-medium">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifyingPassword}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all disabled:opacity-50"
            >
              {isVerifyingPassword ? '확인 중...' : '관리자 페이지 입장'}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800 text-center">
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-slate-200 font-semibold"
            >
              ← 메인 홈으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* 상단 헤더 */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Admin Console
            </span>
            <h1 className="text-2xl md:text-3xl font-black text-white mt-2">
              관리자(운영진) 대진표 등록 & 경기 링크 발급
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              단일 경기를 추가하거나 CSV 파일로 대진표를 일괄 업로드하여{' '}
              <code className="text-amber-300">/match/[match_id]</code> 고유 링크를 발급합니다.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={handleAdminLogout}
              className="px-3.5 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/60 text-xs font-bold text-rose-200"
            >
              잠금 (로그아웃)
            </button>
            <Link
              href="/"
              className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              ← 메인 홈으로
            </Link>
          </div>
        </header>

        {/* 알림 메시지 */}
        {notice && (
          <div className="rounded-xl bg-emerald-950/60 border border-emerald-500/50 p-4 text-sm text-emerald-200 font-medium">
            ✓ {notice}
          </div>
        )}
        {errorMsg && (
          <div className="rounded-xl bg-rose-950/60 border border-rose-500/50 p-4 text-sm text-rose-200 font-medium">
            {errorMsg}
          </div>
        )}

        {/* 생성 영역: 좌측 단일 경기 추가 폼 / 우측 CSV 일괄 업로드 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. 단일 경기 추가 폼 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">
              1. 개별 경기 추가
            </h2>

            <form onSubmit={handleCreateSingleMatch} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">
                    대회명
                  </label>
                  <input
                    type="text"
                    value={tournamentName}
                    onChange={(e) => setTournamentName(e.target.value)}
                    placeholder="예: 2026 LCK 서머"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">
                    라운드
                  </label>
                  <input
                    type="text"
                    value={roundName}
                    onChange={(e) => setRoundName(e.target.value)}
                    placeholder="예: 8강 1경기"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-amber-400 mb-1">
                    1세트 FIRST 팀 이름 *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstTeamName}
                    onChange={(e) => setFirstTeamName(e.target.value)}
                    placeholder="예: T1"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-cyan-400 mb-1">
                    1세트 SECOND 팀 이름 *
                  </label>
                  <input
                    type="text"
                    required
                    value={secondTeamName}
                    onChange={(e) => setSecondTeamName(e.target.value)}
                    placeholder="예: GEN"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">
                  고유 Match ID 지정 (선택 — 비워두면 자동 생성)
                </label>
                <input
                  type="text"
                  value={customMatchId}
                  onChange={(e) => setCustomMatchId(e.target.value)}
                  placeholder="예: match-qf-01"
                  className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* 다전제 판수 & 하드 피어리스 ON/OFF */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">
                      진행 판수 (다전제 설정)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      1세트 진행 후 2세트부터는 <strong className="text-amber-300">이전 세트 패배팀이 FIRST</strong>가 됩니다.
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {[1, 2, 3, 4, 5].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setTotalGames(cnt)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition-colors ${
                          totalGames === cnt
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        {cnt}판
                      </button>
                    ))}
                  </div>
                </div>

                {/* 하드 피어리스 ON/OFF 토글 */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <div>
                    <div className="text-xs font-bold text-rose-300">
                      🔥 하드 피어리스 룰 (Hard Fearless Draft)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {fearlessEnabled
                        ? 'ON: 이전 세트에서 픽된 모든 챔피언이 다음 세트에서 누적 금지됩니다.'
                        : 'OFF: 이전 세트 픽과 무관하게 모든 챔피언을 사용할 수 있습니다.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFearlessEnabled((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors flex-shrink-0 ${
                      fearlessEnabled
                        ? 'bg-rose-500 text-white'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {fearlessEnabled ? '피어리스 ON' : '피어리스 OFF'}
                  </button>
                </div>
              </div>

              {/* 밴픽 종료 시 자동 저장 ON/OFF 토글 및 저장할 드라이브 폴더 지정 */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-200">
                      밴픽 종료 시 결과 사진 자동 저장 (구글 드라이브 / PC)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {autoSaveEnabled
                        ? 'ON: 밴픽이 완료되면 지정한 드라이브 폴더에 자동 저장됩니다.'
                        : 'OFF: 자동 저장하지 않으며 수동 버튼으로만 저장합니다.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoSaveEnabled((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors ${
                      autoSaveEnabled
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {autoSaveEnabled ? '자동 저장 ON' : '자동 저장 OFF'}
                  </button>
                </div>

                {autoSaveEnabled && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-300 mb-1">
                        저장할 구글 드라이브 폴더 링크 또는 ID (선택 — 대회/라운드별 다른 폴더 지정 가능)
                      </label>
                      <input
                        type="text"
                        value={driveFolderId}
                        onChange={(e) => setDriveFolderId(e.target.value)}
                        placeholder="예: https://drive.google.com/drive/folders/1A2B3C... (비워두면 기본 폴더)"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-1">
                        다른 구글 계정 웹앱 URL (선택 — 아예 다른 계정의 드라이브로 보낼 때만 입력)
                      </label>
                      <input
                        type="text"
                        value={driveWebhookUrl}
                        onChange={(e) => setDriveWebhookUrl(e.target.value)}
                        placeholder="예: https://script.google.com/macros/s/.../exec (비워두면 기본 웹앱 사용)"
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all disabled:opacity-50"
              >
                {isSubmitting ? '생성 중...' : '경기 생성 및 고유 링크 발급'}
              </button>
            </form>
          </section>

          {/* 2. CSV 일괄 업로드 */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  2. CSV 대진표 일괄 업로드
                </h2>
                <button
                  type="button"
                  onClick={handleDownloadSampleCsv}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700"
                >
                  샘플 CSV 양식 다운로드
                </button>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-slate-300 font-semibold">
                  CSV 열 순서 (2세트부터는 패배팀이 자동으로 FIRST가 됩니다):
                </p>
                <p className="text-[11px] text-slate-400">
                  <code className="text-amber-300">
                    대회명,라운드,1세트FIRST팀,1세트SECOND팀,진행판수(1~5),피어리스(ON/OFF),고유ID(선택),드라이브폴더ID(선택)
                  </code>
                </p>
              </div>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFileUpload}
                className="block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-slate-800 file:text-amber-300 hover:file:bg-slate-700"
              />

              <textarea
                rows={4}
                value={csvText}
                onChange={(e) => handleCsvTextChange(e.target.value)}
                placeholder={`직접 붙여넣기도 가능합니다:\n2026 LCK 서머,8강 1경기,T1,GEN,3,ON,lck-qf-1\n2026 LCK 서머,8강 2경기,HLE,DK,3,ON,lck-qf-2\n2026 LCK 서머,결승전,T1,HLE,5,ON,lck-final`}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
              />

              {csvPreview.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-emerald-300 font-semibold">
                    ✓ {csvPreview.length}개의 유효한 대진이 인식되었습니다:
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-2 space-y-1 text-[11px]">
                    {csvPreview.map((item, idx) => (
                      <div
                        key={`csv-preview-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 rounded bg-slate-900/80 text-slate-300"
                      >
                        <span>
                          <strong className="text-white">{item.tournament_name}</strong> · {item.round_name}
                        </span>
                        <span>
                          1세트 FIRST: <strong className="text-amber-300">{item.team_first_name}</strong> vs SECOND:{' '}
                          <strong className="text-cyan-300">{item.team_second_name}</strong>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                            {item.total_games}판
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              item.fearless_enabled
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            피어리스 {item.fearless_enabled ? 'ON' : 'OFF'}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={csvPreview.length === 0 || isSubmitting}
              onClick={handleBulkCreateFromCsv}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? '업로드 중...'
                : `CSV 대진표 (${csvPreview.length}경기) 일괄 등록`}
            </button>
          </section>
        </div>

        {/* 3. 생성된 경기 및 고유 링크 목록 */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">
              발급된 경기 세션 목록 ({matches.length})
            </h2>
            <button
              type="button"
              onClick={fetchMatches}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
            >
              새로고침
            </button>
          </div>

          {isLoading ? (
            <div className="text-sm text-slate-400 py-8 text-center">
              경기 목록을 불러오는 중입니다...
            </div>
          ) : matches.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-800 rounded-xl">
              아직 등록된 경기가 없습니다. 위 폼에서 경기를 추가하거나 CSV를 업로드해주세요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                    <th className="py-3 px-3">대회 / 라운드</th>
                    <th className="py-3 px-3">현재 세트 FIRST / SECOND</th>
                    <th className="py-3 px-3">다전제 / 피어리스 / 상태</th>
                    <th className="py-3 px-3">관리자 전용: 세트 승패 결정 (패배팀 → 다음 세트 FIRST)</th>
                    <th className="py-3 px-3">자동 저장</th>
                    <th className="py-3 px-3">팀별 전용 링크 복사</th>
                    <th className="py-3 px-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {matches.map((m) => {
                    const isAutoOn = m.auto_save_enabled !== false;
                    const series = getSeriesState(m);
                    return (
                      <tr key={m.match_id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white">
                            {m.tournament_name || '공식 토너먼트'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {m.round_name || '-'} · <span className="font-mono">{m.match_id}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-xs">
                            <span className="text-slate-400">FIRST:</span>{' '}
                            <strong className="text-amber-300 font-extrabold">
                              {m.team_first_name}
                            </strong>
                          </div>
                          <div className="text-xs mt-0.5">
                            <span className="text-slate-400">SECOND:</span>{' '}
                            <strong className="text-cyan-300 font-extrabold">
                              {m.team_second_name}
                            </strong>
                          </div>
                        </td>
                        <td className="py-3 px-3 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-extrabold">
                              {series.current_game} / {series.total_games}세트
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleMatchFearless(m)}
                              className={`text-[11px] px-2 py-0.5 rounded font-extrabold border transition-colors ${
                                series.fearless_enabled
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                              }`}
                            >
                              🔥 피어리스 {series.fearless_enabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                          <div>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold">
                              {m.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] text-slate-400">
                              {series.current_game}세트 패배팀 클릭 시 즉시 {series.current_game + 1}세트 시작:
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdminConfirmSetLoserAndStartNext(
                                    m,
                                    series.team_a_name
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-amber-500/20 text-[11px] font-bold text-amber-300 border border-amber-500/40 transition-colors"
                              >
                                {series.team_a_name} 패 ({series.team_b_name} 승) →{' '}
                                {series.current_game + 1}세트 FIRST: {series.team_a_name}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleAdminConfirmSetLoserAndStartNext(
                                    m,
                                    series.team_b_name
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-cyan-500/20 text-[11px] font-bold text-cyan-300 border border-cyan-500/40 transition-colors"
                              >
                                {series.team_b_name} 패 ({series.team_a_name} 승) →{' '}
                                {series.current_game + 1}세트 FIRST: {series.team_b_name}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleToggleMatchAutoSave(m)}
                            className={`text-xs px-2.5 py-1 rounded-lg font-extrabold transition-colors ${
                              isAutoOn
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                            }`}
                          >
                            {isAutoOn ? 'ON' : 'OFF'}
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyRoleLink(m.match_id, 'FIRST')}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-xs font-extrabold text-amber-300 border border-amber-500/40"
                            >
                              {copiedId === `${m.match_id}:FIRST`
                                ? '✓ 복사됨'
                                : `${series.team_a_name} 링크`}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyRoleLink(m.match_id, 'SECOND')}
                              className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-xs font-extrabold text-cyan-300 border border-cyan-500/40"
                            >
                              {copiedId === `${m.match_id}:SECOND`
                                ? '✓ 복사됨'
                                : `${series.team_b_name} 링크`}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyRoleLink(m.match_id, 'OBSERVER')}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 border border-slate-700"
                            >
                              {copiedId === `${m.match_id}:OBSERVER`
                                ? '✓ 관전 복사됨'
                                : '옵저버 링크'}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right space-x-1.5 whitespace-nowrap">
                          <Link
                            href={buildMatchRolePath(m.match_id, 'OBSERVER')}
                            className="inline-block px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold"
                          >
                            관리자 관전 입장
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDeleteMatch(m.match_id)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-xs font-bold text-rose-300 border border-rose-800/50"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
