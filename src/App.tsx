import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  GitBranch,
  Info,
  LayoutGrid,
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
import { SensitivityView } from "./SensitivityView";
import { MinutesScenarioEditor } from "./MinutesScenarioEditor";
import { ReferenceView } from "./ReferenceView";

type Tab =
  "lineup" | "projections" | "optimise" | "fixtures" | "analysis" | "market";
const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "lineup", label: "Planner", icon: Users },
  { id: "projections", label: "Projections", icon: LayoutGrid },
  { id: "optimise", label: "Optimise", icon: Sparkles },
  { id: "fixtures", label: "Fixtures", icon: CalendarDays },
  { id: "analysis", label: "Analysis", icon: Activity },
  { id: "market", label: "Market", icon: TrendingUp },
];
const storageKey = "open-fpl-plans-v1";
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

export function restorePlanningState(
  saved: Plan[],
  activeId: string,
  forecast: {
    next_gw: number;
    gameweeks: number[];
    players: Pick<Player, "id">[];
  },
) {
  const gameweeks = new Set(forecast.gameweeks);
  const playerIds = new Set(forecast.players.map((player) => player.id));
  const plans = saved.filter(
    (plan) =>
      plan.weeks.some((week) => gameweeks.has(week.gw)) &&
      plan.base_squad.length === 15 &&
      new Set(plan.base_squad).size === 15 &&
      plan.base_squad.every((id) => playerIds.has(id)),
  );
  const active = plans.find((plan) => plan.id === activeId) ?? plans[0];
  const selectedGW = active?.weeks.some((week) => week.gw === forecast.next_gw)
    ? forecast.next_gw
    : (active?.weeks.find((week) => gameweeks.has(week.gw))?.gw ??
      forecast.next_gw);
  return { plans, activeId: active?.id ?? "", gw: selectedGW };
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState<Tab>("lineup");
  const [marketMode, setMarketMode] = useState("prices");
  const [plans, setPlans] = useState<Plan[]>(() =>
      stored<Plan[]>(storageKey, []),
    ),
    [activeId, setActiveId] = useState(() =>
      stored<string>("open-fpl-active", ""),
    ),
    [gw, setGw] = useState(0),
    [watch, setWatch] = useState<number[]>(() => stored("open-fpl-watch", []));
  const [overrides, setOverrides] = useState<Record<string, number>>(() =>
      stored("open-fpl-minutes", {}),
    ),
    [useMarket, setUseMarket] = useState(true),
    [useProvider, setUseProvider] = useState(() =>
      stored("open-fpl-provider", true),
    ),
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
  const [modal, setModal] = useState<
      "team" | "settings" | "csv" | "help" | null
    >(null),
    [detailId, setDetailId] = useState<number | null>(null),
    [detail, setDetail] = useState<PlayerDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null),
    [playerQuery, setPlayerQuery] = useState(""),
    [listMode, setListMode] = useState<"targets" | "captains" | "watch">(
      "targets",
    ),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [evalData, setEvalData] = useState<Evaluation | null>(null),
    [prospective, setProspective] = useState<Prospective | null>(null);
  const [teamId, setTeamId] = useState(""),
    [teamBank, setTeamBank] = useState(0),
    [teamFT, setTeamFT] = useState(1),
    [csvError, setCsvError] = useState(""),
    [csvWeight, setCsvWeight] = useState(50);
  const [settings, setSettings] = useState<SolverSettings>({
      horizon: 5,
      max_transfers: 2,
      decay: 0.9,
      ft_value: 1.5,
      bench_weight: 0.08,
      risk: 0,
      seconds: 15,
      locked: [],
      excluded: [],
    }),
    [solveResult, setSolveResult] = useState<SolveResult | null>(null),
    [solveContext, setSolveContext] = useState<OptimiseContext | null>(null);
  const initRef = useRef(false),
    dataRequestRef = useRef(0),
    solveRequestRef = useRef(0),
    fileRef = useRef<HTMLInputElement>(null);
  const notify = (text: string, error = false) => setToast({ text, error });
  const forecastArgs = {
    overrides,
    minutes_schedule: minutesSchedule,
    use_market: useMarket,
    custom_points: customPoints,
    blend_weight: blendWeight,
    use_provider: useProvider,
    provider_weight: providerWeight,
    extrapolate,
    anchor_half_life: anchorHalfLife,
    custom_name: customName || "Imported CSV",
  };
  const active = plans.find((p) => p.id === activeId) ?? plans[0] ?? null;
  const week = active?.weeks.find((w) => w.gw === gw) ?? null;
  const lookup = useMemo(
    () => new Map(data?.players.map((p) => [p.id, p]) ?? []),
    [data],
  );
  const selectedPlayer = selected === null ? null : lookup.get(selected);
  const detailPlayer = detailId === null ? null : lookup.get(detailId);
  const currentHorizon = active?.weeks ?? [];

  useEffect(() => {
    let alive = true;
    api<Bootstrap>("/projections", forecastArgs)
      .then((d) => {
        if (!alive) return;
        const restored = restorePlanningState(plans, activeId, d);
        setData(d);
        setGw(restored.gw);
        setActiveId(restored.activeId);
        setPlans(restored.plans);
        setLoading(false);
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
    localStorage.setItem("open-fpl-minutes", JSON.stringify(overrides));
    localStorage.setItem(
      "open-fpl-minutes-schedule",
      JSON.stringify(minutesSchedule),
    );
    localStorage.setItem("open-fpl-custom", JSON.stringify(customPoints));
    localStorage.setItem("open-fpl-blend", JSON.stringify(blendWeight));
    localStorage.setItem("open-fpl-custom-name", JSON.stringify(customName));
    localStorage.setItem("open-fpl-provider", JSON.stringify(useProvider));
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
    customPoints,
    blendWeight,
    customName,
    useProvider,
    providerWeight,
    extrapolate,
    anchorHalfLife,
  ]);
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
    if (!data || plans.length || initRef.current) return;
    initRef.current = true;
    setBusy("Building a legal £100m starting squad…");
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
        const response = await api<{ weeks: Week[] }>("/plan/validate", {
          ...forecastArgs,
          base_squad: p.base_squad,
          bank: p.base_bank,
          free_transfers: 1,
          purchase_prices: p.purchase_prices,
          weeks: p.weeks,
        });
        p.weeks = response.weeks;
        setPlans([p]);
        setActiveId(p.id);
      })
      .catch((e) => {
        initRef.current = false;
        notify(e.message, true);
      })
      .finally(() => setBusy(""));
  }, [data, plans.length]);
  useEffect(() => {
    if (!data) return;
    const request = ++dataRequestRef.current;
    api<Bootstrap>("/projections", forecastArgs)
      .then((d) => {
        if (request === dataRequestRef.current) setData(d);
      })
      .catch((e) => notify(e.message, true));
  }, [
    overrides,
    minutesSchedule,
    useMarket,
    customPoints,
    blendWeight,
    useProvider,
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
    api<PlayerDetail>(`/players/${detailId}?gw=${gw}`)
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
  }, [detailId, gw]);

  async function validatedPlan(p: Plan) {
    const result = await api<{ weeks: Week[] }>("/plan/validate", {
      ...forecastArgs,
      base_squad: p.base_squad,
      bank: p.base_bank,
      free_transfers: p.free_transfers,
      purchase_prices: p.purchase_prices,
      weeks: p.weeks,
      used_chips: p.used_chips ?? [],
    });
    return { ...p, weeks: result.weeks };
  }
  async function updatePlan(p: Plan, message?: string) {
    setBusy("Checking your plan…");
    try {
      const valid = await validatedPlan(p);
      setPlans((ps) => ps.map((v) => (v.id === p.id ? valid : v)));
      if (message) notify(message);
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy("");
    }
  }
  function onWatch(id: number) {
    setWatch((v) => (v.includes(id) ? v.filter((i) => i !== id) : [...v, id]));
  }
  function choosePlan(id: string) {
    setActiveId(id);
    setSelected(null);
    const p = plans.find((v) => v.id === id);
    if (p && !p.weeks.some((w) => w.gw === gw)) setGw(p.weeks[0].gw);
  }
  function clonePlan() {
    if (!active) return;
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
    if (!active || plans.length <= 1) return;
    const rest = plans.filter((p) => p.id !== active.id);
    setPlans(rest);
    setActiveId(rest[0].id);
    notify("Planning branch deleted.");
  }
  async function transferIn(id: number) {
    if (!data || !active || selected === null || !week) return;
    const incoming = lookup.get(id)!,
      outgoing = lookup.get(selected)!;
    if (
      incoming.position_id !== outgoing.position_id ||
      week.squad.includes(id)
    )
      return;
    const next = structuredClone(active);
    const isFH = week.chip === "freehit";
    next.weeks = next.weeks.map((w) => {
      if (w.gw < gw || (isFH && w.gw !== gw) || !w.squad.includes(selected))
        return w;
      const squad = w.squad.map((i) => (i === selected ? id : i));
      return {
        ...w,
        squad,
        ...optimalLineup(squad, data.players, w.gw, w.chip),
      };
    });
    if (
      await updatePlan(
        next,
        `${outgoing.name} → ${incoming.name}. Budget and transfers checked.`,
      )
    )
      setSelected(null);
  }
  function setCaptain(id: number, vice = false) {
    if (!active || !week || !week.starters.includes(id)) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw)!;
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
    );
  }
  function swapBench(id: number) {
    if (!active || !week || selected === null) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw)!;
    w.starters = w.starters.map((i) => (i === selected ? id : i));
    w.bench = w.bench.map((i) => (i === id ? selected : i));
    if (w.captain === selected) w.captain = id;
    if (w.vice === selected) w.vice = id;
    void updatePlan(p, "Starting lineup updated.");
    setSelected(null);
  }
  function moveBench(offset: number) {
    if (!active || !week || selected === null) return;
    const index = week.bench.indexOf(selected),
      target = index + offset;
    if (index < 1 || target < 1 || target > 3) return;
    const p = structuredClone(active),
      w = p.weeks.find((v) => v.gw === gw)!;
    [w.bench[index], w.bench[target]] = [w.bench[target], w.bench[index]];
    void updatePlan(p, "Bench substitution priority updated.");
  }
  function changeHorizon(count: number) {
    if (!active || !data) return;
    const p = structuredClone(active),
      weeks = data.gameweeks.slice(0, count),
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
    void updatePlan(p, `Planning horizon updated to ${count} gameweeks.`);
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
    setBusy("Reading your public FPL squad…");
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
      const valid = await validatedPlan(p);
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
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  async function saveTeamSettings() {
    if (!active) return;
    const p = { ...active, base_bank: teamBank, free_transfers: teamFT };
    await updatePlan(p, "Starting bank and free transfers updated.");
  }
  async function runSolve(fresh = false) {
    if (!data || busy) return;
    const startGW = data.gameweeks.includes(gw) ? gw : data.next_gw;
    const sourcePlan = fresh ? null : active && structuredClone(active);
    if (!fresh && !sourcePlan) return;
    const forecasts = structuredClone(forecastArgs);
    const strategy = structuredClone(settings);
    const prices = Object.fromEntries(
      data.players.map((player) => [String(player.id), player.price]),
    );
    const horizon = Math.max(
      1,
      Math.min(strategy.horizon, data.gameweeks.at(-1)! - startGW + 1),
    );
    const request = ++solveRequestRef.current;
    setSolveResult(null);
    setSolveContext(null);
    setBusy("Optimising…");
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
        ...strategy,
        horizon,
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
      setSolveResult(result);
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
      if (request === solveRequestRef.current)
        notify((e as Error).message, true);
    } finally {
      if (request === solveRequestRef.current) setBusy("");
    }
  }
  async function applySolve() {
    if (!data || !solveResult?.weeks.length || !solveContext || busy) return;
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
    setBusy("Saving branch…");
    try {
      const valid = await validatedPlan(p);
      setPlans((ps) => [...ps, valid]);
      setActiveId(p.id);
      setGw(context.startGW);
      setTab("lineup");
      notify(`Branch saved · through GW${resultWeeks.at(-1)!.gw}.`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
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
    setBusy("Checking the stress-test branch…");
    try {
      const valid = await validatedPlan(p);
      setPlans((ps) => [...ps, valid]);
      setActiveId(valid.id);
      setGw(valid.weeks[0].gw);
      setTab("lineup");
      notify("New branch saved and rescored using your current forecasts.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  async function refresh() {
    setBusy("Refreshing public feeds…");
    try {
      await api<Bootstrap>("/refresh", {});
      setData(await api<Bootstrap>("/projections", forecastArgs));
      setEvalData(await api<Evaluation>("/evaluation"));
      notify("Official data and provider projections refreshed.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  async function snapshot() {
    setBusy("Refreshing live inputs and recording a pre-deadline snapshot…");
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
      setBusy("");
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
    setBusy("Scoring completed gameweeks…");
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
      setBusy("");
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
    try {
      if (file.size > 5_000_000) throw new Error("Plan file is too large.");
      const value = JSON.parse(await file.text());
      if (
        !Array.isArray(value.plans) ||
        !value.plans.length ||
        value.plans.length > 30
      )
        throw new Error("Choose an Open FPL plan export.");
      setBusy("Checking imported planning branches…");
      const checked: Plan[] = [];
      for (const p of value.plans) {
        if (
          typeof p.name !== "string" ||
          !Array.isArray(p.weeks) ||
          !p.purchase_prices
        )
          throw new Error("Invalid plan structure.");
        checked.push(
          await validatedPlan({ ...p, id: uid(), name: p.name.slice(0, 100) }),
        );
      }
      setPlans((ps) => [...ps, ...checked]);
      setActiveId(checked[0].id);
      notify(`${checked.length} planning branches imported and validated.`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy("");
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
              Start the Python API on port 8000 and the Vite app on port 5173.
            </small>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={25} />
            <p>Connecting fixtures, players and the bigger picture.</p>
            <small>Loading real FPL data and historical records…</small>
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
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setTab("lineup")}
          aria-label="Open FPL planner"
        >
          <Logo />
          <span>
            open<b>fpl</b>
          </span>
          <small>BETA</small>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "nav-active" : ""}
              onClick={() => {
                setTab(t.id);
                setSelected(null);
              }}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="season-label">{data.season.replace("-", "/")}</span>
          <button
            className="icon-button"
            aria-label="Help and methodology"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="icon-button"
            aria-label="Settings and data sources"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={18} />
          </button>
          <button
            className="team-avatar"
            onClick={() => {
              setTeamBank(active?.base_bank ?? 0);
              setTeamFT(active?.free_transfers ?? 1);
              setModal("team");
            }}
            aria-label="Import or edit team"
          >
            <Users size={17} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-top">
            <button
              className="team-switch"
              onClick={() => {
                setTeamBank(active?.base_bank ?? 0);
                setTeamFT(active?.free_transfers ?? 1);
                setModal("team");
              }}
            >
              <span className="team-switch-icon">
                <Users size={17} />
              </span>
              <span>
                <b>{active?.team_name ?? "My FPL team"}</b>
                <small>
                  {active?.entry_id
                    ? `Team ID ${active.entry_id}`
                    : "Local team"}
                </small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="sidebar-section-title">
            <span>PLANS</span>
            <button
              className="icon-button"
              onClick={clonePlan}
              disabled={!active}
              aria-label="Create planning branch"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="plan-list">
            {plans.map((p) => (
              <button
                key={p.id}
                className={`plan-item ${active?.id === p.id ? "plan-active" : ""}`}
                onClick={() => choosePlan(p.id)}
              >
                <GitBranch size={16} />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {fmt(
                      p.weeks.reduce(
                        (n, w) => n + (w.net_points ?? w.points),
                        0,
                      ),
                    )}{" "}
                    xP · {p.weeks.length} GWs
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="branch-actions">
            <button onClick={clonePlan} disabled={!active}>
              <Copy size={14} />
              Duplicate
            </button>
            <button onClick={deletePlan} disabled={plans.length <= 1}>
              <Trash2 size={13} />
              Delete
            </button>
          </div>
          <div className="sidebar-divider" />
          <div className="sidebar-section-title">
            <span>WATCHLIST</span>
            <span className="count-badge">{watch.length}</span>
          </div>
          <div className="sidebar-watch">
            {watch.length ? (
              watch.slice(0, 6).map((id) => {
                const p = lookup.get(id);
                return p ? (
                  <button key={id} onClick={() => setDetailId(id)}>
                    <Badge player={p} size={20} />
                    <span>{p.name}</span>
                    <b>{fmt(xp(p, gw))}</b>
                  </button>
                ) : null;
              })
            ) : (
              <p>Star players to save them here.</p>
            )}
          </div>
          <button
            className="sidebar-link"
            onClick={() => setTab("projections")}
          >
            <Star size={14} />
            Players
            <ArrowUpRight size={13} />
          </button>
          <div className="sidebar-bottom">
            <div className="connection-status">
              <i />
              {Object.values(data.sources).some((s) => s.status === "stale")
                ? "Cached feeds"
                : "Feeds connected"}
            </div>
            <span>
              Refreshed {pastRefresh}{" "}
              <button
                className="icon-button"
                onClick={refresh}
                disabled={!!busy}
                aria-label="Refresh data"
              >
                <RefreshCw size={13} />
              </button>
            </span>
          </div>
        </aside>
        <main
          className={`main-content ${tab === "lineup" ? "planner-content" : ""}`}
        >
          <div className="page-context">
            <span>{tabs.find((t) => t.id === tab)?.label}</span>
            <div>
              <Clock3Icon />
              <span>
                GW{data.next_gw} deadline ·{" "}
                {nextEvent
                  ? new Date(nextEvent.deadline_time).toLocaleDateString(
                      "en-GB",
                      {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )
                  : "—"}
              </span>
            </div>
          </div>
          {tab === "lineup" ? (
            <>
              <div className="planner-heading">
                <div>
                  <h1>{active?.team_name ?? "Planner"}</h1>
                </div>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={() => {
                      setTeamBank(active?.base_bank ?? 0);
                      setTeamFT(active?.free_transfers ?? 1);
                      setModal("team");
                    }}
                  >
                    <Link2 size={15} />
                    Team
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setTab("optimise")}
                  >
                    <Sparkles size={16} />
                    Optimise
                  </button>
                </div>
              </div>
              {active && week ? (
                <>
                  <div className="mobile-plan-switch">
                    <GitBranch size={14} />
                    <select
                      aria-label="Active planning branch"
                      value={active.id}
                      onChange={(e) => choosePlan(e.target.value)}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      onClick={clonePlan}
                      aria-label="Duplicate current branch"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={deletePlan}
                      disabled={plans.length <= 1}
                      aria-label="Delete current branch"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="planner-metrics">
                    <span
                      title={`${week.next_free_transfers} free transfers next gameweek`}
                    >
                      FTs <b>{week.free_transfers}</b>
                    </span>
                    <span
                      title={`${money(week.squad.reduce((n, id) => n + lookup.get(id)!.price, 0))} squad value`}
                    >
                      ITB <b>{money(week.bank)}</b>
                    </span>
                    <span
                      title={`Includes captain, autosubs and vice fallback${week.hits ? `; −${week.hits} transfer hit` : ""}`}
                    >
                      GW{gw} <b>{fmt(week.net_points ?? week.points)} xP</b>
                    </span>
                    <span
                      title={`GW${currentHorizon[0].gw}–${currentHorizon.at(-1)!.gw}; captain and hits included`}
                    >
                      Plan <b>{fmt(totalPlan)} xP</b>
                    </span>
                  </div>
                  <div className="timeline-heading">
                    <span>
                      <GitBranch size={14} />
                      <input
                        aria-label="Plan name"
                        value={active.name}
                        onChange={(e) =>
                          setPlans((ps) =>
                            ps.map((p) =>
                              p.id === active.id
                                ? { ...p, name: e.target.value.slice(0, 70) }
                                : p,
                            ),
                          )
                        }
                      />
                    </span>
                    <span>
                      <select
                        className="horizon-select"
                        aria-label="Planner horizon"
                        value={active.weeks.length}
                        onChange={(e) => changeHorizon(+e.target.value)}
                      >
                        {[
                          ...new Set([
                            active.weeks.length,
                            3,
                            5,
                            6,
                            10,
                            14,
                            28,
                            data.gameweeks.length,
                          ]),
                        ]
                          .sort((a, b) => a - b)
                          .filter((n) => n <= data.gameweeks.length)
                          .map((n) => (
                            <option key={n} value={n}>
                              {n} GWs
                            </option>
                          ))}
                      </select>
                      <button onClick={clonePlan}>
                        New
                        <Plus size={12} />
                      </button>
                    </span>
                  </div>
                  <div
                    className="week-timeline"
                    style={
                      { "--week-count": currentHorizon.length } as CSSProperties
                    }
                  >
                    {currentHorizon.map((w) => (
                      <button
                        key={w.gw}
                        className={`week-node ${gw === w.gw ? "week-active" : ""}`}
                        title={`${w.next_free_transfers} FT next · ${money(w.bank)} ITB`}
                        onClick={() => {
                          setGw(w.gw);
                          setSelected(null);
                        }}
                      >
                        <span className="week-top">
                          <b>GW{w.gw}</b>
                          {w.chip !== "none" ? (
                            <span className="chip-indicator">
                              {w.chip === "wildcard"
                                ? "WC"
                                : w.chip === "freehit"
                                  ? "FH"
                                  : w.chip === "benchboost"
                                    ? "BB"
                                    : "TC"}
                            </span>
                          ) : w.transfers_in.length > 0 ? (
                            <span className="transfer-indicator">
                              {w.transfers_in.length} move
                              {w.transfers_in.length > 1 ? "s" : ""}
                            </span>
                          ) : null}
                        </span>
                        <strong>
                          {fmt(w.net_points ?? w.points)}
                          <small> xP</small>
                        </strong>
                      </button>
                    ))}
                  </div>
                  <div className="planner-grid">
                    <section className="lineup-panel panel">
                      <div className="lineup-header">
                        <div>
                          <h3>
                            <button
                              className="icon-button"
                              aria-label="Previous gameweek"
                              disabled={currentHorizon[0].gw === gw}
                              onClick={() => {
                                setGw(gw - 1);
                                setSelected(null);
                              }}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            GW{gw}
                            <button
                              className="icon-button"
                              aria-label="Next gameweek"
                              disabled={currentHorizon.at(-1)!.gw === gw}
                              onClick={() => {
                                setGw(gw + 1);
                                setSelected(null);
                              }}
                            >
                              <ChevronRight size={16} />
                            </button>
                            <span>
                              {[2, 3, 4]
                                .map(
                                  (pos) =>
                                    week.starters.filter(
                                      (id) =>
                                        lookup.get(id)?.position_id === pos,
                                    ).length,
                                )
                                .join("–")}
                            </span>
                          </h3>
                        </div>
                        <select
                          aria-label="Select chip"
                          className="chip-select"
                          value={week.chip}
                          onChange={(e) => changeChip(e.target.value as Chip)}
                        >
                          {Object.entries(chipNames).map(([key, label]) => (
                            <option
                              key={key}
                              value={key}
                              disabled={
                                key !== "none" &&
                                active.used_chips?.some(
                                  (c) =>
                                    c.chip === key && c.gw <= 19 === gw <= 19,
                                )
                              }
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="icon-button"
                          onClick={resetWeek}
                          disabled={!!busy}
                          aria-label="Reset this gameweek"
                        >
                          <RefreshCw size={15} />
                        </button>
                      </div>
                      <Pitch
                        week={week}
                        players={data.players}
                        selected={selected}
                        onSelect={(id) =>
                          setSelected(selected === id ? null : id)
                        }
                        onDetail={setDetailId}
                        onBenchSwap={swapBench}
                      />
                      <div className="pitch-foot">
                        <button onClick={autoLineup} disabled={!!busy}>
                          <Sparkles size={13} />
                          Best XI
                        </button>
                      </div>
                    </section>
                    <div className="planner-right">
                      {selectedPlayer ? (
                        <section className="panel selected-panel">
                          <div className="panel-heading">
                            <h3>Player</h3>
                            <button
                              className="icon-button"
                              onClick={() => setSelected(null)}
                              aria-label="Clear player selection"
                            >
                              <X size={15} />
                            </button>
                          </div>
                          <div className="selected-player">
                            <Shirt player={selectedPlayer} />
                            <div>
                              <h3>{selectedPlayer.name}</h3>
                              <p>
                                {selectedPlayer.team_name} ·{" "}
                                {selectedPlayer.position}
                              </p>
                              <span>
                                {money(selectedPlayer.price)}{" "}
                                <b>{fmt(xp(selectedPlayer, gw))} xP</b>
                              </span>
                            </div>
                          </div>
                          <div className="selected-actions">
                            <button
                              className="button small"
                              disabled={
                                !week.starters.includes(selectedPlayer.id)
                              }
                              onClick={() => setCaptain(selectedPlayer.id)}
                            >
                              Captain
                            </button>
                            <button
                              className="button small"
                              disabled={
                                !week.starters.includes(selectedPlayer.id)
                              }
                              onClick={() =>
                                setCaptain(selectedPlayer.id, true)
                              }
                            >
                              Vice
                            </button>
                            <button
                              className="button small"
                              onClick={() => setDetailId(selectedPlayer.id)}
                            >
                              <Info size={13} />
                              Details
                            </button>
                          </div>
                          {week.bench.includes(selectedPlayer.id) &&
                            selectedPlayer.position_id !== 1 && (
                              <div className="selected-actions bench-order-actions">
                                <button
                                  className="button small"
                                  disabled={
                                    week.bench.indexOf(selectedPlayer.id) <= 1
                                  }
                                  onClick={() => moveBench(-1)}
                                >
                                  Bench up
                                </button>
                                <button
                                  className="button small"
                                  disabled={
                                    week.bench.indexOf(selectedPlayer.id) >= 3
                                  }
                                  onClick={() => moveBench(1)}
                                >
                                  Bench down
                                </button>
                              </div>
                            )}
                          <details className="compact-details player-help">
                            <summary>Controls</summary>
                            Pick a replacement below. To substitute, select a
                            starting shirt then choose a bench player.
                          </details>
                          {selectedPlayer.news && (
                            <p className="news-alert">{selectedPlayer.news}</p>
                          )}
                        </section>
                      ) : (
                        <section className="panel captain-panel">
                          <div className="panel-heading">
                            <h3>Captain</h3>
                            <span className="subtle-tag">GW{gw}</span>
                          </div>
                          <div className="captain-highlight">
                            <div className="captain-highlight-shirt">
                              {captain && <Shirt player={captain} />}
                              <span>C</span>
                            </div>
                            <div>
                              <h3>{captain?.name}</h3>
                              <p>
                                {captain?.gw[String(gw)]?.fixtures
                                  .map(
                                    (f) =>
                                      `${f.opponent} (${f.home ? "H" : "A"})`,
                                  )
                                  .join(" + ") || "Blank gameweek"}
                              </p>
                            </div>
                            <strong>
                              {captain
                                ? fmt(
                                    xp(captain, gw) *
                                      (week.chip === "triplecaptain" ? 3 : 2),
                                  )
                                : "—"}
                              <small>captain xP</small>
                            </strong>
                          </div>
                          <div className="captain-alternatives">
                            {week.starters
                              .filter((id) => id !== week.captain)
                              .sort(
                                (a, b) =>
                                  xp(lookup.get(b)!, gw) -
                                  xp(lookup.get(a)!, gw),
                              )
                              .slice(0, 2)
                              .map((id) => (
                                <button key={id} onClick={() => setCaptain(id)}>
                                  <Badge player={lookup.get(id)!} size={19} />
                                  <span>{lookup.get(id)!.name}</span>
                                  <b>{fmt(xp(lookup.get(id)!, gw) * 2)}</b>
                                  <ArrowUpRight size={13} />
                                </button>
                              ))}
                          </div>
                        </section>
                      )}
                      <section className="panel targets-panel">
                        <div className="panel-heading">
                          <h3>
                            {selectedPlayer
                              ? `Replace ${selectedPlayer.name}`
                              : "Players"}
                          </h3>
                          <button
                            className="icon-button"
                            onClick={() => setTab("projections")}
                            aria-label="Open all projections"
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        </div>
                        <div className="radar-tabs">
                          {[
                            ["targets", "Transfers"],
                            ["captains", "Captains"],
                            ["watch", "Watchlist"],
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              className={listMode === key ? "active" : ""}
                              onClick={() =>
                                setListMode(key as typeof listMode)
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="search-box compact">
                          <Search size={14} />
                          <input
                            aria-label="Search transfer targets"
                            placeholder="Find a player…"
                            value={playerQuery}
                            onChange={(e) => setPlayerQuery(e.target.value)}
                          />
                        </div>
                        <div className="compact-table-label">
                          <span>PLAYER</span>
                          <span>PRICE</span>
                          <span>GW{gw} xP</span>
                        </div>
                        {availableTargets.map((p) => (
                          <PlayerRow
                            key={p.id}
                            player={p}
                            gw={gw}
                            action={
                              selectedPlayer
                                ? () => void transferIn(p.id)
                                : undefined
                            }
                            onDetail={setDetailId}
                            onWatch={onWatch}
                            watched={watch.includes(p.id)}
                          />
                        ))}
                        {!availableTargets.length && (
                          <p className="inline-empty">
                            {listMode === "watch"
                              ? "Star players in Projections to add them here."
                              : "No matching players."}
                          </p>
                        )}
                        <button
                          className="view-all"
                          onClick={() => setTab("projections")}
                        >
                          All players
                          <ArrowRight size={14} />
                        </button>
                      </section>
                      <section className="transfer-summary">
                        <div>
                          <ArrowDownUp size={14} />
                          <h4>Transfers</h4>
                          <span>
                            {week.hits ? `−${week.hits} pts` : "No hit"}
                          </span>
                        </div>
                        {week.transfers_in.length ? (
                          week.transfers_in.map((id, i) => (
                            <p key={id}>
                              <span>
                                {lookup.get(week.transfers_out[i])?.name}
                              </span>
                              <ArrowRight size={12} />
                              <b>{lookup.get(id)?.name}</b>
                            </p>
                          ))
                        ) : (
                          <p>
                            <Check size={14} />
                            {week.chip === "wildcard"
                              ? "Wildcard"
                              : "No transfers"}
                          </p>
                        )}
                      </section>
                    </div>
                  </div>
                  <footer className="planner-note">
                    <p>Updated {pastRefresh}</p>
                    <button onClick={() => setModal("settings")}>
                      Sources & model
                      <Info size={13} />
                    </button>
                  </footer>
                </>
              ) : (
                <Empty
                  title="Building your starting point."
                  text="We're finding a legal, budget-constrained squad using the current player pool."
                >
                  {busy ? (
                    <Busy text={busy} />
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => {
                        setTab("optimise");
                        void runSolve(true);
                      }}
                    >
                      Build a squad
                    </button>
                  )}
                </Empty>
              )}
            </>
          ) : tab === "projections" ? (
            <ProjectionsView
              data={data}
              gw={gw}
              onDetail={setDetailId}
              watch={watch}
              onWatch={onWatch}
              onCSV={() => setModal("csv")}
              onExport={exportCSV}
            />
          ) : tab === "fixtures" ? (
            <FixturesView data={data} gw={gw} />
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
                onDetail={setDetailId}
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
                onDetail={setDetailId}
              />
            </>
          ) : tab === "analysis" ? (
            <AnalysisView
              data={data}
              plans={plans}
              active={active}
              evalData={evalData}
              onSnapshot={snapshot}
              prospective={prospective}
              onScore={scoreProspective}
            />
          ) : (
            <>
              <div className="market-mode segmented" aria-label="Market view">
                <button
                  className={marketMode === "prices" ? "active" : ""}
                  onClick={() => setMarketMode("prices")}
                >
                  Price movement
                </button>
                <button
                  className={marketMode === "references" ? "active" : ""}
                  onClick={() => setMarketMode("references")}
                >
                  Provider shortlists
                </button>
              </div>
              {marketMode === "prices" ? (
                <MarketView
                  data={data}
                  gw={gw}
                  onDetail={setDetailId}
                  watch={watch}
                  onWatch={onWatch}
                />
              ) : (
                <ReferenceView
                  data={data}
                  gw={gw}
                  onDetail={setDetailId}
                  watch={watch}
                  onWatch={onWatch}
                />
              )}
            </>
          )}
        </main>
      </div>

      {busy && (
        <div className="global-busy">
          <LoaderCircle size={14} className="spin" />
          {busy}
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role="status"
        >
          {toast.error ? <Info size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal === "team" && (
        <Modal
          title="Make this your team."
          subtitle="Import with your public FPL ID. Your FPL login is never needed."
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
              Plans are saved locally. No transfers are submitted to FPL.
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
          title="Your model, your workspace."
          subtitle="Control inputs, save your work, and inspect the data connection."
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body settings-body">
            <section>
              <h3>Forecast inputs</h3>
              <label className="toggle-row">
                <span>
                  <b>Market and Elevenify team inputs</b>
                  <small>Turn off to use historical team estimates only</small>
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
              <div className="divider" />
              <h3>Planning branches</h3>
              <div className="button-row">
                <button
                  className="button"
                  onClick={() =>
                    download(
                      "open-fpl-plans.json",
                      JSON.stringify(
                        {
                          version: 1,
                          exported_at: new Date().toISOString(),
                          plans,
                        },
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
            <section>
              <h3>Connected sources</h3>
              {Object.entries(data.sources)
                .filter(([key]) =>
                  [
                    "fpl_bootstrap",
                    "fpl_fixtures",
                    "fpljoe",
                    "elevenify_sheet",
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
                      className={`status-dot ${s.status === "stale" ? "stale" : ""}`}
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
              <div className="divider" />
              <h3>Model limitations</h3>
              {data.limitations.map((l) => (
                <p className="limitation" key={l}>
                  <Info size={13} />
                  {l}
                </p>
              ))}
            </section>
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
              The walk-forward benchmark and an ML challenger are visible in
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
        <Modal
          title={detailPlayer.name}
          subtitle={`${detailPlayer.team_name} · ${detailPlayer.position} · ${money(detailPlayer.price)}`}
          onClose={() => setDetailId(null)}
          wide
        >
          <div className="modal-body player-detail">
            <div className="player-detail-top">
              <Shirt player={detailPlayer} />
              <Stat
                label={`GW${gw} EXPECTED POINTS`}
                value={fmt(xp(detailPlayer, gw), 2)}
                accent
              />
              <Stat
                label="EXPECTED MINUTES"
                value={fmt(detailPlayer.xmins, 0)}
                note={`${fmt(detailPlayer.p60 * 100, 0)}% modelled 60+ minutes`}
              />
              <Stat
                label="OWNERSHIP"
                value={`${fmt(detailPlayer.ownership)}%`}
                note={`${detailPlayer.sample_matches} historical fixture rows`}
              />
              <button
                className={`button ${watch.includes(detailId) ? "selected" : ""}`}
                onClick={() => onWatch(detailId)}
              >
                <Star size={14} />
                {watch.includes(detailId) ? "Watching" : "Watch"}
              </button>
            </div>
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
                    detailPlayer.gw[String(gw)]?.components ?? {},
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
                  <strong>{fmt(xp(detailPlayer, gw), 2)}</strong>
                </div>
                <p className="source-caption">
                  Current scoring configuration from the official FPL API. Bonus
                  uses a historical rate.
                </p>
              </section>
              <section>
                <MinutesScenarioEditor
                  key={detailId}
                  player={detailPlayer}
                  weeks={data.gameweeks}
                  gw={gw}
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
                  {detailPlayer.gw[String(gw)]?.fixtures.map((f) => (
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
            {detailLoading ? (
              <Busy text="Loading match history and scenario simulation…" />
            ) : (
              detail && (
                <>
                  <div className="detail-grid">
                    <section>
                      <h3>A range of possible outcomes</h3>
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
                            {fmt(detail.simulation.blank_probability * 100, 0)}%
                          </b>
                        </span>
                        <span>
                          10+ points{" "}
                          <b>
                            {fmt(detail.simulation.haul_probability * 100, 0)}%
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
                        {detail.simulation.trials.toLocaleString()} trials. Base
                        model, excluding custom overrides/blends.
                      </p>
                    </section>
                    <section>
                      <h3>Recent match record</h3>
                      <div className="history-list">
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
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Clock3Icon() {
  return <CalendarDays size={13} />;
}
