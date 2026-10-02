import { useState } from "react";
import { api, fmt, oneLine, usePoll } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function statusVariant(status: string): "secondary" | "destructive" | "default" {
  const s = status.toLowerCase();
  if (s === "active" || s === "idle" || s === "ready" || s === "healthy") return "secondary";
  if (s === "paused" || s === "suspended" || s === "banned" || s === "down") return "destructive";
  return "default";
}

function trustWidth(trust: number): number {
  if (!Number.isFinite(trust) || trust <= 0) return 0;
  if (trust <= 1) return trust * 100;
  if (trust <= 100) return trust;
  return 100;
}

export function Agents() {
  const poll = usePoll(() => api.agents());
  const agents = poll.data?.agents ?? [];
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function tick(id: string) {
    setPending(id);
    setNote(null);
    try {
      const result = await api.tick(id);
      setNote(result.attemptId ? `${id} took ${result.attemptId}` : `${id}: ${result.reason ?? "ok"}`);
      poll.refetch();
    } catch (error) {
      setNote(oneLine(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <Page title="Agents" meta={poll.data ? `${agents.length} registered` : undefined}>
      {poll.error && <p className="font-mono text-xs text-destructive">{poll.error}</p>}
      {note && <p className="font-mono text-xs text-muted-foreground">{note}</p>}
      {!poll.data && !poll.error && <Skeleton className="h-32 w-full" />}
      {poll.data && agents.length === 0 && (
        <p className="text-sm text-muted-foreground">Trust registry empty.</p>
      )}
      {agents.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>id</TableHead>
              <TableHead>tier</TableHead>
              <TableHead>trust</TableHead>
              <TableHead>specialties</TableHead>
              <TableHead>status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <div className="font-mono">{agent.id}</div>
                  <div className="font-mono text-xs text-muted-foreground">{agent.modelFamily}</div>
                </TableCell>
                <TableCell className="font-mono">{agent.tier}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={trustWidth(agent.trust)} className="w-24" />
                    <span className="font-mono text-xs">
                      {fmt(agent.trust, agent.trust <= 1 ? 2 : 0)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {agent.specialties.length ? agent.specialties.join(", ") : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" disabled={pending === agent.id} onClick={() => tick(agent.id)}>
                    Run
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
