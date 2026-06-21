#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
}

function createBackup(label = '') {
  if (!fs.existsSync(DB_FILE)) {
    console.error('错误：data/db.json 不存在，无法备份');
    process.exit(1);
  }

  ensureBackupDir();

  const ts = timestamp();
  const labelPart = label ? `-${label}` : '';
  const backupName = `db-${ts}${labelPart}.json`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  const content = fs.readFileSync(DB_FILE, 'utf8');
  fs.writeFileSync(backupPath, content, 'utf8');

  const stats = fs.statSync(backupPath);
  console.log(`✅ 备份成功：${backupName} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`   路径：${backupPath}`);

  const allBackups = listBackups();
  console.log(`   当前备份总数：${allBackups.length} 个`);

  return backupPath;
}

const args = process.argv.slice(2);
const label = args[0] || '';

createBackup(label);
