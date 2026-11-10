import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMatchesFromStore,
  getAllMatchesFromStore,
  upsertMatchesToStore,
} from '../../../lib/matchStoreServer';
import {
  isMatchAutoSaveEnabled,
  isMatchTimerUnlimited,
} from '../../../lib/banpickMachine';
import { supabase } from '../../../lib/supabaseClient';
import { MatchState, SeriesState } from '../../../types/match';

interface CreateMatchInput {
  match_id?: string;
  tournament_name?: string;
  round_name?: string;
  team_first_name: string;
  team_second_name: string;
  auto_save_enabled?: boolean;
  timer_unlimited?: boolean;
  drive_folder_id?: string;
  drive_webhook_url?: string;
  total_games?: number;
  fearless_enabled?: boolean;
  game_first_teams?: string[];
  is_scrim?: boolean;
  admin_key?: string;
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
      const normalized = (data as MatchState[]).map((m) => ({
        ...m,
        auto_save_enabled: isMatchAutoSaveEnabled(m),
        timer_unlimited: isMatchTimerUnlimited(m),
        drive_folder_id:
          m.drive_folder_id ?? m.rofs_submissions?.series_state?.drive_folder_id,
        drive_webhook_url:
          m.drive_webhook_url ??
          m.rofs_submissions?.series_state?.drive_webhook_url,
      }));
      return NextResponse.json({ ok: true, matches: normalized });
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
      const rawFirst = item.team_first_name?.trim();
      const rawSecond = item.team_second_name?.trim();
      if (!rawFirst || !rawSecond) return;

      const first = rawFirst === rawSecond ? `${rawFirst} (1팀)` : rawFirst;
      const second = rawFirst === rawSecond ? `${rawSecond} (2팀)` : rawSecond;

      const matchId = item.match_id?.trim() || generateMatchId(idx);
      const totalGames = Math.max(1, Number(item.total_games) || 1);
      const fearlessEnabled = Boolean(item.fearless_enabled);
      const schedule =
        Array.isArray(item.game_first_teams) && item.game_first_teams.length > 0
          ? item.game_first_teams
          : Array.from({ length: totalGames }, (_, i) =>
              i % 2 === 0 ? first : second
            );

      const game1First = schedule[0] === second ? second : first;
      const game1Second = game1First === first ? second : first;
      const autoSaveOn = Boolean(item.auto_save_enabled);
      const timerUnlimited = Boolean(item.timer_unlimited);
      const folderId = item.drive_folder_id?.trim() || undefined;
      const webhookUrl = item.drive_webhook_url?.trim() || undefined;
      const isScrim =
        typeof item.is_scrim === 'boolean'
          ? item.is_scrim
          : matchId.startsWith('scrim-');
      const adminKey = item.admin_key?.trim() || body?.admin_key?.trim() || undefined;

      const initialSeries: SeriesState = {
        total_games: totalGames,
        current_game: 1,
        fearless_enabled: fearlessEnabled,
        fearless_used_champions: [],
        game_first_teams: schedule,
        team_a_name: first,
        team_b_name: second,
        auto_save_enabled: autoSaveOn,
        timer_unlimited: timerUnlimited,
        drive_folder_id: folderId,
        drive_webhook_url: webhookUrl,
        is_scrim: isScrim,
        admin_key: adminKey,
      };

      created.push({
        match_id: matchId,
        tournament_name: item.tournament_name?.trim() || '공식 토너먼트',
        round_name: item.round_name?.trim() || `Round ${idx + 1}`,
        team_first_name: game1First,
        team_second_name: game1Second,
        status: 'ROFS_FIRST_PICK',
        selected_side: null,
        pick_turn: null,
        rofs_submissions: {
          first_choice: null,
          second_choice: null,
          series_state: initialSeries,
        },
        banpick_state: null,
        auto_save_enabled: autoSaveOn,
        timer_unlimited: timerUnlimited,
        drive_folder_id: folderId,
        drive_webhook_url: webhookUrl,
        series_state: initialSeries,
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
          rofs_submissions: m.rofs_submissions,
          banpick_state: m.banpick_state,
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

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchIds: string[] = Array.isArray(body?.match_ids)
      ? body.match_ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];

    if (matchIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: '삭제할 경기 ID 목록이 비어 있습니다.' },
        { status: 400 }
      );
    }

    if (supabase) {
      await supabase.from('matches').delete().in('match_id', matchIds);
    }

    const deletedCount = await deleteMatchesFromStore(matchIds).catch(() => 0);

    return NextResponse.json({
      ok: true,
      deletedCount: Math.max(deletedCount, matchIds.length),
      deletedIds: matchIds,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : '선택 경기 삭제 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
