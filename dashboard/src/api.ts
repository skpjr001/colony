import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const REPO = "colony-demo";

export type Health = {
  ok: boolean;
  phase: number;
  version: string;
  paused: boolean;
  repo: string;
  core?: string;
};

export type ShardLoad = {
  key: string;
  claims: number;
  churn: number;
  load: number;
};

export type Scale = {
  agents: number;
  activeClaims: number;
  claimOpsPerSec: number;
  mergesPerHour: number;
  paused: boolean;
  tokenSpendPerHour: number;
  shards: ShardLoad[];
};

export type Claim = {
  id: string;
  agentId: string;
  taskId: string;
  paths: string[];
  shards: string[];
  intent: string;
  strength: number;
  strength0: number;
  alive: boolean;
};

export type Evidence = {
  requiredTestsPassed: boolean;
  testsPassed: number;
  testsTotal: number;
  linesChanged: number;
  filesChanged: string[];
  agentRationale: string;
};

export type Attempt = {
  id: string;
  agentId: string;
  forkRepo: string;
  headCommit: string | null;
  score: number | null;
  status: string;
  evidence?: Evidence;
};

export type Task = {
  id: string;
  repo: string;
  title: string;
  intent: string;
  tags: string[];
  urgency: number;
  uncertainty: "Low" | "Medium" | "High" | string;
  pathsHint: string[];
  state: string;
  attempts?: Attempt[];
};

export type Review = {
  id: string;
  reviewerId: string;
  modelFamily: string;
  verdict: string;
  score: number;
  notes: string;
};

export type MergeItem = {
  attemptId: string;
  taskId: string;
  shards: string[];
  trainId: string | null;
  status: string;
};

export type Train = {
  id: string;
  status: string;
  members: string[];
};

export type LedgerEntry = {
  id: string;
  taskId: string;
  mergedCommit: string;
  intent: string;
  winnerAttempt: string;
  alternatives: string[];
  evidenceSummary: string;
  trainId: string | null;
  createdAt: number;
};

export type Escalation = {
  taskId: string;
  title: string;
  reason: string;
  createdAt: number;
};

export type Agent = {
  id: string;
  roles: string[];
  specialties: string[];
  trust: number;
  tier: string;
  modelFamily: string;
  status: string;
};

export const LANES = [
  "Open",
  "Exploring",
  "Evaluating",
  "InReview",
  "Queued",
  "Merged",
  "Escalated",
  "Abandoned",
] as const;

export type ColonySnapshot = {
  health: Health | null;
  scale: Scale | null;
  refetch: () => void;
};

const ColonyContext = createContext<ColonySnapshot | null>(null);

export function ColonyProvider({
  value,
  children,
}: {
  value: ColonySnapshot;
  children: ReactNode;
}) {
  return createElement(ColonyContext.Provider, { value }, children);
}

export function useColony(): ColonySnapshot {
  const value = useContext(ColonyContext);
  if (!value) throw new Error("missing colony context");
  return value;
}

export function oneLine(err: unknown): string {
  if (err instanceof Error) {
    const line = err.message.replace(/\s+/g, " ").trim();
    return line || "request failed";
  }
  return "request failed";
}

export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function fmtTime(n: number): string {
  if (!n) return "—";
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortId(id: string | null | undefined, n = 12): string {
  if (!id) return "—";
  return id.length > n ? `${id.slice(0, n)}` : id;
}

export function remain(strength: number, strength0: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  if (strength0 > 0) return Math.max(0, Math.min(1, strength / strength0));
  return strength <= 1 ? strength : 1;
}

export function loadCap(loads: number[]): number {
  const max = loads.reduce((m, n) => Math.max(m, n), 0);
  return max <= 1 ? 1 : max;
}

export function verdictMark(verdict: string): "pass" | "fail" | "hold" {
  const s = verdict.toLowerCase();
  if (s.includes("approve") || s === "pass" || s === "yes" || s === "accept") return "pass";
  if (s.includes("reject") || s === "fail" || s === "no" || s === "deny") return "fail";
  return "hold";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(path, {
    method,
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: init?.body ?? (method === "POST" ? "{}" : undefined),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const line = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(line ? `${res.status} ${line}` : `HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text) return { ok: true } as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("invalid JSON");
  }
}

export const api = {
  health: () => request<Health>("/api/health"),
  scale: () => request<Scale>("/api/scale"),
  board: (shard?: string) => {
    const q = shard ? `?shard=${encodeURIComponent(shard)}` : "";
    return request<{ claims: Claim[] }>(`/api/repos/${REPO}/board${q}`);
  },
  tasks: () => request<{ tasks: Task[] }>("/api/tasks"),
  task: (id: string) =>
    request<{ task: Task; attempts: Attempt[]; reviews: Review[] }>(
      `/api/tasks/${encodeURIComponent(id)}`,
    ),
  mergeQueue: () =>
    request<{ items: MergeItem[]; train: Train | null; bisect: string | null }>(
      `/api/repos/${REPO}/merge-queue`,
    ),
  ledger: () => request<{ entries: LedgerEntry[] }>("/api/ledger"),
  escalations: () => request<{ items: Escalation[] }>("/api/escalations"),
  decide: (id: string, decision: "approve" | "reject", note?: string) =>
    request<unknown>(`/api/tasks/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      body: JSON.stringify(note ? { decision, note } : { decision }),
    }),
  agents: () => request<{ agents: Agent[] }>("/api/agents"),
  tick: (id: string) =>
    request<{ ok?: boolean; reason?: string; attemptId?: string }>(
      `/api/agents/${encodeURIComponent(id)}/tick`,
      { method: "POST" },
    ),
  pause: () => request<{ ok: true }>("/api/admin/pause", { method: "POST" }),
  resume: () => request<{ ok: true }>("/api/admin/resume", { method: "POST" }),
  seed: () => request<{ ok: true }>("/api/admin/seed", { method: "POST" }),
  breakers: () =>
    request<{ frozen: string[]; admission: string; churnLimit: number; windowMin: number }>("/api/breakers"),
  toml: () =>
    request<{ enabled: boolean; patterns: string[]; defaultShard: string; source: string }>(
      `/api/repos/${REPO}/colony-toml`,
    ),
  artifacts: () => request<{ bound: boolean; namespace?: string; repos?: string[]; error?: string }>("/api/artifacts"),
  events: () =>
    request<{ events: { id: string; kind: string; repo: string | null; createdAt: number }[] }>("/api/events"),
  ledgerFile: (taskId: string) =>
    request<{ path: string; markdown: string }>(`/api/ledger/${encodeURIComponent(taskId)}/file`),
};

export function usePoll<T>(loader: () => Promise<T>, key = "") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      loaderRef.current()
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(oneLine(err));
        });
    };
    run();
    const id = window.setInterval(run, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [key, nonce]);

  return {
    data,
    error,
    refetch: () => setNonce((n) => n + 1),
  };
}
