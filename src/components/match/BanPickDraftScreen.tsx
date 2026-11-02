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
  getUnavailableChampionIds,
  isInSwapPhase,
  resolveViewerSide,
  SWAP_DURATION_SECONDS,
  TOURNAMENT_DRAFT_SEQUENCE,
  TURN_DURATION_SECONDS,
} from '../../lib/banpickMachine';
import { fetchLatestChampions } from '../../lib/ddragon';
import { saveBanPickScreenForStaff } from '../../lib/exportBanPickImage';
import { ViewerRole } from './RofsSelectionScreen';

interface BanPickDraftScreenProps {
  match: MatchState;
  viewerRole: ViewerRole;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onDispatchBanPick: (action: BanPickAction) => Promise<void> | void;
}

const ROLE_FILTERS: { label: string; tag: string }[] = [
  { label: '전체', tag: 'ALL' },
  { label: '전사', tag: 'Fighter' },
  { label: '마법사', tag: 'Mage' },
  { label: '암살자', tag: 'Assassin' },
  { label: '원거리 딜러', tag: 'Marksman' },
  { label: '탱커', tag: 'Tank' },
  { label: '서포터', tag: 'Support' },
];

const POSITION_LABELS = ['TOP', 'JGL', 'MID', 'BOT', 'SUP'];
const POSITION_KOR_NAMES = ['탑 (TOP)', '정글 (JGL)', '미드 (MID)', '원딜 (BOT)', '서포터 (SUP)'];

export default function BanPickDraftScreen({
  match,
  viewerRole,
  isSubmitting = false,
  errorMessage = null,
  onDispatchBanPick,
}: BanPickDraftScreenProps) {
  const [champions, setChampions] = useState<ChampionInfo[]>([]);
  const [ddragonVersion, setDdragonVersion] = useState<string>('');
  const [isLoadingChamps, setIsLoadingChamps] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    TURN_DURATION_SECONDS
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [isExportingImage, setIsExportingImage] = useState<boolean>(false);
  const [customDriveFolderInput, setCustomDriveFolderInput] = useState<string>(
    match.drive_folder_id ?? ''
  );

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

  const bp = match.banpick_state;
  const seriesState = useMemo(() => getSeriesState(match), [match]);
  const fearlessIds = useMemo(() => getFearlessChampionIds(match), [match]);
  const inSwapPhase = isInSwapPhase(match);
  const currentStep = useMemo(
    () => getCurrentTurnStep(bp, match),
    [bp, match]
  );
  const unavailableIds = useMemo(
    () => getUnavailableChampionIds(bp, match),
    [bp, match]
  );

  // 다음 세트 진행 시 누가 FIRST 팀을 맡을지 선택하는 상태
  const scheduledNextFirst =
    seriesState.game_first_teams[seriesState.current_game] ??
    (match.team_first_name === seriesState.team_a_name
      ? seriesState.team_b_name
      : seriesState.team_a_name);

  const [nextGameFirstTeam, setNextGameFirstTeam] =
    useState<string>(scheduledNextFirst);
  const [nextGameFearless, setNextGameFearless] = useState<boolean>(
    seriesState.fearless_enabled
  );

  useEffect(() => {
    setNextGameFirstTeam(scheduledNextFirst);
    setNextGameFearless(seriesState.fearless_enabled);
    autoSavedRef.current = false;
    swapTimeoutTriggeredRef.current = false;
  }, [seriesState.current_game, scheduledNextFirst, seriesState.fearless_enabled]);

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
  }, [match.status, bp?.current_turn_index]);

  const isAutoSaveOn = match.auto_save_enabled !== false;

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
        '자동 저장이 OFF 상태입니다. 필요 시 우측 버튼을 눌러 수동 저장하세요.'
      );
      return;
    }

    setIsExportingImage(true);

    saveBanPickScreenForStaff(match, championMap, {
      triggerBrowserDownload: viewerRole === 'OBSERVER',
      isManualRetry: false,
    })
      .then((res) => {
        if (res.ok) {
          if (res.driveUploaded) {
            setSavedNotice(
              `지정된 구글 드라이브 폴더에 밴픽 결과 사진(${res.fileName})이 자동 저장되었습니다!`
            );
          } else {
            setSavedNotice(
              `밴픽 결과 사진(${res.fileName})이 자동 생성되었습니다.`
            );
          }
        }
      })
      .finally(() => {
        setIsExportingImage(false);
      });
  }, [match, isLoadingChamps, championMap, viewerRole, isAutoSaveOn]);

  const handleManualExport = async () => {
    if (isExportingImage || championMap.size === 0) return;
    setIsExportingImage(true);
    try {
      const res = await saveBanPickScreenForStaff(match, championMap, {
        triggerBrowserDownload: true,
        isManualRetry: true,
        customFolderId: customDriveFolderInput.trim() || undefined,
      });
      if (res.ok) {
        setSavedNotice(
          res.driveUploaded
            ? `지정된 구글 드라이브 및 내 PC에 저장 완료: ${res.fileName}`
            : `내 PC에 밴픽 결과 이미지 저장 완료: ${res.fileName}`
        );
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
      } = latestTimerStateRef.current;

      if (!currentBp) return;

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

  // 4. 검색창(한글명/영문명) 및 역할군 필터링
  const filteredChampions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return champions.filter((champ) => {
      const matchesTag =
        selectedTag === 'ALL' || champ.tags.includes(selectedTag);
      if (!matchesTag) return false;
      if (!q) return true;
      return (
        champ.name.toLowerCase().includes(q) ||
        champ.id.toLowerCase().includes(q)
      );
    });
  }, [champions, searchQuery, selectedTag]);

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

  const isBlueFirstPick = match.pick_turn?.first_pick === blueTeamName;
  const isRedFirstPick = match.pick_turn?.first_pick === redTeamName;

  // 페이즈 한글 제목
  const renderPhaseTitle = () => {
    if (match.status === 'BANPICK_READY') {
      return '밴픽 준비 완료 (BANPICK READY)';
    }
    if (match.status === 'COMPLETED') {
      return '밴픽 및 라인 스왑 완료 (DRAFT COMPLETED)';
    }
    if (inSwapPhase) {
      return '최종 라인 스왑 페이즈 (60초) — 챔피언의 라인(TOP/JGL/MID/BOT/SUP)을 배치하세요';
    }
    if (!currentStep) {
      return '밴픽 완료';
    }
    const firstPickSideLabel = isRedFirstPick ? '레드 선픽' : '블루 선픽';
    switch (currentStep.phase) {
      case 'PHASE1_BAN':
        return `1차 밴 페이즈 (${firstPickSideLabel} 진영부터 교차 3밴)`;
      case 'PHASE1_PICK':
        return `1차 픽 페이즈 (${firstPickSideLabel} · 1 - 2 - 2 - 1)`;
      case 'PHASE2_BAN':
        return '2차 밴 페이즈 (후픽 진영부터 교차 2밴)';
      case 'PHASE2_PICK':
        return '2차 픽 페이즈 (1 - 2 - 1 · 후픽 진영 막픽)';
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
        className={`relative w-11 h-11 md:w-13 md:h-13 rounded-lg overflow-hidden border transition-all flex items-center justify-center bg-slate-900 ${
          isCurrentBanSlot
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
              className={`w-full h-full object-cover ${
                championId ? 'grayscale opacity-75' : 'opacity-90'
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
        className={`relative h-[76px] md:h-[82px] rounded-xl overflow-hidden border transition-all flex items-center ${
          isBlue ? 'flex-row' : 'flex-row-reverse text-right'
        } ${
          canSwapThisSide ? 'cursor-pointer hover:scale-[1.01]' : ''
        } ${
          isSwapSelected
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
              className={`absolute inset-0 bg-gradient-to-${
                isBlue ? 'r' : 'l'
              } from-slate-950 via-slate-950/70 to-transparent`}
            />
          </div>
        )}

        {/* 챔피언 정사각형 초상화 영역 */}
        <div
          className={`relative z-10 w-14 h-14 md:w-16 md:h-16 m-1.5 rounded-lg overflow-hidden border flex-shrink-0 flex items-center justify-center bg-slate-950 ${
            isSwapSelected
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
            className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${
              isBlue ? 'text-blue-400' : 'text-rose-400 justify-end'
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

          {canSwapThisSide ? (
            <div className="text-[11px] text-amber-300 font-semibold truncate">
              {isSwapSelected
                ? '바꿀 다른 라인 카드를 클릭하세요'
                : selectedSwapSlot !== null
                  ? `클릭하여 [${POSITION_LABELS[selectedSwapSlot]}] ↔ [${POSITION_LABELS[slotIndex]}] 라인 교체`
                  : '클릭하여 라인 위치 변경'}
            </div>
          ) : (
            champ && (
              <div className="text-xs text-slate-400 truncate">
                {champ.title}
              </div>
            )
          )}
        </div>
      </div>
    );
  };

  const maxTimerDuration = inSwapPhase
    ? SWAP_DURATION_SECONDS
    : TURN_DURATION_SECONDS;

  const timerProgressPercent = Math.min(
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
                FIRST 팀({match.team_first_name}) 우선 선택:{' '}
                <strong className="text-white">
                  {match.rofs_submissions.first_choice.category === 'SIDE'
                    ? `진영 (${match.rofs_submissions.first_choice.choice === 'BLUE' ? '블루' : '레드'})`
                    : `픽 순서 (${match.rofs_submissions.first_choice.choice === 'FIRST_PICK' ? '선픽' : '후픽'})`}
                </strong>
              </span>
              <span className="text-slate-600">→</span>
              <span>
                나머지 옵션 SECOND 팀({match.team_second_name}) 선택 적용:{' '}
                <strong className="text-cyan-300">
                  {match.rofs_submissions.first_choice.category === 'SIDE'
                    ? `픽 순서 (${match.rofs_submissions.second_choice.pickOrderChoice === 'FIRST_PICK' ? '선픽' : '후픽'})`
                    : `진영 (${match.rofs_submissions.second_choice.sideChoice === 'BLUE' ? '블루' : '레드'})`}
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
                  선픽 (First Pick)
                </span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  후픽 (Last Pick)
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

                    <div
                      className={`text-4xl font-black tabular-nums tracking-tight ${
                        remainingSeconds <= 10
                          ? 'text-rose-400 animate-pulse'
                          : 'text-white'
                      }`}
                    >
                      :{String(remainingSeconds).padStart(2, '0')}
                    </div>

                    {currentStep.side === 'RED' && (
                      <span className="text-rose-400 font-black text-lg animate-pulse">
                        RED TURN ▶
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-bold text-slate-200">
                    턴 {currentStep.turnIndex + 1} /{' '}
                    {TOURNAMENT_DRAFT_SEQUENCE.length} —{' '}
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
                      className={`h-full transition-all duration-200 ${
                        remainingSeconds <= 10
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
                  <div
                    className={`text-4xl font-black tabular-nums tracking-tight ${
                      remainingSeconds <= 10
                        ? 'text-rose-400 animate-pulse'
                        : 'text-amber-300'
                    }`}
                  >
                    :{String(remainingSeconds).padStart(2, '0')}
                  </div>
                  <span className="text-amber-400 font-black text-sm uppercase tracking-wider animate-pulse">
                    60s TIMER ▶
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
                    className={`h-full transition-all duration-200 ${
                      remainingSeconds <= 10 ? 'bg-rose-500' : 'bg-amber-400'
                    }`}
                    style={{ width: `${timerProgressPercent}%` }}
                  />
                </div>
              </>
            )}

            {match.status === 'COMPLETED' && (
              <div className="mt-2 flex flex-col items-center gap-2.5 w-full">
                <div className="px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-sm font-bold">
                  {seriesState.current_game}세트 밴픽 및 라인 배치가 완료되었습니다!
                </div>
                {savedNotice && (
                  <span className="text-xs text-amber-300 font-medium text-center">
                    ✓ {savedNotice}
                  </span>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2 w-full max-w-md">
                  <input
                    type="text"
                    value={customDriveFolderInput}
                    onChange={(e) => setCustomDriveFolderInput(e.target.value)}
                    placeholder="다른 구글 드라이브 폴더 링크/ID (비우면 기본 폴더)"
                    className="flex-1 min-w-[200px] rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={handleManualExport}
                    disabled={isExportingImage}
                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold text-slate-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {isExportingImage
                      ? '이미지 저장 중...'
                      : '구글 드라이브 & 내 PC 저장'}
                  </button>
                </div>

                {/* 다전제 / 추가 스크림 다음 세트(Game N+1) 설정 및 시작 컨트롤 */}
                <div className="w-full max-w-lg mt-1 rounded-xl bg-slate-950/90 border border-amber-500/40 p-3 space-y-2.5 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-300">
                      다음 세트 ({seriesState.current_game + 1}세트
                      {seriesState.total_games > 1
                        ? ` / 총 ${seriesState.total_games}세트`
                        : ' · 추가 세트'}
                      ) 진행 설정
                    </span>
                    <button
                      type="button"
                      onClick={() => setNextGameFearless((prev) => !prev)}
                      className={`px-2.5 py-0.5 rounded text-[11px] font-extrabold border transition-colors ${
                        nextGameFearless
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      🔥 하드 피어리스: {nextGameFearless ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setNextGameFirstTeam(seriesState.team_a_name)
                      }
                      className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border transition-all ${
                        nextGameFirstTeam === seriesState.team_a_name
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      FIRST: {seriesState.team_a_name} / SECOND:{' '}
                      {seriesState.team_b_name}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNextGameFirstTeam(seriesState.team_b_name)
                      }
                      className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border transition-all ${
                        nextGameFirstTeam === seriesState.team_b_name
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      FIRST: {seriesState.team_b_name} / SECOND:{' '}
                      {seriesState.team_a_name}
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      onDispatchBanPick({
                        type: 'START_NEXT_GAME',
                        nextFirstTeamName: nextGameFirstTeam,
                        fearlessEnabled: nextGameFearless,
                      })
                    }
                    className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-all disabled:opacity-50"
                  >
                    {seriesState.current_game + 1}세트 RoFS(진영/픽순서 선택) 시작하기 →
                  </button>
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
                  선픽 (First Pick)
                </span>
              ) : (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  후픽 (Last Pick)
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
                {[3, 4].map((idx) =>
                  renderBanSlot('RED', idx, bp.red_bans[idx])
                )}
                <div className="w-px h-8 bg-slate-700 mx-1" />
                {[0, 1, 2].map((idx) =>
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
        {/* 좌측: 블루 진영 5인 픽 슬롯 (간격 밀착) */}
        <section className="lg:col-span-3 flex flex-col justify-start gap-1.5">
          {[0, 1, 2, 3, 4].map((slotIdx) =>
            renderPickSlot(
              'BLUE',
              slotIdx,
              bp ? bp.blue_picks[slotIdx] : null
            )
          )}
        </section>

        {/* 중앙 영역: 챔피언 선택칸 및 60초 라인 스왑 보드 높이를 아래로 넉넉하게 확장 */}
        <section className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-[580px] md:h-[640px]">
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
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                          isSelected
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
                            <div className="text-[11px] text-slate-400">
                              {champ?.title}
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
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              isSelected
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
                      양 팀이 60초 동안 챔피언의 라인(TOP/JGL/MID/BOT/SUP)을 배치하고 있습니다.
                    </p>
                    <p className="text-xs text-slate-400">
                      60초 타이머가 종료되거나 양 팀이 모두 [라인 스왑 완료]를 누르면 최종 결과가 확정되고 운영진 화면에 자동 저장됩니다.
                    </p>
                  </div>
                )}
              </div>

              {/* 라인 스왑 하단 완료 버튼 */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-300">
                  {viewerSide ? (
                    isMySwapReady ? (
                      <span className="text-emerald-400 font-bold">
                        ✓ 우리 팀({viewerSide}) 라인 스왑 완료! 상대 팀 완료 또는 타이머 종료 시 최종 확정됩니다.
                      </span>
                    ) : (
                      <span>
                        라인 배치를 마쳤다면 우측{' '}
                        <strong className="text-amber-300">
                          [라인 스왑 완료 (확정)]
                        </strong>{' '}
                        버튼을 눌러주세요.
                      </span>
                    )
                  ) : (
                    <span className="text-slate-400">
                      관전 모드 — 양 팀의 실시간 라인 스왑이 좌/우 슬롯에 즉시 표시됩니다.
                    </span>
                  )}
                </div>

                {viewerSide && (
                  <button
                    type="button"
                    disabled={isMySwapReady || isSubmitting}
                    onClick={handleReadySwapPhase}
                    className="w-full sm:w-auto px-7 py-2.5 rounded-xl font-extrabold text-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isMySwapReady
                      ? '라인 스왑 확정됨'
                      : '라인 스왑 완료 (확정)'}
                  </button>
                )}
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
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="챔피언 검색 (예: 아리, 리 신, Ahri)..."
                      className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                      >
                        초기화
                      </button>
                    )}
                  </div>

                  {ddragonVersion && (
                    <span className="text-[11px] text-slate-400 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 self-end sm:self-auto">
                      Data Dragon v{ddragonVersion} ({champions.length}명)
                    </span>
                  )}
                </div>

                {/* 역할군 필터 탭 */}
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_FILTERS.map((role) => (
                    <button
                      key={role.tag}
                      type="button"
                      onClick={() => setSelectedTag(role.tag)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        selectedTag === role.tag
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>

                {/* 하드 피어리스(Hard Fearless) 이전 세트 누적 사용 금지 챔피언 표시 바 */}
                {seriesState.fearless_enabled && fearlessIds.size > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-extrabold text-rose-400 mr-1">
                      🔥 피어리스 금지 ({fearlessIds.size}):
                    </span>
                    {Array.from(fearlessIds).map((fId) => {
                      const fChamp = championMap.get(fId);
                      return (
                        <div
                          key={`fearless-ban-${fId}`}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/50 border border-rose-800/60 text-[10px] text-rose-200"
                          title={fChamp ? `${fChamp.name} (이전 세트 픽)` : fId}
                        >
                          {fChamp && (
                            <img
                              src={fChamp.imageUrl}
                              alt={fChamp.name}
                              className="w-4 h-4 rounded-sm object-cover grayscale"
                            />
                          )}
                          <span>{fChamp ? fChamp.name : fId}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                        className={`group flex flex-col items-center p-1.5 rounded-xl border transition-all ${
                          bp?.hovered_champion_id === 'NO_BAN'
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
                          className={`group relative flex flex-col items-center p-1.5 rounded-xl border transition-all ${
                            isHovered
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
                              className={`w-full h-full object-cover ${
                                isUnavailable ? 'grayscale' : ''
                              }`}
                            />
                            {isUnavailable && (
                              <div className="absolute inset-0 bg-slate-950/75 flex items-center justify-center">
                                <span
                                  className={`text-[10px] font-black uppercase ${
                                    isFearlessBanned
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
                          <span className="text-amber-300 font-semibold">
                            우리 팀({viewerSide})의{' '}
                            {currentStep.actionType === 'BAN'
                              ? '밴(BAN) 차례입니다! 챔피언을 선택해주세요.'
                              : '픽(PICK) 차례입니다! 아무것도 선택하지 않으면 랜덤 픽으로 결정됩니다.'}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">
                          현재{' '}
                          <strong className="text-white">
                            {currentStep.side === 'BLUE'
                              ? `${blueTeamName} (BLUE)`
                              : `${redTeamName} (RED)`}
                          </strong>{' '}
                          팀이 {currentStep.label}을 진행하고 있습니다...
                        </span>
                      )
                    ) : match.status === 'COMPLETED' ? (
                      <span className="text-emerald-400 font-bold">
                        20턴 토너먼트 드래프트 및 라인 스왑이 모두 완료되었습니다.
                      </span>
                    ) : (
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
                    className={`w-full sm:w-auto px-7 py-2.5 rounded-xl font-extrabold text-sm transition-all ${
                      currentStep?.actionType === 'BAN'
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

        {/* 우측: 레드 진영 5인 픽 슬롯 (간격 밀착) */}
        <section className="lg:col-span-3 flex flex-col justify-start gap-1.5">
          {[0, 1, 2, 3, 4].map((slotIdx) =>
            renderPickSlot('RED', slotIdx, bp ? bp.red_picks[slotIdx] : null)
          )}
        </section>
      </main>
    </div>
  );
}
