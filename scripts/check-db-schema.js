#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

const SCHEMA = {
  scrolls: {
    required: ['id', 'title', 'protectionLevel', 'borrowStatus'],
    optional: ['material', 'era', 'damage', 'inscription', 'cabinet', 'createdAt', 'updatedAt', 'history', 'protectionAdvice']
  },
  repairs: {
    required: ['id', 'scrollId', 'process', 'status'],
    optional: ['conservator', 'date', 'materialUsed', 'materialId', 'note', 'batchId', 'sortOrder', 'attachmentCode', 'externalLink', 'createdAt', 'updatedAt', 'history']
  },
  repairBatches: {
    required: ['id', 'scrollId', 'status'],
    optional: ['name', 'templateId', 'templateName', 'conservator', 'startDate', 'expectedEndDate', 'progressSummary', 'note', 'createdAt', 'updatedAt', 'history']
  },
  repairTemplates: {
    required: ['id', 'name', 'status'],
    optional: ['processes', 'description', 'createdAt', 'updatedAt', 'history']
  },
  loans: {
    required: ['id', 'scrollId', 'borrower', 'purpose', 'borrowDate', 'dueDate', 'status'],
    optional: ['reason', 'riskAssessment', 'rescheduleHistory', 'conditions', 'conditionsSummary', 'conditionsNote', 'note', 'createdAt', 'updatedAt', 'history']
  },
  imagings: {
    required: ['id', 'scrollId', 'captureDate', 'clarity'],
    optional: ['resolution', 'format', 'operator', 'photographer', 'note', 'batch', 'imageCode', 'attachmentCode', 'externalLink', 'createdAt', 'updatedAt', 'history']
  },
  inventories: {
    required: ['id', 'scrollId', 'inventoryDate', 'status'],
    optional: ['operator', 'inventoryPerson', 'note', 'result', 'cabinet', 'exceptionNote', 'attachmentCode', 'externalLink', 'createdAt', 'updatedAt', 'history']
  },
  materials: {
    required: ['id', 'name', 'quantity', 'unit'],
    optional: ['category', 'type', 'specification', 'batch', 'location', 'expiryDate', 'status', 'statusReasons', 'note', 'createdAt', 'updatedAt', 'history']
  },
  observations: {
    required: ['id', 'scrollId', 'observer', 'content'],
    optional: ['attachmentCode', 'externalLink', 'createdAt', 'updatedAt', 'history']
  },
  audits: {
    required: ['id', 'timestamp', 'operator', 'collection', 'action'],
    optional: ['operatorRole', 'operatorRoleName', 'collectionLabel', 'itemId', 'itemTitle', 'actionLabel', 'changes', 'note', 'ip']
  },
  drafts: {
    required: ['id'],
    optional: []
  }
};

let errors = [];
let warnings = [];

function checkFileExists() {
  if (!fs.existsSync(DB_FILE)) {
    errors.push('data/db.json 文件不存在');
    return false;
  }
  return true;
}

function checkValidJson() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    errors.push(`JSON 格式无效：${e.message}`);
    return null;
  }
}

function checkCollections(db) {
  if (typeof db !== 'object' || db === null || Array.isArray(db)) {
    errors.push('db.json 根节点必须是对象');
    return;
  }

  for (const name of Object.keys(SCHEMA)) {
    if (db[name] === undefined) {
      warnings.push(`缺少集合 "${name}"，已自动视为空数组`);
      db[name] = [];
    } else if (!Array.isArray(db[name])) {
      errors.push(`集合 "${name}" 必须是数组类型，实际为 ${typeof db[name]}`);
    }
  }

  const knownKeys = new Set(Object.keys(SCHEMA));
  for (const key of Object.keys(db)) {
    if (!knownKeys.has(key)) {
      warnings.push(`存在未知集合 "${key}"，schema 中未定义`);
    }
  }
}

function checkItems(db) {
  for (const [name, schema] of Object.entries(SCHEMA)) {
    const items = db[name];
    if (!Array.isArray(items)) continue;

    const requiredFields = schema.required;
    const allKnownFields = new Set([...requiredFields, ...schema.optional]);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemLabel = item.id ? `${name}[${item.id}]` : `${name}[${i}]`;

      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        errors.push(`${itemLabel} 必须是对象类型`);
        continue;
      }

      for (const field of requiredFields) {
        if (item[field] === undefined || item[field] === null || item[field] === '') {
          if (field === 'id') {
            errors.push(`${itemLabel} 缺少必填字段 "${field}"`);
          } else {
            warnings.push(`${itemLabel} 缺少建议字段 "${field}"`);
          }
        }
      }

      for (const key of Object.keys(item)) {
        if (!allKnownFields.has(key)) {
          warnings.push(`${itemLabel} 存在未知字段 "${key}"`);
        }
      }
    }
  }
}

function checkRelations(db) {
  const scrollIds = new Set((db.scrolls || []).map((s) => s.id));
  const materialIds = new Set((db.materials || []).map((m) => m.id));

  for (const repair of db.repairs || []) {
    if (repair.scrollId && !scrollIds.has(repair.scrollId)) {
      warnings.push(`修补记录 ${repair.id} 引用了不存在的经卷 ${repair.scrollId}`);
    }
    if (repair.materialId && !materialIds.has(repair.materialId)) {
      warnings.push(`修补记录 ${repair.id} 引用了不存在的材料 ${repair.materialId}`);
    }
  }

  for (const loan of db.loans || []) {
    if (loan.scrollId && !scrollIds.has(loan.scrollId)) {
      warnings.push(`借阅记录 ${loan.id} 引用了不存在的经卷 ${loan.scrollId}`);
    }
  }

  for (const imaging of db.imagings || []) {
    if (imaging.scrollId && !scrollIds.has(imaging.scrollId)) {
      warnings.push(`影像记录 ${imaging.id} 引用了不存在的经卷 ${imaging.scrollId}`);
    }
  }

  for (const inv of db.inventories || []) {
    if (inv.scrollId && !scrollIds.has(inv.scrollId)) {
      warnings.push(`盘点记录 ${inv.id} 引用了不存在的经卷 ${inv.scrollId}`);
    }
  }

  for (const obs of db.observations || []) {
    if (obs.scrollId && !scrollIds.has(obs.scrollId)) {
      warnings.push(`观察记录 ${obs.id} 引用了不存在的经卷 ${obs.scrollId}`);
    }
  }

  for (const batch of db.repairBatches || []) {
    if (batch.scrollId && !scrollIds.has(batch.scrollId)) {
      warnings.push(`修补批次 ${batch.id} 引用了不存在的经卷 ${batch.scrollId}`);
    }
  }
}

function printSummary(db) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  数据结构检查结果');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (db) {
    console.log('\n  📊 各集合数量统计：');
    for (const name of Object.keys(SCHEMA)) {
      const count = Array.isArray(db[name]) ? db[name].length : 0;
      console.log(`     ${name.padEnd(20)} ${count} 条`);
    }
  }

  console.log(`\n  ✅ 错误：${errors.length} 项`);
  console.log(`  ⚠️  警告：${warnings.length} 项`);

  if (errors.length > 0) {
    console.log('\n  错误详情：');
    errors.forEach((e, i) => console.log(`     ${i + 1}. ${e}`));
  }

  if (warnings.length > 0 && process.env.VERBOSE === 'true') {
    console.log('\n  警告详情：');
    warnings.forEach((w, i) => console.log(`     ${i + 1}. ${w}`));
  } else if (warnings.length > 0) {
    console.log(`\n  💡 使用 VERBOSE=true 查看全部 ${warnings.length} 条警告`);
  }

  console.log('');
}

function main() {
  if (!checkFileExists()) {
    printSummary(null);
    process.exit(1);
  }

  const db = checkValidJson();
  if (!db) {
    printSummary(null);
    process.exit(1);
  }

  checkCollections(db);
  checkItems(db);
  checkRelations(db);
  printSummary(db);

  if (errors.length > 0) {
    process.exit(1);
  } else {
    console.log('  🎉 结构检查通过！数据格式正常。');
    process.exit(0);
  }
}

main();
