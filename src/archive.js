'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const Core = require('./report-core');
const Dates = require('./date-range');

const SECTION_IDS = ['subscriptions', 'cheers', 'gifts', 'uniqueUsers', 'raids', 'streaks', 'diagnostics'];
const ROOT = 'https://logs.zonian.dev';
const PACE_MS = 2000;

function retryDelay(header, fallback) {
  if (!header) return fallback;
  const seconds = Number(header);
  const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(wait) ? Math.max(PACE_MS, wait) : fallback;
}

async function fetchDay(channel, day, { request, sleep, signal, update }) {
  const url = ROOT + '/channel/' + encodeURIComponent(channel) + '/' + day.replaceAll('-', '/') + '?jsonBasic=1';
  let failure;
  for (let attempt = 0; attempt <= 5; attempt++) {
    signal?.throwIfAborted();
    let response;
    try {
      const timeout = AbortSignal.timeout(30_000);
      response = await request(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'error'
      });
      if (response.ok) {
        const payload = await response.json();
        if (!Array.isArray(payload?.messages)) {
          return { status: response.status, reason: 'Unexpected archive JSON format' };
        }
        return { messages: payload.messages };
      }
      await response.body?.cancel();
      if (response.status === 404) return { missing: true };
      if (response.status !== 429 && response.status < 500) {
        return { status: response.status, reason: 'Non-retryable HTTP error' };
      }
      failure = { status: response.status, reason: 'Retries exhausted' };
    } catch (error) {
      signal?.throwIfAborted();
      failure = response
        ? { status: response.status, reason: 'Could not read archive JSON' }
        : { reason: error.cause?.code === 'ENOTFOUND' ? 'Archive host could not be resolved' : 'Archive request failed' };
    }
    if (attempt === 5) break;
    const wait = retryDelay(response?.headers.get('Retry-After'), 3000 * 2 ** attempt);
    update(day + ' · ' + (failure.status ? 'HTTP ' + failure.status : failure.reason)
      + ' · Retrying in ' + Math.ceil(wait / 1000) + 's');
    await sleep(wait, undefined, { signal });
  }
  return failure;
}

async function generateReport(options, {
  request = fetch, sleep = delay, signal, onProgress = () => {}, now
} = {}) {
  const channel = String(options.channel ?? '').trim().replace(/^[#@]/, '');
  if (!/^[A-Za-z0-9_]{1,25}$/.test(channel)) {
    throw new Error('Enter a valid Twitch channel name.');
  }
  const sections = SECTION_IDS.filter(id => Array.isArray(options.sections) && options.sections.includes(id));
  if (!sections.length) throw new Error('Choose at least one report section.');
  const period = Dates.getDates({ ...options, now });
  const state = Core.createAccumulator();
  const diagnostics = { daysChecked: period.days.length, successfulDays: [], noLogDays: [], failedDays: [] };
  for (const [index, { dateLabel }] of period.days.entries()) {
    const update = message => onProgress({ message, completed: index, total: diagnostics.daysChecked });
    update('Fetching ' + dateLabel + ' · Day ' + (index + 1) + ' of ' + diagnostics.daysChecked);
    const result = await fetchDay(channel, dateLabel, { request, sleep, signal, update });
    if (result.missing) {
      diagnostics.noLogDays.push(dateLabel);
    } else if (result.messages) {
      diagnostics.successfulDays.push(dateLabel);
      for (const message of result.messages) Core.processMessage(state, message);
    } else {
      diagnostics.failedDays.push({ day: dateLabel, status: result.status, reason: result.reason });
    }
    onProgress({ completed: index + 1, total: diagnostics.daysChecked });
    if (index + 1 < period.days.length) await sleep(PACE_MS, undefined, { signal });
  }
  signal?.throwIfAborted();
  const data = Core.finalize(state);
  const reportArgs = [channel, period.days[0].year, period.days[0].month, data, diagnostics, sections, period];
  return {
    channel, period, sections, data, diagnostics,
    filename: channel + '-' + period.filenamePart + '-report',
    txt: Core.textReport(...reportArgs),
    csv: Core.csvReport(...reportArgs)
  };
}

function reportSection(report, format, section) {
  if (!report.sections.includes(section)) throw new Error('This section is not in the current report.');
  const { channel, period, data, diagnostics } = report;
  const [{ year, month }] = period.days;
  const formatter = format === 'csv' ? Core.csvReport : Core.textReport;
  return {
    filename: report.filename + '-' + (section === 'uniqueUsers' ? 'unique-users' : section),
    text: formatter(channel, year, month, data, diagnostics, [section], period)
  };
}

module.exports = { generateReport, reportSection };
