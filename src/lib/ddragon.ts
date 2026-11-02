import { ChampionInfo } from '../types/match';

const DDRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';
const FALLBACK_VERSION = '14.23.1';

interface DDragonChampionRaw {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
}

interface DDragonChampionResponse {
  version: string;
  data: Record<string, DDragonChampionRaw>;
}

/**
 * 네트워크 오프라인 대비 기본 챔피언 폴백 목록
 */
const FALLBACK_CHAMPIONS: Omit<ChampionInfo, 'imageUrl' | 'splashUrl'>[] = [
  { id: 'Garen', key: '86', name: '가렌', title: '데마시아의 힘', tags: ['Fighter', 'Tank'] },
  { id: 'Galio', key: '3', name: '갈리오', title: '위대한 석상', tags: ['Tank', 'Mage'] },
  { id: 'Nautilus', key: '111', name: '노틸러스', title: '심해의 타이탄', tags: ['Tank', 'Support'] },
  { id: 'Nidalee', key: '76', name: '니달리', title: '야성의 사냥꾼', tags: ['Assassin', 'Mage'] },
  { id: 'Rumble', key: '68', name: '럼블', title: '기계화 악동', tags: ['Fighter', 'Mage'] },
  { id: 'Renekton', key: '58', name: '레넥톤', title: '사막의 도살자', tags: ['Fighter', 'Tank'] },
  { id: 'Leona', key: '89', name: '레오나', title: '여명의 빛', tags: ['Tank', 'Support'] },
  { id: 'LeeSin', key: '64', name: '리 신', title: '눈먼 수도승', tags: ['Fighter', 'Assassin'] },
  { id: 'Varus', key: '110', name: '바루스', title: '응징의 화살', tags: ['Marksman', 'Mage'] },
  { id: 'Vi', key: '254', name: '바이', title: '필트오버의 집행자', tags: ['Fighter', 'Assassin'] },
  { id: 'Sejuani', key: '113', name: '세주아니', title: '혹한의 분노', tags: ['Tank'] },
  { id: 'Sylas', key: '517', name: '사일러스', title: '해방된 자', tags: ['Mage', 'Assassin'] },
  { id: 'Ahri', key: '103', name: '아리', title: '구미호', tags: ['Mage', 'Assassin'] },
  { id: 'Azir', key: '268', name: '아지르', title: '사막의 황제', tags: ['Mage', 'Marksman'] },
  { id: 'Ashe', key: '22', name: '애쉬', title: '서리 궁수', tags: ['Marksman', 'Support'] },
  { id: 'Orianna', key: '61', name: '오리아나', title: '시계태엽 소녀', tags: ['Mage'] },
  { id: 'Yone', key: '777', name: '요네', title: '잊히지 못한 자', tags: ['Fighter', 'Assassin'] },
  { id: 'Ezreal', key: '81', name: '이즈리얼', title: '방탕한 탐험가', tags: ['Marksman', 'Mage'] },
  { id: 'Jax', key: '24', name: '잭스', title: '무기의 달인', tags: ['Fighter'] },
  { id: 'Jinx', key: '222', name: '징크스', title: '난폭한 말괄량이', tags: ['Marksman'] },
  { id: 'Kaisa', key: '145', name: '카이사', title: '공허의 딸', tags: ['Marksman'] },
  { id: 'KSante', key: '897', name: '크산테', title: '나주마의 긍지', tags: ['Tank', 'Fighter'] },
  { id: 'Taliyah', key: '163', name: '탈리야', title: '바위술사', tags: ['Mage'] },
  { id: 'FakerLeblanc', key: '7', name: '르블랑', title: '환술사', tags: ['Assassin', 'Mage'] },
];

export function getChampionSquareUrl(version: string, championId: string): string {
  const realId = championId === 'FakerLeblanc' ? 'Leblanc' : championId;
  return `${DDRAGON_BASE_URL}/cdn/${version}/img/champion/${realId}.png`;
}

export function getChampionSplashUrl(championId: string): string {
  const realId = championId === 'FakerLeblanc' ? 'Leblanc' : championId;
  return `${DDRAGON_BASE_URL}/cdn/img/champion/splash/${realId}_0.jpg`;
}

/**
 * Riot Data Dragon API에서 최신 버전과 한글(ko_KR) 챔피언 전체 목록을 가져옵니다.
 */
export async function fetchLatestChampions(): Promise<{
  version: string;
  champions: ChampionInfo[];
}> {
  try {
    const versionRes = await fetch(`${DDRAGON_BASE_URL}/api/versions.json`);
    if (!versionRes.ok) {
      throw new Error('Failed to fetch Data Dragon versions');
    }
    const versions: string[] = await versionRes.json();
    const latestVersion = versions[0] || FALLBACK_VERSION;

    const champRes = await fetch(
      `${DDRAGON_BASE_URL}/cdn/${latestVersion}/data/ko_KR/champion.json`
    );
    if (!champRes.ok) {
      throw new Error('Failed to fetch Data Dragon champion list');
    }

    const payload: DDragonChampionResponse = await champRes.json();
    const champions: ChampionInfo[] = Object.values(payload.data)
      .map((raw) => ({
        id: raw.id,
        key: raw.key,
        name: raw.name,
        title: raw.title,
        tags: raw.tags,
        imageUrl: getChampionSquareUrl(latestVersion, raw.id),
        splashUrl: getChampionSplashUrl(raw.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    return {
      version: latestVersion,
      champions,
    };
  } catch {
    const fallbackList: ChampionInfo[] = FALLBACK_CHAMPIONS.map((c) => {
      const normalizedId = c.id === 'FakerLeblanc' ? 'Leblanc' : c.id;
      return {
        ...c,
        id: normalizedId,
        imageUrl: getChampionSquareUrl(FALLBACK_VERSION, normalizedId),
        splashUrl: getChampionSplashUrl(normalizedId),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    return {
      version: FALLBACK_VERSION,
      champions: fallbackList,
    };
  }
}

