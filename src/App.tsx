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
  GitBranch,
  Info,
  LayoutGrid,
  LockKeyhole,
  Ban,
  ArrowLeft,
  ArrowLeftRight,
  Link2,
  LoaderCircle,
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
  createPlanExport,
  defaultSolverSettings,
  loadPlanningState,
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
  const selectedPlayer = selected === null ? null : lookup.get(selected);
  const detailPlayer = detailId === null ? null : lookup.get(detailId);
  const playerGW = detailGW || gw;
  const detailWeek = detailReadOnly
    ? undefined
    : active?.weeks.find((row) => row.gw === playerGW);
  const detailSquad = detailWeek?.squad.includes(detailId ?? 0) ?? false;
  const currentHorizon = active?.weeks ?? [];

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
    const archives = stored<unknown[]>("open-fpl-archived-plans-v1", []);
    localStorage.setItem(
      "open-fpl-archived-plans-v1",
      JSON.stringify([
        ...(Array.isArray(archives) ? archives : []),
        {
          archived_at: new Date().toISOString(),
          plans: savedPlans,
          configuration,
        },
      ]),
    );
  }

  function sharedDocument(): SharedDocument {
    return { version: 1, plans, configuration: forecastArgs, solver_settings: settings, active_id: activeId, watch };
  }

  async function adoptShared(document: SharedDocument, current: () => boolean) {
    const fingerprint = () => { const { data: _data, ...state } = livePlanningRef.current; return JSON.stringify(state); };
    const before = fingerprint();
    const version = operationVersionRef.current;
    if (!canStartOperation()) return false;
    const restored = await loadPlanningState(document.plans, document.active_id, document.configuration,
      document.solver_settings, configuration => configuration === undefined
        ? forecastBaseline() : api<Bootstrap>("/projections", configuration));
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
    setData(restored.forecast);
    setPlans(restored.plans);
    setActiveId(restored.activeId);
    setGw(restored.gw);
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
    sharedRef.current!.initialize(sharedDocument()).then(document => {
      if (!alive) throw new Error("Workspace loading cancelled.");
      if (plans.length && JSON.stringify(document.plans) !== JSON.stringify(plans)) {
        archivePlanningInputs(plans, forecastArgs);
      }
      setWatch(document.watch);
      return loadPlanningState(
      document.plans,
      document.active_id,
      document.configuration,
      document.solver_settings,
      (configuration) =>
        configuration === undefined
          ? forecastBaseline()
          : api<Bootstrap>("/projections", configuration),
    ); })
      .then((restored) => {
        if (!alive) return;
        if (
          restored.notices.length ||
          (Array.isArray(plans) &&
            plans.some(
              (plan) =>
                plan &&
                Array.isArray(plan.weeks) &&
                plan.weeks.some((week) => week.gw < restored.forecast.next_gw),
            ))
        ) {
          archivePlanningInputs(plans, forecastArgs);
        }
        loadedForecastArgsRef.current = JSON.stringify(restored.configuration);
        applyForecastConfiguration(restored.configuration);
        setSettings(restored.solver);
        setData(restored.forecast);
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
        setPlans(restored.plans);
        setLoading(false);
        if (restored.notices.length) notify(restored.notices.join(" "));
      })
      .catch((e) => {
        if (alive) {
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
    };
  }, []);

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
        current.renderedOperationVersion !== operationVersionRef.current
      ) return;
      checking = true;
      const version = operationVersionRef.current;
      try {
        const status = await api<DataRefreshStatus>("/data-refresh");
        if (
          !status.loaded_at ||
          Date.parse(status.loaded_at) <= Date.parse(current.data.loaded_at)
        )
          return;
        const request = ++dataRequestRef.current;
        const restored = await loadPlanningState(
          current.plans,
          current.activeId,
          current.forecastArgs,
          current.settings,
          (configuration) =>
            configuration === undefined
              ? forecastBaseline()
              : api<Bootstrap>("/projections", configuration),
        );
        const latest = livePlanningRef.current;
        if (
          !alive ||
          request !== dataRequestRef.current ||
          operationRef.current ||
          version !== operationVersionRef.current ||
          latest.plans !== current.plans ||
          latest.activeId !== current.activeId ||
          latest.settings !== current.settings ||
          latest.gw !== current.gw ||
          JSON.stringify(latest.forecastArgs) !==
            JSON.stringify(current.forecastArgs)
        )
          return;
        if (restored.notices.length)
          archivePlanningInputs(current.plans, current.forecastArgs);
        ++operationVersionRef.current;
        loadedForecastArgsRef.current = JSON.stringify(restored.configuration);
        applyForecastConfiguration(restored.configuration);
        setSettings(restored.solver);
        setData(restored.forecast);
        setPlans(restored.plans);
        setActiveId(restored.activeId);
        if (!restored.forecast.gameweeks.includes(current.gw))
          setGw(restored.gw);
        setSolveResult(null);
        setSolveContext(null);
        if (restored.notices.length) notify(restored.notices.join(" "));
      } catch {
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
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setDetailId(null);
        setSelected(null);
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
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
    // Reverting to the loaded configuration must also invalidate a pending load.
    const request = ++dataRequestRef.current;
    if (loadedForecastArgsRef.current === serialized) return;
    const current = () =>
      request === dataRequestRef.current &&
      JSON.stringify(livePlanningRef.current.forecastArgs) === serialized;
    api<Bootstrap>("/projections", forecastArgs)
      .then((d) => {
        if (current()) {
          loadedForecastArgsRef.current = serialized;
          setData((current) => ({
            ...d,
            official_fixture_catalog: current?.official_fixture_catalog,
          }));
        }
      })
      .catch((e) => {
        if (current()) notify(e.message, true);
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
  ]);
  useEffect(() => {
    if (!data) return;
    const latest = new Map(data.players.map((p) => [p.id, p]));
    setPlans((ps) =>
      ps.map((p) => ({
        ...p,
        weeks: p.weeks.map((w) => {
          if (!data.gameweeks.includes(w.gw)) return w;
          const score = teamPoints(
            w.starters,
            w.bench,
            w.captain,
            w.vice,
            latest,
            w.gw,
            w.chip,
          );
          return { ...w, ...score, net_points: score.points - w.hits };
        }),
      })),
    );
  }, [data]);
  useEffect(() => {
    if (!data || detailId === null) {
      setDetail(null);
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

  function openPlayer(
    id: number,
    gameweek = gw,
    readOnly = false,
    sourcePlan = active,
    inline = false,
  ) {
    const source = document.activeElement as HTMLElement | null;
    const anchor = source
      ?.closest(".player-select,.projection-value,.player-info")
      ?.getBoundingClientRect();
    setDetailAnchor(
      anchor
        ? {
            left: anchor.left,
            right: anchor.right,
            top: anchor.top,
            bottom: anchor.bottom,
          }
        : null,
    );
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
  function navigateTab(value: Tab) {
    if (
      ["lineup", "optimise"].includes(value) &&
      active &&
      !active.weeks.some((row) => row.gw === gw)
    )
      setGw(active.weeks[0].gw);
    setDetailId(null);
    setTab(value);
  }
  useEffect(() => {
    if (detailId !== null && detailTab === "transfer" && !detailSquad)
      setDetailTab("overview");
  }, [detailId, detailSquad, detailTab]);
  useEffect(() => {
    if (loading || !data) return;
    const next = new URL(window.location.href);
    const desiredTab = tab === "analysis" ? "plans" : tab;
    if (
      next.searchParams.get("tab") === desiredTab &&
      next.searchParams.get("gw") === String(gw) &&
      next.searchParams.get("plan") === activeId
    )
      return;
    next.searchParams.set("view", "tree");
    next.searchParams.set("tab", desiredTab);
    next.searchParams.set("gw", String(gw));
    next.searchParams.set("plan", activeId);
    window.history.pushState(null, "", next);
  }, [tab, gw, activeId, loading]);
  useEffect(() => {
    const back = () => {
      const params = new URLSearchParams(window.location.search),
        plan = plans.find((row) => row.id === params.get("plan")),
        week = Number(params.get("gw"));
      const nextTab = locationTab();
      const selectedPlan =
        plan ?? plans.find((row) => row.id === activeId) ?? plans[0];
      setTab(nextTab);
      if (selectedPlan) {
        setActiveId(selectedPlan.id);
        if (
          ["lineup", "optimise"].includes(nextTab) &&
          !selectedPlan.weeks.some((row) => row.gw === week)
        )
          setGw(selectedPlan.weeks[0].gw);
        else if (data?.gameweeks.includes(week)) setGw(week);
      }
      setDetailId(null);
      setSelected(null);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [plans, data?.gameweeks, activeId]);

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
  function assertPlanInputs(operation: symbol) {
    if (operationRef.current !== operation)
      throw new Error("Plan update expired. Try again.");
    const live = livePlanningRef.current;
    const configuration = JSON.stringify(forecastArgs);
    if (
      !data ||
      live.data !== data ||
      JSON.stringify(live.forecastArgs) !== configuration ||
      loadedForecastArgsRef.current !== configuration
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
      if (
        (event.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"]',
        ) ||
        modal ||
        detailId !== null
      )
        return;
      if (event.key === "Escape") {
        setSelected(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void travelPlan(event.shiftKey ? "future" : "past");
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [active, planHistory, busy, modal, detailId, renderedOperationVersion]);
  function onWatch(id: number) {
    setWatch((v) => (v.includes(id) ? v.filter((i) => i !== id) : [...v, id]));
  }
  function togglePlayerConstraint(id: number, kind: "locked" | "excluded") {
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
      `${lookup.get(id)?.name}: ${kind === "locked" ? "include" : "exclude"} rule toggled.`,
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
      notify("New scenario from the base team.");
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
      setGw(start);
      setTab("lineup");
      setSelected(null);
      notify(`Branch starts at GW${start}. Original plan retained.`);
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
    notify(`GW${gw} transfers locked in optimiser rules.`);
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
    notify("New branch created. Explore another route.");
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
      text: "Branch moved to deleted plans.",
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
      `${lookup.get(id)?.name} selected as ${vice ? "vice-captain" : "captain"}.`,
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
      notify("Choose a legal starter / bench substitution.", true);
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
    void updatePlan(p, "Starting lineup updated.", true, "Updating lineup…");
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
    void updatePlan(p, "Bench substitution priority updated.", true, "Updating plan…", atGW);
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
    void updatePlan(p, `Planning horizon updated to ${count} gameweeks.`, true, "Updating plan…", null);
    if (!weeks.includes(gw)) setGw(weeks[0]);
  }
  function changeChip(chip: Chip) {
    if (!active) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw);
    if (w) {
      w.chip = chip;
      void updatePlan(p, `${chipNames[chip]} selected for GW${gw}.`);
    }
  }
  function autoLineup() {
    if (!active || !week || !data) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw)!;
    Object.assign(w, optimalLineup(w.squad, data.players, gw, w.chip));
    void updatePlan(p, "Starting XI and captain optimised for this gameweek.");
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
    void updatePlan(p, "Gameweek restored to the preceding squad.");
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
      notify(
        `Imported ${imported.name}. Verify bank and saved FTs in team settings.`,
      );
    } catch (e) {
      if (operationRef.current === operation) notify((e as Error).message, true);
    } finally {
      finishOperation(operation);
    }
  }
  async function saveTeamSettings() {
    if (!active) return;
    const p = { ...active, base_bank: teamBank, free_transfers: teamFT };
    await updatePlan(p, "Starting bank and free transfers updated.", true, "Updating plan…", null);
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
        notify(
          `Optimised ${sourcePlan.name} · GW${startGW}–${startGW + horizon - 1}. Undo is available.`,
        );
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
      setGw(context.startGW);
      setSolveResult(null);
      setSolveContext(null);
      setPreviewingDraft(false);
      setTab("lineup");
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
    const start = job.settings.solve;
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
    const operation = beginOperation("Checking the stress-test branch…");
    if (!operation) return;
    try {
      const valid = await validatedPlan(p, operation);
      assertPlanInputs(operation);
      setPlans((ps) => [...ps, valid]);
      setActiveId(valid.id);
      setGw(valid.weeks[0].gw);
      setTab("lineup");
      notify("New branch saved and rescored using your current forecasts.");
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
      );
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
      setData(restored.forecast);
      setPlans(restored.plans);
      setActiveId(restored.activeId);
      if (!restored.forecast.gameweeks.includes(gw)) setGw(restored.gw);
      setSolveResult(null);
      setSolveContext(null);
      setEvalData(await api<Evaluation>("/evaluation"));
      notify(
        `Feeds refreshed.${restored.notices.length ? ` ${restored.notices.join(" ")}` : ""}`,
      );
    } catch (e) {
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
      notify(
        `Archived ${r.captured_gameweeks.length} gameweeks before the deadline.`,
      );
      try {
        const [receipt, forecasts] = await Promise.all([
          api<Prospective>("/prospective"),
          api<Bootstrap>("/projections", forecastArgs),
        ]);
        setProspective(receipt);
        setData(forecasts);
      } catch {
        notify(
          "Forecast saved. Refresh the app to reload its capture receipt and forecasts.",
        );
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
        `Imported ${count} point forecasts and ${Object.keys(minutes).length + Object.values(schedules).reduce((n, weeks) => n + Object.keys(weeks).length, 0)} minutes assumptions from ${file.name}.`,
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
    notify("Current projections exported, including custom scenarios.");
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
      setData(prepared.forecast);
      setPlans((ps) => [...ps, ...prepared.plans]);
      setActiveId(prepared.plans[0].id);
      setGw(prepared.plans[0].weeks[0].gw);
      setSolveResult(null);
      setSolveContext(null);
      notify(
        `${prepared.plans.length} branches and settings imported.${prepared.notices.length ? ` ${prepared.notices.join(" ")}` : ""}`,
      );
    } catch (e) {
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
      setGw(job.scope.gameweeks[0] ?? valid.weeks[0].gw);
      setTab("lineup");
      notify("Strategy branch saved and rescored with current forecasts.");
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
              onClick={() => location.reload()}
            >
              <RefreshCw size={15} />
              Try again
            </button>
            <small>
              {window.location.hostname.endsWith("workers.dev")
                ? "Your saved plans are retained. Retry shortly."
                : "Start the Python API on port 8000 and the Vite app on port 5173."}
            </small>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={25} />
            <p>Loading forecasts…</p>
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
        onTeam={() => {
          setTeamBank(active.base_bank);
          setTeamFT(active.free_transfers);
          setModal("resources");
        }}
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
    <div className="app-shell solio-studio">
      <aside className="app-rail" aria-label="App navigation">
        <button
          className="rail-brand"
          onClick={() => navigateTab("lineup")}
          aria-label="Open FPL"
        >
          <Logo />
        </button>
        <button
          className={
            !["market", "projections", "data"].includes(tab) ? "active" : ""
          }
          onClick={() => navigateTab("lineup")}
          title="Planner"
          aria-label="Planner"
        >
          <GitBranch size={19} />
        </button>
        <button
          className={tab === "projections" ? "active" : ""}
          onClick={() => navigateTab("projections")}
          title="Player data"
          aria-label="Player data"
        >
          <Activity size={19} />
        </button>
        <button
          className={tab === "data" ? "active" : ""}
          onClick={() => navigateTab("data")}
          title="Season stats"
          aria-label="Season stats"
        >
          <Database size={19} />
        </button>
        <button
          className={tab === "market" ? "active" : ""}
          onClick={() => navigateTab("market")}
          title="Market data"
          aria-label="Market data"
        >
          <TrendingUp size={19} />
        </button>
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
      <div
        className={`workspace solio-workspace workspace-${tab} ${treeHidden || tab === "data" ? "tree-hidden" : ""}`}
        style={{ "--panel-split": `${split}%` } as CSSProperties}
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
          onEvaluate={() => setTab("analysis")}
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
          onConfigure={() => {
            setTeamBank(active?.base_bank ?? 0);
            setTeamFT(active?.free_transfers ?? 1);
            setModal("team");
          }}
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
          <div className="detail-panel-heading" hidden={tab === "data"}>
            <button
              className="icon-button tree-toggle"
              aria-label={
                treeHidden ? "Show planning tree" : "Hide planning tree"
              }
              onClick={() => setTreeHidden(!treeHidden)}
            >
              <GitBranch size={15} />
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
            <span>{data.season.replace("-", "/")}</span>
            {saveStatus !== "local" && saveStatus !== "loading" && <button
              className="icon-button"
              aria-label={`Shared plans: ${saveStatus}`}
              title={saveStatus === "saved" ? "Saved across devices" : saveStatus === "saving" ? "Saving shared plans…" : "Shared saving needs attention"}
              onClick={() => { setSettingsTab("plans"); setModal("settings"); }}
            >{saveStatus === "saving" ? <LoaderCircle size={15} className="spin" /> : saveStatus === "saved" ? <Check size={15} /> : <Info size={15} />}</button>}
            <button
              className="icon-button"
              onClick={() => setModal("team")}
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
                          onClick={() => setModal("team")}
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
                      onPlayers={() => setTab("projections")}
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
                onCSV={() => setModal("csv")}
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
                    (source) => source.status === "stale",
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

      {busy && (
        <div className="global-busy">
          <LoaderCircle size={14} className="spin" />
          <span>{planBusyLabel}</span>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role="status"
        >
          {toast.error ? <Info size={17} /> : <Check size={17} />}
          <span>{planToastText}</span>
          {toast.action ? (
            <button className="toast-undo" onClick={toast.action.run}>
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
                  max="100"
                  step="0.1"
                  value={teamBank}
                  onChange={(event) => setTeamBank(+event.target.value)}
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
              className="button primary"
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
              Find your ID in your FPL Points-page URL: /entry/<b>123456</b>
              /event/… Latest published squad only.
            </p>
            <div className="divider" />
            <h3>Your plan's starting resources</h3>
            <p className="help-text">
              Verify these after import. Original purchase prices may be
              estimated from the first observed price.
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
                  value={teamBank}
                  onChange={(e) => setTeamBank(+e.target.value)}
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
              onClick={saveTeamSettings}
            >
              Update plan resources
            </button>
            <p className="privacy-note">
              <ShieldCheck size={14} />
              {saveStatus === "local" ? "Plans stay in this browser." : "Plans save across your devices."} No transfers are submitted to FPL.
            </p>
          </div>
        </Modal>
      )}
      {modal === "csv" && (
        <Modal
          title="Bring your own model."
          subtitle="Blend another projection source, or import your minutes scenarios."
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p>
              Use a CSV with <code>player_id, gameweek, expected_points</code>,
              or a provider export with <code>ID, 6_Pts, 7_Pts, …</code>. For
              conditional minutes scenarios, use{" "}
              <code>player_id, conditional_minutes</code> for a global duration,
              or{" "}
              <code>
                player_id, gameweek, conditional_minutes, availability
              </code>
              for weekly assumptions. Availability uses 0–1. Scheduled weeks
              take priority over point blends.
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
            <p className="help-text">
              Matched weeks use the imported forecasts. With extrapolation on,
              later weeks carry a fading player-level adjustment through the
              future fixture schedule. Event components and simulations retain
              the base model; the point adjustment is shown separately.
            </p>
            <label className="toggle-row">
              <span>
                <b>Extend beyond imported weeks</b>
                <small>Fading fixture-aware extrapolation through GW38</small>
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
                  if (e.target.files?.[0]) void importCSV(e.target.files[0]);
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
              Download a valid template
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
              <section hidden={settingsTab !== "plans"}>
                {window.location.hostname.endsWith("workers.dev") && <form method="post" action="/auth/signout"><button className="button small" type="submit">Sign out</button></form>}
                {deletedPlans.length ? (
                  <details className="compact-details deleted-plans">
                    <summary>Deleted plans · {deletedPlans.length}</summary>
                    {deletedPlans.map((plan) => (
                      <div key={plan.id}>
                        <span>{plan.name}</span>
                        <button
                          className="button small"
                          onClick={() => restoreDeleted(plan)}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </details>
                ) : null}
              </section>
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
                    onClick={() => {
                      setCustomPoints({});
                      setBlendWeight(0);
                      setCustomName("");
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
                    onClick={() =>
                      setBackupText(
                        JSON.stringify(
                          createPlanExport(plans, forecastArgs, settings),
                          null,
                          2,
                        ),
                      )
                    }
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
                  Plan files are checked against current FPL rules before being
                  loaded. Browser storage stays on this device.
                </p>
                <button
                  className="button full"
                  onClick={refresh}
                  disabled={!!busy}
                >
                  <RefreshCw size={15} />
                  Refresh public feeds
                </button>
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
                      />
                      <span>
                        <b>{key.replaceAll("_", " ")}</b>
                        <small>
                          {s.fetched_at
                            ? new Date(s.fetched_at).toLocaleString()
                            : "Unavailable"}
                        </small>
                      </span>
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
          title="A clearer way to play."
          subtitle="Free planning, explainable predictions, and honest evaluation."
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body">
            <div className="help-grid">
              {[
                [
                  "1",
                  "Make it yours",
                  "Import a public FPL ID, or explore the generated legal £100m squad. Check your bank and saved transfers.",
                ],
                [
                  "2",
                  "Explore the upside",
                  "Use projections, fixture views and watchlists. Select any player to inspect the components and adjust conditional minutes.",
                ],
                [
                  "3",
                  "Think a few moves ahead",
                  "Switch gameweeks, transfer players, choose captains and chips. Duplicate your plan to compare another route.",
                ],
                [
                  "4",
                  "Measure the decisions",
                  "Run a constrained solve, review its assumptions, and freeze forecasts before the deadline for prospective evaluation.",
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
            <h3>How expected points work</h3>
            <p>
              Our model separates appearance and 60-minute probabilities from
              attacking rates. It shrinks recent xG and xA toward historical
              position averages, adjusts them to fixture-level team
              expectations, and adds scoring events under the current official
              FPL rules. Displayed team totals include expected automatic
              substitutions and vice-captain fallback, assuming independent
              player appearances. These probabilities are uncalibrated.
            </p>
            <p>
              Manual minutes are conditional scenario assumptions, not a
              guaranteed appearance. Bonus is a historical approximation.
              Simulated ranges assume independent events and have not been
              calibrated.
            </p>
            <p>
              The walk-forward benchmark against the previous model is in
              Analysis. A competitive paid-provider comparison needs forecasts
              from the same deadlines and has not been established.
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
          subtitle={`${detailPlayer.team_name} · ${detailPlayer.position} · ${money(detailPlayer.price)}`}
          onClose={() => setDetailId(null)}
          anchor={detailAnchor}
          target={
            detailInline && tab === "projections"
              ? projectionEditorTarget
              : null
          }
        >
          <div className={`modal-body player-detail detail-tab-${detailTab}`}>
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
              <button
                className={`button small ${detailWeek?.captain === detailId ? "selected" : ""}`}
                title="Captain"
                disabled={
                  Boolean(busy) || !detailWeek?.starters.includes(detailId)
                }
                onClick={() => setCaptain(detailId, false, playerGW)}
              >
                C<span>Captain</span>
              </button>
              <button
                className={`button small ${detailWeek?.vice === detailId ? "selected" : ""}`}
                title="Vice-captain"
                disabled={
                  Boolean(busy) || !detailWeek?.starters.includes(detailId)
                }
                onClick={() => setCaptain(detailId, true, playerGW)}
              >
                VC<span>Vice</span>
              </button>
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
              {detailSquad ? (
                <button
                  className="button small"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setGw(playerGW);
                    setSelected(detailId);
                    setDetailId(null);
                    if (!detailInline) setTab("lineup");
                  }}
                >
                  <ArrowLeftRight size={14} />
                  Sub
                </button>
              ) : null}
              {detailWeek?.bench.includes(detailId) &&
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
                key={`${detailId}-${playerGW}`}
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
            {detailPlayer.news && (
              <p className="news-alert">
                Official team news: {detailPlayer.news}
              </p>
            )}
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
                <MinutesScenarioEditor
                  key={`minutes-${detailId}-${playerGW}`}
                  player={detailPlayer}
                  weeks={data.gameweeks}
                  gw={playerGW}
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
                      "Automatic minutes and availability restored for this player.",
                    );
                  }}
                  onNotify={notify}
                />
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
                          {detail.simulation.histogram.map((v) => (
                            <div
                              key={v.points}
                              title={`${v.points} points · ${fmt(v.probability * 100, 1)}%`}
                            >
                              <i
                                style={{
                                  height: `${Math.max(2, (v.probability / Math.max(...detail.simulation.histogram.map((x) => x.probability))) * 95)}px`,
                                }}
                              />
                              <span>{v.points}</span>
                            </div>
                          ))}
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
