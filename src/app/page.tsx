'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { buildMatchRolePath, InviteRole } from '../lib/roleToken';

export default function HomePage() {
  const router = useRouter();

  // 기존 방 입장 상태
  const [matchId, setMatchId] = useState('');

  // 자유 스크림 방 즉시 생성 상태
  const [scrimFirstTeam, setScrimFirstTeam] = useState('');
  const [scrimSecondTeam, setScrimSecondTeam] = useState('');
  const [scrimAutoSave, setScrimAutoSave] = useState<boolean>(false);
  const [scrimDriveFolder, setScrimDriveFolder] = useState<string>('');
  const [isCreatingScrim, setIsCreatingScrim] = useState(false);
  const [scrimError, setScrimError] = useState<string | null>(null);
  const [createdScrimId, setCreatedScrimId] = useState<string | null>(null);
  const [copiedRole, setCopiedRole] = useState<InviteRole | null>(null);

  const handleEnterMatch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = matchId.trim();
    if (!trimmed) return;

    // 전체 URL이나 /match/xxx?key=... 형태를 붙여넣은 경우 그대로 경로 추출
    const matchPath = trimmed.match(/\/match\/[^\s]+/);
    if (matchPath) {
      router.push(matchPath[0]);
      return;
    }

    router.push(`/match/${encodeURIComponent(trimmed)}`);
  };

  // 자유 스크림 방 생성 핸들러 (관리자 암호 없이 누구나 생성 가능)
  const handleCreateScrimRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setScrimError(null);

    const first = scrimFirstTeam.trim();
    const second = scrimSecondTeam.trim();

    if (!first || !second) {
      setScrimError('FIRST 팀 이름과 SECOND 팀 이름을 모두 입력해주세요.');
      return;
    }

    setIsCreatingScrim(true);
    try {
      const rand = Math.random().toString(36).substring(2, 7);
      const timePart = Date.now().toString(36).slice(-4);
      const scrimMatchId = `scrim-${timePart}${rand}`;

      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: scrimMatchId,
          tournament_name: '자유 스크림 (연습)',
          round_name: '연습 경기',
          team_first_name: first,
          team_second_name: second,
          auto_save_enabled: scrimAutoSave,
          drive_folder_id: scrimDriveFolder.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '스크림 방 생성에 실패했습니다.');
      }

      const newId = data.created?.[0]?.match_id ?? scrimMatchId;
      setCreatedScrimId(newId);
    } catch (err) {
      setScrimError(
        err instanceof Error
          ? err.message
          : '스크림 방 생성 중 오류가 발생했습니다.'
      );
    } finally {
      setIsCreatingScrim(false);
    }
  };

  const handleCopyScrimRoleLink = async (role: InviteRole) => {
    if (!createdScrimId || typeof window === 'undefined') return;
    const path = buildMatchRolePath(createdScrimId, role);
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRole(role);
      setTimeout(() => setCopiedRole(null), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full space-y-8">
        {/* 상단 타이틀 */}
        <div className="space-y-2 text-center">
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            LoL Esports Draft & RoFS
          </span>
          <h1 className="text-3xl font-black text-white pt-2">
            실시간 RoFS & 5:5 토너먼트 밴픽
          </h1>
          <p className="text-sm text-slate-400">
            자유 스크림 연습 방을 즉시 만들어 연습하거나, 대회 운영진에게 발급받은 Match ID로 입장하세요.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          {/* =================================================================
              1. 자유 스크림 방 즉시 생성 카드 (관리자 암호 불필요)
          ================================================================= */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Scrim Mode (연습용)
                </span>
                <span className="text-xs text-slate-400">암호 없이 즉시 생성</span>
              </div>

              <div>
                <h2 className="text-xl font-extrabold text-white">
                  자유 스크림 방 즉시 생성
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  양 팀 이름을 입력하면 연습용 고유 링크가 즉시 발급됩니다. 링크를 상대 팀에게 공유해 바로 밴픽을 연습하세요.
                </p>
              </div>

              <form onSubmit={handleCreateScrimRoom} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-amber-400 mb-1">
                    FIRST 팀 이름 (선결정권 팀)
                  </label>
                  <input
                    type="text"
                    required
                    value={scrimFirstTeam}
                    onChange={(e) => setScrimFirstTeam(e.target.value)}
                    placeholder="예: 블루팀 또는 T1"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-cyan-400 mb-1">
                    SECOND 팀 이름 (후결정권 팀)
                  </label>
                  <input
                    type="text"
                    required
                    value={scrimSecondTeam}
                    onChange={(e) => setScrimSecondTeam(e.target.value)}
                    placeholder="예: 레드팀 또는 GEN"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {/* 밴픽 종료 시 자동 저장 ON/OFF 스위치 및 저장할 드라이브 폴더 지정 */}
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-200">
                        밴픽 종료 시 결과 사진 자동 저장
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {scrimAutoSave
                          ? 'ON: 종료 시 지정한 구글 드라이브/PC에 자동 저장됩니다.'
                          : 'OFF: 연습용이므로 자동 저장하지 않습니다. (수동 저장은 가능)'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScrimAutoSave((prev) => !prev)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors ${
                        scrimAutoSave
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {scrimAutoSave ? '자동 저장 ON' : '자동 저장 OFF'}
                    </button>
                  </div>

                  {scrimAutoSave && (
                    <div className="pt-2 border-t border-slate-800/80">
                      <label className="block text-[11px] font-bold text-emerald-300 mb-1">
                        저장할 구글 드라이브 폴더 링크 또는 ID (선택 — 비워두면 기본 드라이브)
                      </label>
                      <input
                        type="text"
                        value={scrimDriveFolder}
                        onChange={(e) => setScrimDriveFolder(e.target.value)}
                        placeholder="예: https://drive.google.com/drive/folders/1A2B3C..."
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400"
                      />
                    </div>
                  )}
                </div>

                {scrimError && (
                  <div className="rounded-xl bg-rose-950/60 border border-rose-500/50 p-2.5 text-xs text-rose-200 text-center">
                    {scrimError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isCreatingScrim}
                  className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition-all shadow-lg shadow-emerald-500/10 disabled:opacity-50"
                >
                  {isCreatingScrim
                    ? '스크림 방 생성 중...'
                    : '스크림 연습 방 만들기'}
                </button>
              </form>
            </div>

            {/* 생성 완료 시 역할별 3개 전용 링크 복사 및 즉시 입장 버튼 표시 */}
            {createdScrimId && (
              <div className="rounded-xl bg-slate-950 border border-emerald-500/40 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold text-emerald-400">
                    ✓ 팀별 전용 보안 링크 3종 발급 완료!
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    ID: {createdScrimId}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  각 링크로 접속한 사람만 해당 팀의 조작 권한을 가집니다. 상대 팀에게 해당 팀의 전용 링크를 전달하세요.
                </p>

                <div className="space-y-2">
                  {/* 1. FIRST 팀장 전용 링크 */}
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <span className="text-xs font-extrabold text-amber-300 truncate">
                      1. FIRST 팀 ({scrimFirstTeam || 'FIRST'}) 전용
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyScrimRoleLink('FIRST')}
                        className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-[11px] font-bold text-amber-300"
                      >
                        {copiedRole === 'FIRST' ? '✓ 복사됨' : '링크 복사'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            buildMatchRolePath(createdScrimId, 'FIRST')
                          )
                        }
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-extrabold"
                      >
                        입장 →
                      </button>
                    </div>
                  </div>

                  {/* 2. SECOND 팀장 전용 링크 */}
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                    <span className="text-xs font-extrabold text-cyan-300 truncate">
                      2. SECOND 팀 ({scrimSecondTeam || 'SECOND'}) 전용
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyScrimRoleLink('SECOND')}
                        className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-cyan-500/40 text-[11px] font-bold text-cyan-300"
                      >
                        {copiedRole === 'SECOND' ? '✓ 복사됨' : '링크 복사'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            buildMatchRolePath(createdScrimId, 'SECOND')
                          )
                        }
                        className="px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-extrabold"
                      >
                        입장 →
                      </button>
                    </div>
                  </div>

                  {/* 3. 옵저버/관전 전용 링크 */}
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-xs font-bold text-slate-300 truncate">
                      3. 옵저버 / 관전 전용 (읽기 전용)
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyScrimRoleLink('OBSERVER')}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-bold text-slate-300"
                      >
                        {copiedRole === 'OBSERVER' ? '✓ 복사됨' : '링크 복사'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            buildMatchRolePath(createdScrimId, 'OBSERVER')
                          )
                        }
                        className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-bold"
                      >
                        관전 입장 →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* =================================================================
              2. 기존 Match ID로 입장 + 관리자 페이지 이동 카드
          ================================================================= */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Join Room
                </span>
                <span className="text-xs text-slate-400">코드로 입장</span>
              </div>

              <div>
                <h2 className="text-xl font-extrabold text-white">
                  Match ID로 경기 방 입장
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  운영진 또는 스크림 상대방에게 전달받은 Match ID를 입력해 입장합니다.
                </p>
              </div>

              <form onSubmit={handleEnterMatch} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Match ID
                  </label>
                  <input
                    type="text"
                    required
                    value={matchId}
                    onChange={(e) => setMatchId(e.target.value)}
                    placeholder="예: scrim-xxxx 또는 match-001"
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all shadow-lg shadow-amber-500/10"
                >
                  경기 방 입장하기
                </button>
              </form>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-2">
              <div className="text-xs text-slate-400 text-center">
                본 대회 대진표 등록 및 CSV 일괄 업로드는 운영진 전용입니다.
              </div>
              <Link
                href="/admin"
                className="block w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-center text-xs font-extrabold text-cyan-300 transition-colors"
              >
                🔒 관리자(운영진) 페이지 (/admin — 암호 필요) →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
