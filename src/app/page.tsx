'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function HomePage() {
  const router = useRouter();
  const [matchId, setMatchId] = useState('match-001');

  const handleEnterMatch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = matchId.trim() || 'match-001';
    router.push(`/match/${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="space-y-2 text-center">
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            LoL Esports Draft
          </span>
          <h1 className="text-2xl font-black text-white pt-2">
            실시간 RoFS & 토너먼트 밴픽
          </h1>
          <p className="text-sm text-slate-400">
            발급받은 Match ID로 입장하거나, 관리자 페이지에서 대진표를 등록하고 링크를 발급하세요.
          </p>
        </div>

        <form onSubmit={handleEnterMatch} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Match ID로 바로 입장
            </label>
            <input
              type="text"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              placeholder="예: match-001"
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition-all shadow-lg shadow-amber-500/10"
          >
            경기 방 입장하기 (/match/{matchId || 'match-001'})
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800">
          <Link
            href="/admin"
            className="block w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-center text-xs font-extrabold text-cyan-300 transition-colors"
          >
            관리자(운영진) 페이지 — 경기 생성 & CSV 업로드 (/admin) →
          </Link>
        </div>
      </div>
    </div>
  );
}
