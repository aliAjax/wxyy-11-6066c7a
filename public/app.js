const state = {
  config: null,
  db: {},
  activeTab: '',
  calendarData: [],
  calendarMonth: new Date(),
  selectedScrollId: '',
  conflictCheck: { scrollId: '', borrowDate: '', dueDate: '', conflicts: [] },
  riskPreview: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function fmtShortDate(value) {
  if (!value) return '-';
  const d = new Date(value + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

function dateOverlap(start1, end1, start2, end2) {
  const s1 = parseDate(start1).getTime();
  const e1 = parseDate(end1).getTime();
  const s2 = parseDate(start2).getTime();
  const e2 = parseDate(end2).getTime();
  return s1 <= e2 && e1 >= s2;
}

function getMonthDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];
  const startPadding = firstDay.getDay();
  for (let i = 0; i < startPadding; i++) {
    const d = new Date(year, month, -startPadding + i + 1);
    days.push({ date: d, inMonth: false });
  }
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), inMonth: true });
  }
  const endPadding = 42 - days.length;
  for (let i = 1; i <= endPadding; i++) {
    days.push({ date: new Date(year, month + 1, i), inMonth: false });
  }
  return days;
}

function toDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isToday(d) {
  const today = new Date();
  return d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
}

function getReservationsForDate(dateStr, scrollId = null) {
  const result = [];
  for (const entry of state.calendarData) {
    if (scrollId && entry.scrollId !== scrollId) continue;
    for (const res of entry.reservations) {
      if (dateOverlap(dateStr, dateStr, res.borrowDate, res.dueDate)) {
        result.push({ ...res, scrollId: entry.scrollId, scrollTitle: entry.title });
      }
    }
  }
  return result;
}

function getUnavailableDateRanges(scrollId) {
  const entry = state.calendarData.find((e) => e.scrollId === scrollId);
  if (!entry) return [];
  return entry.reservations.map((r) => ({
    start: r.borrowDate,
    end: r.dueDate,
    borrower: r.borrower,
    purpose: r.purpose,
    status: r.status
  }));
}

async function checkConflict(scrollId, borrowDate, dueDate) {
  if (!scrollId || !borrowDate || !dueDate) {
    state.conflictCheck = { scrollId, borrowDate, dueDate, conflicts: [] };
    return [];
  }
  try {
    const result = await api(`/api/loans/check-conflict?scrollId=${encodeURIComponent(scrollId)}&borrowDate=${encodeURIComponent(borrowDate)}&dueDate=${encodeURIComponent(dueDate)}`);
    state.conflictCheck = { scrollId, borrowDate, dueDate, conflicts: result.conflicts };
    return result.conflicts;
  } catch (e) {
    state.conflictCheck = { scrollId, borrowDate, dueDate, conflicts: [] };
    return [];
  }
}

async function previewRisk(loanData) {
  if (!loanData || !loanData.scrollId) {
    state.riskPreview = null;
    return null;
  }
  try {
    const result = await api('/api/loans/assess-preview', {
      method: 'POST',
      body: JSON.stringify(loanData)
    });
    state.riskPreview = result;
    return result;
  } catch (e) {
    state.riskPreview = null;
    return null;
  }
}

function toneForRisk(level) {
  if (level === '低风险') return 'risk-low';
  if (level === '中风险') return 'risk-warn';
  if (level === '高风险') return 'risk-bad';
  if (level === '极高风险') return 'risk-extreme';
  return '';
}

function renderRiskPanel(assessment) {
  if (!assessment) return '';
  const tone = toneForRisk(assessment.level);
  const reasons = (assessment.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const strictHtml = assessment.isStrictMode
    ? `<div class="risk-strict">⚠️ 严格模式：${assessment.protectionLevel === '一级' ? '一级保护经卷' : ''}${assessment.protectionLevel === '一级' && assessment.borrowStatus === '修补中' ? ' + ' : ''}${assessment.borrowStatus === '修补中' ? '经卷修补中' : ''}，审批需确认</div>`
    : '';
  return `
    <div class="risk-panel ${tone}">
      <div class="risk-panel-head">
        <span>📊 ${pill(assessment.level, toneFor(assessment.level))}</span>
        <span class="risk-score">得分 ${assessment.score} / 100</span>
      </div>
      <ul class="risk-reasons">${reasons}</ul>
      ${strictHtml}
    </div>
  `;
}

function renderRiskPreview(assessment) {
  if (!assessment) return '';
  return `<div class="risk-preview">
    <div class="risk-preview-title">🔍 实时风险预览</div>
    ${renderRiskPanel(assessment)}
  </div>`;
}

function renderConflictWarning(conflicts) {
  if (!conflicts || !conflicts.length) return '';
  const items = conflicts.map((c) => `
    <div class="conflict-item">
      <span class="conflict-title">${escapeHtml(c.borrower)} - ${escapeHtml(c.purpose)}</span>
      <span class="conflict-date">${escapeHtml(c.borrowDate)} 至 ${escapeHtml(c.dueDate)}</span>
      ${pill(c.status, toneFor(c.status))}
    </div>
  `).join('');
  return `<div class="conflict-warning">
    <div class="conflict-header">⚠️ 日期冲突 - 以下时段已被占用</div>
    ${items}
  </div>`;
}

function renderUnavailableRanges(scrollId) {
  const ranges = getUnavailableDateRanges(scrollId);
  if (!ranges.length) return '';
  const items = ranges.map((r) => `
    <div class="unavailable-item">
      <span class="unavailable-date">${escapeHtml(r.start)} ~ ${escapeHtml(r.end)}</span>
      <span class="unavailable-info">${escapeHtml(r.borrower)} - ${escapeHtml(r.purpose)} ${pill(r.status, toneFor(r.status))}</span>
    </div>
  `).join('');
  return `<div class="unavailable-section">
    <div class="unavailable-header">📅 已预约时段（不可选）</div>
    ${items}
  </div>`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '请求失败');
  }
  if (res.status === 204) return null;
  return res.json();
}

function valueByPath(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function getRiskField(item, fieldName) {
  const assessment = item.riskAssessment;
  if (!assessment) return '-';
  if (fieldName === 'riskLevel') {
    return assessment.level || '-';
  }
  if (fieldName === 'scrollProtection') {
    return assessment.protectionLevel || '-';
  }
  if (fieldName === 'scrollBorrowStatus') {
    return assessment.borrowStatus || '-';
  }
  return item[fieldName] ?? '';
}

function displayField(item, field) {
  if (field.name === 'quantityWithUnit') {
    const qty = item.quantity ?? '';
    const unit = item.unit ?? '';
    return qty !== '' ? `${qty} ${unit}`.trim() : '-';
  }
  if (['riskLevel', 'scrollProtection', 'scrollBorrowStatus'].includes(field.name)) {
    return getRiskField(item, field.name);
  }
  const value = item[field.name] ?? '';
  if (field.type === 'select' && field.options) return value || field.options[0];
  return value;
}

function collectionLabel(collection) {
  return state.config.collections[collection]?.label || collection;
}

function relationLabel(relation, id) {
  const item = state.db[relation.collection]?.find((entry) => entry.id === id);
  if (!item) return '未关联';
  return relation.labelFields.map((field) => {
    if (field === 'quantity' && item.unit) {
      return `${item.quantity ?? 0} ${item.unit}`;
    }
    return item[field];
  }).filter(Boolean).join(' / ');
}

function optionList(items, labelFields) {
  return items.map((item) => {
    const label = labelFields.map((field) => {
      if (field === 'quantity' && item.unit) {
        return `${item.quantity ?? 0} ${item.unit}`;
      }
      return item[field];
    }).filter(Boolean).join(' / ');
    return `<option value="${item.id}">${escapeHtml(label)}</option>`;
  }).join('');
}

function formField(field, viewId) {
  const required = field.required ? 'required' : '';
  const value = field.default ? `value="${escapeHtml(field.default)}"` : '';
  const conflictCheckClass = viewId === 'loans' && (field.name === 'borrowDate' || field.name === 'dueDate') ? 'conflict-check' : '';
  const relationSelectClass = viewId === 'loans' && field.type === 'relation' ? 'scroll-select' : '';
  if (field.type === 'textarea') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<textarea name="${field.name}" ${required}></textarea></label>`;
  }
  if (field.type === 'select') {
    return `<label class="${field.wide ? 'wide' : ''}">${field.label}<select name="${field.name}" ${required}>${field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'relation') {
    const items = state.db[field.collection] || [];
    return `<label class="${field.wide ? 'wide' : ''} ${relationSelectClass}">${field.label}<select name="${field.name}" ${required}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''} ${conflictCheckClass}">${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${required}></label>`;
}

function pill(value, tone = '') {
  return `<span class="pill ${tone}">${escapeHtml(value || '-')}</span>`;
}

function toneFor(value) {
  return state.config.tones?.[value] || '';
}

function historyHtml(item) {
  const history = item.history || [];
  if (!history.length) return '';
  return `<div class="history">${history.slice(0, 5).map((entry) => `
    <div class="history-item"><span>${fmtDate(entry.at)}</span><span>${escapeHtml(entry.action)}${entry.note ? '：' + escapeHtml(entry.note) : ''}</span></div>
  `).join('')}</div>`;
}

function values(form, view) {
  const payload = Object.fromEntries(new FormData(form).entries());
  for (const field of view.fields) {
    if (field.type === 'number') payload[field.name] = Number(payload[field.name] || 0);
  }
  return { ...view.defaults, ...payload };
}

function renderTabs() {
  $('#tabs').innerHTML = state.config.views.map((view, index) => `
    <button class="tab${index === 0 ? ' active' : ''}" data-tab="${view.id}">${escapeHtml(view.label)}</button>
  `).join('');
  state.activeTab = state.config.views[0].id;
}

function setTab(tabId) {
  state.activeTab = tabId;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === tabId));
}

function renderStats() {
  return `<div class="stats">${state.config.stats.map((stat) => {
    const items = state.db[stat.collection] || [];
    const value = stat.filter ? items.filter((item) => item[stat.filter.field] === stat.filter.value).length : items.length;
    return `<div class="stat"><span>${escapeHtml(stat.label)}</span><strong>${value}</strong></div>`;
  }).join('')}</div>`;
}

function renderCard(item, collection, view) {
  const title = view.titleFields.map((field) => item[field]).filter(Boolean).join(' / ') || item.id;
  const statusValue = item[view.statusField];
  const relation = view.relation ? `<div class="meta">${escapeHtml(relationLabel(view.relation, item[view.relation.localKey]))}</div>` : '';
  const details = (view.detailFields || []).map((field) => {
    const raw = displayField(item, field);
    let value = raw;
    if (field.type === 'relation') {
      value = relationLabel(field, item[field.name]);
    } else if (field.name === 'riskLevel') {
      value = pill(raw || '-', toneFor(raw));
    } else {
      value = escapeHtml(value || '-');
    }
    return `<div>${escapeHtml(field.label)}<br><strong>${value}</strong></div>`;
  }).join('');
  const summary = (view.summaryFields || []).map((field) => item[field]).filter(Boolean).join(' · ');

  const actionButtons = (itemId) => {
    return state.config.actions
      .filter((action) => action.collection === collection)
      .map((action) => `<button class="${action.danger ? 'danger' : 'ghost'}" data-action="${action.id}" data-id="${itemId}">${escapeHtml(action.label)}</button>`)
      .join('');
  };

  const actionsHtml = collection === 'loans' && item.riskAssessment?.isStrictMode
    ? `<div class="actions">${state.config.actions
        .filter((action) => action.collection === collection)
        .map((action) => {
          const extraClass = (action.id === 'loan-approve' || action.id === 'loan-reject') ? ' strict-action' : '';
          return `<button class="${action.danger ? 'danger' : 'ghost'}${extraClass}" data-action="${action.id}" data-id="${item.id}" data-strict="true">${action.id === 'loan-approve' || action.id === 'loan-reject' ? '⚠️ ' : ''}${escapeHtml(action.label)}</button>`;
        })
        .join('')}</div>`
    : `<div class="actions">${actionButtons(item.id)}</div>`;

  const riskHtml = collection === 'loans' ? renderRiskPanel(item.riskAssessment) : '';

  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, toneFor(statusValue)) : ''}</div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${riskHtml}
    ${actionsHtml}
    ${historyHtml(item)}
  </article>`;
}

function renderList(view) {
  const collection = view.collection;
  const query = $(`#search-${view.id}`)?.value.trim() || '';
  const status = $(`#status-${view.id}`)?.value || '';
  let items = [...(state.db[collection] || [])];
  if (query) {
    items = items.filter((item) => view.searchFields.some((field) => String(item[field] || '').includes(query)));
  }
  if (status) {
    items = items.filter((item) => item[view.statusField] === status);
  }
  if (view.id === 'loans') {
    items.sort((a, b) => {
      const scoreA = a.riskAssessment?.score || 0;
      const scoreB = b.riskAssessment?.score || 0;
      return scoreB - scoreA;
    });
  }
  return items.length ? items.map((item) => renderCard(item, collection, view)).join('') : `<div class="empty">暂无${escapeHtml(collectionLabel(collection))}</div>`;
}

function renderDashboardPanel(focusConfig) {
  const source = focusConfig.focus;
  let items = [...(state.db[source.collection] || [])];
  if (source.field) items = items.filter((item) => source.values.includes(item[source.field]));
  items = items.slice(0, source.limit || 8);
  const cardView = state.config.views.find((entry) => entry.collection === source.collection) || source;
  const panelTitle = focusConfig.title || '重点事项';
  const emptyText = focusConfig.emptyText || '暂无记录';
  return `<div class="panel"><h2>${escapeHtml(panelTitle)}</h2><div class="list">${items.length ? items.map((item) => renderCard(item, source.collection, cardView)).join('') : `<div class="empty">${escapeHtml(emptyText)}</div>`}</div></div>`;
}

function renderDashboardView(view) {
  const foci = view.foci || [{ title: view.focusTitle, focus: view.focus, emptyText: '暂无重点事项' }];
  const panels = foci.map(renderDashboardPanel).join('');
  return `<section class="view active" id="${view.id}">
    ${renderStats()}
    ${panels}
  </section>`;
}

function renderCalendarView(view) {
  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  const days = getMonthDays(year, month);
  const scrolls = state.db.scrolls || [];
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  const scrollOptions = scrolls.length
    ? `<option value="">全部经卷</option>${scrolls.map((s) => `<option value="${s.id}" ${state.selectedScrollId === s.id ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}`
    : '<option value="">暂无经卷</option>';

  const calendarHtml = `
    <div class="calendar-header">
      <button class="ghost" data-calendar-prev>◀ 上月</button>
      <h3 class="calendar-title">${year}年${month + 1}月</h3>
      <button class="ghost" data-calendar-next>下月 ▶</button>
    </div>
    <div class="calendar-filter">
      <label>筛选经卷：<select id="calendar-scroll-filter">${scrollOptions}</select></label>
      <button class="ghost" data-calendar-today>今天</button>
    </div>
    <div class="calendar-legend">
      <span class="legend-item"><span class="legend-dot legend-today"></span>今天</span>
      <span class="legend-item"><span class="legend-dot legend-reserved"></span>已预约</span>
      <span class="legend-item"><span class="legend-dot legend-multiple"></span>多卷预约</span>
    </div>
    <div class="calendar-grid">
      ${weekdayNames.map((name) => `<div class="calendar-weekday">${name}</div>`).join('')}
      ${days.map(({ date, inMonth }) => {
        const dateStr = toDateString(date);
        const reservations = getReservationsForDate(dateStr, state.selectedScrollId || null);
        const hasReservation = reservations.length > 0;
        const hasMultiple = reservations.length > 1;
        const today = isToday(date);
        const reservationHtml = hasReservation ? reservations.slice(0, 2).map((r) => `
          <div class="calendar-event" title="${escapeHtml(r.scrollTitle)} - ${escapeHtml(r.borrower)}: ${escapeHtml(r.purpose)} (${r.status})">
            <span class="event-scroll">${escapeHtml(r.scrollTitle)}</span>
            <span class="event-borrower">${escapeHtml(r.borrower)}</span>
          </div>
        `).join('') + (reservations.length > 2 ? `<div class="calendar-event more">+${reservations.length - 2} 更多</div>` : '') : '';
        return `<div class="calendar-day ${inMonth ? '' : 'other-month'} ${today ? 'today' : ''} ${hasReservation ? 'has-reservation' : ''} ${hasMultiple ? 'multiple' : ''}">
          <div class="day-number">${date.getDate()}</div>
          ${reservationHtml}
        </div>`;
      }).join('')}
    </div>
  `;

  const scrollListHtml = state.calendarData.length
    ? state.calendarData.map((entry) => {
      if (state.selectedScrollId && entry.scrollId !== state.selectedScrollId) return '';
      const reservations = entry.reservations;
      if (!reservations.length) return '';
      return `<div class="scroll-reservations">
        <h4>${escapeHtml(entry.title)} ${pill(entry.borrowStatus, toneFor(entry.borrowStatus))}</h4>
        <div class="reservation-list">
          ${reservations.map((r) => `
            <div class="reservation-item">
              <div class="reservation-dates">${escapeHtml(r.borrowDate)} ~ ${escapeHtml(r.dueDate)}</div>
              <div class="reservation-info">
                <span>${escapeHtml(r.borrower)} - ${escapeHtml(r.purpose)}</span>
                ${pill(r.status, toneFor(r.status))}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    }).filter(Boolean).join('')
    : '<div class="empty">暂无预约数据</div>';

  return `<section class="view" id="${view.id}">
    <div class="grid">
      <div class="panel">
        <h2>借阅预约日历</h2>
        ${calendarHtml}
      </div>
      <div class="panel">
        <h2>经卷预约明细</h2>
        ${scrollListHtml}
      </div>
    </div>
  </section>`;
}

function renderCrudView(view) {
  const statusOptions = view.statusOptions || [];
  const conflictWarning = view.id === 'loans' && state.conflictCheck.conflicts.length
    ? renderConflictWarning(state.conflictCheck.conflicts)
    : '';
  const unavailableRanges = view.id === 'loans' && state.conflictCheck.scrollId
    ? renderUnavailableRanges(state.conflictCheck.scrollId)
    : '';
  const riskPreviewHtml = view.id === 'loans' && state.riskPreview
    ? renderRiskPreview(state.riskPreview)
    : '';
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-create="${view.collection}" data-view="${view.id}">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">${view.fields.map((f) => formField(f, view.id)).join('')}</div>
        ${riskPreviewHtml}
        ${conflictWarning}
        ${unavailableRanges}
        <div class="actions"><button ${state.conflictCheck.conflicts.length ? 'disabled' : ''}>${escapeHtml(view.submitLabel || '保存')}</button></div>
      </form>
      <div class="panel">
        <h2>${escapeHtml(view.listTitle)}</h2>
        <div class="toolbar">
          <input id="search-${view.id}" placeholder="${escapeHtml(view.searchPlaceholder || '搜索')}">
          <select id="status-${view.id}">
            <option value="">全部状态</option>
            ${statusOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="list" id="list-${view.id}">${renderList(view)}</div>
      </div>
    </div>
  </section>`;
}

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;
  $('#main').innerHTML = state.config.views.map((view) => {
    if (view.type === 'dashboard') return renderDashboardView(view);
    if (view.type === 'calendar') return renderCalendarView(view);
    return renderCrudView(view);
  }).join('');
  setTab(state.activeTab || state.config.views[0].id);
}

async function load() {
  state.db = await api('/api/db');
  try {
    state.calendarData = await api('/api/loans/calendar');
  } catch (e) {
    state.calendarData = [];
  }
  render();
}

function openStrictConfirmModal(action, item, onConfirm) {
  const assessment = item.riskAssessment || {};
  const scroll = state.db.scrolls?.find((s) => s.id === item.scrollId);
  const isApprove = action.id === 'loan-approve';
  const actionName = isApprove ? '批准' : '拒绝';
  const warnText = isApprove
    ? '此操作涉及严格模式经卷，批准后将不可撤销！请确认已充分评估风险。'
    : '确认拒绝此借阅申请？风险评估记录将保存至历史。';

  const reasons = (assessment.reasons || []).slice(0, 5).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const strictReason = [];
  if (assessment.protectionLevel === '一级') strictReason.push('一级保护经卷');
  if (assessment.borrowStatus === '修补中') strictReason.push('经卷处于修补中状态');

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'strict-modal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>⚠️ 严格模式 - 确认${actionName}</h3>
        <button class="modal-close" data-modal-close>×</button>
      </div>
      <div class="modal-body">
        <div class="modal-warn-icon">🔒</div>
        <div class="modal-warning-text">${escapeHtml(warnText)}</div>
        <div class="modal-info-grid">
          <div class="modal-info-row"><span class="label">经卷名称</span><span><strong>${escapeHtml(scroll?.title || '-')}</strong></span></div>
          <div class="modal-info-row"><span class="label">借阅人</span><span>${escapeHtml(item.borrower || '-')}</span></div>
          <div class="modal-info-row"><span class="label">借阅用途</span><span>${escapeHtml(item.purpose || '-')}</span></div>
          <div class="modal-info-row"><span class="label">风险等级</span><span>${pill(assessment.level || '-', toneFor(assessment.level))} <span style="font-family:monospace;color:var(--muted)">(${assessment.score || 0}/100)</span></span></div>
          <div class="modal-info-row"><span class="label">触发原因</span><span style="color:var(--bad);font-weight:700">${escapeHtml(strictReason.join(' + '))}</span></div>
        </div>
        <div style="font-size:13px;color:var(--muted);font-weight:700;margin:10px 0 4px">风险评估详情：</div>
        <ul class="risk-reasons">${reasons}</ul>
        <div style="margin-top:14px">
          <label style="color:var(--bad);font-size:13px;font-weight:700">请输入${actionName}理由（必填）：
            <textarea class="modal-confirm-textarea" id="strict-note" placeholder="请详细说明${actionName}此借阅申请的原因，特别是对于严格模式经卷..."></textarea>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <button class="ghost" data-modal-close>取消</button>
        <button class="${isApprove ? '' : 'danger'}" id="strict-confirm-btn">确认${actionName}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal-close]') || e.target === modal) close();
    if (e.target.id === 'strict-confirm-btn') {
      const note = $('#strict-note', modal)?.value.trim();
      if (!note) {
        toast(`请输入${actionName}理由`);
        return;
      }
      close();
      onConfirm(note);
    }
  });
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  const action = event.target.closest('[data-action]');
  const prevMonth = event.target.closest('[data-calendar-prev]');
  const nextMonth = event.target.closest('[data-calendar-next]');
  const todayBtn = event.target.closest('[data-calendar-today]');

  if (tab) setTab(tab.dataset.tab);

  if (action) {
    const actionId = action.dataset.action;
    const itemId = action.dataset.id;
    const actionConfig = state.config.actions.find((a) => a.id === actionId);
    const item = state.db[actionConfig?.collection]?.find((i) => i.id === itemId);

    if (actionConfig?.collection === 'loans' &&
        (actionId === 'loan-approve' || actionId === 'loan-reject') &&
        item?.riskAssessment?.isStrictMode) {
      openStrictConfirmModal(actionConfig, item, async (note) => {
        try {
          await api(`/api/${actionConfig.collection}/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ note, historyAction: actionConfig.label })
          });
          await api(`/api/action/${actionId}/${itemId}`, { method: 'POST' });
          await load();
          toast(`已${actionConfig.label}`);
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    try {
      await api(`/api/action/${actionId}/${itemId}`, { method: 'POST' });
      await load();
      toast('已更新');
    } catch (error) {
      toast(error.message);
    }
  }
  if (prevMonth) {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
    render();
  }
  if (nextMonth) {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
    render();
  }
  if (todayBtn) {
    state.calendarMonth = new Date();
    render();
  }
});

let conflictCheckTimeout = null;
let riskPreviewTimeout = null;

document.addEventListener('input', async (event) => {
  const view = state.config.views.find((entry) => entry.id && (event.target.id === `search-${entry.id}` || event.target.id === `status-${entry.id}`));
  if (view) $(`#list-${view.id}`).innerHTML = renderList(view);

  if (event.target.id === 'calendar-scroll-filter') {
    state.selectedScrollId = event.target.value;
    render();
    return;
  }

  const form = event.target.closest('[data-create="loans"]');
  if (form) {
    const scrollId = form.querySelector('[name="scrollId"]')?.value;
    const borrowDate = form.querySelector('[name="borrowDate"]')?.value;
    const dueDate = form.querySelector('[name="dueDate"]')?.value;
    const purpose = form.querySelector('[name="purpose"]')?.value;

    if (riskPreviewTimeout) clearTimeout(riskPreviewTimeout);
    riskPreviewTimeout = setTimeout(async () => {
      if (scrollId) {
        const preview = await previewRisk({ scrollId, borrowDate, dueDate, purpose });
        const previewEl = form.querySelector('.risk-preview');
        const newPreviewHtml = renderRiskPreview(preview);
        if (previewEl) {
          previewEl.outerHTML = newPreviewHtml || '';
        } else if (newPreviewHtml) {
          const actionsDiv = form.querySelector('.actions');
          const conflictWarning = form.querySelector('.conflict-warning');
          if (conflictWarning) {
            conflictWarning.insertAdjacentHTML('beforebegin', newPreviewHtml);
          } else {
            actionsDiv.insertAdjacentHTML('beforebegin', newPreviewHtml);
          }
        }
      } else {
        state.riskPreview = null;
        const previewEl = form.querySelector('.risk-preview');
        if (previewEl) previewEl.remove();
      }
    }, 250);

    if (scrollId && borrowDate && dueDate) {
      if (conflictCheckTimeout) clearTimeout(conflictCheckTimeout);
      conflictCheckTimeout = setTimeout(async () => {
        await checkConflict(scrollId, borrowDate, dueDate);
        const conflictWarningEl = form.querySelector('.conflict-warning');
        const unavailableEl = form.querySelector('.unavailable-section');
        const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
        
        if (state.conflictCheck.conflicts.length) {
          if (!conflictWarningEl) {
            const actionsDiv = form.querySelector('.actions');
            actionsDiv.insertAdjacentHTML('beforebegin', renderConflictWarning(state.conflictCheck.conflicts));
          } else {
            conflictWarningEl.outerHTML = renderConflictWarning(state.conflictCheck.conflicts);
          }
          if (submitBtn) submitBtn.disabled = true;
        } else {
          if (conflictWarningEl) conflictWarningEl.remove();
          if (submitBtn) submitBtn.disabled = false;
        }

        if (scrollId) {
          const rangesHtml = renderUnavailableRanges(scrollId);
          if (!unavailableEl && rangesHtml) {
            const actionsDiv = form.querySelector('.actions');
            actionsDiv.insertAdjacentHTML('beforebegin', rangesHtml);
          } else if (unavailableEl && rangesHtml) {
            unavailableEl.outerHTML = rangesHtml;
          } else if (unavailableEl && !rangesHtml) {
            unavailableEl.remove();
          }
        } else if (unavailableEl) {
          unavailableEl.remove();
        }
      }, 200);
    } else if (scrollId) {
      state.conflictCheck.scrollId = scrollId;
      const unavailableEl = form.querySelector('.unavailable-section');
      const rangesHtml = renderUnavailableRanges(scrollId);
      if (!unavailableEl && rangesHtml) {
        const actionsDiv = form.querySelector('.actions');
        actionsDiv.insertAdjacentHTML('beforebegin', rangesHtml);
      } else if (unavailableEl && rangesHtml) {
        unavailableEl.outerHTML = rangesHtml;
      }
    }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  try {
    await api(`/api/${form.dataset.create}`, { method: 'POST', body: JSON.stringify(values(form, view)) });
    form.reset();
    state.conflictCheck = { scrollId: '', borrowDate: '', dueDate: '', conflicts: [] };
    state.riskPreview = null;
    await load();
    toast('已保存');
  } catch (error) {
    toast(error.message);
    if (form.dataset.create === 'loans') {
      const scrollId = form.querySelector('[name="scrollId"]')?.value;
      const borrowDate = form.querySelector('[name="borrowDate"]')?.value;
      const dueDate = form.querySelector('[name="dueDate"]')?.value;
      if (scrollId && borrowDate && dueDate) {
        await checkConflict(scrollId, borrowDate, dueDate);
        const conflictWarningEl = form.querySelector('.conflict-warning');
        const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
        if (state.conflictCheck.conflicts.length) {
          if (!conflictWarningEl) {
            const actionsDiv = form.querySelector('.actions');
            actionsDiv.insertAdjacentHTML('beforebegin', renderConflictWarning(state.conflictCheck.conflicts));
          } else {
            conflictWarningEl.outerHTML = renderConflictWarning(state.conflictCheck.conflicts);
          }
          if (submitBtn) submitBtn.disabled = true;
        }
      }
    }
  }
});

$('#refreshBtn').addEventListener('click', () => load().then(() => toast('已刷新')));

async function boot() {
  state.config = await api('/api/config');
  renderTabs();
  await load();
}

boot().catch((error) => toast(error.message));
