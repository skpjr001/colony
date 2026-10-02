import { Link } from "react-router-dom";
import { api, fmt, LANES, usePoll, type Task } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

function laneKey(state: string): string {
  return LANES.find((lane) => lane.toLowerCase() === state.toLowerCase()) ?? state;
}

function uncertaintyVariant(u: string): "destructive" | "default" | "outline" {
  if (u === "High") return "destructive";
  if (u === "Medium") return "default";
  return "outline";
}

export function Tasks() {
  const poll = usePoll(() => api.tasks());
  const tasks = poll.data?.tasks ?? [];
  const extras = [
    ...new Set(
      tasks.map((t) => laneKey(t.state)).filter((s) => !LANES.includes(s as (typeof LANES)[number])),
    ),
  ];
  const lanes = [...LANES, ...extras];

  return (
    <Page title="Tasks" meta={poll.data ? `${tasks.length} tasks` : undefined}>
      {poll.error && <p className="font-mono text-xs text-destructive">{poll.error}</p>}
      {!poll.data && !poll.error && <Skeleton className="h-40 w-full" />}
      {poll.data && (
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-3">
            {lanes.map((lane) => {
              const rows = tasks
                .filter((t) => laneKey(t.state) === lane)
                .sort((a, b) => b.urgency - a.urgency);
              return (
                <Card key={lane} className="w-64 shrink-0">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-sm">
                      {lane}
                      <Badge variant="secondary">{rows.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {rows.map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </Page>
  );
}

function TaskRow({ task }: { task: Task }) {
  const scores = (task.attempts ?? []).map((a) => a.score).filter((s): s is number => s != null);
  return (
    <Link
      className="block rounded-lg border bg-background/40 p-2 hover:bg-muted"
      to={`/tasks/${task.id}`}
      title={task.intent}
    >
      <div className="text-sm">{task.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant={uncertaintyVariant(task.uncertainty)}>{task.uncertainty}</Badge>
        <span>urg {fmt(task.urgency, 2)}</span>
        <span className="font-mono">{task.id}</span>
      </div>
      {scores.length > 0 && (
        <div className="mt-2 flex gap-1">
          {scores.map((score, i) => (
            <Badge key={`${task.id}-${i}`} variant="outline" className="font-mono">
              {fmt(score, 2)}
            </Badge>
          ))}
        </div>
      )}
    </Link>
  );
}
