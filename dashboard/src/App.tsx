import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  GitMerge,
  Hexagon,
  LayoutDashboard,
  ListTodo,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import { api, ColonyProvider, oneLine, usePoll } from "./api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Agents } from "./pages/Agents";
import { Board } from "./pages/Board";
import { Escalations } from "./pages/Escalations";
import { Ledger } from "./pages/Ledger";
import { Overview } from "./pages/Overview";
import { Queue } from "./pages/Queue";
import { TaskDetail } from "./pages/TaskDetail";
import { System } from "./pages/System";
import { Tasks } from "./pages/Tasks";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/board", label: "Board", icon: Hexagon },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/queue", label: "Queue", icon: GitMerge },
  { to: "/ledger", label: "Ledger", icon: ScrollText },
  { to: "/escalations", label: "Escalations", icon: AlertTriangle },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/system", label: "System", icon: Settings },
] as const;

function activePath(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Shell() {
  const location = useLocation();
  const healthPoll = usePoll(() => api.health());
  const scalePoll = usePoll(() => api.scale());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localPaused, setLocalPaused] = useState<boolean | null>(null);

  useEffect(() => {
    if (healthPoll.data) setLocalPaused(healthPoll.data.paused);
  }, [healthPoll.data]);

  const serverPaused = healthPoll.data?.paused ?? scalePoll.data?.paused;
  const known = serverPaused != null || localPaused != null;
  const paused = localPaused ?? serverPaused ?? false;
  const err = actionError ?? healthPoll.error ?? scalePoll.error;

  async function toggle() {
    const next = !paused;
    setBusy(true);
    setActionError(null);
    try {
      if (next) await api.pause();
      else await api.resume();
      setLocalPaused(next);
      healthPoll.refetch();
      scalePoll.refetch();
    } catch (e) {
      setActionError(oneLine(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ColonyProvider
      value={{
        health: healthPoll.data,
        scale: scalePoll.data,
        refetch: () => {
          healthPoll.refetch();
          scalePoll.refetch();
        },
      }}
    >
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="size-2 shrink-0 rounded-full bg-primary" />
              <span className="truncate text-sm font-medium tracking-[0.18em]">COLONY</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map(({ to, label, icon: Icon }) => (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        asChild
                        isActive={activePath(location.pathname, to)}
                        tooltip={label}
                      >
                        <NavLink to={to} end={to === "/"}>
                          <Icon />
                          <span>{label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <div className="px-2 py-1 font-mono text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
              <div>colony-demo</div>
              <div>
                {healthPoll.data
                  ? `phase ${healthPoll.data.phase} · v${healthPoll.data.version}`
                  : "—"}
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <Badge variant={paused ? "destructive" : "secondary"}>
              {paused ? "paused" : "live"}
            </Badge>
            {healthPoll.data && (
              <Badge variant="outline">phase {healthPoll.data.phase}</Badge>
            )}
            {healthPoll.data?.core && (
              <Badge variant="outline" className="font-mono">
                {healthPoll.data.core}
              </Badge>
            )}
            <div className="ml-auto">
              <Button
                size="sm"
                variant={paused ? "secondary" : "destructive"}
                disabled={!known || busy}
                onClick={toggle}
              >
                {paused ? "Resume" : "Pause"}
              </Button>
            </div>
          </header>
          {paused && (
            <Alert variant="destructive" className="rounded-none border-x-0">
              <AlertTitle>Colony paused</AlertTitle>
              <AlertDescription>Kill switch engaged.</AlertDescription>
            </Alert>
          )}
          {err && (
            <Alert variant="destructive" className="rounded-none border-x-0">
              <AlertDescription className="font-mono text-xs">{err}</AlertDescription>
            </Alert>
          )}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/board" element={<Board />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/tasks/:id" element={<TaskDetail />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/escalations" element={<Escalations />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/system" element={<System />} />
          </Routes>
        </SidebarInset>
      </SidebarProvider>
    </ColonyProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Shell />
      </TooltipProvider>
    </BrowserRouter>
  );
}
