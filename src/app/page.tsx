'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function HomePage() {
  const router = useRouter();

  // 기존 방 입장 상태
  const [matchId, setMatchId] = useState('');

  // 자유 스크림 방 즉시 생성 상태
  const [scrimFirstTeam, setScrimFirstTeam] = useState('');
  const [scrimSecondTeam, setScrimSecondTeam] = useState('');
  const [isCreatingScrim, setIsCreatingScrim] = useState(false);
  const [scrimError, setScrimError] = useState<string | null>(null);
  const [createdScrimId, setCreatedScrimId] = useState<string | null>(null);
  const [copiedScrimLink, setCopiedScrimLink] = useState(false);

  const handleEnterMatch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = matchId.trim();
    if (!trimmed) return;
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

  const handleCopyScrimLink = async () => {
    if (!createdScrimId || typeof window === 'undefined') return;
    const url = `${window.location.origin}/match/${encodeURIComponent(
      createdScrimId
    )}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedScrimLink(true);
      setTimeout(() => setCopiedScrimLink(false), 2000);
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

            {/* 생성 완료 시 즉시 링크 복사 및 입장 버튼 표시 */}
            {createdScrimId && (
              <div className="rounded-xl bg-slate-950 border border-emerald-500/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400">
                    ✓ 스크림 방 생성 완료!
                  </span>
                  <span className="font-mono text-xs text-slate-300">
                    /match/{createdScrimId}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopyScrimLink}
                    className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-amber-300"
                  >
                    {copiedScrimLink ? '✓ 링크 복사됨!' : '상대 팀 공유 링크 복사'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/match/${encodeURIComponent(createdScrimId)}`
                      )
                    }
                    className="py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold"
                  >
                    방으로 바로 입장 →
                  </button>
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
