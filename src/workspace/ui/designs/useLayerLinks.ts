import { useEffect, useState } from 'react';
import { parseProject } from '../../../model/serialize';
import type { DesignDocument } from '../../../model/types';
import { readDesignFile } from '../../api';
import { designsOf } from '../../model/designs';
import type { CompanyWorkspace, DesignLink } from '../../model/types';
import { openDesign } from './companyDesign';
import { layersByFinding, type LayerLink } from './designLinks';
import { useDesignEditor } from './editorContext';

/**
 * The layers of an engagement's designs that answer each finding (decision
 * 11), read through the workspace API once per visit, and again when the
 * engagement's designs change. A design open in the editor is read from the
 * editor, so a link just made shows before its autosave lands. A design that
 * can't be read is left out. Null while loading.
 */
export function useLayerLinks(
  companyId: string,
  workspace: CompanyWorkspace,
  engagementId: string,
): Map<string, LayerLink[]> | null {
  const { editor } = useDesignEditor();
  const designs = designsOf(workspace, engagementId);
  const key = designs.map((d) => `${d.id}:${d.documentId}:${d.name}`).join('|');
  const [links, setLinks] = useState<Map<string, LayerLink[]> | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async (link: DesignLink): Promise<DesignDocument | null> => {
      const open = openDesign();
      const doc = editor.committedDoc;
      if (open?.companyId === companyId && open.designId === link.id && doc.id === link.documentId) return doc;
      try {
        const parsed = parseProject((await readDesignFile(companyId, link.documentId)).file);
        return parsed.ok ? parsed.doc : null;
      } catch {
        return null;
      }
    };
    void Promise.all(designs.map(async (link) => ({ link, doc: await read(link) }))).then((read) => {
      if (!alive) return;
      setLinks(
        layersByFinding(
          companyId,
          read.filter((d): d is { link: DesignLink; doc: DesignDocument } => !!d.doc),
        ),
      );
    });
    return () => {
      alive = false;
    };
    // The designs are named by `key`: reading again for every workspace change would fetch every file again.
  }, [companyId, key, editor]);

  return links;
}
