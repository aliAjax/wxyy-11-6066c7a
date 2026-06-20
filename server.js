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
