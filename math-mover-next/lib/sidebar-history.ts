interface HistorySummary { title: string; created_at: string }

function calendarDay(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function groupSidebarHistory<T extends HistorySummary>(records: T[], query = '', now = new Date()) {
  const groups: { label: string; items: T[] }[] = [
    { label: '今天', items: [] }, { label: '昨天', items: [] }, { label: '更早', items: [] },
  ];
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase();
  const today = calendarDay(now);
  const filtered = records.filter(record => record.title.normalize('NFKC').toLocaleLowerCase().includes(needle));
  const timestamp = (record: T) => { const time = Date.parse(record.created_at); return Number.isFinite(time) ? time : -Infinity; };
  for (const record of [...filtered].sort((a, b) => timestamp(b) - timestamp(a))) {
    const day = calendarDay(new Date(record.created_at));
    const group = day === today ? 0 : day === today - 86_400_000 ? 1 : 2;
    groups[group].items.push(record);
  }
  return groups.filter(group => group.items.length > 0);
}
