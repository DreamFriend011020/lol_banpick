import { TeamRole } from '../types/match';

export type InviteRole = TeamRole | 'OBSERVER';

const SECRET_SALT = 'lol_banpick_rofs_2026_secure_salt_v2';

/**
 * matchId와 역할('FIRST' | 'SECOND')을 기반으로 고유한 10자리 보안 접속 키를 생성합니다.
 * 별도의 DB 스키마 변경 없이도 서버/클라이언트 어디서든 동일하게 검증됩니다.
 */
export function generateRoleKey(matchId: string, role: InviteRole): string {
  if (role === 'OBSERVER') {
    return 'observer';
  }

  const input = `${matchId}::${role}::${SECRET_SALT}`;
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const part1 = (h1 >>> 0).toString(36).padStart(6, '0');
  const part2 = (h2 >>> 0).toString(36).padStart(6, '0');
  const prefix = role === 'FIRST' ? 'f1' : 's2';

  return `${prefix}${part1}${part2}`.slice(0, 12);
}

/**
 * URL 쿼리의 key 파라미터를 검증하여 부여할 권한('FIRST' | 'SECOND' | 'OBSERVER')을 반환합니다.
 * 유효한 팀장 키가 없으면 무조건 읽기 전용 'OBSERVER' 권한만 부여합니다.
 */
export function resolveRoleFromKey(
  matchId: string,
  key?: string | null
): InviteRole {
  if (!key) return 'OBSERVER';
  const trimmed = key.trim();
  if (trimmed === generateRoleKey(matchId, 'FIRST')) {
    return 'FIRST';
  }
  if (trimmed === generateRoleKey(matchId, 'SECOND')) {
    return 'SECOND';
  }
  return 'OBSERVER';
}

/**
 * 각 역할별 전용 입장 경로(/match/[match_id]?key=...)를 생성합니다.
 */
export function buildMatchRolePath(
  matchId: string,
  role: InviteRole
): string {
  const key = generateRoleKey(matchId, role);
  return `/match/${encodeURIComponent(matchId)}?key=${encodeURIComponent(key)}`;
}

