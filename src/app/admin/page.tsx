'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { MatchState } from '../../types/match';

interface CsvRowPreview {
  tournament_name: string;
  round_name: string;
  team_first_name: string;
  team_second_name: string;
  match_id?: string;
}

export default function AdminPage() {
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
    fetchMatches();
  }, []);

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
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament_name: tournamentName.trim() || '공식 토너먼트',
          round_name: roundName.trim() || '1라운드',
          team_first_name: firstTeamName.trim(),
          team_second_name: secondTeamName.trim(),
          match_id: customMatchId.trim() || undefined,
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

  // CSV 파싱 헬퍼 (형식: 대회명,라운드,FIRST팀,SECOND팀[,match_id])
  const parseCsvContent = (raw: string): CsvRowPreview[] => {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const rows: CsvRowPreview[] = [];
    lines.forEach((line, idx) => {
      const cols = line.split(',').map((c) => c.trim());
      if (cols.length < 2) return;

      // 첫 줄이 헤더인 경우 건너뛰기
      if (
        idx === 0 &&
        (cols[0].includes('대회') ||
          cols[0].toLowerCase().includes('tournament') ||
          cols[2]?.toLowerCase().includes('first'))
      ) {
        return;
      }

      if (cols.length >= 4) {
        rows.push({
          tournament_name: cols[0] || '공식 토너먼트',
          round_name: cols[1] || `Round ${idx + 1}`,
          team_first_name: cols[2],
          team_second_name: cols[3],
          match_id: cols[4] || undefined,
        });
      } else if (cols.length === 2) {
        // 팀1,팀2만 적은 경우도 허용
        rows.push({
          tournament_name: tournamentName || '공식 토너먼트',
          round_name: `Match ${idx + 1}`,
          team_first_name: cols[0],
          team_second_name: cols[1],
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
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches: csvPreview }),
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
      '대회명,라운드,FIRST팀,SECOND팀,고유ID(선택)',
      '2026 LCK 서머,8강 1경기,T1,GEN,lck-qf-1',
      '2026 LCK 서머,8강 2경기,HLE,DK,lck-qf-2',
      '2026 LCK 서머,8강 3경기,KT,KDF,lck-qf-3',
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

  // 경기 링크 클립보드 복사
  const handleCopyLink = async (matchId: string) => {
    const fullUrl = `${window.location.origin}/match/${encodeURIComponent(
      matchId
    )}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(matchId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleDeleteMatch = async (matchId: string) => {
    await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
      method: 'DELETE',
    });
    await fetchMatches();
  };

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

          <Link
            href="/"
            className="self-start sm:self-auto px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-slate-300 hover:bg-slate-800"
          >
            ← 메인 홈으로
          </Link>
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
                    팀 1 이름 (FIRST 팀) *
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
                    팀 2 이름 (SECOND 팀) *
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

              <p className="text-xs text-slate-400">
                CSV 형식: <code className="text-slate-200">대회명,라운드,FIRST팀,SECOND팀,고유ID(선택)</code>
              </p>

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
                placeholder={`직접 붙여넣기도 가능합니다:\n2026 LCK 서머,8강 1경기,T1,GEN\n2026 LCK 서머,8강 2경기,HLE,DK`}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 p-3 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
              />

              {csvPreview.length > 0 && (
                <div className="text-xs text-emerald-300 font-semibold">
                  ✓ {csvPreview.length}개의 유효한 대진이 인식되었습니다.
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
                    <th className="py-3 px-3">FIRST 팀</th>
                    <th className="py-3 px-3">SECOND 팀</th>
                    <th className="py-3 px-3">진행 상태</th>
                    <th className="py-3 px-3">고유 링크 (/match/[match_id])</th>
                    <th className="py-3 px-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {matches.map((m) => (
                    <tr key={m.match_id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-3">
                        <div className="font-bold text-white">
                          {m.tournament_name || '공식 토너먼트'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {m.round_name || '-'}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-extrabold text-amber-300">
                        {m.team_first_name}
                      </td>
                      <td className="py-3 px-3 font-extrabold text-cyan-300">
                        {m.team_second_name}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold">
                          {m.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs text-slate-300">
                        /match/{m.match_id}
                      </td>
                      <td className="py-3 px-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleCopyLink(m.match_id)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-amber-300 border border-slate-700"
                        >
                          {copiedId === m.match_id ? '✓ 복사됨' : '링크 복사'}
                        </button>
                        <Link
                          href={`/match/${encodeURIComponent(m.match_id)}`}
                          className="inline-block px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold"
                        >
                          입장
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

