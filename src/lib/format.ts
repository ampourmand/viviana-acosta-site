/** Literary status labels; never bureaucratic, never placeholder. */
const statusLabels: Record<string, string> = {
  querying: 'Out on query',
  'on-submission': 'On submission',
  'in-progress': 'In progress',
  drafting: 'Drafting',
  complete: 'Complete',
  published: 'Published',
  tbd: 'In the notebook',
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? statusLabels.tbd!;
}

const categoryLabels: Record<string, string> = {
  'picture-book': 'Picture Book',
  'short-fiction': 'Short Fiction',
  'ya-novel': 'Young Adult Novel',
  poetry: 'Poetry',
  other: 'Other Work',
};

export function categoryLabel(category: string): string {
  return categoryLabels[category] ?? 'Work';
}

export interface MetaEntry {
  label: string;
  value: string;
}

/** Render only what exists; a title-only work still composes cleanly. */
export function metaEntries(work: {
  status?: string;
  wordCount?: number | null;
  genre?: string | null;
  audience?: string | null;
  year?: number | null;
  recognition?: string | null;
}): MetaEntry[] {
  const entries: MetaEntry[] = [];
  if (work.status && work.status !== 'tbd') {
    entries.push({ label: 'Status', value: statusLabel(work.status) });
  }
  if (work.wordCount != null) {
    entries.push({ label: 'Length', value: `${work.wordCount.toLocaleString('en-US')} words` });
  }
  if (work.genre) entries.push({ label: 'Genre', value: work.genre });
  if (work.audience) entries.push({ label: 'Audience', value: work.audience });
  if (work.year != null) entries.push({ label: 'Year', value: String(work.year) });
  if (work.recognition) entries.push({ label: 'Recognition', value: work.recognition });
  return entries;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function readingTime(text: string): string {
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 220));
  return `${minutes} min read`;
}
