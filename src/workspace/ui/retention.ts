import { formatDay } from './chrome';
import type { RecordingRetention } from '../model/recordings';

/** A moment's date as the consultant reads dates, in the session's time zone: "12 Dec 2026". */
function dayIn(at: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(at));
  }
}

/**
 * How long a recording is kept, or why its time is up, in a line (decisions
 * 22 and 23): "Kept until 12 Dec 2026", "Past its time: the client withdrew
 * consent". Dates in the session's time zone.
 */
export function retentionText(r: RecordingRetention, timeZone: string): string {
  if (r.due === 'days' && r.kept.kind === 'date') return `Past its time: it was to be kept until ${dayIn(r.kept.at, timeZone)}`;
  if (r.due === 'engagement-ended' && r.kept.kind === 'engagement-ended')
    return `Past its time: the engagement ended on ${formatDay(r.kept.endedOn)}`;
  if (r.due === 'withdrawn') return 'Past its time: the client withdrew consent';
  if (r.due === 'not-agreed') return 'Past its time: recording is no longer agreed for this session';
  if (r.due === 'transcribed') return 'Past its time: it was transcribed, and the client was told it would then be deleted';
  if (r.waiting === 'transcription')
    return 'Waiting for its transcript: the client was told it’s deleted after transcription, a day ago or more';
  if (r.waiting === 'adding') return 'Its transcript is ready: adding it deletes the recording, as the client was told';
  switch (r.kept.kind) {
    case 'date':
      return `Kept until ${dayIn(r.kept.at, timeZone)}`;
    case 'engagement-ends':
      return 'Kept until the engagement ends';
    case 'transcription':
      return 'Deleted when its transcript is added, as the client was told';
    default:
      return 'Past its time';
  }
}
