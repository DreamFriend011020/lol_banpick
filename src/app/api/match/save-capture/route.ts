import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { matchId, fileName, imageDataUrl, matchState } = body as {
      matchId?: string;
      fileName?: string;
      imageDataUrl?: string;
      matchState?: unknown;
    };

    if (!imageDataUrl || !imageDataUrl.startsWith('data:image/png;base64,')) {
      return NextResponse.json(
        { ok: false, error: '유효하지 않은 이미지 데이터입니다.' },
        { status: 400 }
      );
    }

    const base64Data = imageDataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // 프로젝트 루트의 saved_banpicks 디렉토리에 자동 저장
    const saveDir = path.join(process.cwd(), 'saved_banpicks');
    await fs.mkdir(saveDir, { recursive: true });

    const safeFileName = (
      fileName || `banpick_${matchId || 'match'}_${Date.now()}.png`
    ).replace(/[^a-zA-Z0-9가-힣._-]/g, '_');

    const imageFilePath = path.join(saveDir, safeFileName);
    await fs.writeFile(imageFilePath, buffer);

    // 경기 데이터 JSON도 함께 보관
    if (matchState) {
      const jsonFileName = safeFileName.replace(/\.png$/i, '.json');
      const jsonFilePath = path.join(saveDir, jsonFileName);
      await fs.writeFile(
        jsonFilePath,
        JSON.stringify(matchState, null, 2),
        'utf-8'
      );
    }

    return NextResponse.json({
      ok: true,
      savedPath: imageFilePath,
      fileName: safeFileName,
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

