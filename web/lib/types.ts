export type Tone = "good" | "warn" | "bad" | "info";
export type Reason = { text: string; tone: Tone };
export type AiPolicy = "allowed" | "disclose" | "banned" | "unknown";

export type Signals = {
  computed_at: string;
  outside_prs_closed_90d: number | null;
  outside_prs_merged_90d: number | null;
  outside_merge_rate_90d: number | null;
  median_first_response_h: number | null;
  open_pr_backlog: number | null;
  days_since_maintainer_merge: number | null;
  ci_pass_rate: number | null;
  has_contributing: boolean | number | null;
  ai_policy: AiPolicy;
  ai_policy_evidence: string | null;
};

export type Opportunity = {
  id: number;
  repo: string;
  repo_id: number;
  language: string | null;
  number: number;
  title: string;
  url: string;
  labels: string[];
  created_at: string;
  comments: number;
  score: number;
  reasons: Reason[];
  parts: Record<string, number>;
  ai_policy: AiPolicy;
  repo_stars: number | null;
  hidden: boolean;
};

export type RepoCard = {
  id: number;
  full_name: string;
  description: string;
  language: string | null;
  topics: string[];
  source: "search" | "watchlist" | "trending";
  created_at: string | null;
  stars: number;
  forks: number;
  open_prs: number | null;
  open_issues: number | null;
  velocity: number | null;
  velocity_kind: "measured" | "since-creation" | "none";
  health: number;
  score: number;
  reasons: Reason[];
  signals: Signals | null;
  history: [string, number][];
  hidden: boolean;
};

export type NewsItem = {
  id: string;
  source: "hn" | "release";
  title: string;
  url: string;
  points: number | null;
  comments: number | null;
  published_at: string;
  tags: string[];
  score: number;
};

export type MyPr = {
  id: number;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  is_draft: boolean;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
};

export type MyPrs = {
  login: string;
  stats: {
    opened: number;
    open: number;
    merged: number;
    closed: number;
    merge_rate: number | null;
    median_merge_h: number | null;
    repos: number;
    own_repo_prs?: number;
  };
  repos: { repo: string; opened: number; merged: number }[];
  prs: MyPr[];
};

export type FeedbackAction = "working" | "opened_pr" | "merged" | "ignored" | "hidden";
export type FeedbackRow = { target_id: string; action: FeedbackAction; at: string };

export type Snapshot = {
  generated_at: string;
  model_version: string;
  stats: {
    repos: number;
    issues: number;
    opportunities: number;
    blocked: number;
    hot: number;
    news: number;
    ai_banned_repos: number;
    boosted?: number;
  };
  opportunities: Opportunity[];
  blocked: Opportunity[];
  repos: RepoCard[];
  news: NewsItem[];
  my_prs?: MyPrs;
  feedback: FeedbackRow[];
};

export type ModelReport = {
  trained_at: string;
  rows: number;
  test_rows: number;
  repos: number;
  base_rate: number;
  label: string;
  auc_model: number;
  auc_full: number;
  auc_v1: number;
  live_features: string[];
  decision: "ship" | "keep-v1";
  top_features: { name: string; gain: number }[];
  split: string;
} | null;
