'use strict';

const $ = id => document.getElementById(id);
const sections = {
  subscriptions: { label: 'Subscriptions', columns: ['Date', 'Time', 'Username', 'Type', 'Tier'],
    row: item => [item.date, item.time, item.user, item.type, item.tier] },
  cheers: { label: 'Cheers', columns: ['Username', 'Total bits'], row: item => [item.user, item.amount] },
  gifts: { label: 'Gifted subs', columns: ['Username', 'Total gifted'], row: item => [item.user, item.total] },
  uniqueUsers: { label: 'Unique Viewers', columns: ['Username', 'Activity'], row: item => [item.user, item.activity] },
  raids: { label: 'Raids', columns: ['Raiding streamer', 'Times raided'], row: item => [item.user, item.count] },
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
      singleDay: $('single-day').value,
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
  const mode = $('mode').value;
  for (const [period, controls, input] of [
    ['month', 'month-controls', 'year'], ['week', 'week-controls', 'week-start'], ['day', 'day-controls', 'single-day']
  ]) {
    $(controls).hidden = mode !== period;
    $(input).disabled = mode !== period;
  }
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
  $('single-day').max = TwitchReportDates.todayISO(now);
  $('single-day').value = preferences.singleDay || TwitchReportDates.todayISO(now);
  if (['week', 'day'].includes(preferences.mode)) $('mode').value = preferences.mode;
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

const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function sectionTable(id, columns, rows) {
  const tools = element('div', undefined, 'section-tools');
  const filter = element('input');
  filter.type = 'search';
  filter.placeholder = 'Filter rows';
  filter.setAttribute('aria-label', 'Filter ' + sections[id].label);
  filter.hidden = rows.length === 0;
  tools.append(filter);
  for (const [action, label] of [['copy', 'Copy section'], ['save', 'Save section']]) {
    const button = element('button', label, 'section-export');
    button.type = 'button';
    button.title = 'Use the report format selected above and include all rows in this section.';
    button.addEventListener('click', () => exportReport(action, id));
    tools.append(button);
  }

  const headers = element('tr');
  const head = element('thead');
  const body = element('tbody');
  const empty = element('p', '', 'section-empty');
  empty.setAttribute('role', 'status');
  const node = element('table');
  node.append(head, body);
  head.append(headers);
  const wrapper = element('div', undefined, 'table-wrap');
  wrapper.append(node);
  let sortIndex = -1;
  let direction = 1;
  const headingCells = columns.map((column, index) => {
    const header = element('th');
    header.scope = 'col';
    const sort = element('button', column, 'sort-column');
    sort.type = 'button';
    sort.addEventListener('click', () => {
      direction = index === sortIndex ? -direction : 1;
      sortIndex = index;
      redraw();
    });
    header.append(sort);
    headers.append(header);
    return { header, sort, column };
  });

  function redraw() {
    const terms = filter.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const visible = rows.filter(row => {
      const text = row.join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    });
    if (sortIndex >= 0) {
      visible.sort((a, b) => direction * collator.compare(a[sortIndex], b[sortIndex]));
    }
    headingCells.forEach(({ header, sort, column }, index) => {
      if (index === sortIndex) {
        header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
        sort.textContent = column + (direction === 1 ? ' ↑' : ' ↓');
      } else {
        header.removeAttribute('aria-sort');
        sort.textContent = column;
      }
    });
    const contents = document.createDocumentFragment();
    for (const row of visible) {
      const tr = element('tr');
      for (const cell of row) tr.append(element('td', cell));
      contents.append(tr);
    }
    body.replaceChildren(contents);
    wrapper.hidden = !rows.length;
    empty.hidden = visible.length > 0;
    empty.textContent = rows.length ? 'No rows match the filter.' : 'No matching activity.';
  }

  filter.addEventListener('input', redraw);
  redraw();
  return [tools, wrapper, empty];
}

function render(report) {
  const { data, diagnostics, period, channel } = report;
  $('report-title').textContent = '#' + channel;
  $('report-period').textContent = period.label + (period.partial ? ' · Through ' + period.endDate : '');
  const result = $('results-body');
  result.replaceChildren();
  const showViewers = report.sections.includes('uniqueUsers');
  $('viewers-panel').hidden = !showViewers;
  if (showViewers) {
    const viewers = sections.uniqueUsers;
    const count = data.uniqueUsers.length;
    $('viewers-count').textContent = count.toLocaleString('en-US') + (count === 1 ? ' viewer' : ' viewers') + ' with sub, cheer, or gift activity';
    $('viewers-body').replaceChildren(...sectionTable('uniqueUsers', viewers.columns, data.uniqueUsers.map(viewers.row)));
  }
  const metrics = {
    subscriptions: ['Subscriptions', data.subscriptions.length],
    cheers: ['Total bits', data.totalBits],
    gifts: ['Subs gifted', data.totalGifts],
    raids: ['Raiding streamers', data.raids.length],
    streaks: ['Longest streak', data.streaks[0]?.count ?? 0],
    diagnostics: ['Days with logs', diagnostics.successfulDays.length + ' / ' + diagnostics.daysChecked]
  };
  const reportSections = report.sections.filter(id => id !== 'uniqueUsers');
  const summary = element('dl', undefined, 'metrics');
  for (const id of reportSections) {
    const [label, value] = metrics[id];
    const item = element('div', undefined, 'metric');
    item.append(element('dt', label), element('dd', value.toLocaleString('en-US')));
    summary.append(item);
  }
  if (reportSections.length) result.append(summary);
  else result.append(element('p', 'Viewer activity is shown in the Unique Viewers panel.', 'viewer-empty'));
  for (const [index, id] of reportSections.entries()) {
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
      details.append(...sectionTable(id, ['Date', 'Archive status'], rows));
    } else {
      const rows = data[id].map(section.row);
      if (id === 'gifts') {
        details.append(element('p', data.gifts.length + ' unique gifters · ' + data.giftAnnouncements + ' gift announcements'));
      }
      details.append(...sectionTable(id, section.columns, rows));
    }
    result.append(details);
  }
}

function updateButtons() {
  $('report-settings').disabled = busy || exporting;
  $('cancel').hidden = !busy;
  for (const control of [...canExport, ...document.querySelectorAll('.section-export')]) control.disabled = busy || exporting || !currentReport;
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
    singleDay: $('single-day').value,
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

async function exportReport(action, section) {
  if (busy || exporting || !currentReport) return;
  const format = $('format').value;
  const label = section ? sections[section].label : 'Report';
  exporting = true;
  updateButtons();
  try {
    if (action === 'save') {
      const saved = await window.reports.save(format, section);
      if (saved) status(label + ' saved as ' + format.toUpperCase() + '.');
    } else {
      await window.reports.copy(format, section);
      status(label + ' copied to clipboard as ' + format.toUpperCase() + '.');
    }
  } catch (error) {
    status('Could not ' + action + ' report. ' + error.message);
  } finally {
    exporting = false;
    updateButtons();
  }
}

setup();
window.reports.appVersion().then(version => { $('app-version').textContent = 'v' + version; });
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
window.reports.onUpdateStatus(message => { updateStatus.textContent = message; });
window.reports.supportsUpdates().then(supported => { $('updates').hidden = !supported; });
$('check-updates').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  updateStatus.textContent = 'Checking GitHub…';
  try {
    await window.reports.checkForUpdates();
    if (updateStatus.textContent === 'Checking GitHub…') updateStatus.textContent = '';
  } catch {
    updateStatus.textContent = 'Could not check for updates.';
  } finally {
    button.disabled = false;
  }
});
