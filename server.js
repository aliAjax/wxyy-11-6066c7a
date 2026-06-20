const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const config = require('./project.config');
const PORT = process.env.PORT || config.port || 3900;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

const ACTIVE_LOAN_STATUSES = ['待审批', '已批准', '已借出'];

const PROTECTION_LEVEL_SCORE = { '一级': 30, '二级': 15, '三级': 5 };

const BORROW_STATUS_SCORE = {
  '可借阅': 0,
  '需审批': 15,
  '限制借阅': 35,
  '修补中': 40
};

const PURPOSE_RISK = {
  '学术研究': { score: 15, desc: '学术研究（中等风险，专业使用）' },
  '文献校勘': { score: 18, desc: '文献校勘（需反复翻阅）' },
  '展览筹备': { score: 28, desc: '展览筹备（高风险用途，需搬运和展示）' },
  '外借展示': { score: 32, desc: '外借展示（极高风险用途，离开馆舍）' },
  '教学使用': { score: 8, desc: '教学使用（低风险用途，短期使用）' },
  '馆藏整理': { score: 12, desc: '馆藏整理（低风险用途，馆内操作）' },
  '影像采集': { score: 10, desc: '影像采集（中等风险，操作需谨慎）' },
  '出版印刷': { score: 25, desc: '出版印刷（高风险用途，需反复操作）' }
};

const DEFAULT_PURPOSE_RISK = { score: 20, desc: '（通用风险）' };

const DAMAGE_KEYWORDS = [
  { keywords: ['虫蛀', '霉斑', '脆化', '脆裂', '碳化'], score: 20, label: '严重残损' },
  { keywords: ['残损', '断裂', '撕裂', '脱落'], score: 15, label: '明显残损' },
  { keywords: ['水渍', '磨损', '褶皱', '脱胶', '卷曲', '受潮', '潮湿'], score: 10, label: '轻度残损' },
  { keywords: ['轻微', '少量', '边缘'], score: -5, label: '轻微情况' }
];

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

function checkLoanConflict(db, scrollId, borrowDate, dueDate, excludeId = null) {
  const loans = db.loans || [];
  const conflicts = [];
  for (const loan of loans) {
    if (excludeId && loan.id === excludeId) continue;
    if (loan.scrollId !== scrollId) continue;
    if (!ACTIVE_LOAN_STATUSES.includes(loan.status)) continue;
    if (dateOverlap(borrowDate, dueDate, loan.borrowDate, loan.dueDate)) {
      const scroll = db.scrolls?.find((s) => s.id === scrollId);
      conflicts.push({
        id: loan.id,
        borrower: loan.borrower,
        purpose: loan.purpose,
        borrowDate: loan.borrowDate,
        dueDate: loan.dueDate,
        status: loan.status,
        scrollTitle: scroll?.title || '未知经卷'
      });
    }
  }
  return conflicts;
}

function getActiveLoansByScroll(db) {
  const result = {};
  const scrolls = db.scrolls || [];
  const loans = db.loans || [];
  for (const scroll of scrolls) {
    result[scroll.id] = {
      scrollId: scroll.id,
      title: scroll.title,
      borrowStatus: scroll.borrowStatus,
      reservations: []
    };
  }
  for (const loan of loans) {
    if (!ACTIVE_LOAN_STATUSES.includes(loan.status)) continue;
    if (!result[loan.scrollId]) continue;
    result[loan.scrollId].reservations.push({
      id: loan.id,
      borrower: loan.borrower,
      purpose: loan.purpose,
      borrowDate: loan.borrowDate,
      dueDate: loan.dueDate,
      status: loan.status
    });
  }
  return Object.values(result);
}

function getLastRepair(db, scrollId) {
  const repairs = (db.repairs || [])
    .filter((r) => r.scrollId === scrollId)
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
  return repairs[0] || null;
}

function assessLoanRisk(db, loan) {
  const scroll = (db.scrolls || []).find((s) => s.id === loan.scrollId);
  if (!scroll) {
    return {
      level: '低风险',
      score: 0,
      reasons: ['未找到对应经卷档案'],
      evaluatedAt: new Date().toISOString(),
      protectionLevel: '未知',
      borrowStatus: '未知',
      lastRepair: null,
      isStrictMode: false
    };
  }

  const reasons = [];
  let score = 0;

  const protectionScore = PROTECTION_LEVEL_SCORE[scroll.protectionLevel] || 0;
  if (protectionScore > 0) {
    score += protectionScore;
    reasons.push(`${scroll.protectionLevel}保护经卷`);
  }

  const statusScore = BORROW_STATUS_SCORE[scroll.borrowStatus] || 0;
  if (statusScore > 0) {
    score += statusScore;
    if (scroll.borrowStatus === '修补中') {
      reasons.push(`借阅状态：修补中（不可借阅）`);
    } else if (scroll.borrowStatus === '限制借阅') {
      reasons.push(`借阅状态：限制借阅`);
    } else if (scroll.borrowStatus === '需审批') {
      reasons.push(`借阅状态：需审批`);
    }
  }

  const purposeRisk = PURPOSE_RISK[loan.purpose] || DEFAULT_PURPOSE_RISK;
  score += purposeRisk.score;
  reasons.push(`借阅用途：${purposeRisk.desc}`);

  const damageText = (scroll.damage || '').trim();
  if (damageText) {
    let damageScore = 5;
    let damageLabel = '存在残损记录';
    for (const rule of DAMAGE_KEYWORDS) {
      if (rule.keywords.some((kw) => damageText.includes(kw))) {
        damageScore += rule.score;
        damageLabel = rule.label;
      }
    }
    damageScore = Math.max(0, damageScore);
    if (damageScore > 0) {
      score += damageScore;
      reasons.push(`残损情况：${damageText}（${damageLabel}）`);
    }
  }

  const lastRepair = getLastRepair(db, scroll.id);
  if (lastRepair) {
    if (lastRepair.status === '进行中') {
      score += 20;
      reasons.push(`最近修补：${lastRepair.process}进行中，未完成`);
    } else if (lastRepair.status === '计划中') {
      score += 10;
      reasons.push(`最近修补：${lastRepair.process}计划中，待开始`);
    } else if (lastRepair.status === '已完成') {
      const daysSinceRepair = Math.floor((Date.now() - new Date(lastRepair.date || lastRepair.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceRepair < 7) {
        score += 5;
        reasons.push(`最近修补：${lastRepair.process}已完成（${daysSinceRepair}天前，建议静养）`);
      } else {
        score -= 3;
        reasons.push(`最近修补：${lastRepair.process}已完成（${daysSinceRepair}天前）`);
      }
    }
  }

  const borrowDate = loan.borrowDate ? parseDate(loan.borrowDate) : null;
  const dueDate = loan.dueDate ? parseDate(loan.dueDate) : null;
  if (borrowDate && dueDate && dueDate >= borrowDate) {
    const days = Math.ceil((dueDate - borrowDate) / (1000 * 60 * 60 * 24)) + 1;
    if (days > 21) {
      score += 15;
      reasons.push(`借阅周期过长（${days}天）`);
    } else if (days > 14) {
      score += 8;
      reasons.push(`借阅周期偏长（${days}天）`);
    } else if (days <= 7) {
      score -= 2;
      reasons.push(`借阅周期合理（${days}天）`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  let level;
  if (score >= 85) level = '极高风险';
  else if (score >= 65) level = '高风险';
  else if (score >= 40) level = '中风险';
  else level = '低风险';

  const isStrictMode = scroll.protectionLevel === '一级' || scroll.borrowStatus === '修补中';

  return {
    level,
    score,
    reasons,
    evaluatedAt: new Date().toISOString(),
    protectionLevel: scroll.protectionLevel,
    borrowStatus: scroll.borrowStatus,
    lastRepair: lastRepair ? {
      date: lastRepair.date,
      status: lastRepair.status,
      process: lastRepair.process
    } : null,
    isStrictMode
  };
}

function formatRiskNote(assessment, actionLabel) {
  const reasonSummary = assessment.reasons.slice(0, 2).join('；');
  return `风险评估：${assessment.level}（得分${assessment.score}${assessment.isStrictMode ? '，严格模式' : ''}）- ${reasonSummary}`;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function readDb() {
  const raw = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2) + '\n');
}

function stamp(action, note) {
  return {
    at: new Date().toISOString(),
    action,
    note: note || ''
  };
}

function sortNewest(a, b) {
  return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
}

app.get('/api/scrolls/:id/timeline', async (req, res) => {
  const db = await readDb();
  const scrollId = req.params.id;
  const scroll = (db.scrolls || []).find((s) => s.id === scrollId);
  if (!scroll) return res.status(404).json({ error: '经卷不存在' });
  const events = [];
  events.push({
    id: `ev-scroll-create-${scroll.id}`,
    timestamp: scroll.createdAt,
    type: '建档',
    source: 'scrolls',
    sourceId: scroll.id,
    title: `建档：${scroll.title}`,
    detail: `材质：${scroll.material || '-'}，年代：${scroll.era || '-'}，保护等级：${scroll.protectionLevel || '-'}，柜位：${scroll.cabinet || '-'}`,
    meta: { protectionLevel: scroll.protectionLevel, borrowStatus: scroll.borrowStatus }
  });
  for (const entry of scroll.history || []) {
    if (entry.action === '创建') continue;
    const isStatusChange = ['保护评估', '状态变更', '可借阅', '需审批', '修补中', '限制借阅'].includes(entry.action);
    events.push({
      id: `ev-scroll-hist-${scroll.id}-${entry.at}`,
      timestamp: entry.at,
      type: isStatusChange ? '状态变更' : '状态变更',
      source: 'scrolls',
      sourceId: scroll.id,
      title: `${entry.action}`,
      detail: entry.note || '',
      meta: { action: entry.action }
    });
  }
  for (const repair of db.repairs || []) {
    if (repair.scrollId !== scrollId) continue;
    events.push({
      id: `ev-repair-create-${repair.id}`,
      timestamp: repair.createdAt,
      type: '修补',
      source: 'repairs',
      sourceId: repair.id,
      title: `修补：${repair.process}（${repair.status}）`,
      detail: `修补人员：${repair.conservator || '-'}，日期：${repair.date || '-'}${repair.materialUsed ? '，材料：' + repair.materialUsed : ''}${repair.note ? '，' + repair.note : ''}`,
      meta: { process: repair.process, status: repair.status }
    });
    for (const entry of repair.history || []) {
      if (entry.action === '创建') continue;
      events.push({
        id: `ev-repair-hist-${repair.id}-${entry.at}`,
        timestamp: entry.at,
        type: '修补',
        source: 'repairs',
        sourceId: repair.id,
        title: `修补${entry.action}`,
        detail: entry.note || '',
        meta: { process: repair.process, action: entry.action }
      });
    }
  }
  for (const loan of db.loans || []) {
    if (loan.scrollId !== scrollId) continue;
    const loanTypeMap = { '待审批': '借阅', '已批准': '借阅', '已借出': '借阅', '已归还': '归还', '已拒绝': '借阅' };
    for (const entry of loan.history || []) {
      const evType = entry.action === '归还' ? '归还' : (entry.action === '创建' ? '借阅' : loanTypeMap[entry.action] || '借阅');
      events.push({
        id: `ev-loan-hist-${loan.id}-${entry.at}`,
        timestamp: entry.at,
        type: evType,
        source: 'loans',
        sourceId: loan.id,
        title: `${entry.action}：${loan.borrower || '-'} - ${loan.purpose || '-'}`,
        detail: entry.note || '',
        meta: { borrower: loan.borrower, purpose: loan.purpose, status: loan.status, borrowDate: loan.borrowDate, dueDate: loan.dueDate }
      });
    }
  }
  for (const imaging of db.imagings || []) {
    if (imaging.scrollId !== scrollId) continue;
    events.push({
      id: `ev-imaging-${imaging.id}`,
      timestamp: imaging.createdAt,
      type: '影像采集',
      source: 'imagings',
      sourceId: imaging.id,
      title: `影像采集：${imaging.batch || '-'}（${imaging.clarity || '-'}）`,
      detail: `拍摄人员：${imaging.photographer || '-'}，影像编号：${imaging.imageCode || '-'}${imaging.note ? '，' + imaging.note : ''}`,
      meta: { clarity: imaging.clarity, batch: imaging.batch }
    });
    for (const entry of imaging.history || []) {
      if (entry.action === '创建') continue;
      events.push({
        id: `ev-imaging-hist-${imaging.id}-${entry.at}`,
        timestamp: entry.at,
        type: '影像采集',
        source: 'imagings',
        sourceId: imaging.id,
        title: `影像${entry.action}`,
        detail: entry.note || '',
        meta: { clarity: imaging.clarity }
      });
    }
  }
  for (const inv of db.inventories || []) {
    if (inv.scrollId !== scrollId) continue;
    events.push({
      id: `ev-inventory-${inv.id}`,
      timestamp: inv.createdAt,
      type: '盘点',
      source: 'inventories',
      sourceId: inv.id,
      title: `盘点：${inv.cabinet || '-'}（${inv.result || '-'}）`,
      detail: `盘点人：${inv.inventoryPerson || '-'}，日期：${inv.inventoryDate || '-'}${inv.exceptionNote ? '，异常：' + inv.exceptionNote : ''}`,
      meta: { result: inv.result, status: inv.status }
    });
    for (const entry of inv.history || []) {
      if (entry.action === '创建') continue;
      events.push({
        id: `ev-inventory-hist-${inv.id}-${entry.at}`,
        timestamp: entry.at,
        type: '盘点',
        source: 'inventories',
        sourceId: inv.id,
        title: `盘点${entry.action}`,
        detail: entry.note || '',
        meta: { result: inv.result }
      });
    }
  }
  for (const obs of db.observations || []) {
    if (obs.scrollId !== scrollId) continue;
    events.push({
      id: `ev-obs-${obs.id}`,
      timestamp: obs.createdAt,
      type: '人工观察',
      source: 'observations',
      sourceId: obs.id,
      title: `人工观察：${obs.observer || '-'}`,
      detail: obs.content || '',
      meta: { observer: obs.observer }
    });
  }
  for (const batch of db.repairBatches || []) {
    if (batch.scrollId !== scrollId) continue;
    events.push({
      id: `ev-batch-${batch.id}`,
      timestamp: batch.createdAt,
      type: '修补批次',
      source: 'repairBatches',
      sourceId: batch.id,
      title: `修补批次：${batch.templateName || '-'}（${batch.status || '-'}）`,
      detail: `负责人：${batch.conservator || '-'}，进度：${batch.progressSummary || '-'}${batch.note ? '，' + batch.note : ''}`,
      meta: { templateName: batch.templateName, status: batch.status }
    });
    for (const entry of batch.history || []) {
      if (entry.action === '创建') continue;
      events.push({
        id: `ev-batch-hist-${batch.id}-${entry.at}`,
        timestamp: entry.at,
        type: '修补批次',
        source: 'repairBatches',
        sourceId: batch.id,
        title: `批次${entry.action}`,
        detail: entry.note || '',
        meta: { templateName: batch.templateName }
      });
    }
  }
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json({ scrollId, scrollTitle: scroll.title, events });
});

app.post('/api/scrolls/:id/observation', async (req, res) => {
  const db = await readDb();
  const scrollId = req.params.id;
  const scroll = (db.scrolls || []).find((s) => s.id === scrollId);
  if (!scroll) return res.status(404).json({ error: '经卷不存在' });
  const { observer, content } = req.body || {};
  if (!observer || !content) return res.status(400).json({ error: '观察人和观察内容不能为空' });
  if (!Array.isArray(db.observations)) db.observations = [];
  const now = new Date().toISOString();
  const item = {
    id: `obs-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    scrollId,
    observer,
    content,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, action: '创建', note: content }]
  };
  db.observations.push(item);
  await writeDb(db);
  res.status(201).json(item);
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/db', async (req, res) => {
  const db = await readDb();
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) db[key].sort(sortNewest);
  }
  res.json(db);
});

app.get('/api/loans/calendar', async (req, res) => {
  const db = await readDb();
  const data = getActiveLoansByScroll(db);
  res.json(data);
});

app.get('/api/loans/check-conflict', async (req, res) => {
  const db = await readDb();
  const { scrollId, borrowDate, dueDate, excludeId } = req.query;
  if (!scrollId || !borrowDate || !dueDate) {
    return res.status(400).json({ error: '缺少必要参数：scrollId, borrowDate, dueDate' });
  }
  const conflicts = checkLoanConflict(db, scrollId, borrowDate, dueDate, excludeId);
  res.json({ conflicts, hasConflict: conflicts.length > 0 });
});

app.get('/api/loans/assess/:id', async (req, res) => {
  const db = await readDb();
  const loan = (db.loans || []).find((l) => l.id === req.params.id);
  if (!loan) return res.status(404).json({ error: '借阅申请不存在' });
  const assessment = assessLoanRisk(db, loan);
  res.json(assessment);
});

app.get('/api/repair-batches/:id/tasks', async (req, res) => {
  const db = await readDb();
  const batchId = req.params.id;
  const tasks = (db.repairs || []).filter((r) => r.batchId === batchId);
  res.json(tasks);
});

app.post('/api/loans/assess-preview', async (req, res) => {
  const db = await readDb();
  const assessment = assessLoanRisk(db, req.body || {});
  res.json(assessment);
});

app.post('/api/:collection', async (req, res) => {
  const db = await readDb();
  const { collection } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });

  if (collection === 'loans') {
    const { scrollId, borrowDate, dueDate } = req.body;
    if (scrollId && borrowDate && dueDate) {
      const conflicts = checkLoanConflict(db, scrollId, borrowDate, dueDate);
      if (conflicts.length > 0) {
        const conflictInfo = conflicts.map((c) => `${c.borrower}（${c.borrowDate} 至 ${c.dueDate}，状态：${c.status}）`).join('；');
        return res.status(409).json({
          error: `日期冲突：该经卷在 ${borrowDate} 至 ${dueDate} 期间已被预约。冲突记录：${conflictInfo}`,
          conflicts
        });
      }
    }
  }

  if (collection === 'repairBatches') {
    const { templateId, scrollId, conservator, startDate } = req.body;
    if (!templateId || !scrollId || !conservator || !startDate) {
      return res.status(400).json({ error: '缺少必要参数：templateId, scrollId, conservator, startDate' });
    }
    const template = (db.repairTemplates || []).find((t) => t.id === templateId);
    if (!template) return res.status(404).json({ error: '修补方案模板不存在' });
    if (template.status === '停用') return res.status(409).json({ error: '该模板已停用，无法生成修补方案' });
    const processList = (template.processes || '').split('\n').map((p) => p.trim()).filter(Boolean);
    if (!processList.length) return res.status(409).json({ error: '模板中无有效工序' });

    const now = new Date().toISOString();
    const batchId = `repairBatches-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const batchItem = {
      id: batchId,
      scrollId,
      templateId,
      templateName: template.name,
      conservator,
      startDate,
      status: '进行中',
      progressSummary: `0/${processList.length} 已完成`,
      note: req.body.note || '',
      createdAt: now,
      updatedAt: now,
      history: [stamp('创建', `从模板"${template.name}"生成${processList.length}道工序`)]
    };

    const repairItems = processList.map((processName) => ({
      id: `repairs-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      scrollId,
      batchId,
      process: processName,
      conservator,
      date: startDate,
      status: '计划中',
      materialUsed: '',
      note: `由模板"${template.name}"生成`,
      createdAt: now,
      updatedAt: now,
      history: [stamp('创建', `批次生成：${processName}`)]
    }));

    if (!Array.isArray(db.repairBatches)) db.repairBatches = [];
    db.repairBatches.push(batchItem);
    for (const r of repairItems) {
      db.repairs.push(r);
    }

    const scroll = (db.scrolls || []).find((s) => s.id === scrollId);
    if (scroll && scroll.borrowStatus !== '修补中') {
      scroll.borrowStatus = '修补中';
      scroll.updatedAt = now;
      scroll.history = scroll.history || [];
      scroll.history.unshift(stamp('修补中', `启动修补批次"${template.name}"`));
    }

    await writeDb(db);
    return res.status(201).json({ batch: batchItem, repairs: repairItems });
  }

  const now = new Date().toISOString();
  const item = {
    id: `${collection}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    ...req.body,
    createdAt: now,
    updatedAt: now
  };

  if (collection === 'loans') {
    const assessment = assessLoanRisk(db, item);
    item.riskAssessment = assessment;
    const riskNote = formatRiskNote(assessment, '创建');
    const originalNote = req.body.note || req.body.memo || req.body.reason || '';
    item.history = [stamp('创建', originalNote ? `${originalNote} | ${riskNote}` : riskNote)];
  } else {
    item.history = [stamp('创建', req.body.note || req.body.memo || '')];
  }

  db[collection].push(item);
  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });

  if (collection === 'loans') {
    const scrollId = req.body.scrollId || item.scrollId;
    const borrowDate = req.body.borrowDate || item.borrowDate;
    const dueDate = req.body.dueDate || item.dueDate;
    if (scrollId && borrowDate && dueDate) {
      const conflicts = checkLoanConflict(db, scrollId, borrowDate, dueDate, id);
      if (conflicts.length > 0) {
        const conflictInfo = conflicts.map((c) => `${c.borrower}（${c.borrowDate} 至 ${c.dueDate}，状态：${c.status}）`).join('；');
        return res.status(409).json({
          error: `日期冲突：该经卷在 ${borrowDate} 至 ${dueDate} 期间已被预约。冲突记录：${conflictInfo}`,
          conflicts
        });
      }
    }
  }

  const historyAction = req.body.historyAction;
  delete req.body.historyAction;
  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });

  if (collection === 'loans' && (req.body.scrollId || req.body.borrowDate || req.body.dueDate || req.body.purpose)) {
    const mergedLoan = { ...item, ...req.body };
    const assessment = assessLoanRisk(db, mergedLoan);
    item.riskAssessment = assessment;
  }

  if (collection === 'repairs' && req.body.status) {
    const justCompleted = req.body.status === '已完成' && item.status !== '已完成';
    if (item.batchId) {
      const batch = db.repairBatches?.find((b) => b.id === item.batchId);
      if (batch) {
        const batchRepairs = db.repairs.filter((r) => r.batchId === batch.id);
        const countMap = {};
        for (const r of batchRepairs) {
          const s = r.id === item.id ? req.body.status : r.status;
          countMap[s] = (countMap[s] || 0) + 1;
        }
        const completedCount = countMap['已完成'] || 0;
        const totalCount = batchRepairs.length;
        const wasAllDone = batch.status === '已完成';
        batch.progressSummary = `${completedCount}/${totalCount} 已完成`;
        batch.updatedAt = new Date().toISOString();
        batch.history = batch.history || [];
        if (completedCount === totalCount) {
          if (!wasAllDone) {
            batch.status = '已完成';
            batch.history.unshift(stamp('批次完成', '所有修补工序已完成'));
            const scroll = db.scrolls?.find((s) => s.id === batch.scrollId);
            if (scroll) {
              scroll.borrowStatus = '需审批';
              scroll.updatedAt = new Date().toISOString();
              scroll.history = scroll.history || [];
              scroll.history.unshift(stamp('修补完成', `修补批次"${batch.templateName}"全部工序完成，转入需审批`));
            }
          }
        } else if (justCompleted) {
          batch.history.unshift(stamp('进度更新', `${item.process}已完成（${completedCount}/${totalCount}）`));
        }
      }
    } else if (justCompleted) {
      const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
      if (scroll) {
        scroll.borrowStatus = '需审批';
        scroll.updatedAt = new Date().toISOString();
        scroll.history = scroll.history || [];
        scroll.history.unshift(stamp('修补完成', `${item.process}修补完成，转入需审批`));
      }
    }
  }

  item.history = item.history || [];
  if (historyAction || req.body.note || req.body.memo || req.body.status) {
    item.history.unshift(stamp(historyAction || req.body.status || '更新', req.body.note || req.body.memo || ''));
  }
  await writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const db = await readDb();
  const { collection, id } = req.params;
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });
  await writeDb(db);
  res.status(204).end();
});

app.post('/api/action/:actionId/:id', async (req, res) => {
  const db = await readDb();
  const action = config.actions.find((entry) => entry.id === req.params.actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  const item = db[action.collection]?.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const result = runAction(db, action, item);
  if (result.error) return res.status(409).json({ error: result.error });

  if (action.id === 'repair-done') {
    if (item.batchId) {
      const batch = db.repairBatches?.find((b) => b.id === item.batchId);
      if (batch) {
        const batchRepairs = db.repairs.filter((r) => r.batchId === batch.id);
        const completedCount = batchRepairs.filter((r) => r.status === '已完成').length;
        const totalCount = batchRepairs.length;
        batch.progressSummary = `${completedCount}/${totalCount} 已完成`;
        batch.updatedAt = new Date().toISOString();
        batch.history = batch.history || [];
        if (completedCount === totalCount && batch.status !== '已完成') {
          batch.status = '已完成';
          batch.history.unshift(stamp('批次完成', '所有修补工序已完成'));
          const scroll = db.scrolls?.find((s) => s.id === batch.scrollId);
          if (scroll) {
            scroll.borrowStatus = '需审批';
            scroll.updatedAt = new Date().toISOString();
            scroll.history = scroll.history || [];
            scroll.history.unshift(stamp('修补完成', `修补批次"${batch.templateName}"全部工序完成，转入需审批`));
          }
        } else {
          batch.history.unshift(stamp('进度更新', `${item.process}已完成（${completedCount}/${totalCount}）`));
        }
      }
    } else {
      const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
      if (scroll) {
        scroll.borrowStatus = '需审批';
        scroll.updatedAt = new Date().toISOString();
        scroll.history = scroll.history || [];
        scroll.history.unshift(stamp('修补完成', `${item.process}修补完成，转入需审批`));
      }
    }
  }

  await writeDb(db);
  res.json(result.item);
});

function getValue(source, pathName) {
  return pathName.split('.').reduce((value, key) => value?.[key], source);
}

function setValue(target, pathName, value) {
  const keys = pathName.split('.');
  let cursor = target;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
}

function findRelated(db, relation, item) {
  return db[relation.collection]?.find((entry) => entry.id === item[relation.localKey]);
}

function runAction(db, action, item) {
  const related = action.relation ? findRelated(db, action.relation, item) : null;
  const context = { item, related };
  const levelRank = { '低': 1, '中': 2, '高': 3 };
  for (const guard of action.guards || []) {
    const left = getValue(context, guard.left);
    const right = guard.rightPath ? getValue(context, guard.rightPath) : guard.right;
    if (guard.op === 'missing' && left) continue;
    if (guard.op === 'missing' && !left) return { error: guard.message };
    if (guard.op === 'eq' && left !== right) return { error: guard.message };
    if (guard.op === 'neq' && left === right) return { error: guard.message };
    if (guard.op === 'gte' && Number(left) < Number(right)) return { error: guard.message };
    if (guard.op === 'levelGte' && (levelRank[left] || 0) < (levelRank[right] || 0)) return { error: guard.message };
    if (guard.op === 'notIn' && guard.values.includes(left)) return { error: guard.message };
  }
  if (action.collection === 'loans') {
    const statusPatch = action.patches?.find((p) => p.field === 'status' && p.target !== 'related');
    const targetStatus = statusPatch?.value;
    if (targetStatus && ACTIVE_LOAN_STATUSES.includes(targetStatus)) {
      if (item.scrollId && item.borrowDate && item.dueDate) {
        const conflicts = checkLoanConflict(db, item.scrollId, item.borrowDate, item.dueDate, item.id);
        if (conflicts.length > 0) {
          const conflictInfo = conflicts.map((c) => `${c.borrower}（${c.borrowDate} 至 ${c.dueDate}，状态：${c.status}）`).join('；');
          return {
            error: `日期冲突：无法${action.label}，该经卷在 ${item.borrowDate} 至 ${item.dueDate} 期间已有预约。冲突记录：${conflictInfo}`,
            conflicts
          };
        }
      }
    }
  }

  let assessment = null;
  if (action.collection === 'loans') {
    assessment = assessLoanRisk(db, item);
    item.riskAssessment = assessment;
  }

  for (const patch of action.patches || []) {
    const target = patch.target === 'related' ? related : item;
    if (!target) continue;
    const next = patch.valuePath ? getValue(context, patch.valuePath) : patch.value;
    setValue(target, patch.field, next);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];

    if (action.collection === 'loans' && assessment && patch.target !== 'related') {
      const riskNote = formatRiskNote(assessment, action.label);
      const baseNote = action.note || '状态流转';
      target.history.unshift(stamp(action.label, `${baseNote} | ${riskNote}`));
    } else {
      target.history.unshift(stamp(action.label, action.note || '状态流转'));
    }
  }
  for (const delta of action.deltas || []) {
    const target = delta.target === 'related' ? related : item;
    if (!target) continue;
    const sourceAmount = delta.amountPath ? Number(getValue(context, delta.amountPath)) : 1;
    const multiplier = delta.amount === undefined ? 1 : Number(delta.amount);
    const amount = sourceAmount * multiplier;
    const current = Number(getValue({ target }, `target.${delta.field}`) || 0);
    setValue(target, delta.field, current + amount);
    target.updatedAt = new Date().toISOString();
    target.history = target.history || [];
    target.history.unshift(stamp(action.label, action.note || '数量调整'));
  }
  return { item };
}

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
