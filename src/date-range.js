/* Date selection for full-month and seven-consecutive-day reports.
   UTC calculations avoid timezone/DST shifts when crossing month boundaries. */
const TwitchReportDates = (() => {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const asISO = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const isoDay = iso => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('Choose a valid starting date.');
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (asISO(dt) !== iso || y < 2000 || y > 2100) throw new Error('Choose a date between 2000 and 2100.');
    return dt;
  };
  const addDays = (date, amount) => new Date(date.getTime() + amount * 86400000);
  const todayISO = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const defaultWeekStart = (now = new Date()) => {
    // Default to the most recent complete Monday-Sunday week.
    const localToday = isoDay(todayISO(now));
    const daysSinceMonday = (localToday.getUTCDay() + 6) % 7;
    return asISO(addDays(localToday, -daysSinceMonday - 7));
  };
  const formatDay = date => date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
  const getDates = ({mode, year, month, weekStart, now = new Date()}) => {
    const cutoff = isoDay(todayISO(now));
    let start, requestedEnd, label, modeName;
    if (mode === 'month') {
      const y = Number(year), m = Number(month);
      if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
        throw new Error('Choose a valid year and month.');
      }
      start = new Date(Date.UTC(y, m - 1, 1));
      requestedEnd = new Date(Date.UTC(y, m, 0));
      label = start.toLocaleDateString('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
      modeName = 'month';
    } else if (mode === 'week') {
      start = isoDay(weekStart);
      requestedEnd = addDays(start, 6);
      label = `${formatDay(start)} – ${formatDay(requestedEnd)}`;
      modeName = 'week';
    } else {
      throw new Error('Choose Full month or One week.');
    }
    if (start.getTime() > cutoff.getTime()) {
      throw new Error('The selected period has not started yet. Choose today or an earlier date.');
    }
    const last = requestedEnd.getTime() > cutoff.getTime() ? cutoff : requestedEnd;
    const days = [];
    for (let dt = start; dt.getTime() <= last.getTime(); dt = addDays(dt, 1)) {
      days.push({
        year: dt.getUTCFullYear(), month: pad(dt.getUTCMonth() + 1),
        day: dt.getUTCDate(), dateLabel: asISO(dt)
      });
    }
    const partial = last.getTime() < requestedEnd.getTime();
    const filenamePart = modeName === 'month'
      ? `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`
      : `week-${asISO(start)}-to-${asISO(last)}${partial ? '-partial' : ''}`;
    return {days, label: label + (partial && modeName === 'week' ? ' (week to date)' : ''),
      mode: modeName, startDate: asISO(start), endDate: asISO(last),
      requestedEndDate: asISO(requestedEnd), partial, filenamePart};
  };
  return {getDates, defaultWeekStart, todayISO};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TwitchReportDates;
