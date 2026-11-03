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

const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/**
 * 한글 문자열에서 초성만 추출합니다. (예: '리 신' -> 'ㄹㅅ')
 */
export function extractChosung(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 0xac00;
    if (code >= 0 && code < 11172) {
      const chosungIdx = Math.floor(code / 588);
      result += CHOSUNG_LIST[chosungIdx];
    } else {
      result += str[i];
    }
  }
  return result;
}

/**
 * 한국 LoL 유저들이 자주 사용하는 챔피언 약어 및 별명 사전 (영문 ID 기준)
 */
const CHAMPION_ALIASES: Record<string, string[]> = {
  Aatrox: ['아트'],
  Alkali: ['아칼'],
  Alistar: ['알리', '소'],
  Amumu: ['무무'],
  Anivia: ['애니비아', '빙닭'],
  Aphelios: ['아펠'],
  AurelionSol: ['아솔', '아우솔'],
  Azir: ['아지르'],
  Belveth: ['벨베'],
  Blitzcrank: ['블츠', '블크', '블리츠'],
  Braum: ['브람', '방패'],
  Caitlyn: ['케틀'],
  Cassiopeia: ['카시', '뱀'],
  Chogath: ['초가'],
  Corki: ['콜키'],
  Darius: ['다리'],
  Diana: ['다이'],
  Draven: ['드븐'],
  DrMundo: ['문도', '문박', '문도박사'],
  Evelynn: ['이블'],
  Ezreal: ['이즈'],
  Fiddlesticks: ['피들'],
  Gangplank: ['갱플'],
  Gragas: ['그라', '글가'],
  Graves: ['그브'],
  Hecarim: ['헤카'],
  Heimerdinger: ['하딩', '딩거'],
  Illaoi: ['일라'],
  Irelia: ['이렐'],
  JarvanIV: ['자르반', '자르반4세', '쟌반', '제4'],
  Kaisa: ['카이'],
  Kalista: ['칼리'],
  Karma: ['칼마'],
  Karthus: ['카서'],
  Kassadin: ['카사'],
  Katarina: ['카타'],
  Khazix: ['카직'],
  Kindred: ['킨드'],
  KogMaw: ['코그', '콕모'],
  KSante: ['크산', '그긴거', '그 긴거'],
  Leblanc: ['르블'],
  LeeSin: ['리신'],
  Lissandra: ['리산'],
  Lucian: ['루샨'],
  Malphite: ['말파'],
  Malzahar: ['말자'],
  Maokai: ['마오'],
  MasterYi: ['마이'],
  MissFortune: ['미포', '미스포춘'],
  MonkeyKing: ['오공'],
  Mordekaiser: ['모데'],
  Morgana: ['몰가', '모르'],
  Nautilus: ['노틸'],
  Nidalee: ['니달'],
  Nocturne: ['녹턴'],
  Nunu: ['누누', '누누와윌럼프'],
  Orianna: ['오리'],
  Pantheon: ['판테'],
  RekSai: ['렉사'],
  Renata: ['레나타', '레글'],
  Renekton: ['레넥'],
  Sejuani: ['세주'],
  Seraphine: ['세라'],
  Shyvana: ['쉬바'],
  Singed: ['신지'],
  Soraka: ['솔카', '소라', '엄마'],
  Sylas: ['사일'],
  TahmKench: ['탐켄', '탐켄치'],
  Taliyah: ['탈랴', '탈리'],
  Thresh: ['쓰레시', '쓰레쉬'],
  Tristana: ['트타', '트리'],
  Tryndamere: ['트린'],
  TwistedFate: ['트페', '트위스티드페이트'],
  Velkoz: ['벨코'],
  Viktor: ['빅토'],
  Vladimir: ['블라', '블라디'],
  Volibear: ['볼베', '볼리'],
  XinZhao: ['짜오', '신짜오', '짜장'],
  Yasuo: ['야소', '과학'],
  Yone: ['수학'],
  Zilean: ['질련'],
};

function normalizeSearchToken(str: string): string {
  return str.toLowerCase().replace(/[\s·.'"-]+/g, '');
}

function isChosungJamo(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x3131 && code <= 0x314e;
}

/**
 * 검색어(query)의 각 글자가 완성형 한글이면 정확히 일치하는지,
 * 초성 자음(ㄱ~ㅎ)이면 대상 글자의 초성과 일치하는지 슬라이딩 윈도우로 검사합니다.
 * (한글 타이핑 중 '아ㄹ' 상태나 순수 초성 'ㄹㅅ', 'ㅌㅍ' 등을 모두 정확히 매칭)
 */
function matchesHangulPattern(target: string, query: string): boolean {
  if (!query) return true;
  if (query.length > target.length) return false;

  const limit = target.length - query.length;
  for (let start = 0; start <= limit; start++) {
    let matched = true;
    for (let i = 0; i < query.length; i++) {
      const qChar = query[i];
      const tChar = target[start + i];
      if (isChosungJamo(qChar)) {
        if (extractChosung(tChar) !== qChar) {
          matched = false;
          break;
        }
      } else if (tChar !== qChar) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * 챔피언 검색어 매칭 함수
 * - 띄어쓰기 무시 (예: '리신' -> '리 신', '미스포츈' -> '미스 포츈')
 * - 초성 검색 지원 (예: 'ㄹㅅ' -> '리 신', 'ㅌㅍ' -> '트위스티드 페이트')
 * - 약어/별명 검색 지원 (예: '미포', '트페', '블츠', '그브', '케틀', '볼베', '마이', '아솔' 등)
 */
export function matchesChampionSearch(
  champ: ChampionInfo,
  rawQuery: string
): boolean {
  const q = normalizeSearchToken(rawQuery);
  if (!q) return true;

  const normName = normalizeSearchToken(champ.name);
  const normId = normalizeSearchToken(champ.id);
  const aliases = (CHAMPION_ALIASES[champ.id] ?? []).map(normalizeSearchToken);

  // 1) 이름, 영문 ID, 약어 목록에 직접 포함되거나 초성/조합 패턴이 일치하는지 확인 (띄어쓰기 무시)
  if (
    normId.includes(q) ||
    matchesHangulPattern(normName, q) ||
    aliases.some((alias) => matchesHangulPattern(alias, q))
  ) {
    return true;
  }

  // 2) 띄어쓰기로 구분된 다단어 챔피언의 각 어절 첫 글자 조합 매칭 (예: '트위스티드 페이트' -> '트페', 'ㅌㅍ')
  const words = champ.name.trim().split(/\s+/);
  if (words.length >= 2) {
    const wordInitials = normalizeSearchToken(words.map((w) => w[0]).join(''));
    if (matchesHangulPattern(wordInitials, q)) {
      return true;
    }
  }

  return false;
}

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

