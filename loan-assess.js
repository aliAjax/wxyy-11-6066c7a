const config = require('./project.config');

const ACTIVE_LOAN_STATUSES = ['待审批', '条件批准', '已批准', '已借出'];

const RESCHEDULEABLE_STATUSES = ['待审批', '条件批准', '已批准', '已借出'];

const RESCHEDULE_REVERT_STATUSES = ['已批准', '条件批准'];

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
    ],
    '不可借阅': [
      '当前不可借阅：经卷处于不可借阅状态，任何借阅申请均将被拦截',
      '如需解除不可借阅状态，须由馆长审批确认风险已消除后方可操作'
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

  const decisionOptions = {};
  if (loan.borrowDate) decisionOptions.borrowDate = loan.borrowDate;
  if (loan.dueDate) decisionOptions.dueDate = loan.dueDate;
  const borrowability = assessBorrowability(db, scroll.id, decisionOptions);

  const reasons = [];
  let score = 0;

  score += borrowability.score;
  reasons.push(`可借阅性评估：${borrowability.levelLabel}（得分${borrowability.score}）`);
  
  if (borrowability.blockReasons && borrowability.blockReasons.length > 0) {
    for (const reason of borrowability.blockReasons) {
      reasons.push(`阻断原因：${reason}`);
    }
  }

  if (borrowability.level === '不可借阅') {
    score += 20;
  } else if (borrowability.level === '限制借阅') {
    score += 10;
  }

  const purposeRisk = PURPOSE_RISK[loan.purpose] || DEFAULT_PURPOSE_RISK;
  score += purposeRisk.score;
  reasons.push(`借阅用途：${purposeRisk.desc}`);

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
  if (borrowability.level === '不可借阅' || score >= 85) {
    level = '极高风险';
  } else if (borrowability.level === '限制借阅' || score >= 65) {
    level = '高风险';
  } else if (borrowability.level === '需审批' || score >= 40) {
    level = '中风险';
  } else {
    level = '低风险';
  }

  const isStrictMode = borrowability.level === '不可借阅' || borrowability.level === '限制借阅';

  return {
    level,
    score,
    reasons,
    evaluatedAt: new Date().toISOString(),
    protectionLevel: scroll.protectionLevel,
    borrowStatus: scroll.borrowStatus,
    borrowability,
    isStrictMode
  };
}

function formatRiskNote(assessment, actionLabel) {
  const reasonSummary = assessment.reasons.slice(0, 2).join('；');
  return `风险评估：${assessment.level}（得分${assessment.score}${assessment.isStrictMode ? '，严格模式' : ''}）- ${reasonSummary}`;
}

function assessBorrowability(db, scrollId, options = {}) {
  const decisionConfig = config.borrowabilityDecision;
  const scroll = (db.scrolls || []).find((s) => s.id === scrollId);
  const context = { scroll, scrollId };

  if (!scroll) {
    return {
      scrollId,
      level: '需审批',
      levelLabel: '需审批',
      score: 50,
      tone: 'warn',
      blockReasons: ['未找到对应经卷档案'],
      suggestionActions: decisionConfig.suggestionActions['需审批'],
      dimensionScores: {},
      isConservative: true,
      conservativeReason: '经卷档案不存在，采用保守评估',
      missingFields: ['scroll'],
      evaluatedAt: new Date().toISOString()
    };
  }

  const missingFields = [];
  const conservativeMode = decisionConfig.conservativeMode;
  const requiredFields = conservativeMode?.requiredFields || [];
  for (const field of requiredFields) {
    if (scroll[field] === undefined || scroll[field] === null || scroll[field] === '') {
      missingFields.push(field);
    }
  }

  const scrollRepairs = (db.repairs || []).filter((r) => r.scrollId === scrollId);
  const lastRepair = scrollRepairs
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))[0] || null;
  const activeRepairs = scrollRepairs.filter((r) => r.status === '进行中' || r.status === '计划中');
  const hasActiveRepair = activeRepairs.length > 0;

  const scrollBatches = (db.repairBatches || []).filter((b) => b.scrollId === scrollId);
  const pendingBatches = scrollBatches.filter((b) => b.status === '进行中');
  const hasPendingBatch = pendingBatches.length > 0;

  const scrollImagings = (db.imagings || []).filter((i) => i.scrollId === scrollId);
  const latestImaging = scrollImagings
    .sort((a, b) => new Date(b.captureDate || b.createdAt) - new Date(a.captureDate || a.createdAt))[0] || null;
  const latestClarity = latestImaging?.clarity || null;

  const scrollInventories = (db.inventories || []).filter((i) => i.scrollId === scrollId);
  const pendingInventories = scrollInventories.filter((i) => i.status === '待复核');
  const hasPendingInventory = pendingInventories.length > 0;

  const scrollLoans = (db.loans || []).filter((l) => l.scrollId === scrollId);
  const activeLoans = scrollLoans.filter((l) => ACTIVE_LOAN_STATUSES.includes(l.status));
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const futureReservations = activeLoans.filter((l) => {
    if (!l.borrowDate) return false;
    return parseDate(l.borrowDate) >= parseDate(todayStr);
  });

  const scrollMaterials = (db.materials || []).filter((m) => {
    if (!lastRepair) return false;
    if (lastRepair.materialId && m.id === lastRepair.materialId) return true;
    const usedNames = String(lastRepair.materialUsed || '').split(/[、,，;；/\\\s]+/).map(n => n.trim()).filter(Boolean);
    return usedNames.includes(m.name);
  });
  const worstMaterialStatus = scrollMaterials.reduce((worst, m) => {
    const statusOrder = { '正常': 0, '低余量': 1, '即将到期': 2, '已过期': 3 };
    const current = statusOrder[m.status] || 0;
    return current > worst ? current : worst;
  }, 0);
  const materialStatusKey = { 0: '正常', 1: '低余量', 2: '即将到期', 3: '已过期' }[worstMaterialStatus];

  const dimConfig = decisionConfig.dimensions;

  let protectionLevelScore = 0;
  if (scroll.protectionLevel) {
    protectionLevelScore = dimConfig.protectionLevel.scores[scroll.protectionLevel] || 0;
  } else {
    missingFields.push('protectionLevel');
    protectionLevelScore = dimConfig.protectionLevel.scores['三级'];
  }

  let damageScore = 0;
  let damageLabels = [];
  const damageText = (scroll.damage || '').trim();
  if (damageText) {
    for (const rule of dimConfig.damage.keywordRules) {
      if (rule.keywords.some((kw) => damageText.includes(kw))) {
        damageScore += rule.score;
        if (!damageLabels.includes(rule.label)) {
          damageLabels.push(rule.label);
        }
      }
    }
    damageScore = Math.max(0, damageScore);
  } else {
    missingFields.push('damage');
    damageScore = 12;
    damageLabels = ['残损信息缺失'];
  }

  let lastRepairScore = 0;
  let lastRepairInfo = null;
  if (lastRepair) {
    lastRepairInfo = {
      date: lastRepair.date,
      status: lastRepair.status,
      process: lastRepair.process
    };
    const statusScore = dimConfig.lastRepair.statusScores[lastRepair.status];
    if (typeof statusScore === 'object') {
      const daysSinceRepair = Math.floor((Date.now() - new Date(lastRepair.date || lastRepair.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      lastRepairScore = daysSinceRepair < 7 ? statusScore.within7Days : statusScore.after7Days;
    } else {
      lastRepairScore = statusScore || 0;
    }
  }

  const pendingBatchCount = pendingBatches.length;
  const pendingBatchScore = pendingBatchCount * dimConfig.pendingRepairBatches.scorePerBatch;

  let clarityScore = 0;
  if (latestClarity) {
    clarityScore = dimConfig.imagingClarity.clarityScores[latestClarity] || 0;
  }

  const pendingInventoryScore = hasPendingInventory ? dimConfig.pendingInventory.score : 0;

  const materialScore = dimConfig.materialWarning.statusScores[materialStatusKey] || 0;

  let futureReservationScore = 0;
  const { borrowDate: targetBorrowDate, dueDate: targetDueDate } = options;
  if (targetBorrowDate && targetDueDate) {
    const overlapping = futureReservations.some((l) => dateOverlap(targetBorrowDate, targetDueDate, l.borrowDate, l.dueDate));
    if (overlapping) {
      futureReservationScore = dimConfig.futureReservations.overlappingScore;
    }
  } else {
    const within7Days = futureReservations.some((l) => {
      if (!l.borrowDate) return false;
      const borrowTime = parseDate(l.borrowDate).getTime();
      const daysDiff = Math.ceil((borrowTime - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff >= 0 && daysDiff <= 7;
    });
    if (within7Days) {
      futureReservationScore = dimConfig.futureReservations.within7DaysScore;
    }
  }

  const rawScore =
    protectionLevelScore +
    damageScore +
    lastRepairScore +
    pendingBatchScore +
    clarityScore +
    pendingInventoryScore +
    materialScore +
    futureReservationScore;

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  const decisionData = {
    scroll,
    protectionLevel: scroll.protectionLevel,
    damageScore,
    hasActiveRepair,
    hasPendingBatch,
    latestClarity,
    hasPendingInventory,
    materialStatusKey
  };

  let finalLevel = null;
  let finalLevelLabel = null;
  let finalTone = null;
  let blockReasons = [];
  let blockSuggestions = [];
  let triggeredBlockRule = null;

  for (const rule of decisionConfig.blockingRules) {
    try {
      if (rule.condition(decisionData)) {
        finalLevel = rule.result;
        triggeredBlockRule = rule.id;
        blockReasons.push(rule.reason);
        blockSuggestions.push(rule.suggestion);
        break;
      }
    } catch (e) {
      console.error('Blocking rule evaluation error:', rule.id, e);
    }
  }

  let isConservative = false;
  let conservativeReason = '';
  if (conservativeMode?.enabled && missingFields.length > 0 && !finalLevel) {
    isConservative = true;
    finalLevel = conservativeMode.defaultLevel || '需审批';
    conservativeReason = conservativeMode.incompleteDataReason || '数据不完整，采用保守评估';
    blockReasons.push(conservativeReason);
  }

  if (!finalLevel) {
    for (const level of decisionConfig.levels) {
      if (finalScore >= level.minScore && finalScore <= level.maxScore) {
        finalLevel = level.value;
        finalLevelLabel = level.label;
        finalTone = level.tone;
        break;
      }
    }
    if (!finalLevel) {
      finalLevel = '需审批';
      finalLevelLabel = '需审批';
      finalTone = 'warn';
    }
  } else {
    const matchedLevel = decisionConfig.levels.find((l) => l.value === finalLevel);
    finalLevelLabel = matchedLevel?.label || finalLevel;
    finalTone = matchedLevel?.tone || 'warn';
  }

  const suggestionActions = [
    ...blockSuggestions,
    ...(decisionConfig.suggestionActions[finalLevel] || [])
  ];

  const dimensionScores = {
    protectionLevel: {
      label: dimConfig.protectionLevel.label,
      score: protectionLevelScore,
      weight: dimConfig.protectionLevel.weight,
      value: scroll.protectionLevel || '未知'
    },
    damage: {
      label: dimConfig.damage.label,
      score: damageScore,
      weight: dimConfig.damage.weight,
      value: damageText || '无',
      labels: damageLabels
    },
    lastRepair: {
      label: dimConfig.lastRepair.label,
      score: lastRepairScore,
      weight: dimConfig.lastRepair.weight,
      value: lastRepair ? `${lastRepair.process}（${lastRepair.status}）` : '无修补记录',
      info: lastRepairInfo
    },
    pendingRepairBatches: {
      label: dimConfig.pendingRepairBatches.label,
      score: pendingBatchScore,
      weight: dimConfig.pendingRepairBatches.weight,
      value: pendingBatchCount > 0 ? `${pendingBatchCount}个进行中批次` : '无未完成批次',
      count: pendingBatchCount
    },
    imagingClarity: {
      label: dimConfig.imagingClarity.label,
      score: clarityScore,
      weight: dimConfig.imagingClarity.weight,
      value: latestClarity || '无影像记录'
    },
    pendingInventory: {
      label: dimConfig.pendingInventory.label,
      score: pendingInventoryScore,
      weight: dimConfig.pendingInventory.weight,
      value: hasPendingInventory ? `${pendingInventories.length}条待复核` : '无待复核盘点',
      count: pendingInventories.length
    },
    materialWarning: {
      label: dimConfig.materialWarning.label,
      score: materialScore,
      weight: dimConfig.materialWarning.weight,
      value: materialStatusKey,
      affectedMaterials: scrollMaterials.map((m) => ({ id: m.id, name: m.name, status: m.status }))
    },
    futureReservations: {
      label: dimConfig.futureReservations.label,
      score: futureReservationScore,
      weight: dimConfig.futureReservations.weight,
      value: futureReservations.length > 0 ? `${futureReservations.length}个未来预约` : '无未来预约',
      count: futureReservations.length
    }
  };

  return {
    scrollId,
    scrollTitle: scroll.title,
    level: finalLevel,
    levelLabel: finalLevelLabel,
    score: finalScore,
    tone: finalTone,
    blockReasons,
    suggestionActions,
    dimensionScores,
    triggeredBlockRule,
    isConservative,
    conservativeReason,
    missingFields,
    hasActiveRepair,
    hasPendingBatch,
    hasPendingInventory,
    latestClarity,
    futureReservationCount: futureReservations.length,
    evaluatedAt: new Date().toISOString()
  };
}

function assessBorrowabilityBatch(db, scrollIds = null, options = {}) {
  const scrolls = scrollIds
    ? (db.scrolls || []).filter((s) => scrollIds.includes(s.id))
    : (db.scrolls || []);
  
  const results = {};
  for (const scroll of scrolls) {
    results[scroll.id] = assessBorrowability(db, scroll.id, options);
  }
  return results;
}

module.exports = {
  ACTIVE_LOAN_STATUSES,
  RESCHEDULEABLE_STATUSES,
  RESCHEDULE_REVERT_STATUSES,
  PROTECTION_LEVEL_SCORE,
  BORROW_STATUS_SCORE,
  PURPOSE_RISK,
  DEFAULT_PURPOSE_RISK,
  DAMAGE_KEYWORDS,
  PROTECTION_ADVICE_RULES,
  parseDate,
  dateOverlap,
  checkLoanConflict,
  getActiveLoansByScroll,
  getLastRepair,
  assessLoanRisk,
  formatRiskNote,
  assessBorrowability,
  assessBorrowabilityBatch,
  generateProtectionAdvice
};
