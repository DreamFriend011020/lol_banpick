import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMatchFromStore,
  getMatchByIdFromStore,
  upsertMatchesToStore,
} from '../../../../lib/matchStoreServer';
import {
  getSeriesState,
  isMatchAutoSaveEnabled,
} from '../../../../lib/banpickMachine';
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
      const m = data as MatchState;
      return NextResponse.json({
        ok: true,
        match: {
          ...m,
          auto_save_enabled: isMatchAutoSaveEnabled(m),
          drive_folder_id:
            m.drive_folder_id ??
            m.rofs_submissions?.series_state?.drive_folder_id,
          drive_webhook_url:
            m.drive_webhook_url ??
            m.rofs_submissions?.series_state?.drive_webhook_url,
        },
      });
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

    const resolvedAutoSave =
      typeof body.auto_save_enabled === 'boolean'
        ? body.auto_save_enabled
        : typeof body.rofs_submissions?.series_state?.auto_save_enabled ===
            'boolean'
          ? body.rofs_submissions.series_state.auto_save_enabled
          : existing
            ? isMatchAutoSaveEnabled(existing)
            : false;

    const resolvedFolderId =
      body.drive_folder_id !== undefined
        ? body.drive_folder_id
        : body.rofs_submissions?.series_state?.drive_folder_id ??
          existing?.drive_folder_id;

    const resolvedWebhookUrl =
      body.drive_webhook_url !== undefined
        ? body.drive_webhook_url
        : body.rofs_submissions?.series_state?.drive_webhook_url ??
          existing?.drive_webhook_url;

    const baseRofs =
      body.rofs_submissions !== undefined
        ? body.rofs_submissions
        : existing?.rofs_submissions ?? {
            first_choice: null,
            second_choice: null,
          };

    const baseSeries = getSeriesState({
      ...(existing ?? ({} as MatchState)),
      ...(body as MatchState),
      rofs_submissions: baseRofs,
    });

    const syncedSeries = {
      ...baseSeries,
      auto_save_enabled: resolvedAutoSave,
      drive_folder_id: resolvedFolderId,
      drive_webhook_url: resolvedWebhookUrl,
    };

    const existingGame =
      existing?.rofs_submissions?.series_state?.current_game ??
      existing?.series_state?.current_game ??
      1;
    const isSameGame = existingGame === syncedSeries.current_game;

    const mergedFirstChoice =
      baseRofs?.first_choice ??
      (isSameGame ? existing?.rofs_submissions?.first_choice : null) ??
      null;
    const mergedSecondChoice =
      baseRofs?.second_choice ??
      (isSameGame ? existing?.rofs_submissions?.second_choice : null) ??
      null;

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
      rofs_submissions: {
        first_choice: mergedFirstChoice,
        second_choice: mergedSecondChoice,
        series_state: syncedSeries,
      },
      banpick_state:
        body.banpick_state !== undefined
          ? body.banpick_state
          : existing?.banpick_state ?? null,
      auto_save_enabled: resolvedAutoSave,
      drive_folder_id: resolvedFolderId,
      drive_webhook_url: resolvedWebhookUrl,
      series_state: syncedSeries,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };

    await upsertMatchesToStore([updated]).catch(() => {});

    if (supabase && !body.skipSupabase) {
      const { error } = await supabase
        .from('matches')
        .upsert(updated, { onConflict: 'match_id' });

      if (error) {
        await supabase
          .from('matches')
          .update({
            team_first_name: updated.team_first_name,
            team_second_name: updated.team_second_name,
            status: updated.status,
            selected_side: updated.selected_side,
            pick_turn: updated.pick_turn,
            rofs_submissions: updated.rofs_submissions ?? null,
            banpick_state: updated.banpick_state ?? null,
          })
          .eq('match_id', matchId);
      }
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
