import { useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtTime, oneLine, usePoll } from "../api";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function Escalations() {
  const poll = usePoll(() => api.escalations());
  const [pending, setPending] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const items = poll.data?.items ?? [];
  const err = actError ?? poll.error;

  async function decide(taskId: string, decision: "approve" | "reject") {
    setPending(taskId);
    setActError(null);
    try {
      await api.decide(taskId, decision);
      poll.refetch();
    } catch (e) {
      setActError(oneLine(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <Page title="Escalations" meta={poll.data ? `${items.length} open` : undefined}>
      {err && <p className="font-mono text-xs text-destructive">{err}</p>}
      {!poll.data && !poll.error && <Skeleton className="h-24 w-full" />}
      {poll.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Inbox clear.</p>
      )}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>when</TableHead>
              <TableHead>task</TableHead>
              <TableHead>reason</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.taskId}>
                <TableCell className="font-mono text-muted-foreground">{fmtTime(item.createdAt)}</TableCell>
                <TableCell>
                  <Link className="underline-offset-4 hover:underline" to={`/tasks/${item.taskId}`}>
                    {item.title}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{item.taskId}</div>
                </TableCell>
                <TableCell>{item.reason}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending === item.taskId}
                      onClick={() => decide(item.taskId, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending === item.taskId}
                      onClick={() => decide(item.taskId, "reject")}
                    >
                      Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
