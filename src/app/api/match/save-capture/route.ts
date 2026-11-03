import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isMatchAutoSaveEnabled } from '../../../../lib/banpickMachine';
import { MatchState } from '../../../../types/match';

// 동일 경기(matchId)가 여러 클라이언트에서 동시에 자동 업로드되는 것을 방지하는 캐시
const uploadedMatchesCache = new Set<string>();

/**
 * 구글 드라이브 폴더 전체 URL(https://drive.google.com/drive/folders/XXXX?usp=sharing) 또는
 * 순수 폴더 ID 문자열에서 폴더 ID만 깔끔하게 추출합니다.
 */
function extractDriveFolderId(rawInput?: string | null): string {
  if (!rawInput) return '';
  const trimmed = rawInput.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) {
    return idParamMatch[1];
  }
  return trimmed.split('?')[0];
}

/**
 * Google Apps Script 웹앱(Webhook)을 통해 지정된 구글 드라이브 폴더에 PNG 저장
 */
async function uploadViaAppsScriptWebhook(params: {
  webhookUrl: string;
  folderId?: string;
  fileName: string;
  base64Data: string;
  matchId?: string;
}): Promise<{ ok: boolean; driveUrl?: string; error?: string }> {
  try {
    const res = await fetch(params.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: params.folderId || '',
        fileName: params.fileName,
        mimeType: 'image/png',
        base64Data: params.base64Data,
        matchId: params.matchId || '',
      }),
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return { ok: true, driveUrl: data.fileUrl || data.url };
    }
    return {
      ok: false,
      error: data?.error || `Apps Script 응답 오류 (${res.status})`,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : '구글 드라이브 웹훅 전송 중 오류가 발생했습니다.',
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      matchId,
      fileName,
      imageDataUrl,
      matchState,
      customFolderId,
      customWebhookUrl,
      isManualRetry = false,
    } = body as {
      matchId?: string;
      fileName?: string;
      imageDataUrl?: string;
      matchState?: MatchState;
      customFolderId?: string;
      customWebhookUrl?: string;
      isManualRetry?: boolean;
    };

    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/png;base64,')) {
      return NextResponse.json(
        { ok: false, error: '유효하지 않은 이미지 데이터입니다.' },
        { status: 400 }
      );
    }

    // 수동 저장 버튼(isManualRetry)이 아닌 자동 저장 호출일 때, 해당 방의 자동 저장이 OFF이면 즉시 차단
    if (!isManualRetry && matchState && !isMatchAutoSaveEnabled(matchState)) {
      return NextResponse.json({
        ok: false,
        skippedAutoSaveOff: true,
        error: '이 경기는 자동 저장이 OFF로 설정되어 있습니다.',
      });
    }

    const safeFileName = (
      fileName || `banpick_${matchId || 'match'}_${Date.now()}.png`
    ).replace(/[^a-zA-Z0-9가-힣._-]/g, '_');

    const currentSet =
      matchState?.rofs_submissions?.series_state?.current_game ??
      matchState?.series_state?.current_game ??
      1;
    const dedupeKey = matchId ? `${matchId}::set${currentSet}` : '';

    // 이미 자동 업로드된 세트이고 수동 재시도가 아니라면 중복 업로드 건너뛰기
    if (dedupeKey && !isManualRetry && uploadedMatchesCache.has(dedupeKey)) {
      return NextResponse.json({
        ok: true,
        skippedDuplicate: true,
        fileName: safeFileName,
      });
    }

    if (dedupeKey) {
      uploadedMatchesCache.add(dedupeKey);
    }

    const base64Data = imageDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    let savedLocalPath: string | undefined;
    let driveUrl: string | undefined;
    let driveError: string | undefined;

    // -------------------------------------------------------------------------
    // A. 경기별 지정 드라이브(또는 기본 환경 변수 드라이브)로 자동 업로드
    //    우선순위: 요청 직접 지정값 -> 해당 경기(matchState) 지정값 -> 서버 기본 환경 변수
    // -------------------------------------------------------------------------
    const targetWebhookUrl = (
      customWebhookUrl ||
      matchState?.drive_webhook_url ||
      process.env.GOOGLE_DRIVE_WEBHOOK_URL ||
      ''
    ).trim();

    const targetFolderId = extractDriveFolderId(
      customFolderId ||
        matchState?.drive_folder_id ||
        process.env.GOOGLE_DRIVE_FOLDER_ID ||
        ''
    );

    if (targetWebhookUrl) {
      const driveResult = await uploadViaAppsScriptWebhook({
        webhookUrl: targetWebhookUrl,
        folderId: targetFolderId,
        fileName: safeFileName,
        base64Data,
        matchId,
      });
      if (driveResult.ok) {
        driveUrl = driveResult.driveUrl;
      } else {
        driveError = driveResult.error;
      }
    } else {
      driveError =
        '.env.local에 GOOGLE_DRIVE_WEBHOOK_URL(Apps Script 웹앱 주소)이 설정되지 않았습니다.';
    }

    // -------------------------------------------------------------------------
    // B. 로컬 서버 실행 환경인 경우 saved_banpicks 폴더에도 백업 저장
    // -------------------------------------------------------------------------
    try {
      const saveDir = path.join(process.cwd(), 'saved_banpicks');
      await fs.mkdir(saveDir, { recursive: true });
      const imageFilePath = path.join(saveDir, safeFileName);
      await fs.writeFile(imageFilePath, buffer);
      savedLocalPath = imageFilePath;

      if (matchState) {
        const jsonFileName = safeFileName.replace(/\.png$/i, '.json');
        const jsonFilePath = path.join(saveDir, jsonFileName);
        await fs.writeFile(
          jsonFilePath,
          JSON.stringify(matchState, null, 2),
          'utf-8'
        );
      }
    } catch {
      // Vercel 서버리스 환경에서는 로컬 파일 저장 생략
    }

    return NextResponse.json({
      ok: true,
      fileName: safeFileName,
      savedPath: savedLocalPath,
      driveUploaded: Boolean(targetWebhookUrl && !driveError),
      driveUrl,
      driveError,
      usedFolderId: targetFolderId || undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : '밴픽 화면 파일 저장 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
