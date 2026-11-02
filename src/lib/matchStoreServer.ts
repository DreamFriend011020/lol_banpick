import { promises as fs } from 'fs';
import path from 'path';
import { MatchState } from '../types/match';

const DB_DIR = path.join(process.cwd(), 'saved_banpicks');
const DB_FILE = path.join(DB_DIR, 'matches_db.json');

async function ensureDbFile(): Promise<Record<string, MatchState>> {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, MatchState>;
  } catch {
    return {};
  }
}

async function writeDbFile(data: Record<string, MatchState>): Promise<void> {
  await fs.mkdir(DB_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getAllMatchesFromStore(): Promise<MatchState[]> {
  const store = await ensureDbFile();
  return Object.values(store).sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '')
  );
}

export async function getMatchByIdFromStore(
  matchId: string
): Promise<MatchState | null> {
  const store = await ensureDbFile();
  return store[matchId] ?? null;
}

export async function upsertMatchesToStore(
  matches: MatchState[]
): Promise<MatchState[]> {
  const store = await ensureDbFile();
  for (const m of matches) {
    store[m.match_id] = m;
  }
  await writeDbFile(store);
  return matches;
}

export async function deleteMatchFromStore(matchId: string): Promise<boolean> {
  const store = await ensureDbFile();
  if (!store[matchId]) return false;
  delete store[matchId];
  await writeDbFile(store);
  return true;
}

export async function deleteMatchesFromStore(
  matchIds: string[]
): Promise<number> {
  if (matchIds.length === 0) return 0;
  const store = await ensureDbFile();
  let deletedCount = 0;
  for (const id of matchIds) {
    if (store[id]) {
      delete store[id];
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    await writeDbFile(store);
  }
  return deletedCount;
}

