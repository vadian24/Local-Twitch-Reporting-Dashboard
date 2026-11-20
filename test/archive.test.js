'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReport, reportSection } = require('../src/archive');

const sections = ['subscriptions', 'cheers', 'gifts', 'uniqueUsers', 'raids', 'streaks', 'diagnostics'];
const options = { channel: ' @example ', mode: 'week', weekStart: '2026-10-29', sections };
const now = new Date(2026, 10, 2, 12);
const message = (displayName, text) => ({ displayName, text, timestamp: '2026-10-29T12:30:01Z' });

test('preserves extension counts, ordering and export format for a partial week across months', async () => {
  const dates = [];
  const progress = [];
  const responses = [
    Response.json({ messages: [
      message('Alice', 'subscribed with Prime'),
      message('ALICE', 'Cheer100 Cheer500'),
      message('bob', 'Cheer10'),
      message('bot', '**Alice** is gifting 3 Tier 1 Subs to the community!'),
      message('bot', '**Alice** gifted a Tier 1 sub to Bob!'),
      message('bot', '20 raiders from Delta have joined!'),
      message('bot', 'Gamma watched 10 consecutive streams and sparked a watch streak!'),
      message('bot', 'Echo watched 30 consecutive streams and sparked a watch streak!')
    ] }),
    new Response(null, { status: 404 }),
    Response.json({ messages: [
      message('bot', 'alice is gifting 2 Tier 2 Subs to the community!'),
      message('bot', '5 raiders from delta have joined!'),
      message('bot', 'Gamma watched 8 consecutive streams and sparked a watch streak!')
    ] }),
    Response.json({ unexpected: [] }),
    new Response(null, { status: 403 })
  ];
  const report = await generateReport(options, {
    now, sleep: async () => {}, onProgress: event => progress.push(event),
    request: async url => {
      dates.push(url);
      return responses.shift();
    }
  });
  assert.deepEqual(dates, ['10/29', '10/30', '10/31', '11/01', '11/02']
    .map(day => 'https://logs.zonian.dev/channel/example/2026/' + day + '?jsonBasic=1'));
  assert.equal(report.filename, 'example-week-2026-10-29-to-2026-11-02-partial-report');
  assert.deepEqual(report.data.subscriptions.map(item => [item.user, item.tier]), [['Alice', 'Prime']]);
  assert.equal(report.data.totalBits, 110);
  assert.equal(report.data.totalGifts, 5);
  assert.equal(report.data.giftAnnouncements, 2);
  assert.deepEqual(report.data.uniqueUsers, [
    { user: 'Alice', activity: 'Sub, Cheer, Gifted Sub' }, { user: 'bob', activity: 'Cheer' }
  ]);
  assert.deepEqual(report.data.raids, [{ user: 'Delta' }]);
  assert.deepEqual(report.data.streaks, [{ user: 'Echo', count: 30 }, { user: 'Gamma', count: 10 }]);
  assert.deepEqual(report.diagnostics.noLogDays, ['2026-10-30']);
  assert.deepEqual(report.diagnostics.failedDays.map(item => item.status), [200, 403]);
  assert.deepEqual(progress.at(-1), { completed: 5, total: 5 });
  assert.match(report.txt, /# NO LOGS FOR THESE DATES\n2026-10-30/);
  assert.match(report.txt, /# UNIQUE USERS[\s\S]+# RAIDS[\s\S]+# WATCH STREAKS/);
  assert.match(report.csv, /^\ufeff.+\r\n/);
  assert.match(report.csv, /"Alice","Sub, Cheer, Gifted Sub"/);
});

test('retries temporary errors, honors Retry-After and exports selected sections only', async () => {
  const waits = [];
  let calls = 0;
  const report = await generateReport({ ...options, weekStart: '2026-11-02', sections: ['cheers'] }, {
    now,
    sleep: async wait => waits.push(wait),
    request: async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '4' } });
      if (calls === 2) return new Response('invalid JSON');
      return Response.json({ messages: [] });
    }
  });
  assert.deepEqual(waits, [4000, 6000]);
  assert.deepEqual(report.sections, ['cheers']);
  assert.match(report.txt, /# CHEERS - WEEK TOTALS/);
  assert.doesNotMatch(report.txt, /SUBSCRIPTIONS|DOWNLOAD DIAGNOSTICS/);
  assert.doesNotMatch(report.csv, /GIFTED SUBS|DOWNLOAD DIAGNOSTICS/);
});

test('uses the full leap-year month and rejects invalid future periods', async () => {
  const report = await generateReport({ ...options, mode: 'month', year: '2024', month: '2' }, {
    now, sleep: async () => {}, request: async () => new Response(null, { status: 404 })
  });
  assert.equal(report.diagnostics.daysChecked, 29);
  assert.equal(report.filename, 'example-2024-02-report');
  await assert.rejects(generateReport({ ...options, weekStart: '2026-11-03' }, { now }), /has not started/);
  await assert.rejects(generateReport({ ...options, sections: [] }, { now }), /at least one/);
  await assert.rejects(generateReport({ ...options, channel: 'bad/name' }, { now }), /valid Twitch/);
});

test('cancels a report while waiting for the next request', async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(generateReport(options, {
    now, signal: controller.signal,
    request: async () => {
      requests++;
      return new Response(null, { status: 404 });
    },
    sleep: async (_wait, _value, { signal }) => {
      controller.abort();
      signal.throwIfAborted();
    }
  }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('requests exactly one day and exports a single selected section', async () => {
  const urls = [];
  const report = await generateReport({
    ...options, mode: 'day', singleDay: '2026-10-29', sections: ['cheers', 'subscriptions']
  }, {
    now,
    request: async url => {
      urls.push(url);
      return Response.json({ messages: [message('Jane', 'Cheer100')] });
    }
  });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /2026\/10\/29\?jsonBasic=1$/);
  assert.equal(report.diagnostics.daysChecked, 1);
  assert.equal(report.filename, 'example-2026-10-29-report');
  const section = reportSection(report, 'csv', 'cheers');
  assert.equal(section.filename, 'example-2026-10-29-report-cheers');
  assert.match(section.text, /CHEERS - DAILY TOTALS/);
  assert.doesNotMatch(section.text, /SUBSCRIPTIONS/);
  assert.throws(() => reportSection(report, 'txt', 'raids'), /not in the current report/);
  await assert.rejects(generateReport({ ...options, mode: 'day', singleDay: '2026-11-03' }, { now }), /has not started/);
});
