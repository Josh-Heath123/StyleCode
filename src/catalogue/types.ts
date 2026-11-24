import type { CalendarDate } from '../workspace/model/types.ts';
import type { Compliance, Language, Licence, Offering, Offline, Part, Platform, Runtime } from './vocabulary.ts';

/**
 * The technology catalogue (Workspace Phase 5, decisions 4 to 11 and 27): shipped with StyleCode, the same for every
 * client, read-only, and holding no client data. Every fact names its sources and the day they were read. A fact the
 * sources don't give is left out, never guessed (decision 10).
 */

/** A page a fact was read from: the vendor's or project's own (decision 7). */
export interface Source {
  title: string;
  publisher: string;
  /** `https` only. */
  url: string;
}

/** An ISO 3166-1 alpha-2 code, upper case, one of `catalogue/countries.json`'s (decision 27). */
export type CountryCode = string;

/** A technology's id, its file's name: lower case words joined by hyphens. */
export type TechnologyId = string;

export type FactValue =
  | { kind: 'licence'; value: Licence }
  | { kind: 'offering'; value: Offering }
  | { kind: 'languages'; value: Language[] }
  | { kind: 'runtimes'; value: Runtime[] }
  | { kind: 'platforms'; value: Platform[] }
  | { kind: 'offline'; value: Offline }
  | { kind: 'self-hostable'; value: boolean }
  | { kind: 'managed-service'; value: boolean }
  /** Every region or data centre where it stores data, each in its country. */
  | { kind: 'regions'; value: { country: CountryCode; region: string }[] }
  /** Where a business can sign up and use it, as its source says: the countries, or everywhere except some. */
  | { kind: 'available-in'; value: { countries: CountryCode[] } | { everywhereExcept: CountryCode[] } }
  /** The compliance its own trust page claims, from decision 7's list; empty when that page claims none of them. */
  | { kind: 'compliance'; value: Compliance[] }
  | { kind: 'host-runtimes'; value: Runtime[] }
  /** The catalogue's databases the host offers as a managed service. */
  | { kind: 'host-databases'; value: TechnologyId[] }
  /** Languages with an official SDK, and whether a documented HTTPS API can be used from any back end. */
  | { kind: 'sdks'; value: { languages: Language[]; httpsApi: boolean } }
  /** What it can't work without: another technology, or a part filled by anything. */
  | { kind: 'requires'; value: ({ technology: TechnologyId } | { part: Part })[] }
  | { kind: 'support'; value: { latestRelease: { version: string; date: CalendarDate }; endOfSupport?: CalendarDate } };

/** A fact: its kind and value, the sources it was read from (keys into its technology's `sources`), and when. */
export type Fact = FactValue & {
  sources: string[];
  checkedOn: CalendarDate;
  /** One short sentence in StyleCode's own words, where the source limits or qualifies the value. */
  note?: string;
};

export interface Technology {
  id: TechnologyId;
  name: string;
  parts: Part[];
  /** One plain sentence on what it is. */
  about: string;
  sources: Record<string, Source>;
  facts: Fact[];
}

/** A named group of countries, such as the EU (decision 27): data, with its source and date. */
export interface CountryGroup {
  id: string;
  name: string;
  members: CountryCode[];
  sources: Source[];
  checkedOn: CalendarDate;
}

/** The officially assigned ISO 3166-1 alpha-2 codes (decision 27). */
export interface Countries {
  codes: CountryCode[];
  source: Source;
  checkedOn: CalendarDate;
  note?: string;
}

/** `catalogue/CATALOGUE.json`: the version a result records, its date, and the catalogue's own order (decision 18). */
export interface Manifest {
  version: number;
  date: CalendarDate;
  order: TechnologyId[];
}

export interface Catalogue {
  version: number;
  date: CalendarDate;
  /** In the catalogue's own order. */
  technologies: Technology[];
  countries: Countries;
  groups: CountryGroup[];
}
