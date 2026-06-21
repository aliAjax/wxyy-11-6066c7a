const state = {
  config: null,
  db: {},
  activeTab: '',
  calendarData: [],
  calendarMonth: new Date(),
  selectedScrollId: '',
  calendarStatusFilter: '',
  calendarRiskFilter: '',
  conflictCheck: { scrollId: '', borrowDate: '', dueDate: '', conflicts: [] },
  riskPreview: null,
  timelineScrollId: null,
  timelineData: null,
  timelineFilter: '',
  timelineHasAttachmentFilter: '',
  batchImport: {
    csvText: '',
    previewData: null,
    selectedRows: new Set(),
    importing: false,
    draftMode: false
  },
  consistencyCheck: {
    issues: [],
    summary: null,
    checkedAt: null,
    loading: false,
    fixing: {},
    filter: '',
    selectedIssueIds: new Set(),
    plan: null,
    planLoading: false,
    batchExecuting: false,
    batchResult: null
  },
  drafts: {
    items: [],
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

function reservationMatchesFilters(res) {
  if (state.calendarStatusFilter && res.status !== state.calendarStatusFilter) return false;
  if (state.calendarRiskFilter) {
    const riskLevel = res.riskAssessment?.level || '低风险';
    if (riskLevel !== state.calendarRiskFilter) return false;
  }
  return true;
}

function getReservationsForDate(dateStr, scrollId = null) {
  const result = [];
  for (const entry of state.calendarData) {
    if (scrollId && entry.scrollId !== scrollId) continue;
    for (const res of entry.reservations) {
      if (!dateOverlap(dateStr, dateStr, res.borrowDate, res.dueDate)) continue;
      if (!reservationMatchesFilters(res)) continue;
      result.push({ ...res, scrollId: entry.scrollId, scrollTitle: entry.title });
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

async function previewBorrowability(scrollId, borrowDate, dueDate) {
  if (!scrollId) {
    state.borrowabilityPreview = null;
    return null;
  }
  try {
    let url = `/api/scrolls/${encodeURIComponent(scrollId)}/borrowability`;
    const params = [];
    if (borrowDate) params.push(`borrowDate=${encodeURIComponent(borrowDate)}`);
    if (dueDate) params.push(`dueDate=${encodeURIComponent(dueDate)}`);
    if (params.length > 0) url += '?' + params.join('&');
    
    const result = await api(url);
    state.borrowabilityPreview = result;
    return result;
  } catch (e) {
    state.borrowabilityPreview = null;
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

const DEFAULT_MATERIAL_LOW_STOCK = { '张': 20, '瓶': 3, '套': 3, '把': 2, '袋': 5, '米': 10, '卷': 5, '盒': 2, '个': 5 };
const DEFAULT_EXPIRY_WARN_DAYS = 30;

function materialWarningConfig() {
  return {
    lowStockThresholds: state.config?.materialWarning?.lowStockThresholds || DEFAULT_MATERIAL_LOW_STOCK,
    expiryWarningDays: Number(state.config?.materialWarning?.expiryWarningDays) || DEFAULT_EXPIRY_WARN_DAYS
  };
}

function computeMaterialStatusLocal(m) {
  const warningConfig = materialWarningConfig();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const reasons = [];
  if (m.expiryDate) {
    const exp = new Date(m.expiryDate + 'T00:00:00');
    if (exp < now) {
      reasons.push('已过期');
    } else {
      const days = Math.ceil((exp - now) / 86400000);
      if (days <= warningConfig.expiryWarningDays) reasons.push(`即将到期（剩余${days}天）`);
    }
  }
  const threshold = warningConfig.lowStockThresholds[m.unit] || 5;
  const qtyRaw = m.quantity;
  if (qtyRaw !== undefined && qtyRaw !== null && qtyRaw !== '') {
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) {
      reasons.push('已耗尽');
    } else if (qty <= threshold) {
      reasons.push(`低余量（${qty}${m.unit}，阈值${threshold}）`);
    }
  }
  let status;
  if (reasons.some((r) => r.startsWith('已过期'))) status = '已过期';
  else if (reasons.some((r) => r.startsWith('即将到期'))) status = '即将到期';
  else if (reasons.some((r) => r.startsWith('低余量') || r.startsWith('已耗尽'))) status = '低余量';
  else status = '正常';
  return { status, reasons };
}

function renderMaterialStatusPreview(result) {
  if (!result) return '';
  const tone = toneFor(result.status);
  const reasonsHtml = result.reasons.length
    ? `<ul class="material-status-reasons">${result.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<div class="material-status-ok">✅ 余量充足，无需预警</div>';
  return `<div class="material-status-preview ${tone}">
    <div class="material-status-preview-head">
      <span>🔔 自动状态判定</span>
      ${pill(result.status, tone)}
    </div>
    ${reasonsHtml}
  </div>`;
}

function renderMaterialEditForm(material) {
  if (!material) return '';
  const view = state.config.views.find((v) => v.id === 'materials');
  const fields = view?.fields || [];
  const statusResult = computeMaterialStatusLocal(material);
  return `
    <div class="material-edit-form" data-material-edit-form="${material.id}">
      <div class="form-grid">
        ${fields.map((f) => {
          const value = material[f.name] !== undefined ? material[f.name] : (f.default || '');
          if (f.type === 'textarea') {
            return `<label class="${f.wide ? 'wide' : ''}">${escapeHtml(f.label)}<textarea name="${f.name}" ${f.required ? 'required' : ''}>${escapeHtml(value)}</textarea></label>`;
          }
          if (f.type === 'select') {
            return `<label class="${f.wide ? 'wide' : ''}">${escapeHtml(f.label)}<select name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map((opt) => `<option${value === opt ? ' selected' : ''}>${escapeHtml(opt)}</option>`).join('')}</select></label>`;
          }
          return `<label class="${f.wide ? 'wide' : ''}">${escapeHtml(f.label)}<input type="${f.type || 'text'}" name="${f.name}" value="${escapeHtml(value)}" ${f.required ? 'required' : ''}></label>`;
        }).join('')}
      </div>
      ${renderMaterialStatusPreview(statusResult)}
      <div class="actions">
        <button class="ghost" data-material-save="${material.id}">💾 保存</button>
        <button class="ghost secondary" data-material-cancel="${material.id}">取消</button>
      </div>
    </div>
  `;
}

function isStrictRiskAssessment(assessment) {
  if (!assessment) return false;
  return assessment.isStrictMode === true ||
    assessment.protectionLevel === '一级' ||
    assessment.borrowStatus === '修补中';
}

function isConditionRequired(assessment) {
  if (!assessment) return false;
  return isStrictRiskAssessment(assessment) ||
    assessment.level === '高风险' ||
    assessment.level === '极高风险';
}

function renderConditionsSummary(loan) {
  if (!loan || !loan.conditionsSummary) return '';
  const condItems = (loan.conditions || []).map((key) => {
    const conf = state.config.loanConditions?.[key];
    if (!conf) return escapeHtml(key);
    return `<span class="condition-chip" title="${escapeHtml(conf.desc || '')}">${escapeHtml(conf.icon || '')} ${escapeHtml(conf.label || key)}</span>`;
  }).join('');
  const noteHtml = loan.conditionsNote ? `<div style="margin-top:6px;font-size:12px;color:var(--muted);line-height:1.5">💬 ${escapeHtml(loan.conditionsNote)}</div>` : '';
  return `<div class="conditions-summary">
    <div class="conditions-title">🛡️ 保护条件</div>
    <div class="conditions-chips">${condItems}</div>
    ${noteHtml}
  </div>`;
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

function renderBorrowabilityCard(decision, options = {}) {
  if (!decision) return '';
  const { compact = false, showDimensions = true, showActions = true } = options;
  
  const tone = decision.tone || toneFor(decision.level);
  const levelPill = pill(decision.levelLabel || decision.level, tone);
  
  const conservativeHtml = decision.isConservative
    ? `<div class="conservative-badge" title="${escapeHtml(decision.conservativeReason || '')}">
         ⚠️ 保守评估（${decision.missingFields?.length || 0}个字段缺失）
       </div>`
    : '';

  let blockReasonsHtml = '';
  if (decision.blockReasons && decision.blockReasons.length > 0) {
    const items = decision.blockReasons.map((r) => `
      <li class="block-reason-item">
        <span class="block-reason-icon">🚫</span>
        <span>${escapeHtml(r)}</span>
      </li>
    `).join('');
    blockReasonsHtml = `
      <div class="block-reasons">
        <div class="block-reasons-title">阻断原因</div>
        <ul class="block-reasons-list">${items}</ul>
      </div>
    `;
  }

  let dimensionsHtml = '';
  if (showDimensions && decision.dimensionScores) {
    const dims = decision.dimensionScores;
    const dimItems = Object.entries(dims).map(([key, dim]) => {
      const pct = Math.max(0, Math.min(100, dim.score));
      const barTone = dim.score >= 20 ? 'extreme' : dim.score >= 10 ? 'bad' : dim.score >= 5 ? 'warn' : 'ok';
      return `
        <div class="dimension-item" data-dimension="${escapeHtml(key)}">
          <div class="dimension-label">
            <span>${escapeHtml(dim.label)}</span>
            <span class="dimension-value">${escapeHtml(dim.value)}</span>
          </div>
          <div class="dimension-bar">
            <div class="dimension-bar-fill ${barTone}" style="width:${pct}%"></div>
          </div>
          <div class="dimension-score">${dim.score}分 / ${dim.weight}权重</div>
        </div>
      `;
    }).join('');
    dimensionsHtml = `
      <div class="borrowability-dimensions">
        <div class="dimensions-title">📊 多维度评估详情</div>
        <div class="dimensions-grid">${dimItems}</div>
      </div>
    `;
  }

  let actionsHtml = '';
  if (showActions && decision.suggestionActions && decision.suggestionActions.length > 0) {
    const items = decision.suggestionActions.map((a, idx) => `
      <li class="action-item" style="animation-delay:${idx * 50}ms">
        <span class="action-icon">${idx === 0 ? '🎯' : '✅'}</span>
        <span>${escapeHtml(a)}</span>
      </li>
    `).join('');
    actionsHtml = `
      <div class="suggested-actions">
        <div class="actions-title">💡 建议动作</div>
        <ul class="actions-list">${items}</ul>
      </div>
    `;
  }

  const scoreBarPct = Math.max(0, Math.min(100, decision.score));
  const scoreTone = decision.score >= 85 ? 'extreme' : decision.score >= 60 ? 'bad' : decision.score >= 30 ? 'warn' : 'ok';

  if (compact) {
    return `
      <div class="borrowability-card compact ${tone}">
        <div class="borrowability-head">
          <div class="borrowability-level">
            ${levelPill}
            <span class="score-badge">${decision.score}分</span>
          </div>
          ${conservativeHtml}
        </div>
        <div class="borrowability-score-bar">
          <div class="score-bar-fill ${scoreTone}" style="width:${scoreBarPct}%"></div>
        </div>
        ${blockReasonsHtml}
      </div>
    `;
  }

  return `
    <div class="borrowability-card ${tone}">
      <div class="borrowability-head">
        <div class="borrowability-title">
          <span class="title-icon">🎯</span>
          <span class="title-text">可借阅性决策中心</span>
        </div>
        <div class="borrowability-level">
          ${levelPill}
          <span class="score-badge">${decision.score} / 100</span>
        </div>
        ${conservativeHtml}
      </div>
      
      <div class="borrowability-score">
        <div class="score-label">风险指数</div>
        <div class="borrowability-score-bar">
          <div class="score-bar-fill ${scoreTone}" style="width:${scoreBarPct}%"></div>
        </div>
        <div class="score-legend">
          <span>可借阅 0-30</span>
          <span>需审批 31-60</span>
          <span>限制 61-85</span>
          <span>不可 86-100</span>
        </div>
      </div>

      ${blockReasonsHtml}
      ${dimensionsHtml}
      ${actionsHtml}
      
      <div class="borrowability-footer">
        <span class="eval-time">评估时间：${fmtDate(decision.evaluatedAt)}</span>
        ${decision.scrollId ? `<span class="scroll-ref">${escapeHtml(decision.scrollTitle || decision.scrollId)}</span>` : ''}
      </div>
    </div>
  `;
}

function renderBorrowabilityPreview(decision) {
  if (!decision) return '';
  return `<div class="borrowability-preview">
    <div class="borrowability-preview-title">🔍 可借阅性实时预览</div>
    ${renderBorrowabilityCard(decision, { showDimensions: false, compact: false })}
  </div>`;
}

function renderBorrowabilitySummary(decisions) {
  if (!decisions || Object.keys(decisions).length === 0) return '';
  
  const stats = {
    total: Object.keys(decisions).length,
    byLevel: {},
    withBlockReasons: 0,
    conservative: 0,
    avgScore: 0
  };
  
  let totalScore = 0;
  for (const d of Object.values(decisions)) {
    stats.byLevel[d.level] = (stats.byLevel[d.level] || 0) + 1;
    if (d.blockReasons && d.blockReasons.length > 0) stats.withBlockReasons++;
    if (d.isConservative) stats.conservative++;
    totalScore += d.score || 0;
  }
  stats.avgScore = Math.round(totalScore / stats.total);

  const levels = ['可借阅', '需审批', '限制借阅', '不可借阅'];
  const levelItems = levels.map((level) => {
    const count = stats.byLevel[level] || 0;
    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
    const tone = toneFor(level);
    return `
      <div class="summary-level-item ${tone}">
        <div class="level-count">${count}</div>
        <div class="level-label">${level}</div>
        <div class="level-pct">${pct}%</div>
      </div>
    `;
  }).join('');

  return `
    <div class="borrowability-summary">
      <div class="summary-head">
        <span class="summary-title">📊 经卷可借阅性概览</span>
        <span class="summary-stats">共 ${stats.total} 卷 · 平均 ${stats.avgScore} 分</span>
      </div>
      <div class="summary-levels">${levelItems}</div>
      <div class="summary-meta">
        <span>🚫 有阻断原因：${stats.withBlockReasons} 卷</span>
        <span>⚠️ 保守评估：${stats.conservative} 卷</span>
      </div>
    </div>
  `;
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
  if (field.name === 'conditionsSummary') {
    return item.conditionsSummary || '-';
  }
  if (field.name === 'externalLink') {
    const value = item[field.name] ?? '';
    if (!value) return '-';
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener" class="field-link">🔗 查看存档</a>`;
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
  const placeholder = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
  const conflictCheckClass = viewId === 'loans' && (field.name === 'borrowDate' || field.name === 'dueDate') ? 'conflict-check' : '';
  const relationSelectClass = viewId === 'loans' && field.type === 'relation' ? 'scroll-select' : '';
  const showWhenAttr = field.showWhen ? `data-show-when-field="${field.showWhen.field}" data-show-when-value="${field.showWhen.value}"` : '';
  const hiddenClass = field.showWhen ? ' conditional-field hidden' : '';
  if (field.type === 'textarea') {
    return `<label class="${field.wide ? 'wide' : ''}${hiddenClass}" ${showWhenAttr}>${field.label}<textarea name="${field.name}" ${required} ${placeholder}></textarea></label>`;
  }
  if (field.type === 'select') {
    return `<label class="${field.wide ? 'wide' : ''}${hiddenClass}" ${showWhenAttr}>${field.label}<select name="${field.name}" ${required}>${field.options.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'relation') {
    const items = state.db[field.collection] || [];
    return `<label class="${field.wide ? 'wide' : ''} ${relationSelectClass}${hiddenClass}" ${showWhenAttr}>${field.label}<select name="${field.name}" ${required}>${optionList(items, field.labelFields)}</select></label>`;
  }
  return `<label class="${field.wide ? 'wide' : ''} ${conflictCheckClass}${hiddenClass}" ${showWhenAttr}>${field.label}<input type="${field.type || 'text'}" name="${field.name}" ${value} ${placeholder} ${required}></label>`;
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
    ${tasks.map((t, idx) => {
      const statusTone = toneFor(t.status);
      const lockInfo = t.lockInfo || {};
      const isLocked = lockInfo.isLocked;
      const lockReason = lockInfo.lockReason || '';
      const canStart = lockInfo.canStart !== false;
      const canComplete = lockInfo.canComplete !== false;
      const canRevert = lockInfo.canRevert !== false;
      const sortOrder = lockInfo.sortOrder !== undefined ? lockInfo.sortOrder : idx;
      const taskNumber = sortOrder + 1;

      const quickActions = [];
      if (t.status !== '计划中') {
        const disabled = !canRevert ? 'disabled' : '';
        const title = !canRevert ? `title="${escapeHtml(lockReason || '后序工序已开始，无法回退')}"` : '';
        quickActions.push(`<button class="task-quick" data-task-quick="计划中" data-task-id="${t.id}" ${disabled} ${title}>📋 待办</button>`);
      }
      if (t.status !== '进行中') {
        const disabled = !canStart ? 'disabled' : '';
        const title = !canStart ? `title="${escapeHtml(lockReason || '暂不可开始')}"` : '';
        quickActions.push(`<button class="task-quick" data-task-quick="进行中" data-task-id="${t.id}" ${disabled} ${title}>🔧 进行</button>`);
      }
      if (t.status !== '已完成') {
        const disabled = !canComplete ? 'disabled' : '';
        const title = !canComplete ? `title="${escapeHtml(lockReason || '暂不可完成')}"` : '';
        quickActions.push(`<button class="task-quick task-quick-done" data-task-quick="已完成" data-task-id="${t.id}" ${disabled} ${title}>✅ 完成</button>`);
      }

      const lockBadge = isLocked
        ? `<span class="task-lock-badge" title="${escapeHtml(lockReason)}">🔒 ${escapeHtml(lockReason)}</span>`
        : '';

      return `<div class="task-card${isLocked ? ' task-locked' : ''}${t.status === '已完成' ? ' task-done' : ''}" data-task-card="${t.id}">
        <div class="task-card-head">
          <div class="task-card-title">
            <span class="task-order-badge">第 ${taskNumber} 道</span>
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
        ${lockBadge ? `<div class="task-lock-notice">${lockBadge}</div>` : ''}
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

function renderAttachments(attachments, compact = false) {
  if (!attachments) return '';
  const { hasAttachment, attachmentCode, externalLink } = attachments;
  if (!hasAttachment) return '';
  
  const codeHtml = attachmentCode
    ? `<span class="attachment-code" title="证据附件编号">📎 ${escapeHtml(attachmentCode)}</span>`
    : '';
  
  const linkHtml = externalLink
    ? `<a class="attachment-link" href="${escapeHtml(externalLink)}" target="_blank" title="打开外部存档链接" rel="noopener">🔗 存档链接</a>`
    : '';
  
  if (compact) {
    return `<div class="attachments-compact">${codeHtml}${linkHtml}</div>`;
  }
  
  return `<div class="attachments-section">
    <div class="attachments-title">📎 证据附件索引</div>
    <div class="attachments-content">
      ${codeHtml ? `<div class="attachment-item"><span class="attachment-label">附件编号：</span>${codeHtml}</div>` : ''}
      ${linkHtml ? `<div class="attachment-item"><span class="attachment-label">外部存档：</span>${linkHtml}</div>` : ''}
    </div>
  </div>`;
}

function timelineTypeBadge(type) {
  const icon = TIMELINE_TYPE_ICONS[type] || '📌';
  const tone = TIMELINE_TYPE_TONES[type] || '';
  return `<span class="timeline-type-badge ${tone}">${icon} ${escapeHtml(type)}</span>`;
}

async function openTimeline(scrollId) {
  state.timelineScrollId = scrollId;
  state.timelineFilter = '';
  state.timelineHasAttachmentFilter = '';
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
  state.timelineHasAttachmentFilter = '';
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
  const hasAttachmentOptions = `
    <option value="">全部记录</option>
    <option value="has" ${state.timelineHasAttachmentFilter === 'has' ? 'selected' : ''}>📎 有附件</option>
    <option value="none" ${state.timelineHasAttachmentFilter === 'none' ? 'selected' : ''}>无附件</option>
  `;

  let filtered = data.events;
  if (state.timelineFilter) {
    filtered = filtered.filter((e) => e.type === state.timelineFilter);
  }
  if (state.timelineHasAttachmentFilter === 'has') {
    filtered = filtered.filter((e) => e.attachments?.hasAttachment);
  } else if (state.timelineHasAttachmentFilter === 'none') {
    filtered = filtered.filter((e) => !e.attachments?.hasAttachment);
  }

  const scroll = state.db.scrolls?.find((s) => s.id === data.scrollId);
  const scrollTitle = data.scrollTitle || scroll?.title || data.scrollId;
  const scrollStatus = data.scrollBorrowStatus || scroll?.borrowStatus || '';
  const scrollProtection = data.scrollProtectionLevel || scroll?.protectionLevel || '';
  const protectionAdvice = data.protectionAdvice || scroll?.protectionAdvice;
  const adviceHtml = renderProtectionAdvice(protectionAdvice);

  const eventListHtml = filtered.length
    ? filtered.map((ev) => {
        const hasAttachment = ev.attachments?.hasAttachment;
        const attachmentBadge = hasAttachment
          ? `<span class="timeline-attachment-badge" title="有证据附件">📎</span>`
          : '';
        const attachmentsHtml = renderAttachments(ev.attachments, false);
        return `
      <div class="timeline-event ${hasAttachment ? 'has-attachment' : ''}" data-event-type="${escapeHtml(ev.type)}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-head">
            ${timelineTypeBadge(ev.type)}
            ${attachmentBadge}
            <span class="timeline-time">${fmtDate(ev.timestamp)}</span>
          </div>
          <div class="timeline-title">${escapeHtml(ev.title)}</div>
          ${ev.detail ? `<div class="timeline-detail">${escapeHtml(ev.detail)}</div>` : ''}
          ${attachmentsHtml}
          <div class="timeline-source">来源：${escapeHtml(state.config.collections[ev.source]?.label || ev.source)}</div>
        </div>
      </div>
    `;}).join('')
    : '<div class="empty">暂无匹配的事件记录</div>';

  const filterApplied = state.timelineFilter || state.timelineHasAttachmentFilter;

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
        <label>事件类型：<select id="timeline-filter">${filterOptions}</select></label>
        <label>附件过滤：<select id="timeline-attachment-filter">${hasAttachmentOptions}</select></label>
        <span class="timeline-count">共 ${filtered.length} 条事件${filterApplied ? '（已筛选）' : ''}</span>
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
            <label>证据附件编号<input type="text" name="attachmentCode" placeholder="如：ATT-2026-001"></label>
            <label class="wide">观察内容<textarea name="content" required placeholder="记录观察发现，不影响业务状态"></textarea></label>
            <label class="wide">外部存档链接<input type="text" name="externalLink" placeholder="档案系统URL，可选"></label>
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
  const scrolls = state.db.scrolls || [];
  const decisions = {};
  for (const scroll of scrolls) {
    if (scroll.borrowabilityDecision) {
      decisions[scroll.id] = scroll.borrowabilityDecision;
    }
  }
  const borrowabilitySummaryHtml = Object.keys(decisions).length > 0
    ? renderBorrowabilitySummary(decisions)
    : '';

  return `<div class="stats">${state.config.stats.map((stat) => {
    const items = state.db[stat.collection] || [];
    let value;
    if (stat.filter) {
      if (stat.filter.anyOf) {
        value = items.filter((item) => stat.filter.anyOf.includes(item[stat.filter.field])).length;
      } else {
        value = items.filter((item) => item[stat.filter.field] === stat.filter.value).length;
      }
    } else {
      value = items.length;
    }
    return `<div class="stat"><span>${escapeHtml(stat.label)}</span><strong>${value}</strong></div>`;
  }).join('')}</div>
  ${borrowabilitySummaryHtml}`;
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
      value = escapeHtml(value || '-');
    } else if (field.name === 'riskLevel') {
      value = pill(raw || '-', toneFor(raw));
    } else if (field.name === 'externalLink') {
      value = raw;
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

  let actionsHtml;
  if (collection === 'loans' && item.status !== '已归还' && item.status !== '已拒绝') {
    const needCondition = isConditionRequired(item.riskAssessment);
    const isStrict = isStrictRiskAssessment(item.riskAssessment);
    const loanActions = state.config.actions.filter((action) => action.collection === collection);

    const actionsList = loanActions.map((action) => {
      if (action.id === 'loan-approve') {
        if (needCondition) {
          const extraClass = ' strict-action';
          return `<button class="ghost${extraClass}" data-action="loan-approve-condition" data-id="${item.id}" data-condition="true">⚠️ 条件批准</button>`;
        } else {
          return `<button class="ghost" data-action="${action.id}" data-id="${item.id}">${escapeHtml(action.label)}</button>`;
        }
      }
      if (action.id === 'loan-approve-condition') {
        if (!needCondition) return '';
        return '';
      }
      const extraClass = (isStrict && (action.id === 'loan-reject')) ? ' strict-action' : '';
      const warnIcon = (isStrict && (action.id === 'loan-reject')) ? '⚠️ ' : '';
      return `<button class="${action.danger ? 'danger' : 'ghost'}${extraClass}" data-action="${action.id}" data-id="${item.id}" data-strict="${isStrict ? 'true' : ''}">${warnIcon}${escapeHtml(action.label)}</button>`;
    }).filter(Boolean).join('');

    actionsHtml = `<div class="actions">${actionsList}</div>`;
  } else if (collection === 'materials') {
    actionsHtml = `<div class="actions">
      <button class="ghost" data-material-edit="${item.id}">✏️ 编辑</button>
      <button class="ghost danger" data-material-delete="${item.id}">🗑️ 删除</button>
    </div>`;
  } else {
    actionsHtml = `<div class="actions">${actionButtons(item.id)}</div>`;
  }

  const riskHtml = collection === 'loans' ? renderRiskPanel(item.riskAssessment) : '';

  const adviceHtml = collection === 'scrolls' ? renderProtectionAdvice(item.protectionAdvice) : '';

  const borrowabilityHtml = collection === 'scrolls' && item.borrowabilityDecision
    ? renderBorrowabilityCard(item.borrowabilityDecision, { compact: false, showDimensions: true, showActions: true })
    : '';

  const blockReasonHtml = collection === 'scrolls' && item.borrowStatus === '不可借阅' && (item.blockReason || '').trim()
    ? `<div class="block-reason-display"><span class="block-reason-icon">🔒</span><span class="block-reason-text">不可借阅原因：${escapeHtml(item.blockReason)}</span></div>`
    : '';

  let materialStatusHtml = '';
  if (collection === 'materials') {
    const reasons = item.statusReasons || [];
    const isWarning = ['低余量', '即将到期', '已过期'].includes(item.status);
    if (isWarning && reasons.length > 0) {
      const tone = toneFor(item.status);
      materialStatusHtml = `<div class="material-card-status ${tone}">
        <span class="material-card-status-label">🔔 预警原因</span>
        <ul class="material-card-reasons">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
      </div>`;
    }
  }

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

  let cardTitleHtml = escapeHtml(title);
  if (collection === 'materials' && ['低余量', '即将到期', '已过期'].includes(item.status)) {
    const warnIcon = item.status === '已过期' ? '🚨' : '⚠️';
    cardTitleHtml = `${warnIcon} ${escapeHtml(title)}`;
  }

  const conditionsHtml = collection === 'loans' ? renderConditionsSummary(item) : '';

  const attachmentCollections = ['repairs', 'imagings', 'inventories', 'observations'];
  let attachmentsHtml = '';
  if (attachmentCollections.includes(collection)) {
    const attachments = {
      hasAttachment: !!(item.attachmentCode || item.externalLink),
      attachmentCode: item.attachmentCode || null,
      externalLink: item.externalLink || null
    };
    attachmentsHtml = renderAttachments(attachments, true);
  }

  return `<article class="card${collection === 'materials' && ['低余量', '即将到期', '已过期'].includes(item.status) ? ' material-warning material-' + toneFor(item.status) : ''}">
    <div class="card-head"><h3>${cardTitleHtml}</h3>${statusValue ? pill(statusValue, toneFor(statusValue)) : ''}</div>
    ${relation}
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
    ${details ? `<div class="detail">${details}</div>` : ''}
    ${adviceHtml}
    ${borrowabilityHtml}
    ${blockReasonHtml}
    ${materialStatusHtml}
    ${batchProgressHtml}
    ${riskHtml}
    ${conditionsHtml}
    ${attachmentsHtml}
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
  if (view.id === 'materials') {
    const statusRank = { '已过期': 3, '即将到期': 2, '低余量': 1, '正常': 0 };
    items.sort((a, b) => (statusRank[b.status] || 0) - (statusRank[a.status] || 0));
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

  const statusOptions = ['全部', ...(view.activeStatuses || [])].map((label) => {
    const value = label === '全部' ? '' : label;
    const selected = state.calendarStatusFilter === value ? 'selected' : '';
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join('');

  const riskLevels = ['全部', '低风险', '中风险', '高风险', '极高风险'];
  const riskOptions = riskLevels.map((label) => {
    const value = label === '全部' ? '' : label;
    const selected = state.calendarRiskFilter === value ? 'selected' : '';
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join('');

  const calendarHtml = `
    <div class="calendar-header">
      <button class="ghost" data-calendar-prev>◀ 上月</button>
      <h3 class="calendar-title">${year}年${month + 1}月</h3>
      <button class="ghost" data-calendar-next>下月 ▶</button>
    </div>
    <div class="calendar-filter">
      <label>筛选经卷：<select id="calendar-scroll-filter">${scrollOptions}</select></label>
      <label>借阅状态：<select id="calendar-status-filter">${statusOptions}</select></label>
      <label>风险等级：<select id="calendar-risk-filter">${riskOptions}</select></label>
      <button class="ghost" data-calendar-today>今天</button>
    </div>
    <div class="calendar-legend">
      <span class="legend-item"><span class="legend-dot legend-today"></span>今天</span>
      <span class="legend-item"><span class="legend-dot legend-reserved"></span>已预约</span>
      <span class="legend-item"><span class="legend-dot legend-multiple"></span>多卷预约</span>
      <span class="legend-item"><span class="legend-risk risk-low">低</span><span class="legend-risk risk-warn">中</span><span class="legend-risk risk-bad">高</span><span class="legend-risk risk-extreme">极高</span></span>
    </div>
    <div class="calendar-grid">
      ${weekdayNames.map((name) => `<div class="calendar-weekday">${name}</div>`).join('')}
      ${days.map(({ date, inMonth }) => {
        const dateStr = toDateString(date);
        const reservations = getReservationsForDate(dateStr, state.selectedScrollId || null);
        const hasReservation = reservations.length > 0;
        const hasMultiple = reservations.length > 1;
        const today = isToday(date);
        const reservationHtml = hasReservation ? reservations.slice(0, 2).map((r) => {
          const riskTone = toneForRisk(r.riskAssessment?.level || '低风险');
          const riskLevel = r.riskAssessment?.level || '低风险';
          const conditionMark = r.conditionsSummary ? `<span class="condition-chip-small" title="保护条件：${escapeHtml(r.conditionsSummary)}${r.conditionsNote ? '｜' + escapeHtml(r.conditionsNote) : ''}">🛡️</span>` : '';
          const tooltip = `${escapeHtml(r.scrollTitle)} - ${escapeHtml(r.borrower)}: ${escapeHtml(r.purpose)} (${r.status}｜${riskLevel}${r.conditionsSummary ? '｜保护条件：' + r.conditionsSummary : ''})`;
          return `
          <div class="calendar-event ${riskTone}${r.conditionsSummary ? ' has-condition' : ''}" title="${escapeHtml(tooltip)}">
            <span class="event-scroll">${escapeHtml(r.scrollTitle)}${conditionMark}</span>
            <span class="event-meta">
              <span class="event-borrower">${escapeHtml(r.borrower)}</span>
              <span class="event-risk ${toneForRisk(riskLevel)}">${escapeHtml(riskLevel)}</span>
            </span>
          </div>
        `}).join('') + (reservations.length > 2 ? `<div class="calendar-event more">+${reservations.length - 2} 更多</div>` : '') : '';
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
      const reservations = entry.reservations.filter(reservationMatchesFilters);
      if (!reservations.length) return '';
      return `<div class="scroll-reservations">
        <h4>${escapeHtml(entry.title)} ${pill(entry.borrowStatus, toneFor(entry.borrowStatus))}</h4>
        <div class="reservation-list">
          ${reservations.map((r) => {
            const riskLevel = r.riskAssessment?.level || '低风险';
            const riskTone = toneForRisk(riskLevel);
            const conditionHtml = r.conditionsSummary
              ? `<div class="reservation-conditions" title="${r.conditionsNote ? '补充说明：' + escapeHtml(r.conditionsNote) : ''}"><span class="condition-chip-small">🛡️</span>${escapeHtml(r.conditionsSummary)}</div>`
              : '';
            return `
            <div class="reservation-item${r.conditionsSummary ? ' has-condition' : ''}">
              <div class="reservation-dates">${escapeHtml(r.borrowDate)} ~ ${escapeHtml(r.dueDate)}</div>
              <div class="reservation-info">
                <span>${escapeHtml(r.borrower)} - ${escapeHtml(r.purpose)}</span>
                <span class="reservation-tags">
                  ${pill(r.status, toneFor(r.status))}
                  ${pill(riskLevel, riskTone)}
                </span>
              </div>
              ${conditionHtml}
            </div>
          `}).join('')}
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
  const borrowabilityPreviewHtml = view.id === 'loans' && state.borrowabilityPreview
    ? renderBorrowabilityPreview(state.borrowabilityPreview)
    : '';
  const materialPreviewHtml = view.id === 'materials'
    ? renderMaterialStatusPreview(computeMaterialStatusLocal({ quantity: '', unit: '张', expiryDate: '' }))
    : '';
  return `<section class="view" id="${view.id}">
    <div class="grid">
      <form class="panel" data-create="${view.collection}" data-view="${view.id}">
        <h2>${escapeHtml(view.formTitle)}</h2>
        <div class="form-grid">${view.fields.map((f) => formField(f, view.id)).join('')}</div>
        ${borrowabilityPreviewHtml}
        ${riskPreviewHtml}
        ${materialPreviewHtml}
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
      <button class="ghost" id="batch-draft-btn" ${bi.selectedRows.size === 0 ? 'disabled' : ''}>
        📝 导入为草稿（${bi.selectedRows.size}条）
      </button>
    </div>`;
  }

  const sampleText = `卷名,材质,年代,残损,题跋,柜位,保护等级,借阅状态,不可借阅原因
维摩诘经卷上,楮皮纸,唐代,首尾完整中部略有虫蛀,有贞观年款,恒湿柜A-01,一级,需审批,
楞伽阿跋多罗宝经,宣纸,宋代,边缘轻微磨损,无,恒湿柜B-02,二级,可借阅,
严重霉变经卷,麻纸,北宋,严重霉变多处粘连,首尾完整,恒湿柜B-05,一级,不可借阅,严重霉变需揭裱修复`;

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

function renderDraftView(view) {
  const drafts = state.drafts.items || [];
  const filter = state.drafts.filter || '';
  const filtered = filter
    ? drafts.filter((d) => d.status === filter)
    : drafts;
  const pendingDrafts = filtered.filter((d) => d.status === '待确认');
  const confirmedDrafts = filtered.filter((d) => d.status === '已确认');
  const pendingCount = drafts.filter((d) => d.status === '待确认').length;

  const filterOptions = [
    { value: '', label: '全部' },
    { value: '待确认', label: '待确认' },
    { value: '已确认', label: '已确认' }
  ].map((opt) => `<option value="${opt.value}" ${filter === opt.value ? 'selected' : ''}>${opt.label}${opt.value === '待确认' && pendingCount > 0 ? `（${pendingCount}）` : ''}</option>`).join('');

  const draftCard = (draft) => {
    const d = draft.data;
    const isValid = draft.isValid;
    const statusTone = draft.status === '已确认' ? 'ok' : (isValid ? 'warn' : 'bad');
    const errorHtml = !isValid && draft.validationErrors && draft.validationErrors.length > 0
      ? `<div class="draft-errors">${draft.validationErrors.map((e) => `<span class="pill bad">${escapeHtml(e.message)}</span>`).join('')}</div>`
      : '';
    const previewInfoHtml = draft.previewInfo ? (() => {
      const pi = draft.previewInfo;
      const parts = [];
      if (pi.duplicateTitles && pi.duplicateTitles.length > 0) {
        parts.push(`<span class="batch-field-bad">⚠️ 重复卷名${pi.duplicateTitles.length}条</span>`);
      }
      if (pi.protectionAnomalies && pi.protectionAnomalies.length > 0) {
        parts.push(`<span class="batch-field-bad">⚠️ 保护等级异常${pi.protectionAnomalies.length}条</span>`);
      }
      if (pi.missingRequired && Object.keys(pi.missingRequired).length > 0) {
        parts.push(`<span class="batch-field-bad">⚠️ 缺失必填项</span>`);
      }
      if (pi.fieldRecognition) {
        const fr = pi.fieldRecognition;
        if (fr.unrecognized && fr.unrecognized.length > 0) {
          parts.push(`<span class="batch-field-bad">⚠️ ${fr.unrecognized.length}列未识别</span>`);
        }
        if (fr.hasAllRequired) {
          parts.push(`<span class="batch-field-ok">✅ 必填字段齐全</span>`);
        }
      }
      return parts.length ? `<div class="draft-preview-info">${parts.join('')}</div>` : '';
    })() : '';

    const actionsHtml = draft.status === '待确认'
      ? `<div class="actions">
          <button class="ghost" data-draft-edit="${draft.id}">✏️ 编辑</button>
          <button ${!isValid ? 'disabled title="请先修正校验错误"' : ''} data-draft-confirm="${draft.id}">✅ 确认转正</button>
          <button class="danger" data-draft-discard="${draft.id}">🗑️ 丢弃</button>
        </div>`
      : `<div class="actions">
          ${draft.confirmedScrollId ? `<span class="pill ok">已转正为经卷档案</span>` : ''}
        </div>`;

    return `<article class="card draft-card ${draft.status === '已确认' ? 'draft-confirmed' : ''} ${!isValid ? 'draft-invalid' : ''}">
      <div class="card-head">
        <h3>${draft.status === '已确认' ? '✅' : isValid ? '📝' : '⚠️'} ${escapeHtml(d.title || '(无卷名)')}</h3>
        ${pill(draft.status, statusTone)}
      </div>
      <div class="detail">
        <div>材质<br><strong>${escapeHtml(d.material || '-')}</strong></div>
        <div>年代<br><strong>${escapeHtml(d.era || '-')}</strong></div>
        <div>保护等级<br><strong>${escapeHtml(d.protectionLevel || '-')}</strong></div>
        <div>借阅状态<br><strong>${escapeHtml(d.borrowStatus || '-')}</strong></div>
        <div>柜位<br><strong>${escapeHtml(d.cabinet || '-')}</strong></div>
        <div>残损<br><strong>${escapeHtml(d.damage || '-')}</strong></div>
      </div>
      ${d.inscription ? `<p>题跋：${escapeHtml(d.inscription)}</p>` : ''}
      ${errorHtml}
      ${previewInfoHtml}
      ${actionsHtml}
      <div class="draft-meta">
        <span>来源行：第${draft.sourceRow}行</span>
        <span>创建：${fmtDate(draft.createdAt)}</span>
      </div>
    </article>`;
  };

  return `<section class="view" id="${view.id}">
    <div class="panel">
      <h2>📋 导入草稿 ${pendingCount > 0 ? `<span class="draft-count-badge">${pendingCount}</span>` : ''}</h2>
      <p class="batch-hint">草稿模式的导入结果暂存于此，管理员可逐条确认转正为经卷档案、编辑修正或丢弃。</p>
      <div class="toolbar">
        <select id="draft-status-filter">${filterOptions}</select>
      </div>
      ${pendingDrafts.length ? `<h3>待确认（${pendingDrafts.length}）</h3><div class="list">${pendingDrafts.map(draftCard).join('')}</div>` : ''}
      ${confirmedDrafts.length ? `<h3>已确认（${confirmedDrafts.length}）</h3><div class="list">${confirmedDrafts.map(draftCard).join('')}</div>` : ''}
      ${!pendingDrafts.length && !confirmedDrafts.length ? '<div class="empty">暂无草稿记录</div>' : ''}
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
    if (view.type === 'draftList') return renderDraftView(view);
    if (view.type === 'consistencyCheck') return renderConsistencyCheckView(view);
    if (view.type === 'audit') return renderAuditView(view);
    return renderCrudView(view);
  }).join('');

  if (!visibleViews.find((v) => v.id === state.activeTab)) {
    state.activeTab = visibleViews[0]?.id || '';
  }
  setTab(state.activeTab || visibleViews[0]?.id || '');
}

async function loadDrafts() {
  try {
    state.drafts.items = await api('/api/drafts');
  } catch (e) {
    state.drafts.items = [];
  }
}

async function load() {
  state.db = await api('/api/db');
  await loadDrafts();
  try {
    state.calendarData = await api('/api/loans/calendar');
  } catch (e) {
    state.calendarData = [];
  }
  render();
}

function openDraftEditModal(draft) {
  const d = draft.data;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'draft-edit-modal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>✏️ 编辑草稿</h3>
        <button class="modal-close" data-modal-close>×</button>
      </div>
      <div class="modal-body">
        <form data-draft-edit-form="${draft.id}">
          <div class="form-grid">
            <label>卷名 <input type="text" name="title" value="${escapeHtml(d.title || '')}" required></label>
            <label>材质 <input type="text" name="material" value="${escapeHtml(d.material || '')}" required></label>
            <label>年代判断 <input type="text" name="era" value="${escapeHtml(d.era || '')}" required></label>
            <label>存放柜位 <input type="text" name="cabinet" value="${escapeHtml(d.cabinet || '')}" required></label>
            <label>保护等级
              <select name="protectionLevel">
                ${['一级', '二级', '三级'].map((opt) => `<option ${d.protectionLevel === opt ? 'selected' : ''}>${opt}</option>`).join('')}
              </select>
            </label>
            <label>借阅状态
              <select name="borrowStatus">
                ${['可借阅', '需审批', '限制借阅', '修补中', '不可借阅'].map((opt) => `<option ${d.borrowStatus === opt ? 'selected' : ''}>${opt}</option>`).join('')}
              </select>
            </label>
            <label class="wide conditional-field${d.borrowStatus !== '不可借阅' ? ' hidden' : ''}" data-show-when-field="borrowStatus" data-show-when-value="不可借阅">不可借阅原因 <textarea name="blockReason" placeholder="请填写不可借阅的具体原因">${escapeHtml(d.blockReason || '')}</textarea></label>
            <label class="wide">残损位置 <textarea name="damage" required>${escapeHtml(d.damage || '')}</textarea></label>
            <label class="wide">题跋信息 <textarea name="inscription">${escapeHtml(d.inscription || '')}</textarea></label>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="ghost" data-modal-close>取消</button>
        <button id="draft-edit-save-btn">保存修改</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    modal.remove();
  };

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal-close]') || e.target === modal) close();
    if (e.target.id === 'draft-edit-save-btn') {
      const form = $(`[data-draft-edit-form="${draft.id}"]`, modal);
      if (!form || !form.checkValidity()) {
        form?.reportValidity();
        return;
      }
      const formData = Object.fromEntries(new FormData(form).entries());
      api(`/api/drafts/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: formData })
      }).then(() => {
        close();
        loadDrafts().then(() => {
          render();
          toast('草稿已更新');
        });
      }).catch((err) => {
        toast(err.message);
      });
    }
  });

  modal.addEventListener('change', (e) => {
    if (e.target.name === 'borrowStatus') {
      const form = e.target.closest('form');
      if (!form) return;
      form.querySelectorAll('.conditional-field').forEach((label) => {
        const triggerField = label.dataset.showWhenField;
        const triggerValue = label.dataset.showWhenValue;
        const triggerEl = form.querySelector(`[name="${triggerField}"]`);
        if (triggerEl && triggerEl.value === triggerValue) {
          label.classList.remove('hidden');
        } else {
          label.classList.add('hidden');
          const input = label.querySelector('input, textarea, select');
          if (input) input.value = '';
        }
      });
    }
  });
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
  if (assessment.borrowStatus === '不可借阅') strictReason.push('经卷处于不可借阅状态');
  if (assessment.borrowStatus === '限制借阅') strictReason.push('经卷处于限制借阅状态');

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

function openConditionApproveModal(action, item, onConfirm) {
  const assessment = item.riskAssessment || {};
  const scroll = state.db.scrolls?.find((s) => s.id === item.scrollId);
  const reasons = (assessment.reasons || []).slice(0, 5).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const conditionConfig = state.config.loanConditions || {};

  const conditionItems = Object.entries(conditionConfig).map(([key, conf]) => `
    <label class="condition-option">
      <input type="checkbox" name="loan-condition" value="${escapeHtml(key)}">
      <span class="condition-option-main">
        <span class="condition-option-icon">${escapeHtml(conf.icon || '')}</span>
        <span class="condition-option-label">${escapeHtml(conf.label || key)}</span>
      </span>
      <span class="condition-option-desc">${escapeHtml(conf.desc || '')}</span>
    </label>
  `).join('');

  const strictReason = [];
  if (assessment.protectionLevel === '一级') strictReason.push('一级保护经卷');
  if (assessment.borrowStatus === '修补中') strictReason.push('经卷处于修补中状态');
  if (assessment.borrowStatus === '不可借阅') strictReason.push('经卷处于不可借阅状态');
  if (assessment.borrowStatus === '限制借阅') strictReason.push('经卷处于限制借阅状态');
  if (assessment.level === '高风险') strictReason.push('高风险借阅');
  if (assessment.level === '极高风险') strictReason.push('极高风险借阅');

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'condition-modal';
  modal.innerHTML = `
    <div class="modal condition-modal">
      <div class="modal-head">
        <h3>🛡️ 条件批准 - 保护条件录入</h3>
        <button class="modal-close" data-modal-close>×</button>
      </div>
      <div class="modal-body">
        <div class="condition-modal-hint">
          此借阅为<strong style="color:var(--bad)">${escapeHtml(strictReason.join(' + '))}</strong>，必须勾选至少一项保护条件后才可批准。
        </div>
        <div class="modal-info-grid">
          <div class="modal-info-row"><span class="label">经卷名称</span><span><strong>${escapeHtml(scroll?.title || '-')}</strong></span></div>
          <div class="modal-info-row"><span class="label">借阅人</span><span>${escapeHtml(item.borrower || '-')}</span></div>
          <div class="modal-info-row"><span class="label">借阅用途</span><span>${escapeHtml(item.purpose || '-')}</span></div>
          <div class="modal-info-row"><span class="label">风险等级</span><span>${pill(assessment.level || '-', toneFor(assessment.level))} <span style="font-family:monospace;color:var(--muted)">(${assessment.score || 0}/100)</span></span></div>
        </div>
        <div style="font-size:13px;color:var(--muted);font-weight:700;margin:10px 0 4px">风险评估详情：</div>
        <ul class="risk-reasons">${reasons}</ul>
        <div class="condition-list-title">请选择保护条件（至少一项）：</div>
        <div class="condition-options">${conditionItems}</div>
        <div style="margin-top:14px">
          <label style="font-size:13px;font-weight:700">补充说明（可选）：
            <textarea class="modal-confirm-textarea" id="conditions-note" placeholder="可补充具体的时段、陪同人员等细节..."></textarea>
          </label>
        </div>
        <div style="margin-top:10px">
          <label style="color:var(--bad);font-size:13px;font-weight:700">批准理由（必填）：
            <textarea class="modal-confirm-textarea" id="approve-note" placeholder="请详细说明条件批准此借阅申请的理由..."></textarea>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <button class="ghost" data-modal-close>取消</button>
        <button id="condition-approve-btn">确认条件批准</button>
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
    if (e.target.id === 'condition-approve-btn') {
      const checked = [...modal.querySelectorAll('input[name="loan-condition"]:checked')].map((el) => el.value);
      const conditionsNote = $('#conditions-note', modal)?.value.trim();
      const approveNote = $('#approve-note', modal)?.value.trim();
      if (checked.length === 0) {
        toast('请至少选择一项保护条件');
        return;
      }
      if (!approveNote) {
        toast('请输入批准理由');
        return;
      }
      close();
      onConfirm({ conditions: checked, conditionsNote, approveNote });
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
    const sample = `卷名,材质,年代,残损,题跋,柜位,保护等级,借阅状态,不可借阅原因
维摩诘经卷上,楮皮纸,唐代,首尾完整中部略有虫蛀,有贞观年款,恒湿柜A-01,一级,需审批,
楞伽阿跋多罗宝经,宣纸,宋代,边缘轻微磨损,无,恒湿柜B-02,二级,可借阅,
妙法莲华经卷第七,麻纸,元代,无明显残损,尾题完整,恒湿柜C-03,三级,可借阅,`;
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

  const batchDraftBtn = event.target.closest('#batch-draft-btn');
  if (batchDraftBtn) {
    const bi = state.batchImport;
    if (!bi.previewData || bi.selectedRows.size === 0) {
      toast('请先选择要导入的行');
      return;
    }
    bi.importing = true;
    render();
    setTab('batch-import');
    try {
      const result = await api('/api/scrolls/batch/draft', {
        method: 'POST',
        body: JSON.stringify({
          csvText: bi.csvText,
          importRows: [...bi.selectedRows],
          previewData: {
            fieldRecognition: bi.previewData.fieldRecognition,
            duplicateTitles: bi.previewData.duplicateTitles,
            missingRequired: bi.previewData.missingRequired,
            protectionAnomalies: bi.previewData.protectionAnomalies
          }
        })
      });
      bi.importing = false;
      bi.previewData = null;
      bi.csvText = '';
      bi.selectedRows = new Set();
      await loadDrafts();
      await load();
      toast(`已导入${result.draftCount}条草稿，请到草稿列表确认`);
    } catch (e) {
      bi.importing = false;
      render();
      setTab('batch-import');
      toast(e.message);
    }
    return;
  }

  const draftConfirmBtn = event.target.closest('[data-draft-confirm]');
  if (draftConfirmBtn) {
    const draftId = draftConfirmBtn.dataset.draftConfirm;
    try {
      await api(`/api/drafts/${encodeURIComponent(draftId)}/confirm`, { method: 'POST' });
      await loadDrafts();
      await load();
      toast('草稿已确认转正为经卷档案');
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  const draftDiscardBtn = event.target.closest('[data-draft-discard]');
  if (draftDiscardBtn) {
    const draftId = draftDiscardBtn.dataset.draftDiscard;
    try {
      await api(`/api/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      await loadDrafts();
      toast('草稿已丢弃');
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  const draftEditBtn = event.target.closest('[data-draft-edit]');
  if (draftEditBtn) {
    const draftId = draftEditBtn.dataset.draftEdit;
    const draft = state.drafts.items.find((d) => d.id === draftId);
    if (!draft) return;
    openDraftEditModal(draft);
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

  const materialEditBtn = event.target.closest('[data-material-edit]');
  if (materialEditBtn) {
    const materialId = materialEditBtn.dataset.materialEdit;
    const material = (state.db.materials || []).find((m) => m.id === materialId);
    const card = materialEditBtn.closest('.card');
    if (!material || !card) return;
    const cardContent = card.querySelector('.card-head, .meta, p, .detail, .material-card-status, .actions, .history');
    const editForm = card.querySelector('.material-edit-form');
    if (editForm) return;
    const formHtml = renderMaterialEditForm(material);
    const actionsEl = card.querySelector('.actions');
    if (actionsEl) {
      actionsEl.insertAdjacentHTML('beforebegin', formHtml);
      actionsEl.style.display = 'none';
    }
    const detailEl = card.querySelector('.detail');
    if (detailEl) detailEl.style.display = 'none';
    const summaryEl = card.querySelector('p');
    if (summaryEl) summaryEl.style.display = 'none';
    const materialStatusEl = card.querySelector('.material-card-status');
    if (materialStatusEl) materialStatusEl.style.display = 'none';
    const historyEl = card.querySelector('.history');
    if (historyEl) historyEl.style.display = 'none';
    return;
  }

  const materialCancelBtn = event.target.closest('[data-material-cancel]');
  if (materialCancelBtn) {
    const materialId = materialCancelBtn.dataset.materialCancel;
    const card = materialCancelBtn.closest('.card');
    if (!card) return;
    const editForm = card.querySelector('.material-edit-form');
    if (editForm) editForm.remove();
    const actionsEl = card.querySelector('.actions');
    if (actionsEl) actionsEl.style.display = '';
    const detailEl = card.querySelector('.detail');
    if (detailEl) detailEl.style.display = '';
    const summaryEl = card.querySelector('p');
    if (summaryEl) summaryEl.style.display = '';
    const materialStatusEl = card.querySelector('.material-card-status');
    if (materialStatusEl) materialStatusEl.style.display = '';
    const historyEl = card.querySelector('.history');
    if (historyEl) historyEl.style.display = '';
    return;
  }

  const materialSaveBtn = event.target.closest('[data-material-save]');
  if (materialSaveBtn) {
    const materialId = materialSaveBtn.dataset.materialSave;
    const card = materialSaveBtn.closest('.card');
    const editForm = card?.querySelector('.material-edit-form');
    if (!card || !editForm) return;
    const data = {};
    const fields = ['name', 'category', 'batch', 'quantity', 'unit', 'location', 'expiryDate', 'note'];
    fields.forEach((f) => {
      const input = editForm.querySelector(`[name="${f}"]`);
      if (input) data[f] = input.value.trim();
    });
    if (!data.name) { toast('材料名称不能为空'); return; }
    if (!data.category) { toast('分类不能为空'); return; }
    if (!data.batch) { toast('批次号不能为空'); return; }
    if (data.quantity === '' || data.quantity === undefined) { toast('余量不能为空'); return; }
    if (!data.unit) { toast('单位不能为空'); return; }
    if (!data.location) { toast('保管位置不能为空'); return; }
    try {
      data.quantity = Number(data.quantity);
      await api(`/api/materials/${encodeURIComponent(materialId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...data, historyAction: '更新' })
      });
      await load();
      toast('材料已更新');
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  const materialDeleteBtn = event.target.closest('[data-material-delete]');
  if (materialDeleteBtn) {
    const materialId = materialDeleteBtn.dataset.materialDelete;
    const material = (state.db.materials || []).find((m) => m.id === materialId);
    if (!material) return;
    if (!confirm(`确定要删除材料"${material.name}"（${material.batch}）吗？`)) return;
    try {
      await api(`/api/materials/${encodeURIComponent(materialId)}`, { method: 'DELETE' });
      await load();
      toast('材料已删除');
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

    if (actionId === 'loan-approve-condition' ||
        (actionId === 'loan-approve' && isConditionRequired(item?.riskAssessment))) {
      openConditionApproveModal(actionConfig, item, async ({ conditions, conditionsNote, approveNote }) => {
        try {
          const approveAction = state.config.actions.find((a) => a.id === 'loan-approve-condition') || actionConfig;
          await api(`/api/${actionConfig.collection}/${itemId}`, {
            method: 'PATCH',
            body: JSON.stringify({ note: approveNote, historyAction: approveAction.label })
          });
          await api(`/api/action/loan-approve-condition/${itemId}`, {
            method: 'POST',
            body: JSON.stringify({ conditions, conditionsNote })
          });
          await load();
          toast('已条件批准');
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    if (actionConfig?.collection === 'loans' &&
        actionId === 'loan-reject' &&
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

    if ((actionId === 'loan-out' || actionId === 'loan-return') && item?.conditionsSummary) {
      const actionName = actionId === 'loan-out' ? '借出' : '归还';
      if (!confirm(`确认${actionName}？\n\n保护条件：${item.conditionsSummary}${item.conditionsNote ? '\n补充说明：' + item.conditionsNote : ''}\n\n请确认在${actionName}过程中已遵守以上保护条件。`)) {
        return;
      }
    }

    if (actionId === 'scroll-unborrowable') {
      const reason = prompt('请填写设为不可借阅的原因（必填）：');
      if (!reason || !reason.trim()) {
        toast('设为不可借阅时必须填写原因');
        return;
      }
      try {
        await api(`/api/${actionConfig.collection}/${itemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ borrowStatus: '不可借阅', blockReason: reason.trim(), historyAction: '不可借阅' })
        });
        await load();
        toast('已设为不可借阅');
      } catch (error) {
        toast(error.message);
      }
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
let borrowabilityPreviewTimeout = null;

document.addEventListener('input', async (event) => {
  const conditionalField = event.target.closest('[data-create]')?.querySelector('.conditional-field');
  if (event.target.name && conditionalField) {
    const form = event.target.closest('[data-create]');
    form.querySelectorAll('.conditional-field').forEach((label) => {
      const triggerField = label.dataset.showWhenField;
      const triggerValue = label.dataset.showWhenValue;
      const triggerEl = form.querySelector(`[name="${triggerField}"]`);
      if (triggerEl && triggerEl.value === triggerValue) {
        label.classList.remove('hidden');
        const input = label.querySelector('input, textarea, select');
        if (input) input.required = true;
      } else {
        label.classList.add('hidden');
        const input = label.querySelector('input, textarea, select');
        if (input) { input.required = false; input.value = ''; }
      }
    });
  }

  const view = state.config.views.find((entry) => entry.id && (event.target.id === `search-${entry.id}` || event.target.id === `status-${entry.id}`));
  if (view) $(`#list-${view.id}`).innerHTML = renderList(view);

  if (event.target.id === 'timeline-filter') {
    state.timelineFilter = event.target.value;
    renderTimelineOverlay();
    return;
  }

  if (event.target.id === 'timeline-attachment-filter') {
    state.timelineHasAttachmentFilter = event.target.value;
    renderTimelineOverlay();
    return;
  }

  if (event.target.id === 'calendar-scroll-filter') {
    state.selectedScrollId = event.target.value;
    render();
    return;
  }

  if (event.target.id === 'calendar-status-filter') {
    state.calendarStatusFilter = event.target.value;
    render();
    return;
  }

  if (event.target.id === 'calendar-risk-filter') {
    state.calendarRiskFilter = event.target.value;
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

    if (borrowabilityPreviewTimeout) clearTimeout(borrowabilityPreviewTimeout);
    borrowabilityPreviewTimeout = setTimeout(async () => {
      if (scrollId) {
        const decision = await previewBorrowability(scrollId, borrowDate, dueDate);
        const previewEl = form.querySelector('.borrowability-preview');
        const newPreviewHtml = renderBorrowabilityPreview(decision);
        if (previewEl) {
          previewEl.outerHTML = newPreviewHtml || '';
        } else if (newPreviewHtml) {
          const riskPreview = form.querySelector('.risk-preview');
          const formGrid = form.querySelector('.form-grid');
          if (riskPreview) {
            riskPreview.insertAdjacentHTML('beforebegin', newPreviewHtml);
          } else if (formGrid) {
            formGrid.insertAdjacentHTML('afterend', newPreviewHtml);
          }
        }
        const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
        const existingGuard = form.querySelector('.borrowability-guard');
        if (decision && (decision.level === '不可借阅' || decision.level === '修补中')) {
          if (submitBtn) submitBtn.disabled = true;
          if (!existingGuard) {
            const guardHtml = `<div class="borrowability-guard"><span class="guard-icon">🔒</span><span>该经卷当前为「${decision.level}」状态，无法提交借阅申请</span></div>`;
            const actionsDiv = form.querySelector('.actions');
            if (actionsDiv) actionsDiv.insertAdjacentHTML('beforebegin', guardHtml);
          } else {
            existingGuard.querySelector('span:last-child').textContent = `该经卷当前为「${decision.level}」状态，无法提交借阅申请`;
          }
        } else {
          if (existingGuard) existingGuard.remove();
          const conflictWarningEl = form.querySelector('.conflict-warning');
          if (!conflictWarningEl && submitBtn) submitBtn.disabled = false;
        }
      } else {
        state.borrowabilityPreview = null;
        const previewEl = form.querySelector('.borrowability-preview');
        if (previewEl) previewEl.remove();
        const guardEl = form.querySelector('.borrowability-guard');
        if (guardEl) guardEl.remove();
        const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
        if (submitBtn) submitBtn.disabled = false;
      }
    }, 200);

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
          <div class="template-preview-title">📋 模板工序预览（共${processList.length}道，按顺序执行）</div>
          <div class="template-processes">${processList.map((p, i) => `<span class="template-process-tag">${i + 1}. ${escapeHtml(p)}</span>`).join('')}</div>
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

  const materialForm = event.target.closest('[data-create="materials"]');
  if (materialForm) {
    const quantity = materialForm.querySelector('[name="quantity"]')?.value;
    const unit = materialForm.querySelector('[name="unit"]')?.value;
    const expiryDate = materialForm.querySelector('[name="expiryDate"]')?.value;
    const result = computeMaterialStatusLocal({ quantity: quantity || 0, unit: unit || '张', expiryDate: expiryDate || '' });
    const previewEl = materialForm.querySelector('.material-status-preview');
    const newHtml = renderMaterialStatusPreview(result);
    if (previewEl) {
      previewEl.outerHTML = newHtml;
    } else {
      const actionsDiv = materialForm.querySelector('.actions');
      actionsDiv.insertAdjacentHTML('beforebegin', newHtml);
    }
  }

  const materialEditForm = event.target.closest('[data-material-edit-form]');
  if (materialEditForm) {
    const quantity = materialEditForm.querySelector('[name="quantity"]')?.value;
    const unit = materialEditForm.querySelector('[name="unit"]')?.value;
    const expiryDate = materialEditForm.querySelector('[name="expiryDate"]')?.value;
    const result = computeMaterialStatusLocal({ quantity: quantity || 0, unit: unit || '张', expiryDate: expiryDate || '' });
    const previewEl = materialEditForm.querySelector('.material-status-preview');
    const newHtml = renderMaterialStatusPreview(result);
    if (previewEl) {
      previewEl.outerHTML = newHtml;
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
    const attachmentCode = obsForm.querySelector('[name="attachmentCode"]')?.value.trim() || '';
    const externalLink = obsForm.querySelector('[name="externalLink"]')?.value.trim() || '';
    if (!observer || !content) {
      toast('观察人和观察内容不能为空');
      return;
    }
    try {
      await api(`/api/scrolls/${encodeURIComponent(scrollId)}/observation`, {
        method: 'POST',
        body: JSON.stringify({ observer, content, attachmentCode, externalLink })
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

  const fixableFilteredIssues = filteredIssues.filter((i) => i.autoFixable);
  const allFixableSelected = fixableFilteredIssues.length > 0
    && fixableFilteredIssues.every((i) => cc.selectedIssueIds.has(i.id));
  const someFixableSelected = fixableFilteredIssues.some((i) => cc.selectedIssueIds.has(i.id));

  const selectedCount = [...cc.selectedIssueIds].filter((id) =>
    cc.issues.some((i) => i.id === id && i.autoFixable)
  ).length;
  const batchBtnDisabled = selectedCount === 0 || cc.batchExecuting || cc.planLoading;

  const severityIcons = { high: '🔴', medium: '🟡', low: '🟢' };
  const severityLabels = { high: '高危', medium: '中等', low: '低危' };

  const issueListHtml = hasData
    ? (filteredIssues.length
      ? filteredIssues.map((issue) => {
        const isFixing = cc.fixing[issue.id];
        const icon = severityIcons[issue.severity] || '⚪';
        const severityLabel = severityLabels[issue.severity] || issue.severity;
        const severityClass = `cc-severity-${issue.severity}`;
        const isSelected = cc.selectedIssueIds.has(issue.id);
        const canSelect = issue.autoFixable;

        const affectedLoansHtml = issue.affectedLoans.length
          ? `<div class="cc-affected"><span class="cc-affected-label">影响借阅：</span>${issue.affectedLoans.length}条记录</div>`
          : '';
        const affectedRepairsHtml = issue.affectedRepairs.length
          ? `<div class="cc-affected"><span class="cc-affected-label">影响修补：</span>${issue.affectedRepairs.length}条记录</div>`
          : '';

        const borrowabilityIssueHtml = issue.borrowabilityDecision
          ? renderBorrowabilityCard(issue.borrowabilityDecision, { compact: true, showDimensions: false, showActions: false })
          : '';

        const fixBtnHtml = issue.autoFixable
          ? `<button class="cc-fix-btn" data-cc-fix-issue="${issue.id}" data-cc-fix-suggestion="${issue.suggestion}" ${isFixing ? 'disabled' : ''}>
              ${isFixing ? '修复中...' : '🔧 单独修复'}
            </button>`
          : '<span class="cc-no-fix">需手动处理</span>';

        const checkboxHtml = canSelect
          ? `<label class="cc-checkbox-label">
              <input type="checkbox" class="cc-issue-checkbox" data-cc-issue-id="${issue.id}" ${isSelected ? 'checked' : ''}>
              <span></span>
            </label>`
          : `<span class="cc-checkbox-placeholder"></span>`;

        return `<div class="cc-issue ${severityClass} ${isSelected ? 'cc-issue-selected' : ''}">
          <div class="cc-issue-head">
            ${checkboxHtml}
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
          ${borrowabilityIssueHtml}
          <div class="cc-issue-actions">
            <div class="cc-suggestion">💡 建议：${escapeHtml(issue.suggestionLabel)}</div>
            ${fixBtnHtml}
          </div>
        </div>`;
      }).join('')
      : '<div class="empty">✅ 未检测到状态一致性问题</div>')
    : '<div class="empty">点击「开始巡检」扫描经卷状态一致性问题</div>';

  const batchToolbarHtml = hasData && filteredIssues.some((i) => i.autoFixable)
    ? `<div class="cc-batch-toolbar">
        <label class="cc-select-all-label">
          <input type="checkbox" id="cc-select-all" ${allFixableSelected ? 'checked' : ''} ${someFixableSelected && !allFixableSelected ? 'indeterminate' : ''}>
          <span>全选可修复项</span>
        </label>
        <span class="cc-selected-count">已选 <strong>${selectedCount}</strong> 项</span>
        <button class="cc-batch-plan-btn" id="cc-batch-plan-btn" ${batchBtnDisabled}>
          ${cc.planLoading ? '生成计划中...' : '📋 生成修复计划'}
        </button>
      </div>`
    : '';

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
      ${batchToolbarHtml}
      <div class="cc-issue-list">${issueListHtml}</div>
    </div>
  </section>`;
}

function renderFixPlanModalHtml(plan) {
  if (!plan) return '';

  const severityIcons = { high: '🔴', medium: '🟡', low: '🟢' };
  const severityLabels = { high: '高危', medium: '中等', low: '低危' };

  const itemsHtml = plan.items.map((item, idx) => {
    const icon = severityIcons[item.severity] || '⚪';
    const severityLabel = severityLabels[item.severity] || item.severity;
    const scrollChangeHtml = item.scroll.statusWillChange
      ? `<div class="cc-plan-change">
          <span class="cc-plan-change-label">状态变更：</span>
          ${pill(item.scroll.borrowStatus, toneFor(item.scroll.borrowStatus))}
          <span class="cc-plan-arrow">→</span>
          ${pill(item.scroll.targetBorrowStatus, toneFor(item.scroll.targetBorrowStatus))}
        </div>`
      : `<div class="cc-plan-no-change">仅补充历史记录，不修改状态</div>`;

    const loansHtml = item.loans.length
      ? `<details class="cc-plan-details">
          <summary>影响借阅记录（${item.loans.length}）</summary>
          <div class="cc-plan-detail-list">
            ${item.loans.map((l) => `
              <div class="cc-plan-detail-item">
                <strong>${escapeHtml(l.borrower)}</strong>
                <span class="cc-plan-detail-meta">${escapeHtml(l.status)} · ${escapeHtml(l.borrowDate || '')} ~ ${escapeHtml(l.dueDate || '')}</span>
              </div>
            `).join('')}
          </div>
        </details>`
      : '';

    const batchesHtml = item.repairBatches.length
      ? `<details class="cc-plan-details">
          <summary>影响修补批次（${item.repairBatches.length}）</summary>
          <div class="cc-plan-detail-list">
            ${item.repairBatches.map((b) => `
              <div class="cc-plan-detail-item">
                <strong>${escapeHtml(b.templateName)}</strong>
                <span class="cc-plan-detail-meta">${escapeHtml(b.status)} · 负责人：${escapeHtml(b.conservator || '')}</span>
              </div>
            `).join('')}
          </div>
        </details>`
      : '';

    const repairsHtml = item.repairs.length
      ? `<details class="cc-plan-details">
          <summary>影响修补记录（${item.repairs.length}）</summary>
          <div class="cc-plan-detail-list">
            ${item.repairs.map((r) => `
              <div class="cc-plan-detail-item">
                <strong>${escapeHtml(r.process)}</strong>
                <span class="cc-plan-detail-meta">${escapeHtml(r.status)} · ${escapeHtml(r.conservator || '')} · ${escapeHtml(r.date || '')}</span>
                ${r.materialUsed ? `<div class="cc-plan-detail-sub">材料：${escapeHtml(r.materialUsed)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </details>`
      : '';

    const materialsHtml = item.materials.length
      ? `<details class="cc-plan-details">
          <summary>关联材料（${item.materials.length}）</summary>
          <div class="cc-plan-detail-list">
            ${item.materials.map((m) => `
              <div class="cc-plan-detail-item">
                <strong>${escapeHtml(m.name)}</strong>
                <span class="cc-plan-detail-meta">${escapeHtml(m.category || '')} · 批次：${escapeHtml(m.batch || '-')} · ${escapeHtml(String(m.quantity ?? '-'))}${escapeHtml(m.unit || '')}</span>
                ${m.status ? `<div class="cc-plan-detail-sub">状态：${escapeHtml(m.status)}</div>` : ''}
                ${m.usedIn && m.usedIn.length ? `<div class="cc-plan-detail-sub">用于：${m.usedIn.map((u) => escapeHtml(u)).join('、')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </details>`
      : '';

    return `<div class="cc-plan-item">
      <div class="cc-plan-item-head">
        <span class="cc-plan-item-idx">${idx + 1}</span>
        <span class="cc-severity-badge cc-severity-${item.severity}">${icon} ${severityLabel}</span>
        <span class="cc-plan-item-title">${escapeHtml(item.issueTitle)}</span>
      </div>
      <div class="cc-plan-item-scroll">
        <span class="cc-plan-scroll-label">经卷：</span>
        <strong>${escapeHtml(item.scroll.title)}</strong>
      </div>
      ${scrollChangeHtml}
      <div class="cc-plan-history">
        <span class="cc-plan-history-label">历史记录：</span>
        <span class="cc-plan-history-action">${escapeHtml(item.historySummary.action)}</span>
        <span class="cc-plan-history-note">${escapeHtml(item.historySummary.note)}</span>
      </div>
      <div class="cc-plan-related">
        ${loansHtml}
        ${batchesHtml}
        ${repairsHtml}
        ${materialsHtml}
      </div>
    </div>`;
  }).join('');

  const materialSummaryHtml = plan.materialSummary && Object.keys(plan.materialSummary).length
    ? `<div class="cc-plan-material-summary">
         <span class="cc-plan-material-summary-label">材料类别：</span>
         ${Object.entries(plan.materialSummary).map(([cat, names]) => `
           <span class="cc-plan-material-cat">
             <strong>${escapeHtml(cat)}</strong>：${names.map((n) => escapeHtml(n)).join('、')}
           </span>
         `).join('')}
       </div>`
    : '';

  return `<div class="cc-plan-modal">
    <div class="cc-plan-summary">
      <div class="cc-plan-summary-item"><span>修复项</span><strong>${plan.totalItems}</strong></div>
      <div class="cc-plan-summary-item"><span>涉及经卷</span><strong>${plan.totalScrolls}</strong></div>
      <div class="cc-plan-summary-item"><span>状态变更</span><strong>${plan.totalStatusChanges}</strong></div>
      <div class="cc-plan-summary-item"><span>历史记录</span><strong>${plan.totalHistoryEntries}</strong></div>
    </div>
    <div class="cc-plan-affected">
      <span>关联数据：</span>
      <span class="cc-plan-affected-chip">借阅 ${plan.affectedCounts.loans}</span>
      <span class="cc-plan-affected-chip">批次 ${plan.affectedCounts.batches}</span>
      <span class="cc-plan-affected-chip">修补 ${plan.affectedCounts.repairs}</span>
      <span class="cc-plan-affected-chip">材料 ${plan.affectedCounts.materials}</span>
    </div>
    ${materialSummaryHtml}
    <div class="cc-plan-items">${itemsHtml}</div>
    <div style="margin-top:14px">
      <label style="color:var(--muted);font-size:13px;font-weight:700">批量修复说明（选填）：
        <textarea class="modal-confirm-textarea" id="cc-batch-note" placeholder="可补充本次批量修复的原因或备注..."></textarea>
      </label>
    </div>
  </div>`;
}

function renderBatchResultModalHtml(result) {
  if (!result) return '';

  const successHtml = result.succeeded.length
    ? `<div class="cc-result-section cc-result-ok">
        <div class="cc-result-head">
          <span class="cc-result-icon">✅</span>
          <span class="cc-result-title">修复成功（${result.succeeded.length}）</span>
        </div>
        <div class="cc-result-list">
          ${result.succeeded.map((s) => `
            <div class="cc-result-item">
              <strong>${escapeHtml(s.scrollTitle)}</strong>
              <span class="cc-result-meta">
                ${s.statusChanged
                  ? `状态：${s.oldBorrowStatus} → ${s.newBorrowStatus}`
                  : '已补充历史记录'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  const failHtml = result.failed.length
    ? `<div class="cc-result-section cc-result-bad">
        <div class="cc-result-head">
          <span class="cc-result-icon">❌</span>
          <span class="cc-result-title">修复失败（${result.failed.length}）</span>
        </div>
        <div class="cc-result-list">
          ${result.failed.map((f) => `
            <div class="cc-result-item">
              <strong>${escapeHtml(f.scrollTitle || f.issueTitle || '未知项')}</strong>
              <span class="cc-result-meta cc-result-error">${escapeHtml(f.error)}</span>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  const skipHtml = result.skipped && result.skipped.length
    ? `<div class="cc-result-section cc-result-skip">
        <div class="cc-result-head">
          <span class="cc-result-icon">⏭️</span>
          <span class="cc-result-title">自动跳过（${result.skipped.length}）</span>
        </div>
        <div class="cc-result-list">
          ${result.skipped.map((s) => `
            <div class="cc-result-item">
              <strong>${escapeHtml(s.scrollTitle || s.issueTitle || '未知项')}</strong>
              <span class="cc-result-meta cc-result-skip-reason">${escapeHtml(s.reason)}</span>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  return `<div class="cc-batch-result">
    <div class="cc-result-overview">
      <div class="cc-result-overview-item ok"><span>成功</span><strong>${result.totalSucceeded}</strong></div>
      <div class="cc-result-overview-item bad"><span>失败</span><strong>${result.totalFailed}</strong></div>
      ${result.totalSkipped !== undefined ? `<div class="cc-result-overview-item skip"><span>跳过</span><strong>${result.totalSkipped}</strong></div>` : ''}
      <div class="cc-result-overview-item"><span>总计</span><strong>${result.totalRequested}</strong></div>
    </div>
    ${successHtml}
    ${failHtml}
    ${skipHtml}
  </div>`;
}

function openFixPlanModal(plan) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'cc-plan-modal';
  modal.innerHTML = `
    <div class="modal modal-wide">
      <div class="modal-head">
        <h3>📋 修复计划预览</h3>
        <button class="modal-close" data-modal-close>×</button>
      </div>
      <div class="modal-body">
        <div class="modal-warn-icon">📝</div>
        <div class="modal-warning-text" style="color:var(--accent)">
          请确认以下修复计划，所有改动将写入审计日志
        </div>
        ${renderFixPlanModalHtml(plan)}
      </div>
      <div class="modal-foot">
        <button class="ghost" data-modal-close>取消</button>
        <button id="cc-batch-execute-btn" ${state.consistencyCheck.batchExecuting ? 'disabled' : ''}>
          ${state.consistencyCheck.batchExecuting ? '执行中...' : '✅ 确认执行批量修复'}
        </button>
      </div>
    </div>
  </div>`;
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
    if (ev.target.id === 'cc-batch-execute-btn') {
      if (state.consistencyCheck.batchExecuting) return;
      const batchNote = $('#cc-batch-note', modal)?.value || '';
      closeModal();
      executeBatchFix(batchNote);
    }
  });
}

function executeBatchFix(note) {
  const cc = state.consistencyCheck;
  if (!cc.plan) return;
  const issueIds = cc.plan.items.map((i) => i.issueId);
  if (issueIds.length === 0) {
    toast('没有可执行的修复项');
    return;
  }
  cc.batchExecuting = true;
  render();
  setTab('consistency-check');
  api('/api/consistency-check/batch-fix', {
    method: 'POST',
    body: JSON.stringify({ issueIds, note })
  }).then((result) => {
    cc.batchExecuting = false;
    cc.batchResult = result;
    cc.selectedIssueIds = new Set();
    const msg = result.totalFailed > 0
      ? `批量修复完成：成功${result.totalSucceeded}项，失败${result.totalFailed}项，跳过${result.totalSkipped || 0}项`
      : result.totalSkipped > 0
        ? `批量修复完成：成功${result.totalSucceeded}项，跳过${result.totalSkipped}项`
        : `批量修复完成：全部${result.totalSucceeded}项全部成功`;
    toast(msg);
    loadConsistencyCheck().then(() => {
      load();
      if (state.currentRole === 'admin') {
        loadAuditLogs();
      }
      render();
      setTab('consistency-check');
      openBatchResultModal(result);
    });
  }).catch((err) => {
    cc.batchExecuting = false;
    toast(`批量修复失败：${err.message}`);
    render();
    setTab('consistency-check');
  });
}

function openBatchResultModal(result) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'cc-result-modal';
  modal.innerHTML = `
    <div class="modal modal-wide">
      <div class="modal-head">
        <h3>${result.totalFailed > 0 ? '⚠️ 批量修复结果' : '✅ 批量修复完成'}</h3>
        <button class="modal-close" data-modal-close>×</button>
      </div>
      <div class="modal-body">
        ${renderBatchResultModalHtml(result)}
      </div>
      <div class="modal-foot">
        <button id="cc-result-close-btn" class="primary">确定并刷新</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => { if (ev.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);

  modal.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-modal-close]') || ev.target === modal || ev.target.id === 'cc-result-close-btn') {
      closeModal();
    }
  });
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

document.addEventListener('change', (e) => {
  if (e.target.matches('#cc-select-all')) {
    const cc = state.consistencyCheck;
    let filteredIssues = cc.issues;
    if (cc.filter === 'high' || cc.filter === 'medium' || cc.filter === 'low') {
      filteredIssues = filteredIssues.filter((i) => i.severity === cc.filter);
    } else if (cc.filter) {
      filteredIssues = filteredIssues.filter((i) => i.type === cc.filter);
    }
    const fixableIds = filteredIssues.filter((i) => i.autoFixable).map((i) => i.id);
    if (e.target.checked) {
      fixableIds.forEach((id) => cc.selectedIssueIds.add(id));
    } else {
      fixableIds.forEach((id) => cc.selectedIssueIds.delete(id));
    }
    render();
    setTab('consistency-check');
  }
  if (e.target.matches('.cc-issue-checkbox')) {
    const issueId = e.target.dataset.ccIssueId;
    if (issueId) {
      if (e.target.checked) {
        state.consistencyCheck.selectedIssueIds.add(issueId);
      } else {
        state.consistencyCheck.selectedIssueIds.delete(issueId);
      }
      render();
      setTab('consistency-check');
    }
  }
  if (e.target.matches('#cc-filter')) {
    state.consistencyCheck.filter = e.target.value;
    render();
    setTab('consistency-check');
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#role-badge')) {
    renderRoleSelector();
  }
  if (e.target.closest('#cc-run-btn')) {
    state.consistencyCheck.selectedIssueIds = new Set();
    state.consistencyCheck.plan = null;
    state.consistencyCheck.batchResult = null;
    loadConsistencyCheck().then(() => {
      render();
      if (state.consistencyCheck.summary) {
        const s = state.consistencyCheck.summary;
        toast(`巡检完成：发现${s.total}个问题（高危${s.high}，中等${s.medium}，低危${s.low}）`);
      }
    });
  }
  const draftFilter = e.target.closest('#draft-status-filter');
  if (draftFilter) {
    state.drafts.filter = draftFilter.value;
    render();
    setTab('drafts');
  }
  if (e.target.closest('#cc-batch-plan-btn')) {
    const cc = state.consistencyCheck;
    const ids = [...cc.selectedIssueIds].filter((id) =>
      cc.issues.some((i) => i.id === id && i.autoFixable)
    );
    if (ids.length === 0) {
      toast('请先选择要修复的问题');
      return;
    }
    cc.planLoading = true;
    render();
    setTab('consistency-check');
    api('/api/consistency-check/plan', {
      method: 'POST',
      body: JSON.stringify({ issueIds: ids })
    }).then((plan) => {
      cc.planLoading = false;
      cc.plan = plan;
      render();
      setTab('consistency-check');
      openFixPlanModal(plan);
    }).catch((err) => {
      cc.planLoading = false;
      toast(`生成计划失败：${err.message}`);
      render();
      setTab('consistency-check');
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
          state.consistencyCheck.selectedIssueIds.delete(issueId);
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
