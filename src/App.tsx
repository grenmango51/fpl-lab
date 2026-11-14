import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type CSSProperties,
} from "react";
import { teamPoints } from "./scoring";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Database,
  Info,
  LayoutGrid,
  LockKeyhole,
  Ban,
  ArrowLeft,
  ArrowLeftRight,
  Link2,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  Player,
  Plan,
  Week,
  Chip,
  Evaluation,
  PlayerDetail,
  SolveResult,
  Prospective,
  SensitivityJob,
  MinutesSchedule,
  StatSchedule,
} from "./types";
import {
  api,
  chipNames,
  download,
  fmt,
  money,
  optimalLineup,
  projectionCSV,
  planFromSquad,
  uid,
  xp,
} from "./lib";
import {
  Badge,
  Busy,
  Empty,
  LineChart,
  Logo,
  Modal,
  Pitch,
  PlayerName,
  PlayerRow,
  Shirt,
  Stat,
} from "./components";
import {
  AnalysisView,
  FixturesView,
  MarketView,
  OptimiseView,
  ProjectionsView,
} from "./Views";
import type { SolverSettings } from "./Views";
import DataRefreshSettings, {
  type DataRefreshStatus,
} from "./DataRefreshSettings";
import { SensitivityView } from "./SensitivityView";
import { MinutesScenarioEditor } from "./MinutesScenarioEditor";
import { ReferenceView } from "./ReferenceView";
import { PlannerBoard } from "./PlannerBoard";
import { PlayerSurface } from "./PlayerSurface";
import { PlanTree } from "./PlanTree";
import { TeamOverview } from "./TeamOverview";
import { StatScenarioEditor } from "./StatScenarioEditor";
import { ChipPlanner } from "./ChipPlanner";
import { FixtureMarkets } from "./FixtureMarkets";
import { ChipStrategyView, type ChipStrategyJob } from "./ChipStrategyView";
import { MarketMovement } from "./MarketMovement";
import { TransferPanel } from "./TransferPanel";
import { LineupImageDialog } from "./LineupImageDialog";
import { WorkspaceDivider } from "./WorkspaceDivider";
import { TabStrip } from "./TabStrip";
import { useViewState } from "./useViewState";
import { canSwap, replacePlayer } from "./plannerInteractions";
import { planWithOptimisedSuffix, quickSolveHorizon } from "./quickOptimise";
import {
  activePlanGW,
  createPlanExport,
  defaultSolverSettings,
  loadPlanningState,
  needsPlanReconciliation,
  PlanningRestoreError,
  PlanResourceError,
  reconcilePlanResources,
  sameResourcePrices,
  sanitizeSolverSettings,
  planValidationRequest,
  preparePlanImport,
  solverSettingsForHorizon,
} from "./planningPersistence";
import type {
  TeamStrengthsSchedule,
  ForecastConfiguration,
} from "./planningPersistence";
import { SharedWorkspace, type SaveStatus, type SharedDocument } from "./sharedWorkspace";
export { restorePlanningState } from "./planningPersistence";
const SeasonData = lazy(() =>
  import("./SeasonData").then((module) => ({ default: module.SeasonData })),
);

type Tab =
  | "lineup"
  | "projections"
  | "optimise"
  | "fixtures"
  | "analysis"
  | "market"
  | "data";
const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "lineup", label: "Lineup", icon: Users },
  { id: "projections", label: "Projections", icon: LayoutGrid },
  { id: "optimise", label: "Optimise", icon: Sparkles },
  { id: "analysis", label: "Plans", icon: Activity },
  { id: "fixtures", label: "Fixtures", icon: CalendarDays },
  { id: "market", label: "Market", icon: TrendingUp },
  { id: "data", label: "Data", icon: Database },
];
async function forecastBaseline(refresh = false) {
  // Refresh the official inputs before reading their editable fixture catalog.
  const refreshed = refresh ? await api<Bootstrap>("/refresh", {}) : null;
  const [forecast, catalog] = await Promise.all([
    refreshed ? Promise.resolve(refreshed) : api<Bootstrap>("/bootstrap"),
    api<{ fixtures: NonNullable<Bootstrap["official_fixture_catalog"]> }>(
      "/fixture-schedule",
    ).catch(() => null),
  ]);
  return catalog
    ? { ...forecast, official_fixture_catalog: catalog.fixtures }
    : forecast;
}
const storageKey = "open-fpl-plans-v1";
type PlanOperation = { id: string; name: string; gw: number | null };
function locationTab(): Tab {
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "plans"
    ? "analysis"
    : tabs.some((tab) => tab.id === value)
      ? (value as Tab)
      : "lineup";
}
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

type OptimiseContext = {
  fresh: boolean;
  startGW: number;
  sourcePlan: Plan | null;
  prefix: Week[];
  baselinePlan: Plan | null;
  prices: Record<string, number>;
};

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState<Tab>(locationTab);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadStage, setLoadStage] = useState("Connecting saved plans…");
  const [loadSlow, setLoadSlow] = useState(false);
  const [resourceError, setResourceErrorState] = useState("");
  const resourceErrorRef = useRef("");
  function setResourceError(error: string) {
    resourceErrorRef.current = error;
    setResourceErrorState(error);
  }
  const [forecastRetry, setForecastRetry] = useState(0);
  const forecastRetryRef = useRef(0);
  // Forecast reads have their own generation; they never own operation busy.
  const [forecastUpdate, setForecastUpdate] = useState<{
    request: number;
    configuration: string;
    error: string;
  } | null>(null);
  const [marketMode, setMarketMode] = useViewState(
    "market.section",
    "fixtures",
  );
  const [settingsTab, setSettingsTab] = useViewState(
    "settings.section",
    "inputs",
  );
  const [backupText, setBackupText] = useState("");
  const [importText, setImportText] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const sharedRef = useRef<SharedWorkspace | null>(null);
  if (!sharedRef.current) sharedRef.current = new SharedWorkspace(setSaveStatus);
  const [plans, setPlans] = useState<Plan[]>(() =>
      stored<Plan[]>(storageKey, []),
    ),
    [activeId, setActiveId] = useState(() =>
      stored<string>("open-fpl-active", ""),
    ),
    [gw, setGw] = useState(0),
    [watch, setWatch] = useState<number[]>(() => stored("open-fpl-watch", []));
  const [fixtureMoves, setFixtureMoves] = useState<
    Record<string, number | null>
  >(() => stored("open-fpl-fixture-moves", {}));
  const [teamStrengths, setTeamStrengths] = useState<TeamStrengthsSchedule>(
    () => stored("open-fpl-team-strengths", {}),
  );
  const [overrides, setOverrides] = useState<Record<string, number>>(() =>
      stored("open-fpl-minutes", {}),
    ),
    [useMarket, setUseMarket] = useState(() => stored("open-fpl-market", true)),
    [useProvider, setUseProvider] = useState(() =>
      stored("open-fpl-provider", true),
    ),
    [useSolio, setUseSolio] = useState(() => stored("open-fpl-solio", true)),
    [providerWeight, setProviderWeight] = useState(() =>
      stored("open-fpl-provider-weight", 0.5),
    ),
    [extrapolate, setExtrapolate] = useState(() =>
      stored("open-fpl-extrapolate", true),
    ),
    [anchorHalfLife, setAnchorHalfLife] = useState(() =>
      stored("open-fpl-anchor-half-life", 6),
    ),
    [customPoints, setCustomPoints] = useState<
      Record<string, Record<string, number>>
    >(() => stored("open-fpl-custom", {})),
    [blendWeight, setBlendWeight] = useState(() => stored("open-fpl-blend", 0)),
    [customName, setCustomName] = useState(() =>
      stored("open-fpl-custom-name", ""),
    );
  const [minutesSchedule, setMinutesSchedule] = useState<MinutesSchedule>(() =>
    stored("open-fpl-minutes-schedule", {}),
  );
  const [statSchedule, setStatSchedule] = useState<StatSchedule>(() =>
    stored("open-fpl-stat-schedule", {}),
  );
  const [detailTab, setDetailTab] = useState("transfer");
  const [detailGW, setDetailGW] = useState(0);
  const [detailBack, setDetailBack] = useState<number | null>(null);
  const [detailAnchor, setDetailAnchor] = useState<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(false);
  const [detailInline, setDetailInline] = useState(false);
  const [projectionEditorTarget, setProjectionEditorTarget] =
    useState<HTMLDivElement | null>(null);
  const [pitchExpanded, setPitchExpanded] = useState(false);
  const [wideLayout, setWideLayout] = useState(
    () => window.matchMedia("(min-width: 701px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 701px)");
    const changed = () => setWideLayout(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const [loadRecovery, setLoadRecovery] = useState<unknown>(null);
  const [planHistory, setPlanHistory] = useState<
    Record<string, { past: Plan[]; future: Plan[] }>
  >({});
  const [deletedPlans, setDeletedPlans] = useState<Plan[]>(() =>
    stored("open-fpl-deleted-plans-v1", []),
  );
  const [treeHidden, setTreeHidden] = useState(false);
  const scrollPositions = useRef<Record<string, number>>({});
  const scrollKey = `${tab}:${marketMode}:${gw}:${activeId}`;
  const [split, setSplit] = useState(() => stored("open-fpl-panel-split", 50));
  const [previewingDraft, setPreviewingDraft] = useState(false);
  const [draftGW, setDraftGW] = useState(0);
  const [modal, setModal] = useState<
      "team" | "resources" | "settings" | "csv" | "help" | "lineupImage" | null
    >(null),
    [detailId, setDetailId] = useState<number | null>(null),
    [detail, setDetail] = useState<PlayerDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null),
    [playerQuery, setPlayerQuery] = useState(""),
    [listMode, setListMode] = useState<"targets" | "captains" | "watch">(
      "targets",
    ),
    [busyStatus, setBusyStatus] = useState<{
      message: string;
      origin?: PlanOperation;
    }>({ message: "" }),
    [toast, setToast] = useState<{
      text: string;
      error?: boolean;
      origin?: PlanOperation;
      action?: { label: string; run: () => void };
    } | null>(null),
    [evalData, setEvalData] = useState<Evaluation | null>(null),
    [prospective, setProspective] = useState<Prospective | null>(null);
  const busy = busyStatus.message;
  function setBusy(message: string, origin?: PlanOperation) {
    setBusyStatus({ message, origin });
  }
  const [teamId, setTeamId] = useState("2200722"),
    [teamBank, setTeamBank] = useState(0),
    [teamFT, setTeamFT] = useState(1),
    [csvError, setCsvError] = useState(""),
    [csvWeight, setCsvWeight] = useState(50);
  const [settings, setSettings] = useState<SolverSettings>(() =>
      stored("open-fpl-solver", defaultSolverSettings),
    ),
    [solveResult, setSolveResult] = useState<SolveResult | null>(null),
    [solveContext, setSolveContext] = useState<OptimiseContext | null>(null);
  const initRef = useRef<Bootstrap | null>(null),
    analyticsRef = useRef<HTMLDivElement>(null),
    urlSyncedRef = useRef(false),
    popstateReplaceRef = useRef(false),
    dataRequestRef = useRef(0),
    loadedForecastArgsRef = useRef(""),
    solveRequestRef = useRef(0),
    solveInFlightRef = useRef(false),
    operationRef = useRef<symbol | null>(null),
    operationVersionRef = useRef(0),
    fileRef = useRef<HTMLInputElement>(null);
  const renderedOperationVersion = operationVersionRef.current;
  // Toast actions outlive the render that created them; enter through the
  // latest handler so the ownership/version guard checks current state.
  const restoreDeletedRef = useRef(restoreDeleted);
  restoreDeletedRef.current = restoreDeleted;
  const notify = (text: string, error = false, origin?: PlanOperation) =>
    setToast({ text, error, ...(origin ? { origin } : {}) });
  const forecastArgs: ForecastConfiguration = {
    overrides,
    minutes_schedule: minutesSchedule,
    stat_schedule: statSchedule,
    team_strengths: teamStrengths,
    fixture_moves: fixtureMoves,
    use_market: useMarket,
    custom_points: customPoints,
    blend_weight: blendWeight,
    use_provider: useProvider,
    use_solio: useSolio,
    provider_weight: providerWeight,
    extrapolate,
    anchor_half_life: anchorHalfLife,
    custom_name: customName || "Imported CSV",
  };
  const active = plans.find((p) => p.id === activeId) ?? plans[0] ?? null;
  const livePlanningRef = useRef({
    plans,
    data,
    forecastArgs,
    activeId,
    settings,
    gw,
    busy,
    watch,
    renderedOperationVersion,
  });
  livePlanningRef.current = {
    plans,
    data,
    forecastArgs,
    activeId,
    settings,
    gw,
    busy,
    watch,
    renderedOperationVersion,
  };
  // Navigation changes this identity; busy and accepted-plan renders do not.
  const transferView = useMemo(
    () => ({}),
    [activeId, gw, tab, detailId, detailGW, detailInline, modal],
  );
  const liveTransferViewRef = useRef(transferView);
  liveTransferViewRef.current = transferView;
  const feedbackSurfaceRef = useRef<{ gw: number; readOnly: boolean } | null>(null);
  feedbackSurfaceRef.current = detailId === null ? null
    : { gw: detailGW || gw, readOnly: detailReadOnly };
  const planBusyLabel = busyStatus.origin
    ? planMessage(busy, busyStatus.origin) : busy;
  const planToastText = toast?.origin
    ? planMessage(toast.text, toast.origin) : toast?.text;
  const week = active?.weeks.find((w) => w.gw === gw) ?? null;
  const lookup = useMemo(
    () => new Map(data?.players.map((p) => [p.id, p]) ?? []),
    [data],
  );
  const selectedPlayer =
    selected === null || !week?.squad.includes(selected)
      ? null
      : (lookup.get(selected) ?? null);
  const detailPlayer = detailId === null ? null : lookup.get(detailId);
  const playerGW = detailGW || gw;
  const detailWeek = detailReadOnly
    ? undefined
    : active?.weeks.find((row) => row.gw === playerGW);
  const detailSquad = detailWeek?.squad.includes(detailId ?? 0) ?? false;
  const currentHorizon = active?.weeks ?? [];

  function rescorePlans(current: Plan[], forecast: Bootstrap) {
    const latest = new Map(forecast.players.map((p) => [p.id, p]));
    return current.map((p) => ({
      ...p,
      weeks: p.weeks.map((w) => {
        if (!forecast.gameweeks.includes(w.gw)) return w;
        const score = teamPoints(w.starters, w.bench, w.captain, w.vice,
          latest, w.gw, w.chip);
        return { ...w, ...score, net_points: score.points - w.hits };
      }),
    }));
  }
  function adoptForecast(forecast: Bootstrap, nextPlans?: (current: Plan[]) => Plan[]) {
    // React batches these updates in the same commit. Score the latest plans,
    // not the decisions captured when the forecast request started.
    setData(forecast);
    setPlans((current) => rescorePlans(nextPlans ? nextPlans(current) : current, forecast));
    setPlanHistory((current) => {
      let changed = false;
      const filtered: Record<string, { past: Plan[]; future: Plan[] }> = {};
      for (const [id, entry] of Object.entries(current)) {
        const past = entry.past.filter((plan) =>
          plan.weeks.every((w) => w.gw >= forecast.next_gw),
        );
        const future = entry.future.filter((plan) =>
          plan.weeks.every((w) => w.gw >= forecast.next_gw),
        );
        if (
          past.length !== entry.past.length ||
          future.length !== entry.future.length
        )
          changed = true;
        if (past.length || future.length) filtered[id] = { past, future };
        else if (entry.past.length || entry.future.length) changed = true;
      }
      return changed ? filtered : current;
    });
  }
  function forecastStatus() {
    const configuration = JSON.stringify(forecastArgs);
    const update = forecastUpdate?.configuration === configuration &&
      forecastUpdate.request === dataRequestRef.current ? forecastUpdate : null;
    const stale = !!resourceError || loadedForecastArgsRef.current !== configuration || !!update;
    const error = resourceError || update?.error || "";
    return { stale, pending: stale && !error, error };
  }
  function retryForecasts() {
    if (resourceErrorRef.current) {
      void refresh();
      return;
    }
    const request = ++dataRequestRef.current;
    setForecastUpdate({ request, configuration: JSON.stringify(livePlanningRef.current.forecastArgs), error: "" });
    setForecastRetry((attempt) => attempt + 1);
  }
  function retryLoading() {
    ++dataRequestRef.current;
    setLoadError("");
    setLoadRecovery(null);
    setLoading(true);
    setLoadSlow(false);
    setLoadStage("Connecting saved plans…");
    setLoadAttempt((attempt) => attempt + 1);
  }

  function applyForecastConfiguration(configuration: ForecastConfiguration) {
    setOverrides(configuration.overrides);
    setMinutesSchedule(configuration.minutes_schedule);
    setStatSchedule(configuration.stat_schedule);
    setTeamStrengths(configuration.team_strengths);
    setFixtureMoves(configuration.fixture_moves);
    setUseMarket(configuration.use_market);
    setCustomPoints(configuration.custom_points);
    setBlendWeight(configuration.blend_weight);
    setUseProvider(configuration.use_provider);
    setUseSolio(configuration.use_solio);
    setProviderWeight(configuration.provider_weight);
    setExtrapolate(configuration.extrapolate);
    setAnchorHalfLife(configuration.anchor_half_life);
    setCustomName(configuration.custom_name);
  }
  function archivePlanningInputs(savedPlans: unknown, configuration: unknown) {
    try {
      const archives = stored<unknown[]>("open-fpl-archived-plans-v1", []);
      localStorage.setItem(
        "open-fpl-archived-plans-v1",
        JSON.stringify(
          [
            ...(Array.isArray(archives) ? archives : []),
            {
              archived_at: new Date().toISOString(),
              plans: savedPlans,
              configuration,
            },
          ].slice(-20),
        ),
      );
    } catch {
      // Archival is best-effort; storage quota limits must not block forecast adoption.
    }
  }

  function sharedDocument(): SharedDocument {
    return { version: 1, plans, configuration: forecastArgs, solver_settings: settings, active_id: activeId, watch };
  }

  async function adoptShared(document: SharedDocument, current: () => boolean) {
    const fingerprint = () => { const { data: _data, ...state } = livePlanningRef.current; return JSON.stringify(state); };
    const before = fingerprint();
    const version = operationVersionRef.current;
    if (!data || !canStartOperation()) return false;
    let restored;
    try {
      restored = await loadPlanningState(document.plans, document.active_id, document.configuration,
      document.solver_settings, configuration => configuration === undefined
        ? forecastBaseline() : api<Bootstrap>("/projections", configuration),
      body => api("/plan/validate", body));
    } catch (error) {
      if (error instanceof PlanningRestoreError && current() &&
          !operationRef.current && version === operationVersionRef.current && fingerprint() === before)
        setResourceError(error.message);
      throw error;
    }
    if (
      !current() ||
      operationRef.current ||
      version !== operationVersionRef.current ||
      fingerprint() !== before
    ) return false;
    archivePlanningInputs(livePlanningRef.current.plans, livePlanningRef.current.forecastArgs);
    ++operationVersionRef.current;
    ++dataRequestRef.current;
    loadedForecastArgsRef.current = JSON.stringify(restored.configuration);
    applyForecastConfiguration(restored.configuration);
    setSettings(restored.solver);
    setResourceError("");
    adoptForecast(restored.forecast, () => restored.plans);
    const context = livePlanningRef.current;
    const selectedPlan = restored.plans.find(plan => plan.id === context.activeId);
    const selectedId = selectedPlan?.id ?? restored.activeId;
    const adoptedActive = selectedPlan ?? restored.plans.find(plan => plan.id === selectedId) ?? restored.plans[0];
    setActiveId(selectedId);
    const nextGW = activePlanGW(restored.plans, selectedId, restored.forecast);
    if (
      !restored.forecast.gameweeks.includes(context.gw) ||
      (["lineup", "optimise"].includes(locationTab()) &&
        adoptedActive &&
        !adoptedActive.weeks.some((week) => week.gw === context.gw))
    ) {
      setGw(nextGW);
      setSelected(null);
    }
    setDetailGW((currentGW) =>
      currentGW && !restored.forecast.gameweeks.includes(currentGW)
        ? nextGW
        : currentGW,
    );
    setWatch(document.watch);
    setSolveResult(null);
    setSolveContext(null);
    setPlanHistory({});
    return true;
  }
  const adoptSharedRef = useRef(adoptShared);
  adoptSharedRef.current = adoptShared;

  useEffect(() => {
    let alive = true;
    const request = ++dataRequestRef.current;
    const current = () => alive && request === dataRequestRef.current;
    const slowTimer = setTimeout(() => {
      if (current()) setLoadSlow(true);
    }, 8000);
    sharedRef.current!.initialize(sharedDocument(), current).then(document => {
      if (!current()) throw new Error("Workspace loading cancelled.");
      if (plans.length && JSON.stringify(document.plans) !== JSON.stringify(plans)) {
        archivePlanningInputs(plans, forecastArgs);
      }
      return loadPlanningState(
      document.plans,
      document.active_id,
      document.configuration,
      document.solver_settings,
      (configuration) => {
        if (!current()) throw new Error("Workspace loading cancelled.");
        setLoadStage(configuration === undefined
          ? "Loading current player pool…" : "Applying saved assumptions…");
        return configuration === undefined
          ? forecastBaseline()
          : api<Bootstrap>("/projections", configuration);
      },
      body => api("/plan/validate", body),
    ).then(restored => ({ ...restored, watch: document.watch, sourcePlans: document.plans, sourceConfiguration: document.configuration })); })
      .then((restored) => {
        if (!current()) return;
        if (
          restored.notices.length ||
          (Array.isArray(restored.sourcePlans) &&
            restored.sourcePlans.some(
              (plan) =>
                plan &&
                Array.isArray(plan.weeks) &&
                plan.weeks.some((week) => week.gw < restored.forecast.next_gw),
            ))
        ) {
          archivePlanningInputs(restored.sourcePlans, restored.sourceConfiguration);
        }
        loadedForecastArgsRef.current = JSON.stringify(restored.configuration);
        applyForecastConfiguration(restored.configuration);
        setSettings(restored.solver);
        setWatch(restored.watch);
        setResourceError("");
        adoptForecast(restored.forecast, () => restored.plans);
        const params = new URLSearchParams(window.location.search);
        const requestedPlan = restored.plans.find(
          (plan) => plan.id === params.get("plan"),
        );
        const selectedPlan =
          requestedPlan ??
          restored.plans.find((plan) => plan.id === restored.activeId);
        const requestedGW = Number(params.get("gw"));
        setGw(
          restored.forecast.gameweeks.includes(requestedGW) &&
            (!["lineup", "optimise"].includes(locationTab()) ||
              selectedPlan?.weeks.some((week) => week.gw === requestedGW))
            ? requestedGW
            : (requestedPlan?.weeks[0]?.gw ?? restored.gw),
        );
        setActiveId(requestedPlan?.id ?? restored.activeId);
        clearTimeout(slowTimer);
        setLoading(false);
        if (restored.notices.length) notify(restored.notices.join(" "));
      })
      .catch((e) => {
        if (current()) {
          clearTimeout(slowTimer);
          if (e instanceof PlanningRestoreError) setLoadRecovery(e.recovery);
          setLoadError(e.message);
          setLoading(false);
        }
      });
    api<Evaluation>("/evaluation")
      .then((d) => {
        if (alive) setEvalData(d);
      })
      .catch(() => {});
    api<Prospective>("/prospective")
      .then((d) => {
        if (alive) setProspective(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(slowTimer);
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!loading && data) sharedRef.current!.queue(sharedDocument());
  }, [loading, plans, activeId, watch, settings, JSON.stringify(forecastArgs)]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "visible") {
        void sharedRef.current!.pull((document, current) => adoptSharedRef.current(document, current));
      } else {
        void sharedRef.current!.flush();
      }
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(plans));
  }, [plans]);
  useEffect(() => {
    if (active)
      localStorage.setItem("open-fpl-active", JSON.stringify(active.id));
  }, [active?.id]);
  useEffect(() => {
    localStorage.setItem("open-fpl-watch", JSON.stringify(watch));
  }, [watch]);
  useEffect(() => {
    localStorage.setItem(
      "open-fpl-team-strengths",
      JSON.stringify(teamStrengths),
    );
    localStorage.setItem(
      "open-fpl-fixture-moves",
      JSON.stringify(fixtureMoves),
    );
    localStorage.setItem("open-fpl-minutes", JSON.stringify(overrides));
    localStorage.setItem(
      "open-fpl-minutes-schedule",
      JSON.stringify(minutesSchedule),
    );
    localStorage.setItem(
      "open-fpl-stat-schedule",
      JSON.stringify(statSchedule),
    );
    localStorage.setItem("open-fpl-custom", JSON.stringify(customPoints));
    localStorage.setItem("open-fpl-blend", JSON.stringify(blendWeight));
    localStorage.setItem("open-fpl-custom-name", JSON.stringify(customName));
    localStorage.setItem("open-fpl-provider", JSON.stringify(useProvider));
    localStorage.setItem("open-fpl-solio", JSON.stringify(useSolio));
    localStorage.setItem("open-fpl-market", JSON.stringify(useMarket));
    localStorage.setItem(
      "open-fpl-provider-weight",
      JSON.stringify(providerWeight),
    );
    localStorage.setItem("open-fpl-extrapolate", JSON.stringify(extrapolate));
    localStorage.setItem(
      "open-fpl-anchor-half-life",
      JSON.stringify(anchorHalfLife),
    );
  }, [
    overrides,
    minutesSchedule,
    statSchedule,
    teamStrengths,
    fixtureMoves,
    useMarket,
    customPoints,
    blendWeight,
    customName,
    useProvider,
    useSolio,
    providerWeight,
    extrapolate,
    anchorHalfLife,
  ]);
  useEffect(() => {
    localStorage.setItem("open-fpl-solver", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    let alive = true;
    let checking = false;
    async function check() {
      const current = livePlanningRef.current;
      if (
        checking || !current.data || operationRef.current || solveInFlightRef.current ||
        current.renderedOperationVersion !== operationVersionRef.current ||
        loadedForecastArgsRef.current !== JSON.stringify(current.forecastArgs)
      ) return;
      checking = true;
      const version = operationVersionRef.current;
      const unchanged = () => {
        const latest = livePlanningRef.current;
        return alive && !operationRef.current &&
          version === operationVersionRef.current &&
          latest.data === current.data &&
          latest.plans === current.plans && latest.activeId === current.activeId &&
          latest.settings === current.settings && latest.gw === current.gw &&
          JSON.stringify(latest.forecastArgs) === JSON.stringify(current.forecastArgs);
      };
      let request: number | undefined;
      try {
        const status = await api<DataRefreshStatus>("/data-refresh");
        if (
          !unchanged() ||
          !status.loaded_at ||
          Date.parse(status.loaded_at) <= Date.parse(current.data.loaded_at)
        )
          return;
        request = ++dataRequestRef.current;
        const restored = await loadPlanningState(
          current.plans,
          current.activeId,
          current.forecastArgs,
          current.settings,
          (configuration) =>
            configuration === undefined
              ? forecastBaseline()
              : api<Bootstrap>("/projections", configuration),
          body => api("/plan/validate", body),
        );
        if (request !== dataRequestRef.current || !unchanged())
          return;
        if (
          restored.notices.length ||
          current.plans.some((plan) =>
            plan.weeks.some((week) => week.gw < restored.forecast.next_gw),
          )
        )
          archivePlanningInputs(current.plans, current.forecastArgs);
        ++operationVersionRef.current;
        loadedForecastArgsRef.current = JSON.stringify(restored.configuration);
        applyForecastConfiguration(restored.configuration);
        setSettings(restored.solver);
        setResourceError("");
        adoptForecast(restored.forecast, () => restored.plans);
        setActiveId(restored.activeId);
        if (!restored.forecast.gameweeks.includes(current.gw)) {
          setGw(restored.gw);
          setSelected(null);
        }
        setDetailGW((currentGW) =>
          currentGW && !restored.forecast.gameweeks.includes(currentGW)
            ? restored.gw
            : currentGW,
        );
        setSolveResult(null);
        setSolveContext(null);
        if (restored.notices.length) notify(restored.notices.join(" "));
      } catch (error) {
        if (error instanceof PlanningRestoreError && request === dataRequestRef.current && unchanged())
          setResourceError(error.message);
        // Background failures retain the current plan. Sources/settings show
        // server failures; the next poll retries without interrupting editing.
      } finally {
        checking = false;
      }
    }
    const timer = window.setInterval(() => void check(), 60_000);
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 12000 : 5500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (week && selected !== null && !week.squad.includes(selected))
      setSelected(null);
  }, [week, selected]);
  useEffect(() => {
    if (!solveResult && detailReadOnly) setDetailReadOnly(false);
  }, [solveResult, detailReadOnly]);
  useEffect(() => {
    if (!data) return;
    if (detailId !== null && !lookup.has(detailId)) {
      setDetailId(null);
      setDetailBack(null);
    } else if (detailBack !== null && !lookup.has(detailBack)) {
      setDetailBack(null);
    }
  }, [data, lookup, detailId, detailBack]);
  useEffect(() => {
    // Retry after other work settles, but only retry a failed initial solve
    // when new data arrives (for example, after Refresh).
    if (!data || plans.length || initRef.current === data) return;
    const operation = beginOperation("Building a legal £100m starting squad…");
    if (!operation) return;
    initRef.current = data;
    api<SolveResult>("/optimise", {
      ...forecastArgs,
      start_gw: data.next_gw,
      horizon: 1,
      seconds: 8,
      budget: 100,
    })
      .then(async (r) => {
        const p = planFromSquad(
          r.weeks[0].squad,
          data.players,
          data.gameweeks,
          r.weeks[0].bank,
          1,
          "My first plan",
        );
        const valid = await validatedPlan(p, operation);
        assertPlanInputs(operation);
        setPlans([valid]);
        setActiveId(valid.id);
      })
      .catch((e) => {
        if (operationRef.current === operation) notify(e.message, true);
      })
      .finally(() => finishOperation(operation));
  }, [data, plans.length, busy]);
  useEffect(() => {
    if (!data) return;
    const serialized = JSON.stringify(forecastArgs);
    const retry = forecastRetry !== forecastRetryRef.current;
    forecastRetryRef.current = forecastRetry;
    // Reverting to the loaded configuration must also invalidate a pending load.
    const request = ++dataRequestRef.current;
    if (loadedForecastArgsRef.current === serialized && !retry) {
      setForecastUpdate(null);
      return;
    }
    const current = () =>
      request === dataRequestRef.current &&
      JSON.stringify(livePlanningRef.current.forecastArgs) === serialized;
    setForecastUpdate({ request, configuration: serialized, error: "" });
    let reconcilingData: Bootstrap | null = null;
    api<Bootstrap>("/projections", forecastArgs)
      .then(async (d) => {
        if (!current()) return;
        const previous = livePlanningRef.current;
        const nextForecast = previous.data?.official_fixture_catalog
          ? {
              ...d,
              official_fixture_catalog:
                previous.data.next_gw === d.next_gw
                  ? previous.data.official_fixture_catalog
                  : previous.data.official_fixture_catalog.filter(
                      (fixture) =>
                        fixture.event === null ||
                        fixture.event === undefined ||
                        fixture.event >= d.next_gw,
                    ),
            }
          : d;
        let reconciled: Plan[] | undefined;
        const notices: string[] = [];
        if (
          previous.data &&
          previous.plans.length > 0 &&
          (needsPlanReconciliation(
            previous.data,
            nextForecast,
            previous.plans,
          ) ||
            Boolean(resourceErrorRef.current))
        ) {
          if (operationRef.current) throw new Error("Plan update in progress. Retry forecasts after it finishes.");
          const version = operationVersionRef.current;
          reconcilingData = previous.data;
          reconciled = await reconcilePlanResources(
            previous.plans,
            nextForecast,
            forecastArgs,
            (body) => api("/plan/validate", body),
            notices,
          );
          if (!current()) return;
          if (operationRef.current || version !== operationVersionRef.current ||
              livePlanningRef.current.plans !== previous.plans ||
              livePlanningRef.current.data !== previous.data)
            throw new Error("Plans changed during price validation. Retry forecasts.");
          ++operationVersionRef.current;
        }
        if (current()) {
          if (
            reconciled &&
            (notices.length ||
              previous.plans.some((plan) =>
                plan.weeks.some((week) => week.gw < nextForecast.next_gw),
              ))
          ) {
            archivePlanningInputs(previous.plans, forecastArgs);
          }
          loadedForecastArgsRef.current = serialized;
          if (reconciled || !previous.plans.length) {
            setResourceError("");
          }
          if (
            reconciled ||
            (previous.data && previous.data.next_gw !== nextForecast.next_gw)
          ) {
            setSettings((currentSettings) =>
              sanitizeSolverSettings(currentSettings, nextForecast),
            );
            setSolveResult(null);
            setSolveContext(null);
          }
          adoptForecast(
            nextForecast,
            reconciled
              ? (latest) =>
                  reconciled!.map((plan) => ({
                    ...plan,
                    name:
                      latest.find((entry) => entry.id === plan.id)?.name ??
                      plan.name,
                  }))
              : undefined,
          );
          const context = livePlanningRef.current;
          const adoptedPlans = reconciled ?? context.plans;
          const nextGW = activePlanGW(
            adoptedPlans,
            context.activeId,
            nextForecast,
          );
          if (
            context.gw < nextForecast.next_gw ||
            (reconciled && !nextForecast.gameweeks.includes(context.gw))
          ) {
            setGw(nextGW);
            setSelected(null);
          }
          setDetailGW((currentGW) =>
            currentGW > 0 &&
            (currentGW < nextForecast.next_gw ||
              (Boolean(reconciled) &&
                !nextForecast.gameweeks.includes(currentGW)))
              ? nextGW
              : currentGW,
          );
          setForecastUpdate(null);
          if (notices.length) notify([...new Set(notices)].join(" "));
        }
      })
      .catch((e) => {
        if (current()) {
          if (e instanceof PlanResourceError && livePlanningRef.current.data === reconcilingData)
            setResourceError(e.message);
          setForecastUpdate({ request, configuration: serialized, error: e.message });
          notify(e.message, true);
        }
      });
    return () => {
      if (request === dataRequestRef.current) ++dataRequestRef.current;
    };
  }, [
    overrides,
    minutesSchedule,
    statSchedule,
    teamStrengths,
    fixtureMoves,
    useMarket,
    customPoints,
    blendWeight,
    useProvider,
    useSolio,
    providerWeight,
    extrapolate,
    anchorHalfLife,
    customName,
    forecastRetry,
  ]);
  useEffect(() => {
    if (!data || detailId === null || !lookup.has(detailId)) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setDetail(null);
    api<PlayerDetail>(`/players/${detailId}?gw=${playerGW}`, forecastArgs)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e) => notify(e.message, true))
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [
    data,
    lookup,
    detailId,
    playerGW,
    overrides,
    minutesSchedule,
    statSchedule,
    teamStrengths,
    fixtureMoves,
    useMarket,
    useProvider,
    useSolio,
    providerWeight,
    customPoints,
    blendWeight,
    extrapolate,
    anchorHalfLife,
  ]);

  function openResourceModal(kind: "team" | "resources") {
    setTeamBank(active?.base_bank ?? 0);
    setTeamFT(active?.free_transfers ?? 1);
    setModal(kind);
  }
  function openPlayer(
    id: number,
    gameweek = gw,
    readOnly = false,
    sourcePlan = active,
    inline = false,
    preserveAnchor = false,
  ) {
    const source = document.activeElement as HTMLElement | null;
    if (inline) {
      setDetailAnchor(null);
    } else {
      const anchor = source
        ?.closest(
          ".player-select,.projection-value,.player-info,.board-transfers button,.squad-name,.overview-target-list .player-name-cell",
        )
        ?.getBoundingClientRect();
      if (anchor) {
        setDetailAnchor({
          left: anchor.left,
          right: anchor.right,
          top: anchor.top,
          bottom: anchor.bottom,
        });
      } else if (!preserveAnchor && !source?.closest(".player-window")) {
        setDetailAnchor(null);
      }
    }
    setDetailReadOnly(readOnly);
    setDetailInline(inline);
    setDetailGW(gameweek);
    setDetailTab(
      inline
        ? "edit"
        : !readOnly &&
            sourcePlan?.weeks
              .find((row) => row.gw === gameweek)
              ?.squad.includes(id)
          ? "transfer"
          : "overview",
    );
    setDetailBack(null);
    setDetailId(id);
  }
  useLayoutEffect(() => {
    if (analyticsRef.current)
      analyticsRef.current.scrollTop = scrollPositions.current[scrollKey] ?? 0;
  }, [scrollKey, loading]);
  function navigateTab(value: Tab, nextGW?: number) {
    if (nextGW !== undefined) {
      setGw(nextGW);
    } else if (
      ["lineup", "optimise"].includes(value) &&
      active &&
      !active.weeks.some((row) => row.gw === gw)
    ) {
      setGw(active.weeks[0].gw);
    }
    setDetailId(null);
    setTab(value);
  }
  useEffect(() => {
    if (detailId !== null && detailTab === "transfer" && !detailSquad)
      setDetailTab("overview");
  }, [detailId, detailSquad, detailTab]);
  useEffect(() => {
    if (loading || !data) {
      urlSyncedRef.current = false;
      return;
    }
    const next = new URL(window.location.href);
    const desiredTab = tab === "analysis" ? "plans" : tab;
    const desiredPlan = active?.id ?? activeId;
    if (
      !next.searchParams.has("view") &&
      next.searchParams.get("tab") === desiredTab &&
      next.searchParams.get("gw") === String(gw) &&
      next.searchParams.get("plan") === desiredPlan
    ) {
      urlSyncedRef.current = true;
      popstateReplaceRef.current = false;
      return;
    }
    const hadEmptyPlan = !next.searchParams.get("plan");
    next.searchParams.delete("view");
    next.searchParams.set("tab", desiredTab);
    next.searchParams.set("gw", String(gw));
    next.searchParams.set("plan", desiredPlan);
    if (!urlSyncedRef.current || popstateReplaceRef.current || hadEmptyPlan) {
      window.history.replaceState(null, "", next);
    } else {
      window.history.pushState(null, "", next);
    }
    urlSyncedRef.current = true;
    popstateReplaceRef.current = false;
  }, [tab, gw, active?.id, activeId, loading, Boolean(data)]);
  useEffect(() => {
    const back = () => {
      if (!data) return;
      const params = new URLSearchParams(window.location.search),
        plan = plans.find((row) => row.id === params.get("plan")),
        week = Number(params.get("gw"));
      const nextTab = locationTab();
      const selectedPlan =
        plan ?? plans.find((row) => row.id === activeId) ?? plans[0];
      const nextPlanId = selectedPlan?.id ?? activeId;
      const nextGW =
        selectedPlan &&
        ["lineup", "optimise"].includes(nextTab) &&
        !selectedPlan.weeks.some((row) => row.gw === week)
          ? selectedPlan.weeks[0].gw
          : data.gameweeks.includes(week)
            ? week
            : (selectedPlan?.weeks.find((row) => row.gw === gw)?.gw ??
              selectedPlan?.weeks[0]?.gw ??
              data.next_gw);
      const desiredTab = nextTab === "analysis" ? "plans" : nextTab;
      const next = new URL(window.location.href);
      if (
        next.searchParams.has("view") ||
        next.searchParams.get("tab") !== desiredTab ||
        next.searchParams.get("gw") !== String(nextGW) ||
        next.searchParams.get("plan") !== nextPlanId
      ) {
        next.searchParams.delete("view");
        next.searchParams.set("tab", desiredTab);
        next.searchParams.set("gw", String(nextGW));
        next.searchParams.set("plan", nextPlanId);
        window.history.replaceState(null, "", next);
      }
      popstateReplaceRef.current = true;
      setTab(nextTab);
      if (selectedPlan) setActiveId(selectedPlan.id);
      setGw(nextGW);
      setDetailId(null);
      setSelected(null);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [plans, data, activeId, gw]);

  // Claim ownership before React renders disabled controls. The version also
  // rejects callbacks that captured decisions before a completed operation.
  function canStartOperation() {
    return !busy && !operationRef.current &&
      renderedOperationVersion === operationVersionRef.current;
  }
  function beginOperation(message: string, origin?: PlanOperation) {
    if (!canStartOperation()) return null;
    const operation = Symbol();
    operationRef.current = operation;
    // Also invalidate background reloads if this job starts and finishes
    // before React has rendered its accepted state into livePlanningRef.
    ++operationVersionRef.current;
    setBusy(message, origin);
    return operation;
  }
  function finishOperation(operation: symbol) {
    if (operationRef.current !== operation) return;
    operationRef.current = null;
    setBusy("");
  }
  function operationMessage(operation: symbol, message: string) {
    if (operationRef.current === operation)
      setBusyStatus((current) => ({ ...current, message }));
  }

  function planMessage(message: string, origin: PlanOperation) {
    const live = livePlanningRef.current;
    const surface = feedbackSurfaceRef.current;
    const matchingSurface = !surface || (!surface.readOnly &&
      (origin.gw === null || surface.gw === origin.gw));
    if (live.activeId === origin.id && (origin.gw === null || live.gw === origin.gw) && matchingSurface)
      return message;
    const name = live.plans.find((plan) => plan.id === origin.id)?.name ?? origin.name;
    return `${name}${origin.gw === null ? "" : ` · GW${origin.gw}`}: ${message}`;
  }
  // A receipt is valid only for this render's configuration and loaded inputs.
  // Reject the entire attempt on drift: resources and history must come from a
  // fresh server validation on retry, never from a locally repaired old receipt.
  function assertPlanInputs(operation: symbol, resourceRetry = false) {
    if (resourceErrorRef.current && !resourceRetry)
      throw new Error("Plan resources need validation. Retry the feed refresh.");
    if (operationRef.current !== operation)
      throw new Error("Plan update expired. Try again.");
    const live = livePlanningRef.current;
    const configuration = JSON.stringify(forecastArgs);
    if (
      !data ||
      live.data !== data ||
      JSON.stringify(live.forecastArgs) !== configuration ||
      (!resourceRetry && loadedForecastArgsRef.current !== configuration)
    )
      throw new Error("Forecasts changed. Try again.");
  }
  async function validatedPlan(p: Plan, operation: symbol) {
    assertPlanInputs(operation);
    const result = await api<{ weeks: Week[] }>(
      "/plan/validate",
      planValidationRequest(p, forecastArgs),
    );
    assertPlanInputs(operation);
    return { ...p, weeks: result.weeks };
  }
  async function updatePlan(
    p: Plan,
    message?: string,
    remember = true,
    pendingMessage = "Updating plan…",
    atGW: number | null = gw,
  ) {
    const origin = { id: p.id, name: p.name, gw: atGW };
    const operation = beginOperation(pendingMessage, origin);
    if (!operation) return false;
    const before = plans.find((row) => row.id === p.id);
    setToast(null);
    try {
      const valid = await validatedPlan(p, operation);
      assertPlanInputs(operation);
      if (remember && before)
        setPlanHistory((history) => ({
          ...history,
          [p.id]: {
            past: [
              ...(history[p.id]?.past ?? []),
              structuredClone(before),
            ].slice(-30),
            future: [],
          },
        }));
      // Names can change while validation is pending, independently of decisions.
      setPlans((ps) =>
        ps.map((v) => (v.id === p.id ? { ...valid, name: v.name } : v)),
      );
      if (message) notify(message, false, origin);
      return valid;
    } catch (e) {
      if (operationRef.current === operation) notify((e as Error).message, true, origin);
      return false;
    } finally {
      finishOperation(operation);
    }
  }
  async function travelPlan(direction: "past" | "future") {
    if (!active || operationRef.current) return;
    const history = planHistory[active.id];
    const target = history?.[direction].at(-1);
    if (!target) return;
    const valid = await updatePlan(
      target,
      direction === "past" ? "Change undone." : "Change restored.",
      false,
      direction === "past" ? "Undoing…" : "Redoing…",
      null,
    );
    if (valid) {
      setPlanHistory((current) => ({
        ...current,
        [active.id]:
          direction === "past"
            ? {
                past: history.past.slice(0, -1),
                future: [...history.future, structuredClone(active)],
              }
            : {
                past: [...history.past, structuredClone(active)],
                future: history.future.slice(0, -1),
              },
      }));
      // History belongs to its source plan; selection belongs to the current view.
      if (livePlanningRef.current.activeId === active.id) {
        setGw((current) =>
          valid.weeks.some((row) => row.gw === current)
            ? current
            : valid.weeks[0].gw,
        );
        setSelected(null);
      }
    }
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        if (modal) {
          setModal(null);
        } else if (detailId !== null) {
          setDetailId(null);
        } else if (selected !== null) {
          setSelected(null);
        }
        return;
      }
      if (
        event.altKey ||
        modal ||
        detailId !== null ||
        (event.target as HTMLElement | null)?.closest?.(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        void travelPlan(event.shiftKey ? "future" : "past");
      } else if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        key === "y"
      ) {
        event.preventDefault();
        void travelPlan("future");
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [
    active,
    planHistory,
    busy,
    modal,
    detailId,
    selected,
    renderedOperationVersion,
  ]);
  function onWatch(id: number) {
    setWatch((v) => (v.includes(id) ? v.filter((i) => i !== id) : [...v, id]));
  }
  function togglePlayerConstraint(id: number, kind: "locked" | "excluded") {
    const clearing = settings[kind].includes(id);
    setSettings((current) => ({
      ...current,
      [kind]: current[kind].includes(id)
        ? current[kind].filter((value) => value !== id)
        : [...current[kind], id],
      [kind === "locked" ? "excluded" : "locked"]: current[
        kind === "locked" ? "excluded" : "locked"
      ].filter((value) => value !== id),
    }));
    notify(
      `${lookup.get(id)?.name} ${clearing ? "rule cleared" : kind === "locked" ? "locked" : "excluded"}.`,
    );
  }
  function choosePlan(id: string) {
    setActiveId(id);
    setSelected(null);
    setDetailId(null);
    const p = plans.find((v) => v.id === id);
    if (
      p &&
      (["lineup", "optimise", "analysis"].includes(tab) ||
        (pitchExpanded && wideLayout && !treeHidden)) &&
      !p.weeks.some((w) => w.gw === gw)
    )
      setGw(p.weeks[0].gw);
  }
  async function createPlan() {
    if (!active || !data || operationRef.current) return;
    const p = planFromSquad(
      active.base_squad,
      data.players,
      active.weeks.map((row) => row.gw),
      active.base_bank,
      active.free_transfers,
      `Scenario ${plans.length + 1}`,
    );
    p.purchase_prices = { ...active.purchase_prices };
    p.used_chips = structuredClone(active.used_chips ?? []);
    p.entry_id = active.entry_id;
    p.team_name = active.team_name;
    const operation = beginOperation("Creating scenario…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(p, operation);
      assertPlanInputs(operation);
      setPlans((current) => [...current, valid]);
      setActiveId(p.id);
      setGw(valid.weeks[0].gw);
      notify("Scenario created.");
    } catch (error) {
      if (operationRef.current === operation) notify((error as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  function reorderPlan(direction: number) {
    if (!active || !canStartOperation()) return;
    const target = plans.findIndex((plan) => plan.id === active.id) + direction;
    if (target < 0 || target >= plans.length) return;
    ++operationVersionRef.current;
    setPlans((current) => {
      const next = [...current],
        index = next.findIndex((plan) => plan.id === active.id),
        target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  async function startBranchAt(start: number) {
    if (
      !active || !data || operationRef.current || start === active.weeks[0]?.gw
    ) return;
    const operation = beginOperation("Creating future branch…");
    if (!operation) return;
    try {
      const source = await validatedPlan(active, operation);
      assertPlanInputs(operation);
      const prefix = source.weeks.filter((row) => row.gw < start),
        receipt = prefix.at(-1);
      if (
        !receipt?.permanent_squad ||
        receipt.permanent_bank === undefined ||
        !receipt.purchase_prices
      )
        throw new Error(
          "Starting resources are unavailable for that gameweek.",
        );
      const next: Plan = {
        ...structuredClone(source),
        id: uid(),
        name: `${source.name} · GW${start}`,
        created_at: new Date().toISOString(),
        base_squad: [...receipt.permanent_squad],
        base_bank: receipt.permanent_bank,
        free_transfers: receipt.next_free_transfers,
        purchase_prices: { ...receipt.purchase_prices },
        weeks: source.weeks.filter((row) => row.gw >= start),
        history_weeks: [...(source.history_weeks ?? []), ...prefix],
        used_chips: [
          ...(source.used_chips ?? []),
          ...prefix
            .filter((row) => row.chip !== "none")
            .map((row) => ({ chip: row.chip, gw: row.gw })),
        ],
      };
      const valid = await validatedPlan(next, operation);
      assertPlanInputs(operation);
      setPlans((current) => [...current, valid]);
      setActiveId(valid.id);
      navigateTab("lineup", start);
      setSelected(null);
      notify(`Branched from GW${start}.`);
    } catch (error) {
      if (operationRef.current === operation) notify((error as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  useEffect(() => {
    localStorage.setItem(
      "open-fpl-deleted-plans-v1",
      JSON.stringify(deletedPlans),
    );
  }, [deletedPlans]);
  async function restoreDeleted(plan: Plan) {
    const operation = beginOperation("Restoring plan…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(plan, operation);
      assertPlanInputs(operation);
      setPlans((current) =>
        current.some((row) => row.id === valid.id)
          ? current
          : [...current, valid],
      );
      setDeletedPlans((current) =>
        current.filter((row) => row.id !== valid.id),
      );
      setActiveId(valid.id);
      setGw(valid.weeks[0].gw);
      notify("Plan restored.");
    } catch (error) {
      if (operationRef.current === operation) notify((error as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  function lockTransfers() {
    if (!week) return;
    setSettings((current) => ({
      ...current,
      transfer_limits: {
        ...current.transfer_limits,
        [String(gw)]: week.transfers_in.length,
      },
      locked_by_gw: {
        ...current.locked_by_gw,
        [String(gw)]: [
          ...new Set([
            ...(current.locked_by_gw?.[String(gw)] ?? []).filter(
              (id) => !week.transfers_out.includes(id),
            ),
            ...week.transfers_in,
          ]),
        ],
      },
      excluded_by_gw: {
        ...current.excluded_by_gw,
        [String(gw)]: [
          ...new Set([
            ...(current.excluded_by_gw?.[String(gw)] ?? []).filter(
              (id) => !week.transfers_in.includes(id),
            ),
            ...week.transfers_out,
          ]),
        ],
      },
    }));
    notify(`GW${gw} transfers locked.`);
  }
  function clonePlan() {
    if (!active || !canStartOperation()) return;
    ++operationVersionRef.current;
    const p = {
      ...structuredClone(active),
      id: uid(),
      name: `${active.name} · alternative`,
      created_at: new Date().toISOString(),
    };
    setPlans((ps) => [...ps, p]);
    setActiveId(p.id);
    notify("Branch duplicated.");
  }
  function deletePlan() {
    if (!active || plans.length <= 1 || !canStartOperation()) return;
    ++operationVersionRef.current;
    const rest = plans.filter((p) => p.id !== active.id);
    const removed = structuredClone(active);
    setDeletedPlans((current) => [...current, removed].slice(-20));
    setPlans(rest);
    choosePlan(rest[0].id);
    setPreviewingDraft(false);
    setToast({
      text: "Plan deleted.",
      action: { label: "Undo", run: () => restoreDeletedRef.current(removed) },
    });
  }
  async function transferIn(id: number, from = selected, atGW = gw) {
    const view = transferView;
    const transferWeek = active?.weeks.find((row) => row.gw === atGW);
    if (!data || !active || from === null || !transferWeek || operationRef.current)
      return false;
    const incoming = lookup.get(id)!,
      outgoing = lookup.get(from)!;
    if (!incoming || !outgoing || !transferWeek.squad.includes(from))
      return false;
    if (
      incoming.position_id !== outgoing.position_id ||
      transferWeek.squad.includes(id)
    )
      return false;
    const next = replacePlayer(active, atGW, from, id);
    if (
      await updatePlan(
        next,
        `${outgoing.name} → ${incoming.name}.`,
        true,
        "Updating plan…",
        atGW,
      )
    ) {
      if (liveTransferViewRef.current === view)
        setSelected((current) => current === selected ? null : current);
      return true;
    }
    return false;
  }
  function setCaptain(id: number, vice = false, atGW = gw) {
    if (
      !active ||
      operationRef.current ||
      !active.weeks.find((row) => row.gw === atGW)?.starters.includes(id)
    )
      return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === atGW)!;
    if (vice) {
      if (id === w.captain) w.captain = w.vice;
      w.vice = id;
    } else {
      if (id === w.vice) w.vice = w.captain;
      w.captain = id;
    }
    void updatePlan(
      p,
      `${lookup.get(id)?.name} set as ${vice ? "vice-captain" : "captain"}.`,
      true,
      "Updating plan…",
      atGW,
    );
  }
  function swapPlayers(from: number, id: number) {
    if (!active || !week || !data || operationRef.current) return;
    const first = lookup.get(from),
      second = lookup.get(id);
    if (!first || !second || !canSwap(week, first, second, data.players)) {
      notify("Illegal substitution.", true);
      return;
    }
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw)!;
    const starter = week.starters.includes(from) ? from : id,
      reserve = starter === from ? id : from;
    w.starters = w.starters.map((i) => (i === starter ? reserve : i));
    w.bench = w.bench.map((i) => (i === reserve ? starter : i));
    if (w.captain === starter) w.captain = reserve;
    if (w.vice === starter) w.vice = reserve;
    void updatePlan(p, "Lineup updated.", true, "Updating lineup…");
    setSelected(null);
  }
  function swapBench(id: number) {
    if (selected !== null) swapPlayers(selected, id);
  }
  function moveBench(offset: number, player = selected, atGW = gw) {
    const targetWeek = active?.weeks.find((row) => row.gw === atGW);
    if (!active || !targetWeek || player === null || operationRef.current) return;
    const index = targetWeek.bench.indexOf(player),
      target = index + offset;
    if (index < 1 || target < 1 || target > 3) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === atGW)!;
    [w.bench[index], w.bench[target]] = [w.bench[target], w.bench[index]];
    void updatePlan(p, "Bench order updated.", true, "Updating plan…", atGW);
  }
  function changeHorizon(count: number) {
    if (!active || !data) return;
    const p = structuredClone(active),
      weeks = data.gameweeks
        .filter((w) => w >= (p.weeks[0]?.gw ?? data.next_gw))
        .slice(0, count),
      permanentSquad =
        [...p.weeks].reverse().find((w) => w.chip !== "freehit")?.squad ??
        p.base_squad;
    p.weeks = weeks.map(
      (w, index) =>
        p.weeks.find((v) => v.gw === w) ?? {
          gw: w,
          squad: [...permanentSquad],
          ...optimalLineup(permanentSquad, data.players, w),
          chip: "none",
          bank: p.weeks.at(-1)!.bank,
          free_transfers: Math.min(5, p.free_transfers + index),
          next_free_transfers: Math.min(5, p.free_transfers + index + 1),
          hits: 0,
          net_points: 0,
          transfers_in: [],
          transfers_out: [],
        },
    );
    void updatePlan(p, `Horizon set to ${count} GWs.`, true, "Updating plan…", null);
    if (!weeks.includes(gw)) setGw(weeks[0]);
    setSelected(null);
  }
  function changeChip(chip: Chip) {
    if (!active) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw);
    if (w) {
      w.chip = chip;
      void updatePlan(p, `${chipNames[chip]} set for GW${gw}.`);
    }
  }
  function autoLineup() {
    if (!active || !week || !data) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw)!;
    Object.assign(w, optimalLineup(w.squad, data.players, gw, w.chip));
    void updatePlan(p, "Best XI selected.");
  }
  function resetWeek() {
    if (!active || !week || !data) return;
    const p = structuredClone(active),
      index = p.weeks.findIndex((w) => w.gw === gw),
      previous =
        [...p.weeks.slice(0, index)].reverse().find((w) => w.chip !== "freehit")
          ?.squad ?? p.base_squad;
    const w = p.weeks[index];
    w.squad = [...previous];
    w.chip = "none";
    Object.assign(w, optimalLineup(w.squad, data.players, gw));
    void updatePlan(p, "Gameweek reset.");
    setSelected(null);
  }
  async function importTeam() {
    const operation = beginOperation("Reading your public FPL squad…");
    if (!operation) return;
    try {
      const imported = await api<{
        squad: number[];
        bank: number;
        free_transfers: number;
        name: string;
        entry_id: number;
        purchase_prices: Record<string, number>;
        warnings: string[];
        used_chips?: { chip: Chip; gw: number }[];
      }>(`/teams/${teamId}`);
      if (!data) return;
      const p = planFromSquad(
        imported.squad,
        data.players,
        data.gameweeks,
        imported.bank,
        imported.free_transfers,
        imported.name,
      );
      p.purchase_prices = imported.purchase_prices;
      p.entry_id = imported.entry_id;
      p.team_name = imported.name;
      p.used_chips = imported.used_chips ?? [];
      const valid = await validatedPlan(p, operation);
      assertPlanInputs(operation);
      setPlans((ps) => [...ps, valid]);
      setActiveId(valid.id);
      setGw(data.next_gw);
      setTeamBank(imported.bank);
      setTeamFT(imported.free_transfers);
      setModal(null);
      notify(`Imported ${imported.name}. Check bank & FTs.`);
    } catch (e) {
      if (operationRef.current === operation) notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  async function saveTeamSettings() {
    if (!active) return;
    const safeBank = Number.isFinite(teamBank)
      ? Math.min(200, Math.max(0, teamBank))
      : 0;
    const safeFT = Number.isFinite(teamFT)
      ? Math.min(5, Math.max(0, Math.trunc(teamFT)))
      : 1;
    setTeamBank(safeBank);
    setTeamFT(safeFT);
    const p = { ...active, base_bank: safeBank, free_transfers: safeFT };
    if (await updatePlan(p, "Resources saved.", true, "Updating plan…", null))
      setModal(null);
  }
  async function runSolve(fresh = false, inPlace = false) {
    if (!data || operationRef.current || solveInFlightRef.current) return;
    const startGW =
      inPlace && active && !active.weeks.some((week) => week.gw === gw)
        ? active.weeks[0].gw
        : data.gameweeks.includes(gw)
          ? gw
          : data.next_gw;
    const sourcePlan = fresh ? null : active && structuredClone(active);
    if (!fresh && !sourcePlan) return;
    const forecasts = structuredClone(forecastArgs);
    const strategy = structuredClone(settings);
    const prices = Object.fromEntries(
      data.players.map((player) => [String(player.id), player.price]),
    );
    const horizon =
      inPlace && sourcePlan
        ? quickSolveHorizon(
            sourcePlan,
            startGW,
            strategy.horizon,
            data.gameweeks.at(-1)!,
          )
        : Math.max(
            1,
            Math.min(strategy.horizon, data.gameweeks.at(-1)! - startGW + 1),
          );
    const operation = beginOperation(
      `Optimising GW${startGW}–${startGW + horizon - 1}…`,
    );
    if (!operation) return;
    const request = ++solveRequestRef.current;
    solveInFlightRef.current = true;
    if (!inPlace) {
      setSolveResult(null);
      setSolveContext(null);
    }
    setSelected(null);
    try {
      let prefix: Week[] = [];
      let baselinePlan: Plan | null = null;
      let squad = sourcePlan?.base_squad.slice() ?? [];
      let bank = sourcePlan?.base_bank ?? 0;
      let freeTransfers = sourcePlan?.free_transfers ?? 1;
      const purchasePrices = { ...sourcePlan?.purchase_prices };
      const usedChips = structuredClone(sourcePlan?.used_chips ?? []);
      if (sourcePlan) {
        if (!sourcePlan.weeks.some((week) => week.gw === startGW))
          throw new Error("Select a planned gameweek.");
        prefix = sourcePlan.weeks
          .filter((week) => week.gw < startGW)
          .sort((a, b) => a.gw - b.gw);
        if (prefix.length && prefix.at(-1)!.gw !== startGW - 1)
          throw new Error("Complete the preceding gameweeks first.");
        const validateWeeks = async (weeks: Week[]) =>
          api<{ weeks: Week[] }>("/plan/validate", {
            ...forecasts,
            base_squad: sourcePlan.base_squad,
            bank: sourcePlan.base_bank,
            free_transfers: sourcePlan.free_transfers,
            purchase_prices: sourcePlan.purchase_prices,
            used_chips: sourcePlan.used_chips ?? [],
            weeks,
          });
        try {
          const validated = await validateWeeks(sourcePlan.weeks);
          baselinePlan = { ...sourcePlan, weeks: validated.weeks };
          prefix = validated.weeks.filter((week) => week.gw < startGW);
        } catch {
          // An invalid later transfer need not prevent repairing its suffix.
          // Only a fully validated baseline can support a points comparison.
          if (prefix.length) prefix = (await validateWeeks(prefix)).weeks;
        }
        for (const week of prefix) {
          freeTransfers = week.next_free_transfers;
          if (
            week.chip !== "none" &&
            !usedChips.some(
              (used) => used.chip === week.chip && used.gw === week.gw,
            )
          )
            usedChips.push({ chip: week.chip, gw: week.gw });
          if (week.chip === "freehit") continue;
          const nextSquad = new Set(week.squad);
          for (const id of squad)
            if (!nextSquad.has(id)) delete purchasePrices[String(id)];
          for (const id of week.squad)
            if (!squad.includes(id))
              purchasePrices[String(id)] = prices[String(id)];
          squad = week.squad.slice();
          bank = week.bank;
        }
      }
      const result = await api<SolveResult>("/optimise", {
        ...forecasts,
        ...solverSettingsForHorizon(strategy, startGW, horizon),
        horizon,
        seconds:
          inPlace && horizon <= 14
            ? Math.min(strategy.seconds, 5)
            : strategy.seconds,
        squad,
        bank,
        free_transfers: freeTransfers,
        purchase_prices: Object.fromEntries(
          squad.map((id) => [
            String(id),
            purchasePrices[String(id)] ?? prices[String(id)],
          ]),
        ),
        used_chips: usedChips,
        start_gw: startGW,
        budget: 100,
        chips: sourcePlan
          ? Object.fromEntries(
              sourcePlan.weeks
                .filter(
                  (week) => week.gw >= startGW && week.gw < startGW + horizon,
                )
                .map((week) => [String(week.gw), week.chip]),
            )
          : {},
      });
      if (request !== solveRequestRef.current) return;
      if (inPlace && sourcePlan) {
        const unchanged = () => {
          const live = livePlanningRef.current;
          return (
            operationRef.current === operation &&
            live.data === data &&
            JSON.stringify(
              live.plans.find((plan) => plan.id === sourcePlan.id),
            ) === JSON.stringify(sourcePlan) &&
            JSON.stringify(live.forecastArgs) === JSON.stringify(forecasts) &&
            live.data?.players.every(
              (player) => prices[String(player.id)] === player.price,
            )
          );
        };
        if (!unchanged())
          throw new Error("Plan or forecasts changed. Optimise again.");
        const candidate = planWithOptimisedSuffix(
          sourcePlan,
          prefix,
          result.weeks,
          startGW,
          horizon,
        );
        operationMessage(operation, "Checking optimised team…");
        const valid = await validatedPlan(candidate, operation);
        assertPlanInputs(operation);
        if (request !== solveRequestRef.current) return;
        if (!unchanged())
          throw new Error("Plan or forecasts changed. Optimise again.");
        setPlanHistory((history) => ({
          ...history,
          [sourcePlan.id]: {
            past: [
              ...(history[sourcePlan.id]?.past ?? []),
              structuredClone(sourcePlan),
            ].slice(-30),
            future: [],
          },
        }));
        setPlans((current) =>
          current.map((plan) => (plan.id === sourcePlan.id ? valid : plan)),
        );
        setSolveResult(null);
        setSolveContext(null);
        setPreviewingDraft(false);
        notify(`Optimised ${sourcePlan.name} · GW${startGW}–${startGW + horizon - 1}.`);
        return;
      }
      setSolveResult(result);
      setPreviewingDraft(true);
      setDraftGW(result.weeks[0]?.gw ?? startGW);
      setSolveContext({
        fresh,
        startGW,
        sourcePlan,
        prefix,
        baselinePlan,
        prices,
      });
      notify(`Plan ready · GW${startGW}–${startGW + horizon - 1}.`);
    } catch (e) {
      if (request === solveRequestRef.current && operationRef.current === operation)
        notify((e as Error).message, true);
    } finally {
      if (operationRef.current === operation) solveInFlightRef.current = false;
      finishOperation(operation);
    }
  }
  async function applySolve() {
    if (
      !data || !solveResult?.weeks.length || !solveContext || operationRef.current
    ) return;
    const context = solveContext;
    const resultWeeks = structuredClone(solveResult.weeks);
    let p: Plan;
    if (context.fresh) {
      const first = resultWeeks[0];
      if (
        first.squad.some(
          (id) => lookup.get(id)?.price !== context.prices[String(id)],
        )
      ) {
        notify("Prices changed. Solve again.", true);
        return;
      }
      p = planFromSquad(
        first.squad,
        data.players,
        resultWeeks.map((w) => w.gw),
        first.bank,
        1,
        "Fresh squad · optimised",
      );
      p.purchase_prices = Object.fromEntries(
        first.squad.map((id) => [String(id), context.prices[String(id)]]),
      );
      p.weeks = resultWeeks.map((w, index) => ({
        ...w,
        transfers_in: index === 0 ? [] : w.transfers_in,
        transfers_out: index === 0 ? [] : w.transfers_out,
      }));
    } else {
      if (!context.sourcePlan) return;
      p = {
        ...structuredClone(context.sourcePlan),
        id: uid(),
        name: `${context.sourcePlan.name} · optimised`,
        created_at: new Date().toISOString(),
        weeks: [...structuredClone(context.prefix), ...resultWeeks],
      };
    }
    const operation = beginOperation("Saving branch…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(p, operation);
      assertPlanInputs(operation);
      setPlans((ps) => [...ps, valid]);
      setActiveId(p.id);
      setSolveResult(null);
      setSolveContext(null);
      setPreviewingDraft(false);
      navigateTab("lineup", context.startGW);
      notify(`Branch saved · through GW${resultWeeks.at(-1)!.gw}.`);
    } catch (e) {
      if (operationRef.current === operation) notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  async function applyStress(
    job: SensitivityJob,
    weeks: Week[],
    label: string,
  ) {
    const start = job.settings.solve as SensitivityJob["settings"]["solve"] & {
      entry_id?: number;
      team_name?: string;
    };
    const source =
      plans.find(
        (row) =>
          row.name === job.settings.name &&
          JSON.stringify(row.base_squad) === JSON.stringify(start.squad),
      ) ??
      (active && JSON.stringify(active.base_squad) === JSON.stringify(start.squad)
        ? active
        : (plans.find((row) => row.name === job.settings.name) ?? active));
    const p: Plan = {
      id: uid(),
      name: `${job.settings.name} · stress ${label}`,
      base_squad: start.squad,
      base_bank: start.bank,
      free_transfers: start.free_transfers,
      purchase_prices: start.purchase_prices,
      used_chips: start.used_chips,
      weeks: structuredClone(weeks),
      created_at: new Date().toISOString(),
    };
    const entryId = start.entry_id ?? source?.entry_id;
    const teamName = start.team_name ?? source?.team_name;
    if (entryId !== undefined) p.entry_id = entryId;
    if (teamName !== undefined) p.team_name = teamName;
    const operation = beginOperation("Checking the stress-test branch…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(p, operation);
      assertPlanInputs(operation);
      setPlans((ps) => [...ps, valid]);
      setActiveId(valid.id);
      navigateTab("lineup", valid.weeks[0].gw);
      notify("Stress branch saved.");
    } catch (e) {
      if (operationRef.current === operation) notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  async function refresh() {
    const operation = beginOperation("Refreshing public feeds…");
    if (!operation) return;
    try {
      const baseline = await forecastBaseline(true);
      const restored = await loadPlanningState(
        plans,
        activeId,
        forecastArgs,
        settings,
        (configuration) =>
          configuration === undefined
            ? Promise.resolve(baseline)
            : api<Bootstrap>("/projections", configuration),
        body => api("/plan/validate", body),
      );
      assertPlanInputs(operation, true);
      if (
        restored.notices.length ||
        plans.some((plan) =>
          plan.weeks.some((week) => week.gw < restored.forecast.next_gw),
        )
      )
        archivePlanningInputs(plans, forecastArgs);
      ++dataRequestRef.current;
      loadedForecastArgsRef.current = JSON.stringify(restored.configuration);
      applyForecastConfiguration(restored.configuration);
      setSettings(restored.solver);
      setResourceError("");
      adoptForecast(restored.forecast, current => restored.plans.map(plan => ({
        ...plan, name: current.find(latest => latest.id === plan.id)?.name ?? plan.name,
      })));
      const context = livePlanningRef.current;
      const selectedPlan = restored.plans.find(plan => plan.id === context.activeId);
      const selectedId = selectedPlan?.id ?? restored.activeId;
      setActiveId(selectedId);
      const nextGW = activePlanGW(restored.plans, selectedId, restored.forecast);
      if (!restored.forecast.gameweeks.includes(context.gw)) {
        setGw(nextGW);
        setSelected(null);
      }
      setDetailGW((currentGW) =>
        currentGW && !restored.forecast.gameweeks.includes(currentGW)
          ? nextGW
          : currentGW,
      );
      setSolveResult(null);
      setSolveContext(null);
      setEvalData(await api<Evaluation>("/evaluation"));
      notify(
        `Feeds refreshed.${restored.notices.length ? ` ${restored.notices.join(" ")}` : ""}`,
      );
    } catch (e) {
      if (e instanceof PlanningRestoreError && operationRef.current === operation &&
          livePlanningRef.current.data === data &&
          JSON.stringify(livePlanningRef.current.forecastArgs) === JSON.stringify(forecastArgs))
        setResourceError(e.message);
      notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  async function snapshot() {
    const operation = beginOperation(
      "Refreshing live inputs and recording a pre-deadline snapshot…",
    );
    if (!operation) return;
    try {
      const r = await api<{ filename: string; captured_gameweeks: number[] }>(
        "/snapshot",
        forecastArgs,
      );
      notify(`Snapshot saved (${r.captured_gameweeks.length} GWs).`);
      try {
        const [receipt, forecasts] = await Promise.all([
          api<Prospective>("/prospective"),
          api<Bootstrap>("/projections", forecastArgs),
        ]);
        assertPlanInputs(operation);
        const current = livePlanningRef.current;
        const nextForecast = current.data?.official_fixture_catalog
          ? {
              ...forecasts,
              official_fixture_catalog:
                current.data.next_gw === forecasts.next_gw
                  ? current.data.official_fixture_catalog
                  : current.data.official_fixture_catalog.filter(
                      (fixture) =>
                        fixture.event === null ||
                        fixture.event === undefined ||
                        fixture.event >= forecasts.next_gw,
                    ),
            }
          : forecasts;
        const notices: string[] = [];
        const reconciled =
          current.data &&
          current.plans.length > 0 &&
          needsPlanReconciliation(current.data, nextForecast, current.plans)
            ? await reconcilePlanResources(
                current.plans,
                nextForecast,
                forecastArgs,
                (body) => api("/plan/validate", body),
                notices,
              )
            : undefined;
        assertPlanInputs(operation);
        if (
          reconciled &&
          (notices.length ||
            current.plans.some((plan) =>
              plan.weeks.some((week) => week.gw < nextForecast.next_gw),
            ))
        ) {
          archivePlanningInputs(current.plans, forecastArgs);
        }
        ++dataRequestRef.current;
        if (
          reconciled ||
          (current.data && current.data.next_gw !== nextForecast.next_gw)
        ) {
          setSettings((currentSettings) =>
            sanitizeSolverSettings(currentSettings, nextForecast),
          );
          setSolveResult(null);
          setSolveContext(null);
        }
        setProspective(receipt);
        adoptForecast(nextForecast, reconciled ? current => reconciled.map(plan => ({
          ...plan, name: current.find(latest => latest.id === plan.id)?.name ?? plan.name,
        })) : undefined);
        const context = livePlanningRef.current;
        const adoptedPlans = reconciled ?? context.plans;
        const nextGW = activePlanGW(
          adoptedPlans,
          context.activeId,
          nextForecast,
        );
        if (
          context.gw < nextForecast.next_gw ||
          (reconciled && !nextForecast.gameweeks.includes(context.gw))
        ) {
          setGw(nextGW);
          setSelected(null);
        }
        setDetailGW((currentGW) =>
          currentGW > 0 &&
          (currentGW < nextForecast.next_gw ||
            (Boolean(reconciled) &&
              !nextForecast.gameweeks.includes(currentGW)))
            ? nextGW
            : currentGW,
        );
        if (notices.length)
          notify(
            `Snapshot saved (${r.captured_gameweeks.length} GWs). ${[...new Set(notices)].join(" ")}`,
          );
      } catch (error) {
        if (error instanceof PlanResourceError && operationRef.current === operation &&
            livePlanningRef.current.data === data &&
            JSON.stringify(livePlanningRef.current.forecastArgs) === JSON.stringify(forecastArgs))
          setResourceError(error.message);
        notify("Snapshot saved. Refresh to reload receipt.");
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  async function importCSV(file: File) {
    if (!data) return;
    setCsvError("");
    try {
      if (file.size > 5_000_000)
        throw new Error("Choose a CSV smaller than 5 MB.");
      const { points, minutes, schedules, count } = projectionCSV(
        await file.text(),
        new Set(lookup.keys()),
        data.gameweeks,
      );
      if (count) {
        setCustomPoints(points);
        setCustomName(file.name);
        setBlendWeight(csvWeight / 100);
      }
      if (Object.keys(minutes).length)
        setOverrides((v) => ({ ...v, ...minutes }));
      if (Object.keys(schedules).length)
        setMinutesSchedule((current) => {
          const next = { ...current };
          Object.entries(schedules).forEach(([id, weeks]) => {
            next[id] = { ...next[id], ...weeks };
          });
          return next;
        });
      setModal(null);
      notify(
        `Imported ${count} forecasts, ${Object.keys(minutes).length + Object.values(schedules).reduce((n, weeks) => n + Object.keys(weeks).length, 0)} minutes rules (${file.name}).`,
      );
    } catch (e) {
      setCsvError((e as Error).message);
    }
  }
  async function scoreProspective() {
    const operation = beginOperation("Scoring completed gameweeks…");
    if (!operation) return;
    try {
      const result = await api<Prospective>("/prospective/score", {});
      setProspective(result);
      notify(
        result.gameweeks.length
          ? `Scored ${result.gameweeks.length} completed gameweeks.`
          : "No captured gameweek has finished yet. Your pre-deadline snapshots are preserved.",
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  function exportCSV() {
    if (!data) return;
    const lines = [
      "player_id,name,team,position,price,gameweek,expected_points,expected_minutes",
    ];
    for (const p of data.players)
      for (const [w, f] of Object.entries(p.gw))
        lines.push(
          [
            p.id,
            `"${p.name.replaceAll('"', '""')}"`,
            p.team_short,
            p.position,
            p.price,
            w,
            fmt(f.points, 4),
            fmt(f.xmins, 2),
          ].join(","),
        );
    download(
      "open-fpl-projections.csv",
      "\ufeff" + lines.join("\r\n"),
      "text/csv",
    );
    notify("Projections exported.");
  }
  async function importPlans(file: File) {
    if (!data) return;
    const operation = beginOperation("Checking imported planning branches…");
    if (!operation) return;
    try {
      if (file.size > 5_000_000) throw new Error("Plan file is too large.");
      const value = JSON.parse(await file.text());
      const prepared = await preparePlanImport(
        value,
        data,
        forecastArgs,
        settings,
        {
          projections: (configuration) =>
            api<Bootstrap>("/projections", configuration),
          validate: (body) => api<{ weeks: Week[] }>("/plan/validate", body),
        },
        uid,
      );
      assertPlanInputs(operation, true);
      const existingPlans = livePlanningRef.current.plans;
      const existingNotices: string[] = [];
      const existing =
        data &&
        existingPlans.length > 0 &&
        (needsPlanReconciliation(data, prepared.forecast, existingPlans) ||
          Boolean(resourceErrorRef.current))
          ? await reconcilePlanResources(
              existingPlans,
              prepared.forecast,
              prepared.configuration,
              (body) => api("/plan/validate", body),
              existingNotices,
            )
          : undefined;
      assertPlanInputs(operation, true);
      if (
        existing &&
        (existingNotices.length ||
          existingPlans.some((plan) =>
            plan.weeks.some((week) => week.gw < prepared.forecast.next_gw),
          ))
      ) {
        archivePlanningInputs(existingPlans, forecastArgs);
      }
      if (
        prepared.notices.length ||
        value.plans.some((plan: Plan) =>
          plan.weeks.some((week) => week.gw < prepared.forecast.next_gw),
        )
      ) {
        archivePlanningInputs(value.plans, value.configuration);
      }
      ++dataRequestRef.current;
      loadedForecastArgsRef.current = JSON.stringify(prepared.configuration);
      applyForecastConfiguration(prepared.configuration);
      setSettings(prepared.solver);
      if (existing || !existingPlans.length) setResourceError("");
      adoptForecast(prepared.forecast, ps => [
        ...(existing ? existing.map(plan => ({
          ...plan, name: ps.find(latest => latest.id === plan.id)?.name ?? plan.name,
        })) : ps), ...prepared.plans,
      ]);
      const nextGW = activePlanGW(
        prepared.plans,
        prepared.plans[0].id,
        prepared.forecast,
      );
      setActiveId(prepared.plans[0].id);
      setGw(nextGW);
      setSelected(null);
      setDetailGW((currentGW) =>
        currentGW && !prepared.forecast.gameweeks.includes(currentGW)
          ? nextGW
          : currentGW,
      );
      setSolveResult(null);
      setSolveContext(null);
      const allNotices = [...new Set([...existingNotices, ...prepared.notices])];
      notify(
        `Imported ${prepared.plans.length} plans.${allNotices.length ? ` ${allNotices.join(" ")}` : ""}`,
      );
    } catch (e) {
      if (e instanceof PlanResourceError && operationRef.current === operation &&
          livePlanningRef.current.data === data &&
          JSON.stringify(livePlanningRef.current.forecastArgs) === JSON.stringify(forecastArgs))
        setResourceError(e.message);
      notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }

  async function applyChipPlan(source: Plan, weeks: Week[]) {
    const operation = beginOperation("Checking chip branch…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(
        {
          ...structuredClone(source),
          id: uid(),
          name: `${source.name} · chips`,
          weeks,
          created_at: new Date().toISOString(),
        },
        operation,
      );
      assertPlanInputs(operation);
      setPlans((current) => [...current, valid]);
      setActiveId(valid.id);
      setGw(valid.weeks[0].gw);
      notify("Chip branch saved.");
    } finally {
      finishOperation(operation);
    }
  }

  async function applyChipStrategy(
    source: Plan,
    weeks: Week[],
    job: ChipStrategyJob,
  ) {
    const operation = beginOperation("Checking strategy branch…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(
        {
          ...structuredClone(source),
          id: uid(),
          name: `${source.name} · ${chipNames[job.settings.auto_chip]} timing`,
          weeks: structuredClone(weeks),
          created_at: new Date().toISOString(),
        },
        operation,
      );
      assertPlanInputs(operation);
      setPlans((current) => [...current, valid]);
      setActiveId(valid.id);
      navigateTab("lineup", job.scope.gameweeks[0] ?? valid.weeks[0].gw);
      notify("Strategy branch saved.");
    } finally {
      finishOperation(operation);
    }
  }

  const availableTargets = useMemo(() => {
    if (!data) return [];
    let rows = data.players.filter(
      (p) =>
        p.pplay > 0.05 &&
        `${p.name} ${p.team_name}`
          .toLowerCase()
          .includes(playerQuery.toLowerCase()),
    );
    if (selectedPlayer && week)
      rows = rows.filter(
        (p) =>
          p.position_id === selectedPlayer.position_id &&
          !week.squad.includes(p.id),
      );
    if (listMode === "watch") rows = rows.filter((p) => watch.includes(p.id));
    const horizon = data.gameweeks.filter((w) => w >= gw).slice(0, 6);
    return rows
      .sort((a, b) =>
        listMode === "captains"
          ? xp(b, gw) - xp(a, gw)
          : horizon.reduce((n, w) => n + xp(b, w) - xp(a, w), 0),
      )
      .slice(0, 8);
  }, [data, gw, selectedPlayer, week, playerQuery, listMode, watch]);

  if (loading || !data)
    return (
      <div className="app-loading">
        <div className="loading-brand">
          <Logo />
          <b>
            open<span>fpl</span>
          </b>
        </div>
        {loadError ? (
          <>
            <h2>Data connection needs attention.</h2>
            <p>{loadError}</p>
            <button
              className="button primary"
              onClick={retryLoading}
            >
              <RefreshCw size={15} />
              Retry
            </button>
            {loadRecovery !== null && <button className="button" onClick={() =>
              download("open-fpl-recovery.json", JSON.stringify(loadRecovery, null, 2))
            }>Export saved inputs</button>}
            <small>
              Your saved plans and assumptions are retained.
            </small>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={25} />
            <p role="status">{loadStage}</p>
            {loadSlow && <>
              <small>Still waiting for data. Saved plans and assumptions are retained.</small>
              <button className="button" onClick={retryLoading}>
                <RefreshCw size={15} />Retry
              </button>
            </>}
          </>
        )}
      </div>
    );

  const nextEvent = data.events.find((e) => e.id === data.next_gw);
  const captain = week ? lookup.get(week.captain) : null;
  const totalPlan = currentHorizon.reduce(
    (n, w) => n + (w.net_points ?? w.points),
    0,
  );
  const pastRefresh = new Date(data.loaded_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const showLeftPitch =
    pitchExpanded && wideLayout && !treeHidden && tab !== "data";
  const forecastState = forecastStatus();
  const forecastFeedback = forecastState.stale ? (
    <div className="forecast-feedback" role={forecastState.error ? "alert" : "status"}>
      {forecastState.pending ? <LoaderCircle size={15} className="spin" /> : <Info size={15} />}
      <span>
        <b>{forecastState.error ? "Forecast update failed." : "Updating forecasts…"}</b>{" "}
        Showing previous values.
        {forecastState.error && <small>{forecastState.error}</small>}
      </span>
      {forecastState.error && <button className="button small" onClick={retryForecasts}>
        <RefreshCw size={14} />Retry
      </button>}
    </div>
  ) : null;
  const plannerBoard =
    active && week ? (
      <PlannerBoard
        data={data}
        plan={active}
        week={week}
        selected={selected}
        busy={Boolean(busy)}
        busyLabel={planBusyLabel}
        onWeek={(value) => {
          setGw(value);
          setSelected(null);
        }}
        onName={(name) =>
          setPlans((ps) =>
            ps.map((p) => (p.id === active.id ? { ...p, name } : p)),
          )
        }
        onHorizon={changeHorizon}
        onClone={clonePlan}
        onSelect={setSelected}
        onDetail={openPlayer}
        onBenchSwap={swapBench}
        onSwap={swapPlayers}
        onChip={changeChip}
        onBestXI={autoLineup}
        onReset={resetWeek}
        onTeam={() => openResourceModal("resources")}
        onShare={() => setModal("lineupImage")}
        onLockTransfers={lockTransfers}
        onOptimise={() => void runSolve(false, true)}
        onUndo={() => void travelPlan("past")}
        onRedo={() => void travelPlan("future")}
        canUndo={Boolean(planHistory[active.id]?.past.length)}
        canRedo={Boolean(planHistory[active.id]?.future.length)}
      />
    ) : null;

  return (
    <div className={`app-shell solio-studio ${forecastState.stale ? "forecasts-stale" : ""}`}>
      <aside className="app-rail" aria-label="App navigation">
        <button
          className="rail-brand"
          onClick={() => navigateTab("lineup")}
          aria-label="Open FPL"
        >
          <Logo />
        </button>
        {tabs.map((item) => {
          const Icon = item.icon;
          const current = tab === item.id;
          return (
            <button
              key={item.id}
              className={current ? "active" : ""}
              aria-current={current ? "page" : undefined}
              onClick={() => navigateTab(item.id)}
              title={item.label}
              aria-label={item.label}
            >
              <Icon size={18} />
            </button>
          );
        })}
        <div className="rail-bottom">
          <button
            onClick={refresh}
            disabled={Boolean(busy)}
            title="Refresh feeds"
            aria-label="Refresh data"
          >
            <RefreshCw size={17} />
          </button>
          <button
            onClick={() => setModal("help")}
            title="Help"
            aria-label="Help"
          >
            <CircleHelp size={17} />
          </button>
          <button
            onClick={() => setModal("settings")}
            title="Settings and sources"
            aria-label="Settings and data sources"
          >
            <Settings2 size={19} />
          </button>
        </div>
      </aside>
      {forecastFeedback}
      <div
        className={`workspace solio-workspace workspace-${tab} ${treeHidden || tab === "data" ? "tree-hidden" : ""}`}
        style={{ "--panel-split": `${split}%` } as CSSProperties}
        aria-busy={forecastState.pending}
      >
        <PlanTree
          data={data}
          plans={plans}
          active={active}
          gw={gw}
          onPlan={choosePlan}
          onWeek={(value) => {
            setGw(value);
            setSelected(null);
            setPreviewingDraft(false);
          }}
          onCreate={() => void createPlan()}
          onCopy={clonePlan}
          onEvaluate={() => navigateTab("analysis")}
          pitchExpanded={showLeftPitch}
          onPitchExpanded={(expanded) => {
            setPitchExpanded(expanded);
            setSelected(null);
          }}
          lineup={plannerBoard}
          onStart={(value) => void startBranchAt(value)}
          onReorder={reorderPlan}
          busy={Boolean(busy)}
          optimising={solveInFlightRef.current}
          onDelete={deletePlan}
          onConfigure={() => openResourceModal("team")}
          onHorizon={changeHorizon}
          onOptimise={() => void runSolve(false, true)}
          onOptimiseSettings={() => navigateTab("optimise")}
        />
        <WorkspaceDivider
          value={split}
          onChange={(value) => {
            setSplit(value);
            localStorage.setItem("open-fpl-panel-split", JSON.stringify(value));
          }}
        />
        <main className="main-content solio-detail-panel">
          <div className="detail-panel-heading">
            {tab !== "data" && (
              <>
                <button
                  className="icon-button tree-toggle"
                  aria-label={
                    treeHidden ? "Show planning tree" : "Hide planning tree"
                  }
                  aria-pressed={!treeHidden}
                  title={
                    treeHidden ? "Show planning tree" : "Hide planning tree"
                  }
                  onClick={() => setTreeHidden(!treeHidden)}
                >
                  {treeHidden ? (
                    <PanelLeftOpen size={15} />
                  ) : (
                    <PanelLeftClose size={15} />
                  )}
                </button>
                <label className="workspace-context">
                  <span className="sr-only">Active plan</span>
                  <select
                    aria-label="Active plan"
                    value={active?.id ?? ""}
                    onChange={(event) => choosePlan(event.target.value)}
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </label>
                <select
                  aria-label="View gameweek"
                  value={gw}
                  onChange={(event) => {
                    setGw(+event.target.value);
                    setSelected(null);
                    setDetailId(null);
                  }}
                >
                  {(["lineup", "optimise"].includes(tab)
                    ? (active?.weeks.map((row) => row.gw) ?? [])
                    : data.gameweeks
                  ).map((value) => (
                    <option key={value} value={value}>
                      GW{value}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span>{data.season.replace("-", "/")}</span>
            {saveStatus !== "local" && saveStatus !== "loading" && <button
              className="icon-button"
              aria-label={`Shared plans: ${saveStatus}`}
              title={saveStatus === "saved" ? "Saved across devices" : saveStatus === "saving" ? "Saving shared plans…" : "Shared saving needs attention"}
              onClick={() => { setSettingsTab("plans"); setModal("settings"); }}
            >{saveStatus === "saving" ? <LoaderCircle size={15} className="spin" /> : saveStatus === "saved" ? <Check size={15} /> : <Info size={15} />}</button>}
            <button
              className="icon-button"
              onClick={() => openResourceModal("team")}
              title="Import team"
              aria-label="Import team"
            >
              <Users size={15} />
            </button>
          </div>
          <TabStrip
            className="main-nav"
            label="Main navigation"
            value={tab}
            onChange={navigateTab}
            items={tabs.map((item) => ({
              id: item.id,
              label: (
                <>
                  <item.icon size={16} />
                  {item.label}
                </>
              ),
            }))}
          />

          <div
            className={`analytics-body view-${tab}`}
            ref={analyticsRef}
            onScroll={(event) => {
              scrollPositions.current[scrollKey] =
                event.currentTarget.scrollTop;
            }}
          >
            {tab === "lineup" ? (
              <>
                {!showLeftPitch && (
                  <div className="lineup-board-slot">
                    {active && week ? (
                      plannerBoard
                    ) : (
                      <Empty
                        title="Your starting squad"
                        text="Import a public FPL team or build a legal £100m squad."
                      >
                        <button
                          className="button primary"
                          onClick={() => openResourceModal("team")}
                        >
                          Import team
                        </button>
                        <button
                          className="button"
                          disabled={Boolean(busy)}
                          onClick={() => void runSolve(true)}
                        >
                          Build squad
                        </button>
                      </Empty>
                    )}
                  </div>
                )}
                {week ? (
                  <details
                    className="lineup-details"
                    open={showLeftPitch || undefined}
                  >
                    <summary>Squad stats & captain comparison</summary>
                    <TeamOverview
                      data={data}
                      week={week}
                      selected={selectedPlayer}
                      targets={availableTargets}
                      watch={watch}
                      onWatch={onWatch}
                      onDetail={openPlayer}
                      onSelect={setSelected}
                      onTransfer={(id) => void transferIn(id)}
                      onPlayers={() => navigateTab("projections")}
                      onCaptain={setCaptain}
                    />
                  </details>
                ) : null}
              </>
            ) : tab === "projections" ? (
              <ProjectionsView
                data={data}
                gw={gw}
                onDetail={(id, gameweek) =>
                  openPlayer(id, gameweek ?? gw, false, active, true)
                }
                onEditorTarget={setProjectionEditorTarget}
                editing={
                  detailInline && detailId !== null
                    ? { id: detailId, gw: playerGW }
                    : null
                }
                watch={watch}
                onWatch={onWatch}
                onCSV={() => {
                  setCsvError("");
                  setCsvWeight(Math.round(blendWeight * 100) || 50);
                  setModal("csv");
                }}
                onExport={exportCSV}
                teamStrengths={teamStrengths}
                onTeamStrengths={setTeamStrengths}
                fixtureMoves={fixtureMoves}
                onFixtureMoves={setFixtureMoves}
                selectedPlayer={selectedPlayer}
                squad={week?.squad ?? []}
                onTransfer={(id) => void transferIn(id)}
                onCancelTransfer={() => setSelected(null)}
              />
            ) : tab === "data" ? (
              <Suspense fallback={<Busy text="Loading season stats…" />}>
                <SeasonData data={data} onDetail={openPlayer} />
              </Suspense>
            ) : tab === "fixtures" ? (
              <FixturesView data={data} gw={gw} onDetail={openPlayer} />
            ) : tab === "optimise" ? (
              <>
                <OptimiseView
                  data={data}
                  plan={active}
                  gw={gw}
                  settings={settings}
                  onSettings={setSettings}
                  onSolve={runSolve}
                  result={solveResult}
                  busy={Boolean(busy)}
                  resultFresh={solveContext?.fresh}
                  baselinePlan={solveContext?.baselinePlan}
                  onApply={() => void applySolve()}
                  onDetail={(id, week) =>
                    openPlayer(id, week ?? gw, Boolean(solveResult))
                  }
                  onPreviewGW={(value) => {
                    setDraftGW(value);
                    setPreviewingDraft(true);
                  }}
                />
                <ChipPlanner
                  plan={active}
                  forecast={forecastArgs}
                  busy={Boolean(busy)}
                  onApply={applyChipPlan}
                  onNotify={notify}
                />
                <ChipStrategyView
                  data={data}
                  plan={active}
                  gw={gw}
                  strategy={settings}
                  forecast={forecastArgs}
                  busy={Boolean(busy)}
                  onApply={applyChipStrategy}
                />
                <SensitivityView
                  data={data}
                  plan={active}
                  strategy={settings}
                  forecast={forecastArgs}
                  busy={Boolean(busy)}
                  onApply={(job, weeks, label) =>
                    void applyStress(job, weeks, label)
                  }
                  onDetail={openPlayer}
                />
              </>
            ) : tab === "analysis" ? (
              <AnalysisView
                data={data}
                plans={plans}
                active={active}
                evalData={evalData}
                busy={Boolean(busy)}
                onSnapshot={snapshot}
                prospective={prospective}
                onScore={scoreProspective}
                selectedGW={gw}
                onPlan={choosePlan}
                onDetail={openPlayer}
                onLock={(id) => togglePlayerConstraint(id, "locked")}
              />
            ) : (
              <>
                <TabStrip
                  className="market-mode segmented"
                  label="Market view"
                  value={marketMode}
                  onChange={setMarketMode}
                  items={[
                    { id: "fixtures", label: "Fixture markets" },
                    { id: "movement", label: "Movement" },
                    { id: "prices", label: "Prices" },
                    { id: "references", label: "Shortlists" },
                  ]}
                />
                {marketMode === "fixtures" ? (
                  <FixtureMarkets data={data} gw={gw} onDetail={openPlayer} />
                ) : marketMode === "movement" ? (
                  <MarketMovement gw={gw} />
                ) : marketMode === "prices" ? (
                  <MarketView
                    data={data}
                    gw={gw}
                    onDetail={openPlayer}
                    watch={watch}
                    onWatch={onWatch}
                  />
                ) : (
                  <ReferenceView
                    data={data}
                    gw={gw}
                    onDetail={openPlayer}
                    watch={watch}
                    onWatch={onWatch}
                  />
                )}
              </>
            )}
          </div>

          <footer className="studio-feed-footer">
            <button onClick={() => setModal("settings")}>
              <i
                className={
                  Object.values(data.sources).some(
                    (source) =>
                      source.status === "stale" ||
                      source.status === "unavailable",
                  )
                    ? "stale"
                    : ""
                }
              />
              Sources · {pastRefresh}
              <Info size={11} />
            </button>
            <span>
              {data.players.length} players · GW{data.gameweeks[0]}–
              {data.gameweeks.at(-1)}
            </span>
          </footer>
        </main>
      </div>

      {busy && !(tab === "lineup" && Boolean(week)) && (
        <div className="global-busy" role="status" aria-live="polite">
          <LoaderCircle size={14} className="spin" />
          <span>{planBusyLabel}</span>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <Info size={17} /> : <Check size={17} />}
          <span>{planToastText}</span>
          {toast.action ? (
            <button
              className="toast-undo"
              onClick={() => {
                const run = toast.action!.run;
                setToast(null);
                run();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal === "lineupImage" && active && week && (
        <LineupImageDialog
          data={data}
          plan={active}
          week={week}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "resources" && active && (
        <Modal
          title="Starting resources"
          subtitle={`Entering GW${active.weeks[0]?.gw}`}
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <div className="field-grid">
              <label>
                Bank (£m)
                <input
                  aria-label="Starting bank"
                  type="number"
                  min="0"
                  max="200"
                  step="0.1"
                  value={Number.isFinite(teamBank) ? teamBank : ""}
                  onChange={(event) =>
                    setTeamBank(
                      event.target.value === "" ? NaN : +event.target.value,
                    )
                  }
                />
              </label>
              <label>
                Free transfers
                <select
                  aria-label="Starting free transfers"
                  value={teamFT}
                  onChange={(event) => setTeamFT(+event.target.value)}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="button primary full"
              disabled={Boolean(busy)}
              onClick={() => void saveTeamSettings()}
            >
              Save resources
            </button>
          </div>
        </Modal>
      )}
      {modal === "team" && (
        <Modal
          title="Import team"
          subtitle="Public FPL team ID"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <label className="form-label">
              FPL team ID
              <div className="input-button">
                <input
                  inputMode="numeric"
                  placeholder="e.g. 123456"
                  aria-label="FPL team ID"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value.replace(/\D/g, ""))}
                />
                <button
                  className="button primary"
                  disabled={!teamId || !!busy}
                  onClick={importTeam}
                >
                  Import
                  <ArrowRight size={15} />
                </button>
              </div>
            </label>
            <p className="help-text">
              From your FPL Points URL: /entry/<b>123456</b>/event/… (latest
              published squad).
            </p>
            <div className="divider" />
            <h3>Starting resources</h3>
            <p className="help-text">
              Verify bank and FTs; purchase prices may use first observed
              values.
            </p>
            <div className="field-grid">
              <label>
                Starting bank (£m)
                <input
                  aria-label="Starting bank"
                  type="number"
                  min="0"
                  max="200"
                  step="0.1"
                  value={Number.isFinite(teamBank) ? teamBank : ""}
                  onChange={(e) =>
                    setTeamBank(e.target.value === "" ? NaN : +e.target.value)
                  }
                />
              </label>
              <label>
                Saved free transfers
                <select
                  aria-label="Saved free transfers"
                  value={teamFT}
                  onChange={(e) => setTeamFT(+e.target.value)}
                >
                  {[0, 1, 2, 3, 4, 5].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="button full"
              disabled={!active || !!busy}
              onClick={() => void saveTeamSettings()}
            >
              Update plan resources
            </button>
            <p className="privacy-note">
              <ShieldCheck size={14} />
              {saveStatus === "local"
                ? "Saved locally."
                : "Synced across devices."}{" "}
              Never submits transfers to FPL.
            </p>
          </div>
        </Modal>
      )}
      {modal === "csv" && (
        <Modal
          title="Import CSV"
          subtitle="Blend external points or load minutes scenarios"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p className="help-text">
              Columns: <code>player_id, gameweek, expected_points</code>,
              provider <code>ID, 6_Pts, …</code>, or{" "}
              <code>
                player_id, [gameweek,] conditional_minutes[, availability]
              </code>{" "}
              (0–1; schedules override blends).
            </p>
            <label className="range-label">
              Imported model weight<b>{csvWeight}%</b>
              <input
                aria-label="Imported model weight"
                type="range"
                min="0"
                max="100"
                step="5"
                value={csvWeight}
                onChange={(e) => setCsvWeight(+e.target.value)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <b>Extend beyond imported weeks</b>
                <small>
                  Fading fixture-aware point adjustment; components and
                  simulations keep the base model
                </small>
              </span>
              <input
                type="checkbox"
                checked={extrapolate}
                onChange={(e) => setExtrapolate(e.target.checked)}
                aria-label="Extrapolate imported forecasts"
              />
            </label>
            <label className="upload-zone">
              <Upload size={25} />
              <b>Select a projection CSV</b>
              <span>Current FPL IDs · up to 5 MB</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importCSV(file);
                }}
              />
            </label>
            {csvError && <p className="news-alert">{csvError}</p>}
            <button
              className="button full"
              onClick={() =>
                download(
                  "open-fpl-import-template.csv",
                  `player_id,gameweek,expected_points\r\n${data.players[0].id},${data.next_gw},${fmt(xp(data.players[0], data.next_gw), 2)}\r\n`,
                  "text/csv",
                )
              }
            >
              <Download size={15} />
              Download template
            </button>
          </div>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal
          title="Settings"
          subtitle="Forecasts, backups and sources"
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body">
            <TabStrip
              label="Settings views"
              value={settingsTab}
              onChange={setSettingsTab}
              items={[
                { id: "inputs", label: "Forecast inputs" },
                { id: "plans", label: "Plans & backups" },
                { id: "sources", label: "Sources" },
              ]}
            />
            <div className="settings-body">
              <section hidden={settingsTab !== "inputs"}>
                <h3>Forecast inputs</h3>
                <DataRefreshSettings />
                <label className="toggle-row">
                  <span>
                    <b>Use available Solio predictions</b>
                    <small>
                      Use supplied points; extrapolate the full window when enabled
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    aria-label="Use Solio predictions"
                    checked={useSolio}
                    onChange={(e) => setUseSolio(e.target.checked)}
                  />
                </label>
                <p className="help-text" role="status">
                  {data.solio?.gameweek
                    ? `Solio GW${data.solio.gameweek}${data.solio.weeks.length > 1 ? `–${data.solio.weeks[data.solio.weeks.length - 1]}` : ""}: ${data.solio.matched_players}/${data.solio.pool_players} players; ${data.solio.applied_forecasts} values applied. `
                    : "Solio predictions unavailable. "}
                  {data.solio?.full_planner_connected
                    ? `Signed-in planner. ${data.solio.unpurchaseable_players ?? data.solio.omitted_players ?? 0} unpurchaseable${data.solio.unlisted_players ? `; ${data.solio.unlisted_players} not yet listed` : ""}. `
                    : "Public next-week shortlist. Full planner unavailable. "}
                  {data.solio?.status && !["shortlist_only", "planner"].includes(data.solio.status)
                    ? ` ${data.solio.status.replaceAll("_", " ")}; using our model.`
                    : ""}
                  {data.solio?.source_status === "stale"
                    ? " Source stale; using our model."
                    : ""}
                </p>
                <label className="toggle-row">
                  <span>
                    <b>Market and Elevenify team inputs</b>
                    <small>
                      Turn off to use historical team estimates only
                    </small>
                  </span>
                  <input
                    aria-label="Use market and Elevenify inputs"
                    type="checkbox"
                    checked={useMarket}
                    onChange={(e) => setUseMarket(e.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <span>
                    <b>FPL Form player forecasts</b>
                    <small>Public player points and appearance estimates</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={useProvider}
                    onChange={(e) => setUseProvider(e.target.checked)}
                    aria-label="Use FPL Form forecasts"
                  />
                </label>
                <label className="range-label">
                  FPL Form weight <b>{fmt(providerWeight * 100, 0)}%</b>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={providerWeight * 100}
                    onChange={(e) => setProviderWeight(+e.target.value / 100)}
                    aria-label="FPL Form weight"
                  />
                </label>
                <label className="toggle-row">
                  <span>
                    <b>Extrapolate short-range forecasts</b>
                    <small>
                      Provider anchors fade toward the fixture component model
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={extrapolate}
                    onChange={(e) => setExtrapolate(e.target.checked)}
                    aria-label="Use forecast extrapolation"
                  />
                </label>
                <label className="range-label">
                  Anchor influence half-life <b>{anchorHalfLife} GWs</b>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    value={anchorHalfLife}
                    onChange={(e) => setAnchorHalfLife(+e.target.value)}
                    aria-label="Anchor influence half-life"
                  />
                </label>
                <p className="help-text">
                  The historical benchmark tests the component model. These
                  provider blends and extrapolations need separate prospective
                  evaluation.{" "}
                  <a
                    href="https://www.fplform.com/export-fpl-form-data"
                    target="_blank"
                    rel="noreferrer"
                  >
                    FPL Form source
                  </a>
                </p>
                <div className="setting-row">
                  <span>
                    <b>Manual minutes scenarios</b>
                    <small>
                      {
                        new Set([
                          ...Object.keys(overrides),
                          ...Object.keys(minutesSchedule),
                        ]).size
                      }{" "}
                      players customised
                    </small>
                  </span>
                  <button
                    className="button small"
                    disabled={
                      !Object.keys(overrides).length &&
                      !Object.keys(minutesSchedule).length
                    }
                    onClick={() => {
                      setOverrides({});
                      setMinutesSchedule({});
                      notify("Minutes scenarios cleared.");
                    }}
                  >
                    Reset all
                  </button>
                </div>
                <div className="setting-row">
                  <span>
                    <b>Team strength assumptions</b>
                    <small>
                      {Object.keys(teamStrengths).length} clubs customised
                    </small>
                  </span>
                  <button
                    className="button small"
                    disabled={!Object.keys(teamStrengths).length}
                    onClick={() => {
                      setTeamStrengths({});
                      notify("Team strengths restored.");
                    }}
                  >
                    Reset all
                  </button>
                </div>
                <div className="setting-row">
                  <span>
                    <b>Imported points model</b>
                    <small>
                      {customName || "No external CSV loaded"} ·{" "}
                      {fmt(blendWeight * 100, 0)}% weight
                    </small>
                  </span>
                  <button
                    className="button small"
                    disabled={
                      !Object.keys(customPoints).length &&
                      !customName &&
                      blendWeight === 0
                    }
                    onClick={() => {
                      setCustomPoints({});
                      setBlendWeight(0);
                      setCustomName("");
                      notify("Imported CSV cleared.");
                    }}
                  >
                    Clear
                  </button>
                </div>
              </section>
              <section hidden={settingsTab !== "plans"}>
                <div className="setting-row">
                  <span>
                    <b>{({ local: "Saved in this browser", loading: "Connecting shared plans…", saved: "Saved across devices", saving: "Saving shared plans…", error: "Shared saving paused", conflict: "Plans changed on another device" })[saveStatus]}</b>
                    {(saveStatus === "error" || saveStatus === "conflict") && <small>Your local copy is retained.</small>}
                  </span>
                  {saveStatus === "error" && <button className="button small" onClick={() => void sharedRef.current!.flush()}>Retry save</button>}
                  {saveStatus === "conflict" && <button className="button small" onClick={() => {
                    download("open-fpl-before-sync.json", JSON.stringify(createPlanExport(plans, forecastArgs, settings), null, 2));
                    void sharedRef.current!.pull((document, current) => adoptSharedRef.current(document, current), true);
                  }}>Back up &amp; load shared</button>}
                  {window.location.hostname.endsWith("workers.dev") && <form method="post" action="/auth/signout"><button className="button small" type="submit">Sign out</button></form>}
                </div>
                <h3>Planning branches</h3>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={() =>
                      download(
                        "open-fpl-plans.json",
                        JSON.stringify(
                          createPlanExport(plans, forecastArgs, settings),
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    <Download size={15} />
                    Export plans
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      const json = JSON.stringify(
                        createPlanExport(plans, forecastArgs, settings),
                        null,
                        2,
                      );
                      setBackupText(json);
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(json).then(
                          () => notify("Backup copied."),
                          () => notify("Backup ready below."),
                        );
                      } else {
                        notify("Backup ready below.");
                      }
                    }}
                  >
                    <Copy size={15} />
                    Backup text
                  </button>
                  <button
                    className="button"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload size={15} />
                    Import plans
                  </button>
                  <input
                    hidden
                    ref={fileRef}
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      if (e.target.files?.[0])
                        void importPlans(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
                {backupText && (
                  <label>
                    Plan backup
                    <textarea
                      aria-label="Plan backup JSON"
                      readOnly
                      rows={4}
                      value={backupText}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                )}
                <details className="compact-details">
                  <summary>Paste a backup</summary>
                  <textarea
                    aria-label="Import backup JSON"
                    rows={4}
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                    placeholder="Paste Open FPL backup JSON"
                  />
                  <button
                    className="button small"
                    disabled={!importText.trim() || Boolean(busy)}
                    onClick={() =>
                      void importPlans(
                        new File([importText], "pasted-plan-backup.json", {
                          type: "application/json",
                        }),
                      )
                    }
                  >
                    <Upload size={14} />
                    Import backup
                  </button>
                </details>
                <p className="help-text">
                  Checked against current FPL rules on import.
                </p>
                <button
                  className="button full"
                  onClick={refresh}
                  disabled={!!busy}
                >
                  <RefreshCw size={15} />
                  Refresh public feeds
                </button>
                {deletedPlans.length ? (
                  <details className="compact-details deleted-plans">
                    <summary>Deleted plans · {deletedPlans.length}</summary>
                    {deletedPlans.map((plan) => (
                      <div key={plan.id}>
                        <span>{plan.name}</span>
                        <button
                          className="button small"
                          disabled={Boolean(busy)}
                          onClick={() => void restoreDeleted(plan)}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </details>
                ) : null}
              </section>
              <section hidden={settingsTab !== "sources"}>
                <h3>Connected sources</h3>
                {Object.entries(data.sources)
                  .filter(([key]) =>
                    [
                      "fpl_bootstrap",
                      "fpl_fixtures",
                      "fpljoe",
                      "elevenify_sheet",
                      "solio_public",
                      `fplform_${data.season}_gw${data.next_gw}`,
                      "archive_2025-26_gws",
                    ].includes(key),
                  )
                  .map(([key, s]) => (
                    <a
                      className="source-setting"
                      key={key}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span
                        className={`status-dot ${s.status === "stale" || s.status === "unavailable" ? "stale" : ""}`}
                        aria-hidden="true"
                      />
                      <span>
                        <b>{key.replaceAll("_", " ")}</b>
                        <small>
                          {s.fetched_at
                            ? new Date(s.fetched_at).toLocaleString()
                            : "Unavailable"}
                        </small>
                      </span>
                      <span className="subtle-tag">{s.status}</span>
                      <ArrowUpRight size={14} />
                    </a>
                  ))}
                <p className="help-text">
                  Vendor data is locally cached and attributed. Public access is
                  not an unrestricted redistribution licence.
                </p>
                <details className="compact-details">
                  <summary>Model limitations</summary>
                  {data.limitations.map((l) => (
                    <p className="limitation" key={l}>
                      <Info size={13} />
                      {l}
                    </p>
                  ))}
                </details>
              </section>
            </div>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Quick guide"
          subtitle="Forecasts, planning and evaluation"
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body">
            <div className="help-grid">
              {[
                [
                  "1",
                  "Import squad",
                  "Load a public FPL ID or £100m squad, then verify bank and free transfers.",
                ],
                [
                  "2",
                  "Inspect forecasts",
                  "Browse projections and fixtures. Click a player to inspect components or edit minutes.",
                ],
                [
                  "3",
                  "Plan branches",
                  "Make transfers, set captains and chips, and duplicate branches to compare routes.",
                ],
                [
                  "4",
                  "Optimise & score",
                  "Run constrained solves and save pre-deadline snapshots for prospective scoring.",
                ],
              ].map(([n, t, p]) => (
                <div key={n}>
                  <span>{n}</span>
                  <h3>{t}</h3>
                  <p>{p}</p>
                </div>
              ))}
            </div>
            <div className="divider" />
            <h3>Model &amp; limits</h3>
            <p>
              Expected points combine appearance/60-minute probabilities,
              shrunk xG/xA rates, fixture team expectations and official FPL
              scoring, with independent autosub and vice-captain fallback.
              Bonus uses a historical rate; probabilities and simulated ranges
              are uncalibrated, and manual minutes are conditional scenarios.
            </p>
            <p>
              Walk-forward component benchmarks live in Plans. Provider blends
              require prospective pre-deadline scoring; paid-provider parity is
              unproven.
            </p>
            <div className="reference-links">
              <a
                href="https://solioanalytics.com/"
                target="_blank"
                rel="noreferrer"
              >
                Visual reference: Solio
                <ArrowUpRight size={13} />
              </a>
              <a
                href="https://www.fpljoe.com/"
                target="_blank"
                rel="noreferrer"
              >
                Team projections: FPL Joe
                <ArrowUpRight size={13} />
              </a>
              <a
                href="https://www.elevenify.com/p/premier-league-data"
                target="_blank"
                rel="noreferrer"
              >
                Team model: Elevenify
                <ArrowUpRight size={13} />
              </a>
              <a
                href="https://github.com/vaastav/Fantasy-Premier-League"
                target="_blank"
                rel="noreferrer"
              >
                Historical FPL archives
                <ArrowUpRight size={13} />
              </a>
              <a
                href="https://docs.fplreview.com/"
                target="_blank"
                rel="noreferrer"
              >
                FPL Review methodology
                <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
        </Modal>
      )}
      {detailId !== null && detailPlayer && (
        <PlayerSurface
          title={detailPlayer.name}
          subtitle={`${detailPlayer.team_name} · ${detailPlayer.position} · ${money(detailPlayer.price)} · GW${playerGW}`}
          onClose={() => setDetailId(null)}
          anchor={detailAnchor}
          target={
            detailInline && tab === "projections"
              ? projectionEditorTarget
              : null
          }
        >
          <div className={`modal-body player-detail detail-tab-${detailTab}`}>
            {!(detailInline && tab === "projections" && projectionEditorTarget) &&
              !(detailAnchor && wideLayout) &&
              forecastFeedback}
            <div className="player-context-bar">
              {detailReadOnly ? (
                <span className="subtle-tag">Draft preview</span>
              ) : null}
              {detailBack !== null ? (
                <button
                  className="button small"
                  onClick={() => {
                    setDetailId(detailBack);
                    setDetailBack(null);
                    setDetailTab("transfer");
                  }}
                >
                  <ArrowLeft size={14} />
                  Back to shortlist
                </button>
              ) : (
                <div className="player-neighbours">
                  {[-1, 1].map((offset) => (
                    <button
                      key={offset}
                      className="icon-button"
                      aria-label={
                        offset < 0
                          ? "Previous squad player"
                          : "Next squad player"
                      }
                      disabled={!detailSquad || Boolean(busy)}
                      onClick={() => {
                        const squad = detailWeek!.squad;
                        const index = squad.indexOf(detailId);
                        openPlayer(
                          squad[(index + offset + squad.length) % squad.length],
                          playerGW,
                          false,
                          active,
                          detailInline,
                          true,
                        );
                      }}
                    >
                      {offset < 0 ? (
                        <ChevronLeft size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <select
                aria-label="Player gameweek"
                disabled={Boolean(busy)}
                value={playerGW}
                onChange={(event) => setDetailGW(+event.target.value)}
              >
                {data.gameweeks.map((value) => (
                  <option key={value} value={value}>
                    GW{value}
                  </option>
                ))}
              </select>
              <button
                className={`icon-button ${watch.includes(detailId) ? "starred" : ""}`}
                aria-label={`Watch ${detailPlayer.name}`}
                aria-pressed={watch.includes(detailId)}
                onClick={() => onWatch(detailId)}
              >
                <Star
                  size={17}
                  fill={watch.includes(detailId) ? "currentColor" : "none"}
                />
              </button>
            </div>
            <div className="player-detail-top">
              <Shirt player={detailPlayer} />
              <Stat
                label={`GW${playerGW} xPts`}
                value={fmt(xp(detailPlayer, playerGW), 2)}
                accent
              />
              <Stat
                label="xMins"
                value={fmt(detailPlayer.gw[String(playerGW)]?.xmins ?? 0, 0)}
              />
              <Stat
                label="Ownership"
                value={`${fmt(detailPlayer.ownership)}%`}
              />
            </div>
            <div className="player-dialog-actions">
              {!detailReadOnly && (
                <>
                  <button
                    className={`button small ${detailWeek?.captain === detailId ? "selected" : ""}`}
                    aria-pressed={detailWeek?.captain === detailId}
                    title="Captain"
                    disabled={
                      Boolean(busy) || !detailWeek?.starters.includes(detailId)
                    }
                    onClick={() => setCaptain(detailId, false, playerGW)}
                  >
                    Captain
                  </button>
                  <button
                    className={`button small ${detailWeek?.vice === detailId ? "selected" : ""}`}
                    aria-pressed={detailWeek?.vice === detailId}
                    title="Vice-captain"
                    disabled={
                      Boolean(busy) || !detailWeek?.starters.includes(detailId)
                    }
                    onClick={() => setCaptain(detailId, true, playerGW)}
                  >
                    Vice
                  </button>
                </>
              )}
              <button
                className={`button small ${settings.locked.includes(detailId) ? "selected" : ""}`}
                aria-pressed={settings.locked.includes(detailId)}
                title="Include in every solved gameweek"
                onClick={() => togglePlayerConstraint(detailId, "locked")}
              >
                <LockKeyhole size={14} />
                Lock
              </button>
              <button
                className={`button small ${settings.excluded.includes(detailId) ? "selected" : ""}`}
                aria-pressed={settings.excluded.includes(detailId)}
                title="Exclude from every solved gameweek"
                onClick={() => togglePlayerConstraint(detailId, "excluded")}
              >
                <Ban size={14} />
                Ban
              </button>
              {!detailReadOnly && detailSquad ? (
                <button
                  className="button small"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setSelected(detailId);
                    navigateTab("lineup", playerGW);
                  }}
                >
                  <ArrowLeftRight size={14} />
                  Substitute
                </button>
              ) : null}
              {!detailReadOnly &&
              detailWeek?.bench.includes(detailId) &&
              detailPlayer.position_id !== 1 ? (
                <>
                  <button
                    className="button small"
                    disabled={
                      Boolean(busy) || detailWeek.bench.indexOf(detailId) <= 1
                    }
                    onClick={() => moveBench(-1, detailId, playerGW)}
                  >
                    Bench ↑
                  </button>
                  <button
                    className="button small"
                    disabled={
                      Boolean(busy) || detailWeek.bench.indexOf(detailId) >= 3
                    }
                    onClick={() => moveBench(1, detailId, playerGW)}
                  >
                    Bench ↓
                  </button>
                </>
              ) : null}
            </div>
            <TabStrip
              className="segmented player-detail-tabs"
              label="Player views"
              value={detailTab}
              onChange={setDetailTab}
              items={[
                ...(detailSquad ? [{ id: "transfer", label: "Transfer" }] : []),
                { id: "edit", label: "Edit" },
                { id: "overview", label: "Breakdown" },
                { id: "history", label: "History" },
              ]}
            />
            {detailTab === "transfer" && detailSquad && active && detailWeek ? (
              <TransferPanel
                key={`${active.id}-${detailId}-${playerGW}`}
                data={data}
                plan={active}
                week={detailWeek}
                outgoing={detailPlayer}
                busy={Boolean(busy)}
                watch={watch}
                onWatch={onWatch}
                onInspect={(id) => {
                  setDetailBack(detailId);
                  setDetailId(id);
                  setDetailTab("overview");
                }}
                onTransfer={async (id) => {
                  const view = transferView;
                  const ok = await transferIn(id, detailId, playerGW);
                  if (ok && liveTransferViewRef.current === view) {
                    setDetailId(null);
                    if (!detailInline) {
                      setGw(playerGW);
                      setTab("lineup");
                    }
                  }
                  return ok;
                }}
              />
            ) : null}
            {detailPlayer.news && detailTab === "edit" ? (
              <details className="editor-team-news">
                <summary>Team news</summary>
                <p>{detailPlayer.news}</p>
              </details>
            ) : detailPlayer.news ? (
              <p className="news-alert">
                Official team news: {detailPlayer.news}
              </p>
            ) : null}
            <div className="detail-grid">
              <section>
                <h3>Where the points come from</h3>
                <div className="component-bars">
                  {Object.entries(
                    detailPlayer.gw[String(playerGW)]?.components ?? {},
                  ).map(([key, value]) => (
                    <div key={key}>
                      <span>{key.replaceAll("_", " ")}</span>
                      <div>
                        <i
                          className={value < 0 ? "negative" : ""}
                          style={{
                            width: `${Math.min(100, (Math.abs(value) / 4) * 100)}%`,
                          }}
                        />
                      </div>
                      <b className={value < 0 ? "red" : ""}>
                        {value > 0 ? "+" : ""}
                        {fmt(value, 2)}
                      </b>
                    </div>
                  ))}
                </div>
                <div className="component-total">
                  <b>Total expected points</b>
                  <strong>{fmt(xp(detailPlayer, playerGW), 2)}</strong>
                </div>
                <p className="source-caption">
                  Current scoring configuration from the official FPL API. Bonus
                  uses a historical rate.
                </p>
              </section>
              <section>
                <StatScenarioEditor
                  key={`stats-${detailId}-${playerGW}`}
                  player={detailPlayer}
                  weeks={data.gameweeks}
                  gw={playerGW}
                  onGWChange={setDetailGW}
                  schedule={statSchedule[String(detailId)] ?? {}}
                  onSchedule={(schedule) =>
                    setStatSchedule((current) => {
                      const next = { ...current };
                      if (Object.keys(schedule).length)
                        next[String(detailId)] = schedule;
                      else delete next[String(detailId)];
                      return next;
                    })
                  }
                  onNotify={notify}
                />
                <details className="player-minutes-options" open>
                  <summary>Edit minutes</summary>
                  <MinutesScenarioEditor
                    key={`minutes-${detailId}-${playerGW}`}
                    player={detailPlayer}
                    weeks={data.gameweeks}
                    gw={playerGW}
                    onGWChange={setDetailGW}
                    globalMinutes={overrides[String(detailId)]}
                    schedule={minutesSchedule[String(detailId)] ?? {}}
                    onSchedule={(schedule) =>
                      setMinutesSchedule((current) => {
                        const next = { ...current };
                        if (Object.keys(schedule).length)
                          next[String(detailId)] = schedule;
                        else delete next[String(detailId)];
                        return next;
                      })
                    }
                    onReset={() => {
                      setOverrides((current) => {
                        const next = { ...current };
                        delete next[String(detailId)];
                        return next;
                      });
                      setMinutesSchedule((current) => {
                        const next = { ...current };
                        delete next[String(detailId)];
                        return next;
                      });
                      notify(
                        `${detailPlayer.name}: Minutes edits cleared.`,
                      );
                    }}
                    onNotify={notify}
                  />
                </details>
                <div className="player-underlying">
                  <span>
                    xG / 90 <b>{fmt(detailPlayer.xg90, 2)}</b>
                  </span>
                  <span>
                    xA / 90 <b>{fmt(detailPlayer.xa90, 2)}</b>
                  </span>
                  <span>
                    DC hit model{" "}
                    <b>{fmt(detailPlayer.dc_probability * 100, 0)}%</b>
                  </span>
                </div>
                <div className="fixture-source-detail">
                  {detailPlayer.gw[String(playerGW)]?.fixtures.map((f) => (
                    <p key={f.id}>
                      <Badge
                        code={
                          data.teams.find((t) => t.id === f.opponent_id)?.code
                        }
                        size={18}
                      />
                      <span>
                        <b>
                          {f.opponent} ({f.home ? "H" : "A"}) ·{" "}
                          {fmt(f.cs * 100, 0)}% CS
                        </b>
                        <small>{f.source}</small>
                      </span>
                    </p>
                  ))}
                </div>
              </section>
            </div>
            <section className="detail-forecast">
              <h3>The upcoming run</h3>
              <LineChart
                height={165}
                series={[
                  {
                    name: "Expected points",
                    values: data.gameweeks.map((w) => xp(detailPlayer, w)),
                  },
                ]}
                labels={data.gameweeks.map((w) => `GW${w}`)}
              />
            </section>
            {detailTab === "history" &&
              (detailLoading ? (
                <Busy text="Loading match history and scenario simulation…" />
              ) : (
                detail && (
                  <>
                    <div className="detail-grid history-grid">
                      <section>
                        <h3>Simulated points</h3>
                        <div className="distribution-chart">
                          {detail.simulation.histogram.map((v) => {
                            const showLabel =
                              detail.simulation.histogram.length <= 14 ||
                              v.points % 2 === 0;
                            return (
                              <div
                                key={v.points}
                                title={`${v.points} points · ${fmt(v.probability * 100, 1)}%`}
                              >
                                <i
                                  style={{
                                    height: `${Math.max(2, (v.probability / Math.max(...detail.simulation.histogram.map((x) => x.probability))) * 95)}px`,
                                  }}
                                />
                                <span aria-hidden={!showLabel || undefined}>
                                  {showLabel ? v.points : "\u00a0"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="distribution-stats">
                          <span>
                            ≤2 points{" "}
                            <b>
                              {fmt(
                                detail.simulation.blank_probability * 100,
                                0,
                              )}
                              %
                            </b>
                          </span>
                          <span>
                            10+ points{" "}
                            <b>
                              {fmt(detail.simulation.haul_probability * 100, 0)}
                              %
                            </b>
                          </span>
                          <span>
                            10th–90th percentile{" "}
                            <b>
                              {fmt(detail.simulation.p10, 0)}–
                              {fmt(detail.simulation.p90, 0)}
                            </b>
                          </span>
                        </div>
                        <p className="source-caption">
                          {detail.simulation.label} ·{" "}
                          {detail.simulation.trials.toLocaleString()} trials.
                          Base model, excluding custom overrides/blends.
                        </p>
                      </section>
                      <section>
                        <h3>Recent match record</h3>
                        <div className="history-list">
                          {!detail.history.length ? (
                            <p className="inline-empty">
                              No recent match records.
                            </p>
                          ) : null}
                          {detail.history
                            .slice(-6)
                            .reverse()
                            .map((r, i) => (
                              <div key={`${r.date}-${i}`}>
                                <span>
                                  GW{r.gw}
                                  <small>{r.season}</small>
                                </span>
                                <span>{r.opponent || "—"}</span>
                                <span>{r.minutes} min</span>
                                <b>{r.total_points} pts</b>
                              </div>
                            ))}
                        </div>
                        <p className="source-caption">
                          Official FPL and vaastav archive · per-fixture actual
                          points
                        </p>
                      </section>
                    </div>
                  </>
                )
              ))}
          </div>
        </PlayerSurface>
      )}
    </div>
  );
}
function Clock3Icon() {
  return <CalendarDays size={13} />;
}
