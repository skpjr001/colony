import { useMemo, useState } from "react";
import { api, remain, shortId, useColony, usePoll, type Claim } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

function groupClaims(claims: Claim[], filter: string): Map<string, Claim[]> {
  const map = new Map<string, Claim[]>();
  const add = (key: string, claim: Claim) => {
    const list = map.get(key);
    if (list) list.push(claim);
    else map.set(key, [claim]);
  };
  for (const claim of claims) {
    if (filter) {
      add(filter, claim);
      continue;
    }
    const keys = claim.shards.length ? claim.shards : ["—"];
    for (const key of keys) add(key, claim);
  }
  for (const list of map.values()) list.sort((a, b) => b.strength - a.strength);
  return map;
}

export function Board() {
  const { scale } = useColony();
  const [shard, setShard] = useState("");
  const poll = usePoll(() => api.board(shard || undefined), shard);
  const claims = poll.data?.claims ?? [];

  const chips = useMemo(() => {
    const set = new Set<string>();
    for (const s of scale?.shards ?? []) set.add(s.key);
    for (const c of claims) for (const key of c.shards) set.add(key);
    return [...set].sort();
  }, [scale, claims]);

  const groups = poll.data ? groupClaims(claims, shard) : new Map<string, Claim[]>();
  if (poll.data && !shard) {
    for (const s of scale?.shards ?? []) {
      if (!groups.has(s.key)) groups.set(s.key, []);
    }
  }
  const keys = [...groups.keys()].sort();

  return (
    <Page title="Claim board" meta={poll.data ? `${claims.length} claims` : undefined}>
      {poll.error && <p className="font-mono text-xs text-destructive">{poll.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={shard === "" ? "default" : "outline"} onClick={() => setShard("")}>
          all
        </Button>
        {chips.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={shard === key ? "default" : "outline"}
            onClick={() => setShard(key)}
          >
            {key}
          </Button>
        ))}
      </div>
      {!poll.data && !poll.error && <Skeleton className="h-24 w-full" />}
      {poll.data && keys.length === 0 && (
        <p className="text-sm text-muted-foreground">No live claims.</p>
      )}
      {keys.map((key) => {
        const rows = groups.get(key) ?? [];
        const load = scale?.shards.find((s) => s.key === key);
        const pct = load
          ? Math.max(0, Math.min(100, (load.load > 1 ? load.load / 100 : load.load) * 100))
          : 0;
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 font-mono text-sm">
                <span className="truncate">{key}</span>
                <Progress value={pct} className="max-w-32" />
                <span className="ml-auto font-normal text-muted-foreground">
                  {rows.length} claims
                  {load ? ` · churn ${load.churn.toFixed(2)}` : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {rows.map((c) => {
                const ratio = remain(c.strength, c.strength0);
                const fade = Math.max(0.18, Math.min(1, c.strength <= 1 ? c.strength : ratio));
                return (
                  <div
                    key={`${key}-${c.id}`}
                    className="grid grid-cols-[8rem_1fr_1.4fr_7rem] items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                    style={{ boxShadow: `inset 3px 0 0 oklch(0.76 0.14 75 / ${fade})` }}
                  >
                    <div>
                      <div className="truncate font-mono" title={c.agentId}>{shortId(c.agentId, 16)}</div>
                      <div className="truncate font-mono text-xs text-muted-foreground" title={c.id}>
                        {shortId(c.id, 10)}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {c.paths.length === 0 ? "—" : c.paths.join(" ")}
                    </div>
                    <div className="line-clamp-2" title={c.intent}>{c.intent || "—"}</div>
                    <div>
                      <Progress value={ratio * 100} className="opacity-90" style={{ opacity: fade }} />
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {c.strength.toFixed(2)} / {c.strength0.toFixed(2)}
                        {!c.alive && <Badge variant="outline" className="ml-1">dead</Badge>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </Page>
  );
}
