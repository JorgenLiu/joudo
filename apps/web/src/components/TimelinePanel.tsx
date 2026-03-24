import { useMemo, useState } from "react";

import type { SessionTimelineEntry } from "@joudo/shared";

import { CompactText } from "./CompactText";
import { approvalTypeLabel, decisionResolutionLabel, timelineLabel } from "./display";

const TIMELINE_ITEMS_LIMIT = 20;

type TimelinePanelProps = {
  timeline: SessionTimelineEntry[];
};

export function TimelinePanel({ timeline }: TimelinePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const availableKinds = useMemo(() => {
    const kinds = new Set(timeline.map((entry) => entry.kind));
    return [...kinds].sort();
  }, [timeline]);

  const filteredTimeline = kindFilter ? timeline.filter((entry) => entry.kind === kindFilter) : timeline;
  const visibleTimeline = expanded ? filteredTimeline : filteredTimeline.slice(0, TIMELINE_ITEMS_LIMIT);
  const remainingCount = filteredTimeline.length - TIMELINE_ITEMS_LIMIT;

  return (
    <div className="timelinePanel">
      <div className="sectionHeader">
        <h2>时间线</h2>
        <span>{filteredTimeline.length} 条事件</span>
      </div>
      {availableKinds.length > 1 && (
        <div className="kindFilterBar">
          <button type="button" className={`kindFilterPill${kindFilter === null ? " active" : ""}`} onClick={() => setKindFilter(null)}>全部</button>
          {availableKinds.map((kind) => (
            <button key={kind} type="button" className={`kindFilterPill${kindFilter === kind ? " active" : ""}`} onClick={() => setKindFilter(kind)}>
              {timelineLabel({ kind } as SessionTimelineEntry)}
            </button>
          ))}
        </div>
      )}
      {filteredTimeline.length ? (
        <div className="timelineList">
          {visibleTimeline.map((entry) => (
            <article key={entry.id} className={`timelineEntry ${entry.kind}`}>
              <div className="timelineMeta">
                <span>{timelineLabel(entry)}</span>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
              </div>
              <strong>{entry.title}</strong>
              <CompactText text={entry.body} as="p" maxChars={240} />
              {entry.decision ? (
                <CompactText
                  text={[
                    decisionResolutionLabel(entry.decision.resolution) ?? "策略决策",
                    entry.decision.action,
                    entry.decision.approvalType ? approvalTypeLabel(entry.decision.approvalType) : null,
                    entry.decision.persistedToPolicy ? "已写入 policy" : null,
                    entry.decision.matchedRule ?? null,
                  ]
                    .filter((item): item is string => Boolean(item))
                    .join(" / ")}
                  as="span"
                  maxChars={220}
                />
              ) : null}
            </article>
          ))}
          {!expanded && remainingCount > 0 ? (
            <button type="button" className="compactToggle" onClick={() => setExpanded(true)}>
              加载全部 {filteredTimeline.length} 条
            </button>
          ) : null}
          {expanded && remainingCount > 0 ? (
            <button type="button" className="compactToggle" onClick={() => setExpanded(false)}>收起</button>
          ) : null}
        </div>
      ) : (
        <p className="emptyState">当前没有时间线事件。</p>
      )}
    </div>
  );
}