const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const TEST_PORT = 13911;
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test-db.json');
const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

let passed = 0;
let failed = 0;
const failures = [];
let server = null;
const testQueue = [];

function describe(title, fn) {
  testQueue.push({ type: 'describe', title });
  fn();
}

function test(name, fn) {
  testQueue.push({ type: 'test', name, fn });
}

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': 'admin',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          if (res.headers['content-type']?.includes('application/json')) {
            parsed = JSON.parse(data);
          }
        } catch (e) {
          // not JSON, keep as string
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function setupTestDb() {
  if (!fs.existsSync(ORIGINAL_DB_PATH)) {
    throw new Error('原始 db.json 不存在，无法创建测试数据库');
  }
  fs.copyFileSync(ORIGINAL_DB_PATH, TEST_DB_PATH);
}

function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    process.env.PORT = TEST_PORT;
    process.env.DB_FILE = TEST_DB_PATH;

    delete require.cache[require.resolve('../server')];
    const { app } = require('../server');

    const srv = app.listen(TEST_PORT, () => {
      server = srv;
      resolve();
    });

    srv.on('error', reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

async function runTestQueue() {
  for (const item of testQueue) {
    if (item.type === 'describe') {
      console.log(`\n${item.title}`);
    } else if (item.type === 'test') {
      try {
        await item.fn();
        passed++;
        console.log(`  ✓ ${item.name}`);
      } catch (e) {
        failed++;
        failures.push({ name: item.name, error: e });
        console.log(`  ✗ ${item.name}`);
        console.log(`    ${e.message}`);
      }
    }
  }
}

describe('1. 基础接口检查', () => {
  test('GET /api/config 应返回配置信息', async () => {
    const res = await request('GET', '/api/config');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.title, '应包含 title 字段');
    assert.ok(res.body.port !== undefined, '应包含 port 字段');
  });

  test('GET /api/roles 应返回角色列表', async () => {
    const res = await request('GET', '/api/roles');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.roles), 'roles 应为数组');
    assert.ok(res.body.roles.length >= 4, '至少有4种角色');
  });
});

describe('2. 数据查询接口', () => {
  test('GET /api/db 应返回完整数据', async () => {
    const res = await request('GET', '/api/db');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.scrolls), '应包含 scrolls 数组');
    assert.ok(Array.isArray(res.body.loans), '应包含 loans 数组');
    assert.ok(res.body.scrolls.length > 0, '经卷数据不应为空');
  });

  test('GET /api/db 中的经卷应包含基本字段', async () => {
    const res = await request('GET', '/api/db');
    const scroll = res.body.scrolls[0];
    assert.ok(scroll.id, '应有 id');
    assert.ok(scroll.title, '应有 title');
    assert.ok(scroll.protectionLevel, '应有 protectionLevel');
    assert.ok(scroll.borrowStatus !== undefined, '应有 borrowStatus');
  });
});

describe('3. 借阅冲突检测接口', () => {
  test('GET /api/loans/check-conflict 应能检测冲突', async () => {
    const res = await request('GET', '/api/db');
    const scrollId = res.body.scrolls[0].id;

    const conflictRes = await request(
      'GET',
      `/api/loans/check-conflict?scrollId=${scrollId}&borrowDate=2026-06-01&dueDate=2026-12-31`
    );
    assert.strictEqual(conflictRes.status, 200);
    assert.strictEqual(typeof conflictRes.body.hasConflict, 'boolean');
    assert.ok(Array.isArray(conflictRes.body.conflicts), 'conflicts 应为数组');
  });

  test('缺少参数时应返回 400 错误', async () => {
    const res = await request('GET', '/api/loans/check-conflict?scrollId=test');
    assert.strictEqual(res.status, 400);
  });
});

describe('4. 风险评估接口', () => {
  test('POST /api/loans/assess-preview 应返回风险评估', async () => {
    const res = await request('GET', '/api/db');
    const scrollId = res.body.scrolls.find(s => s.borrowStatus === '可借阅')?.id || res.body.scrolls[0].id;

    const loan = {
      scrollId,
      borrower: '测试用户',
      purpose: '学术研究',
      borrowDate: '2026-07-01',
      dueDate: '2026-07-10',
      status: '待审批'
    };

    const assessRes = await request('POST', '/api/loans/assess-preview', loan);
    assert.strictEqual(assessRes.status, 200);
    assert.ok(assessRes.body.level, '应有风险等级');
    assert.ok(typeof assessRes.body.score === 'number', '应有风险分数');
    assert.ok(Array.isArray(assessRes.body.reasons), '应有评估原因');
  });
});

describe('5. 借阅申请 CRUD', () => {
  let createdLoanId = null;

  test('POST /api/loans 可以创建借阅申请', async () => {
    const res = await request('GET', '/api/db');
    const borrowableScroll = res.body.scrolls.find(
      s => s.borrowStatus === '可借阅' && s.protectionLevel === '三级'
    );
    if (!borrowableScroll) {
      console.log('    （跳过：未找到可借阅的三级经卷）');
      return;
    }

    const newLoan = {
      scrollId: borrowableScroll.id,
      borrower: 'API测试用户',
      purpose: '教学使用',
      borrowDate: '2026-08-01',
      dueDate: '2026-08-07',
      status: '待审批',
      reason: 'API集成测试用例'
    };

    const createRes = await request('POST', '/api/loans', newLoan);
    assert.strictEqual(createRes.status, 201);
    assert.ok(createRes.body.id, '新创建的借阅应有 id');
    assert.strictEqual(createRes.body.borrower, 'API测试用户');
    assert.strictEqual(createRes.body.status, '待审批');
    assert.ok(createRes.body.riskAssessment, '应包含风险评估结果');

    createdLoanId = createRes.body.id;
  });

  test('PATCH /api/loans/:id 可以更新借阅备注', async () => {
    if (!createdLoanId) {
      console.log('    （跳过：无已创建的借阅记录）');
      return;
    }

    const updateRes = await request(
      'PATCH',
      `/api/loans/${createdLoanId}`,
      { reason: 'API集成测试更新备注', note: '更新备注测试' }
    );
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.reason, 'API集成测试更新备注');
  });
});

describe('6. 时间线接口', () => {
  test('GET /api/scrolls/:id/timeline 应返回时间线数据', async () => {
    const res = await request('GET', '/api/db');
    const scrollId = res.body.scrolls[0].id;

    const timelineRes = await request('GET', `/api/scrolls/${scrollId}/timeline`);
    assert.strictEqual(timelineRes.status, 200);
    assert.strictEqual(timelineRes.body.scrollId, scrollId);
    assert.ok(Array.isArray(timelineRes.body.events), 'events 应为数组');
  });
});

describe('7. 权限控制', () => {
  test('访客角色不能创建借阅', async () => {
    const res = await request(
      'POST',
      '/api/loans',
      {
        scrollId: 'test',
        borrower: 'test',
        purpose: 'test',
        borrowDate: '2026-01-01',
        dueDate: '2026-01-02'
      },
      { 'x-user-role': 'guest' }
    );
    assert.strictEqual(res.status, 403);
  });
});

describe('8. 材料状态预览接口', () => {
  test('POST /api/materials/status-preview 应返回材料状态', async () => {
    const res = await request('POST', '/api/materials/status-preview', {
      name: '测试材料',
      quantity: 1,
      unit: '瓶',
      expiryDate: '2020-01-01'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.status, '应有 status 字段');
    assert.ok(Array.isArray(res.body.reasons), '应有 reasons 数组');
  });
});

async function main() {
  try {
    setupTestDb();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  API 接口级集成测试');
    console.log(`  测试端口：${TEST_PORT}`);
    console.log(`  测试数据库：data/test-db.json`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📋 测试数据库已准备');

    await startServer();
    console.log('  🚀 测试服务器已启动');

    await runTestQueue();

    await stopServer();
    console.log('\n  🛑 测试服务器已停止');

    cleanupTestDb();
    console.log('  🧹 测试数据已清理');

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
      console.log('\n✅ 所有接口测试通过！');
      process.exit(0);
    }
  } catch (e) {
    console.error('\n❌ 测试执行失败：', e.message);
    console.error(e.stack);

    try {
      await stopServer();
    } catch (_) {}
    try {
      cleanupTestDb();
    } catch (_) {}

    process.exit(1);
  }
}

main();
