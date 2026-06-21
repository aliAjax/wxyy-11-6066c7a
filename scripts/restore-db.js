#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function restoreBackup(backupName) {
  const backupPath = path.join(BACKUP_DIR, backupName);

  if (!fs.existsSync(backupPath)) {
    console.error(`错误：备份文件不存在：${backupName}`);
    process.exit(1);
  }

  const backupContent = fs.readFileSync(backupPath, 'utf8');
  try {
    JSON.parse(backupContent);
  } catch (e) {
    console.error(`错误：备份文件 JSON 格式无效：${e.message}`);
    process.exit(1);
  }

  const hasCurrent = fs.existsSync(DB_FILE);

  console.log(`即将还原备份：${backupName}`);
  console.log(`目标文件：${DB_FILE}`);
  if (hasCurrent) {
    console.log('⚠️  注意：当前 db.json 将被覆盖！');
  }

  if (process.env.CI !== 'true') {
    const answer = await askQuestion('确认还原？(yes/no) ');
    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('已取消还原操作');
      process.exit(0);
    }
  }

  if (hasCurrent) {
    const ts = Date.now();
    const preRestoreBackup = path.join(BACKUP_DIR, `db-before-restore-${ts}.json`);
    fs.copyFileSync(DB_FILE, preRestoreBackup);
    console.log(`   已自动备份当前数据：db-before-restore-${ts}.json`);
  }

  fs.writeFileSync(DB_FILE, backupContent, 'utf8');
  const stats = fs.statSync(DB_FILE);
  console.log(`✅ 还原成功：${backupName} (${(stats.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  const args = process.argv.slice(2);
  let targetBackup = args[0];

  if (!targetBackup) {
    const backups = listBackups();
    if (backups.length === 0) {
      console.error('错误：没有找到任何备份文件');
      console.log(`   备份目录：${BACKUP_DIR}`);
      process.exit(1);
    }

    console.log('可用备份列表（最新在前）：');
    backups.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b}`);
    });
    console.log('');

    if (process.env.CI === 'true') {
      targetBackup = backups[0];
      console.log(`CI 环境自动选择最新备份：${targetBackup}`);
    } else {
      const answer = await askQuestion('请输入序号或备份文件名（默认 1）：');
      const idx = parseInt(answer, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= backups.length) {
        targetBackup = backups[idx - 1];
      } else if (answer && backups.includes(answer)) {
        targetBackup = answer;
      } else if (!answer) {
        targetBackup = backups[0];
      } else {
        console.error('错误：无效的选择');
        process.exit(1);
      }
    }
  }

  await restoreBackup(targetBackup);
}

main().catch((e) => {
  console.error('还原失败：', e.message);
  process.exit(1);
});
