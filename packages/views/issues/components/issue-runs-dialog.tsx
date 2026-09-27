"use client";

import { useMemo } from "react";
import { ArrowRight, Ban, XCircle } from "lucide-react";
import type { AgentTask } from "@multica/core/types";
import { cn } from "@multica/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { useActorName } from "@multica/core/workspace/hooks";
import { useCustomPricingStore } from "@multica/core/runtimes/custom-pricing-store";
import { ActorAvatar } from "../../common/actor-avatar";
import { TranscriptButton } from "../../common/task-transcript";
import { cancellationActorLabel, cancelReasonLabel, failureReasonLabel } from "../../agents/components/tabs/task-failure";
import { formatDuration } from "../../dashboard/utils";
import { useLocale, useT } from "../../i18n";
import {
  collectUnmappedModels,
  formatTokens,
  formatUsd,
  type CostBreakdown,
} from "../../runtimes/utils";
import { AttributionBadge } from "./attribution-badge";
import {
  buildRunTimeline,
  groupRunsByDay,
  niceTicks,
  timeTicks,
  type RunTimeline,
  type TimelineRun,
} from "./issue-run-timeline";
import { canRetryRun, RetryRunButton } from "./retry-run-button";
import { useStatusLabel, useTriggerText } from "./task-run-labels";

// The issue's runs laid out in time — the surface the execution log's header
// and spend strip open.
//
// The sidebar answers "what is running and what just ran"; this answers "how
// did this issue get here": when each run happened, how long it took, who asked
// for it, and which ones moved the total. The chart on top is the shape of the
// issue (a cumulative cost curve over per-agent run lanes on one time axis);
// the list below is the same runs as rows, newest first — it is also the
// chart's accessible, exact-value view.
//
// Every figure comes from the same `summarizeTaskUsage` helpers the sidebar
// uses, so the total here can never disagree with the total that opened it.

// Cost categories in the order and colours the runtime usage charts stack them
// (`costStackConfig` in runtimes/components/charts/daily-cost-chart.tsx), so a
// run's cost bar reads the same as a day's bar on the usage page.
const COST_PARTS = [
  { key: "input", swatch: "bg-chart-1" },
  { key: "output", swatch: "bg-chart-2" },
  { key: "cacheRead", swatch: "bg-chart-4" },
  { key: "cacheWrite", swatch: "bg-chart-3" },
] as const satisfies readonly { key: keyof CostBreakdown; swatch: string }[];

type CostPartKey = (typeof COST_PARTS)[number]["key"];

function useCostPartLabel(): (key: CostPartKey) => string {
  const { t } = useT("issues");
  return (key) => {
    switch (key) {
      case "input": return t(($) => $.runs_timeline.cost_input);
      case "output": return t(($) => $.runs_timeline.cost_output);
      case "cacheRead": return t(($) => $.runs_timeline.cost_cache_read);
      case "cacheWrite": return t(($) => $.runs_timeline.cost_cache_write);
    }
  };
}

export function IssueRunsDialog({
  open,
  onOpenChange,
  issueId,
  identifier,
  issueTitle,
  tasks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueId: string;
  identifier: string;
  issueTitle?: string;
  tasks: AgentTask[];
}) {
  const { t } = useT("issues");
  // `estimateCost` reads custom rates imperatively out of the Zustand store,
  // so nothing re-renders this dialog when the user saves a new rate. Subscribe
  // to the snapshot and carry it into every memo that prices usage — same
  // reason the runtime usage page subscribes in usage-section.tsx.
  const pricings = useCustomPricingStore((s) => s.pricings);
  // Active runs stretch to "now". The clock is re-read when the task list
  // changes or the dialog reopens rather than ticking: the bars move by
  // minutes, and a live timer already runs in the sidebar row.
  const timeline = useMemo(
    () => buildRunTimeline(tasks, Date.now()),
    // `pricings` re-prices on a saved custom rate; `open` re-reads the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, pricings, open],
  );
  // Models with no rate-table entry and no provider-reported cost: their tokens
  // are counted but their spend is not, so the totals understate reality.
  const unmapped = useMemo(
    () => collectUnmappedModels(tasks.flatMap((task) => task.usage ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pricings` changes which models are priced
    [tasks, pricings],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent's base is `sm:max-w-sm`, which a same-specificity
          `max-w-5xl` does not beat — `!` wins it, matching the transcript
          dialog. Fixed height so the chart stays put while the list scrolls. */}
      <DialogContent className="flex !h-[min(56rem,calc(100dvh-4rem))] !w-[calc(100vw-4rem)] !max-w-5xl flex-col !gap-0 overflow-hidden !p-0">
        <DialogHeader className="px-6 pt-5 pb-4">
          <DialogTitle>{t(($) => $.runs_timeline.title)}</DialogTitle>
          <DialogDescription>
            {issueTitle ? `${identifier} · ${issueTitle}` : identifier}
          </DialogDescription>
        </DialogHeader>

        {timeline.runs.length > 0 && (
          <>
            <RunStats timeline={timeline} />
            <RunTimelineChart timeline={timeline} />
            {/* `min-h-0`: the dialog is a flex column; without it this flex
                item sizes to its content and the list never scrolls. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
              <RunDayList timeline={timeline} issueId={issueId} />
              <div className="mt-4 space-y-1 text-micro text-muted-foreground">
                {unmapped.length > 0 && (
                  <p>{t(($) => $.runs_timeline.note_unmapped, { models: unmapped.join(", ") })}</p>
                )}
                <p>{t(($) => $.runs_timeline.note_estimate)}</p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Stats ─────────────────────────────────────────────────────────────────

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// `formatDuration` falls back to this label only below one second.
const UNDER_A_SECOND = "0s";

function RunStats({ timeline }: { timeline: RunTimeline }) {
  const { t } = useT("issues");
  const breakdown = [
    timeline.failedCount > 0 &&
      t(($) => $.runs_timeline.count_failed, { count: timeline.failedCount }),
    timeline.cancelledCount > 0 &&
      t(($) => $.runs_timeline.count_cancelled, { count: timeline.cancelledCount }),
    timeline.activeCount > 0 &&
      t(($) => $.runs_timeline.count_active, { count: timeline.activeCount }),
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3 px-6">
      <Stat label={t(($) => $.runs_timeline.stat_spent)}>
        {/* Proportional figures: a standalone hero number set in tabular
            digits reads loose. "—" when nothing reported usage — never $0. */}
        <span className="text-display-sm font-semibold">
          {timeline.pricedCount > 0 ? formatUsd(timeline.totalCost) : "—"}
        </span>
      </Stat>
      <Stat label={t(($) => $.runs_timeline.stat_agent_time)}>
        <span className="text-title-sm font-medium">
          {formatDuration(timeline.agentMs / 1000, UNDER_A_SECOND)}
        </span>
      </Stat>
      <Stat label={t(($) => $.runs_timeline.stat_elapsed)}>
        <span className="text-title-sm font-medium">
          {formatDuration(timeline.elapsedMs / 1000, UNDER_A_SECOND)}
        </span>
      </Stat>
      <Stat label={t(($) => $.runs_timeline.stat_runs)}>
        <span className="text-title-sm font-medium">{timeline.runs.length}</span>
        {breakdown.length > 0 && (
          <span className="ml-1.5 text-caption text-muted-foreground">
            · {breakdown.join(" · ")}
          </span>
        )}
      </Stat>
      <div className="ml-auto flex items-center gap-4 pb-0.5 text-caption text-muted-foreground">
        {timeline.pricedCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-chart-1" />
            {t(($) => $.runs_timeline.legend_cumulative)}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-[2px] bg-chart-2" />
          {t(($) => $.runs_timeline.legend_run)}
        </span>
      </div>
    </div>
  );
}

// ─── Chart ─────────────────────────────────────────────────────────────────

const PLOT_HEIGHT = 112;

function runBarTone(run: TimelineRun, isPeak: boolean): string {
  if (run.active) return "bg-info animate-pulse";
  if (run.task.status === "failed") return "bg-destructive";
  if (run.task.status === "cancelled") return "bg-faint-foreground";
  return isPeak ? "bg-chart-1" : "bg-chart-2";
}

function RunTimelineChart({ timeline }: { timeline: RunTimeline }) {
  const { t } = useT("issues");
  const locale = useLocale();
  const { getActorName } = useActorName();
  const [d0, d1] = timeline.domain;
  // Without any usage there is no curve to draw; the lanes still show when
  // each run happened.
  const plotHeight = timeline.pricedCount > 0 ? PLOT_HEIGHT : 0;
  const xPct = (ms: number) => ((ms - d0) / (d1 - d0)) * 100;

  const yTicks = niceTicks(timeline.totalCost);
  const yMax = yTicks[yTicks.length - 1] ?? 1;
  const yPct = (cost: number) => (1 - cost / yMax) * 100;

  const ticks = timeTicks(timeline.domain);
  const tickFormat = useMemo(() => {
    const day = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" });
    const hour = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    return (tick: (typeof ticks)[number]) =>
      tick.kind === "day" ? day.format(tick.t) : hour.format(tick.t);
  }, [locale]);

  // Step curve in a 1000×100 box stretched over the plot; the stroke keeps its
  // 2px via non-scaling-stroke however wide the dialog is.
  const steps = timeline.cumulative;
  let line = `M0,100`;
  let prevY = 100;
  for (const step of steps) {
    const x = xPct(step.t) * 10;
    const y = yPct(step.cost);
    line += ` L${x.toFixed(2)},${prevY.toFixed(2)} L${x.toFixed(2)},${y.toFixed(2)}`;
    prevY = y;
  }
  line += ` L1000,${prevY.toFixed(2)}`;
  const area = `${line} L1000,100 L0,100 Z`;
  const last = steps[steps.length - 1];

  // Label the one run that moved the curve most. Left of its step the curve is
  // lower (it only ever rises), so a label ending at the step's top-left
  // corner never sits on the line. Near the left edge there is no room for
  // that; right of the step the curve can still rise into anything above it,
  // so the label drops just below the line instead, into the area wash.
  const peak = timeline.peak;
  const peakStep = peak ? steps.find((s) => s.t === peak.endMs) : undefined;
  const peakX = peakStep ? xPct(peakStep.t) : 0;

  return (
    <div
      role="img"
      aria-label={t(($) => $.runs_timeline.chart_aria, {
        count: timeline.runs.length,
        cost: formatUsd(timeline.totalCost),
      })}
      className="mt-5 flex gap-3 border-b px-6 pb-3"
    >
      {/* Lane labels, aligned with the lanes in the plot column. */}
      <div className="w-24 shrink-0" aria-hidden>
        <div style={{ height: plotHeight }} />
        <div className={cn("space-y-1.5", plotHeight > 0 && "mt-3")}>
          {timeline.lanes.map((lane) => (
            <div key={lane.agentId} className="flex h-3.5 min-w-0 items-center gap-1.5">
              <ActorAvatar actorType="agent" actorId={lane.agentId} size="xs" />
              <span className="truncate text-micro text-muted-foreground">
                {getActorName("agent", lane.agentId)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative min-w-0 flex-1">
        {/* Time gridlines run through the curve and the lanes alike. */}
        {ticks.map((tick) => (
          <span
            key={tick.t}
            aria-hidden
            className="absolute top-0 bottom-5 w-px bg-border"
            style={{ left: `${xPct(tick.t)}%` }}
          />
        ))}

        <div className="relative" style={{ height: plotHeight }} aria-hidden>
          {yTicks.map((v) => (
            <span
              key={v}
              className="absolute inset-x-0 h-px bg-border"
              style={{ top: `${yPct(v)}%` }}
            />
          ))}
          {steps.length > 0 && (
            <svg
              className="absolute inset-0 size-full overflow-visible"
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
            >
              <path d={area} fill="var(--chart-1)" fillOpacity={0.1} />
              <path
                d={line}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {last && (
            <span
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-popover"
              style={{ left: `${xPct(last.t)}%`, top: `${yPct(last.cost)}%` }}
            />
          )}
          {peak && peakStep && (
            <PeakLabel
              run={peak}
              style={{
                left: `${peakX}%`,
                top: `${yPct(peakStep.cost)}%`,
                transform:
                  peakX >= 30
                    ? "translate(calc(-100% - 6px), calc(-100% - 2px))"
                    : "translate(6px, 4px)",
              }}
            />
          )}
        </div>

        <div className={cn("space-y-1.5", plotHeight > 0 && "mt-3")}>
          {timeline.lanes.map((lane) => (
            <div key={lane.agentId} className="relative h-3.5 rounded-xs bg-muted/60">
              {lane.runs.map((run) => (
                <RunBar
                  key={run.task.id}
                  run={run}
                  tone={runBarTone(run, run === peak)}
                  left={xPct(run.startMs)}
                  width={xPct(run.endMs) - xPct(run.startMs)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="relative mt-1 h-5" aria-hidden>
          {ticks.map((tick) => {
            const x = xPct(tick.t);
            return (
              <span
                key={tick.t}
                className="absolute top-1 whitespace-nowrap px-1 text-micro text-muted-foreground"
                style={{ left: `${x}%`, transform: x > 92 ? "translateX(-100%)" : undefined }}
              >
                {tickFormat(tick)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Y scale on the right, where the curve ends; the end value is the
          one figure labelled in full. */}
      <div className="relative w-12 shrink-0 text-micro tabular-nums" style={{ height: plotHeight }} aria-hidden>
        {yTicks.map((v) =>
          last && Math.abs(yPct(v) - yPct(last.cost)) < 12 ? null : (
            <span
              key={v}
              className="absolute left-1 -translate-y-1/2 text-muted-foreground"
              style={{ top: `${yPct(v)}%` }}
            >
              {formatTick(v)}
            </span>
          ),
        )}
        {last && (
          <span
            className="absolute left-1 -translate-y-1/2 font-medium text-foreground"
            style={{ top: `${yPct(last.cost)}%` }}
          >
            {formatUsd(last.cost)}
          </span>
        )}
      </div>
    </div>
  );
}

// Axis steps are round numbers; "$50.00" would print noise the curve's end
// label, which keeps full precision, does not need.
function formatTick(v: number): string {
  return Number.isInteger(v) ? `$${v}` : formatUsd(v);
}

function PeakLabel({ run, style }: { run: TimelineRun; style: React.CSSProperties }) {
  const trigger = useTriggerText(run.task);
  return (
    <span
      className="absolute flex max-w-60 items-baseline gap-1 whitespace-nowrap text-micro"
      style={style}
    >
      <span className="font-medium text-foreground">+{formatUsd(run.usage?.cost ?? 0)}</span>
      <span className="truncate text-muted-foreground">{trigger}</span>
    </span>
  );
}

function RunBar({
  run,
  tone,
  left,
  width,
}: {
  run: TimelineRun;
  tone: string;
  left: number;
  width: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn("absolute inset-y-0.5 min-w-[3px] rounded-[2px]", tone)}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
      <TooltipContent className="max-w-72">
        <RunSummary run={run} />
      </TooltipContent>
    </Tooltip>
  );
}

function RunSummary({ run }: { run: TimelineRun }) {
  const { getActorName } = useActorName();
  const trigger = useTriggerText(run.task);
  const status = useStatusLabel(run.task.status);
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(run.startMs);
  const facts = [
    getActorName("agent", run.task.agent_id),
    when,
    run.durationMs != null ? formatDuration(run.durationMs / 1000, UNDER_A_SECOND) : status,
    run.usage ? formatUsd(run.usage.cost) : null,
  ].filter(Boolean);
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate">{trigger}</span>
      <span className="text-micro text-muted-foreground">{facts.join(" · ")}</span>
    </div>
  );
}

// ─── List ──────────────────────────────────────────────────────────────────

function RunDayList({ timeline, issueId }: { timeline: RunTimeline; issueId: string }) {
  const { t } = useT("issues");
  const locale = useLocale();
  const partLabel = useCostPartLabel();
  const groups = useMemo(() => groupRunsByDay(timeline.runs), [timeline.runs]);

  const dayLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return (dayMs: number) => {
      if (dayMs === today.getTime()) return t(($) => $.runs_timeline.day_today);
      if (dayMs === yesterday.getTime()) return t(($) => $.runs_timeline.day_yesterday);
      return fmt.format(dayMs);
    };
  }, [locale, t]);

  return (
    <div>
      {timeline.pricedCount > 0 && (
        <div className="flex justify-end gap-3 pt-3 text-micro text-muted-foreground">
          {COST_PARTS.map((part) => (
            <span key={part.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-[2px]", part.swatch)} />
              {partLabel(part.key)}
            </span>
          ))}
        </div>
      )}
      {groups.map((group) => (
        <section key={group.dayMs} aria-label={dayLabel(group.dayMs)}>
          <div className="flex items-baseline gap-2 border-b pt-4 pb-1.5 text-micro text-muted-foreground">
            <span className="font-medium uppercase tracking-wider text-foreground">
              {dayLabel(group.dayMs)}
            </span>
            <span className="ml-auto tabular-nums">
              {[
                t(($) => $.runs_timeline.day_runs, { count: group.runs.length }),
                group.agentMs > 0 ? formatDuration(group.agentMs / 1000, UNDER_A_SECOND) : null,
                group.runs.some((r) => r.usage) ? formatUsd(group.cost) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {group.runs.map((run) => (
            <RunListRow
              key={run.task.id}
              run={run}
              issueId={issueId}
              maxCost={timeline.maxRunCost}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function RunListRow({
  run,
  issueId,
  maxCost,
}: {
  run: TimelineRun;
  issueId: string;
  maxCost: number;
}) {
  const { t } = useT("issues");
  const { t: tAgents } = useT("agents");
  const locale = useLocale();
  const { getActorName } = useActorName();
  const trigger = useTriggerText(run.task);
  const statusLabel = useStatusLabel(run.task.status);
  const task = run.task;
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(run.startMs);
  // Comment-triggered runs quote what the person said; structural triggers
  // (assignment, autopilot, retry labels) read as plain labels.
  const quoted = !!task.trigger_summary && !!task.trigger_comment_id;
  // Same localized reason the sidebar rows hover with — never the raw
  // `task.error`, which is operator-facing English (#7411).
  const reason =
    task.status === "failed"
      ? failureReasonLabel(task.failure_reason, tAgents)
      : cancelReasonLabel(task, tAgents);
  const cancelledBy = cancellationActorLabel(task, tAgents);
  const statusTitle = [cancelledBy, reason].filter(Boolean).join(" · ") || statusLabel;
  const agentName = getActorName("agent", task.agent_id);
  const label = quoted ? t(($) => $.runs_timeline.quoted, { text: trigger }) : trigger;

  return (
    <div className="group/run-row flex h-9 items-center gap-2.5 border-b text-caption transition-colors hover:bg-accent/40">
      <span className="w-10 shrink-0 font-mono text-micro tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className="flex w-4 shrink-0 justify-center">
        <AttributionBadge attribution={task.attribution} variant="avatar" />
      </span>
      {/* One line keeps the list scannable; the full text is in the native
          tooltip and, whole and wrapped, at the top of the transcript. */}
      <span
        title={label}
        className={cn(
          "min-w-0 flex-1 truncate text-label",
          run.usage || run.active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <ArrowRight aria-hidden className="size-3 shrink-0 text-faint-foreground" />
      <span className="flex w-28 shrink-0 items-center gap-1.5">
        <ActorAvatar actorType="agent" actorId={task.agent_id} size="xs" enableHoverCard />
        <span className="truncate">{agentName}</span>
      </span>
      <span className="flex w-24 shrink-0 items-center gap-1" title={statusTitle}>
        {run.active ? (
          <span className="flex items-center gap-1 text-info">
            <span className="size-1.5 rounded-full bg-info" />
            {statusLabel}
          </span>
        ) : task.status === "failed" ? (
          <span className="flex items-center gap-1 text-destructive">
            <XCircle aria-hidden className="size-3.5 shrink-0" />
            {statusLabel}
          </span>
        ) : task.status === "cancelled" ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Ban aria-hidden className="size-3.5 shrink-0" />
            {statusLabel}
          </span>
        ) : (
          <>
            <span className="tabular-nums text-muted-foreground">
              {run.durationMs != null ? formatDuration(run.durationMs / 1000, UNDER_A_SECOND) : "—"}
            </span>
            <span className="sr-only">{statusLabel}</span>
          </>
        )}
      </span>
      <span className="flex w-36 shrink-0 items-center justify-end gap-2">
        {run.usage && run.breakdown ? (
          <CostCell run={run} maxCost={maxCost} />
        ) : (
          // No figure is not zero: a run without usage data was not free.
          <span className="text-faint-foreground" title={t(($) => $.runs_timeline.no_usage)}>
            —
          </span>
        )}
      </span>
      <span className="flex w-14 shrink-0 items-center justify-end gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/run-row:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
        <TranscriptButton
          task={task}
          agentName={agentName}
          isLive={task.status === "running"}
          title={t(($) => $.execution_log.transcript_tooltip)}
        />
        {canRetryRun(task) && <RetryRunButton task={task} issueId={issueId} />}
      </span>
    </div>
  );
}

function CostCell({ run, maxCost }: { run: TimelineRun; maxCost: number }) {
  const partLabel = useCostPartLabel();
  const usage = run.usage!;
  const breakdown = run.breakdown!;
  const share = maxCost > 0 ? (usage.cost / maxCost) * 100 : 0;
  const tokenCount: Record<CostPartKey, number> = {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className="flex items-center justify-end gap-2"
      >
        <span className="flex w-20 justify-start">
          <CostBar breakdown={breakdown} total={usage.cost} widthPx={(share / 100) * COST_TRACK_PX} />
        </span>
        <span className="w-14 text-right font-medium tabular-nums">{formatUsd(usage.cost)}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 flex-col items-stretch gap-1 py-2">
        {COST_PARTS.map((part) => (
          <span key={part.key} className="flex items-center gap-2 tabular-nums">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", part.swatch)} />
            <span className="flex-1 text-muted-foreground">{partLabel(part.key)}</span>
            <span className="w-14 text-right text-muted-foreground">
              {formatTokens(tokenCount[part.key])}
            </span>
            <span className="w-14 text-right font-medium">{formatUsd(breakdown[part.key])}</span>
          </span>
        ))}
        {usage.models.length > 0 && (
          <span className="mt-1 border-t pt-1 text-micro text-muted-foreground">
            {usage.models.join(", ")}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Width of the cost bar's track (`w-20`).
const COST_TRACK_PX = 80;

// A run's cost as one bar: length is its share of the most expensive run, the
// segments split it by what was billed. Segments too thin to see are dropped
// rather than drawn as a sliver next to a gap, and a bar too short to hold
// its gaps shows only its largest part — gaps alone would swallow it.
function CostBar({
  breakdown,
  total,
  widthPx,
}: {
  breakdown: CostBreakdown;
  total: number;
  widthPx: number;
}) {
  const visible = total > 0
    ? COST_PARTS.filter((part) => breakdown[part.key] / total >= 0.01)
    : [];
  const parts =
    widthPx < 12
      ? visible.toSorted((a, b) => breakdown[b.key] - breakdown[a.key]).slice(0, 1)
      : visible;
  return (
    <span
      aria-hidden
      className="flex h-1 gap-0.5 overflow-hidden rounded-full"
      style={{ width: Math.max(3, widthPx) }}
    >
      {parts.map((part) => (
        <span
          key={part.key}
          className={cn("h-full", part.swatch)}
          style={{ flexGrow: breakdown[part.key], flexBasis: 0 }}
        />
      ))}
    </span>
  );
}
