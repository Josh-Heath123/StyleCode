import { useEngagementRecord } from '../app/record';
import type { Editor } from '../editor/editor';
import { unlinkFindingOps } from '../model/commands';
import { propAppliesTo } from '../model/properties';
import type { DesignNode } from '../model/types';
import { displayName } from './LayersPanel';

/**
 * A selected layer's links to the record's findings, in an engagement's
 * design (Workspace Phase 4, decision 11): each with its statement and
 * status, Unlink, and Open in the record. A link to a finding no longer in
 * the record says so, with Remove link. The standalone editor has no record,
 * so this shows nothing there.
 */
export function FindingsSection({ editor, node }: { editor: Editor; node: DesignNode }) {
  const record = useEngagementRecord();
  if (!record || !propAppliesTo('findings', node.type)) return null;
  const name = displayName(node);

  const unlink = (findingId: string, statement: string | null) => {
    const tx = editor.apply(unlinkFindingOps(editor.getState().doc, [node.id], findingId), {
      label: statement ? 'Unlink a finding' : 'Remove a link',
    });
    if (tx)
      editor.notify(
        statement
          ? `Unlinked “${name}” from “${statement}”.`
          : `Removed a link from “${name}” to a finding no longer in the record.`,
      );
  };

  return (
    <section className="section" aria-labelledby="layer-findings-title">
      <div className="section-head" id="layer-findings-title">
        Findings
      </div>
      {node.findings.length === 0 ? (
        <p className="layer-finding-meta">Not linked to a finding. Link one from the record beside the layers.</p>
      ) : (
        <ul className="layer-findings" aria-labelledby="layer-findings-title">
          {node.findings.map((id) => {
            const f = record.describe(id);
            if (!f)
              return (
                <li key={id} className="layer-finding is-gone">
                  <p className="layer-finding-statement">No longer in the record</p>
                  <p className="layer-finding-meta">
                    The finding this layer was linked to is no longer in this engagement’s record.
                  </p>
                  <div className="layer-finding-actions">
                    <button type="button" className="link-button" onClick={() => unlink(id, null)}>
                      Remove link
                    </button>
                  </div>
                </li>
              );
            return (
              <li key={id} className="layer-finding">
                <p className="layer-finding-statement">{f.statement}</p>
                <p className="layer-finding-meta">
                  {f.kind} · <span className="visually-hidden">Status: </span>
                  {f.status}
                </p>
                <div className="layer-finding-actions">
                  <a className="link-button" href={f.href} aria-label={`Open in the record: “${f.statement}”`}>
                    Open in the record
                  </a>
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Unlink: “${f.statement}”`}
                    onClick={() => unlink(id, f.statement)}
                  >
                    Unlink
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
