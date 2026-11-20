'use strict';

const $ = id => document.getElementById(id);
const sections = {
  subscriptions: { label: 'Subscriptions', columns: ['Date', 'Time', 'Username', 'Type', 'Tier'],
    row: item => [item.date, item.time, item.user, item.type, item.tier] },
  cheers: { label: 'Cheers', columns: ['Username', 'Total bits'], row: item => [item.user, item.amount] },
  gifts: { label: 'Gifted subs', columns: ['Username', 'Total gifted'], row: item => [item.user, item.total] },
  uniqueUsers: { label: 'Unique users', columns: ['Username', 'Activity'], row: item => [item.user, item.activity] },
  raids: { label: 'Raids', columns: ['Raiding streamer'], row: item => [item.user] },
  streaks: { label: 'Watch streaks', columns: ['Username', 'Consecutive streams'],
    row: item => [item.user, item.count] },
  diagnostics: { label: 'Archive diagnostics' }
};
const prefsKey = 'local-twitch-report-preferences';
const now = new Date();
const canExport = [$('format'), $('copy'), $('save')];
let currentReport;
let busy = false;
let exporting = false;

function readPreferences() {
  try {
    return JSON.parse(localStorage.getItem(prefsKey)) || {};
  } catch {
    return {};
  }
}

function savePreferences() {
  try {
    localStorage.setItem(prefsKey, JSON.stringify({
      sections: selectedSections(),
      mode: $('mode').value,
      weekStart: $('week-start').value
    }));
  } catch {
    // Settings are optional.
  }
}

function selectedSections() {
  return Array.from($('section-options').querySelectorAll(':checked'), input => input.value);
}

function updatePeriod() {
  const weekly = $('mode').value === 'week';
  $('month-controls').hidden = weekly;
  $('year').disabled = weekly;
  $('week-controls').hidden = !weekly;
  $('week-start').disabled = !weekly;
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function setup() {
  const preferences = readPreferences();
  for (const [id, section] of Object.entries(sections)) {
    const input = element('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = !Array.isArray(preferences.sections) || preferences.sections.includes(id);
    const label = element('label');
    label.append(input, document.createTextNode(section.label));
    $('section-options').append(label);
  }
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' });
  for (let month = 0; month < 12; month++) {
    const option = element('option', monthName.format(new Date(2020, month, 1)));
    option.value = month + 1;
    $('month').append(option);
  }
  $('month').value = now.getMonth() + 1;
  $('year').value = now.getFullYear();
  $('week-start').max = TwitchReportDates.todayISO(now);
  $('week-start').value = preferences.weekStart || TwitchReportDates.defaultWeekStart(now);
  $('mode').value = preferences.mode === 'week' ? 'week' : 'month';
  updatePeriod();

  $('mode').addEventListener('change', updatePeriod);
  $('report-settings').addEventListener('change', savePreferences);
  for (const [id, checked] of [['select-all', true], ['clear-all', false]]) {
    $(id).addEventListener('click', () => {
      for (const input of $('section-options').querySelectorAll('input')) input.checked = checked;
      savePreferences();
    });
  }
}

function status(message) {
  $('status').textContent = message;
}

function table(columns, rows) {
  const headers = element('tr');
  const head = element('thead');
  for (const column of columns) {
    const header = element('th', column);
    header.scope = 'col';
    headers.append(header);
  }
  head.append(headers);
  const body = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    for (const cell of row) tr.append(element('td', cell));
    body.append(tr);
  }
  const node = element('table');
  node.append(head, body);
  const wrapper = element('div', undefined, 'table-wrap');
  wrapper.append(node);
  return wrapper;
}

function render(report) {
  const { data, diagnostics, period, channel } = report;
  $('report-title').textContent = '#' + channel;
  $('report-period').textContent = period.label + (period.partial ? ' · Through ' + period.endDate : '');
  const result = $('results-body');
  result.replaceChildren();
  const metrics = {
    subscriptions: ['Subscriptions', data.subscriptions.length],
    cheers: ['Total bits', data.totalBits],
    gifts: ['Subs gifted', data.totalGifts],
    uniqueUsers: ['Unique users', data.uniqueUsers.length],
    raids: ['Raiding streamers', data.raids.length],
    streaks: ['Longest streak', data.streaks[0]?.count ?? 0],
    diagnostics: ['Days with logs', diagnostics.successfulDays.length + ' / ' + diagnostics.daysChecked]
  };
  const summary = element('dl', undefined, 'metrics');
  for (const id of report.sections) {
    const [label, value] = metrics[id];
    const item = element('div', undefined, 'metric');
    item.append(element('dt', label), element('dd', value.toLocaleString('en-US')));
    summary.append(item);
  }
  result.append(summary);
  for (const [index, id] of report.sections.entries()) {
    const section = sections[id];
    const details = element('details', undefined, 'report-section');
    details.open = index === 0 || (id === 'diagnostics' && diagnostics.failedDays.length > 0);
    details.append(element('summary', section.label));
    if (id === 'diagnostics') {
      const rows = [
        ...diagnostics.noLogDays.map(day => [day, 'No archived logs']),
        ...diagnostics.failedDays.map(item => [item.day, (item.status ? 'HTTP ' + item.status + ' · ' : '') + item.reason])
      ].sort((left, right) => left[0].localeCompare(right[0]));
      details.append(element('p', diagnostics.successfulDays.length + ' with logs · '
        + diagnostics.noLogDays.length + ' without logs · ' + diagnostics.failedDays.length + ' failed'));
      if (rows.length) details.append(table(['Date', 'Archive status'], rows));
    } else {
      const rows = data[id].map(section.row);
      if (id === 'gifts') {
        details.append(element('p', data.gifts.length + ' unique gifters · ' + data.giftAnnouncements + ' gift announcements'));
      }
      details.append(rows.length ? table(section.columns, rows) : element('p', 'No matching activity.', 'section-empty'));
    }
    result.append(details);
  }
}

function updateButtons() {
  $('report-settings').disabled = busy || exporting;
  $('cancel').hidden = !busy;
  for (const control of canExport) control.disabled = busy || exporting || !currentReport;
}

async function generate(event) {
  event.preventDefault();
  if (busy || exporting) return;
  const options = {
    channel: $('channel').value,
    mode: $('mode').value,
    year: $('year').value,
    month: $('month').value,
    weekStart: $('week-start').value,
    sections: selectedSections()
  };
  busy = true;
  updateButtons();
  $('progress').value = 0;
  $('progress').hidden = false;
  status('Starting report…');
  try {
    const report = await window.reports.generate(options);
    if (report.cancelled || report.error) {
      status(report.cancelled ? 'Report generation cancelled.' : report.error);
      return;
    }
    render(report);
    currentReport = report;
    const { diagnostics } = report;
    status('Report ready. ' + diagnostics.successfulDays.length + ' of ' + diagnostics.daysChecked + ' days had logs.'
      + (diagnostics.failedDays.length ? ' Some requests failed. Results may be incomplete.' : ''));
  } catch (error) {
    status('Could not generate report. ' + error.message);
  } finally {
    busy = false;
    $('cancel').disabled = false;
    $('progress').hidden = true;
    updateButtons();
  }
}

async function exportReport(action) {
  if (busy || exporting || !currentReport) return;
  const format = $('format').value;
  exporting = true;
  updateButtons();
  try {
    if (action === 'save') {
      const saved = await window.reports.save(format);
      if (saved) status(format.toUpperCase() + ' report saved.');
    } else {
      await window.reports.copy(format);
      status(format.toUpperCase() + ' report copied to clipboard.');
    }
  } catch (error) {
    status('Could not ' + action + ' report. ' + error.message);
  } finally {
    exporting = false;
    updateButtons();
  }
}

setup();
window.reports.onProgress(({ message, completed, total }) => {
  if (!busy) return;
  $('progress').max = total;
  $('progress').value = completed;
  if (message && !$('cancel').disabled) status(message);
});
$('report-form').addEventListener('submit', generate);
$('cancel').addEventListener('click', async () => {
  $('cancel').disabled = true;
  status('Cancelling…');
  try {
    await window.reports.cancel();
  } catch (error) {
    $('cancel').disabled = false;
    status('Could not cancel. ' + error.message);
  }
});
$('copy').addEventListener('click', () => exportReport('copy'));
$('save').addEventListener('click', () => exportReport('save'));

const updateStatus = $('update-status');
window.reports.supportsUpdates().then(supported => { $('updates').hidden = !supported; });
$('check-updates').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  updateStatus.textContent = 'Checking GitHub…';
  try {
    await window.reports.checkForUpdates();
    updateStatus.textContent = '';
  } catch {
    updateStatus.textContent = 'Could not check for updates.';
  } finally {
    button.disabled = false;
  }
});
