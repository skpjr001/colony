import { Link, useParams } from "react-router-dom";
import { api, fmt, shortId, usePoll, verdictMark } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s.includes("merge") || s === "approved") return "secondary";
  if (s.includes("abandon") || s.includes("reject") || s.includes("fail")) return "destructive";
  if (s.includes("explor") || s.includes("review") || s.includes("queue")) return "default";
  return "outline";
}

export function TaskDetail() {
  const { id = "" } = useParams();
  const poll = usePoll(() => api.task(id), id);
  const task = poll.data?.task;
  const attempts = poll.data?.attempts ?? task?.attempts ?? [];
  const reviews = poll.data?.reviews ?? [];

  return (
    <Page
      title={task?.title ?? "Task"}
      meta={
        <Button variant="outline" size="sm" asChild>
          <Link to="/tasks">Tasks</Link>
        </Button>
      }
    >
      {poll.error && <p className="font-mono text-xs text-destructive">{poll.error}</p>}
      {!poll.data && !poll.error && <Skeleton className="h-32 w-full" />}
      {task && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-normal">
              <span className="font-mono">{task.id}</span>
              <Badge variant="outline">{task.state}</Badge>
              <Badge variant={task.uncertainty === "High" ? "destructive" : task.uncertainty === "Low" ? "outline" : "default"}>
                {task.uncertainty}
              </Badge>
              <span className="text-muted-foreground">urg {fmt(task.urgency, 2)}</span>
              <span className="text-muted-foreground">{task.repo}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="max-w-3xl text-sm">{task.intent}</p>
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>
            {task.pathsHint.length > 0 && (
              <p className="font-mono text-xs text-muted-foreground">{task.pathsHint.join("  ")}</p>
            )}
          </CardContent>
        </Card>
      )}
      {poll.data && (
        <Card>
          <CardHeader>
            <CardTitle>Attempts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {attempts.length === 0 && <p className="text-sm text-muted-foreground">No attempts.</p>}
            {attempts.map((a) => (
              <div key={a.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-4">
                <div>
                  <div className="truncate font-mono" title={a.agentId}>{shortId(a.agentId, 18)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{shortId(a.id, 12)}</div>
                </div>
                <Badge variant={statusVariant(a.status)} className="w-fit">{a.status}</Badge>
                <div className="font-mono text-primary">{a.score == null ? "—" : fmt(a.score, 2)}</div>
                <div>
                  <div className="font-mono" title={a.headCommit ?? ""}>{shortId(a.headCommit, 14)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{a.forkRepo}</div>
                </div>
                {a.evidence && (
                  <div className="md:col-span-4">
                    <div className="flex gap-2 text-xs">
                      <Badge variant={a.evidence.requiredTestsPassed ? "secondary" : "destructive"}>
                        {a.evidence.testsPassed}/{a.evidence.testsTotal} tests
                      </Badge>
                      <span className="text-muted-foreground">{a.evidence.linesChanged} lines</span>
                      <span className="text-muted-foreground">{a.evidence.filesChanged.length} files</span>
                    </div>
                    <p className="mt-2">{a.evidence.agentRationale}</p>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {poll.data && (
        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-1">
              {reviews.length === 0 && <span className="text-sm text-muted-foreground">no reviews</span>}
              {reviews.map((r) => (
                <span
                  key={r.id}
                  title={`${r.reviewerId} ${r.verdict}`}
                  className={
                    verdictMark(r.verdict) === "pass"
                      ? "size-2.5 rounded-full bg-success"
                      : verdictMark(r.verdict) === "fail"
                        ? "size-2.5 rounded-full bg-destructive"
                        : "size-2.5 rounded-full bg-primary"
                  }
                />
              ))}
            </div>
            {reviews.map((r) => (
              <div key={r.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-4">
                <div className="truncate font-mono" title={r.reviewerId}>{shortId(r.reviewerId, 18)}</div>
                <Badge variant={verdictMark(r.verdict) === "fail" ? "destructive" : "secondary"} className="w-fit">
                  {r.verdict}
                </Badge>
                <div className="font-mono">{fmt(r.score, 2)}</div>
                <div>
                  <div className="font-mono text-xs text-muted-foreground">{r.modelFamily}</div>
                  <div>{r.notes}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
