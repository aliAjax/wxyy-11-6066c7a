const state = {
  config: null,
  db: {},
  activeTab: '',
  calendarData: [],
  calendarMonth: new Date(),
  selectedScrollId: '',
  conflictCheck: { scrollId: '', borrowDate: '', dueDate: '', conflicts: [] },
  riskPreview: null,
  timelineScrollId: null,
  timelineData: null,
  timelineFilter: '',
  batchImport: {
    csvText: '',
    previewData: null,
    selectedRows: new Set(),
    importing: false
  },
  consistencyCheck: {
    issues: [],
    summary: null,
    checkedAt: null,
    loading: false,
    fixing: {},
    filter: ''
  },
  currentRole: 'admin',
  currentRoleName: '管理员',
  currentUser: '系统',
  roles: [],
  auditLogs: {
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    filters: {
      operator: '',
      collection: '',
      startTime: '',
      endTime: ''
    }
  }
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

function isStrictRiskAssessment(assessment) {
  if (!assessment) return false;
  return assessment.isStrictMode === true ||
    assessment.protectionLevel === '一级' ||
    assessment.borrowStatus === '修补中';
}

function renderRiskPanel(assessment) {
  if (!assessment) return '';
  const tone = toneForRisk(assessment.level);
  const reasons = (assessment.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const strictHtml = isStrictRiskAssessment(assessment)
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

function renderProtectionAdvice(advice) {
  if (!advice) return '';
  const suggestions = advice.suggestions || (advice.content ? advice.content.split('\n') : []);
  if (!suggestions.length) return '';
  const items = suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  const generatedAt = advice.generatedAt ? `<div class="advice-generated">生成时间：${fmtDate(advice.generatedAt)}</div>` : '';
  const tags = (advice.damageLabels || []).map((label) => pill(label, toneFor(
    label === '严重残损' ? '已拒绝' :
    label === '明显残损' ? '修补中' :
    label === '轻度残损' ? '需审批' : '可借阅'
  ))).join('');
  return `<div class="protection-advice">
    <div class="protection-advice-head">
      <span class="protection-advice-title">🛡️ 保护建议</span>
      ${tags ? `<span class="protection-advice-tags">${tags}</span>` : ''}
    </div>
    <ul class="protection-advice-list">${items}</ul>
    ${generatedAt}
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
  const headers = {
    'Content-Type': 'application/json',
    'X-User-Role': state.currentRole,
    'X-User-Name': encodeURIComponent(state.currentUser),
    ...(options.headers || {})
  };
  const res = await fetch(path, {
    ...options,
    headers
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

function renderBatchTasksDetail(tasks) {
  const statuses = ['计划中', '进行中', '已完成'];
  return `<div class="batch-tasks-detail">
    ${tasks.map((t) => {
      const statusTone = toneFor(t.status);
      const quickActions = [];
      if (t.status !== '计划中') quickActions.push(`<button class="task-quick" data-task-quick="计划中" data-task-id="${t.id}">📋 待办</button>`);
      if (t.status !== '进行中') quickActions.push(`<button class="task-quick" data-task-quick="进行中" data-task-id="${t.id}">🔧 进行</button>`);
      if (t.status !== '已完成') quickActions.push(`<button class="task-quick task-quick-done" data-task-quick="已完成" data-task-id="${t.id}">✅ 完成</button>`);
      return `<div class="task-card" data-task-card="${t.id}">
        <div class="task-card-head">
          <div class="task-card-title">
            <span class="task-process-name">${escapeHtml(t.process || '-')}</span>
            <span class="task-status-display">${pill(t.status || '-', statusTone)}</span>
            <select class="task-status-input" style="display:none" data-field="status">
              ${statuses.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="task-card-actions">
            <button class="ghost" data-task-edit="${t.id}">✏️ 编辑</button>
          </div>
        </div>
        <div class="task-card-body">
          <div class="task-field">
            <span class="task-field-label">👤 负责人</span>
            <span class="task-field-value field-display" data-field="conservator">${escapeHtml(t.conservator || '-')}</span>
            <input class="task-field-value field-input" type="text" data-field="conservator" value="${escapeHtml(t.conservator || '')}" style="display:none">
          </div>
          <div class="task-field">
            <span class="task-field-label">📅 日期</span>
            <span class="task-field-value field-display" data-field="date">${escapeHtml(t.date || '-')}</span>
            <input class="task-field-value field-input" type="date" data-field="date" value="${escapeHtml(t.date || '')}" style="display:none">
          </div>
          <div class="task-field">
            <span class="task-field-label">🧪 材料说明</span>
            <span class="task-field-value field-display" data-field="materialUsed">${escapeHtml(t.materialUsed || '—')}</span>
            <textarea class="task-field-value field-input" data-field="materialUsed" rows="2" style="display:none">${escapeHtml(t.materialUsed || '')}</textarea>
          </div>
          <div class="task-field">
            <span class="task-field-label">📝 完成记录</span>
            <span class="task-field-value field-display" data-field="note">${escapeHtml(t.note || '—')}</span>
            <textarea class="task-field-value field-input" data-field="note" rows="2" style="display:none">${escapeHtml(t.note || '')}</textarea>
          </div>
        </div>
        <div class="task-quick-actions">${quickActions.join('')}</div>
        ${historyHtml(t)}
      </div>`;
    }).join('')}
  </div>`;
}

const TIMELINE_TYPE_ICONS = {
  '建档': '📜',
  '修补': '🔧',
  '借阅': '📖',
  '归还': '↩️',
  '状态变更': '🔄',
  '保护建议': '🛡️',
  '影像采集': '📷',
  '盘点': '📋',
  '人工观察': '👁️',
  '修补批次': '📦'
};

const TIMELINE_TYPE_TONES = {
  '建档': 'ok',
  '修补': 'warn',
  '借阅': 'warn',
  '归还': 'ok',
  '状态变更': '',
  '保护建议': 'obs',
  '影像采集': '',
  '盘点': '',
  '人工观察': 'obs',
  '修补批次': 'warn'
};

function timelineTypeBadge(type) {
  const icon = TIMELINE_TYPE_ICONS[type] || '📌';
  const tone = TIMELINE_TYPE_TONES[type] || '';
  return `<span class="timeline-type-badge ${tone}">${icon} ${escapeHtml(type)}</span>`;
}

async function openTimeline(scrollId) {
  state.timelineScrollId = scrollId;
  state.timelineFilter = '';
  try {
    state.timelineData = await api(`/api/scrolls/${encodeURIComponent(scrollId)}/timeline`);
  } catch (e) {
    state.timelineData = null;
    toast(e.message);
    return;
  }
  renderTimelineOverlay();
}

function closeTimeline() {
  state.timelineScrollId = null;
  state.timelineData = null;
  state.timelineFilter = '';
  const overlay = $('#timeline-overlay');
  if (overlay) overlay.remove();
}

function renderTimelineOverlay() {
  const existing = $('#timeline-overlay');
  if (existing) existing.remove();

  const data = state.timelineData;
  if (!data) return;

  const allTypes = [...new Set(data.events.map((e) => e.type))];
  const filterOptions = `<option value="">全部事件</option>${allTypes.map((t) => `<option value="${escapeHtml(t)}" ${state.timelineFilter === t ? 'selected' : ''}>${TIMELINE_TYPE_ICONS[t] || '📌'} ${escapeHtml(t)}</option>`).join('')}`;

  let filtered = data.events;
  if (state.timelineFilter) {
    filtered = filtered.filter((e) => e.type === state.timelineFilter);
  }

  const scroll = state.db.scrolls?.find((s) => s.id === data.scrollId);
  const scrollTitle = data.scrollTitle || scroll?.title || data.scrollId;
  const scrollStatus = data.scrollBorrowStatus || scroll?.borrowStatus || '';
  const scrollProtection = data.scrollProtectionLevel || scroll?.protectionLevel || '';
  const protectionAdvice = data.protectionAdvice || scroll?.protectionAdvice;
  const adviceHtml = renderProtectionAdvice(protectionAdvice);

  const eventListHtml = filtered.length
    ? filtered.map((ev) => `
      <div class="timeline-event" data-event-type="${escapeHtml(ev.type)}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-head">
            ${timelineTypeBadge(ev.type)}
            <span class="timeline-time">${fmtDate(ev.timestamp)}</span>
          </div>
          <div class="timeline-title">${escapeHtml(ev.title)}</div>
          ${ev.detail ? `<div class="timeline-detail">${escapeHtml(ev.detail)}</div>` : ''}
          <div class="timeline-source">来源：${escapeHtml(state.config.collections[ev.source]?.label || ev.source)}</div>
        </div>
      </div>
    `).join('')
    : '<div class="empty">暂无匹配的事件记录</div>';

  const overlay = document.createElement('div');
  overlay.id = 'timeline-overlay';
  overlay.className = 'timeline-overlay';
  overlay.innerHTML = `
    <div class="timeline-modal">
      <div class="timeline-modal-head">
        <div>
          <h3>📜 经卷生命周期时间轴</h3>
          <div class="timeline-scroll-info">
            <strong>${escapeHtml(scrollTitle)}</strong>
            ${scrollStatus ? pill(scrollStatus, toneFor(scrollStatus)) : ''}
            ${scrollProtection ? `<span class="timeline-protection">保护等级：${escapeHtml(scrollProtection)}</span>` : ''}
          </div>
        </div>
        <button class="modal-close" data-timeline-close>×</button>
      </div>
      ${adviceHtml}
      <div class="timeline-toolbar">
        <label>按类型筛选：<select id="timeline-filter">${filterOptions}</select></label>
        <span class="timeline-count">共 ${filtered.length} 条事件${state.timelineFilter ? '（已筛选）' : ''}</span>
      </div>
      <div class="timeline-body">
        <div class="timeline-line">
          ${eventListHtml}
        </div>
      </div>
      <div class="timeline-obs-form">
        <h4>📝 追加人工观察记录</h4>
        <form data-observation="${data.scrollId}">
          <div class="obs-form-grid">
            <label>观察人<input type="text" name="observer" required placeholder="填写观察人姓名"></label>
            <label>观察内容<textarea name="content" required placeholder="记录观察发现，不影响业务状态"></textarea></label>
          </div>
          <div class="actions"><button type="submit">追加观察记录</button></div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
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

  const actionsHtml = collection === 'loans' && isStrictRiskAssessment(item.riskAssessment)
    ? `<div class="actions">${state.config.actions
        .filter((action) => action.collection === collection)
        .map((action) => {
          const extraClass = (action.id === 'loan-approve' || action.id === 'loan-reject') ? ' strict-action' : '';
          return `<button class="${action.danger ? 'danger' : 'ghost'}${extraClass}" data-action="${action.id}" data-id="${item.id}" data-strict="true">${action.id === 'loan-approve' || action.id === 'loan-reject' ? '⚠️ ' : ''}${escapeHtml(action.label)}</button>`;
        })
        .join('')}</div>`
    : `<div class="actions">${actionButtons(item.id)}</div>`;

  const riskHtml = collection === 'loans' ? renderRiskPanel(item.riskAssessment) : '';

  const adviceHtml = collection === 'scrolls' ? renderProtectionAdvice(item.protectionAdvice) : '';

  const timelineBtn = collection === 'scrolls'
    ? `<button class="ghost" data-timeline="${item.id}">📜 时间轴</button>`
    : '';

  let batchProgressHtml = '';
  if (collection === 'repairBatches') {
    const summary = item.progressSummary || '0/0 已完成';
    const match = summary.match(/(\d+)\/(\d+)/);
    const done = match ? parseInt(match[1]) : 0;
    const total = match ? parseInt(match[2]) : 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    batchProgressHtml = `<div class="batch-progress">
      <div class="batch-progress-bar"><div class="batch-progress-fill" style="width:${pct}%"></div></div>
      <span class="batch-progress-text">${escapeHtml(summary)}</span>
    </div>
    <button class="ghost" data-batch-tasks="${item.id}">📋 查看任务</button>`;
  }

  return `<article class="card">
    <div class="card-head"><h3>${escapeHtml(title)}</h3>${statusValue ? pill(statusValue, toneFor(statusValue)) : ''}</div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${adviceHtml}
    ${batchProgressHtml}
    ${riskHtml}
    ${actionsHtml}
    ${timelineBtn ? `<div class="actions">${timelineBtn}</div>` : ''}
    ${historyHtml(item)}
    <div class="batch-tasks" id="batch-tasks-${item.id}" style="display:none"></div>
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

const FIELD_LABELS = {
  title: '卷名',
  material: '材质',
  era: '年代',
  damage: '残损',
  inscription: '题跋',
  cabinet: '柜位',
  protectionLevel: '保护等级',
  borrowStatus: '借阅状态'
};

function fieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

function renderBatchImportView(view) {
  const bi = state.batchImport;
  const preview = bi.previewData;

  let summaryHtml = '';
  let recognizedHtml = '';
  let duplicatesHtml = '';
  let missingHtml = '';
  let protectionHtml = '';
  let rowsHtml = '';
  let actionsHtml = '';

  if (preview) {
    const hasErrors = preview.invalidCount > 0;
    const okTone = preview.validCount > 0 ? 'ok' : '';
    const badTone = preview.invalidCount > 0 ? 'bad' : '';

    summaryHtml = `<div class="batch-summary">
      <div class="batch-summary-item"><span>总行数</span><strong>${preview.totalRows}</strong></div>
      <div class="batch-summary-item"><span>可导入</span><strong class="${okTone}">${preview.validCount}</strong></div>
      <div class="batch-summary-item"><span>有问题</span><strong class="${badTone}">${preview.invalidCount}</strong></div>
      <div class="batch-summary-item"><span>已勾选</span><strong>${bi.selectedRows.size}</strong></div>
    </div>`;

    const recognizedList = preview.fieldRecognition.recognized.map((r) =>
      `<span class="batch-field-ok">✅ ${escapeHtml(r.header)} → ${escapeHtml(fieldLabel(r.field))}</span>`
    ).join('');
    const unrecognizedList = preview.fieldRecognition.unrecognized.map((h) =>
      `<span class="batch-field-bad">⚠️ ${escapeHtml(h)}（无法识别）</span>`
    ).join('');
    const requiredStatus = preview.fieldRecognition.hasAllRequired
      ? `<span class="batch-field-ok">✅ 所有必填字段已识别</span>`
      : `<span class="batch-field-bad">⚠️ 缺少必填字段</span>`;
    recognizedHtml = `<div class="batch-field-list">
      <div class="batch-field-section-title">字段识别结果</div>
      ${recognizedList}
      ${unrecognizedList}
      ${requiredStatus}
    </div>`;

    if (preview.duplicateTitles.length > 0) {
      duplicatesHtml = `<div class="batch-issue-block">
        <div class="batch-issue-title">⚠️ 重复卷名（${preview.duplicateTitles.length}）</div>
        <div class="batch-issue-list">
          ${preview.duplicateTitles.map((d) => `
            <div class="batch-issue-item">
              <span class="batch-issue-name">${escapeHtml(d.title)}</span>
              <span class="batch-issue-tag ${d.inDb ? 'bad' : ''}">${d.inDb ? '数据库已存在' : ''}</span>
              <span class="batch-issue-tag ${d.inInput ? 'warn' : ''}">${d.inInput ? '导入数据重复' : ''}</span>
              <span class="batch-issue-rows">涉及行：${d.rows.join('、')}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
    }

    const missingEntries = Object.entries(preview.missingRequired);
    if (missingEntries.length > 0) {
      missingHtml = `<div class="batch-issue-block">
        <div class="batch-issue-title">⚠️ 缺失必填项</div>
        <div class="batch-issue-list">
          ${missingEntries.map(([field, rows]) => `
            <div class="batch-issue-item">
              <span class="batch-issue-name">${escapeHtml(fieldLabel(field))}</span>
              <span class="batch-issue-rows">涉及行：${rows.join('、')}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
    }

    if (preview.protectionAnomalies.length > 0) {
      protectionHtml = `<div class="batch-issue-block">
        <div class="batch-issue-title">⚠️ 保护等级异常</div>
        <div class="batch-issue-list">
          ${preview.protectionAnomalies.map((p) => `
            <div class="batch-issue-item">
              <span class="batch-issue-name">第${p.rowNumber}行</span>
              <span class="batch-issue-rows">无效值：${escapeHtml(p.value || '(空)')}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
    }

    rowsHtml = `<div class="batch-rows-wrap">
      <div class="batch-rows-toolbar">
        <label class="batch-checkbox-label">
          <input type="checkbox" id="batch-select-all" ${bi.selectedRows.size === preview.rows.length && preview.rows.length > 0 ? 'checked' : ''}>
          全选有效行
        </label>
        <span class="batch-rows-hint">提示：有错误的行无法勾选</span>
      </div>
      <div class="batch-rows-table">
        <div class="batch-row batch-row-head">
          <div class="batch-row-cell batch-row-check">选择</div>
          <div class="batch-row-cell batch-row-num">行号</div>
          <div class="batch-row-cell">卷名</div>
          <div class="batch-row-cell">材质</div>
          <div class="batch-row-cell">年代</div>
          <div class="batch-row-cell">柜位</div>
          <div class="batch-row-cell">残损</div>
          <div class="batch-row-cell">保护等级</div>
          <div class="batch-row-cell">借阅状态</div>
          <div class="batch-row-cell batch-row-status">状态</div>
        </div>
        ${preview.rows.map((row, idx) => {
          const d = row.data;
          const isSelected = bi.selectedRows.has(idx);
          const canSelect = row.isValid;
          const rowClass = row.isValid ? 'batch-row-valid' : 'batch-row-invalid';
          const statusHtml = row.isValid
            ? `<span class="pill ok">✓ 有效</span>`
            : row.errors.map((e) => `<span class="pill bad">${escapeHtml(e.message)}</span>`).join('');
          return `<div class="batch-row ${rowClass}" data-batch-row="${idx}">
            <div class="batch-row-cell batch-row-check">
              <input type="checkbox" ${canSelect ? '' : 'disabled'} ${isSelected ? 'checked' : ''} data-batch-row-check="${idx}">
            </div>
            <div class="batch-row-cell batch-row-num">${row.rowNumber}</div>
            <div class="batch-row-cell">${escapeHtml(d.title || '-')}</div>
            <div class="batch-row-cell">${escapeHtml(d.material || '-')}</div>
            <div class="batch-row-cell">${escapeHtml(d.era || '-')}</div>
            <div class="batch-row-cell">${escapeHtml(d.cabinet || '-')}</div>
            <div class="batch-row-cell">${escapeHtml(d.damage || '-')}</div>
            <div class="batch-row-cell">${escapeHtml(d.protectionLevel || '-')}</div>
            <div class="batch-row-cell">${escapeHtml(d.borrowStatus || '-')}</div>
            <div class="batch-row-cell batch-row-status">${statusHtml}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

    actionsHtml = `<div class="actions">
      <button class="ghost" id="batch-reset-btn">重新输入</button>
      <button id="batch-import-btn" ${bi.selectedRows.size === 0 || bi.importing ? 'disabled' : ''}>
        ${bi.importing ? '导入中...' : `确认导入（${bi.selectedRows.size}条）`}
      </button>
    </div>`;
  }

  const sampleText = `卷名,材质,年代,残损,题跋,柜位,保护等级,借阅状态
维摩诘经卷上,楮皮纸,唐代,首尾完整中部略有虫蛀,有贞观年款,恒湿柜A-01,一级,需审批
楞伽阿跋多罗宝经,宣纸,宋代,边缘轻微磨损,无,恒湿柜B-02,二级,可借阅`;

  return `<section class="view" id="${view.id}">
    <div class="panel">
      <h2>📥 批量导入预检 - 经卷档案</h2>
      <p class="batch-hint">将CSV文本粘贴到下方文本框，点击"解析预检"进行校验。支持逗号、Tab、分号分隔。</p>

      ${!preview ? `<div class="batch-sample">
        <div class="batch-sample-title">📋 CSV格式参考：</div>
        <pre class="batch-sample-text">${escapeHtml(sampleText)}</pre>
        <button class="ghost" id="batch-fill-sample">填充示例</button>
      </div>` : ''}

      <label>CSV文本
        <textarea id="batch-csv-input" rows="8" placeholder="在此粘贴CSV文本，第一行为表头..." ${preview ? 'disabled' : ''}>${escapeHtml(bi.csvText)}</textarea>
      </label>

      ${!preview ? `<div class="actions">
        <button id="batch-preview-btn">🔍 解析预检</button>
      </div>` : ''}

      ${summaryHtml}
      ${recognizedHtml}
      ${duplicatesHtml}
      ${missingHtml}
      ${protectionHtml}
      ${rowsHtml}
      ${actionsHtml}
    </div>
  </section>`;
}

function getVisibleViews() {
  const allViews = state.config.views || [];
  if (state.currentRole === 'admin') return allViews;
  return allViews.filter((view) => {
    if (view.type === 'audit') return false;
    return true;
  });
}

function render() {
  $('#title').textContent = state.config.title;
  document.title = state.config.title;
  $('#lede').textContent = state.config.lede;

  const visibleViews = getVisibleViews();
  const tabsHtml = visibleViews.map((view, index) => `
    <button class="tab${index === 0 ? ' active' : ''}" data-tab="${view.id}">${escapeHtml(view.label)}</button>
  `).join('');
  $('#tabs').innerHTML = tabsHtml;

  $('#main').innerHTML = visibleViews.map((view) => {
    if (view.type === 'dashboard') return renderDashboardView(view);
    if (view.type === 'calendar') return renderCalendarView(view);
    if (view.type === 'batchImport') return renderBatchImportView(view);
    if (view.type === 'consistencyCheck') return renderConsistencyCheckView(view);
    if (view.type === 'audit') return renderAuditView(view);
    return renderCrudView(view);
  }).join('');

  if (!visibleViews.find((v) => v.id === state.activeTab)) {
    state.activeTab = visibleViews[0]?.id || '';
  }
  setTab(state.activeTab || visibleViews[0]?.id || '');
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
  const timelineBtn = event.target.closest('[data-timeline]');
  const timelineClose = event.target.closest('[data-timeline-close]');
  const batchTasksBtn = event.target.closest('[data-batch-tasks]');

  const batchPreviewBtn = event.target.closest('#batch-preview-btn');
  const batchResetBtn = event.target.closest('#batch-reset-btn');
  const batchImportBtn = event.target.closest('#batch-import-btn');
  const batchFillSampleBtn = event.target.closest('#batch-fill-sample');
  const batchSelectAll = event.target.closest('#batch-select-all');
  const batchRowCheck = event.target.closest('[data-batch-row-check]');

  if (batchFillSampleBtn) {
    const sample = `卷名,材质,年代,残损,题跋,柜位,保护等级,借阅状态
维摩诘经卷上,楮皮纸,唐代,首尾完整中部略有虫蛀,有贞观年款,恒湿柜A-01,一级,需审批
楞伽阿跋多罗宝经,宣纸,宋代,边缘轻微磨损,无,恒湿柜B-02,二级,可借阅
妙法莲华经卷第七,麻纸,元代,无明显残损,尾题完整,恒湿柜C-03,三级,可借阅`;
    const input = $('#batch-csv-input');
    if (input) input.value = sample;
    return;
  }

  if (batchPreviewBtn) {
    const input = $('#batch-csv-input');
    const csvText = input?.value || '';
    if (!csvText.trim()) {
      toast('请输入CSV文本');
      return;
    }
    state.batchImport.csvText = csvText;
    try {
      const preview = await api('/api/scrolls/batch/preview', {
        method: 'POST',
        body: JSON.stringify({ csvText })
      });
      state.batchImport.previewData = preview;
      state.batchImport.selectedRows = new Set();
      preview.rows.forEach((row, idx) => {
        if (row.isValid) state.batchImport.selectedRows.add(idx);
      });
      render();
      setTab('batch-import');
      toast(`解析完成：共${preview.totalRows}行，${preview.validCount}行有效`);
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  if (batchResetBtn) {
    state.batchImport = {
      csvText: '',
      previewData: null,
      selectedRows: new Set(),
      importing: false
    };
    render();
    setTab('batch-import');
    return;
  }

  if (batchImportBtn) {
    const bi = state.batchImport;
    if (!bi.previewData || bi.selectedRows.size === 0) {
      toast('请先选择要导入的行');
      return;
    }
    bi.importing = true;
    render();
    setTab('batch-import');
    try {
      const result = await api('/api/scrolls/batch/import', {
        method: 'POST',
        body: JSON.stringify({
          csvText: bi.csvText,
          importRows: [...bi.selectedRows]
        })
      });
      bi.importing = false;
      bi.previewData = null;
      bi.csvText = '';
      bi.selectedRows = new Set();
      await load();
      toast(`成功导入${result.importedCount}条经卷档案`);
    } catch (e) {
      bi.importing = false;
      render();
      setTab('batch-import');
      toast(e.message);
    }
    return;
  }

  if (batchSelectAll) {
    const preview = state.batchImport.previewData;
    if (!preview) return;
    if (batchSelectAll.checked) {
      preview.rows.forEach((row, idx) => {
        if (row.isValid) state.batchImport.selectedRows.add(idx);
      });
    } else {
      state.batchImport.selectedRows.clear();
    }
    render();
    setTab('batch-import');
    return;
  }

  if (batchRowCheck) {
    const idx = Number(batchRowCheck.dataset.batchRowCheck);
    if (isNaN(idx)) return;
    if (batchRowCheck.checked) {
      state.batchImport.selectedRows.add(idx);
    } else {
      state.batchImport.selectedRows.delete(idx);
    }
    render();
    setTab('batch-import');
    return;
  }

  if (tab) setTab(tab.dataset.tab);

  if (batchTasksBtn) {
    const batchId = batchTasksBtn.dataset.batchTasks;
    const tasksEl = $(`#batch-tasks-${batchId}`);
    if (!tasksEl) return;
    if (tasksEl.style.display !== 'none' && tasksEl.innerHTML) {
      tasksEl.style.display = 'none';
      return;
    }
    try {
      const tasks = await api(`/api/repair-batches/${encodeURIComponent(batchId)}/tasks`);
      if (tasks.length) {
        tasksEl.innerHTML = renderBatchTasksDetail(tasks);
      } else {
        tasksEl.innerHTML = '<div class="empty">暂无任务</div>';
      }
      tasksEl.style.display = 'block';
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  const taskEditBtn = event.target.closest('[data-task-edit]');
  if (taskEditBtn) {
    const taskId = taskEditBtn.dataset.taskEdit;
    const card = document.querySelector(`[data-task-card="${taskId}"]`);
    if (!card) return;
    const fields = ['conservator', 'materialUsed', 'note', 'date'];
    fields.forEach((f) => {
      const display = card.querySelector(`[data-field="${f}"].field-display`);
      const input = card.querySelector(`[data-field="${f}"].field-input`);
      if (display) display.style.display = 'none';
      if (input) input.style.display = '';
    });
    const statusDisplay = card.querySelector('.task-status-display');
    const statusSelect = card.querySelector('.task-status-input');
    if (statusDisplay) statusDisplay.style.display = 'none';
    if (statusSelect) statusSelect.style.display = '';
    const actions = card.querySelector('.task-card-actions');
    if (actions) actions.innerHTML = `
      <button class="ghost" data-task-save="${taskId}">💾 保存</button>
      <button class="ghost secondary" data-task-cancel="${taskId}">取消</button>
    `;
    return;
  }

  const taskCancelBtn = event.target.closest('[data-task-cancel]');
  if (taskCancelBtn) {
    const taskId = taskCancelBtn.dataset.taskCancel;
    const task = (state.db.repairs || []).find((r) => r.id === taskId);
    const card = document.querySelector(`[data-task-card="${taskId}"]`);
    if (!task || !card) return;
    const conservatorDisplay = card.querySelector('[data-field="conservator"].field-display');
    const conservatorInput = card.querySelector('[data-field="conservator"].field-input');
    if (conservatorDisplay) { conservatorDisplay.textContent = task.conservator || '-'; conservatorDisplay.style.display = ''; }
    if (conservatorInput) { conservatorInput.value = task.conservator || ''; conservatorInput.style.display = 'none'; }

    const materialDisplay = card.querySelector('[data-field="materialUsed"].field-display');
    const materialInput = card.querySelector('[data-field="materialUsed"].field-input');
    if (materialDisplay) { materialDisplay.textContent = task.materialUsed || '—'; materialDisplay.style.display = ''; }
    if (materialInput) { materialInput.value = task.materialUsed || ''; materialInput.style.display = 'none'; }

    const noteDisplay = card.querySelector('[data-field="note"].field-display');
    const noteInput = card.querySelector('[data-field="note"].field-input');
    if (noteDisplay) { noteDisplay.textContent = task.note || '—'; noteDisplay.style.display = ''; }
    if (noteInput) { noteInput.value = task.note || ''; noteInput.style.display = 'none'; }

    const dateDisplay = card.querySelector('[data-field="date"].field-display');
    const dateInput = card.querySelector('[data-field="date"].field-input');
    if (dateDisplay) { dateDisplay.textContent = task.date || '-'; dateDisplay.style.display = ''; }
    if (dateInput) { dateInput.value = task.date || ''; dateInput.style.display = 'none'; }

    const statusDisplay = card.querySelector('.task-status-display');
    const statusSelect = card.querySelector('.task-status-input');
    if (statusDisplay) statusDisplay.style.display = '';
    if (statusSelect) { statusSelect.value = task.status || '计划中'; statusSelect.style.display = 'none'; }

    const actions = card.querySelector('.task-card-actions');
    if (actions) actions.innerHTML = `<button class="ghost" data-task-edit="${taskId}">✏️ 编辑</button>`;
    return;
  }

  const taskSaveBtn = event.target.closest('[data-task-save]');
  if (taskSaveBtn) {
    const taskId = taskSaveBtn.dataset.taskSave;
    const card = document.querySelector(`[data-task-card="${taskId}"]`);
    if (!card) return;
    const conservator = card.querySelector('[data-field="conservator"].field-input')?.value.trim();
    const materialUsed = card.querySelector('[data-field="materialUsed"].field-input')?.value.trim();
    const note = card.querySelector('[data-field="note"].field-input')?.value.trim();
    const date = card.querySelector('[data-field="date"].field-input')?.value.trim();
    const status = card.querySelector('.task-status-input')?.value;
    try {
      await api(`/api/repairs/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ conservator, materialUsed, note, date, status, historyAction: '更新' })
      });
      await load();
      toast('工序已更新');
      const batchId = (state.db.repairs || []).find((r) => r.id === taskId)?.batchId;
      if (batchId) {
        const tasksEl = document.getElementById(`batch-tasks-${batchId}`);
        const tasks = await api(`/api/repair-batches/${encodeURIComponent(batchId)}/tasks`);
        if (tasksEl && tasks.length) {
          tasksEl.innerHTML = renderBatchTasksDetail(tasks);
          tasksEl.style.display = 'block';
        }
      }
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  const taskQuickAction = event.target.closest('[data-task-quick]');
  if (taskQuickAction) {
    const taskId = taskQuickAction.dataset.taskId;
    const newStatus = taskQuickAction.dataset.taskQuick;
    try {
      await api(`/api/repairs/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, historyAction: `状态变更为${newStatus}` })
      });
      await load();
      toast(`已标记为${newStatus}`);
      const batchId = (state.db.repairs || []).find((r) => r.id === taskId)?.batchId;
      if (batchId) {
        const tasksEl = document.getElementById(`batch-tasks-${batchId}`);
        const tasks = await api(`/api/repair-batches/${encodeURIComponent(batchId)}/tasks`);
        if (tasksEl && tasks.length) {
          tasksEl.innerHTML = renderBatchTasksDetail(tasks);
          tasksEl.style.display = 'block';
        }
      }
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  if (timelineBtn) {
    await openTimeline(timelineBtn.dataset.timeline);
    return;
  }

  if (timelineClose) {
    closeTimeline();
    return;
  }

  const overlay = $('#timeline-overlay');
  if (overlay && event.target === overlay) {
    closeTimeline();
    return;
  }

  if (action) {
    const actionId = action.dataset.action;
    const itemId = action.dataset.id;
    const actionConfig = state.config.actions.find((a) => a.id === actionId);
    const item = state.db[actionConfig?.collection]?.find((i) => i.id === itemId);

    if (actionConfig?.collection === 'loans' &&
        (actionId === 'loan-approve' || actionId === 'loan-reject') &&
        isStrictRiskAssessment(item?.riskAssessment)) {
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

  if (event.target.id === 'timeline-filter') {
    state.timelineFilter = event.target.value;
    renderTimelineOverlay();
    return;
  }

  if (event.target.id === 'calendar-scroll-filter') {
    state.selectedScrollId = event.target.value;
    render();
    return;
  }

  if (event.target.id === 'cc-filter') {
    state.consistencyCheck.filter = event.target.value;
    render();
    setTab('consistency-check');
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

  const batchForm = event.target.closest('[data-create="repairBatches"]');
  if (batchForm) {
    const templateId = batchForm.querySelector('[name="templateId"]')?.value;
    const previewEl = batchForm.querySelector('.template-preview');
    if (templateId) {
      const template = (state.db.repairTemplates || []).find((t) => t.id === templateId);
      if (template) {
        const processList = (template.processes || '').split('\n').map((p) => p.trim()).filter(Boolean);
        const previewHtml = `<div class="template-preview">
          <div class="template-preview-title">📋 模板工序预览（共${processList.length}道）</div>
          <div class="template-processes">${processList.map((p) => `<span class="template-process-tag">${escapeHtml(p)}</span>`).join('')}</div>
          ${template.description ? `<div class="template-desc">${escapeHtml(template.description)}</div>` : ''}
        </div>`;
        if (previewEl) {
          previewEl.outerHTML = previewHtml;
        } else {
          const actionsDiv = batchForm.querySelector('.actions');
          actionsDiv.insertAdjacentHTML('beforebegin', previewHtml);
        }
      }
    } else {
      if (previewEl) previewEl.remove();
    }
  }
});

document.addEventListener('submit', async (event) => {
  const obsForm = event.target.closest('[data-observation]');
  if (obsForm) {
    event.preventDefault();
    const scrollId = obsForm.dataset.observation;
    const observer = obsForm.querySelector('[name="observer"]')?.value.trim();
    const content = obsForm.querySelector('[name="content"]')?.value.trim();
    if (!observer || !content) {
      toast('观察人和观察内容不能为空');
      return;
    }
    try {
      await api(`/api/scrolls/${encodeURIComponent(scrollId)}/observation`, {
        method: 'POST',
        body: JSON.stringify({ observer, content })
      });
      toast('观察记录已追加');
      await openTimeline(scrollId);
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  const form = event.target.closest('[data-create]');
  if (!form) return;
  event.preventDefault();
  const view = state.config.views.find((entry) => entry.id === form.dataset.view);
  try {
    const result = await api(`/api/${form.dataset.create}`, { method: 'POST', body: JSON.stringify(values(form, view)) });
    form.reset();
    state.conflictCheck = { scrollId: '', borrowDate: '', dueDate: '', conflicts: [] };
    state.riskPreview = null;
    await load();
    if (form.dataset.create === 'repairBatches' && result && result.batch) {
      const count = result.repairs ? result.repairs.length : 0;
      toast(`已生成修补方案，共${count}道工序`);
    } else {
      toast('已保存');
    }
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

async function loadRoles() {
  try {
    const result = await api('/api/roles');
    state.roles = result.roles;
    state.currentRole = result.currentRole;
    state.currentRoleName = result.currentRoleName;
    state.currentUser = result.currentUser;
  } catch (e) {
    console.warn('加载角色信息失败', e);
  }
}

async function switchRole(roleId) {
  const role = state.roles.find((r) => r.id === roleId);
  if (!role) return;
  state.currentRole = roleId;
  state.currentRoleName = role.name;
  renderRoleBadge();
  if (roleId === 'admin') {
    await loadAuditLogs();
  }
  await load();
  toast(`已切换为「${role.name}」身份`);
}

function renderRoleBadge() {
  const badge = $('#role-badge');
  if (!badge) return;
  const role = state.roles.find((r) => r.id === state.currentRole);
  badge.innerHTML = `
    <span class="role-icon">👤</span>
    <span class="role-name">${escapeHtml(state.currentRoleName)}</span>
    <span class="role-arrow">▼</span>
  `;
}

function renderRoleSelector() {
  const existing = $('#role-selector');
  if (existing) existing.remove();

  const selector = document.createElement('div');
  selector.id = 'role-selector';
  selector.className = 'role-selector';
  selector.innerHTML = `
    <div class="role-selector-head">
      <h4>切换身份</h4>
      <button class="modal-close" data-role-close>×</button>
    </div>
    <div class="role-selector-body">
      <p class="role-selector-hint">选择不同身份体验不同权限</p>
      <div class="role-list">
        ${state.roles.map((role) => `
          <div class="role-item ${role.id === state.currentRole ? 'active' : ''}" data-role="${role.id}">
            <div class="role-item-head">
              <span class="role-item-name">${escapeHtml(role.name)}</span>
              ${role.id === state.currentRole ? '<span class="role-item-current">当前</span>' : ''}
            </div>
            <div class="role-item-desc">${escapeHtml(role.description)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(selector);

  selector.addEventListener('click', (e) => {
    if (e.target.closest('[data-role-close]') || e.target === selector) {
      selector.remove();
      return;
    }
    const roleItem = e.target.closest('[data-role]');
    if (roleItem) {
      const roleId = roleItem.dataset.role;
      switchRole(roleId);
      selector.remove();
    }
  });
}

async function loadAuditLogs() {
  if (state.currentRole !== 'admin') return;
  try {
    const { operator, collection, startTime, endTime } = state.auditLogs.filters;
    const params = new URLSearchParams({
      page: state.auditLogs.page,
      pageSize: state.auditLogs.pageSize
    });
    if (operator) params.set('operator', operator);
    if (collection) params.set('collection', collection);
    if (startTime) params.set('startTime', startTime);
    if (endTime) params.set('endTime', endTime);

    const result = await api(`/api/audits?${params.toString()}`);
    state.auditLogs.items = result.items;
    state.auditLogs.total = result.total;
  } catch (e) {
    toast(e.message);
  }
}

async function loadConsistencyCheck() {
  state.consistencyCheck.loading = true;
  try {
    const result = await api('/api/consistency-check');
    state.consistencyCheck.issues = result.issues;
    state.consistencyCheck.summary = result.summary;
    state.consistencyCheck.checkedAt = result.checkedAt;
  } catch (e) {
    state.consistencyCheck.issues = [];
    state.consistencyCheck.summary = null;
    toast(e.message);
  }
  state.consistencyCheck.loading = false;
}

function renderConsistencyCheckView(view) {
  const cc = state.consistencyCheck;
  const hasData = cc.summary !== null;

  let summaryHtml = '';
  if (hasData) {
    const s = cc.summary;
    const totalTone = s.total > 0 ? 'bad' : 'ok';
    summaryHtml = `<div class="cc-summary">
      <div class="cc-summary-item cc-total ${totalTone}"><span>问题总数</span><strong>${s.total}</strong></div>
      <div class="cc-summary-item cc-severity-high"><span>高危</span><strong>${s.high}</strong></div>
      <div class="cc-summary-item cc-severity-medium"><span>中等</span><strong>${s.medium}</strong></div>
      <div class="cc-summary-item cc-severity-low"><span>低危</span><strong>${s.low}</strong></div>
      <div class="cc-summary-item cc-fixable"><span>可修复</span><strong>${s.autoFixable}</strong></div>
    </div>`;
  }

  const checkedAtHtml = cc.checkedAt
    ? `<div class="cc-checked-at">上次巡检时间：${fmtDate(cc.checkedAt)}</div>`
    : '';

  const filterOptions = [
    { value: '', label: '全部问题' },
    { value: 'high', label: '高危' },
    { value: 'medium', label: '中等' },
    { value: 'low', label: '低危' }
  ];

  const typeLabels = {
    'available-but-lent': '可借阅但有借出',
    'repairing-but-borrowable': '修补中可借出',
    'returned-but-restricted': '归还后仍限制',
    'repaired-no-history': '修补完成缺记录',
    'repairing-no-records': '修补中无记录',
    'lent-but-not-restricted': '已借出未限制',
    'level1-but-available': '一级保护可借阅'
  };
  const uniqueTypes = [...new Set(cc.issues.map((i) => i.type))];
  for (const t of uniqueTypes) {
    if (!filterOptions.find((o) => o.value === t)) {
      filterOptions.push({ value: t, label: typeLabels[t] || t });
    }
  }

  const filterSelectHtml = `<select id="cc-filter">
    ${filterOptions.map((opt) => `<option value="${escapeHtml(opt.value)}" ${cc.filter === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
  </select>`;

  let filteredIssues = cc.issues;
  if (cc.filter === 'high' || cc.filter === 'medium' || cc.filter === 'low') {
    filteredIssues = filteredIssues.filter((i) => i.severity === cc.filter);
  } else if (cc.filter) {
    filteredIssues = filteredIssues.filter((i) => i.type === cc.filter);
  }

  const severityIcons = { high: '🔴', medium: '🟡', low: '🟢' };
  const severityLabels = { high: '高危', medium: '中等', low: '低危' };

  const issueListHtml = hasData
    ? (filteredIssues.length
      ? filteredIssues.map((issue) => {
        const isFixing = cc.fixing[issue.id];
        const icon = severityIcons[issue.severity] || '⚪';
        const severityLabel = severityLabels[issue.severity] || issue.severity;
        const severityClass = `cc-severity-${issue.severity}`;

        const affectedLoansHtml = issue.affectedLoans.length
          ? `<div class="cc-affected"><span class="cc-affected-label">影响借阅：</span>${issue.affectedLoans.length}条记录</div>`
          : '';
        const affectedRepairsHtml = issue.affectedRepairs.length
          ? `<div class="cc-affected"><span class="cc-affected-label">影响修补：</span>${issue.affectedRepairs.length}条记录</div>`
          : '';

        const fixBtnHtml = issue.autoFixable
          ? `<button class="cc-fix-btn" data-cc-fix-issue="${issue.id}" data-cc-fix-suggestion="${issue.suggestion}" ${isFixing ? 'disabled' : ''}>
              ${isFixing ? '修复中...' : '🔧 执行修复'}
            </button>`
          : '<span class="cc-no-fix">需手动处理</span>';

        return `<div class="cc-issue ${severityClass}">
          <div class="cc-issue-head">
            <span class="cc-severity-badge ${severityClass}">${icon} ${severityLabel}</span>
            <span class="cc-issue-title">${escapeHtml(issue.title)}</span>
          </div>
          <div class="cc-issue-desc">${escapeHtml(issue.description)}</div>
          <div class="cc-issue-meta">
            <div class="cc-scroll-info">
              <span class="cc-affected-label">经卷：</span>
              <strong>${escapeHtml(issue.scrollTitle)}</strong>
              ${pill(issue.currentBorrowStatus, toneFor(issue.currentBorrowStatus))}
            </div>
            ${affectedLoansHtml}
            ${affectedRepairsHtml}
          </div>
          <div class="cc-issue-actions">
            <div class="cc-suggestion">💡 建议：${escapeHtml(issue.suggestionLabel)}</div>
            ${fixBtnHtml}
          </div>
        </div>`;
      }).join('')
      : '<div class="empty">✅ 未检测到状态一致性问题</div>')
    : '<div class="empty">点击「开始巡检」扫描经卷状态一致性问题</div>';

  return `<section class="view" id="${view.id}">
    <div class="panel">
      <h2>🔍 经卷状态一致性巡检</h2>
      <p class="cc-hint">自动扫描经卷档案、修补记录、借阅记录之间的矛盾状态，发现问题并提供安全修复建议</p>
      <div class="cc-toolbar">
        <button id="cc-run-btn" ${cc.loading ? 'disabled' : ''}>${cc.loading ? '巡检中...' : '🔍 开始巡检'}</button>
        ${filterSelectHtml}
      </div>
      ${checkedAtHtml}
      ${summaryHtml}
      <div class="cc-issue-list">${issueListHtml}</div>
    </div>
  </section>`;
}

function renderAuditView(view) {
  const logs = state.auditLogs.items;
  const total = state.auditLogs.total;
  const f = state.auditLogs.filters;

  const collectionOptions = [
    { value: '', label: '全部类型' },
    { value: 'scrolls', label: '经卷档案' },
    { value: 'repairs', label: '修补记录' },
    { value: 'loans', label: '借阅申请' },
    { value: 'imagings', label: '影像采集' },
    { value: 'inventories', label: '柜位盘点' },
    { value: 'materials', label: '修补材料' },
    { value: 'observations', label: '人工观察' },
    { value: 'repairTemplates', label: '修补模板' },
    { value: 'repairBatches', label: '修补批次' }
  ];

  const actionLabels = {
    create: '新增',
    update: '修改',
    delete: '删除',
    statusChange: '状态变更',
    historyAppend: '补充历史',
    approve: '批准',
    reject: '拒绝',
    lend: '借出',
    return: '归还'
  };

  const actionTones = {
    create: 'ok',
    update: 'warn',
    delete: 'bad',
    statusChange: 'warn',
    historyAppend: 'ok',
    approve: 'ok',
    reject: 'bad',
    lend: 'warn',
    return: 'ok'
  };

  const logListHtml = logs.length
    ? logs.map((log) => `
        <div class="audit-item">
          <div class="audit-item-head">
            <span class="audit-collection">${escapeHtml(log.collectionLabel)}</span>
            ${pill(actionLabels[log.action] || log.action, actionTones[log.action] || '')}
            <span class="audit-time">${fmtDate(log.timestamp)}</span>
          </div>
          <div class="audit-item-body">
            <div class="audit-item-title">${escapeHtml(log.itemTitle || log.itemId || '-')}</div>
            <div class="audit-item-meta">
              <span>操作者：<strong>${escapeHtml(log.operator)}</strong></span>
              <span>（${escapeHtml(log.operatorRoleName)}）</span>
            </div>
            ${log.note ? `<div class="audit-item-note">${escapeHtml(log.note)}</div>` : ''}
            ${log.changes ? `
              <details class="audit-changes">
                <summary>查看变更详情</summary>
                <pre>${escapeHtml(JSON.stringify(log.changes, null, 2))}</pre>
              </details>
            ` : ''}
          </div>
        </div>
      `).join('')
    : '<div class="empty">暂无审计日志</div>';

  const totalPages = Math.ceil(total / state.auditLogs.pageSize);
  const paginationHtml = total > state.auditLogs.pageSize ? `
    <div class="audit-pagination">
      <button class="ghost" ${state.auditLogs.page <= 1 ? 'disabled' : ''} data-audit-prev>上一页</button>
      <span>第 ${state.auditLogs.page} / ${totalPages} 页，共 ${total} 条</span>
      <button class="ghost" ${state.auditLogs.page >= totalPages ? 'disabled' : ''} data-audit-next>下一页</button>
    </div>
  ` : '';

  return `<section class="view" id="${view.id}">
    <div class="panel">
      <h2>📋 操作审计日志</h2>
      <p class="audit-hint">记录所有关键操作，可按操作者、类型和时间筛选</p>
      <div class="audit-filters">
        <label>操作者
          <input type="text" id="audit-filter-operator" value="${escapeHtml(f.operator)}" placeholder="搜索操作者姓名">
        </label>
        <label>操作类型
          <select id="audit-filter-collection">
            ${collectionOptions.map((opt) => `<option value="${opt.value}" ${f.collection === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
          </select>
        </label>
        <label>开始时间
          <input type="date" id="audit-filter-start" value="${escapeHtml(f.startTime)}">
        </label>
        <label>结束时间
          <input type="date" id="audit-filter-end" value="${escapeHtml(f.endTime)}">
        </label>
        <button id="audit-filter-btn">筛选</button>
        <button class="ghost" id="audit-reset-btn">重置</button>
      </div>
      <div class="audit-list">${logListHtml}</div>
      ${paginationHtml}
    </div>
  </section>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#role-badge')) {
    renderRoleSelector();
  }
  if (e.target.closest('#cc-run-btn')) {
    loadConsistencyCheck().then(() => {
      render();
      if (state.consistencyCheck.summary) {
        const s = state.consistencyCheck.summary;
        toast(`巡检完成：发现${s.total}个问题（高危${s.high}，中等${s.medium}，低危${s.low}）`);
      }
    });
  }
  const ccFixBtn = e.target.closest('[data-cc-fix-issue]');
  if (ccFixBtn) {
    const issueId = ccFixBtn.dataset.ccFixIssue;
    const fixSuggestion = ccFixBtn.dataset.ccFixSuggestion;
    if (!issueId || !fixSuggestion) return;

    const issue = state.consistencyCheck.issues.find((i) => i.id === issueId);
    if (!issue) return;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'cc-fix-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h3>🔧 确认执行修复</h3>
          <button class="modal-close" data-modal-close>×</button>
        </div>
        <div class="modal-body">
          <div class="modal-warn-icon">⚠️</div>
          <div class="modal-warning-text">此操作将修改经卷借阅状态，修复动作经过服务端二次校验并写入审计日志</div>
          <div class="modal-info-grid">
            <div class="modal-info-row"><span class="label">问题类型</span><span>${escapeHtml(issue.title)}</span></div>
            <div class="modal-info-row"><span class="label">经卷名称</span><span><strong>${escapeHtml(issue.scrollTitle)}</strong></span></div>
            <div class="modal-info-row"><span class="label">当前状态</span><span>${pill(issue.currentBorrowStatus, toneFor(issue.currentBorrowStatus))}</span></div>
            <div class="modal-info-row"><span class="label">修复动作</span><span style="color:var(--accent);font-weight:700">${escapeHtml(issue.suggestionLabel)}</span></div>
          </div>
          <div style="margin-top:14px">
            <label style="color:var(--muted);font-size:13px;font-weight:700">修复说明（选填）：
              <textarea class="modal-confirm-textarea" id="cc-fix-note" placeholder="可补充修复原因或备注..."></textarea>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button class="ghost" data-modal-close>取消</button>
          <button id="cc-fix-confirm-btn">确认修复</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => {
      modal.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);

    modal.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-modal-close]') || ev.target === modal) {
        closeModal();
        return;
      }
      if (ev.target.id === 'cc-fix-confirm-btn') {
        const fixNote = $('#cc-fix-note', modal)?.value || '';
        closeModal();
        state.consistencyCheck.fixing[issueId] = true;
        render();
        setTab('consistency-check');

        api('/api/consistency-check/fix', {
          method: 'POST',
          body: JSON.stringify({ issueId, fixSuggestion, note: fixNote })
        }).then((result) => {
          delete state.consistencyCheck.fixing[issueId];
          toast(`修复成功：${result.scrollTitle} 状态从「${result.oldBorrowStatus}」修正为「${result.newBorrowStatus}」`);
          loadConsistencyCheck().then(() => {
            load();
            render();
            setTab('consistency-check');
          });
        }).catch((err) => {
          delete state.consistencyCheck.fixing[issueId];
          toast(`修复失败：${err.message}`);
          render();
          setTab('consistency-check');
        });
      }
    });
  }
  if (e.target.closest('#audit-filter-btn')) {
    state.auditLogs.filters.operator = $('#audit-filter-operator')?.value || '';
    state.auditLogs.filters.collection = $('#audit-filter-collection')?.value || '';
    state.auditLogs.filters.startTime = $('#audit-filter-start')?.value || '';
    state.auditLogs.filters.endTime = $('#audit-filter-end')?.value || '';
    state.auditLogs.page = 1;
    loadAuditLogs().then(() => render());
  }
  if (e.target.closest('#audit-reset-btn')) {
    state.auditLogs.filters = { operator: '', collection: '', startTime: '', endTime: '' };
    state.auditLogs.page = 1;
    loadAuditLogs().then(() => render());
  }
  if (e.target.closest('[data-audit-prev]')) {
    if (state.auditLogs.page > 1) {
      state.auditLogs.page--;
      loadAuditLogs().then(() => render());
    }
  }
  if (e.target.closest('[data-audit-next]')) {
    const totalPages = Math.ceil(state.auditLogs.total / state.auditLogs.pageSize);
    if (state.auditLogs.page < totalPages) {
      state.auditLogs.page++;
      loadAuditLogs().then(() => render());
    }
  }
});

async function boot() {
  await loadRoles();
  state.config = await api('/api/config');
  renderRoleBadge();
  if (state.currentRole === 'admin') {
    await loadAuditLogs();
  }
  await load();
}

boot().catch((error) => toast(error.message));
