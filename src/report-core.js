/* Monthly and weekly Twitch archive report parser and formatter.
   Pure processing logic for consistent TXT/CSV output. */
const TwitchReportCore = (() => {
  'use strict';

  const twitchName = '[A-Za-z0-9_]{1,25}';
  const giftPattern = new RegExp(`(?:^|\\s)\\*{0,2}(${twitchName})\\*{0,2}\\s+is\\s+gifting\\s+([\\d,]+)\\s+Tier\\s*([123])\\s+Subs?\\s+to\\b`, 'i');
  const raidPattern = new RegExp(`\\b[\\d,]+\\s+raiders?\\s+from\\s+(${twitchName})\\s+ha(?:ve|s)\\s+joined!`, 'i');
  const streakPattern = new RegExp(`(?:^|\\s)\\*{0,2}(${twitchName})\\*{0,2}\\s+watched\\s+([\\d,]+)\\s+consecutive\\s+streams\\s+and\\s+sparked\\s+a\\s+watch\\s+streak!`, 'i');

  const normalize = value => String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim();
  const keyOf = username => username.toLowerCase();
  const alpha = (a, b) => a.user.toLowerCase().localeCompare(b.user.toLowerCase());
  const positiveInteger = raw => {
    const number = Number(raw.replace(/,/g, ''));
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  };

  function createAccumulator() {
    return {
      subscriptions: [],
      cheerTotals: new Map(),
      giftTotals: new Map(),
      raiders: new Map(),
      streaks: new Map(),
      giftAnnouncements: 0
    };
  }

  // Keep the same subscriber/cheerer sender attribution used by the
  // original extension. Gift/raid/streak names come from the notices.
  function senderOf(message, text) {
    const prefix = text.match(/^\*{0,2}([^:*]+):\*{0,2}\s*/);
    return normalize(message.displayName || (prefix ? prefix[1] : ''));
  }

  function processMessage(state, message) {
    if (!message || typeof message !== 'object') return;
    const text = normalize(message.text);
    const timestamp = String(message.timestamp ?? '');
    if (!text || timestamp.length < 10) return;
    const date = timestamp.slice(0, 10);
    const time = timestamp.slice(11, 19);
    const sender = senderOf(message, text);

    // Parse event-name fields from announcement TEXT, not from the bot
    // account that may have relayed the message.
    const gift = text.match(giftPattern);
    if (gift) {
      const count = positiveInteger(gift[2]);
      const tier = Number(gift[3]);
      if (count !== null) {
        const user = gift[1];
        const key = keyOf(user);
        if (!state.giftTotals.has(key)) {
          state.giftTotals.set(key, { user, total: 0, tier1: 0, tier2: 0, tier3: 0, events: 0 });
        }
        const item = state.giftTotals.get(key);
        item.total += count;
        item[`tier${tier}`] += count;
        item.events++;
        state.giftAnnouncements++;
      }
      return;
    }

    const raid = text.match(raidPattern);
    if (raid) {
      const user = raid[1];
      const key = keyOf(user);
      if (!state.raiders.has(key)) state.raiders.set(key, { user });
      return;
    }

    const streak = text.match(streakPattern);
    if (streak) {
      const count = positiveInteger(streak[2]);
      if (count !== null) {
        const user = streak[1];
        const key = keyOf(user);
        const prior = state.streaks.get(key);
        if (!prior || count > prior.count) {
          state.streaks.set(key, { user, count });
        }
      }
      return;
    }

    const isSub = /\bsubscribed at Tier\b/i.test(text) || /\bsubscribed with Prime\b/i.test(text);
    if (isSub) {
      const tierMatch = text.match(/subscribed at (Tier\s+\d+)/i);
      const type = /subscribed with Prime\b/i.test(text) ? 'Prime' : 'Subscription';
      // This matches original behavior, including the displayName fallback.
      state.subscriptions.push({ date, time, user: sender, type,
        tier: type === 'Prime' ? 'Prime' : (tierMatch ? tierMatch[1] : '') });
      return;
    }

    // Retain the original matching behavior: first CheerN token per message.
    const cheer = text.match(/\bCheer\s*(\d+)\b/i);
    if (cheer && sender) {
      const bits = positiveInteger(cheer[1]);
      if (bits !== null) {
        const key = keyOf(sender);
        if (!state.cheerTotals.has(key)) state.cheerTotals.set(key, { user: sender, amount: 0 });
        state.cheerTotals.get(key).amount += bits;
      }
    }
  }

  function finalize(state) {
    const subscriptions = [...state.subscriptions].sort((a, b) =>
      (a.date + a.time).localeCompare(b.date + b.time));
    const cheers = [...state.cheerTotals.values()].sort(alpha);
    const gifts = [...state.giftTotals.values()].sort(alpha);
    const raids = [...state.raiders.values()].sort(alpha);
    const streaks = [...state.streaks.values()].sort((a, b) =>
      b.count - a.count || alpha(a, b));

    // Combine subscription, cheer and gifted-sub participants; exclude
    // users who appear solely in raids or watch streak announcements.
    // Keep the first seen display capitalization for a case-insensitive key.
    const unique = new Map();
    function addUnique(user, activity) {
      if (!user) return;
      const key = keyOf(user);
      if (!unique.has(key)) unique.set(key, { user, activities: new Set() });
      unique.get(key).activities.add(activity);
    }
    for (const e of subscriptions) addUnique(e.user, 'Sub');
    for (const e of cheers) addUnique(e.user, 'Cheer');
    for (const e of gifts) addUnique(e.user, 'Gifted Sub');
    const activityOrder = ['Sub', 'Cheer', 'Gifted Sub'];
    const uniqueUsers = [...unique.values()].sort(alpha).map(entry => ({
      user: entry.user,
      activity: activityOrder.filter(name => entry.activities.has(name)).join(', ')
    }));

    return {
      subscriptions, cheers, gifts, raids, streaks, uniqueUsers,
      giftAnnouncements: state.giftAnnouncements,
      totalGifts: gifts.reduce((sum, g) => sum + g.total, 0),
      totalBits: cheers.reduce((sum, c) => sum + c.amount, 0)
    };
  }

  const sectionIds = [
    'subscriptions', 'cheers', 'gifts', 'raids',
    'streaks', 'uniqueUsers', 'diagnostics'
  ];

  function selectedSet(selection) {
    // Existing callers without the new argument still receive the full report.
    if (selection === undefined || selection === null) return new Set(sectionIds);
    return new Set([...selection].filter(id => sectionIds.includes(id)));
  }

  function reportPeriod(year, month, period) {
    const monthLabel = new Date(year, Number(month) - 1, 1)
      .toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return { label: period?.label || monthLabel,
      totals: period?.mode === 'week' ? 'WEEK TOTALS' : 'MONTHLY TOTALS' };
  }

  function textReport(channel, year, month, data, diagnostics, selection, period) {
    const selected = selectedSet(selection);
    const periodInfo = reportPeriod(year, month, period);
    const lines = [`# ${channel} - ${periodInfo.label} Report`];

    if (selected.has('subscriptions')) {
      lines.push('', '# SUBSCRIPTIONS', '# DATE | TIME | USER | TYPE | TIER', '');
      for (const e of data.subscriptions) lines.push(`${e.date} | ${e.time} | ${e.user} | ${e.type} | ${e.tier}`);
    }
    if (selected.has('cheers')) {
      lines.push('', `# CHEERS - ${periodInfo.totals}`, '# USER | TOTAL BITS', '');
      for (const e of data.cheers) lines.push(`${e.user} | ${e.amount} bits`);
    }
    if (selected.has('gifts')) {
      lines.push('', `# GIFTED SUBS - ${periodInfo.totals}`, '# NAME | TOTAL SUBS GIFTED', '');
      for (const e of data.gifts) lines.push(`${e.user} | ${e.total}`);
      lines.push('', `# Total Gifted Subs: ${data.totalGifts}`, `# Unique Gifters: ${data.gifts.length}`, `# Gift Announcements: ${data.giftAnnouncements}`);
    }
    if (selected.has('uniqueUsers')) {
      lines.push('', '# UNIQUE USERS - SUBS, CHEERS AND GIFTED SUBS', '# USER | ACTIVITY', `# Total: ${data.uniqueUsers.length}`, '');
      for (const e of data.uniqueUsers) lines.push(`${e.user} | ${e.activity}`);
    }
    if (selected.has('raids')) {
      lines.push('', '# RAIDS', '# RAIDING STREAMER', '');
      for (const e of data.raids) lines.push(e.user);
    }
    if (selected.has('streaks')) {
      lines.push('', '# WATCH STREAKS - HIGHEST OBSERVED PER USER', '# USER | CONSECUTIVE STREAMS', '');
      for (const e of data.streaks) lines.push(`${e.user} | ${e.count}`);
    }
    if (selected.has('diagnostics')) {
      lines.push('', '# DOWNLOAD DIAGNOSTICS',
        `# Days checked: ${diagnostics.daysChecked}`,
        `# Days with archived logs: ${diagnostics.successfulDays.length}`,
        `# Dates with no archived logs: ${diagnostics.noLogDays.length}`,
        `# Other request failures: ${diagnostics.failedDays.length}`);
      if (diagnostics.noLogDays.length) lines.push('', '# NO LOGS FOR THESE DATES', ...diagnostics.noLogDays);
      if (diagnostics.failedDays.length) {
        lines.push('', '# OTHER REQUEST FAILURES - CHECK THESE');
        for (const e of diagnostics.failedDays) lines.push(`${e.day} | HTTP ${e.status || 'N/A'} | ${e.reason}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  // Excel-friendly CSV with just the requested sections. CSV cannot contain
  // separate worksheets: selected sections appear on one sheet, separated by rows.
  // Prefix formula-like strings to protect against spreadsheet formula injection.
  function csvReport(channel, year, month, data, diagnostics, selection, period) {
    const selected = selectedSet(selection);
    const rows = [];
    const section = (heading, columns, records) => {
      rows.push([], [heading], columns, ...records, []);
    };
    const periodInfo = reportPeriod(year, month, period);
    rows.push([`${channel} - ${periodInfo.label} Report`]);

    if (selected.has('subscriptions')) {
      section('SUBSCRIPTIONS', ['Date', 'Time', 'Username', 'Type', 'Tier'],
        data.subscriptions.map(e => [e.date, e.time, e.user, e.type, e.tier]));
    }
    if (selected.has('cheers')) {
      section(`CHEERS - ${periodInfo.totals}`, ['Username', 'Total Bits'],
        data.cheers.map(e => [e.user, e.amount]));
    }
    if (selected.has('gifts')) {
      section(`GIFTED SUBS - ${periodInfo.totals}`, ['Name', 'Total Subs Gifted'],
        data.gifts.map(e => [e.user, e.total]));
      section('GIFTED SUBS SUMMARY', ['Metric', 'Value'], [
        ['Total Gifted Subs', data.totalGifts],
        ['Unique Gifters', data.gifts.length],
        ['Gift Announcements', data.giftAnnouncements]
      ]);
    }
    if (selected.has('uniqueUsers')) {
      section('UNIQUE USERS - SUBS, CHEERS AND GIFTED SUBS', ['Username', 'Activity'],
        data.uniqueUsers.map(e => [e.user, e.activity]));
      section('UNIQUE USERS TOTAL', ['Metric', 'Value'], [
        ['Unique Users (Subs, Cheers and Gifted Subs)', data.uniqueUsers.length]
      ]);
    }
    if (selected.has('raids')) {
      section('RAIDS', ['Raiding Streamer'], data.raids.map(e => [e.user]));
    }
    if (selected.has('streaks')) {
      section('WATCH STREAKS - HIGHEST OBSERVED PER USER', ['Username', 'Consecutive Streams'],
        data.streaks.map(e => [e.user, e.count]));
    }
    if (selected.has('diagnostics')) {
      section('DOWNLOAD DIAGNOSTICS', ['Metric', 'Value'], [
        ['Days Checked', diagnostics.daysChecked],
        ['Days With Archived Logs', diagnostics.successfulDays.length],
        ['Dates With No Archived Logs', diagnostics.noLogDays.length],
        ['Other Request Failures', diagnostics.failedDays.length]
      ]);
      if (diagnostics.noLogDays.length) section('NO LOGS FOR THESE DATES', ['Date'], diagnostics.noLogDays.map(x => [x]));
      if (diagnostics.failedDays.length) section('OTHER REQUEST FAILURES', ['Date', 'HTTP', 'Reason'],
        diagnostics.failedDays.map(e => [e.day, e.status || 'N/A', e.reason]));
    }

    const csvCell = value => {
      let content = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(content)) content = `'${content}`;
      return `"${content.replace(/"/g, '""')}"`;
    };
    return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  return { createAccumulator, processMessage, finalize, textReport, csvReport };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TwitchReportCore;
