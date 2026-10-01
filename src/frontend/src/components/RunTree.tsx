import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ResearchPlan, ResearchStepState } from '../lib/api';

/* A research run as a tree of data.
 *
 * The levels are the derivation: the run, the question asked, the source that answered it, and the
 * quote or fact it yielded. Every node carries its own metadata — which tool served it, what state
 * it reached, how many sources it produced — and every subtree starts collapsed to a count, because
 * a forty-node run is unreadable as a list and perfectly clear as a tree.
 *
 * Deliberately built on nested lists with tree roles rather than a drawn diagram: an arrow key walks
 * it, a screen reader reads it, and it stays honest about what it is — structure, not decoration. */

const STATE_MARK: Record<string, string> = {
  queued: '·',
  running: '·',
  done: '✓',
  empty: '–',
  'needs-key': '$',
  failed: '!',
};

const STATE_LABEL: Record<string, string> = {
  queued: 'Waiting',
  running: 'Working',
  done: 'Found',
  empty: 'Nothing found',
  'needs-key': 'Needs a key',
  failed: 'Failed',
};

const DIMENSION_LABEL: Record<string, string> = {
  manual: 'Manual',
  specs: 'Specs',
  connections: 'Connections',
  sources: 'Sources',
  settings: 'Settings',
  compatibility: 'Pairs with',
};

/* How many children a node shows before it summarises the rest. */
const CHILDREN_SHOWN = 8;
/* How much of a quote a leaf shows. */
const QUOTE_CHARS = 240;

interface RunTreeProps {
  steps: ResearchStepState[];
  plan: ResearchPlan | null;
  running: boolean;
  summary?: string | null;
}

const RunTree: React.FC<RunTreeProps> = ({ steps, plan, running, summary }) => {
  /* Everything starts collapsed: the counts are the first thing worth reading. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);

  /* A step that just found something opens itself once, so work in progress is visible without
     asking — but only once, so a tree somebody has folded stays folded. */
  const [announced, setAnnounced] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!running) return;
    const fresh = steps.filter((step) => step.state === 'done' && step.evidence.length > 0 && !announced.has(step.step_id));
    if (fresh.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const step of fresh) next.add(step.step_id);
      return next;
    });
    setAnnounced((current) => {
      const next = new Set(current);
      for (const step of fresh) next.add(step.step_id);
      return next;
    });
  }, [steps, running, announced]);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* Flattened order of what is on screen, which is what the arrow keys walk. */
  const visible = useMemo(() => {
    const ids: string[] = [];
    for (const step of steps) {
      ids.push(step.step_id);
      if (expanded.has(step.step_id)) {
        step.evidence.slice(0, CHILDREN_SHOWN).forEach((_, index) => ids.push(`${step.step_id}::${index}`));
      }
    }
    return ids;
  }, [steps, expanded]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (visible.length === 0) return;
    const index = focused ? visible.indexOf(focused) : -1;
    const move = (to: number) => {
      const next = visible[Math.max(0, Math.min(visible.length - 1, to))];
      setFocused(next);
      const node = document.getElementById(`tree-${next}`);
      node?.focus();
    };
    if (event.key === 'ArrowDown') { event.preventDefault(); move(index + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(index - 1); }
    else if (event.key === 'ArrowRight' && focused && !focused.includes('::')) { event.preventDefault(); setExpanded((c) => new Set(c).add(focused)); }
    else if (event.key === 'ArrowLeft' && focused) {
      event.preventDefault();
      if (focused.includes('::')) move(visible.indexOf(focused.split('::')[0]));
      else setExpanded((c) => { const n = new Set(c); n.delete(focused); return n; });
    } else if ((event.key === 'Enter' || event.key === ' ') && focused) {
      event.preventDefault();
      if (!focused.includes('::')) toggle(focused);
      else document.querySelector<HTMLAnchorElement>(`#tree-${focused} a`)?.click();
    }
  };

  return (
    <ul className="run-tree" role="tree" aria-label="Research run" onKeyDown={onKeyDown}>
      <li className="tree-node tree-root" role="treeitem" aria-expanded={true} aria-selected={false}>
        <div className="tree-row tree-row-root">
          <span className="tree-mark" aria-hidden="true">{running ? '◍' : '■'}</span>
          <span className="tree-label">{running ? 'Researching…' : 'Research run'}</span>
          <span className="tree-meta">{summary ?? `${steps.filter((s) => s.state === 'done').length} of ${steps.length} answered`}</span>
        </div>

        <ul role="group" className="tree-children">
          {steps.map((step) => {
            const open = expanded.has(step.step_id);
            const count = step.evidence.length;
            const shown = step.evidence.slice(0, CHILDREN_SHOWN);
            const question = plan?.steps.find((item) => item.id === step.step_id)?.question;
            return (
              <li key={step.step_id} className="tree-node" role="treeitem" aria-expanded={count > 0 ? open : undefined}>
                <div
                  className={`tree-row step-${step.state}${focused === step.step_id ? ' tree-focused' : ''}`}
                  id={`tree-${step.step_id}`}
                  tabIndex={focused === step.step_id ? 0 : -1}
                  onClick={() => { setFocused(step.step_id); if (count > 0) toggle(step.step_id); }}
                  onFocus={() => setFocused(step.step_id)}
                >
                  <span className="tree-mark" aria-hidden="true" title={STATE_LABEL[step.state]}>{STATE_MARK[step.state] ?? '·'}</span>
                  <span className="tree-label">{step.title}</span>
                  <span className="tree-tags">
                    <span className="tag">{DIMENSION_LABEL[step.dimension] ?? step.dimension}</span>
                    <span className="tag">{step.tool}</span>
                  </span>
                  <span className="tree-meta">
                    {count > 0
                      ? <>{open ? '▾' : '▸'} {count} source{count === 1 ? '' : 's'}</>
                      : STATE_LABEL[step.state]}
                  </span>
                </div>

                {!open && (
                  /* The question is what the branch means; the detail is what came of asking it. */
                  <p className="tree-note">
                    {question && <span className="tree-question">{question}</span>}
                    {(step.detail || step.error) && (
                      <> {step.detail}{step.error ? ` (${step.error})` : ''}</>
                    )}
                  </p>
                )}

                {open && (
                  <ul role="group" className="tree-children">
                    {shown.map((item, index) => (
                      <li key={`${step.step_id}-${index}`} className="tree-node" role="treeitem" aria-selected={false}>
                        <div
                          className={`tree-row tree-row-source${focused === `${step.step_id}::${index}` ? ' tree-focused' : ''}`}
                          id={`tree-${step.step_id}::${index}`}
                          tabIndex={-1}
                          onClick={() => setFocused(`${step.step_id}::${index}`)}
                          onFocus={() => setFocused(`${step.step_id}::${index}`)}
                        >
                          <span className="tree-mark" aria-hidden="true">◦</span>
                          <span className="tree-label">
                            {item.url
                              ? <a href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>
                              : (item.title || 'Your catalog')}
                          </span>
                          {item.provider && <span className="tag">{item.provider}</span>}
                        </div>
                        {item.snippet && <p className="tree-quote">{item.snippet.slice(0, QUOTE_CHARS)}</p>}
                      </li>
                    ))}
                    {count > CHILDREN_SHOWN && (
                      <li className="tree-node" role="treeitem" aria-selected={false}>
                        <div className="tree-row tree-row-more"><span className="tree-meta">+{count - CHILDREN_SHOWN} more sources</span></div>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </li>
    </ul>
  );
};

export default RunTree;
