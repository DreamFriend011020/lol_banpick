import { NextRequest, NextResponse } from 'next/server';
import {
  getAllMatchesFromStore,
  upsertMatchesToStore,
} from '../../../lib/matchStoreServer';
import { supabase } from '../../../lib/supabaseClient';
import { MatchState } from '../../../types/match';

interface CreateMatchInput {
  match_id?: string;
  tournament_name?: string;
  round_name?: string;
  team_first_name: string;
  team_second_name: string;
  auto_save_enabled?: boolean;
  drive_folder_id?: string;
  drive_webhook_url?: string;
}

function generateMatchId(index: number = 0): string {
  const rand = Math.random().toString(36).substring(2, 7);
  const timePart = Date.now().toString(36).slice(-4);
  return `match-${timePart}${rand}${index > 0 ? `-${index}` : ''}`;
}

export async function GET() {
  // Supabase가 연결되어 있으면 Supabase에서 먼저 조회
  if (supabase) {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      return NextResponse.json({ ok: true, matches: data });
    }
  }

  const matches = await getAllMatchesFromStore();
  return NextResponse.json({ ok: true, matches });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawList: CreateMatchInput[] = Array.isArray(body?.matches)
      ? body.matches
      : [body];

    const created: MatchState[] = [];
    const nowIso = new Date().toISOString();

    rawList.forEach((item, idx) => {
      const first = item.team_first_name?.trim();
      const second = item.team_second_name?.trim();
      if (!first || !second) return;

      const matchId = item.match_id?.trim() || generateMatchId(idx);

      created.push({
        match_id: matchId,
        tournament_name: item.tournament_name?.trim() || '공식 토너먼트',
        round_name: item.round_name?.trim() || `Round ${idx + 1}`,
        team_first_name: first,
        team_second_name: second,
        status: 'ROFS_FIRST_PICK',
        selected_side: null,
        pick_turn: null,
        rofs_submissions: {
          first_choice: null,
          second_choice: null,
        },
        banpick_state: null,
        auto_save_enabled:
          item.auto_save_enabled !== undefined ? item.auto_save_enabled : true,
        drive_folder_id: item.drive_folder_id?.trim() || undefined,
        drive_webhook_url: item.drive_webhook_url?.trim() || undefined,
        created_at: nowIso,
      });
    });

    if (created.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'FIRST 팀 이름과 SECOND 팀 이름을 모두 입력해주세요.',
        },
        { status: 400 }
      );
    }

    // 1) 로컬 파일 스토어 저장 (개발 환경 백업)
    await upsertMatchesToStore(created).catch(() => {});

    // 2) Supabase 연결 시 Supabase matches 테이블에 저장
    if (supabase) {
      const { error } = await supabase
        .from('matches')
        .upsert(created, { onConflict: 'match_id' });

      if (error) {
        // 만약 tournament_name, round_name 등 선택 컬럼이 없는 최소 스키마 테이블인 경우 핵심 컬럼만 재시도
        const minimalRows = created.map((m) => ({
          match_id: m.match_id,
          team_first_name: m.team_first_name,
          team_second_name: m.team_second_name,
          status: m.status,
          selected_side: m.selected_side,
          pick_turn: m.pick_turn,
        }));
        await supabase
          .from('matches')
          .upsert(minimalRows, { onConflict: 'match_id' });
      }
    }

    return NextResponse.json({
      ok: true,
      created,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : '경기 생성 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
