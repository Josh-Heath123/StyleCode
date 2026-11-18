import { useMemo, useState, useSyncExternalStore } from 'react';
import { displayName } from '../../../panels/LayersPanel';
import { useEditor, useEditorState } from '../../../editor/react';
import { linkFindingOps, unlinkFindingOps } from '../../../model/commands';
import { propAppliesTo } from '../../../model/properties';
import type { DesignDocument } from '../../../model/types';
import { recordGroups } from '../../model/findings';
import { GROUPS, KIND_LABEL, STATUS_LABEL } from '../../model/labels';
import type { Finding } from '../../model/types';
import { routeHref } from '../../routes';
import type { WorkspaceSession } from '../../session';
import { count } from '../chrome';

/**
 * The engagement's record beside its design (Workspace Phase 4, decision 9):
 * its findings in the record's four groups, with statement, kind and status,
 * and a text filter. Read-only: findings are changed on the record page, one
 * link away. From here a finding is linked to the selected layers, or
 * unlinked (decision 11), each an ordinary editor change that undo takes back.
 */
export function RecordPanel({
  client,
  companyId,
  engagementId,
}: {
  client: WorkspaceSession;
  companyId: string;
  engagementId: string;
}) {
  const editor = useEditor();
  const { workspace } = useSyncExternalStore(client.subscribe, client.getState);
  const doc = useEditorState((s) => s.doc);
  const selection = useEditorState((s) => s.selection);
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => recordGroups(workspace, engagementId), [workspace, engagementId]);
  const total = GROUPS.reduce((n, g) => n + groups[g.key].length, 0);
  const q = filter.trim().toLowerCase();
  const matches = (f: Finding) => !q || f.statement.toLowerCase().includes(q) || KIND_LABEL[f.kind].toLowerCase().includes(q);
  const shown = GROUPS.reduce((n, g) => n + groups[g.key].filter(matches).length, 0);
  const layerCounts = useMemo(() => linkedLayerCounts(doc), [doc]);
  // The selected layers that can be linked: not the page, and not notes.
  const linkable = selection.map((id) => doc.nodes[id]).filter((n) => n && propAppliesTo('findings', n.type));
  const recordHref = routeHref({ page: 'record', companyId, engagementId });

  const toggle = (f: Finding, linked: boolean) => {
    const ids = linkable.map((n) => n.id);
    const ops = linked ? unlinkFindingOps(doc, ids, f.id) : linkFindingOps(doc, ids, f.id);
    const tx = editor.apply(ops, { label: linked ? 'Unlink a finding' : 'Link to a finding' });
    if (!tx) return;
    const layers = linkable.length === 1 ? `“${displayName(linkable[0])}”` : `${linkable.length} layers`;
    // The notice is read out, so a screen reader hears the link made or removed.
    editor.notify(linked ? `Unlinked ${layers} from “${f.statement}”.` : `Linked ${layers} to “${f.statement}”.`);
  };

  return (
    <div className="record-panel">
      <div className="record-panel-head">
        <input
          id="record-filter"
          type="search"
          aria-label="Filter the record"
          placeholder="Filter the record…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears the filter first, rather than reaching the canvas's shortcuts.
            if (e.key === 'Escape' && filter) {
              e.stopPropagation();
              setFilter('');
            }
          }}
        />
        <span className="ws-muted" role="status">
          {total === 0 ? '' : shown === total ? count(total, 'finding') : `${shown} of ${count(total, 'finding')}`}
        </span>
        <a className="link-button" href={recordHref}>
          Open the record to change findings
        </a>
      </div>
      <div className="record-panel-body">
        {total === 0 && <p>This engagement’s record has no findings yet.</p>}
        {total > 0 && shown === 0 && <p>No findings match the filter.</p>}
        {GROUPS.map((g) => {
          const items = groups[g.key].filter(matches);
          if (!items.length) return null;
          return (
            <section key={g.key} aria-labelledby={`record-group-${g.key}`}>
              <h3 id={`record-group-${g.key}`}>
                {g.title} ({items.length})
              </h3>
              <ul className="record-findings">
                {items.map((f) => {
                  const onSelected = linkable.length > 0 && linkable.every((n) => n.findings.includes(f.id));
                  const layers = layerCounts.get(f.id) ?? 0;
                  const selected = linkable.length === 1 ? 'layer' : 'layers';
                  const action = onSelected ? `Unlink from the selected ${selected}` : `Link to the selected ${selected}`;
                  return (
                    <li
                      key={f.id}
                      className={`record-finding${onSelected ? ' is-linked' : ''}`}
                      aria-labelledby={`record-finding-${f.id}`}
                    >
                      <p className="record-finding-statement" id={`record-finding-${f.id}`}>
                        {f.statement}
                      </p>
                      <div className="ws-labels">
                        <span className="ws-badge">{KIND_LABEL[f.kind]}</span>
                        <span className="ws-badge is-status" data-status={f.status}>
                          <span className="visually-hidden">Status: </span>
                          {STATUS_LABEL[f.status]}
                        </span>
                        {layers > 0 && <span className="ws-badge is-active">{count(layers, 'layer')} linked</span>}
                      </div>
                      {linkable.length > 0 && (
                        <div className="record-finding-actions">
                          <button
                            type="button"
                            className="button"
                            // The visible words come first, so speech input finds the button by what it says.
                            aria-label={`${action}: “${f.statement}”`}
                            onClick={() => toggle(f, onSelected)}
                          >
                            {action}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** How many layers link to each finding. */
function linkedLayerCounts(doc: DesignDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of Object.values(doc.nodes)) for (const id of node.findings) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
