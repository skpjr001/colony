import { useState } from "react";
import { api, fmt, loadCap, oneLine, useColony, usePoll } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function Overview() {
  const { health, scale, refetch } = useColony();
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const breakers = usePoll(() => api.breakers());
  const shards = scale?.shards ?? [];
  const cap = loadCap(shards.map((s) => s.load));

  async function seed() {
    setSeeding(true);
    setSeedError(null);
    try {
      await api.seed();
      refetch();
    } catch (e) {
      setSeedError(oneLine(e));
    } finally {
      setSeeding(false);
    }
  }

  const metrics = [
    ["Agents", scale ? fmt(scale.agents) : "—"],
    ["Active claims", scale ? fmt(scale.activeClaims) : "—"],
    ["Claim ops/s", scale ? fmt(scale.claimOpsPerSec, 1) : "—"],
    ["Merges/h", scale ? fmt(scale.mergesPerHour, 1) : "—"],
    ["Tokens/h", scale ? fmt(scale.tokenSpendPerHour) : "—"],
  ] as const;

  return (
    <Page
      title="Overview"
      meta={health ? <Badge variant={health.ok ? "secondary" : "destructive"}>phase {health.phase}</Badge> : null}
    >
      {scale && scale.agents === 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>No agents on the board</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Button disabled={seeding} onClick={seed}>
              Seed demo colony
            </Button>
            {seedError && <span className="font-mono text-xs text-destructive">{seedError}</span>}
          </CardContent>
        </Card>
      )}
      {breakers.data && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={breakers.data.admission === "open" ? "secondary" : "destructive"}>
            admission {breakers.data.admission}
          </Badge>
          <Badge variant={breakers.data.frozen.length ? "destructive" : "outline"}>
            frozen {breakers.data.frozen.length ? breakers.data.frozen.join(", ") : "none"}
          </Badge>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl">{value}</CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Shard load</CardTitle>
        </CardHeader>
        <CardContent>
          {scale && shards.length === 0 && (
            <p className="text-sm text-muted-foreground">No shards reporting.</p>
          )}
          {shards.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>shard</TableHead>
                  <TableHead>load</TableHead>
                  <TableHead>claims</TableHead>
                  <TableHead>churn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shards.map((s) => {
                  const pct = cap > 0 ? Math.max(0, Math.min(100, (s.load / cap) * 100)) : 0;
                  return (
                    <TableRow key={s.key}>
                      <TableCell className="font-mono">{s.key}</TableCell>
                      <TableCell className="w-48">
                        <Progress value={pct} />
                      </TableCell>
                      <TableCell className="font-mono">{fmt(s.claims)}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{fmt(s.churn, 2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
