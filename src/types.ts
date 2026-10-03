export type Fixture = {
  id: number;
  opponent: string;
  opponent_id: number;
  home: boolean;
  difficulty: number;
  kickoff: string;
  source: string;
  source_at: string;
  points: number;
  xmins: number;
  xg: number;
  xa: number;
  cs: number;
  pplay: number;
  p60: number;
  team_goals: number;
  conceded: number;
  components: Record<string, number>;
};
export type Forecast = {
  points: number;
  xmins: number;
  fixtures: Fixture[];
  components: Record<string, number>;
  pplay?: number;
  minutes_scenario?: {
    conditional_minutes: number | null;
    availability: number;
    label: string;
  };
  prediction_source?: {
    kind: "provider" | "extrapolated";
    name: string;
    weight: number;
    base_points: number;
    source_points: number;
    anchor_gameweeks: number[];
    ratio: number | null;
    source_at: string | null;
  };
};
export type MinutesScenario = {
  conditional_minutes?: number;
  availability?: number;
};
export type MinutesSchedule = Record<string, Record<string, MinutesScenario>>;
export type Player = {
  id: number;
  code: number;
  name: string;
  full_name: string;
  position: "GKP" | "DEF" | "MID" | "FWD";
  position_id: number;
  team: number;
  team_name: string;
  team_short: string;
  team_code: number;
  price: number;
  ownership: number;
  status: string;
  news: string;
  chance: number | null;
  form: number;
  total_points: number;
  minutes: number;
  xg90: number;
  xa90: number;
  xmins: number;
  pplay: number;
  p60: number;
  dc_probability: number;
  sample_matches: number;
  has_prior: boolean;
  overridden: boolean;
  price_change: number;
  transfers_in: number;
  transfers_out: number;
  price_change_percent: string | null;
  price_change_projections: {
    offset: number;
    projected_percent: string;
    likelihood: number;
  }[];
  penalties_order: number | null;
  gw: Record<string, Forecast>;
};
export type Source = {
  url: string;
  fetched_at: string | null;
  status: string;
  bytes?: number;
  sha256?: string;
  error?: string;
};
export type PlayerReference = {
  player_id: number;
  attacking_baseline?: {
    goal: number;
    assist: number;
    goal_involvement: number;
    conditioning: string;
    duration_minutes: null;
    gameweek: null;
    source_key: string;
  };
  future_importance?: number;
  attacking_views?: Record<
    string,
    {
      source_key: string;
      conditioning: string;
      duration_minutes: number | null;
      gameweeks: Record<
        string,
        { goal?: number; assist?: number; goal_involvement?: number }
      >;
    }
  >;
  captain?: boolean;
  captain_gameweek?: number;
  matches: {
    source_key: string;
    row: number;
    provider_name: string;
    official_name: string;
    team: string;
    method: string;
  }[];
};
export type ReferenceData = {
  provider: string;
  season: string;
  season_inferred: boolean;
  available: boolean;
  status: string;
  players: Record<string, PlayerReference>;
  feeds: Record<
    string,
    {
      url: string;
      status: string;
      source_at: string | null;
      sha256: string | null;
      last_modified: string | null;
      available: boolean;
      row_count: number;
      matched_players: number;
      captain_gameweek?: number;
      caption?: string;
      units?: string;
      conditioning?: string;
      duration_minutes?: number | null;
      gameweeks?: number[];
      caption_current?: boolean;
      window_status?: string;
      validation: string | null;
      diagnostics: Record<string, unknown[]>;
    }
  >;
  coverage: {
    official_players: number;
    matched_players: number;
    baseline_players: number;
    importance_players: number;
    attacking_players?: number;
  };
  limitations: string[];
};
export type Bootstrap = {
  players: Player[];
  gameweeks: number[];
  events: {
    id: number;
    deadline_time: string;
    finished: boolean;
    is_current: boolean;
    is_next: boolean;
  }[];
  teams: { id: number; name: string; short_name: string; code: number }[];
  next_gw: number;
  season: string;
  loaded_at: string;
  model_version: string;
  history_rows: number;
  sources: Record<string, Source>;
  limitations: string[];
  parameters: Record<string, number>;
  reference_data?: ReferenceData;
  forecast_layers?: {
    name: string;
    weight: number;
    direct_forecasts: number;
    extrapolated_forecasts: number;
    half_life: number;
    source_at: string | null;
  }[];
};
export type Chip =
  "none" | "wildcard" | "freehit" | "benchboost" | "triplecaptain";
export type Week = {
  gw: number;
  squad: number[];
  starters: number[];
  bench: number[];
  captain: number;
  vice: number;
  chip: Chip;
  bank: number;
  free_transfers: number;
  next_free_transfers: number;
  hits: number;
  points: number;
  net_points: number;
  autosub_points?: number;
  vice_points?: number;
  transfers_in: number[];
  transfers_out: number[];
};
export type Plan = {
  id: string;
  name: string;
  weeks: Week[];
  base_squad: number[];
  base_bank: number;
  free_transfers: number;
  purchase_prices: Record<string, number>;
  team_name?: string;
  entry_id?: number;
  created_at: string;
  used_chips?: { chip: Chip; gw: number }[];
};
export type SolveResult = {
  weeks: Week[];
  objective: number;
  status: string;
  gap: number;
  candidate_count: number;
  pool_count: number;
  assumptions: string[];
};
export type SensitivitySettings = {
  horizon: number;
  seconds: number;
  scenarios: number;
  variation: number;
  seed: number;
};
export type SensitivityVariant = {
  count: number;
  scenario: number;
  weeks: Week[];
  base_value: number;
  gap: number;
};
export type SensitivityJob = {
  id: string;
  status: "queued" | "running" | "complete" | "cancelled" | "failed";
  phase: string;
  created_at: string;
  finished_at: string | null;
  attempted: number;
  completed: number;
  total: number;
  cancel_requested: boolean;
  error: string | null;
  failures: { scenario: number; message: string }[];
  settings: {
    variation: number;
    seed: number;
    name: string;
    solve: {
      squad: number[];
      bank: number;
      free_transfers: number;
      purchase_prices: Record<string, number>;
      used_chips: { chip: Chip; gw: number }[];
      start_gw: number;
      horizon: number;
      seconds: number;
      decay: number;
    };
  };
  forecast: {
    model_version: string;
    loaded_at: string;
    sha256: string;
    layers: { name: string; weight: number }[];
  };
  baseline: SolveResult | null;
  baseline_value: number | null;
  summary: {
    denominator: number;
    frequencies: Record<
      "purchases" | "sales" | "captains",
      {
        id: number;
        count: number;
        fraction: number;
      }[]
    >;
    roll_count: number;
    differences: { mean: number; p10: number; p90: number } | null;
    variants: SensitivityVariant[];
  };
  method: string;
  limitations: string[];
};
export type Metric = { mae: number; rmse: number; bias: number; count: number };
export type CaptureReceipt = {
  capture_started_at: string;
  capture_finished_at: string;
  dataset_loaded_at: string;
  refresh_requested: boolean;
  max_source_age_seconds: number;
  eligible_primary: Record<string, boolean>;
  eligibility_reasons: Record<string, string[]>;
  required_sources: Record<string, string[]>;
  origin_gameweek?: number;
  target_gameweek?: number;
  comparison_models?: string[];
  method: string;
  sources: Record<
    string,
    {
      url?: string;
      status: string;
      fetched_at: string | null;
      sha256: string | null;
      age_seconds: number | null;
      refetched: boolean;
      content_changed: boolean | null;
      last_modified?: string | null;
    }
  >;
};
export type LeadTimeTarget = {
  gw: number;
  snapshot: string;
  recorded_at: string;
  deadline: string;
  current_deadline: string;
  deadline_changed: boolean;
  fixture_schedule_changed?: boolean | null;
  fixtures?:
    | {
        id: number;
        team_h: number;
        team_a: number;
        kickoff_time: string | null;
      }[]
    | null;
  lead_hours: number;
  origin_gameweek: number;
  model_version: string;
  configuration_hash: string | null;
  manual_configuration: boolean;
  status: string;
  cohort: { eligible_count: number };
  coverage: Record<string, { forecast_count: number; eligible_count: number }>;
  pairwise_comparisons?: Prospective["gameweeks"][number]["pairwise_comparisons"];
};
export type LeadTimeAggregate = {
  count: number;
  gameweek_count: number;
  model: Metric | null;
  ensemble: Metric | null;
  denominator: string;
};
export type LeadTimeBin = {
  id: string;
  label: string;
  capture_count: number;
  pending_count: number;
  ready_count: number;
  pending_targets: LeadTimeTarget[];
  captured_targets: LeadTimeTarget[];
  gameweeks: LeadTimeTarget[];
  pairwise_comparisons: Record<
    string,
    {
      all: LeadTimeAggregate;
      primary: LeadTimeAggregate;
      exploratory: LeadTimeAggregate;
    }
  >;
};
export type LeadTimeReport = {
  generated_at?: string;
  method?: string;
  bins?: LeadTimeBin[];
  diagnostics?: unknown[];
  inventory: { bins: LeadTimeBin[]; method?: string };
};
export type Prospective = {
  generated_at?: string;
  method: string;
  captures?: {
    gw: number;
    filename: string;
    recorded_at: string;
    deadline: string;
    lead_hours: number;
    players: number;
    capture_receipt: CaptureReceipt | null;
  }[];
  excluded_gameweeks?: { gw: number; reason: string }[];
  vendor_comparison?: string;
  gameweeks: ({
    gw: number;
    snapshot: string;
    models: Record<string, Metric>;
    common_cohort_count?: number;
    cohort?: {
      selection: string;
      eligible_count: number;
      scored_count: number;
      missing_actual_ids: number[];
    };
    pairwise_comparisons?: Record<
      string,
      {
        reference: string;
        count: number;
        model: Metric | null;
        ensemble: Metric | null;
        eligibility: string;
        eligible_primary: boolean;
        eligibility_reasons: string[];
      }
    >;
    coverage?: Record<
      string,
      {
        eligible_count: number;
        forecast_count: number;
        missing_forecast_count: number;
        invalid_forecast_count: number;
        scored_count: number;
      }
    >;
    actual_source?: Source;
    actual_data_checked?: boolean | null;
  } & Metric)[];
};
export type Evaluation = {
  available: boolean;
  generated_at?: string;
  message?: string;
  version?: string;
  train_seasons?: string[];
  test_season?: string;
  method?: string;
  models?: Record<string, Metric>;
  all_players?: Record<string, Metric>;
  minutes?: Metric;
  positions?: ({ position: string } & Metric)[];
  gameweeks?: {
    gw: number;
    component: number;
    ml: number;
    form: number;
    ppg: number;
    count: number;
  }[];
  calibration?: {
    bin: string;
    predicted: number;
    actual: number;
    count: number;
  }[];
  limitations?: string[];
  captains?: Record<string, number>;
  deployed_model?: string;
};
export type PlayerDetail = {
  player: Player;
  history: {
    season: string;
    gw: number;
    minutes: number;
    total_points: number;
    expected_goals: number;
    expected_assists: number;
    opponent: string;
    date: string;
  }[];
  simulation: {
    histogram: { points: number; probability: number }[];
    mean: number;
    p10: number;
    p90: number;
    blank_probability: number;
    haul_probability: number;
    trials: number;
    label: string;
  };
};
