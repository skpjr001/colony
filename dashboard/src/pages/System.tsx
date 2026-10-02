import { api, useColony, usePoll } from "../api";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function System() {
  const { health } = useColony();
  const toml = usePoll(() => api.toml());
  const breakers = usePoll(() => api.breakers());
  const artifacts = usePoll(() => api.artifacts());
  const events = usePoll(() => api.events());

  return (
    <Page title="System" meta={health ? `v${health.version}` : undefined}>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>phase {health?.phase ?? "—"}</div>
            <div className="font-mono text-xs text-muted-foreground">core {health?.core ?? "—"}</div>
            <div className="font-mono text-xs">{health?.repo}</div>
            <Badge variant={health?.paused ? "destructive" : "secondary"}>
              {health?.paused ? "paused" : "live"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>colony.toml</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Badge variant="outline">{toml.data?.source ?? "…"}</Badge>
            <div>enabled {toml.data ? String(toml.data.enabled) : "—"}</div>
            <div className="font-mono text-xs">
              {(toml.data?.patterns ?? []).join(", ") || toml.data?.defaultShard || "—"}
            </div>
            {toml.error && <p className="text-xs text-destructive">{toml.error}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Breakers</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>admission {breakers.data?.admission ?? "—"}</div>
            <div>churn limit {breakers.data?.churnLimit ?? "—"} / {breakers.data?.windowMin ?? "—"} min</div>
            <div className="font-mono text-xs">
              frozen {breakers.data?.frozen.length ? breakers.data.frozen.join(", ") : "none"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>bound {artifacts.data ? String(artifacts.data.bound) : "—"}</div>
            <div className="font-mono text-xs">{artifacts.data?.namespace}</div>
            <div className="font-mono text-xs">{(artifacts.data?.repos ?? []).join(", ") || "no repos"}</div>
            {artifacts.data?.error && <p className="text-xs text-destructive">{artifacts.data.error}</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Artifact events</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>kind</TableHead>
                <TableHead>repo</TableHead>
                <TableHead>id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events.data?.events ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">No events.</TableCell>
                </TableRow>
              )}
              {(events.data?.events ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-mono text-xs">{event.kind}</TableCell>
                  <TableCell className="font-mono text-xs">{event.repo ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{event.id.slice(0, 12)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {events.error && <p className="mt-2 text-xs text-destructive">{events.error}</p>}
        </CardContent>
      </Card>
    </Page>
  );
}
