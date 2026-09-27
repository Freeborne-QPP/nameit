// 从正赛阵容大全（西域版）.xlsx 生成清洗后的阵容数据集
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { clean, normSearch } = require('../normalize');

const FILE = 'c:\\Users\\asus\\.trae-cn\\attachments\\6ab788c4e168ada1b4f53b56\\8a9e28cd-42e9-4d81-8b4d-c937a1ac6fec_d4392c4d-46d5-4f81-8bfc-2d2f465ec575_正赛阵容大全（西域版）.xlsx';
const OUT = path.join(__dirname, '..', 'data', 'lineups.json');

// 赛季映射（与源表一致：1-25 期是 S0 季前赛）
function seasonOf(row) {
  if (row >= 1 && row <= 25) return 'S0';
  if (row >= 26 && row <= 50) return 'S1';
  if (row >= 51 && row <= 75) return 'S2';
  if (row >= 76 && row <= 100) return 'S3';
  if (row >= 101 && row <= 150) return 'S4';
  if (row >= 151 && row <= 175) return 'S5';
  if (row >= 176 && row <= 300) return 'S6';
  if (row >= 301 && row <= 350) return 'S7';
  return 'S?';
}

// 搜索归一化（normSearch）见根目录 normalize.js，与服务器共用

const wb = XLSX.readFile(FILE);
const main = XLSX.utils.sheet_to_json(wb.Sheets['S0-S6大麦正赛'], { header: 1 });

const lineups = [];
for (let i = 0; i < main.length; i++) {
  const row = i + 1;
  const rawRow = main[i];
  // 取非空单元格
  const cells = (rawRow || []).filter(c => c !== null && c !== undefined && String(c).trim() !== '');
  if (cells.length < 1) continue;
  const lineupRaw = cells.slice(0, 5).map(String);
  const championRaw = cells[5] !== undefined ? String(cells[5]) : null;
  const shoubaiRaw = cells[6] !== undefined ? String(cells[6]) : null;
  const championClean = championRaw ? clean(championRaw) : null;
  const shoubaiClean = shoubaiRaw ? clean(shoubaiRaw) : null;

  lineupRaw.forEach((raw, idx) => {
    const text = clean(raw);
    lineups.push({
      key: `${row}-${idx + 1}`,
      row,
      col: idx + 1,
      raw,
      text,
      search: normSearch(raw),
      season: seasonOf(row),
      isChampion: championClean === text,
      isShoubai: shoubaiClean === text,
    });
  });
}

const data = {
  meta: { source: '正赛阵容大全（西域版）', totalLineups: lineups.length, totalRows: main.length, generatedAt: new Date().toISOString() },
  lineups,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`写入 ${OUT}`);
console.log(`共 ${main.length} 期（行），${lineups.length} 个阵容`);
const champs = lineups.filter(l => l.isChampion).length;
const sb = lineups.filter(l => l.isShoubai).length;
console.log(`冠军阵容 ${champs} 个，首败阵容 ${sb} 个`);
const bySeason = {};
lineups.forEach(l => { bySeason[l.season] = (bySeason[l.season] || 0) + 1; });
console.log('各赛季阵容数:', JSON.stringify(bySeason));
