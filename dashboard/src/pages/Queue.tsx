import { Link } from "react-router-dom";
import { api, shortId, usePoll } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function tone(status: string): "destructive" | "secondary" | "default" {
  const s = status.toLowerCase();
  if (s.includes("fail") || s.includes("bisect") || s.includes("conflict")) return "destructive";
  if (s.includes("merge") || s.includes("land") || s.includes("green") || s === "ok") return "secondary";
  return "default";
}

export function Queue() {
  const poll = usePoll(() => api.mergeQueue());
  const train = poll.data?.train ?? null;
  const items = poll.data?.items ?? [];
  const bisect = poll.data?.bisect ?? null;

  return (
    <Page title="Merge queue" meta={poll.data ? `${items.length} waiting` : undefined}>
      {poll.error && <p className="font-mono text-xs text-destructive">{poll.error}</p>}
      {!poll.data && !poll.error && <Skeleton className="h-32 w-full" />}
      {poll.data && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Train</CardTitle>
            </CardHeader>
            <CardContent>
              {!train && <p className="text-sm text-muted-foreground">No active train.</p>}
              {train && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono" title={train.id}>{shortId(train.id, 16)}</span>
                    <Badge variant={tone(train.status)}>{train.status}</Badge>
                    <span className="text-muted-foreground">{train.members.length} members</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {train.members.length === 0 && (
                      <span className="text-sm text-muted-foreground">empty train</span>
                    )}
                    {train.members.map((id) => (
                      <Badge key={id} variant="outline" className="font-mono" title={id}>
                        {id}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bisect</CardTitle>
            </CardHeader>
            <CardContent>
              {bisect ? (
                <p className="text-sm text-destructive">{bisect}</p>
              ) : (
                <p className="text-sm text-muted-foreground">idle</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {poll.data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>attempt</TableHead>
              <TableHead>task</TableHead>
              <TableHead>shards</TableHead>
              <TableHead>train</TableHead>
              <TableHead>status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">Queue empty.</TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.attemptId}>
                <TableCell className="font-mono" title={item.attemptId}>{shortId(item.attemptId, 14)}</TableCell>
                <TableCell>
                  <Link className="font-mono underline-offset-4 hover:underline" to={`/tasks/${item.taskId}`}>
                    {shortId(item.taskId, 14)}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">{item.shards.join(" ") || "—"}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{shortId(item.trainId, 12)}</TableCell>
                <TableCell>
                  <Badge variant={tone(item.status)}>{item.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
