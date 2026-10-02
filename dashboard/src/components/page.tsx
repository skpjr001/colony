import type { ReactNode } from "react";

export function Page({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-medium tracking-tight">{title}</h1>
        {meta && <div className="font-mono text-xs text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </div>
  );
}
