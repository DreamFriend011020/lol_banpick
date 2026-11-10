'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  BanPickAction,
  ChampionInfo,
  MatchState,
  SideChoice,
} from '../../types/match';
import {
  getCurrentTurnStep,
  getFearlessChampionIds,
  getSeriesState,
  getTeamFearlessChampionIds,
  getUnavailableChampionIds,
  isInSwapPhase,
  isMatchAutoSaveEnabled,
  isMatchTimerUnlimited,
  isScrimMatchRoom,
  resolveFirstTeamSide,
  resolvePickOrderSides,
  resolveViewerSide,
  SWAP_DURATION_SECONDS,
  TOURNAMENT_DRAFT_SEQUENCE,
  TURN_DURATION_SECONDS,
} from '../../lib/banpickMachine';
import {
  ChampionPosition,
  fetchLatestChampions,
  getChampionPositions,
  matchesChampionSearch,
} from '../../lib/ddragon';
import { saveBanPickScreenForStaff } from '../../lib/exportBanPickImage';
import { ViewerRole } from './RofsSelectionScreen';

interface BanPickDraftScreenProps {
  match: MatchState;
  viewerRole: ViewerRole;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onDispatchBanPick: (action: BanPickAction) => Promise<void> | void;
  isAdminVerified?: boolean;
  onAdminVerified?: () => void;
}

export type PositionFilter = 'ALL' | ChampionPosition;

const POSITION_FILTERS: { label: string; position: PositionFilter }[] = [
  { label: '전체', position: 'ALL' },
  { label: '탑', position: 'TOP' },
  { label: '정글', position: 'JGL' },
  { label: '미드', position: 'MID' },
  { label: '바텀', position: 'BOT' },
  { label: '서포터', position: 'SUP' },
];

const POSITION_LABELS = ['TOP', 'JGL', 'MID', 'BOT', 'SUP'];
const POSITION_KOR_NAMES = ['탑', '정글', '미드', '원딜', '서포터 '];

export default function BanPickDraftScreen({
  match,
  viewerRole,
  isSubmitting = false,
  errorMessage = null,
  onDispatchBanPick,
  isAdminVerified: propIsAdminVerified,
  onAdminVerified,
}: BanPickDraftScreenProps) {
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [ddragonVersion, setDdragonVersion] = useState<string>('');
  const [isLoadingChamps, setIsLoadingChamps] = useState<boolean>(true);
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPosition, setSelectedPosition] = useState<PositionFilter>('ALL');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    TURN_DURATION_SECONDS
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [driveErrorNotice, setDriveErrorNotice] = useState<string | null>(null);
  const [isExportingImage, setIsExportingImage] = useState<boolean>(false);
  const [customDriveFolderInput, setCustomDriveFolderInput] = useState<string>(
    match.drive_folder_id ?? ''
  );

  // 관리자(운영진) 인증 여부 (실제 경기에서 관리자만 세트 승패를 결정하고 다음 세트를 시작하도록 제한)
  const [internalAdminVerified, setInternalAdminVerified] = useState<boolean>(false);
  const isAdminVerified = propIsAdminVerified ?? internalAdminVerified;
  const [showAdminUnlockInput, setShowAdminUnlockInput] =
    useState<boolean>(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState<string>('');
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState<boolean>(false);

  const bp = match.banpick_state;
  const seriesState = useMemo(() => getSeriesState(match), [match]);
  const isScrimRoom = useMemo(() => isScrimMatchRoom(match), [match]);
  const isUnlimited = useMemo(() => isMatchTimerUnlimited(match), [match]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAuth =
        window.sessionStorage.getItem('lol_banpick_admin_authenticated') ||
        window.localStorage.getItem('lol_banpick_admin_authenticated');
      const savedKey =
        window.sessionStorage.getItem('lol_banpick_admin_key') ||
        window.localStorage.getItem('lol_banpick_admin_key');
      const savedMaster =
        window.sessionStorage.getItem('lol_banpick_admin_is_master') ||
        window.localStorage.getItem('lol_banpick_admin_is_master');
      if (savedAuth === 'true') {
        if (
          savedMaster === 'true' ||
          !seriesState.admin_key ||
          (savedKey && seriesState.admin_key && savedKey === seriesState.admin_key)
        ) {
          setInternalAdminVerified(true);
        } else {
          setInternalAdminVerified(false);
        }
      }
    }
  }, [seriesState.admin_key]);

  const handleVerifyAdminInMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminAuthError(null);
    setIsVerifyingAdmin(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: adminPasswordInput,
          matchAdminKey: seriesState.admin_key ?? '',
        }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            'lol_banpick_admin_authenticated',
            'true'
          );
          window.localStorage.setItem(
            'lol_banpick_admin_authenticated',
            'true'
          );
          if (data.adminKey) {
            window.sessionStorage.setItem(
              'lol_banpick_admin_key',
              String(data.adminKey)
            );
            window.localStorage.setItem(
              'lol_banpick_admin_key',
              String(data.adminKey)
            );
          }
          window.sessionStorage.setItem(
            'lol_banpick_admin_is_master',
            data.isMaster ? 'true' : 'false'
          );
          window.localStorage.setItem(
            'lol_banpick_admin_is_master',
            data.isMaster ? 'true' : 'false'
          );
        }
        setInternalAdminVerified(true);
        onAdminVerified?.();
        setShowAdminUnlockInput(false);
        setAdminPasswordInput('');
      } else {
        setAdminAuthError(data?.error || '관리자 암호가 일치하지 않습니다.');
      }
    } catch {
      setAdminAuthError('암호 확인 중 오류가 발생했습니다.');
    } finally {
      setIsVerifyingAdmin(false);
    }
  };

  // 60초 라인 스왑 페이즈에서 첫 번째로 클릭한 슬롯 인덱스 (0~4)
  const [selectedSwapSlot, setSelectedSwapSlot] = useState<number | null>(null);

  const timeoutTriggeredTurnRef = useRef<number | null>(null);
  const swapTimeoutTriggeredRef = useRef<boolean>(false);
  const autoSavedRef = useRef<boolean>(false);
  const localDeadlineRef = useRef<{
    turnIndex: number;
    deadlineAt: number;
  } | null>(null);

  // 1. Data Dragon 최신 챔피언 목록 로드
  useEffect(() => {
    let isMounted = true;
    setIsLoadingChamps(true);

    fetchLatestChampions()
      .then(({ version, champions: list }) => {
        if (isMounted) {
          setDdragonVersion(version);
          setChampions(list);
          setIsLoadingChamps(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsLoadingChamps(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // 챔피언 ID -> ChampionInfo 빠른 조회용 맵
  const championMap = useMemo(() => {
    const map = new Map<string, ChampionInfo>();
    for (const c of champions) {
      map.set(c.id, c);
    }
    return map;
  }, [champions]);

  const canControlNextGame = isScrimRoom || isAdminVerified;
  const fearlessIds = useMemo(() => getFearlessChampionIds(match), [match]);
  const blueFearlessPicks = useMemo(
    () => getTeamFearlessChampionIds(match, 'BLUE'),
    [match]
  );
  const redFearlessPicks = useMemo(
    () => getTeamFearlessChampionIds(match, 'RED'),
    [match]
  );
  const inSwapPhase = isInSwapPhase(match);
  const currentStep = useMemo(
    () => getCurrentTurnStep(bp, match),
    [bp, match]
  );
  const unavailableIds = useMemo(
    () => getUnavailableChampionIds(bp, match),
    [bp, match]
  );

  // 현재 세트에서 누가 FIRST 역할을 맡았는지와 팀별 진영 계산
  const currentFirstRole: 'TEAM_A' | 'TEAM_B' =
    seriesState.game_first_roles?.[seriesState.current_game - 1] ?? 'TEAM_A';
  const firstSide = resolveFirstTeamSide(match);
  const teamASide =
    currentFirstRole === 'TEAM_A'
      ? firstSide
      : firstSide === 'BLUE'
        ? 'RED'
        : 'BLUE';
  const teamBSide = teamASide === 'BLUE' ? 'RED' : 'BLUE';

  // 다음 세트 FIRST 역할을 맡을 팀 기본값 (기본적으로 이전 세트 FIRST의 반대 역할)
  const defaultNextFirstRole: 'TEAM_A' | 'TEAM_B' =
    seriesState.game_first_roles?.[seriesState.current_game] ??
    (currentFirstRole === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A');

  const [nextFirstRole, setNextFirstRole] =
    useState<'TEAM_A' | 'TEAM_B'>(defaultNextFirstRole);
  const [nextGameFearless, setNextGameFearless] = useState<boolean>(
    seriesState.fearless_enabled
  );
  const [nextGameTimerUnlimited, setNextGameTimerUnlimited] = useState<boolean>(
    Boolean(seriesState.timer_unlimited)
  );

  useEffect(() => {
    setNextFirstRole(defaultNextFirstRole);
    setNextGameFearless(seriesState.fearless_enabled);
    setNextGameTimerUnlimited(Boolean(seriesState.timer_unlimited));
    autoSavedRef.current = false;
    swapTimeoutTriggeredRef.current = false;
  }, [
    seriesState.current_game,
    defaultNextFirstRole,
    seriesState.fearless_enabled,
    seriesState.timer_unlimited,
  ]);

  // 현재 접속자의 진영('BLUE' | 'RED' | null) 판별
  const viewerSide: SideChoice | null = useMemo(
    () => resolveViewerSide(match, viewerRole),
    [match, viewerRole]
  );

  // 본인 팀의 밴/픽 턴인지 여부
  const isMyTurn =
    match.status === 'BANPICK_IN_PROGRESS' &&
    !inSwapPhase &&
    currentStep !== null &&
    viewerSide !== null &&
    viewerSide === currentStep.side;

  // 본인 팀이 라인 스왑을 완료(잠금)했는지 여부
  const isMySwapReady =
    viewerSide === 'BLUE'
      ? Boolean(bp?.blue_swap_ready)
      : viewerSide === 'RED'
        ? Boolean(bp?.red_swap_ready)
        : false;

  // 2. 턴 변경 시 현재 기기(PC)의 시계 기준으로 정확히 30초(스왑 60초) 마감 시각을 단 1회 고정
  //    (참가자 PC 간 윈도우 시계 오차가 20~30초씩 나더라도 30초에서 3초로 갑자기 줄어들지 않도록 원천 차단)
  useEffect(() => {
    timeoutTriggeredTurnRef.current = null;
    setSelectedSwapSlot(null);

    if (match.status !== 'BANPICK_IN_PROGRESS' || !bp) {
      localDeadlineRef.current = null;
      setRemainingSeconds(0);
      return;
    }

    if (isUnlimited) {
      localDeadlineRef.current = null;
      setRemainingSeconds(999);
      return;
    }

    const turnIdx = bp.current_turn_index;
    const maxSec = turnIdx >= 20 ? SWAP_DURATION_SECONDS : TURN_DURATION_SECONDS;
    const maxMs = maxSec * 1000;

    // 이미 동일한 턴의 로컬 타이머가 시작되어 돌아가고 있다면 절대 재설정하지 않고 유지
    if (localDeadlineRef.current?.turnIndex === turnIdx) {
      return;
    }

    const now = Date.now();
    localDeadlineRef.current = {
      turnIndex: turnIdx,
      deadlineAt: now + maxMs,
    };
    setRemainingSeconds(maxSec);
  }, [match.status, bp?.current_turn_index, isUnlimited]);

  const isAutoSaveOn = isMatchAutoSaveEnabled(match);

  // 밴픽 최종 종료('COMPLETED') 시 자동 저장 ON 상태일 때만 지정된 구글 드라이브 폴더 및 운영진 화면에 자동 저장
  useEffect(() => {
    if (
      match.status !== 'COMPLETED' ||
      isLoadingChamps ||
      championMap.size === 0 ||
      autoSavedRef.current
    ) {
      return;
    }

    autoSavedRef.current = true;

    if (!isAutoSaveOn) {
      setSavedNotice(
        '자동 저장이 OFF 상태입니다. 필요 시 아래 버튼을 눌러 수동 저장하세요.'
      );
      return;
    }

    setIsExportingImage(true);

    saveBanPickScreenForStaff(match, championMap, {
      triggerBrowserDownload: false,
      uploadToDrive: true,
      isManualRetry: false,
    })
      .then((res) => {
        if (res.ok && res.driveUploaded) {
          setDriveErrorNotice(null);
          setSavedNotice(
            `지정된 구글 드라이브 폴더에 밴픽 결과 사진(${res.fileName})이 자동 저장되었습니다!`
          );
        } else {
          setSavedNotice(null);
          setDriveErrorNotice(
            "구글 드라이브 전송 실패: 저장하고자 하는 폴더에 '링크가 있는 모든 사용자 - 편집 가능(편집자)' 권한이 없어 저장에 실패했습니다. 폴더 공유 설정을 변경해 주세요."
          );
        }
      })
      .finally(() => {
        setIsExportingImage(false);
      });
  }, [match, isLoadingChamps, championMap, viewerRole, isAutoSaveOn]);

  const handleSaveToDrive = async () => {
    if (isExportingImage || championMap.size === 0) return;
    setIsExportingImage(true);
    setDriveErrorNotice(null);
    try {
      const res = await saveBanPickScreenForStaff(match, championMap, {
        triggerBrowserDownload: false,
        uploadToDrive: true,
        isManualRetry: true,
        customFolderId: customDriveFolderInput.trim() || undefined,
      });
      if (res.ok && res.driveUploaded) {
        setDriveErrorNotice(null);
        setSavedNotice(`구글 드라이브에 저장 완료: ${res.fileName}`);
      } else {
        setSavedNotice(null);
        setDriveErrorNotice(
          "구글 드라이브 전송 실패: 저장하고자 하는 폴더에 '링크가 있는 모든 사용자 - 편집 가능(편집자)' 권한이 없어 저장에 실패했습니다. 해당 폴더의 공유 권한을 변경해 주세요."
        );
      }
    } finally {
      setIsExportingImage(false);
    }
  };

  const handleDownloadToPc = async () => {
    if (isExportingImage || championMap.size === 0) return;
    setIsExportingImage(true);
    try {
      const res = await saveBanPickScreenForStaff(match, championMap, {
        triggerBrowserDownload: true,
        uploadToDrive: false,
        isManualRetry: true,
      });
      if (res.ok) {
        setDriveErrorNotice(null);
        setSavedNotice(`내 PC에 사진 다운로드 완료: ${res.fileName}`);
      }
    } finally {
      setIsExportingImage(false);
    }
  };

  // 3. 각 턴당 30초 & 라인 스왑 페이즈 60초 단일 카운트다운 타이머 제어
  const latestTimerStateRef = useRef({
    bp,
    inSwapPhase,
    currentStep,
    isMyTurn,
    viewerSide,
    unavailableIds,
    champions,
    onDispatchBanPick,
    isUnlimited,
  });

  useEffect(() => {
    latestTimerStateRef.current = {
      bp,
      inSwapPhase,
      currentStep,
      isMyTurn,
      viewerSide,
      unavailableIds,
      champions,
      onDispatchBanPick,
      isUnlimited,
    };
  });

  useEffect(() => {
    if (match.status !== 'BANPICK_IN_PROGRESS') {
      setRemainingSeconds(0);
      return;
    }

    const updateTimer = () => {
      const {
        bp: currentBp,
        inSwapPhase: currentInSwap,
        currentStep: step,
        isMyTurn: myTurn,
        viewerSide: side,
        unavailableIds: unavail,
        champions: champList,
        onDispatchBanPick: dispatch,
        isUnlimited: unlimited,
      } = latestTimerStateRef.current;

      if (!currentBp) return;

      if (unlimited) {
        setRemainingSeconds((prev) => (prev !== 999 ? 999 : prev));
        return;
      }

      if (localDeadlineRef.current?.turnIndex !== currentBp.current_turn_index) {
        const maxSec =
          currentBp.current_turn_index >= 20
            ? SWAP_DURATION_SECONDS
            : TURN_DURATION_SECONDS;
        localDeadlineRef.current = {
          turnIndex: currentBp.current_turn_index,
          deadlineAt: Date.now() + maxSec * 1000,
        };
      }

      const deadlineAt = localDeadlineRef.current.deadlineAt;
      const diffMs = deadlineAt - Date.now();
      const secs = Math.max(0, Math.ceil(diffMs / 1000));
      setRemainingSeconds((prev) => (prev !== secs ? secs : prev));

      // (A) 60초 라인 스왑 페이즈 타이머 종료 시 -> 중복 호출 방지를 위해 역할별 시간차 적용
      const swapGraceMs =
        side === 'BLUE' ? 0 : side === 'RED' ? -1500 : -3000;
      if (
        currentInSwap &&
        diffMs <= swapGraceMs &&
        !swapTimeoutTriggeredRef.current
      ) {
        swapTimeoutTriggeredRef.current = true;
        dispatch({
          type: 'FINISH_SWAP_PHASE',
        });
        return;
      }

      // (B) 일반 밴/픽 턴(30초) 타이머 종료 시 -> 현재 턴 팀이 0초에 즉시 처리, 미접속 시에만 상대팀(-2.5초)/옵저버(-4초)가 백업 처리
      const timeoutGraceMs = myTurn ? 0 : side !== null ? -2500 : -4000;
      if (
        !currentInSwap &&
        step &&
        diffMs <= timeoutGraceMs &&
        champList.length > 0 &&
        timeoutTriggeredTurnRef.current !== currentBp.current_turn_index
      ) {
        timeoutTriggeredTurnRef.current = currentBp.current_turn_index;

        let fallbackId = currentBp.hovered_champion_id;
        if (!fallbackId || unavail.has(fallbackId)) {
          if (step.actionType === 'BAN') {
            fallbackId = 'NO_BAN';
          } else {
            // 아무 챔피언도 선택하지 않은 경우 남은 챔피언 중 랜덤 픽!
            const availableList = champList.filter((c) => !unavail.has(c.id));
            const randomChamp =
              availableList[Math.floor(Math.random() * availableList.length)];
            fallbackId = randomChamp ? randomChamp.id : 'Ahri';
          }
        }

        dispatch({
          type: 'TIMEOUT_TURN',
          fallbackChampionId: fallbackId,
          expectedTurnIndex: currentBp.current_turn_index,
          now: Date.now(),
        });
      }
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 200);
    return () => window.clearInterval(intervalId);
  }, [match.status]);

  // 4. 검색창(한글명/영문명/띄어쓰기 무시/초성/약어) 및 포지션 필터링
  const filteredChampions = useMemo(() => {
    return champions.filter((champ) => {
      const matchesPosition =
        selectedPosition === 'ALL' ||
        getChampionPositions(champ).includes(selectedPosition);
      if (!matchesPosition) return false;
      return matchesChampionSearch(champ, searchQuery);
    });
  }, [champions, searchQuery, selectedPosition]);

  // 챔피언 클릭(프리뷰 Hover) 핸들러
  const handleSelectChampion = (championId: string) => {
    if (!isMyTurn || !viewerSide || isSubmitting) return;
    if (championId !== 'NO_BAN' && unavailableIds.has(championId)) return;

    onDispatchBanPick({
      type: 'HOVER_CHAMPION',
      actorSide: viewerSide,
      championId,
    });
  };

  // '선택 완료(Lock-in)' 버튼 핸들러 (챔피언이 선택되었을 때만 활성화 및 확정)
  const handleLockIn = () => {
    if (
      !isMyTurn ||
      !viewerSide ||
      !bp?.hovered_champion_id ||
      isSubmitting
    ) {
      return;
    }

    onDispatchBanPick({
      type: 'LOCK_IN',
      actorSide: viewerSide,
      championId: bp.hovered_champion_id,
      now: Date.now(),
    });
  };

  // 60초 라인 스왑 페이즈: 슬롯 클릭으로 두 챔피언의 라인(위치) 맞바꾸기
  const handlePickSlotSwapClick = (side: SideChoice, slotIndex: number) => {
    if (
      !inSwapPhase ||
      viewerSide !== side ||
      isMySwapReady ||
      isSubmitting
    ) {
      return;
    }

    if (selectedSwapSlot === null) {
      setSelectedSwapSlot(slotIndex);
      return;
    }

    if (selectedSwapSlot === slotIndex) {
      setSelectedSwapSlot(null);
      return;
    }

    onDispatchBanPick({
      type: 'SWAP_CHAMPIONS',
      actorSide: side,
      fromSlotIndex: selectedSwapSlot,
      toSlotIndex: slotIndex,
    });
    setSelectedSwapSlot(null);
  };

  // 인접 라인(위/아래)과 즉시 스왑하는 핸들러
  const handleQuickAdjacentSwap = (
    fromSlotIndex: number,
    toSlotIndex: number
  ) => {
    if (
      !inSwapPhase ||
      !viewerSide ||
      isMySwapReady ||
      isSubmitting ||
      toSlotIndex < 0 ||
      toSlotIndex > 4
    ) {
      return;
    }

    onDispatchBanPick({
      type: 'SWAP_CHAMPIONS',
      actorSide: viewerSide,
      fromSlotIndex,
      toSlotIndex,
    });
    setSelectedSwapSlot(null);
  };

  // 우리 팀 라인 스왑 완료(확정) 핸들러
  const handleReadySwapPhase = () => {
    if (!inSwapPhase || !viewerSide || isMySwapReady || isSubmitting) return;
    onDispatchBanPick({
      type: 'READY_SWAP_PHASE',
      actorSide: viewerSide,
    });
  };

  const blueTeamName = match.selected_side?.blue ?? match.team_first_name;
  const redTeamName = match.selected_side?.red ?? match.team_second_name;

  const { firstPickSide } = resolvePickOrderSides(match);
  const isBlueFirstPick = firstPickSide === 'BLUE';
  const isRedFirstPick = firstPickSide === 'RED';

  // 페이즈 한글 제목
  const renderPhaseTitle = () => {
    if (match.status === 'BANPICK_READY') {
      return '밴픽 준비 완료';
    }
    if (match.status === 'COMPLETED') {
      return '밴픽 및 라인 스왑 완료';
    }
    if (inSwapPhase) {
      return '최종 라인 스왑 페이즈 (60초)';
    }
    if (!currentStep) {
      return '밴픽 완료';
    }
    const firstPickSideLabel = isRedFirstPick ? '레드 선픽' : '블루 선픽';
    switch (currentStep.phase) {
      case 'PHASE1_BAN':
        return `1차 밴 페이즈`;
      case 'PHASE1_PICK':
        return `1차 픽 페이즈`;
      case 'PHASE2_BAN':
        return '2차 밴 페이즈';
      case 'PHASE2_PICK':
        return '2차 픽 페이즈';
      default:
        return '밴픽 진행 중';
    }
  };

  // 밴 슬롯 렌더링 헬퍼
  const renderBanSlot = (
    side: SideChoice,
    slotIndex: number,
    championId: string | null
  ) => {
    const isCurrentBanSlot =
      match.status === 'BANPICK_IN_PROGRESS' &&
      !inSwapPhase &&
      currentStep?.actionType === 'BAN' &&
      currentStep.side === side &&
      currentStep.slotIndex === slotIndex;

    const effectiveChampId =
      isCurrentBanSlot && bp?.hovered_champion_id
        ? bp.hovered_champion_id
        : championId;

    const champ =
      effectiveChampId && effectiveChampId !== 'NO_BAN'
        ? championMap.get(effectiveChampId)
        : null;

    return (
      <div
        key={`${side}-ban-${slotIndex}`}
        className={`relative w-11 h-11 md:w-13 md:h-13 rounded-lg overflow-hidden border transition-all flex items-center justify-center bg-slate-900 ${isCurrentBanSlot
          ? side === 'BLUE'
            ? 'border-blue-400 ring-2 ring-blue-400/60 animate-pulse'
            : 'border-rose-400 ring-2 ring-rose-400/60 animate-pulse'
          : championId
            ? 'border-slate-700'
            : 'border-slate-800/80'
          }`}
        title={champ ? `${champ.name} 밴` : `${slotIndex + 1}밴`}
      >
        {champ ? (
          <>
            <img
              src={champ.imageUrl}
              alt={champ.name}
              className={`w-full h-full object-cover ${championId ? 'grayscale opacity-75' : 'opacity-90'
                }`}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-rose-950/30">
              <div className="w-full h-0.5 bg-rose-500 rotate-45 shadow" />
            </div>
          </>
        ) : effectiveChampId === 'NO_BAN' ? (
          <span className="text-[10px] font-bold text-slate-400">NO BAN</span>
        ) : (
          <span className="text-[10px] text-slate-600 font-semibold">
            B{slotIndex + 1}
          </span>
        )}
      </div>
    );
  };

  // 픽 슬롯 렌더링 헬퍼 (라인 스왑 페이즈 시 클릭으로 위치 변경 가능)
  const renderPickSlot = (
    side: SideChoice,
    slotIndex: number,
    championId: string | null
  ) => {
    const isCurrentPickSlot =
      match.status === 'BANPICK_IN_PROGRESS' &&
      !inSwapPhase &&
      currentStep?.actionType === 'PICK' &&
      currentStep.side === side &&
      currentStep.slotIndex === slotIndex;

    const effectiveChampId =
      isCurrentPickSlot && bp?.hovered_champion_id
        ? bp.hovered_champion_id
        : championId;

    const champ = effectiveChampId
      ? championMap.get(effectiveChampId)
      : null;

    const isBlue = side === 'BLUE';
    const canSwapThisSide =
      inSwapPhase && viewerSide === side && !isMySwapReady;
    const isSwapSelected =
      canSwapThisSide && selectedSwapSlot === slotIndex;

    return (
      <div
        key={`${side}-pick-${slotIndex}`}
        onClick={() => {
          if (canSwapThisSide) {
            handlePickSlotSwapClick(side, slotIndex);
          }
        }}
        className={`relative h-[76px] md:h-[82px] rounded-xl overflow-hidden border transition-all flex items-center ${isBlue ? 'flex-row' : 'flex-row-reverse text-right'
          } ${canSwapThisSide ? 'cursor-pointer hover:scale-[1.01]' : ''
          } ${isSwapSelected
            ? 'border-amber-400 bg-amber-950/40 ring-2 ring-amber-400 shadow-lg shadow-amber-500/20'
            : isCurrentPickSlot
              ? isBlue
                ? 'border-blue-400 bg-blue-950/40 ring-2 ring-blue-400/50 shadow-lg shadow-blue-500/10'
                : 'border-rose-400 bg-rose-950/40 ring-2 ring-rose-400/50 shadow-lg shadow-rose-500/10'
              : championId
                ? isBlue
                  ? 'border-blue-500/30 bg-slate-900/90'
                  : 'border-rose-500/30 bg-slate-900/90'
                : 'border-slate-800 bg-slate-900/40'
          }`}
      >
        {/* 배경 스플래시 아트 */}
        {champ && (
          <div className="absolute inset-0 opacity-25 pointer-events-none">
            <img
              src={champ.splashUrl}
              alt=""
              className="w-full h-full object-cover object-top"
            />
            <div
              className={`absolute inset-0 bg-gradient-to-${isBlue ? 'r' : 'l'
                } from-slate-950 via-slate-950/70 to-transparent`}
            />
          </div>
        )}

        {/* 챔피언 정사각형 초상화 영역 */}
        <div
          className={`relative z-10 w-14 h-14 md:w-16 md:h-16 m-1.5 rounded-lg overflow-hidden border flex-shrink-0 flex items-center justify-center bg-slate-950 ${isSwapSelected
            ? 'border-amber-400'
            : isCurrentPickSlot
              ? isBlue
                ? 'border-blue-400'
                : 'border-rose-400'
              : 'border-slate-700/80'
            }`}
        >
          {champ ? (
            <img
              src={champ.imageUrl}
              alt={champ.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs font-bold text-slate-600">
              {POSITION_LABELS[slotIndex]}
            </span>
          )}
        </div>

        {/* 텍스트 정보 영역 */}
        <div className="relative z-10 px-3 flex-1 min-w-0">
          <div
            className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${isBlue ? 'text-blue-400' : 'text-rose-400 justify-end'
              }`}
          >
            <span className="px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-700 text-white">
              {POSITION_LABELS[slotIndex]}
            </span>
            <span>{side} {slotIndex + 1}픽</span>
            {isCurrentPickSlot && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500 text-slate-950 font-extrabold animate-pulse">
                선택 중
              </span>
            )}
            {isSwapSelected && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-400 text-slate-950 font-extrabold">
                스왑 선택됨
              </span>
            )}
          </div>

          <div className="text-base md:text-lg font-extrabold text-white truncate mt-0.5">
            {champ
              ? champ.name
              : isCurrentPickSlot
                ? '챔피언 선택 대기...'
                : '—'}
          </div>

          {canSwapThisSide && (
            <div className="text-[11px] text-amber-300 font-semibold truncate">
              {isSwapSelected
                ? '바꿀 다른 라인 카드를 클릭하세요'
                : selectedSwapSlot !== null
                  ? `클릭하여 [${POSITION_LABELS[selectedSwapSlot]}] ↔ [${POSITION_LABELS[slotIndex]}] 라인 교체`
                  : '클릭하여 라인 위치 변경'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // 각 팀 하단: 해당 팀이 이전 세트에서 픽한 하드 피어리스 금지 챔피언 목록 렌더링
  const renderTeamFearlessSection = (side: SideChoice) => {
    if (!seriesState.fearless_enabled) return null;

    const isBlue = side === 'BLUE';
    const teamName = isBlue ? blueTeamName : redTeamName;
    const isSameTeamName = seriesState.team_a_name === seriesState.team_b_name;
    const teamLabel = isSameTeamName
      ? isBlue
        ? `${blueTeamName} (블루 진영)`
        : `${redTeamName} (레드 진영)`
      : isBlue
        ? blueTeamName
        : redTeamName;
    const teamFearlessIds = isBlue ? blueFearlessPicks : redFearlessPicks;

    // 5개 단위(세트별)로 행 분리
    const setRows: string[][] = [];
    for (let i = 0; i < teamFearlessIds.length; i += 5) {
      setRows.push(teamFearlessIds.slice(i, i + 5));
    }

    return (
      <div
        className={`mt-1.5 rounded-xl border p-2.5 bg-slate-900/85 ${isBlue ? 'border-blue-500/30' : 'border-rose-500/30'
          }`}
      >
        <div
          className={`flex items-center justify-between gap-1.5 mb-2 ${isBlue ? 'flex-row' : 'flex-row-reverse'
            }`}
        >
          <span className="text-[11px] font-extrabold text-amber-300 flex items-center gap-1">
            🔥 {teamLabel} 피어리스 금지 (전 세트 픽)
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
            {teamFearlessIds.length}명
          </span>
        </div>

        {setRows.length === 0 ? (
          <div className="py-2.5 text-center text-[11px] text-slate-500 bg-slate-950/60 rounded-lg border border-slate-800/60">

          </div>
        ) : (
          <div className="space-y-1.5">
            {setRows.map((rowChamps, setIdx) => (
              <div
                key={`${side}-fearless-set-${setIdx}`}
                className={`flex items-center gap-1.5 ${isBlue ? 'flex-row' : 'flex-row-reverse'
                  }`}
              >
                <span className="text-[10px] font-extrabold text-slate-400 w-9 text-center flex-shrink-0 bg-slate-950/90 py-1 rounded border border-slate-800">
                  {setIdx + 1}세트
                </span>
                <div className="grid grid-cols-5 gap-1 flex-1">
                  {rowChamps.map((champId) => {
                    const champ = championMap.get(champId);
                    return (
                      <div
                        key={`${side}-fearless-${champId}`}
                        className="relative flex flex-col items-center bg-slate-950/90 rounded-lg p-1 border border-slate-800 overflow-hidden"
                        title={
                          champ
                            ? `${champ.name} (${setIdx + 1}세트 ${teamName} 픽)`
                            : champId
                        }
                      >
                        <div className="relative w-9 h-9 rounded overflow-hidden bg-slate-900">
                          {champ ? (
                            <img
                              src={champ.imageUrl}
                              alt={champ.name}
                              className="w-full h-full object-cover grayscale opacity-75"
                            />
                          ) : (
                            <span className="text-[9px] text-slate-500 flex items-center justify-center h-full">
                              {champId}
                            </span>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-rose-950/25">
                            <div className="w-full h-0.5 bg-rose-500/80 rotate-45" />
                          </div>
                        </div>
                        <span className="text-[9px] font-bold text-slate-300 truncate w-full text-center mt-0.5">
                          {champ ? champ.name : champId}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const maxTimerDuration = inSwapPhase
    ? SWAP_DURATION_SECONDS
    : TURN_DURATION_SECONDS;

  const timerProgressPercent = isUnlimited
    ? 100
    : Math.min(
      100,
      Math.max(0, (remainingSeconds / maxTimerDuration) * 100)
    );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-start gap-2.5 p-2.5 md:p-4 select-none">
      {/* =====================================================================
          1. 상단 헤더: 좌측 블루 진영 / 중앙 타이머 & 턴 표시 / 우측 레드 진영
      ===================================================================== */}
      <header className="max-w-[1340px] w-full mx-auto space-y-2">
        {match.rofs_submissions?.first_choice &&
          match.rofs_submissions?.second_choice && (
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-4 py-2 text-xs text-slate-300 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <span className="font-bold text-amber-400">RoFS 확정 결과</span>
              <span>
                {match.team_first_name}팀 선택:{' '}
                <strong className="text-white">
                  {match.rofs_submissions.first_choice.category === 'SIDE'
                    ? `${match.rofs_submissions.first_choice.choice === 'BLUE' ? '블루' : '레드'} 진영`
                    : `${match.rofs_submissions.first_choice.choice === 'FIRST_PICK' ? '선픽' : '후픽'}`}
                </strong>
              </span>
              <span className="text-slate-600">→</span>
              <span>
                {match.team_second_name}팀 선택:{' '}
                <strong className="text-cyan-300">
                  {match.rofs_submissions.first_choice.category === 'SIDE'
                    ? `${match.rofs_submissions.second_choice.pickOrderChoice === 'FIRST_PICK' ? '선픽' : '후픽'}`
                    : `${match.rofs_submissions.second_choice.sideChoice === 'BLUE' ? '블루' : '레드'} 진영`}
                </strong>
              </span>
            </div>
          )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl">
          {/* 좌측: 블루 진영 (BLUE SIDE) 정보 및 5밴 슬롯 */}
          <div className="lg:col-span-4 flex flex-col items-start space-y-3">
            <div className="flex items-center gap-2.5 w-full justify-between lg:justify-start">
              <span className="px-2.5 py-1 rounded bg-blue-600 text-white text-xs font-black tracking-wider uppercase">
                BLUE SIDE
              </span>
              <h2 className="text-2xl font-black text-white tracking-tight">
                {blueTeamName}
              </h2>
              {isBlueFirstPick ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  선픽
                </span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  후픽
                </span>
              )}
              {viewerSide === 'BLUE' && (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  내 진영
                </span>
              )}
            </div>

            {bp && (
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((idx) =>
                  renderBanSlot('BLUE', idx, bp.blue_bans[idx])
                )}
                <div className="w-px h-8 bg-slate-700 mx-1" />
                {[3, 4].map((idx) =>
                  renderBanSlot('BLUE', idx, bp.blue_bans[idx])
                )}
              </div>
            )}
          </div>

          {/* 중앙: 현재 페이즈 / 턴 안내 및 30초(밴픽) 또는 60초(라인스왑) 타이머 */}
          <div className="lg:col-span-4 flex flex-col items-center justify-center text-center px-2">
            <div className="text-xs font-bold uppercase tracking-widest text-amber-400">
              {renderPhaseTitle()}
            </div>

            {match.status === 'BANPICK_READY' && (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-slate-300">
                  RoFS 진영 및 픽 순서 배정이 완료되었습니다.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    onDispatchBanPick({ type: 'START_BANPICK', now: Date.now() })
                  }
                  className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-500/20 transition-all"
                >
                  토너먼트 드래프트 밴픽 시작하기
                </button>
              </div>
            )}

            {/* 일반 20턴 밴픽 진행 중 */}
            {match.status === 'BANPICK_IN_PROGRESS' &&
              !inSwapPhase &&
              currentStep && (
                <>
                  <div className="flex items-center gap-3 my-1">
                    {currentStep.side === 'BLUE' && (
                      <span className="text-blue-400 font-black text-lg animate-pulse">
                        ◀ BLUE TURN
                      </span>
                    )}

                    {isUnlimited ? (
                      <div className="flex items-center gap-2">
                        <span className="text-4xl font-black text-amber-300">
                          ∞
                        </span>
                        <span className="text-xs font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          시간 무제한
                        </span>
                      </div>
                    ) : (
                      <div
                        className={`text-4xl font-black tabular-nums tracking-tight ${remainingSeconds <= 10
                          ? 'text-rose-400 animate-pulse'
                          : 'text-white'
                          }`}
                      >
                        :{String(remainingSeconds).padStart(2, '0')}
                      </div>
                    )}

                    {currentStep.side === 'RED' && (
                      <span className="text-rose-400 font-black text-lg animate-pulse">
                        RED TURN ▶
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-bold text-slate-200">
                    {/* 턴 {currentStep.turnIndex + 1} /{' '}
                    {TOURNAMENT_DRAFT_SEQUENCE.length} —{' '} */}
                    <span
                      className={
                        currentStep.side === 'BLUE'
                          ? 'text-blue-400'
                          : 'text-rose-400'
                      }
                    >
                      {currentStep.side === 'BLUE' ? blueTeamName : redTeamName}{' '}
                      ({currentStep.label})
                    </span>
                  </div>

                  <div className="w-full max-w-xs h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
                    <div
                      className={`h-full transition-all duration-200 ${isUnlimited
                        ? 'bg-amber-400'
                        : remainingSeconds <= 10
                          ? 'bg-rose-500'
                          : currentStep.side === 'BLUE'
                            ? 'bg-blue-500'
                            : 'bg-rose-500'
                        }`}
                      style={{ width: `${timerProgressPercent}%` }}
                    />
                  </div>
                </>
              )}

            {/* 60초 라인 스왑 페이즈 진행 중 */}
            {inSwapPhase && (
              <>
                <div className="flex items-center gap-3 my-1">
                  <span className="text-amber-400 font-black text-sm uppercase tracking-wider animate-pulse">
                    ◀ LANE SWAP
                  </span>
                  {isUnlimited ? (
                    <div className="flex items-center gap-2">
                      <span className="text-4xl font-black text-amber-300">
                        ∞
                      </span>
                      <span className="text-xs font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        시간 무제한
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`text-4xl font-black tabular-nums tracking-tight ${remainingSeconds <= 10
                        ? 'text-rose-400 animate-pulse'
                        : 'text-amber-300'
                        }`}
                    >
                      :{String(remainingSeconds).padStart(2, '0')}
                    </div>
                  )}
                  <span className="text-amber-400 font-black text-sm uppercase tracking-wider animate-pulse">
                    {isUnlimited ? 'SWAP TIMER ▶' : '60s TIMER ▶'}
                  </span>
                </div>

                <div className="text-xs font-semibold text-slate-300">
                  블루 스왑:{' '}
                  <strong
                    className={
                      bp?.blue_swap_ready
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                    }
                  >
                    {bp?.blue_swap_ready ? '✓ 완료' : '변경 중...'}
                  </strong>{' '}
                  · 레드 스왑:{' '}
                  <strong
                    className={
                      bp?.red_swap_ready ? 'text-emerald-400' : 'text-amber-300'
                    }
                  >
                    {bp?.red_swap_ready ? '✓ 완료' : '변경 중...'}
                  </strong>
                </div>

                <div className="w-full max-w-xs h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
                  <div
                    className={`h-full transition-all duration-200 ${isUnlimited
                      ? 'bg-amber-400'
                      : remainingSeconds <= 10
                        ? 'bg-rose-500'
                        : 'bg-amber-400'
                      }`}
                    style={{ width: `${timerProgressPercent}%` }}
                  />
                </div>
              </>
            )}

            {match.status === 'COMPLETED' && (
              <div className="mt-2 flex flex-col items-center gap-1.5 w-full">
                <div className="px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm font-bold">
                  {seriesState.current_game}세트 밴픽 및 라인 배치가 완료되었습니다!
                </div>
              </div>
            )}
          </div>

          {/* 우측: 레드 진영 (RED SIDE) 정보 및 5밴 슬롯 */}
          <div className="lg:col-span-4 flex flex-col items-end space-y-3">
            <div className="flex items-center gap-2.5 w-full justify-between lg:justify-end">
              {viewerSide === 'RED' && (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  내 진영
                </span>
              )}
              {isRedFirstPick ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  선픽
                </span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  후픽
                </span>
              )}
              <h2 className="text-2xl font-black text-white tracking-tight">
                {redTeamName}
              </h2>
              <span className="px-2.5 py-1 rounded bg-rose-600 text-white text-xs font-black tracking-wider uppercase">
                RED SIDE
              </span>
            </div>

            {bp && (
              <div className="flex items-center gap-1.5">
                {[4, 3].map((idx) =>
                  renderBanSlot('RED', idx, bp.red_bans[idx])
                )}
                <div className="w-px h-8 bg-slate-700 mx-1" />
                {[2, 1, 0].map((idx) =>
                  renderBanSlot('RED', idx, bp.red_bans[idx])
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* =====================================================================
          2. 메인 본문: 좌측 블루 5픽 / 중앙(챔피언 그리드 또는 60초 라인스왑 패널) / 우측 레드 5픽
      ===================================================================== */}
      <main className="max-w-[1340px] w-full mx-auto my-1 grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-start">
        {/* 좌측: 블루 진영 5인 픽 슬롯 + 블루 팀 전 세트 픽(피어리스 금지) */}
        <section className="lg:col-span-3 flex flex-col justify-start gap-1.5">
          {[0, 1, 2, 3, 4].map((slotIdx) =>
            renderPickSlot(
              'BLUE',
              slotIdx,
              bp ? bp.blue_picks[slotIdx] : null
            )
          )}
          {renderTeamFearlessSection('BLUE')}
        </section>

        {/* 중앙 영역: 챔피언 선택칸 및 60초 라인 스왑 보드 + 하단 밴픽 완료 컨트롤 */}
        <div className="lg:col-span-6 flex flex-col gap-2.5">
          <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-[580px] md:h-[640px]">
            {inSwapPhase ? (
              /* ===============================================================
                 [60초 라인 스왑 페이즈 전용 중앙 패널]
              =============================================================== */
              <div className="flex flex-col justify-between h-full">
                <div className="space-y-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      60초 라인 스왑 (Champion Lane Swap)
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-white">
                    픽된 챔피언의 라인(TOP / JGL / MID / BOT / SUP)을 최종 배치하세요
                  </h3>
                  <p className="text-xs text-slate-400">
                    좌/우 픽 슬롯 카드를 직접 두 번 클릭하여 서로 바꾸거나, 아래 라인 배치표에서 [스왑 선택] / [▲ / ▼] 버튼으로 즉시 위치를 변경할 수 있습니다.
                  </p>
                </div>

                {/* 내 팀 라인 배치 및 스왑 리스트 (옵저버는 양 팀 현황 안내) */}
                <div className="flex-1 overflow-y-auto my-3 space-y-2 pr-1">
                  {viewerSide ? (
                    (viewerSide === 'BLUE'
                      ? bp?.blue_picks ?? []
                      : bp?.red_picks ?? []
                    ).map((champId, idx) => {
                      const champ = champId ? championMap.get(champId) : null;
                      const isSelected = selectedSwapSlot === idx;

                      return (
                        <div
                          key={`swap-row-${idx}`}
                          className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${isSelected
                            ? 'border-amber-400 bg-amber-500/15'
                            : 'border-slate-800 bg-slate-950/70'
                            }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-24 text-xs font-black px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-amber-300 text-center">
                              {POSITION_KOR_NAMES[idx]}
                            </span>
                            {champ && (
                              <img
                                src={champ.imageUrl}
                                alt={champ.name}
                                className="w-11 h-11 rounded-lg object-cover border border-slate-700"
                              />
                            )}
                            <div>
                              <div className="text-sm font-extrabold text-white">
                                {champ ? champ.name : '미선택'}
                              </div>
                            </div>
                          </div>

                          {/* 스왑 조작 버튼 */}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={
                                isMySwapReady || isSubmitting || idx === 0
                              }
                              onClick={() =>
                                handleQuickAdjacentSwap(idx, idx - 1)
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="윗 라인과 교체"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={
                                isMySwapReady || isSubmitting || idx === 4
                              }
                              onClick={() =>
                                handleQuickAdjacentSwap(idx, idx + 1)
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="아랫 라인과 교체"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              disabled={isMySwapReady || isSubmitting}
                              onClick={() =>
                                handlePickSlotSwapClick(viewerSide, idx)
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${isSelected
                                ? 'bg-amber-400 text-slate-950'
                                : selectedSwapSlot !== null
                                  ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                            >
                              {isSelected
                                ? '선택 취소'
                                : selectedSwapSlot !== null
                                  ? `${POSITION_LABELS[selectedSwapSlot]}와 교체`
                                  : '스왑 선택'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3 text-slate-300">
                      <span className="w-7 h-7 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      <p className="text-base font-bold text-white">
                        양 팀이 챔피언의 라인(TOP/JGL/MID/BOT/SUP)을 배치하고 있습니다.
                      </p>
                      <p className="text-xs text-slate-400">
                        {isUnlimited
                          ? '양 팀이 모두 [라인 스왑 종료]를 누르거나 관리자가 즉시 종료하면 최종 결과가 확정됩니다.'
                          : '60초 타이머가 종료되거나 양 팀이 모두 [라인 스왑 종료]를 누르면 최종 결과가 확정되고 운영진 화면에 자동 저장됩니다.'}
                      </p>
                    </div>
                  )}
                </div>

                {/* 라인 스왑 하단 완료/종료 컨트롤 바 */}
                <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-slate-300">
                    {viewerSide && (viewerRole === 'FIRST' || viewerRole === 'SECOND') ? (
                      isMySwapReady ? (
                        <span className="text-emerald-400 font-bold">
                          ✓ 우리 팀({viewerSide === 'BLUE' ? '블루' : '레드'}) 라인 스왑 완료! 상대 팀 완료{isUnlimited ? '' : ' 또는 타이머 종료'} 시 최종 확정됩니다.
                        </span>
                      ) : (
                        <span>
                          라인 배치를 마쳤다면 우측{' '}
                          <strong className="text-amber-300">
                            [라인 스왑 종료 (확정)]
                          </strong>{' '}
                          버튼을 눌러주세요.
                        </span>
                      )
                    ) : (
                      <span className="text-slate-400">
                        {canControlNextGame
                          ? '관리자 관전 모드 — 양 팀 스왑 완료를 기다리거나, 필요 시 [스왑 즉시 종료]를 누를 수 있습니다.'
                          : '관전 모드 — 양 팀의 실시간 라인 스왑 배치가 좌/우 슬롯에 실시간으로 표시됩니다.'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                    {/* 관리자 관전 전용: 스왑 즉시 종료 (팀장에게는 절대 노출되지 않음) */}
                    {viewerRole === 'OBSERVER' && canControlNextGame && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() =>
                          onDispatchBanPick({ type: 'FINISH_SWAP_PHASE' })
                        }
                        className="w-full sm:w-auto px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-all disabled:opacity-40"
                        title="관리자 권한으로 라인 스왑을 즉시 강제 종료하고 최종 밴픽 완료 단계로 전환합니다."
                      >
                        스왑 즉시 종료 (최종 완료)
                      </button>
                    )}

                    {/* 각 팀 팀장 전용: 라인 스왑 종료 (관리자/옵저버에게는 절대 노출되지 않음) */}
                    {(viewerRole === 'FIRST' || viewerRole === 'SECOND') && viewerSide && (
                      <button
                        type="button"
                        disabled={isMySwapReady || isSubmitting}
                        onClick={handleReadySwapPhase}
                        className="w-full sm:w-auto px-7 py-2.5 rounded-xl font-extrabold text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isMySwapReady
                          ? '라인 스왑 완료됨 (대기 중)'
                          : '라인 스왑 종료 (확정)'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* ===============================================================
                 [일반 20턴 밴/픽 페이즈 중앙 챔피언 그리드 패널]
              =============================================================== */
              <>
                {/* 검색창 및 역할군 필터 */}
                <div className="space-y-3 pb-3 border-b border-slate-800">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                    <div className="relative flex-1 flex items-center">
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSearchInput(val);
                          setSearchQuery(val.trim());
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            setSearchQuery(searchInput.trim());
                          }
                        }}
                        placeholder="챔피언 검색"
                        className="w-full rounded-xl bg-slate-950 border border-slate-700 pl-3.5 pr-20 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                      />
                      <div className="absolute right-1.5 flex items-center gap-1">
                        {searchInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchInput('');
                              setSearchQuery('');
                            }}
                            className="px-2 py-1 text-xs text-slate-400 hover:text-white transition-colors"
                            title="초기화"
                          >
                            초기화
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSearchQuery(searchInput.trim())}
                          className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-colors flex items-center justify-center cursor-pointer"
                          title="검색"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {ddragonVersion && (
                      <span className="text-[11px] text-slate-400 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 self-end sm:self-auto">
                        Data Dragon v{ddragonVersion} ({champions.length}명)
                      </span>
                    )}
                  </div>

                  {/* 포지션 필터 탭 (이미 선택된 포지션을 다시 클릭하면 'ALL'로 복귀) */}
                  <div className="flex flex-wrap gap-1.5">
                    {POSITION_FILTERS.map((pos) => (
                      <button
                        key={pos.position}
                        type="button"
                        onClick={() =>
                          setSelectedPosition((prev) =>
                            prev === pos.position && pos.position !== 'ALL'
                              ? 'ALL'
                              : pos.position
                          )
                        }
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${selectedPosition === pos.position
                            ? 'bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 챔피언 초상화 그리드 */}
                <div className="flex-1 overflow-y-auto my-3 pr-1">
                  {isLoadingChamps ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                      <span className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">
                        Data Dragon API에서 최신 챔피언 목록을 불러오는 중입니다...
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 gap-2.5">
                      {currentStep?.actionType === 'BAN' && (
                        <button
                          type="button"
                          disabled={!isMyTurn || isSubmitting}
                          onClick={() => handleSelectChampion('NO_BAN')}
                          className={`group flex flex-col items-center p-1.5 rounded-xl border transition-all ${bp?.hovered_champion_id === 'NO_BAN'
                            ? 'border-amber-400 bg-amber-500/20 ring-2 ring-amber-400/50'
                            : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <div className="w-14 h-14 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-400">
                            기권
                          </div>
                          <span className="text-[11px] font-medium text-slate-300 mt-1 truncate w-full text-center">
                            노밴 (Skip)
                          </span>
                        </button>
                      )}

                      {filteredChampions.map((champ) => {
                        const isUnavailable = unavailableIds.has(champ.id);
                        const isFearlessBanned = fearlessIds.has(champ.id);
                        const isHovered = bp?.hovered_champion_id === champ.id;

                        return (
                          <button
                            key={champ.id}
                            type="button"
                            disabled={!isMyTurn || isUnavailable || isSubmitting}
                            onClick={() => handleSelectChampion(champ.id)}
                            className={`group relative flex flex-col items-center p-1.5 rounded-xl border transition-all ${isHovered
                              ? 'border-amber-400 bg-amber-500/20 ring-2 ring-amber-400/60 scale-[1.02]'
                              : isUnavailable
                                ? 'border-slate-900 bg-slate-950/30 opacity-35 cursor-not-allowed'
                                : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-600'
                              } disabled:cursor-not-allowed`}
                          >
                            <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-slate-900">
                              <img
                                src={champ.imageUrl}
                                alt={champ.name}
                                loading="lazy"
                                className={`w-full h-full object-cover ${isUnavailable ? 'grayscale' : ''
                                  }`}
                              />
                              {isUnavailable && (
                                <div className="absolute inset-0 bg-slate-950/75 flex items-center justify-center">
                                  <span
                                    className={`text-[10px] font-black uppercase ${isFearlessBanned
                                      ? 'text-amber-400'
                                      : 'text-rose-400'
                                      }`}
                                  >
                                    {isFearlessBanned ? '피어리스' : '불가'}
                                  </span>
                                </div>
                              )}
                            </div>
                            <span className="text-[11px] font-medium text-slate-200 mt-1 truncate w-full text-center">
                              {champ.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 하단: 에러 알림 및 '선택 완료(Lock-in)' 버튼 */}
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  {errorMessage && (
                    <div className="rounded-lg bg-rose-950/70 border border-rose-500/50 px-3 py-1.5 text-xs text-rose-200 text-center">
                      {errorMessage}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="text-xs text-slate-300">
                      {match.status === 'BANPICK_IN_PROGRESS' && currentStep ? (
                        isMyTurn ? (
                          bp?.hovered_champion_id ? (
                            <span>
                              선택 대기 중:{' '}
                              <strong className="text-amber-400 text-sm">
                                {bp.hovered_champion_id === 'NO_BAN'
                                  ? '노밴 (기권)'
                                  : championMap.get(bp.hovered_champion_id)
                                    ?.name ?? bp.hovered_champion_id}
                              </strong>{' '}
                              — 우측 버튼을 눌러 확정하세요.
                            </span>
                          ) : (
                            <span className="text-amber-300 font-semibold leading-relaxed">
                              우리 팀의{' '}
                              {currentStep.actionType === 'BAN' ? (
                                <>
                                  밴 차례입니다!
                                  <br />
                                  챔피언을 선택해주세요.
                                </>
                              ) : (
                                <>
                                  픽 차례입니다!
                                  <br />
                                  아무것도 선택하지 않으면 랜덤 픽으로 결정됩니다.
                                </>
                              )}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">
                            현재{' '}
                            <strong className="text-white">
                              {currentStep.side === 'BLUE'
                                ? `${blueTeamName}`
                                : `${redTeamName}`}
                            </strong>{' '}
                            팀이 {currentStep.label}을 진행하고 있습니다...
                          </span>
                        )
                      ) : match.status === 'COMPLETED' ? null : (
                        <span className="text-slate-400">
                          상단 [토너먼트 드래프트 밴픽 시작하기] 버튼을 누르면 1차 밴부터 시작됩니다.
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={
                        !isMyTurn || !bp?.hovered_champion_id || isSubmitting
                      }
                      onClick={handleLockIn}
                      className={`w-full sm:w-auto px-7 py-2.5 rounded-xl font-extrabold text-sm transition-all ${currentStep?.actionType === 'BAN'
                        ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20'
                        : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
                        } disabled:opacity-35 disabled:cursor-not-allowed`}
                    >
                      {isSubmitting
                        ? '동기화 중...'
                        : currentStep?.actionType === 'BAN'
                          ? '챔피언 밴 완료 (Lock-in)'
                          : '선택 완료 (Lock-in)'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 밴픽 종료(COMPLETED) 시 선택 완료 박스 아래에 표시되는 드라이브 저장 및 다음 세트 진행 컨트롤 */}
          {match.status === 'COMPLETED' && (
            <section className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 flex flex-col items-center gap-3 shadow-xl">
              {savedNotice && (
                <span className="text-xs text-emerald-300 font-semibold text-center">
                  ✓ {savedNotice}
                </span>
              )}

              {driveErrorNotice && (
                <div className="w-full rounded-xl bg-rose-950/70 border border-rose-500/60 px-3.5 py-2.5 text-xs text-rose-200 font-semibold text-center">
                  ⚠️ {driveErrorNotice}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                <input
                  type="text"
                  value={customDriveFolderInput}
                  onChange={(e) => setCustomDriveFolderInput(e.target.value)}
                  placeholder="구글 드라이브 폴더 링크/ID (비우면 기본 폴더)"
                  className="flex-1 min-w-[200px] rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={handleSaveToDrive}
                  disabled={isExportingImage}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-xs font-bold text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {isExportingImage ? '처리 중...' : '구글 드라이브 저장'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadToPc}
                  disabled={isExportingImage}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold text-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {isExportingImage ? '처리 중...' : '내 PC에 사진 다운로드'}
                </button>
              </div>

              {/* 다전제 다음 세트(Game N+1) 승리팀 선택 -> 패배팀 FIRST 자동 배정 및 시작 컨트롤 */}
              {canControlNextGame ? (
                <div className="w-full rounded-xl bg-slate-950/90 border border-amber-500/40 p-3 space-y-2.5 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-300">
                      {isScrimRoom
                        ? `🎮 [스크림 전용] ${seriesState.current_game}세트 승리팀 선택`
                        : `👑 [관리자 전용] ${seriesState.current_game}세트 승리팀 확정`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setNextGameTimerUnlimited((prev) => !prev)}
                        className={`px-2.5 py-0.5 rounded text-[11px] font-extrabold border transition-colors ${nextGameTimerUnlimited
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                      >
                        ⏱️ 시간: {nextGameTimerUnlimited ? '무제한 (∞)' : '30초'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNextGameFearless((prev) => !prev)}
                        className={`px-2.5 py-0.5 rounded text-[11px] font-extrabold border transition-colors ${nextGameFearless
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                      >
                        🔥 하드 피어리스: {nextGameFearless ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const isSameTeamName =
                      seriesState.team_a_name === seriesState.team_b_name;
                    const teamASideKor = teamASide === 'BLUE' ? '블루' : '레드';
                    const teamBSideKor = teamBSide === 'BLUE' ? '블루' : '레드';

                    const teamALabel = isSameTeamName
                      ? `${teamASideKor} 진영 ${seriesState.team_a_name}`
                      : `${seriesState.team_a_name} [${teamASideKor}]`;
                    const teamBLabel = isSameTeamName
                      ? `${teamBSideKor} 진영 ${seriesState.team_b_name}`
                      : `${seriesState.team_b_name} [${teamBSideKor}]`;

                    const teamANextFirstLabel = isSameTeamName
                      ? `${seriesState.team_a_name}`
                      : seriesState.team_a_name;
                    const teamBNextFirstLabel = isSameTeamName
                      ? `${seriesState.team_b_name}`
                      : seriesState.team_b_name;

                    return (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setNextFirstRole('TEAM_B')}
                            className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition-all text-left ${nextFirstRole === 'TEAM_B'
                              ? 'border-amber-400 bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50'
                              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                              }`}
                          >
                            <div className="text-[11px] text-emerald-300 font-extrabold">
                              🏆 {seriesState.current_game}세트 승리: {teamALabel}
                            </div>
                            <div className="mt-0.5 text-amber-300 font-black">
                              → {seriesState.current_game + 1}세트 FIRST: {teamBNextFirstLabel}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setNextFirstRole('TEAM_A')}
                            className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition-all text-left ${nextFirstRole === 'TEAM_A'
                              ? 'border-amber-400 bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50'
                              : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                              }`}
                          >
                            <div className="text-[11px] text-emerald-300 font-extrabold">
                              🏆 {seriesState.current_game}세트 승리: {teamBLabel}
                            </div>
                            <div className="mt-0.5 text-amber-300 font-black">
                              → {seriesState.current_game + 1}세트 FIRST: {teamANextFirstLabel}
                            </div>
                          </button>
                        </div>

                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() =>
                            onDispatchBanPick({
                              type: 'START_NEXT_GAME',
                              nextFirstTeamName:
                                nextFirstRole === 'TEAM_A'
                                  ? seriesState.team_a_name
                                  : seriesState.team_b_name,
                              nextFirstRole,
                              fearlessEnabled: nextGameFearless,
                              timerUnlimited: nextGameTimerUnlimited,
                            })
                          }
                          className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-all disabled:opacity-50"
                        >
                          승리팀 확정 · {seriesState.current_game + 1}세트 RoFS 시작하기 →
                        </button>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="w-full rounded-xl bg-slate-950/90 border border-slate-800 p-3 space-y-2 text-center">
                  <div className="text-xs font-extrabold text-amber-300">
                    🔒 다음 세트 진행 대기 중 (관리자 전용 승패 결정)
                  </div>
                  <p className="text-[11px] text-slate-400">
                    인게임 경기가 끝난 후 <strong>관리자(운영진)</strong>가 이번 세트의 승패 결과를 확정하면, 패배팀이 다음 세트 FIRST 팀으로 배정되어 자동으로 다음 세트 RoFS 화면이 시작됩니다.
                  </p>
                  {!showAdminUnlockInput ? (
                    <button
                      type="button"
                      onClick={() => setShowAdminUnlockInput(true)}
                      className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-300 transition-colors"
                    >
                      🔑 운영진(관리자) 암호로 승패 결정 권한 열기
                    </button>
                  ) : (
                    <form
                      onSubmit={handleVerifyAdminInMatch}
                      className="flex flex-col sm:flex-row items-center justify-center gap-1.5 pt-1"
                    >
                      <input
                        type="password"
                        required
                        value={adminPasswordInput}
                        onChange={(e) => setAdminPasswordInput(e.target.value)}
                        placeholder="관리자 암호 입력"
                        className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-white focus:outline-none focus:border-amber-400"
                      />
                      <button
                        type="submit"
                        disabled={isVerifyingAdmin}
                        className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold"
                      >
                        {isVerifyingAdmin ? '확인 중...' : '인증'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdminUnlockInput(false);
                          setAdminAuthError(null);
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-800 text-xs text-slate-400"
                      >
                        취소
                      </button>
                      {adminAuthError && (
                        <span className="text-[11px] text-rose-400 block w-full">
                          {adminAuthError}
                        </span>
                      )}
                    </form>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* 우측: 레드 진영 5인 픽 슬롯 + 레드 팀 전 세트 픽(피어리스 금지) */}
        <section className="lg:col-span-3 flex flex-col justify-start gap-1.5">
          {[0, 1, 2, 3, 4].map((slotIdx) =>
            renderPickSlot('RED', slotIdx, bp ? bp.red_picks[slotIdx] : null)
          )}
          {renderTeamFearlessSection('RED')}
        </section>
      </main>
    </div>
  );
}
