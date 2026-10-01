// 阵容文本清洗与搜索归一化（构建脚本与服务器共用，改这里两边都会同步）
const CLEAN = { '缠': '草', '盏': '金', '花': '金', '晶': '若', '钻': '若', '胖': '坚', '竹': '奶' };
const EXTRA = { '水': '草', '豌': '狙', '刀': '寒', '舟': '灯', '锔': '曾', '信': '双', 'R': '雷', '丨': '麦', '羽': '藤', '棍': '麦' };

function clean(s) {
  return [...String(s)].map(c => CLEAN[c] || c).join('');
}

// 无视标点；缠/水/草 同字；金/盏/花 同字；坚/胖 同字；若/晶/钻 同字；奶/竹 同字；豌/狙 同字
function normSearch(s) {
  return [...clean(s)].map(c => EXTRA[c] || c).join('').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
}

module.exports = { clean, normSearch };