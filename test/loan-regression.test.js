const assert = require('assert');
const {
  dateOverlap,
  checkLoanConflict,
  assessLoanRisk,
  assessBorrowability,
  ACTIVE_LOAN_STATUSES,
  PURPOSE_RISK
} = require('../server');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function describe(title, fn) {
  console.log(`\n${title}`);
  fn();
}

describe('1. 日期重叠检测 (dateOverlap)', () => {
  test('完全重叠的两段日期应返回 true', () => {
    assert.strictEqual(dateOverlap('2026-06-10', '2026-06-20', '2026-06-12', '2026-06-15'), true);
  });

  test('左边界部分重叠应返回 true', () => {
    assert.strictEqual(dateOverlap('2026-06-10', '2026-06-15', '2026-06-12', '2026-06-20'), true);
  });

  test('右边界部分重叠应返回 true', () => {
    assert.strictEqual(dateOverlap('2026-06-15', '2026-06-20', '2026-06-10', '2026-06-18'), true);
  });

  test('端点接触（结束日=开始日）应返回 true', () => {
    assert.strictEqual(dateOverlap('2026-06-10', '2026-06-15', '2026-06-15', '2026-06-20'), true);
  });

  test('完全不重叠（前者在后者之前）应返回 false', () => {
    assert.strictEqual(dateOverlap('2026-06-10', '2026-06-14', '2026-06-16', '2026-06-20'), false);
  });

  test('完全不重叠（后者在前者之前）应返回 false', () => {
    assert.strictEqual(dateOverlap('2026-06-16', '2026-06-20', '2026-06-10', '2026-06-14'), false);
  });

  test('单日借阅与同一天借阅应返回 true', () => {
    assert.strictEqual(dateOverlap('2026-06-15', '2026-06-15', '2026-06-15', '2026-06-15'), true);
  });

  test('前者完全包含后者应返回 true', () => {
    assert.strictEqual(dateOverlap('2026-06-01', '2026-06-30', '2026-06-10', '2026-06-20'), true);
  });
});

describe('2. 借阅冲突检测 (checkLoanConflict)', () => {
  const baseDb = {
    scrolls: [
      { id: 'scroll-1', title: '测试经卷A', borrowStatus: '可借阅', protectionLevel: '三级', damage: '完好' },
      { id: 'scroll-2', title: '测试经卷B', borrowStatus: '可借阅', protectionLevel: '三级', damage: '完好' }
    ],
    loans: [
      {
        id: 'loan-1',
        scrollId: 'scroll-1',
        borrower: '张三',
        purpose: '学术研究',
        borrowDate: '2026-06-10',
        dueDate: '2026-06-20',
        status: '待审批'
      },
      {
        id: 'loan-2',
        scrollId: 'scroll-1',
        borrower: '李四',
        purpose: '展览筹备',
        borrowDate: '2026-06-25',
        dueDate: '2026-06-30',
        status: '已批准'
      },
      {
        id: 'loan-3',
        scrollId: 'scroll-2',
        borrower: '王五',
        purpose: '教学使用',
        borrowDate: '2026-06-10',
        dueDate: '2026-06-15',
        status: '已借出'
      },
      {
        id: 'loan-4',
        scrollId: 'scroll-1',
        borrower: '赵六',
        purpose: '馆藏整理',
        borrowDate: '2026-07-01',
        dueDate: '2026-07-05',
        status: '已归还'
      },
      {
        id: 'loan-5',
        scrollId: 'scroll-1',
        borrower: '钱七',
        purpose: '出版印刷',
        borrowDate: '2026-07-10',
        dueDate: '2026-07-15',
        status: '已拒绝'
      }
    ]
  };

  test('同一经卷日期完全重叠应检测到冲突', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-06-12', '2026-06-18');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].id, 'loan-1');
    assert.strictEqual(conflicts[0].borrower, '张三');
  });

  test('同一经卷日期部分重叠应检测到冲突', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-06-18', '2026-06-28');
    assert.strictEqual(conflicts.length, 2);
    const ids = conflicts.map(c => c.id).sort();
    assert.deepStrictEqual(ids, ['loan-1', 'loan-2']);
  });

  test('不同经卷的借阅不应产生冲突', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-2', '2026-06-10', '2026-06-20');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].id, 'loan-3');
  });

  test('已归还的借阅记录不应计入冲突', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-07-01', '2026-07-05');
    assert.strictEqual(conflicts.length, 0);
  });

  test('已拒绝的借阅记录不应计入冲突', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-07-10', '2026-07-15');
    assert.strictEqual(conflicts.length, 0);
  });

  test('排除当前借阅记录后无冲突应返回空数组', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-06-10', '2026-06-20', 'loan-1');
    assert.strictEqual(conflicts.length, 0);
  });

  test('排除当前借阅记录后仍有其他冲突应返回剩余冲突', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-06-15', '2026-06-28', 'loan-1');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].id, 'loan-2');
  });

  test('改期场景：排除自身后与另一笔冲突应正确检测', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', borrowStatus: '可借阅', protectionLevel: '三级', damage: '完好' }],
      loans: [
        { id: 'loan-1', scrollId: 'scroll-1', borrower: '张三', purpose: '学术研究', borrowDate: '2026-06-10', dueDate: '2026-06-20', status: '已批准' },
        { id: 'loan-2', scrollId: 'scroll-1', borrower: '李四', purpose: '教学使用', borrowDate: '2026-06-15', dueDate: '2026-06-25', status: '待审批' }
      ]
    };
    const conflicts = checkLoanConflict(db, 'scroll-1', '2026-06-12', '2026-06-22', 'loan-1');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].id, 'loan-2');
    assert.strictEqual(conflicts[0].status, '待审批');
  });

  test('冲突记录应包含经卷标题', () => {
    const conflicts = checkLoanConflict(baseDb, 'scroll-1', '2026-06-12', '2026-06-18');
    assert.strictEqual(conflicts[0].scrollTitle, '测试经卷A');
  });

  test('活跃借阅状态均应计入冲突', () => {
    const statuses = ACTIVE_LOAN_STATUSES;
    for (const status of statuses) {
      const db = {
        scrolls: [{ id: 's1', title: '测试', borrowStatus: '可借阅', protectionLevel: '三级', damage: '完好' }],
        loans: [{ id: 'l1', scrollId: 's1', borrower: '测试', purpose: '测试', borrowDate: '2026-06-10', dueDate: '2026-06-20', status }]
      };
      const conflicts = checkLoanConflict(db, 's1', '2026-06-15', '2026-06-25');
      assert.strictEqual(conflicts.length, 1, `状态"${status}"应计入冲突`);
    }
  });
});

describe('3. 修补中经卷的风险与可借阅性评估', () => {
  test('进行中修补应触发不可借阅阻断规则', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [
        { id: 'repair-1', scrollId: 'scroll-1', process: '除尘', status: '进行中', date: '2026-06-10', conservator: '测试员' }
      ],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '不可借阅');
    assert.ok(borrowability.blockReasons.some(r => r.includes('修补')),
      '应包含修补相关的阻断原因');
  });

  test('未完成修补批次应触发不可借阅阻断规则', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [],
      repairBatches: [
        { id: 'batch-1', scrollId: 'scroll-1', status: '进行中', templateName: '测试模板', conservator: '测试员' }
      ],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '不可借阅');
    assert.ok(borrowability.blockReasons.some(r => r.includes('修补') || r.includes('批次')),
      '应包含修补批次相关的阻断原因');
  });

  test('修补中经卷的风险评估应为极高风险', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [
        { id: 'repair-1', scrollId: 'scroll-1', process: '托裱', status: '进行中', date: '2026-06-10', conservator: '测试员' }
      ],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const loan = {
      scrollId: 'scroll-1',
      borrower: '测试人员',
      purpose: '学术研究',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-20',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    assert.strictEqual(assessment.level, '极高风险');
    assert.ok(assessment.isStrictMode, '不可借阅级别应启用严格模式');
    assert.ok(assessment.reasons.some(r => r.includes('不可借阅')),
      '风险原因应包含不可借阅相关描述');
  });

  test('计划中修补应增加风险分值', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [
        { id: 'repair-1', scrollId: 'scroll-1', process: '除尘', status: '计划中', date: '2026-06-20', conservator: '测试员' }
      ],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.ok(borrowability.score > 5, '有计划中修补的经卷风险分应高于普通经卷');
  });

  test('无修补记录的三级完好经卷应为可借阅', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '可借阅');
  });

  test('修补完成7天内经卷应有较高风险分', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const dateStr = recentDate.toISOString().split('T')[0];
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [
        { id: 'repair-1', scrollId: 'scroll-1', process: '补纸', status: '已完成', date: dateStr, conservator: '测试员' }
      ],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.ok(borrowability.score > 0, '刚完成修补的经卷应有风险加分');
  });
});

describe('4. 限制借阅经卷的风险评估', () => {
  test('待复核盘点应触发限制借阅阻断规则', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [
        { id: 'inv-1', scrollId: 'scroll-1', status: '待复核', inventoryDate: '2026-06-10', inventoryPerson: '测试员', result: '异常', cabinet: 'A-01' }
      ],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '限制借阅');
    assert.ok(borrowability.blockReasons.some(r => r.includes('盘点')),
      '应包含盘点相关的阻断原因');
  });

  test('影像模糊应触发限制借阅阻断规则', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [],
      repairBatches: [],
      loans: [],
      imagings: [
        { id: 'img-1', scrollId: 'scroll-1', clarity: '模糊', captureDate: '2026-06-10', photographer: '测试员', batch: '测试批次', imageCode: 'IMG-001' }
      ],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '限制借阅');
    assert.ok(borrowability.blockReasons.some(r => r.includes('影像') || r.includes('清晰度')),
      '应包含影像清晰度相关的阻断原因');
  });

  test('影像待重拍应触发限制借阅阻断规则', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [],
      repairBatches: [],
      loans: [],
      imagings: [
        { id: 'img-1', scrollId: 'scroll-1', clarity: '待重拍', captureDate: '2026-06-10', photographer: '测试员', batch: '测试批次', imageCode: 'IMG-001' }
      ],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '限制借阅');
  });

  test('限制借阅级别的风险评估应为高风险', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '测试经卷', protectionLevel: '三级', borrowStatus: '可借阅', damage: '完好', material: '宣纸', era: '清代' }],
      repairs: [],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [
        { id: 'inv-1', scrollId: 'scroll-1', status: '待复核', inventoryDate: '2026-06-10', inventoryPerson: '测试员', result: '异常', cabinet: 'A-01' }
      ],
      materials: []
    };
    const loan = {
      scrollId: 'scroll-1',
      borrower: '测试人员',
      purpose: '学术研究',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-20',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    assert.strictEqual(assessment.level, '高风险');
    assert.ok(assessment.isStrictMode, '限制借阅级别应启用严格模式');
  });

  test('一级保护 + 明显残损应直接阻断为不可借阅', () => {
    const db = {
      scrolls: [{ id: 'scroll-1', title: '珍贵经卷', protectionLevel: '一级', borrowStatus: '可借阅', damage: '卷首断裂，多处残损', material: '麻纸', era: '宋代' }],
      repairs: [],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const borrowability = assessBorrowability(db, 'scroll-1');
    assert.strictEqual(borrowability.level, '不可借阅');
    assert.ok(borrowability.blockReasons.some(r => r.includes('一级') || r.includes('残损')),
      '应包含一级保护或残损相关的阻断原因');
  });
});

describe('5. 极高风险用途评估', () => {
  const baseDb = {
    scrolls: [
      {
        id: 'scroll-1',
        title: '普通经卷',
        protectionLevel: '三级',
        borrowStatus: '可借阅',
        damage: '完好',
        material: '宣纸',
        era: '清代'
      }
    ],
    loans: [],
    repairs: [],
    repairBatches: [],
    imagings: [],
    inventories: [],
    materials: []
  };

  const makeLoan = (purpose, borrowDate = '2026-06-15', dueDate = '2026-06-20') => ({
    scrollId: 'scroll-1',
    borrower: '测试人员',
    purpose,
    borrowDate,
    dueDate,
    status: '待审批'
  });

  test('外借展示用途风险分值为32（最高用途风险）', () => {
    assert.strictEqual(PURPOSE_RISK['外借展示'].score, 32);
    assert.ok(PURPOSE_RISK['外借展示'].desc.includes('极高风险'),
      '外借展示应标记为极高风险用途');
  });

  test('教学使用用途风险分值为8（低风险用途）', () => {
    assert.strictEqual(PURPOSE_RISK['教学使用'].score, 8);
  });

  test('展览筹备用途风险分值为28（高风险用途）', () => {
    assert.strictEqual(PURPOSE_RISK['展览筹备'].score, 28);
  });

  test('出版印刷用途风险分值为25（高风险用途）', () => {
    assert.strictEqual(PURPOSE_RISK['出版印刷'].score, 25);
  });

  test('学术研究用途风险分值为15（中等风险用途）', () => {
    assert.strictEqual(PURPOSE_RISK['学术研究'].score, 15);
  });

  test('外借展示 + 不可借阅经卷 = 极高风险', () => {
    const db = {
      ...baseDb,
      scrolls: [{ ...baseDb.scrolls[0], id: 'scroll-rare', protectionLevel: '一级', damage: '严重虫蛀，多处脆化' }],
      repairs: [
        { id: 'r1', scrollId: 'scroll-rare', status: '进行中', process: '托裱', date: '2026-06-10', conservator: '测试' }
      ]
    };
    const loan = { ...makeLoan('外借展示'), scrollId: 'scroll-rare' };
    const assessment = assessLoanRisk(db, loan);
    assert.strictEqual(assessment.level, '极高风险');
  });

  test('外借展示 + 限制借阅经卷 = 高风险（限制借阅级直接触发高风险）', () => {
    const db = {
      ...baseDb,
      scrolls: [{ ...baseDb.scrolls[0], id: 'scroll-restricted' }],
      inventories: [
        { id: 'inv-1', scrollId: 'scroll-restricted', status: '待复核', inventoryDate: '2026-06-10', inventoryPerson: '测试', result: '异常', cabinet: 'A-01' }
      ]
    };
    const loan = { ...makeLoan('外借展示'), scrollId: 'scroll-restricted' };
    const assessment = assessLoanRisk(db, loan);
    assert.strictEqual(assessment.level, '高风险');
    assert.ok(assessment.isStrictMode, '限制借阅应启用严格模式');
    assert.ok(assessment.score >= 45, `高风险级别得分应较高，实际为${assessment.score}`);
  });

  test('未知用途应使用默认风险分值', () => {
    const assessment = assessLoanRisk(baseDb, makeLoan('未知用途'));
    assert.ok(assessment.reasons.some(r => r.includes('通用风险')),
      '未知用途应使用通用风险描述');
  });

  test('长期借阅（>21天）应额外增加风险分值', () => {
    const loan = {
      ...makeLoan('学术研究'),
      borrowDate: '2026-06-01',
      dueDate: '2026-06-30'
    };
    const assessment = assessLoanRisk(baseDb, loan);
    assert.ok(assessment.reasons.some(r => r.includes('借阅周期过长')),
      '长期借阅应包含周期过长原因');
  });

  test('短期借阅（<=7天）应减少风险分值', () => {
    const loan = {
      ...makeLoan('学术研究'),
      borrowDate: '2026-06-15',
      dueDate: '2026-06-20'
    };
    const assessment = assessLoanRisk(baseDb, loan);
    assert.ok(assessment.reasons.some(r => r.includes('借阅周期合理')),
      '短期借阅应包含周期合理原因');
  });

  test('外借展示 + 长期借阅 + 一级保护 = 高风险（接近极高风险阈值）', () => {
    const db = {
      ...baseDb,
      scrolls: [{ ...baseDb.scrolls[0], id: 'scroll-premium', protectionLevel: '一级', damage: '轻微磨损' }]
    };
    const loan = {
      scrollId: 'scroll-premium',
      borrower: '测试',
      purpose: '外借展示',
      borrowDate: '2026-06-01',
      dueDate: '2026-07-15',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    assert.strictEqual(assessment.level, '高风险');
    assert.ok(assessment.score >= 75, `高风险组合得分应较高，实际为${assessment.score}`);
  });

  test('不可借阅级经卷 + 任何用途 = 极高风险', () => {
    const db = {
      ...baseDb,
      scrolls: [{ ...baseDb.scrolls[0], id: 'scroll-unborrowable', protectionLevel: '一级', damage: '卷首脆裂，虫蛀严重' }],
      repairs: [
        { id: 'r1', scrollId: 'scroll-unborrowable', status: '进行中', process: '托裱', date: '2026-06-10', conservator: '测试' }
      ]
    };
    const loan = {
      scrollId: 'scroll-unborrowable',
      borrower: '测试',
      purpose: '学术研究',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-20',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    assert.strictEqual(assessment.level, '极高风险');
    assert.ok(assessment.score >= 85, `不可借阅级经卷得分应>=85，实际为${assessment.score}`);
    assert.ok(assessment.isStrictMode, '极高风险应启用严格模式');
  });

  test('风险分值被限制在 0-100 范围内', () => {
    const db = {
      ...baseDb,
      scrolls: [{ ...baseDb.scrolls[0], id: 'scroll-max', protectionLevel: '一级', damage: '虫蛀严重，脆化断裂' }],
      repairs: [
        { id: 'r1', scrollId: 'scroll-max', status: '进行中', process: '托裱', date: '2026-06-10', conservator: '测试' }
      ],
      repairBatches: [
        { id: 'b1', scrollId: 'scroll-max', status: '进行中', templateName: '大修方案', conservator: '测试' }
      ]
    };
    const loan = {
      scrollId: 'scroll-max',
      borrower: '测试',
      purpose: '外借展示',
      borrowDate: '2026-06-01',
      dueDate: '2026-08-31',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    assert.ok(assessment.score >= 0 && assessment.score <= 100,
      `风险分值应在0-100范围内，实际为${assessment.score}`);
    assert.strictEqual(assessment.level, '极高风险');
  });
});

describe('6. 借阅审批综合判断（风险 + 冲突 + 状态）', () => {
  const makeScroll = (id, status, level = '三级', damage = '完好') => ({
    id,
    title: `经卷${id}`,
    protectionLevel: level,
    borrowStatus: status,
    damage,
    material: '宣纸',
    era: '清代'
  });

  test('可借阅经卷 + 低风险用途 + 无冲突 = 低风险可通过', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅')],
      loans: [],
      repairs: [],
      repairBatches: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const loan = {
      scrollId: 's1',
      borrower: '测试',
      purpose: '教学使用',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-18',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    const conflicts = checkLoanConflict(db, 's1', '2026-06-15', '2026-06-18');
    const borrowability = assessBorrowability(db, 's1');
    assert.strictEqual(assessment.level, '低风险');
    assert.strictEqual(conflicts.length, 0);
    assert.strictEqual(borrowability.level, '可借阅');
  });

  test('修补中经卷（有实际修补记录） = 极高风险 + 不可借阅', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅')],
      repairs: [
        { id: 'r1', scrollId: 's1', status: '进行中', process: '托裱', date: '2026-06-10', conservator: '测试' }
      ],
      repairBatches: [],
      loans: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const loan = {
      scrollId: 's1',
      borrower: '测试',
      purpose: '学术研究',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-18',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    const borrowability = assessBorrowability(db, 's1');
    assert.strictEqual(assessment.level, '极高风险');
    assert.strictEqual(borrowability.level, '不可借阅');
    assert.ok(assessment.isStrictMode);
  });

  test('日期冲突 + 高风险经卷 = 双重拒绝理由', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅', '一级', '边缘磨损')],
      loans: [
        {
          id: 'loan-existing',
          scrollId: 's1',
          borrower: '已有借阅人',
          purpose: '展览筹备',
          borrowDate: '2026-06-10',
          dueDate: '2026-06-20',
          status: '已批准'
        }
      ],
      repairs: [],
      repairBatches: [],
      imagings: [],
      inventories: [
        { id: 'inv-1', scrollId: 's1', status: '待复核', inventoryDate: '2026-06-05', inventoryPerson: '测试', result: '异常', cabinet: 'A-01' }
      ],
      materials: []
    };
    const loan = {
      scrollId: 's1',
      borrower: '新借阅人',
      purpose: '外借展示',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-25',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    const conflicts = checkLoanConflict(db, 's1', '2026-06-15', '2026-06-25');
    assert.strictEqual(assessment.level, '极高风险');
    assert.ok(conflicts.length > 0);
  });

  test('改期排除自身后无冲突 + 限制借阅 = 改期成功但仍高风险', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅')],
      loans: [
        {
          id: 'loan-self',
          scrollId: 's1',
          borrower: '本人',
          purpose: '学术研究',
          borrowDate: '2026-06-10',
          dueDate: '2026-06-15',
          status: '已批准'
        }
      ],
      repairs: [],
      repairBatches: [],
      imagings: [],
      inventories: [
        { id: 'inv-1', scrollId: 's1', status: '待复核', inventoryDate: '2026-06-01', inventoryPerson: '测试', result: '异常', cabinet: 'A-01' }
      ],
      materials: []
    };
    const newBorrowDate = '2026-06-20';
    const newDueDate = '2026-06-30';
    const conflicts = checkLoanConflict(db, 's1', newBorrowDate, newDueDate, 'loan-self');
    const mergedLoan = { ...db.loans[0], borrowDate: newBorrowDate, dueDate: newDueDate };
    const assessment = assessLoanRisk(db, mergedLoan);
    assert.strictEqual(conflicts.length, 0, '排除自身后应无冲突');
    assert.strictEqual(assessment.level, '高风险', '限制借阅经卷仍应为高风险');
  });

  test('改期排除自身后仍有冲突 = 改期被拒绝', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅')],
      loans: [
        {
          id: 'loan-self',
          scrollId: 's1',
          borrower: '本人',
          purpose: '学术研究',
          borrowDate: '2026-06-10',
          dueDate: '2026-06-15',
          status: '已批准'
        },
        {
          id: 'loan-other',
          scrollId: 's1',
          borrower: '他人',
          purpose: '教学使用',
          borrowDate: '2026-06-18',
          dueDate: '2026-06-25',
          status: '待审批'
        }
      ],
      repairs: [],
      repairBatches: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const newBorrowDate = '2026-06-20';
    const newDueDate = '2026-06-22';
    const conflicts = checkLoanConflict(db, 's1', newBorrowDate, newDueDate, 'loan-self');
    assert.strictEqual(conflicts.length, 1, '排除自身后仍应检测到与其他借阅的冲突');
    assert.strictEqual(conflicts[0].id, 'loan-other');
  });

  test('多笔活跃借阅叠加 + 新申请重叠 = 检测到全部冲突', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅')],
      loans: [
        { id: 'l1', scrollId: 's1', borrower: 'A', purpose: '研究', borrowDate: '2026-06-01', dueDate: '2026-06-10', status: '已借出' },
        { id: 'l2', scrollId: 's1', borrower: 'B', purpose: '展览', borrowDate: '2026-06-08', dueDate: '2026-06-15', status: '已批准' },
        { id: 'l3', scrollId: 's1', borrower: 'C', purpose: '教学', borrowDate: '2026-06-12', dueDate: '2026-06-20', status: '待审批' }
      ],
      repairs: [],
      repairBatches: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const conflicts = checkLoanConflict(db, 's1', '2026-06-05', '2026-06-18');
    assert.strictEqual(conflicts.length, 3, '应检测到全部3笔冲突');
  });

  test('风险评估应包含可借阅性评估结果', () => {
    const db = {
      scrolls: [makeScroll('s1', '可借阅', '三级', '完好')],
      loans: [],
      repairs: [],
      repairBatches: [],
      imagings: [],
      inventories: [],
      materials: []
    };
    const loan = {
      scrollId: 's1',
      borrower: '测试',
      purpose: '学术研究',
      borrowDate: '2026-06-15',
      dueDate: '2026-06-20',
      status: '待审批'
    };
    const assessment = assessLoanRisk(db, loan);
    assert.ok(assessment.borrowability, '风险评估应包含可借阅性评估结果');
    assert.ok(assessment.reasons.some(r => r.includes('可借阅性')),
      '风险原因应包含可借阅性评估');
  });
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`测试结果：通过 ${passed} 项，失败 ${failed} 项`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

if (failed > 0) {
  console.log('\n失败详情：');
  failures.forEach((f, i) => {
    console.log(`\n  ${i + 1}. ${f.name}`);
    console.log(`     ${f.error.message}`);
    if (f.error.stack) {
      const stackLines = f.error.stack.split('\n').slice(1, 3).join('\n     ');
      console.log(`     ${stackLines}`);
    }
  });
  process.exit(1);
} else {
  console.log('\n✅ 所有测试通过！借阅审批相关判断逻辑正常。');
  console.log('   覆盖范围：日期重叠检测、冲突检测（含排除自身改期）、');
  console.log('           修补中/限制借阅风险评估、极高风险用途、综合审批判断');
  process.exit(0);
}
