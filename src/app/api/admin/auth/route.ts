import { NextRequest, NextResponse } from 'next/server';

const HARDCODED_MASTER_PASSWORD = 'dlwjddn1020';

function getAllowedAdminPasswords(): Set<string> {
  const rawValues: string[] = [
    HARDCODED_MASTER_PASSWORD,
    process.env.ADMIN_PASSWORD ?? '',
    process.env.ADMIN_PASSWORDS ?? '',
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? '',
  ];

  // ADMIN_PASSWORD_1, ADMIN_PASSWORD_2 등 번호가 붙은 환경 변수도 모두 인식
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith('ADMIN_PASSWORD_') && typeof val === 'string') {
      rawValues.push(val);
    }
  }

  const allowed = new Set<string>();
  for (const raw of rawValues) {
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed) {
        allowed.add(trimmed);
      }
    }
  }
  return allowed;
}

/**
 * 관리자 페이지(/admin) 및 개별 경기 방 관리자 암호 검증 API
 * - .env.local의 ADMIN_PASSWORD(콤마 구분 또는 ADMIN_PASSWORD_1, 2...) 및 하드코딩된 마스터 암호('ssussandbox')만 허용합니다.
 * - 입력한 비밀번호별로 독립된 공식 대회 매치 목록을 관리할 수 있도록 adminKey를 반환합니다.
 * - 하드코딩된 마스터 비밀번호('ssussandbox')와 일치할 때만 isMaster: true를 반환하여 자유 스크림 방 탭 접근을 허용합니다.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputPassword = String(body?.password ?? '').trim();
    const matchAdminKey =
      typeof body?.matchAdminKey === 'string'
        ? body.matchAdminKey.trim()
        : undefined;

    if (!inputPassword) {
      return NextResponse.json(
        { ok: false, error: '관리자 암호를 입력해주세요.' },
        { status: 400 }
      );
    }

    const allowedPasswords = getAllowedAdminPasswords();
    if (!allowedPasswords.has(inputPassword)) {
      return NextResponse.json(
        { ok: false, error: '관리자 암호가 일치하지 않습니다.' },
        { status: 401 }
      );
    }

    const isMaster = inputPassword === HARDCODED_MASTER_PASSWORD;

    // 특정 경기 방 내부에서 관리자 권한을 열 때: 해당 경기 생성 암호 또는 하드코딩 마스터 암호만 허용
    if (matchAdminKey !== undefined) {
      const isMatchOwner =
        Boolean(matchAdminKey) && inputPassword === matchAdminKey;
      if (!isMaster && !isMatchOwner) {
        return NextResponse.json(
          { ok: false, error: '해당 경기의 관리자 암호가 일치하지 않습니다.' },
          { status: 401 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      adminKey: inputPassword,
      isMaster,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: '암호 확인 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

