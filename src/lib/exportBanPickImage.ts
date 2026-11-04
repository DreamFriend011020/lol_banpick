import {
  getTeamFearlessChampionIds,
  isMatchAutoSaveEnabled,
  resolvePickOrderSides,
} from './banpickMachine';
import { ChampionInfo, MatchState } from '../types/match';

const POSITION_LABELS = ['TOP', 'JGL', 'MID', 'BOT', 'SUP'];

/**
 * 외부 이미지(Data Dragon 초상화)를 CORS 허용 모드로 로드합니다.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * 둥근 사각형 패스 헬퍼
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * 완료된 밴픽 상태(MatchState)를 1920x1080 고해상도 PNG Data URL로 렌더링합니다.
 */
export async function renderBanPickResultToDataUrl(
  match: MatchState,
  championMap: Map<string, ChampionInfo>
): Promise<string> {
  const width = 1920;
  const height = 1080;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context를 생성할 수 없습니다.');
  }

  const bp = match.banpick_state;
  const blueTeam = match.selected_side?.blue ?? match.team_first_name;
  const redTeam = match.selected_side?.red ?? match.team_second_name;
  const { firstPickSide } = resolvePickOrderSides(match);
  const isBlueFirstPick = firstPickSide === 'BLUE';

  // 1. 배경 그라데이션
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#020617');
  bgGrad.addColorStop(0.5, '#0f172a');
  bgGrad.addColorStop(1, '#020617');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 상단 타이틀 바
  roundRectPath(ctx, 60, 40, width - 120, 140, 20);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  // 블루 진영 헤더 (좌)
  ctx.fillStyle = '#2563eb';
  roundRectPath(ctx, 90, 65, 130, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BLUE SIDE', 155, 88);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText(blueTeam, 240, 96);

  ctx.fillStyle = isBlueFirstPick ? '#fbbf24' : '#94a3b8';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(
    isBlueFirstPick ? '선픽' : '후픽',
    90,
    145
  );

  // 중앙 매치 정보
  const currentSet =
    match.rofs_submissions?.series_state?.current_game ??
    match.series_state?.current_game ??
    1;
  const totalSets =
    match.rofs_submissions?.series_state?.total_games ??
    match.series_state?.total_games ??
    1;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(
    `OFFICIAL TOURNAMENT DRAFT RESULT · SET ${currentSet}/${totalSets}`,
    width / 2,
    82
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(`MATCH: ${match.match_id} (SET ${currentSet})`, width / 2, 120);

  ctx.fillStyle = '#64748b';
  ctx.font = '15px sans-serif';
  ctx.fillText(new Date().toLocaleString('ko-KR'), width / 2, 152);

  // 레드 진영 헤더 (우)
  ctx.fillStyle = '#e11d48';
  roundRectPath(ctx, width - 220, 65, 130, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RED SIDE', width - 155, 88);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText(redTeam, width - 240, 96);

  ctx.fillStyle = !isBlueFirstPick ? '#fbbf24' : '#94a3b8';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(
    !isBlueFirstPick ? '선픽' : '후픽',
    width - 90,
    145
  );

  // 2. 밴(BANS) 섹션 렌더링 (좌: 블루 5밴 / 우: 레드 5밴)
  const blueBans = bp?.blue_bans ?? [null, null, null, null, null];
  const redBans = bp?.red_bans ?? [null, null, null, null, null];

  ctx.textAlign = 'left';
  ctx.fillStyle = '#93c5fd';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('BLUE BANS (5)', 70, 225);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fda4af';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('RED BANS (5)', width - 70, 225);

  // 블루 5밴 그리기
  for (let i = 0; i < 5; i++) {
    const champId = blueBans[i];
    const champ =
      champId && champId !== 'NO_BAN' ? championMap.get(champId) : null;
    const x = 70 + i * 118 + (i >= 3 ? 20 : 0);
    const y = 240;

    roundRectPath(ctx, x, y, 104, 104, 12);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e3a8a';
    ctx.stroke();

    if (champ) {
      const img = await loadImage(champ.imageUrl);
      if (img) {
        ctx.save();
        roundRectPath(ctx, x + 2, y + 2, 100, 100, 10);
        ctx.clip();
        ctx.filter = 'grayscale(70%)';
        ctx.drawImage(img, x + 2, y + 2, 100, 100);
        ctx.restore();
      }
      // 밴 대각선 표시
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 14);
      ctx.lineTo(x + 90, y + 90);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(
      champ ? champ.name : champId === 'NO_BAN' ? '노밴' : `밴 ${i + 1}`,
      x + 52,
      y + 126
    );
  }

  // 레드 5밴 그리기
  for (let i = 0; i < 5; i++) {
    const champId = redBans[i];
    const champ =
      champId && champId !== 'NO_BAN' ? championMap.get(champId) : null;
    const x = width - 70 - 104 - i * 118 - (i >= 3 ? 20 : 0);
    const y = 240;

    roundRectPath(ctx, x, y, 104, 104, 12);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#881337';
    ctx.stroke();

    if (champ) {
      const img = await loadImage(champ.imageUrl);
      if (img) {
        ctx.save();
        roundRectPath(ctx, x + 2, y + 2, 100, 100, 10);
        ctx.clip();
        ctx.filter = 'grayscale(70%)';
        ctx.drawImage(img, x + 2, y + 2, 100, 100);
        ctx.restore();
      }
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 14);
      ctx.lineTo(x + 90, y + 90);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(
      champ ? champ.name : champId === 'NO_BAN' ? '노밴' : `밴 ${i + 1}`,
      x + 52,
      y + 126
    );
  }

  // 3. 5:5 픽(PICKS) 섹션 렌더링
  const bluePicks = bp?.blue_picks ?? [null, null, null, null, null];
  const redPicks = bp?.red_picks ?? [null, null, null, null, null];
  const blueFearless = getTeamFearlessChampionIds(match, 'BLUE');
  const redFearless = getTeamFearlessChampionIds(match, 'RED');
  const hasFearless = blueFearless.length > 0 || redFearless.length > 0;

  const startY = hasFearless ? 388 : 400;
  const rowHeight = hasFearless ? 108 : 122;
  const cardHeight = hasFearless ? 96 : 106;
  const portraitSize = hasFearless ? 76 : 84;
  const cardWidth = 840;

  for (let i = 0; i < 5; i++) {
    const y = startY + i * rowHeight;

    // --- 좌측: 블루 픽 슬롯 ---
    const bChampId = bluePicks[i];
    const bChamp = bChampId ? championMap.get(bChampId) : null;
    const bx = 60;

    roundRectPath(ctx, bx, y, cardWidth, cardHeight, 16);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1d4ed8';
    ctx.stroke();

    if (bChamp) {
      const img = await loadImage(bChamp.imageUrl);
      if (img) {
        ctx.save();
        roundRectPath(ctx, bx + 12, y + 10, portraitSize, portraitSize, 12);
        ctx.clip();
        ctx.drawImage(img, bx + 12, y + 10, portraitSize, portraitSize);
        ctx.restore();
      }
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`BLUE ${i + 1}픽 · ${POSITION_LABELS[i]}`, bx + 108, y + 34);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(bChamp ? bChamp.name : '미선택', bx + 108, y + 70);

    // --- 우측: 레드 픽 슬롯 ---
    const rChampId = redPicks[i];
    const rChamp = rChampId ? championMap.get(rChampId) : null;
    const rx = width - 60 - cardWidth;

    roundRectPath(ctx, rx, y, cardWidth, cardHeight, 16);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#be123c';
    ctx.stroke();

    if (rChamp) {
      const img = await loadImage(rChamp.imageUrl);
      if (img) {
        ctx.save();
        roundRectPath(
          ctx,
          rx + cardWidth - 12 - portraitSize,
          y + 10,
          portraitSize,
          portraitSize,
          12
        );
        ctx.clip();
        ctx.drawImage(
          img,
          rx + cardWidth - 12 - portraitSize,
          y + 10,
          portraitSize,
          portraitSize
        );
        ctx.restore();
      }
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#fb7185';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(
      `RED ${i + 1}픽 · ${POSITION_LABELS[i]}`,
      rx + cardWidth - 108,
      y + 34
    );

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(
      rChamp ? rChamp.name : '미선택',
      rx + cardWidth - 108,
      y + 70
    );
  }

  // 4. 하드 피어리스(전 세트 픽) 섹션: 각 팀 하단에 해당 팀이 이전 세트에서 선택한 챔피언 렌더링
  if (hasFearless) {
    const fy = 934;
    const fh = 114;

    const drawTeamFearlessBox = async (
      boxX: number,
      teamName: string,
      champIds: string[],
      borderColor: string,
      isRightAlign: boolean
    ) => {
      roundRectPath(ctx, boxX, fy, cardWidth, fh, 14);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = isRightAlign ? 'right' : 'left';
      ctx.fillText(
        `FEARLESS BAN (${teamName} 전 세트 픽 · ${champIds.length}명)`,
        isRightAlign ? boxX + cardWidth - 16 : boxX + 16,
        fy + 24
      );

      for (let idx = 0; idx < Math.min(champIds.length, 20); idx++) {
        const cId = champIds[idx];
        const champ = championMap.get(cId);
        const iconSize = 48;
        const gap = 8;
        const ix = isRightAlign
          ? boxX + cardWidth - 16 - iconSize - idx * (iconSize + gap)
          : boxX + 16 + idx * (iconSize + gap);
        const iy = fy + 34;

        roundRectPath(ctx, ix, iy, iconSize, iconSize, 8);
        ctx.fillStyle = '#020617';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#334155';
        ctx.stroke();

        if (champ) {
          const img = await loadImage(champ.imageUrl);
          if (img) {
            ctx.save();
            roundRectPath(ctx, ix + 1, iy + 1, iconSize - 2, iconSize - 2, 7);
            ctx.clip();
            ctx.filter = 'grayscale(80%)';
            ctx.drawImage(img, ix + 1, iy + 1, iconSize - 2, iconSize - 2);
            ctx.restore();
          }
        }

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ix + 6, iy + 6);
        ctx.lineTo(ix + iconSize - 6, iy + iconSize - 6);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(
          champ ? champ.name.slice(0, 4) : cId.slice(0, 4),
          ix + iconSize / 2,
          iy + iconSize + 16
        );
      }
    };

    await drawTeamFearlessBox(60, blueTeam, blueFearless, '#1e3a8a', false);
    await drawTeamFearlessBox(
      width - 60 - cardWidth,
      redTeam,
      redFearless,
      '#881337',
      true
    );
  }

  return canvas.toDataURL('image/png');
}

/**
 * 밴픽 결과 이미지를 생성하여
 * 1) 설정된 구글 드라이브 폴더(GOOGLE_DRIVE_WEBHOOK_URL) 및 로컬 폴더(saved_banpicks/)에 자동 저장하고,
 * 2) 옵션에 따라 브라우저에 PNG 파일로 즉시 다운로드합니다.
 */
export async function saveBanPickScreenForStaff(
  match: MatchState,
  championMap: Map<string, ChampionInfo>,
  options: {
    triggerBrowserDownload?: boolean;
    uploadToDrive?: boolean;
    isManualRetry?: boolean;
    customFolderId?: string;
    customWebhookUrl?: string;
  } = {
      triggerBrowserDownload: false,
      uploadToDrive: true,
      isManualRetry: false,
    }
): Promise<{
  ok: boolean;
  fileName: string;
  savedPath?: string;
  driveUploaded?: boolean;
  driveUrl?: string;
  driveError?: string;
}> {
  // 수동 저장 버튼 클릭이 아닌 자동 저장 호출일 때, 자동 저장이 OFF이면 브라우저 다운로드 및 서버 업로드를 전면 차단
  if (!options.isManualRetry && !isMatchAutoSaveEnabled(match)) {
    return {
      ok: false,
      fileName: '',
    };
  }

  const blueTeam = match.selected_side?.blue ?? match.team_first_name;
  const redTeam = match.selected_side?.red ?? match.team_second_name;
  const dateStr = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);

  const currentSet =
    match.rofs_submissions?.series_state?.current_game ??
    match.series_state?.current_game ??
    1;
  const fileName = `banpick_${match.match_id}_set${currentSet}_${blueTeam}_vs_${redTeam}_${dateStr}.png`;
  const imageDataUrl = await renderBanPickResultToDataUrl(match, championMap);

  // 1) 브라우저(내 PC) 다운로드 실행
  if (options.triggerBrowserDownload && typeof document !== 'undefined') {
    const link = document.createElement('a');
    link.href = imageDataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // 내 PC 다운로드만 요청한 경우 서버/구글 드라이브 업로드를 생략하고 즉시 반환
  if (options.uploadToDrive === false) {
    return {
      ok: true,
      fileName,
      driveUploaded: false,
    };
  }

  // 2) 서버 API를 통해 지정된(또는 기본) 구글 드라이브 폴더 업로드 및 로컬 백업 저장
  try {
    const res = await fetch('/api/match/save-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId: match.match_id,
        fileName,
        imageDataUrl,
        matchState: match,
        isManualRetry: Boolean(options.isManualRetry),
        customFolderId: options.customFolderId,
        customWebhookUrl: options.customWebhookUrl,
      }),
    });
    const data = await res.json();
    return {
      ok: Boolean(data?.ok),
      fileName,
      savedPath: data?.savedPath,
      driveUploaded: Boolean(data?.driveUploaded),
      driveUrl: data?.driveUrl,
      driveError: data?.driveError,
    };
  } catch {
    return {
      ok: true,
      fileName,
    };
  }
}

