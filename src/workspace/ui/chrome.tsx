import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { AppNav } from '../../app/AppNav';
import { Icon } from '../../ui/Icon';
import type { WorkspaceInfo } from '../api';

/** The workspace server's data folder, for every workspace page. */
export const WorkspaceInfoContext = createContext<WorkspaceInfo | null>(null);

export function useWorkspaceInfo(): WorkspaceInfo {
  const info = useContext(WorkspaceInfoContext);
  if (!info) throw new Error('Workspace pages need the workspace server.');
  return info;
}

/** A client's folder on disk, as File Explorer (or Finder) shows it. */
export function clientFolder(info: WorkspaceInfo, companyId: string): string {
  const sep = info.folder.includes('\\') ? '\\' : '/';
  return [info.folder.replace(/[\\/]+$/, ''), 'companies', companyId].join(sep);
}

/**
 * An id, a folder or a file name, in the monospace face used for the data
 * folder. In Inter, "4x1" reads as "4×1", and an id must be typed exactly to
 * find it in File Explorer.
 */
export function Id({ children }: { children: ReactNode }) {
  return <code className="ws-id">{children}</code>;
}

/** The mark and name, as in the editor's top bar. */
export function Brand() {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="5" width="15" height="15" rx="3" fill="none" stroke="#2F7BFF" strokeWidth="2.6" />
        <circle cx="21.5" cy="21.5" r="6" fill="#FFA05C" />
      </svg>
      StyleCode
    </div>
  );
}

/**
 * The top bar of every workspace page: brand, navigation, and the page's own
 * controls on the right. Below it, while the data folder is in a cloud-synced
 * folder, the warning stays (ADR-0009).
 */
export function WorkspaceHeader({ children }: { children?: ReactNode }) {
  const info = useWorkspaceInfo();
  return (
    <>
      <header className="topbar ws-top">
        <Brand />
        <AppNav current="workspace" workspaceHref="#/" />
        <div className="topbar-spacer" />
        {children}
        <a className="icon-button" href="#/settings" aria-label="Settings" data-tip="Settings" data-tip-side="left">
          <Icon name="sliders" size={15} />
        </a>
      </header>
      {info.cloudService && (
        <div className="ws-warning" role="note">
          <Icon name="warning" size={14} /> Your data folder is inside {info.cloudService}, so client data is copied to{' '}
          {info.cloudService}’s servers. <a href="#/settings">What to do</a>
        </div>
      )}
    </>
  );
}

export interface Crumb {
  label: string;
  /** Where it leads; the last crumb is the page itself and has none. */
  href?: string;
}

/** Clients › Company › Engagement › Session. */
export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="ws-crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={i}>
            {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A page's main area. Focus moves to its heading when the page opens, so
 * keyboard and screen-reader users start at the top of the new page. Pages
 * at the top level (the clients list, settings) have no breadcrumb: a single
 * crumb would only repeat the heading.
 */
export function Page({
  title,
  crumbs,
  lede,
  actions,
  notices,
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  lede?: ReactNode;
  /** Buttons beside the title. */
  actions?: ReactNode;
  /** Banners that belong under the title: read-only, a failed save. */
  notices?: ReactNode;
  children?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), [title]);
  return (
    <main className="ws-main">
      {crumbs && crumbs.length > 1 && <Breadcrumb crumbs={crumbs} />}
      <div className="ws-heading">
        <div className="ws-heading-text">
          <h1 className="ws-title" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          {lede && <p className="ws-lede">{lede}</p>}
        </div>
        {actions && <div className="ws-heading-actions">{actions}</div>}
      </div>
      {notices}
      {children}
    </main>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

/** A calendar date such as "2026-11-04", as the consultant reads dates. */
export function formatDay(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(time) ? date : dayFormat.format(time);
}

export function formatWhen(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : dateFormat.format(time);
}

/** "1 session", "2 sessions". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
