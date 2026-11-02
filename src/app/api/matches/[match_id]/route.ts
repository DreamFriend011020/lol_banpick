import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMatchFromStore,
  getMatchByIdFromStore,
  upsertMatchesToStore,
} from '../../../../lib/matchStoreServer';
import { supabase } from '../../../../lib/supabaseClient';
import { MatchState } from '../../../../types/match';

export async function GET(
  _req: NextRequest,
  { params }: { params: { match_id: string } }
) {
  const matchId = params.match_id;

  if (supabase) {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('match_id', matchId)
      .single();

    if (!error && data) {
      return NextResponse.json({ ok: true, match: data });
    }
  }

  const match = await getMatchByIdFromStore(matchId);
  if (!match) {
    return NextResponse.json(
      { ok: false, error: '해당 경기를 찾을 수 없습니다.' },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, match });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { match_id: string } }
) {
  try {
    const matchId = params.match_id;
    const body = (await req.json()) as Partial<MatchState> & {
      skipSupabase?: boolean;
    };
    const existing = await getMatchByIdFromStore(matchId);

    const updated: MatchState = {
      match_id: matchId,
      tournament_name:
        body.tournament_name ?? existing?.tournament_name ?? '공식 토너먼트',
      round_name: body.round_name ?? existing?.round_name ?? 'Match',
      team_first_name:
        body.team_first_name ?? existing?.team_first_name ?? 'T1',
      team_second_name:
        body.team_second_name ?? existing?.team_second_name ?? 'GEN',
      status: body.status ?? existing?.status ?? 'ROFS_FIRST_PICK',
      selected_side:
        body.selected_side !== undefined
          ? body.selected_side
          : existing?.selected_side ?? null,
      pick_turn:
        body.pick_turn !== undefined
          ? body.pick_turn
          : existing?.pick_turn ?? null,
      rofs_submissions:
        body.rofs_submissions !== undefined
          ? body.rofs_submissions
          : existing?.rofs_submissions ?? {
              first_choice: null,
              second_choice: null,
            },
      banpick_state:
        body.banpick_state !== undefined
          ? body.banpick_state
          : existing?.banpick_state ?? null,
      auto_save_enabled:
        body.auto_save_enabled !== undefined
          ? body.auto_save_enabled
          : existing?.auto_save_enabled ?? true,
      drive_folder_id:
        body.drive_folder_id !== undefined
          ? body.drive_folder_id
          : existing?.drive_folder_id,
      drive_webhook_url:
        body.drive_webhook_url !== undefined
          ? body.drive_webhook_url
          : existing?.drive_webhook_url,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };

    await upsertMatchesToStore([updated]).catch(() => {});

    if (supabase && !body.skipSupabase) {
      await supabase
        .from('matches')
        .upsert(updated, { onConflict: 'match_id' });
    }

    return NextResponse.json({ ok: true, match: updated });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : '경기 상태 업데이트 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { match_id: string } }
) {
  if (supabase) {
    await supabase.from('matches').delete().eq('match_id', params.match_id);
  }
  const deleted = await deleteMatchFromStore(params.match_id).catch(
    () => false
  );
  return NextResponse.json({ ok: deleted || Boolean(supabase) });
}
