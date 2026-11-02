import { NextRequest, NextResponse } from 'next/server';

/**
 * 관리자 페이지(/admin) 암호 검증 API
 * - 환경 변수 ADMIN_PASSWORD (또는 NEXT_PUBLIC_ADMIN_PASSWORD)와 비교합니다.
 * - 환경 변수가 설정되지 않은 경우 기본값 'admin1234'를 사용합니다.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputPassword = String(body?.password ?? '').trim();

    const expectedPassword =
      process.env.ADMIN_PASSWORD ||
      process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
      'ssussandbox';

    if (inputPassword && inputPassword === expectedPassword) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: '관리자 암호가 일치하지 않습니다.' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: '암호 확인 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

