const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const config = require('./project.config');
const PORT = process.env.PORT || config.port || 3900;
const DB_FILE = path.join(__dirname, 'data', 'db.json');

const ROLES = {
  admin: {
    id: 'admin',
    name: '管理员',
    description: '拥有全部操作权限'
  },
  conservator: {
    id: 'conservator',
    name: '修补人员',
    description: '负责修补、影像采集、盘点等操作'
  },
  approver: {
    id: 'approver',
    name: '借阅审批人',
    description: '负责借阅审批、借出归还'
  },
  guest: {
    id: 'guest',
    name: '只读访客',
    description: '只能查看，不能修改'
  }
};

const DEFAULT_ROLE = 'admin';

const PERMISSIONS = {
  scrolls: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin'],
    update: ['admin'],
    delete: ['admin'],
    statusChange: ['admin']
  },
  repairs: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator'],
    update: ['admin', 'conservator'],
    delete: ['admin'],
    statusChange: ['admin', 'conservator']
  },
  repairBatches: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator'],
    update: ['admin', 'conservator'],
    delete: ['admin'],
    statusChange: ['admin', 'conservator']
  },
  repairTemplates: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator'],
    update: ['admin', 'conservator'],
    delete: ['admin'],
    statusChange: ['admin', 'conservator']
  },
  loans: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator', 'approver'],
    update: ['admin', 'approver'],
    delete: ['admin'],
    approve: ['admin', 'approver'],
    reject: ['admin', 'approver'],
    lend: ['admin', 'approver'],
    return: ['admin', 'approver']
  },
  imagings: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator'],
    update: ['admin', 'conservator'],
    delete: ['admin'],
    statusChange: ['admin', 'conservator']
  },
  inventories: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator'],
    update: ['admin', 'conservator'],
    delete: ['admin'],
    statusChange: ['admin', 'conservator']
  },
  materials: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin'],
    update: ['admin'],
    delete: ['admin'],
    statusChange: ['admin']
  },
  observations: {
    view: ['admin', 'conservator', 'approver', 'guest'],
    create: ['admin', 'conservator', 'approver'],
    update: ['admin'],
    delete: ['admin']
  },
  audits: {
    view: ['admin'],
    create: [],
    update: [],
    delete: []
  }
};

function getCurrentRole(req) {
  const role = req.headers['x-user-role'] || DEFAULT_ROLE;
  return ROLES[role] ? role : DEFAULT_ROLE;
}

function getCurrentUser(req) {
  let name = req.headers['x-user-name'] || '系统';
  try {
    if (/^%[0-9A-Fa-f]{2}/.test(name)) {
      name = decodeURIComponent(name);
    }
  } catch (e) {
    // 解码失败则使用原始值
  }
  return name;
}

function hasPermission(role, collection, action) {
  const perms = PERMISSIONS[collection];
  if (!perms) return false;
  const allowed = perms[action];
  if (!allowed) return false;
  return allowed.includes(role);
}

function requirePermission(collection, action) {
  return (req, res, next) => {
    const col = collection.startsWith(':') ? req.params[collection.slice(1)] : collection;
    const act = action.startsWith(':') ? req.params[action.slice(1)] : action;
    const role = getCurrentRole(req);
    if (!hasPermission(role, col, act)) {
      const roleInfo = ROLES[role];
      return res.status(403).json({
        error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(col)}的${actionLabel(act)}权限`,
        role: role,
        roleName: roleInfo?.name || role,
        collection: col,
        action: act
      });
    }
    next();
  };
}

function collectionLabel(collection) {
  const labels = {
    scrolls: '经卷档案',
    repairs: '修补记录',
    repairBatches: '修补批次',
    repairTemplates: '修补方案模板',
    loans: '借阅申请',
    imagings: '影像采集',
    inventories: '柜位盘点',
    materials: '修补材料',
    observations: '人工观察记录',
    audits: '审计日志'
  };
  return labels[collection] || collection;
}

function actionLabel(action) {
  const labels = {
    view: '查看',
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
  return labels[action] || action;
}

async function writeAuditLog(db, req, options = {}) {
  const { collection, itemId, itemTitle, action, changes, note } = options;
  const role = getCurrentRole(req);
  const operator = getCurrentUser(req);
  const roleInfo = ROLES[role];

  const logEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    operator: operator,
    operatorRole: role,
    operatorRoleName: roleInfo?.name || role,
    collection: collection,
    collectionLabel: collectionLabel(collection),
    itemId: itemId || null,
    itemTitle: itemTitle || null,
    action: action,
    actionLabel: actionLabel(action),
    changes: changes || null,
    note: note || '',
    ip: req.ip || req.connection?.remoteAddress || ''
  };

  if (!Array.isArray(db.audits)) db.audits = [];
  db.audits.unshift(logEntry);
  return logEntry;
}

const ACTIVE_LOAN_STATUSES = ['待审批', '条件批准', '已批准', '已借出'];

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

const PROTECTION_ADVICE_RULES = {
  damage: {
    '虫蛀': [
      '经卷存在虫蛀痕迹，需立即放入低温冷冻柜进行杀虫处理（-18℃冷冻72小时）',
      '处理后置于密封盒中，内放樟脑丸或芸香草以防再次虫害',
      '检查相邻经卷是否受波及，必要时整柜熏蒸'
    ],
    '霉斑': [
      '发现霉斑需立即隔离存放，避免霉菌扩散',
      '用软毛刷轻轻扫去表面霉斑，配合75%乙醇棉片轻擦消毒',
      '存放环境需严格控湿（相对湿度45%-55%），定期更换干燥剂'
    ],
    '脆化': [
      '纸张脆化严重，严禁任何翻阅和展示操作',
      '须进行托裱加固处理，优先使用古法托裱工艺',
      '处理后装入定制无酸纸套，平放于恒湿柜中永久保存'
    ],
    '脆裂': [
      '纸张脆裂需进行托裱加固，注意拼接处纹理对齐',
      '脆裂部位避免受力，操作时使用软纸衬垫',
      '建议制作仿真复制本供查阅使用，原件封存'
    ],
    '碳化': [
      '碳化经卷属极危状态，禁止一切物理接触',
      '须请专业文物保护机构评估，制定专项修复方案',
      '存放于充氮密封盒中，避免光照和温度波动'
    ],
    '残损': [
      '残损部位需进行补纸修复，选配与原纸材质相近的补纸',
      '修复前后均需进行高清影像采集留档',
      '修复后静养至少7日再进行其他操作'
    ],
    '断裂': [
      '断裂处需使用小麦浆糊进行粘接，注意纤维方向对齐',
      '粘接后夹入吸水纸压平，室温下自然干燥',
      '断裂严重者需进行整卷托裱处理'
    ],
    '撕裂': [
      '撕裂边缘先展平处理，再用同质地补纸进行隐补',
      '修复过程中避免二次撕裂，操作须由熟练修补人员完成',
      '补纸颜色需与原件协调，修复痕迹应尽量隐蔽'
    ],
    '脱落': [
      '脱落碎片需单独收集封存，注明对应位置',
      '进行拼接复原后用浆糊逐片粘接加固',
      '重要脱落部位建议制作前后对比影像记录'
    ],
    '水渍': [
      '水渍经卷需先进行干燥处理，夹多层吸水纸压平',
      '每日更换吸水纸，直至完全干燥（约3-5天）',
      '干燥后检查是否有晕染或粘连，必要时进行揭裱处理'
    ],
    '磨损': [
      '磨损部位可进行隐补加固，保护纸张纤维',
      '建议减少翻阅频次，查阅优先使用影印本',
      '函套内增加软纸衬垫，减少开合摩擦'
    ],
    '褶皱': [
      '褶皱处需用喷壶轻喷水雾后，隔纸用低温熨斗展平',
      '严重褶皱需进行托裱处理，注意张力均匀',
      '平时存放应保持平放，避免堆叠挤压'
    ],
    '脱胶': [
      '脱胶部位重新涂刷小麦浆糊粘接，压平干燥',
      '检查整卷其他部位是否存在脱胶隐患',
      '装函前确认粘接处完全干燥，防止粘连'
    ],
    '卷曲': [
      '卷曲经卷需展平处理，可隔纸用重物轻压',
      '极度卷曲者需进行回潮后逐步展平，不可强行拉直',
      '存放时保持平放，恒湿环境可减少卷曲复发'
    ],
    '受潮': [
      '立即转移至干燥通风环境，避免阳光直射',
      '用吸水纸吸去表面湿气，夹纸压平自然阴干',
      '检查是否有霉斑产生迹象，必要时进行预防性消毒'
    ],
    '潮湿': [
      '立即转移至干燥通风环境，避免阳光直射',
      '用吸水纸吸去表面湿气，夹纸压平自然阴干',
      '检查是否有霉斑产生迹象，必要时进行预防性消毒'
    ]
  },
  protectionLevel: {
    '一级': [
      '【一级保护】原件仅限馆内特藏室查阅，须两人以上在场',
      '【一级保护】禁止外借展出，如需展示须使用高仿复制件',
      '【一级保护】每季度进行一次外观检查，每年做一次专业除尘',
      '【一级保护】存放于恒温恒湿柜（温度18-22℃，湿度45-55%）'
    ],
    '二级': [
      '【二级保护】馆内查阅需经部门负责人审批',
      '【二级保护】外借展览须馆长批准，运输使用专用防震箱',
      '【二级保护】每半年进行一次全面状态检查',
      '【二级保护】存放于恒湿柜中，避免阳光直射'
    ],
    '三级': [
      '【三级保护】馆内查阅正常登记即可',
      '【三级保护】短期外借可由部门负责人审批',
      '【三级保护】每年进行一次状态盘点检查',
      '【三级保护】存放于普通文物柜即可，注意防潮防尘'
    ]
  },
  borrowStatus: {
    '限制借阅': [
      '当前限制借阅：如需使用须提交专项申请，由馆长办公会审议',
      '限制期间加强日常巡检频次，每周检查一次存放状态'
    ],
    '修补中': [
      '修补进行中：操作区域须保持温湿度稳定，避免无关人员接触',
      '每日记录修补进度和经卷状态变化，重要工序前后拍照留档'
    ],
    '需审批': [
      '借阅需审批：使用前须评估用途风险，查阅时在旁监护',
      '归还时须当面检查经卷状态，确认完好后签收归档'
    ],
    '可借阅': [
      '借阅状态正常：仍需遵守轻取轻放原则，查阅时佩戴干净手套',
      '归还时检查有无新增损伤，异常情况及时登记报告'
    ]
  }
};

function generateProtectionAdvice(scroll) {
  const damage = (scroll.damage || '').trim();
  const protectionLevel = scroll.protectionLevel || '三级';
  const borrowStatus = scroll.borrowStatus || '可借阅';
  const advice = [];
  const matchedDamageLabels = [];

  for (const keyword in PROTECTION_ADVICE_RULES.damage) {
    if (damage.includes(keyword)) {
      const rules = PROTECTION_ADVICE_RULES.damage[keyword];
      for (const rule of rules) {
        if (!advice.includes(rule)) {
          advice.push(rule);
        }
      }
      const labelMatch = DAMAGE_KEYWORDS.find((k) => k.keywords.includes(keyword));
      if (labelMatch && !matchedDamageLabels.includes(labelMatch.label)) {
        matchedDamageLabels.push(labelMatch.label);
      }
    }
  }

  const levelRules = PROTECTION_ADVICE_RULES.protectionLevel[protectionLevel] || [];
  for (const rule of levelRules) {
    if (!advice.includes(rule)) {
      advice.push(rule);
    }
  }

  const statusRules = PROTECTION_ADVICE_RULES.borrowStatus[borrowStatus] || [];
  for (const rule of statusRules) {
    if (!advice.includes(rule)) {
      advice.push(rule);
    }
  }

  if (advice.length === 0) {
    advice.push('经卷保存状态良好，按常规流程入藏管理即可');
    advice.push('建议每半年进行一次例行检查，注意防虫防潮');
  }

  return {
    content: advice.join('\n'),
    suggestions: advice,
    damageLabels: matchedDamageLabels,
    protectionLevel,
    borrowStatus,
    generatedAt: new Date().toISOString()
  };
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

function getActiveLoansByScroll(db, filters = {}) {
  const { scrollIdFilter, statusFilter, riskLevelFilter } = filters;
  const result = {};
  const scrolls = db.scrolls || [];
  const loans = db.loans || [];
  for (const scroll of scrolls) {
    if (scrollIdFilter && scroll.id !== scrollIdFilter) continue;
    result[scroll.id] = {
      scrollId: scroll.id,
      title: scroll.title,
      borrowStatus: scroll.borrowStatus,
      reservations: []
    };
  }
  for (const loan of loans) {
    if (!ACTIVE_LOAN_STATUSES.includes(loan.status)) continue;
    if (scrollIdFilter && loan.scrollId !== scrollIdFilter) continue;
    if (statusFilter && loan.status !== statusFilter) continue;
    if (!result[loan.scrollId]) continue;
    let riskAssessment = loan.riskAssessment || null;
    if (!riskAssessment) {
      try {
        riskAssessment = assessLoanRisk(db, loan);
      } catch (e) {
        riskAssessment = {
          level: '低风险',
          score: 0,
          reasons: ['风险评估暂缺'],
          evaluatedAt: new Date().toISOString(),
          isStrictMode: false
        };
      }
    }
    if (riskLevelFilter && riskAssessment?.level !== riskLevelFilter) continue;
    result[loan.scrollId].reservations.push({
      id: loan.id,
      borrower: loan.borrower,
      purpose: loan.purpose,
      borrowDate: loan.borrowDate,
      dueDate: loan.dueDate,
      status: loan.status,
      conditions: loan.conditions || null,
      conditionsSummary: loan.conditionsSummary || '',
      conditionsNote: loan.conditionsNote || '',
      riskAssessment
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

const DEFAULT_MATERIAL_LOW_STOCK = {
  '张': 20, '瓶': 3, '套': 3, '把': 2,
  '袋': 5, '米': 10, '卷': 5, '盒': 2, '个': 5
};
const DEFAULT_EXPIRY_WARN_DAYS = 30;

function materialWarningConfig() {
  return {
    lowStockThresholds: config.materialWarning?.lowStockThresholds || DEFAULT_MATERIAL_LOW_STOCK,
    expiryWarningDays: Number(config.materialWarning?.expiryWarningDays) || DEFAULT_EXPIRY_WARN_DAYS
  };
}

function computeMaterialStatus(m) {
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

function getBatchRepairsSorted(db, batchId) {
  const repairs = (db.repairs || []).filter((r) => r.batchId === batchId);
  repairs.sort((a, b) => {
    const orderA = a.sortOrder !== undefined ? a.sortOrder : 999;
    const orderB = b.sortOrder !== undefined ? b.sortOrder : 999;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
  repairs.forEach((r, idx) => {
    if (r.sortOrder === undefined) {
      r.sortOrder = idx;
    }
  });
  return repairs;
}

function computeTaskLockInfo(db, task) {
  if (!task.batchId) {
    return { isLocked: false, lockReason: '', canStart: true, canComplete: true, canRevert: true };
  }
  const batchRepairs = getBatchRepairsSorted(db, task.batchId);
  const taskIndex = batchRepairs.findIndex((r) => r.id === task.id);
  if (taskIndex < 0) {
    return { isLocked: false, lockReason: '', canStart: true, canComplete: true, canRevert: true };
  }

  const isFirst = taskIndex === 0;
  const prevTask = isFirst ? null : batchRepairs[taskIndex - 1];
  const nextTask = taskIndex >= batchRepairs.length - 1 ? null : batchRepairs[taskIndex + 1];

  const prevCompleted = !prevTask || prevTask.status === '已完成';
  const nextStarted = nextTask && nextTask.status !== '计划中';

  let isLocked = false;
  let lockReason = '';
  let canStart = true;
  let canComplete = true;
  let canRevert = true;

  if (!prevCompleted && task.status !== '已完成') {
    isLocked = true;
    lockReason = `前序工序"${prevTask.process}"未完成，暂不可开始`;
    canStart = false;
    canComplete = false;
  }

  if (nextStarted && task.status === '已完成') {
    canRevert = false;
  }

  return {
    isLocked,
    lockReason,
    canStart,
    canComplete,
    canRevert,
    sortOrder: task.sortOrder !== undefined ? task.sortOrder : taskIndex,
    totalCount: batchRepairs.length,
    prevTask: prevTask ? { id: prevTask.id, process: prevTask.process, status: prevTask.status } : null,
    nextTask: nextTask ? { id: nextTask.id, process: nextTask.process, status: nextTask.status } : null
  };
}

function validateTaskStatusChange(db, taskId, newStatus, oldStatus) {
  const task = (db.repairs || []).find((r) => r.id === taskId);
  if (!task) return { valid: true, reason: '' };
  if (!task.batchId) return { valid: true, reason: '' };
  if (newStatus === oldStatus) return { valid: true, reason: '' };

  const lockInfo = computeTaskLockInfo(db, task);

  const becomingActive = newStatus === '进行中';
  const becomingDone = newStatus === '已完成';
  const reverting = oldStatus === '已完成' && newStatus !== '已完成';

  if (becomingActive && !lockInfo.canStart) {
    return { valid: false, reason: lockInfo.lockReason || '无法开始此工序' };
  }
  if (becomingDone && !lockInfo.canComplete) {
    return { valid: false, reason: lockInfo.lockReason || '无法完成此工序' };
  }
  if (reverting && !lockInfo.canRevert) {
    return { valid: false, reason: `后序工序"${lockInfo.nextTask?.process}"已开始，无法回退此工序` };
  }

  return { valid: true, reason: '' };
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
    const isAdviceUpdate = entry.action === '保护建议更新';
    const isStatusChange = ['保护评估', '状态变更', '可借阅', '需审批', '修补中', '限制借阅'].includes(entry.action);
    events.push({
      id: `ev-scroll-hist-${scroll.id}-${entry.at}`,
      timestamp: entry.at,
      type: isAdviceUpdate ? '保护建议' : (isStatusChange ? '状态变更' : '状态变更'),
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
    const loanTypeMap = { '待审批': '借阅', '条件批准': '借阅', '已批准': '借阅', '已借出': '借阅', '已归还': '归还', '已拒绝': '借阅' };
    for (const entry of loan.history || []) {
      const evType = entry.action === '归还' ? '归还' : (entry.action === '创建' ? '借阅' : loanTypeMap[entry.action] || '借阅');
      let detail = entry.note || '';
      if (loan.conditionsSummary) {
        detail = detail ? `${detail} | 保护条件：${loan.conditionsSummary}` : `保护条件：${loan.conditionsSummary}`;
      }
      events.push({
        id: `ev-loan-hist-${loan.id}-${entry.at}`,
        timestamp: entry.at,
        type: evType,
        source: 'loans',
        sourceId: loan.id,
        title: `${entry.action}：${loan.borrower || '-'} - ${loan.purpose || '-'}`,
        detail: detail,
        meta: { borrower: loan.borrower, purpose: loan.purpose, status: loan.status, borrowDate: loan.borrowDate, dueDate: loan.dueDate, conditions: loan.conditions || null, conditionsSummary: loan.conditionsSummary || '' }
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
  res.json({
    scrollId,
    scrollTitle: scroll.title,
    scrollBorrowStatus: scroll.borrowStatus,
    scrollProtectionLevel: scroll.protectionLevel,
    protectionAdvice: scroll.protectionAdvice || null,
    events
  });
});

app.post('/api/scrolls/:id/observation', async (req, res) => {
  const role = getCurrentRole(req);
  if (!hasPermission(role, 'observations', 'create')) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有人工观察记录的新增权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: 'observations',
      action: 'create'
    });
  }

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

  await writeAuditLog(db, req, {
    collection: 'observations',
    itemId: item.id,
    itemTitle: observer,
    action: 'create',
    changes: { observer, content },
    note: `经卷：${scroll.title} - ${content.slice(0, 50)}`
  });

  await writeDb(db);
  res.status(201).json(item);
});

app.get('/api/roles', (req, res) => {
  const role = getCurrentRole(req);
  const user = getCurrentUser(req);
  res.json({
    currentRole: role,
    currentRoleName: ROLES[role]?.name || role,
    currentUser: user,
    roles: Object.values(ROLES),
    permissions: PERMISSIONS
  });
});

app.get('/api/config', (req, res) => {
  const role = getCurrentRole(req);
  res.json({
    ...config,
    currentRole: role,
    currentRoleName: ROLES[role]?.name || role
  });
});

app.get('/api/audits', requirePermission('audits', 'view'), async (req, res) => {
  const db = await readDb();
  let audits = db.audits || [];

  const { operator, collection, startTime, endTime, itemId } = req.query;

  if (operator) {
    audits = audits.filter((a) => a.operator.includes(operator));
  }
  if (collection) {
    audits = audits.filter((a) => a.collection === collection);
  }
  if (itemId) {
    audits = audits.filter((a) => a.itemId === itemId);
  }
  if (startTime) {
    audits = audits.filter((a) => new Date(a.timestamp) >= new Date(startTime));
  }
  if (endTime) {
    audits = audits.filter((a) => new Date(a.timestamp) <= new Date(endTime));
  }

  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 50;
  const start = (page - 1) * pageSize;
  const paginated = audits.slice(start, start + pageSize);

  res.json({
    total: audits.length,
    page,
    pageSize,
    items: paginated
  });
});

app.post('/api/materials/status-preview', (req, res) => {
  const result = computeMaterialStatus(req.body || {});
  res.json(result);
});

app.get('/api/db', async (req, res) => {
  const db = await readDb();
  for (const key of Object.keys(db)) {
    if (Array.isArray(db[key])) db[key].sort(sortNewest);
  }
  if (Array.isArray(db.materials)) {
    for (const m of db.materials) {
      const computed = computeMaterialStatus(m);
      if (m.status !== computed.status) {
        m.status = computed.status;
        m.updatedAt = new Date().toISOString();
      }
      m.statusReasons = computed.reasons;
    }
  }
  const role = getCurrentRole(req);
  const result = { ...db };
  if (role !== 'admin') {
    delete result.audits;
  }
  res.json(result);
});

app.get('/api/loans/calendar', async (req, res) => {
  const db = await readDb();
  const filters = {
    scrollIdFilter: req.query.scrollId || null,
    statusFilter: req.query.status || null,
    riskLevelFilter: req.query.riskLevel || null
  };
  const data = getActiveLoansByScroll(db, filters);
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
  const tasks = getBatchRepairsSorted(db, batchId);
  const tasksWithLockInfo = tasks.map((task) => {
    const lockInfo = computeTaskLockInfo(db, task);
    return { ...task, lockInfo };
  });
  res.json(tasksWithLockInfo);
});

app.post('/api/loans/assess-preview', async (req, res) => {
  const db = await readDb();
  const assessment = assessLoanRisk(db, req.body || {});
  res.json(assessment);
});

app.post('/api/:collection', requirePermission(':collection', 'create'), async (req, res, next) => {
  const { collection } = req.params;
  if (!PERMISSIONS[collection]) return res.status(404).json({ error: 'unknown collection' });
  const role = getCurrentRole(req);
  if (!hasPermission(role, collection, 'create')) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(collection)}的新增权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: collection,
      action: 'create'
    });
  }
  next();
}, async (req, res) => {
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

    const repairItems = processList.map((processName, index) => ({
      id: `repairs-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      scrollId,
      batchId,
      process: processName,
      sortOrder: index,
      conservator,
      date: startDate,
      status: '计划中',
      materialUsed: '',
      note: `由模板"${template.name}"生成`,
      createdAt: now,
      updatedAt: now,
      history: [stamp('创建', `批次生成：${processName}（第${index + 1}道工序）`)]
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
      scroll.protectionAdvice = generateProtectionAdvice(scroll);
    }

    const scrollTitle = scroll?.title || '';
    await writeAuditLog(db, req, {
      collection: 'repairBatches',
      itemId: batchItem.id,
      itemTitle: `${template.name} - ${scrollTitle}`,
      action: 'create',
      note: `生成${processList.length}道修补工序`
    });
    await writeAuditLog(db, req, {
      collection: 'scrolls',
      itemId: scrollId,
      itemTitle: scrollTitle,
      action: 'statusChange',
      note: `状态变更为修补中（启动修补批次"${template.name}"）`
    });

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
  } else if (collection === 'scrolls') {
    const advice = generateProtectionAdvice(item);
    item.protectionAdvice = advice;
    const originalNote = req.body.note || req.body.memo || '';
    const adviceSummary = advice.damageLabels.length > 0 ? `保护建议已生成（${advice.damageLabels.join('、')}）` : '保护建议已生成';
    item.history = [stamp('创建', originalNote ? `${originalNote} | ${adviceSummary}` : adviceSummary)];
  } else if (collection === 'materials') {
    const computed = computeMaterialStatus(item);
    item.status = computed.status;
    item.statusReasons = computed.reasons;
    const reasonText = computed.reasons.length > 0 ? `自动判定：${computed.status}（${computed.reasons.join('；')}）` : '自动判定：正常';
    const originalNote = req.body.note || req.body.memo || '';
    item.history = [stamp('创建', originalNote ? `${originalNote} | ${reasonText}` : reasonText)];
  } else {
    item.history = [stamp('创建', req.body.note || req.body.memo || '')];
  }

  db[collection].push(item);

  const titleFields = {
    scrolls: 'title',
    repairs: 'process',
    loans: 'borrower',
    imagings: 'batch',
    inventories: 'cabinet',
    materials: 'name',
    repairTemplates: 'name',
    repairBatches: 'templateName',
    observations: 'observer'
  };
  const itemTitle = item[titleFields[collection]] || item.title || item.id;
  await writeAuditLog(db, req, {
    collection,
    itemId: item.id,
    itemTitle: String(itemTitle),
    action: 'create',
    changes: { ...req.body },
    note: req.body.note || req.body.memo || ''
  });

  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  if (!PERMISSIONS[collection]) return res.status(404).json({ error: 'unknown collection' });
  const role = getCurrentRole(req);
  const hasUpdatePerm = hasPermission(role, collection, 'update');
  const hasStatusPerm = hasPermission(role, collection, 'statusChange');
  if (!hasUpdatePerm && !hasStatusPerm) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(collection)}的修改权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: collection,
      action: 'update'
    });
  }

  const isStatusOnly = Object.keys(req.body).every((k) => ['status', 'note', 'memo', 'historyAction'].includes(k)) && req.body.status;
  if (isStatusOnly && !hasStatusPerm) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(collection)}的状态变更权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: collection,
      action: 'statusChange'
    });
  }
  if (!isStatusOnly && !hasUpdatePerm) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(collection)}的修改权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: collection,
      action: 'update'
    });
  }

  const db = await readDb();
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });

  const oldItem = { ...item };
  const actionType = isStatusOnly ? 'statusChange' : 'update';

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
  const prevStatus = item.status;

  if (collection === 'repairs' && req.body.status && req.body.status !== prevStatus) {
    const validation = validateTaskStatusChange(db, id, req.body.status, prevStatus);
    if (!validation.valid) {
      return res.status(409).json({ error: validation.reason });
    }
  }

  Object.assign(item, req.body, { updatedAt: new Date().toISOString() });

  if (collection === 'scrolls') {
    const damageChanged = req.body.damage !== undefined && req.body.damage !== oldItem.damage;
    const levelChanged = req.body.protectionLevel !== undefined && req.body.protectionLevel !== oldItem.protectionLevel;
    const borrowChanged = req.body.borrowStatus !== undefined && req.body.borrowStatus !== oldItem.borrowStatus;
    if (damageChanged || levelChanged || borrowChanged || !item.protectionAdvice) {
      const advice = generateProtectionAdvice(item);
      item.protectionAdvice = advice;
      const changedFields = [];
      if (damageChanged) changedFields.push('残损描述');
      if (levelChanged) changedFields.push('保护等级');
      if (borrowChanged) changedFields.push('借阅状态');
      const adviceSummary = changedFields.length > 0
        ? `${changedFields.join('、')}变更，保护建议已更新`
        : '保护建议已生成';
      item.history = item.history || [];
      if (!historyAction && !req.body.note && !req.body.memo) {
        item.history.unshift(stamp('保护建议更新', adviceSummary));
      }
    }
  }

  if (collection === 'materials') {
    const computed = computeMaterialStatus(item);
    const oldStatus = item.status;
    item.status = computed.status;
    item.statusReasons = computed.reasons;
    if (computed.status !== oldStatus) {
      const reasonText = computed.reasons.length > 0
        ? `自动判定：${computed.status}（${computed.reasons.join('；')}）`
        : '自动判定：正常';
      item.history = item.history || [];
      item.history.unshift(stamp('状态变更', reasonText));
    }
  }

  if (collection === 'loans' && (req.body.scrollId || req.body.borrowDate || req.body.dueDate || req.body.purpose)) {
    const mergedLoan = { ...item, ...req.body };
    const assessment = assessLoanRisk(db, mergedLoan);
    item.riskAssessment = assessment;
  }

  if (collection === 'repairs' && req.body.status && req.body.status !== prevStatus) {
    const justCompleted = req.body.status === '已完成';
    const justReverted = prevStatus === '已完成' && req.body.status !== '已完成';
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
              scroll.protectionAdvice = generateProtectionAdvice(scroll);
            }
          }
        } else {
          if (wasAllDone) {
            batch.status = '进行中';
            batch.history.unshift(stamp('批次回退', `${item.process}从已完成回退为${req.body.status}，批次重新进行中（${completedCount}/${totalCount}）`));
            const scroll = db.scrolls?.find((s) => s.id === batch.scrollId);
            if (scroll && scroll.borrowStatus === '需审批') {
              scroll.borrowStatus = '修补中';
              scroll.updatedAt = new Date().toISOString();
              scroll.history = scroll.history || [];
              scroll.history.unshift(stamp('修补中', `修补批次"${batch.templateName}"有工序回退，经卷重回修补中`));
              scroll.protectionAdvice = generateProtectionAdvice(scroll);
            }
          } else if (justCompleted) {
            batch.history.unshift(stamp('进度更新', `${item.process}已完成（${completedCount}/${totalCount}）`));
          } else if (justReverted) {
            batch.history.unshift(stamp('进度回退', `${item.process}从已完成回退为${req.body.status}（${completedCount}/${totalCount}）`));
          }
        }
      }
    } else if (justCompleted) {
      const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
      if (scroll) {
        scroll.borrowStatus = '需审批';
        scroll.updatedAt = new Date().toISOString();
        scroll.history = scroll.history || [];
        scroll.history.unshift(stamp('修补完成', `${item.process}修补完成，转入需审批`));
        scroll.protectionAdvice = generateProtectionAdvice(scroll);
      }
    } else if (justReverted) {
      const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
      if (scroll && scroll.borrowStatus === '需审批') {
        scroll.borrowStatus = '修补中';
        scroll.updatedAt = new Date().toISOString();
        scroll.history = scroll.history || [];
        scroll.history.unshift(stamp('修补中', `${item.process}修补回退，经卷重回修补中`));
        scroll.protectionAdvice = generateProtectionAdvice(scroll);
      }
    }
  }

  item.history = item.history || [];
  if (historyAction || req.body.note || req.body.memo || req.body.status) {
    item.history.unshift(stamp(historyAction || req.body.status || '更新', req.body.note || req.body.memo || ''));
  }

  const titleFields = {
    scrolls: 'title',
    repairs: 'process',
    loans: 'borrower',
    imagings: 'batch',
    inventories: 'cabinet',
    materials: 'name',
    repairTemplates: 'name',
    repairBatches: 'templateName',
    observations: 'observer'
  };
  const itemTitle = item[titleFields[collection]] || item.title || item.id;

  const changes = {};
  for (const key of Object.keys(req.body)) {
    if (key === 'historyAction') continue;
    if (oldItem[key] !== item[key]) {
      changes[key] = { before: oldItem[key], after: item[key] };
    }
  }

  await writeAuditLog(db, req, {
    collection,
    itemId: item.id,
    itemTitle: String(itemTitle),
    action: actionType,
    changes: Object.keys(changes).length ? changes : null,
    note: req.body.note || req.body.memo || historyAction || ''
  });

  if (collection === 'repairs' && req.body.status && req.body.status !== prevStatus) {
    const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
    if (scroll) {
      const scrollStatus = scroll.status || scroll.borrowStatus || '未知';
      const processName = item.process || '-';
      await writeAuditLog(db, req, {
        collection: 'scrolls',
        itemId: scroll.id,
        itemTitle: scroll.title || scroll.name || scroll.id,
        action: 'statusChange',
        note: `经卷状态变更（修补工序${processName}：${req.body.status}）`
      });
    }
    if (item.batchId) {
      const batch = db.repairBatches?.find((b) => b.id === item.batchId);
      if (batch) {
        await writeAuditLog(db, req, {
          collection: 'repairBatches',
          itemId: batch.id,
          itemTitle: batch.templateName || batch.name || batch.id,
          action: 'statusChange',
          note: `批次进度更新：${batch.progressSummary || '进行中'}`
        });
      }
    }
  }

  await writeDb(db);
  res.json(item);
});

app.delete('/api/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  if (!PERMISSIONS[collection]) return res.status(404).json({ error: 'unknown collection' });
  const role = getCurrentRole(req);
  if (!hasPermission(role, collection, 'delete')) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(collection)}的删除权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: collection,
      action: 'delete'
    });
  }

  const db = await readDb();
  if (!Array.isArray(db[collection])) return res.status(404).json({ error: 'unknown collection' });
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });

  const titleFields = {
    scrolls: 'title',
    repairs: 'process',
    loans: 'borrower',
    imagings: 'batch',
    inventories: 'cabinet',
    materials: 'name',
    repairTemplates: 'name',
    repairBatches: 'templateName',
    observations: 'observer'
  };
  const itemTitle = item[titleFields[collection]] || item.title || item.id;

  const before = db[collection].length;
  db[collection] = db[collection].filter((entry) => entry.id !== id);
  if (db[collection].length === before) return res.status(404).json({ error: 'not found' });

  await writeAuditLog(db, req, {
    collection,
    itemId: id,
    itemTitle: String(itemTitle),
    action: 'delete',
    note: '删除记录'
  });

  await writeDb(db);
  res.status(204).end();
});

app.post('/api/action/:actionId/:id', async (req, res) => {
  const actionId = req.params.actionId;
  const action = config.actions.find((entry) => entry.id === actionId);
  if (!action) return res.status(404).json({ error: 'unknown action' });

  const collection = action.collection;
  const role = getCurrentRole(req);

  let actionType = 'statusChange';
  if (actionId === 'loan-approve') actionType = 'approve';
  else if (actionId === 'loan-approve-condition') actionType = 'approve';
  else if (actionId === 'loan-reject') actionType = 'reject';
  else if (actionId === 'loan-out') actionType = 'lend';
  else if (actionId === 'loan-return') actionType = 'return';

  if (!hasPermission(role, collection, actionType) && !hasPermission(role, collection, 'statusChange')) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有${collectionLabel(collection)}的${action.label}权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: collection,
      action: actionType
    });
  }

  const db = await readDb();
  const item = db[collection]?.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });

  const { conditions, conditionsNote } = req.body || {};

  if (actionId === 'loan-approve-condition' && (!Array.isArray(conditions) || conditions.length === 0)) {
    return res.status(400).json({ error: '条件批准必须至少选择一项保护条件' });
  }

  const oldItem = { ...item };

  if ((action.id === 'repair-done' || action.id === 'repair-doing') && collection === 'repairs') {
    const newStatus = action.id === 'repair-done' ? '已完成' : '进行中';
    const validation = validateTaskStatusChange(db, item.id, newStatus, item.status);
    if (!validation.valid) {
      return res.status(409).json({ error: validation.reason });
    }
  }

  const result = runAction(db, action, item, { conditions, conditionsNote });
  if (result.error) return res.status(409).json({ error: result.error });

  if (action.id === 'repair-done' || action.id === 'repair-doing') {
    const isDone = action.id === 'repair-done';
    if (item.batchId) {
      const batch = db.repairBatches?.find((b) => b.id === item.batchId);
      if (batch) {
        const batchRepairs = db.repairs.filter((r) => r.batchId === batch.id);
        const completedCount = batchRepairs.filter((r) => r.status === '已完成').length;
        const totalCount = batchRepairs.length;
        batch.progressSummary = `${completedCount}/${totalCount} 已完成`;
        batch.updatedAt = new Date().toISOString();
        batch.history = batch.history || [];
        if (isDone) {
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
        } else {
          batch.history.unshift(stamp('工序开始', `${item.process}开始进行`));
        }
      }
    } else if (isDone) {
      const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
      if (scroll) {
        scroll.borrowStatus = '需审批';
        scroll.updatedAt = new Date().toISOString();
        scroll.history = scroll.history || [];
        scroll.history.unshift(stamp('修补完成', `${item.process}修补完成，转入需审批`));
      }
    }
  }

  const titleFields = {
    scrolls: 'title',
    repairs: 'process',
    loans: 'borrower',
    imagings: 'batch',
    inventories: 'cabinet',
    materials: 'name',
    repairTemplates: 'name',
    repairBatches: 'templateName',
    observations: 'observer'
  };
  const itemTitle = item[titleFields[collection]] || item.title || item.id;

  const changes = {};
  const patches = action.patches || [];
  for (const patch of patches) {
    const field = patch.field;
    const target = patch.target === 'related' ? null : item;
    if (target && oldItem[field] !== item[field]) {
      changes[field] = { before: oldItem[field], after: item[field] };
    }
  }

  let auditNote = action.note || action.label;
  if (actionId === 'loan-approve-condition' && Array.isArray(conditions) && conditions.length > 0) {
    const conditionLabels = conditions.map((c) => config.loanConditions?.[c]?.label || c).join('、');
    auditNote = `条件批准：${conditionLabels}${conditionsNote ? ` | 补充说明：${conditionsNote}` : ''}`;
    changes.conditions = { before: oldItem.conditions || null, after: conditions };
    if (conditionsNote) changes.conditionsNote = { before: oldItem.conditionsNote || null, after: conditionsNote };
  } else if ((actionId === 'loan-out' || actionId === 'loan-return') && item.conditionsSummary) {
    auditNote = `${action.label}（保护条件：${item.conditionsSummary}）`;
  }

  await writeAuditLog(db, req, {
    collection,
    itemId: item.id,
    itemTitle: String(itemTitle),
    action: actionType,
    changes: Object.keys(changes).length ? changes : null,
    note: auditNote
  });

  if (collection === 'loans' && action.relation) {
    const scroll = db.scrolls?.find((s) => s.id === item.scrollId);
    if (scroll) {
      const scrollStatus = scroll.status || scroll.borrowStatus || '未知';
      await writeAuditLog(db, req, {
        collection: 'scrolls',
        itemId: scroll.id,
        itemTitle: scroll.title || scroll.name || scroll.id,
        action: 'statusChange',
        note: `经卷状态变更（借阅${action.label}）`
      });
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

function runAction(db, action, item, extra = {}) {
  const { conditions, conditionsNote } = extra;
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

      if (action.id === 'loan-approve-condition' && Array.isArray(conditions) && conditions.length > 0) {
        item.conditions = conditions;
        if (conditionsNote) item.conditionsNote = conditionsNote;
        const conditionLabels = conditions.map((c) => config.loanConditions?.[c]?.label || c).join('、');
        item.conditionsSummary = conditionLabels;
        const conditionNoteText = `保护条件：${conditionLabels}${conditionsNote ? ` | 补充说明：${conditionsNote}` : ''}`;
        target.history.unshift(stamp(action.label, `${baseNote} | ${riskNote} | ${conditionNoteText}`));
      } else {
        target.history.unshift(stamp(action.label, `${baseNote} | ${riskNote}`));
      }
    } else {
      target.history.unshift(stamp(action.label, action.note || '状态流转'));
    }

    if (patch.target === 'related' && patch.field === 'borrowStatus' && related) {
      related.protectionAdvice = generateProtectionAdvice(related);
    }
    if (action.collection === 'scrolls' && patch.field === 'borrowStatus' && target) {
      target.protectionAdvice = generateProtectionAdvice(target);
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

const VALID_PROTECTION_LEVELS = ['一级', '二级', '三级'];
const VALID_BORROW_STATUSES = ['可借阅', '需审批', '限制借阅', '修补中'];
const SCROLL_REQUIRED_FIELDS = ['title', 'material', 'era', 'cabinet', 'damage'];

const FIELD_ALIASES = {
  title: ['卷名', '名称', '题名', '经卷名', 'title'],
  material: ['材质', '材料', '质地', 'material'],
  era: ['年代', '朝代', '时期', '时代', 'era'],
  damage: ['残损', '破损', '损坏', '残损情况', '残损位置', 'damage'],
  inscription: ['题跋', '题记', '跋文', '题跋信息', 'inscription'],
  cabinet: ['柜位', '存放柜位', '位置', '存放位置', 'cabinet'],
  protectionLevel: ['保护等级', '等级', 'protectionLevel', 'protection_level'],
  borrowStatus: ['借阅状态', '状态', '借阅情况', 'borrowStatus', 'borrow_status']
};

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const detectDelimiter = (line) => {
    const candidates = [',', '\t', ';', '，'];
    let best = ',';
    let maxCount = -1;
    for (const d of candidates) {
      const count = line.split(d).length;
      if (count > maxCount) {
        maxCount = count;
        best = d;
      }
    }
    return best;
  };

  const delimiter = detectDelimiter(lines[0]);

  const parseLine = (line, delim) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const rawHeaders = parseLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => parseLine(line, delimiter));
  return { headers: rawHeaders, rows };
}

function mapHeadersToFields(rawHeaders) {
  const mapping = {};
  const recognized = [];
  const unrecognized = [];

  for (let i = 0; i < rawHeaders.length; i++) {
    const header = rawHeaders[i].trim();
    let mappedField = null;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((alias) => header === alias || header.includes(alias))) {
        mappedField = field;
        break;
      }
    }
    if (mappedField) {
      mapping[i] = mappedField;
      recognized.push({ header, field: mappedField });
    } else {
      unrecognized.push(header);
    }
  }
  return { mapping, recognized, unrecognized };
}

function buildRowObjects(rows, headerMapping, rawHeaders) {
  return rows.map((cells, rowIndex) => {
    const obj = {};
    for (let i = 0; i < cells.length; i++) {
      const field = headerMapping[i];
      if (field) {
        obj[field] = cells[i];
      }
    }
    return {
      rowNumber: rowIndex + 2,
      rawHeaders,
      rawCells: cells,
      data: obj
    };
  });
}

function validateScrollRow(row, existingTitles, inputTitleCounts) {
  const errors = [];
  const warnings = [];
  const data = row.data;
  const title = (data.title || '').trim();

  if (!title) {
    errors.push({ type: 'missing', field: 'title', message: '卷名为空' });
  } else {
    if (existingTitles.has(title)) {
      errors.push({ type: 'duplicate_db', field: 'title', message: `卷名"${title}"已存在于数据库中` });
    }
    if ((inputTitleCounts.get(title) || 0) > 1) {
      errors.push({ type: 'duplicate_input', field: 'title', message: `卷名"${title}"在导入数据中重复出现` });
    }
  }

  for (const field of SCROLL_REQUIRED_FIELDS) {
    if (field === 'title') continue;
    if (!data[field] || !String(data[field]).trim()) {
      errors.push({ type: 'missing', field, message: `缺少必填字段：${field}` });
    }
  }

  if (data.protectionLevel && !VALID_PROTECTION_LEVELS.includes(data.protectionLevel.trim())) {
    errors.push({
      type: 'invalid_protection',
      field: 'protectionLevel',
      message: `保护等级"${data.protectionLevel}"无效，有效值：${VALID_PROTECTION_LEVELS.join('、')}`
    });
  }

  if (data.borrowStatus && !VALID_BORROW_STATUSES.includes(data.borrowStatus.trim())) {
    errors.push({
      type: 'invalid_borrow',
      field: 'borrowStatus',
      message: `借阅状态"${data.borrowStatus}"无效，有效值：${VALID_BORROW_STATUSES.join('、')}`
    });
  }

  return { errors, warnings };
}

app.post('/api/scrolls/batch/preview', async (req, res) => {
  const { csvText } = req.body || {};
  if (!csvText || !csvText.trim()) {
    return res.status(400).json({ error: '请提供CSV文本' });
  }

  const db = await readDb();
  const existingTitles = new Set((db.scrolls || []).map((s) => (s.title || '').trim()));

  let parsed;
  try {
    parsed = parseCsvText(csvText);
  } catch (e) {
    return res.status(400).json({ error: 'CSV解析失败：' + e.message });
  }

  if (parsed.rows.length === 0) {
    return res.status(400).json({ error: 'CSV中没有数据行' });
  }

  const { mapping, recognized, unrecognized } = mapHeadersToFields(parsed.headers);
  const rowObjects = buildRowObjects(parsed.rows, mapping, parsed.headers);

  const titleCounts = new Map();
  for (const row of rowObjects) {
    const t = (row.data.title || '').trim();
    if (t) titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
  }

  let validCount = 0;
  const validatedRows = rowObjects.map((row) => {
    const { errors, warnings } = validateScrollRow(row, existingTitles, titleCounts);
    if (errors.length === 0) validCount++;
    return { ...row, errors, warnings, isValid: errors.length === 0 };
  });

  const duplicateTitles = [];
  const seenInInput = new Set();
  for (const row of validatedRows) {
    const t = (row.data.title || '').trim();
    if (!t) continue;
    if (row.errors.some((e) => e.type === 'duplicate_db' || e.type === 'duplicate_input')) {
      if (!seenInInput.has(t)) {
        seenInInput.add(t);
        duplicateTitles.push({
          title: t,
          inDb: existingTitles.has(t),
          inInput: (titleCounts.get(t) || 0) > 1,
          rows: validatedRows.filter((r) => (r.data.title || '').trim() === t).map((r) => r.rowNumber)
        });
      }
    }
  }

  const missingRequiredByField = {};
  for (const field of SCROLL_REQUIRED_FIELDS) {
    const rowsMissing = validatedRows.filter((r) => r.errors.some((e) => e.type === 'missing' && e.field === field));
    if (rowsMissing.length > 0) {
      missingRequiredByField[field] = rowsMissing.map((r) => r.rowNumber);
    }
  }

  const protectionErrors = validatedRows.filter((r) => r.errors.some((e) => e.type === 'invalid_protection')).map((r) => ({
    rowNumber: r.rowNumber,
    value: r.data.protectionLevel
  }));

  res.json({
    totalRows: parsed.rows.length,
    validCount,
    invalidCount: parsed.rows.length - validCount,
    headers: parsed.headers,
    fieldRecognition: {
      recognized,
      unrecognized,
      hasAllRequired: SCROLL_REQUIRED_FIELDS.every((f) => recognized.some((r) => r.field === f))
    },
    duplicateTitles,
    missingRequired: missingRequiredByField,
    protectionAnomalies: protectionErrors,
    rows: validatedRows
  });
});

app.post('/api/scrolls/batch/import', async (req, res) => {
  const role = getCurrentRole(req);
  if (!hasPermission(role, 'scrolls', 'create')) {
    const roleInfo = ROLES[role];
    return res.status(403).json({
      error: `权限不足：当前身份为"${roleInfo?.name || role}"，没有经卷档案的新增权限`,
      role: role,
      roleName: roleInfo?.name || role,
      collection: 'scrolls',
      action: 'create'
    });
  }

  const { csvText, importRows } = req.body || {};
  if (!csvText || !csvText.trim()) {
    return res.status(400).json({ error: '请提供CSV文本' });
  }
  if (!Array.isArray(importRows) || importRows.length === 0) {
    return res.status(400).json({ error: '没有可导入的有效行' });
  }

  const db = await readDb();
  const existingTitles = new Set((db.scrolls || []).map((s) => (s.title || '').trim()));

  const parsed = parseCsvText(csvText);
  const { mapping } = mapHeadersToFields(parsed.headers);
  const rowObjects = buildRowObjects(parsed.rows, mapping, parsed.headers);

  const titleCounts = new Map();
  for (const idx of importRows) {
    const row = rowObjects[idx];
    if (!row) continue;
    const t = (row.data.title || '').trim();
    if (t) titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
  }

  const selectedRowObjects = importRows.map((idx) => rowObjects[idx]).filter(Boolean);

  for (const row of selectedRowObjects) {
    const { errors } = validateScrollRow(row, existingTitles, titleCounts);
    if (errors.length > 0) {
      const firstError = errors[0];
      return res.status(409).json({
        error: `第${row.rowNumber}行校验失败：${firstError.message}`,
        rowNumber: row.rowNumber,
        errors
      });
    }
  }

  const now = new Date().toISOString();
  const createdScrolls = [];

  if (!Array.isArray(db.scrolls)) db.scrolls = [];

  for (const row of selectedRowObjects) {
    const data = row.data;
    const item = {
      id: `scrolls-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: (data.title || '').trim(),
      material: (data.material || '').trim(),
      era: (data.era || '').trim(),
      damage: (data.damage || '').trim(),
      inscription: (data.inscription || '').trim(),
      cabinet: (data.cabinet || '').trim(),
      protectionLevel: data.protectionLevel ? data.protectionLevel.trim() : '三级',
      borrowStatus: data.borrowStatus ? data.borrowStatus.trim() : '需审批',
      createdAt: now,
      updatedAt: now
    };
    const advice = generateProtectionAdvice(item);
    item.protectionAdvice = advice;
    const adviceSummary = advice.damageLabels.length > 0 ? `保护建议已生成（${advice.damageLabels.join('、')}）` : '保护建议已生成';
    item.history = [
      stamp(
        '创建',
        `批量导入（第${row.rowNumber}行），保护等级：${data.protectionLevel ? data.protectionLevel.trim() : '三级'}，借阅状态：${data.borrowStatus ? data.borrowStatus.trim() : '需审批'} | ${adviceSummary}`
      )
    ];
    db.scrolls.push(item);
    createdScrolls.push(item);
  }

  const titles = createdScrolls.map((s) => s.title).join('、');
  await writeAuditLog(db, req, {
    collection: 'scrolls',
    itemId: null,
    itemTitle: `批量导入${createdScrolls.length}条`,
    action: 'create',
    note: `批量导入经卷档案${createdScrolls.length}条：${titles.slice(0, 100)}${titles.length > 100 ? '...' : ''}`
  });

  await writeDb(db);

  res.status(201).json({
    success: true,
    importedCount: createdScrolls.length,
    createdScrolls
  });
});

function runConsistencyCheck(db) {
  const scrolls = db.scrolls || [];
  const repairs = db.repairs || [];
  const loans = db.loans || [];
  const issues = [];

  for (const scroll of scrolls) {
    const scrollRepairs = repairs.filter((r) => r.scrollId === scroll.id);
    const scrollLoans = loans.filter((l) => l.scrollId === scroll.id);
    const activeRepairs = scrollRepairs.filter((r) => r.status === '计划中' || r.status === '进行中');
    const activeLoans = scrollLoans.filter((l) => ACTIVE_LOAN_STATUSES.includes(l.status));
    const lentOutLoans = scrollLoans.filter((l) => l.status === '已借出');
    const returnedOrRejected = scrollLoans.every((l) => l.status === '已归还' || l.status === '已拒绝');
    const completedRepairs = scrollRepairs.filter((r) => r.status === '已完成');

    if (scroll.borrowStatus === '可借阅' && lentOutLoans.length > 0) {
      const loanInfo = lentOutLoans.map((l) => `${l.borrower}（${l.borrowDate}~${l.dueDate}）`).join('、');
      issues.push({
        id: `cc-${scroll.id}-1`,
        type: 'available-but-lent',
        severity: 'high',
        title: '经卷显示可借阅但存在已借出记录',
        description: `经卷「${scroll.title}」当前借阅状态为「可借阅」，但存在${lentOutLoans.length}条已借出记录：${loanInfo}`,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: lentOutLoans.map((l) => l.id),
        affectedRepairs: [],
        suggestion: 'fix-status-to-restricted',
        suggestionLabel: '将经卷借阅状态修正为「限制借阅」',
        autoFixable: true
      });
    }

    if (activeRepairs.length > 0 && scroll.borrowStatus !== '修补中') {
      const repairInfo = activeRepairs.map((r) => `${r.process}（${r.status}）`).join('、');
      issues.push({
        id: `cc-${scroll.id}-2`,
        type: 'repairing-but-borrowable',
        severity: 'high',
        title: '修补未完成却允许借出',
        description: `经卷「${scroll.title}」存在${activeRepairs.length}条未完成修补：${repairInfo}，但借阅状态为「${scroll.borrowStatus}」而非「修补中」`,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: [],
        affectedRepairs: activeRepairs.map((r) => r.id),
        suggestion: 'fix-status-to-repairing',
        suggestionLabel: '将经卷借阅状态修正为「修补中」',
        autoFixable: true
      });
    }

    if (scrollLoans.length > 0 && returnedOrRejected && scroll.borrowStatus === '限制借阅') {
      issues.push({
        id: `cc-${scroll.id}-3`,
        type: 'returned-but-restricted',
        severity: 'medium',
        title: '归还后经卷仍限制借阅',
        description: `经卷「${scroll.title}」所有借阅记录已归还或拒绝，但借阅状态仍为「限制借阅」`,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: scrollLoans.map((l) => l.id),
        affectedRepairs: [],
        suggestion: 'fix-status-to-approval',
        suggestionLabel: '将经卷借阅状态修正为「需审批」',
        autoFixable: true
      });
    }

    const hasHistoryEntry = (scroll.history || []).some(
      (h) => h.action === '修补完成' || (h.note && h.note.includes('修补完成'))
    );
    const batches = (db.repairBatches || []).filter((b) => b.scrollId === scroll.id);
    const completedBatches = batches.filter((b) => b.status === '已完成');

    if (activeRepairs.length === 0 && (completedRepairs.length > 0 || completedBatches.length > 0) && !hasHistoryEntry) {
      const completedInfo = completedRepairs.length > 0
        ? completedRepairs.map((r) => `${r.process}（${r.date || '无日期'}）`).join('、')
        : completedBatches.map((b) => `${b.templateName}批次`).join('、');

      let suggestion, suggestionLabel;
      if (scroll.borrowStatus === '修补中') {
        suggestion = 'fix-repair-complete-no-history';
        suggestionLabel = '补充修补完成历史记录并将状态修正为「需审批」';
      } else {
        suggestion = 'fix-repair-history-only';
        suggestionLabel = '补充修补完成历史记录（不改变当前状态）';
      }

      let description;
      if (scroll.borrowStatus === '修补中') {
        description = `经卷「${scroll.title}」修补已全部完成（${completedInfo}），状态仍为「修补中」，且经卷历史中无修补完成记录`;
      } else {
        description = `经卷「${scroll.title}」修补已全部完成（${completedInfo}），当前借阅状态为「${scroll.borrowStatus}」，但经卷历史中缺少修补完成记录`;
      }

      issues.push({
        id: `cc-${scroll.id}-4`,
        type: 'repaired-no-history',
        severity: 'medium',
        title: '修补完成但缺少历史记录',
        description,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: [],
        affectedRepairs: [...completedRepairs.map((r) => r.id), ...completedBatches.map((b) => b.id)],
        suggestion,
        suggestionLabel,
        autoFixable: true
      });
    }

    if (scroll.borrowStatus === '修补中' && scrollRepairs.length === 0) {
      issues.push({
        id: `cc-${scroll.id}-5`,
        type: 'repairing-no-records',
        severity: 'high',
        title: '经卷修补中但无修补记录',
        description: `经卷「${scroll.title}」借阅状态为「修补中」，但不存在任何修补记录`,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: [],
        affectedRepairs: [],
        suggestion: 'fix-status-to-approval',
        suggestionLabel: '将经卷借阅状态修正为「需审批」',
        autoFixable: true
      });
    }

    if (lentOutLoans.length > 0 && scroll.borrowStatus !== '限制借阅') {
      const loanInfo = lentOutLoans.map((l) => `${l.borrower}（${l.status}）`).join('、');
      issues.push({
        id: `cc-${scroll.id}-6`,
        type: 'lent-but-not-restricted',
        severity: 'high',
        title: '经卷已借出但状态未限制',
        description: `经卷「${scroll.title}」存在已借出记录（${loanInfo}），但借阅状态为「${scroll.borrowStatus}」而非「限制借阅」`,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: lentOutLoans.map((l) => l.id),
        affectedRepairs: [],
        suggestion: 'fix-status-to-restricted',
        suggestionLabel: '将经卷借阅状态修正为「限制借阅」',
        autoFixable: true
      });
    }

    if (scroll.borrowStatus === '可借阅' && scroll.protectionLevel === '一级') {
      issues.push({
        id: `cc-${scroll.id}-7`,
        type: 'level1-but-available',
        severity: 'low',
        title: '一级保护经卷标记为可借阅',
        description: `经卷「${scroll.title}」为一级保护经卷，但借阅状态为「可借阅」，建议调整为需审批或限制借阅`,
        scrollId: scroll.id,
        scrollTitle: scroll.title,
        currentBorrowStatus: scroll.borrowStatus,
        affectedLoans: [],
        affectedRepairs: [],
        suggestion: 'fix-level1-to-approval',
        suggestionLabel: '将经卷借阅状态修正为「需审批」',
        autoFixable: true
      });
    }
  }

  return issues;
}

const CONSISTENCY_FIX_MAP = {
  'fix-status-to-restricted': {
    targetBorrowStatus: '限制借阅',
    validate: (db, scroll) => {
      const lentOut = (db.loans || []).filter((l) => l.scrollId === scroll.id && l.status === '已借出');
      return lentOut.length > 0;
    },
    historyAction: '状态变更',
    historyNote: '巡检修复：经卷存在已借出记录，状态修正为限制借阅'
  },
  'fix-status-to-repairing': {
    targetBorrowStatus: '修补中',
    validate: (db, scroll) => {
      const active = (db.repairs || []).filter((r) => r.scrollId === scroll.id && (r.status === '计划中' || r.status === '进行中'));
      return active.length > 0;
    },
    historyAction: '修补中',
    historyNote: '巡检修复：经卷存在未完成修补，状态修正为修补中'
  },
  'fix-status-to-approval': {
    targetBorrowStatus: '需审批',
    validate: (db, scroll) => {
      const active = (db.loans || []).filter((l) => l.scrollId === scroll.id && ACTIVE_LOAN_STATUSES.includes(l.status));
      return active.length === 0;
    },
    historyAction: '状态变更',
    historyNote: '巡检修复：无活跃借阅或修补已结束，状态修正为需审批'
  },
  'fix-repair-complete-no-history': {
    targetBorrowStatus: '需审批',
    validate: (db, scroll) => {
      const active = (db.repairs || []).filter((r) => r.scrollId === scroll.id && (r.status === '计划中' || r.status === '进行中'));
      return active.length === 0;
    },
    historyAction: '修补完成',
    historyNote: '巡检修复：修补已完成但缺少历史记录，补充修补完成记录并修正为需审批'
  },
  'fix-repair-history-only': {
    targetBorrowStatus: null,
    validate: (db, scroll) => {
      const active = (db.repairs || []).filter((r) => r.scrollId === scroll.id && (r.status === '计划中' || r.status === '进行中'));
      const completed = (db.repairs || []).filter((r) => r.scrollId === scroll.id && r.status === '已完成');
      const batches = (db.repairBatches || []).filter((b) => b.scrollId === scroll.id);
      const completedBatches = batches.filter((b) => b.status === '已完成');
      const hasHistoryEntry = (scroll.history || []).some(
        (h) => h.action === '修补完成' || (h.note && h.note.includes('修补完成'))
      );
      return active.length === 0 && (completed.length > 0 || completedBatches.length > 0) && !hasHistoryEntry;
    },
    historyAction: '修补完成',
    historyNote: '巡检修复：修补已完成但缺少历史记录，补充修补完成记录'
  },
  'fix-level1-to-approval': {
    targetBorrowStatus: '需审批',
    validate: () => true,
    historyAction: '保护评估',
    historyNote: '巡检修复：一级保护经卷不应标记为可借阅，修正为需审批'
  }
};

app.get('/api/consistency-check', requirePermission('scrolls', 'view'), async (req, res) => {
  const db = await readDb();
  const issues = runConsistencyCheck(db);
  const summary = {
    total: issues.length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
    autoFixable: issues.filter((i) => i.autoFixable).length
  };
  res.json({ issues, summary, checkedAt: new Date().toISOString() });
});

function buildFixPlanForIssue(db, issue) {
  const fixConfig = CONSISTENCY_FIX_MAP[issue.suggestion];
  if (!fixConfig) return null;

  const scroll = (db.scrolls || []).find((s) => s.id === issue.scrollId);
  if (!scroll) return null;

  const affectedLoans = (db.loans || []).filter((l) => (issue.affectedLoans || []).includes(l.id));
  const affectedRepairs = (db.repairs || []).filter((r) => (issue.affectedRepairs || []).includes(r.id));
  const affectedBatches = (db.repairBatches || []).filter((b) => (issue.affectedRepairs || []).includes(b.id));

  const affectedMaterialIds = new Set();
  for (const r of affectedRepairs) {
    if (r.materialId) affectedMaterialIds.add(r.materialId);
  }
  const affectedMaterials = (db.materials || []).filter((m) => affectedMaterialIds.has(m.id));

  const statusWillChange = fixConfig.targetBorrowStatus !== null && scroll.borrowStatus !== fixConfig.targetBorrowStatus;

  const historySummary = {
    action: fixConfig.historyAction,
    note: fixConfig.historyNote
  };

  return {
    issueId: issue.id,
    issueType: issue.type,
    issueTitle: issue.title,
    severity: issue.severity,
    scroll: {
      id: scroll.id,
      title: scroll.title,
      borrowStatus: scroll.borrowStatus,
      targetBorrowStatus: fixConfig.targetBorrowStatus,
      statusWillChange
    },
    loans: affectedLoans.map((l) => ({
      id: l.id,
      borrower: l.borrower,
      status: l.status,
      borrowDate: l.borrowDate,
      dueDate: l.dueDate
    })),
    repairBatches: affectedBatches.map((b) => ({
      id: b.id,
      templateName: b.templateName,
      status: b.status,
      conservator: b.conservator,
      startDate: b.startDate
    })),
    repairs: affectedRepairs.map((r) => ({
      id: r.id,
      process: r.process,
      status: r.status,
      conservator: r.conservator,
      date: r.date,
      materialUsed: r.materialUsed,
      materialId: r.materialId
    })),
    materials: affectedMaterials.map((m) => ({
      id: m.id,
      name: m.name,
      batch: m.batch,
      quantity: m.quantity
    })),
    historySummary,
    suggestionLabel: issue.suggestionLabel
  };
}

async function applySingleFix(db, req, issue, userNote = '') {
  const fixConfig = CONSISTENCY_FIX_MAP[issue.suggestion];
  if (!fixConfig) {
    return { success: false, issueId: issue.id, error: '无效的修复动作' };
  }

  const scroll = (db.scrolls || []).find((s) => s.id === issue.scrollId);
  if (!scroll) {
    return { success: false, issueId: issue.id, error: '经卷不存在' };
  }

  const oldBorrowStatus = scroll.borrowStatus;
  const statusWillChange = fixConfig.targetBorrowStatus !== null;
  if (statusWillChange && scroll.borrowStatus === fixConfig.targetBorrowStatus) {
    return { success: false, issueId: issue.id, error: '经卷状态已是目标状态，无需修复' };
  }

  if (!fixConfig.validate(db, scroll)) {
    return { success: false, issueId: issue.id, error: '服务端二次校验失败：当前数据状态不再满足修复条件' };
  }

  const trimmedNote = (userNote || '').trim();
  const finalHistoryNote = trimmedNote
    ? `${fixConfig.historyNote} | 用户说明：${trimmedNote}`
    : fixConfig.historyNote;
  const finalAuditNote = trimmedNote
    ? `一致性巡检批量修复：${issue.title} - ${fixConfig.historyNote} | 用户说明：${trimmedNote}`
    : `一致性巡检批量修复：${issue.title} - ${fixConfig.historyNote}`;

  if (statusWillChange) {
    scroll.borrowStatus = fixConfig.targetBorrowStatus;
    const advice = generateProtectionAdvice(scroll);
    scroll.protectionAdvice = advice;
  }
  scroll.updatedAt = new Date().toISOString();
  scroll.history = scroll.history || [];
  scroll.history.unshift(stamp(fixConfig.historyAction, finalHistoryNote));

  const auditChanges = statusWillChange
    ? { borrowStatus: { before: oldBorrowStatus, after: fixConfig.targetBorrowStatus } }
    : { historyAdded: { action: fixConfig.historyAction, note: finalHistoryNote } };
  await writeAuditLog(db, req, {
    collection: 'scrolls',
    itemId: scroll.id,
    itemTitle: scroll.title,
    action: statusWillChange ? 'statusChange' : 'historyAppend',
    changes: auditChanges,
    note: finalAuditNote
  });

  return {
    success: true,
    issueId: issue.id,
    scrollId: scroll.id,
    scrollTitle: scroll.title,
    oldBorrowStatus,
    newBorrowStatus: fixConfig.targetBorrowStatus || oldBorrowStatus,
    statusChanged: statusWillChange,
    historyAppended: true
  };
}

app.post('/api/consistency-check/fix', requirePermission('scrolls', 'update'), async (req, res) => {
  const { issueId, fixSuggestion, note } = req.body || {};
  if (!issueId || !fixSuggestion) {
    return res.status(400).json({ error: '缺少必要参数：issueId, fixSuggestion' });
  }

  const fixConfig = CONSISTENCY_FIX_MAP[fixSuggestion];
  if (!fixConfig) {
    return res.status(400).json({ error: '无效的修复动作' });
  }

  const db = await readDb();
  const currentIssues = runConsistencyCheck(db);
  const issue = currentIssues.find((i) => i.id === issueId);
  if (!issue) {
    return res.status(409).json({ error: '该问题已不存在，数据可能已被其他方式修复' });
  }

  if (issue.suggestion !== fixSuggestion) {
    return res.status(409).json({ error: '修复动作与问题不匹配' });
  }

  const result = await applySingleFix(db, req, issue, note);
  if (!result.success) {
    return res.status(409).json({ error: result.error });
  }

  await writeDb(db);

  const remainingIssues = runConsistencyCheck(db);
  const fixSummary = {
    total: remainingIssues.length,
    high: remainingIssues.filter((i) => i.severity === 'high').length,
    medium: remainingIssues.filter((i) => i.severity === 'medium').length,
    low: remainingIssues.filter((i) => i.severity === 'low').length,
    autoFixable: remainingIssues.filter((i) => i.autoFixable).length
  };

  res.json({
    success: true,
    fixedIssue: issueId,
    scrollId: result.scrollId,
    scrollTitle: result.scrollTitle,
    oldBorrowStatus: result.oldBorrowStatus,
    newBorrowStatus: result.newBorrowStatus,
    statusChanged: result.statusChanged,
    historyAppended: true,
    remainingSummary: fixSummary,
    fixedAt: new Date().toISOString()
  });
});

app.post('/api/consistency-check/plan', requirePermission('scrolls', 'view'), async (req, res) => {
  const { issueIds } = req.body || {};
  if (!Array.isArray(issueIds) || issueIds.length === 0) {
    return res.status(400).json({ error: '请选择要修复的问题' });
  }

  const db = await readDb();
  const currentIssues = runConsistencyCheck(db);
  const fixableIssues = currentIssues.filter((i) => issueIds.includes(i.id) && i.autoFixable);

  if (fixableIssues.length === 0) {
    return res.status(400).json({ error: '所选问题中没有可自动修复的项目' });
  }

  const planItems = [];
  const skippedIssues = [];

  for (const issue of fixableIssues) {
    const plan = buildFixPlanForIssue(db, issue);
    if (plan) {
      planItems.push(plan);
    } else {
      skippedIssues.push({ issueId: issue.id, reason: '无法构建修复计划' });
    }
  }

  const scrollIds = [...new Set(planItems.map((p) => p.scroll.id))];
  const totalStatusChanges = planItems.filter((p) => p.scroll.statusWillChange).length;
  const totalHistoryEntries = planItems.length;

  const affectedLoansCount = planItems.reduce((sum, p) => sum + p.loans.length, 0);
  const affectedRepairsCount = planItems.reduce((sum, p) => sum + p.repairs.length, 0);
  const affectedBatchesCount = planItems.reduce((sum, p) => sum + p.repairBatches.length, 0);
  const affectedMaterialsCount = planItems.reduce((sum, p) => sum + p.materials.length, 0);

  res.json({
    planGeneratedAt: new Date().toISOString(),
    totalItems: planItems.length,
    totalScrolls: scrollIds.length,
    totalStatusChanges,
    totalHistoryEntries,
    affectedCounts: {
      loans: affectedLoansCount,
      repairs: affectedRepairsCount,
      batches: affectedBatchesCount,
      materials: affectedMaterialsCount
    },
    items: planItems,
    skipped: skippedIssues
  });
});

app.post('/api/consistency-check/batch-fix', requirePermission('scrolls', 'update'), async (req, res) => {
  const { issueIds, note } = req.body || {};
  if (!Array.isArray(issueIds) || issueIds.length === 0) {
    return res.status(400).json({ error: '请选择要修复的问题' });
  }

  const db = await readDb();
  const batchStartedAt = new Date().toISOString();
  const currentIssues = runConsistencyCheck(db);

  const targetIssues = currentIssues.filter((i) => issueIds.includes(i.id) && i.autoFixable);
  const notFoundIds = issueIds.filter((id) => !targetIssues.find((i) => i.id === id));

  const succeeded = [];
  const failed = [];

  for (const issue of targetIssues) {
    const result = await applySingleFix(db, req, issue, note);
    if (result.success) {
      succeeded.push(result);
    } else {
      failed.push({
        issueId: issue.id,
        scrollId: issue.scrollId,
        scrollTitle: issue.scrollTitle,
        issueTitle: issue.title,
        error: result.error
      });
    }
  }

  for (const id of notFoundIds) {
    const originalIssue = (currentIssues.find((i) => i.id === id)) || {};
    failed.push({
      issueId: id,
      scrollId: originalIssue.scrollId,
      scrollTitle: originalIssue.scrollTitle,
      issueTitle: originalIssue.title || '未知问题',
      error: '问题不存在或已被修复'
    });
  }

  await writeDb(db);

  const remainingIssues = runConsistencyCheck(db);
  const remainingSummary = {
    total: remainingIssues.length,
    high: remainingIssues.filter((i) => i.severity === 'high').length,
    medium: remainingIssues.filter((i) => i.severity === 'medium').length,
    low: remainingIssues.filter((i) => i.severity === 'low').length,
    autoFixable: remainingIssues.filter((i) => i.autoFixable).length
  };

  const batchCompletedAt = new Date().toISOString();

  await writeAuditLog(db, req, {
    collection: 'audits',
    itemId: null,
    itemTitle: `批量修复 ${succeeded.length} 项，失败 ${failed.length} 项`,
    action: 'update',
    changes: {
      batchStartedAt,
      batchCompletedAt,
      issueCount: issueIds.length,
      succeeded: succeeded.length,
      failed: failed.length,
      succeededIssueIds: succeeded.map((s) => s.issueId),
      failedIssues: failed.map((f) => ({ issueId: f.issueId, error: f.error }))
    },
    note: `一致性巡检批量修复完成：成功 ${succeeded.length} 项，失败 ${failed.length} 项`
  });

  await writeDb(db);

  const allSucceeded = failed.length === 0 && succeeded.length > 0;

  res.json({
    success: allSucceeded,
    batchStartedAt,
    batchCompletedAt,
    totalRequested: issueIds.length,
    totalSucceeded: succeeded.length,
    totalFailed: failed.length,
    succeeded,
    failed,
    remainingSummary
  });
});

app.listen(PORT, () => {
  console.log(`${config.title} running at http://localhost:${PORT}`);
});
