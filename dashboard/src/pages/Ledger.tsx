import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtTime, oneLine, shortId, usePoll } from "../api";
import { Page } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function Ledger() {
  const poll = usePoll(() => api.ledger());
  const [open, setOpen] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const entries = poll.data?.entries ?? [];

  return (
    <Page title="Why-ledger" meta={poll.data ? `${entries.length} entries` : undefined}>
      {poll.error && <p className="font-mono text-xs text-destructive">{poll.error}</p>}
      {!poll.data && !poll.error && <Skeleton className="h-32 w-full" />}
      {poll.data && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">Ledger empty.</p>
      )}
      {entries.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>when</TableHead>
              <TableHead>task</TableHead>
              <TableHead>commit</TableHead>
              <TableHead>winner</TableHead>
              <TableHead>train</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const expanded = open === entry.id;
              return (
                <Fragment key={entry.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(expanded ? null : entry.id)}>
                    <TableCell className="font-mono text-muted-foreground">{fmtTime(entry.createdAt)}</TableCell>
                    <TableCell>
                      <Link
                        className="font-mono underline-offset-4 hover:underline"
                        to={`/tasks/${entry.taskId}`}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {shortId(entry.taskId, 14)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono">{shortId(entry.mergedCommit, 12)}</TableCell>
                    <TableCell className="font-mono">{shortId(entry.winnerAttempt, 12)}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {entry.trainId ? shortId(entry.trainId, 10) : "—"}
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <LedgerFile taskId={entry.taskId} onFile={setFile} onError={setFileError} />
                  )}
                  {expanded && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <div className="flex flex-col gap-2 py-1 text-sm">
                          <div>
                            <div className="text-xs text-muted-foreground">Intent</div>
                            <p>{entry.intent || "—"}</p>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Alternatives</div>
                            {entry.alternatives.length === 0 ? (
                              <p className="text-muted-foreground">none recorded</p>
                            ) : (
                              <ul className="list-disc pl-4 font-mono">
                                {entry.alternatives.map((alt) => (
                                  <li key={alt}>{alt}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Evidence</div>
                            <p>{entry.evidenceSummary || "—"}</p>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Repo file</div>
                            {fileError && <p className="text-destructive">{fileError}</p>}
                            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                              {file || "no .colony/ledger file"}
                            </pre>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}

function LedgerFile({
  taskId,
  onFile,
  onError,
}: {
  taskId: string;
  onFile: (value: string | null) => void;
  onError: (value: string | null) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    api
      .ledgerFile(taskId)
      .then((row) => {
        if (!cancelled) {
          onError(null);
          onFile(`${row.path}\n\n${row.markdown}`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onFile(null);
          onError(oneLine(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, onFile, onError]);
  return null;
}
