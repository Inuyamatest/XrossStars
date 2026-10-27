/** =========================================
 * ダービー貼り付け登録（A列に書かない｜K=性別, L=決済権, N=アポ獲得日, P=詰め直し日, R=商談日, S=商談時間）
 * - 大阪/京都は「登録時に手動選択」で振り分け（ブランドに関係なく地域シートへ）
 *   ・全ブランド → 全体集計(入力)触るな(大阪) or (京都)
 * - 住所による地域エラーチェックは行わない（手動選択を優先）
 * - 住所→都道府県のみを「エリア」に格納
 * - A列は絶対に出力しない（B列=2列目から）
 * - LINE/MEOの「有/無/不明」固定（データ検証対応）
 * - 追記位置は「電話番号」列の最終行+1
 * - 商談メモは 大阪・京都 両シートを自動検索して「見出し名」で該当列を更新
 *   さらに クローザー集計(入力)触るな にも1行追加（同じ店舗・担当・商談日があれば上書き）
 *
 * 【主な修正点（旧版から）】
 * - 商談メモの書き込み先を列番号固定 → 見出し名で探す方式に変更
 *   （旧版は「初回結果」列の追加後に1列ずつずれて書き込んでいた）
 * - 書き込む値を集計で数える言葉にそろえた（有効→有効商談、決済→決済者、再商談→再訪 など）
 * - 「M月D日」だけの日付は、今日に一番近い年として解釈（年末年始のずれ防止）
 * - 電話番号を文字列で保存し、先頭の0が消えないようにした
 * - アポインター名がマスタにない場合に警告を表示
 * ========================================= */

// 地域 → 書き込み先シート
const REGION_SHEET_MAP = {
  '大阪': '全体集計(入力)触るな(大阪)',
  '京都': '全体集計(入力)触るな(京都)'
};
// 商談メモ更新で検索する対象シート（大阪・京都）
const UPDATE_SHEET_NAMES = ['全体集計(入力)触るな(大阪)', '全体集計(入力)触るな(京都)'];
// 商談メモをクローザー集計にも書くか
const CLOSER_SHEET_NAME = 'クローザー集計(入力)触るな';
const WRITE_CLOSER_SHEET = true;
// アポインター名チェックに使うマスタ（見出し「アポインター(大阪)」「アポインター(京都)」）
const MASTER_SHEET_NAME = 'マスタ';

const DATA_START_COL = 2; // B列

// 列定義（1始まり）
const COL_J_GENDER = 11;      // K列
const COL_K_DECISION = 12;    // L列
const COL_M_APO_GET = 14;     // N列
const COL_O_RETRY = 16;       // P列
const COL_Q_DATE = 18;        // R列
const COL_R_TIME = 19;        // S列

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ダービー貼付')
    .addItem('フォームを開く', 'openSidebar')
    .addItem('商談メモ登録', 'openMemoSidebar')
    .addToUi();
}

function openSidebar() {
  var html = HtmlService.createHtmlOutput(buildSidebarHtml_())
    .setTitle('ダービー貼り付け');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** ---- 解析：ダービー部隊フォーマット → オブジェクト ---- */
function parseDerby_(text) {
  var out = {};
  var cleaned = String(text)
    .replace(/\r/g, '')
    .replace(/【ダービー部隊】/g, '')
    .replace(/〈記入してください〉/g, '')
    .trim();

  out._raw = cleaned; // 全文保持（判定用）

  var re = /■\s*([^\n：:]+)\s*[：:]\s*([\s\S]*?)(?=\n■|$)/g;
  var map = {
    'アポインター名': 'apointer',
    'LINEorMEO': 'channel',
    'わくわくorダービー': 'brand',
    'わくわくorダービーorリフィックス': 'brand',
    '電話番号': 'phone',
    '店舗名': 'store',
    '店舗住所': 'address',
    '業種': 'industry',
    '媒体URL': 'url',
    '担当者様': 'contact',
    '担当者の人柄': 'personality',
    '性別': 'gender',
    '決済者の有無': 'decision_raw',
    'LINE@の有無': 'line',
    'MEO対策の有無': 'meo',
    '商談日': 'deal_date',
    '商談時間': 'deal_time',
    '詰め直し日時': 'retry',
    'アポ日時': 'apo_raw',
    'アポ獲得日': 'apo_get_raw',
    '訪問orZOOM': 'meeting_style',
    '補足(クローザーに伝えたいこと)': 'note'
  };

  var m;
  while ((m = re.exec(cleaned))) {
    var k = map[m[1].trim()] || m[1].trim();
    var v = m[2].trim().replace(/\n+/g, ' ');
    out[k] = v;
  }

  // 性別 正規化（後段で男/女に1文字化）
  if (out.gender) {
    if (/女/.test(out.gender)) out.gender = '女性';
    else if (/男/.test(out.gender)) out.gender = '男性';
  }

  // 有/無/不明 固定（line/meoのみ）
  function ynStrict(v) {
    if (v == null) return ''; // 項目自体がない → 空欄
    var s = String(v).toLowerCase().replace(/\s+/g, '');
    if (/(あり|有|ありです|yes|true|○|◯)/.test(s)) return '有';
    if (/(なし|無|no|false|×)/.test(s)) return '無';
    if (/(不明|未定|わから|不詳|\?|？|unknown|n\/a|na)/.test(s)) return '不明';
    return '不明'; // 何か書いてあるが判定不能→不明
  }
  out.line = ynStrict(out.line);
  out.meo = ynStrict(out.meo);

  // 住所→都道府県（エリア表示用。振り分けには使わない）
  out.pref = _toPrefecture(out.address || '');

  return out;
}

function openMemoSidebar() {
  var html = HtmlService.createHtmlOutput(buildMemoSidebarHtml_())
    .setTitle('商談メモ登録');
  SpreadsheetApp.getUi().showSidebar(html);
}

function buildMemoSidebarHtml_() {
  return `
<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f6f7f9;--card:#fff;--line:#e6e8ec;--ink:#111;--muted:#6b7280;--accent:#06C755}
html,body{margin:0;padding:0;background:var(--bg);font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--ink)}
.wrap{padding:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
h1{font-size:16px;margin:0 0 8px}
textarea{width:100%;min-height:240px;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:14px}
.actions{display:flex;gap:8px;margin-top:10px}
button{appearance:none;border:none;border-radius:10px;padding:10px 14px;cursor:pointer;font-size:14px}
.primary{background:var(--accent);color:#fff}.ghost{background:#f2f3f5}
.msg{margin-top:8px;font-size:13px;color:#333;white-space:pre-wrap}
.hint{font-size:12px;color:var(--muted);margin-bottom:8px}
</style></head><body>
<div class="wrap"><div class="card">
  <h1>商談メモ登録</h1>
  <div class="hint">上の「荻野〜」のメモ全文を貼って「登録」。<br>※電話番号 or 店舗名が一致する行の商談欄を更新します（大阪・京都の両シートを自動で探します）。<br>※クローザー集計(入力)触るな にも1行追加します。最終結果・月額・初期費用・ジアポはそちらで入力してください。</div>
  <textarea id="t" placeholder="ここに貼り付け"></textarea>
  <div class="actions">
    <button class="primary" id="sendBtn">登録</button>
    <button class="ghost" id="clearBtn">クリア</button>
  </div>
  <div class="msg" id="msg"></div>
</div></div>
<script>
(function(){
  const t=document.getElementById('t'); const msg=document.getElementById('msg');
  document.getElementById('sendBtn').addEventListener('click', function(){
    const txt=t.value||''; if(!txt.trim()){ msg.textContent='貼り付けが空です。'; return; }
    msg.textContent='更新中…'; const btn=this; btn.disabled=true;
    google.script.run
      .withSuccessHandler(function(res){ msg.textContent=(res&&res.message)?res.message:'更新しました。'; btn.disabled=false; })
      .withFailureHandler(function(e){ msg.textContent='失敗：'+(e&&e.message?e.message:e); btn.disabled=false; })
      .upsertDealMemo(txt);
  });
  document.getElementById('clearBtn').addEventListener('click', function(){ t.value=''; msg.textContent=''; });
})();
</script>
</body></html>`;
}

/** ---- 住所から都道府県だけを抽出（エリア表示用） ---- */
function _toPrefecture(addr) {
  if (!addr) return '';
  addr = String(addr);
  var prefs = [
    '北海道',
    '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
    '岐阜県', '静岡県', '愛知県', '三重県',
    '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
    '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県',
    '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
  ];
  for (var i = 0; i < prefs.length; i++) if (addr.indexOf(prefs[i]) !== -1) return prefs[i];
  if (/^東京/.test(addr)) return '東京都';
  if (/^大阪/.test(addr)) return '大阪府';
  if (/^京都/.test(addr)) return '京都府';
  if (/^北海道/.test(addr)) return '北海道';
  return '';
}

/** ---- 年が書かれていない「M月D日」は、今日に一番近い年として扱う ----
 * 例：12月に「1月5日」と書かれたら翌年、1月に「12月28日」と書かれたら前年
 */
function _inferYear_(month1, day) {
  var now = new Date();
  var y = now.getFullYear();
  var best = y, bestDiff = Infinity;
  [y - 1, y, y + 1].forEach(function (cand) {
    var diff = Math.abs(new Date(cand, month1 - 1, day).getTime() - now.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = cand; }
  });
  return best;
}

/** ---- 「アポ日時」などから 予定日と時刻を抽出 ---- */
function _parseApoDateTime_(s) {
  if (!s) return { dateObj: null, timeStr: '' };

  s = String(s).trim()
    .replace(/〜.*$/, '');

  // 空白を消さず正規化
  s = s.replace(/[　]/g, ' ').replace(/\s+/g, ' ');

  // YYYY年M月D日(HH[:：]mm|H時m分|H時)?
  var ymd = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:(\d{1,2})(?::|：|時)(\d{1,2})?分?)?/);
  if (ymd) {
    var h1 = ymd[4] ? +ymd[4] : 0;
    var m1 = ymd[5] ? +ymd[5] : 0;
    return {
      dateObj: new Date(+ymd[1], (+ymd[2]) - 1, +ymd[3], 0, 0, 0, 0),
      timeStr: (h1 === 0 && m1 === 0) ? '' : _pad2(h1) + ':' + _pad2(m1)
    };
  }

  // M月D日(HH[:：]mm|H時m分|H時)?
  var md = s.match(/(\d{1,2})月(\d{1,2})日(?:(\d{1,2})(?::|：|時)(\d{1,2})?分?)?/);
  if (md) {
    var h2 = md[3] ? +md[3] : 0;
    var m2 = md[4] ? +md[4] : 0;
    return {
      dateObj: new Date(_inferYear_(+md[1], +md[2]), (+md[1]) - 1, +md[2], 0, 0, 0, 0),
      timeStr: (h2 === 0 && m2 === 0) ? '' : _pad2(h2) + ':' + _pad2(m2)
    };
  }

  // M/D HH:mm
  var mdhm = s.match(/(\d{1,2})[\/\-](\d{1,2})\s*(\d{1,2})[：:](\d{1,2})/);
  if (mdhm) {
    return {
      dateObj: new Date(_inferYear_(+mdhm[1], +mdhm[2]), (+mdhm[1]) - 1, +mdhm[2], 0, 0, 0, 0),
      timeStr: _pad2(+mdhm[3]) + ':' + _pad2(+mdhm[4])
    };
  }

  // 時刻だけ
  var hm = s.match(/(\d{1,2})(?::|：|時)(\d{1,2})?分?/);
  if (hm) return { dateObj: null, timeStr: _pad2(+hm[1]) + ':' + _pad2(hm[2] ? +hm[2] : 0) };

  return { dateObj: null, timeStr: '' };
}
function _pad2(n) { return ('0' + n).slice(-2); }

/** ---- 商談日（文字列）→ Date（時分0） ---- */
function _parseYmdDate_(s) {
  if (!s) return null;
  s = String(s).trim();
  var m = s.match(/(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})/);
  if (m) return new Date(+m[1], (+m[2]) - 1, +m[3], 0, 0, 0, 0);
  var m2 = s.match(/(\d{1,2})[\/\-\.月](\d{1,2})/);
  if (m2) return new Date(_inferYear_(+m2[1], +m2[2]), (+m2[1]) - 1, +m2[2], 0, 0, 0, 0);
  return null;
}

/** ---- 性別（男/女）を推定 ---- */
function _genderOneChar_(gender, personality, raw) {
  if (gender) {
    if (/女/.test(gender)) return '女';
    if (/男/.test(gender)) return '男';
  }
  var src = ((personality || '') + ' ' + (raw || '')).toString();
  if (/女性|女/.test(src)) return '女';
  if (/男性|男/.test(src)) return '男';
  return '';
}

/** ---- 書き込み先シート（地域選択で決定。ブランドは不問） ---- */
function _getTargetSheet_(brand, region) {
  var name = REGION_SHEET_MAP[String(region || '').trim()];
  if (!name) throw new Error('大阪 / 京都 のどちらかを選択してください。');

  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('書き込み先シートが見つかりません: ' + name);
  return sh;
}

/** ---- ヘッダー＆行位置（B列起点） ---- */
function _getHeaders(sh, startCol) {
  startCol = startCol || DATA_START_COL;
  var lastCol = sh.getLastColumn();
  if (startCol > lastCol) return [];
  var numCols = (lastCol - startCol + 1);
  return sh.getRange(1, startCol, 1, numCols)
    .getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
}
function _colIndexByHeader(sh, headerName, startCol) {
  startCol = startCol || DATA_START_COL;
  var headers = _getHeaders(sh, startCol);
  var idx = headers.indexOf(headerName);
  return idx >= 0 ? (startCol + idx) : -1;
}
/** ---- 見出し名 → 列番号（見つからなければエラー） ---- */
function _requireCol_(sh, headerName) {
  var col = _colIndexByHeader(sh, headerName, 1);
  if (col < 0) throw new Error(sh.getName() + ' に「' + headerName + '」列が見つかりません。');
  return col;
}
/** ---- 次の行（電話番号列ベース） ---- */
function _nextRowByPhone(sh) {
  var col = _colIndexByHeader(sh, '電話番号', DATA_START_COL);
  if (col < 0) return 2;
  var maxRows = sh.getMaxRows();
  if (maxRows <= 1) return 2;
  var vals = sh.getRange(2, col, maxRows - 1, 1).getValues();
  var last = 0;
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() !== '') last = i + 1;
  return 1 + 1 + last; // ヘッダー1 + データ件数
}
/** ---- 必要な最小列数を確保 ---- */
function _ensureMinColumns_(sh, minCol) {
  var last = sh.getLastColumn();
  if (last < minCol) sh.insertColumnsAfter(last, minCol - last);
}

/** ---- 日付だけに丸める ---- */
function _dateOnly_(d) {
  if (!(d instanceof Date)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** ---- データ検証：LINE/MEOを「有/無/不明」に固定（任意） ---- */
function _ensureYnValidation_(sh) {
  var cols = ['LINE有無', 'MEO有無'];
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['有', '無', '不明'], true) // true = ドロップダウン表示
    .setAllowInvalid(false)
    .build();

  cols.forEach(function (h) {
    var col = _colIndexByHeader(sh, h, DATA_START_COL);
    if (col > 0) {
      var lastRow = Math.max(2, sh.getMaxRows());
      sh.getRange(2, col, lastRow - 1, 1).setDataValidation(rule);
    }
  });
}

/** ---- 列全体を短い日付表示(m/d)に整える（任意） ---- */
function _ensureShortDateFormatColumns_(sh) {
  var lastRow = Math.max(2, sh.getMaxRows());
  [COL_M_APO_GET, COL_O_RETRY, COL_Q_DATE].forEach(function (col) {
    sh.getRange(2, col, lastRow - 1, 1).setNumberFormat('m/d');
  });
}

/** ---- アポインター名がマスタにあるか（なければ警告文を返す） ---- */
function _checkApointer_(region, name) {
  if (!name) return '';
  var ms = SpreadsheetApp.getActive().getSheetByName(MASTER_SHEET_NAME);
  if (!ms) return '';
  var col = _colIndexByHeader(ms, 'アポインター(' + region + ')', 1);
  if (col < 0) return '';
  var names = ms.getRange(2, col, Math.max(1, ms.getLastRow() - 1), 1).getValues()
    .map(function (r) { return String(r[0]).trim(); });
  if (names.indexOf(String(name).trim()) >= 0) return '';
  return '※アポインター「' + name + '」がマスタの「アポインター(' + region + ')」にありません。'
    + '集計に入らないので、名前の表記を直すかマスタに追加してください。';
}

/** ---- 登録（region: '大阪' | '京都'） ---- */
function submitFromText(text, region) {
  if (!text) throw new Error('貼り付けが空です。');

  var p = parseDerby_(text);
  var sh = _getTargetSheet_(p.brand, region);

  // 1) 通常項目（B列以降のヘッダーに合わせて）※性別/決済権/日付類は後で固定列に入れる
  var headers = _getHeaders(sh, DATA_START_COL);
  var headerToKey = {
    '電話番号': 'phone',
    '店舗名': 'store',
    'エリア': 'pref',
    '業種': 'industry',
    'URL': 'url',
    'LINE有無': 'line',
    'MEO有無': 'meo',
    '担当者名': 'contact',
    'アポ獲得者': 'apointer'
  };
  var row = new Array(headers.length).fill('');
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    var key = headerToKey[h];
    if (!key) continue;
    row[i] = (p[key] != null) ? p[key] : '';
  }
  var targetRow = _nextRowByPhone(sh);
  // 電話番号の先頭の0が消えないよう、書き込む前に文字列書式にする
  var phoneCol = _colIndexByHeader(sh, '電話番号', DATA_START_COL);
  if (phoneCol > 0) sh.getRange(targetRow, phoneCol).setNumberFormat('@');
  sh.getRange(targetRow, DATA_START_COL, 1, headers.length).setValues([row]);

  // 2) 固定列（K, L, N, P, R, S）を上書き
  _ensureMinColumns_(sh, Math.max(COL_R_TIME, COL_O_RETRY)); // 必要列確保

  // K: 性別（男/女）
  var gender1 = _genderOneChar_(p.gender, p.personality, p._raw);
  if (gender1) sh.getRange(targetRow, COL_J_GENDER).setValue(gender1);

  // L: 決済権（決済/非決済/外人(決済)/外人(非決済)）
  var rawAll = (p._raw || '') + ' ' + (p.decision_raw || '');
  var kVal = '';

  if (/(外人|外国人|外国籍)/.test(rawAll)) {
    if (/(外人.*(非決|非決済|非決裁)|非決.*外人)/.test(rawAll)) {
      kVal = '外人(非決済)';
    } else if (/(外人.*(決済|決裁)|決.*外人)/.test(rawAll)) {
      kVal = '外人(決済)';
    } else {
      kVal = '外人(非決済)';
    }
  } else if (/非?決済者/.test(String(p.decision_raw || ''))) {
    if (/非決済者/.test(p.decision_raw)) kVal = '非決済';
    else if (/決済者/.test(p.decision_raw)) kVal = '決済';
  } else {
    var dec = String(p.decision_raw || '').toLowerCase();
    if (/(あり|有|yes|true|○|◯)/.test(dec)) kVal = '決済';
    else if (/(なし|無|no|false|×)/.test(dec)) kVal = '非決済';
  }

  if (kVal) sh.getRange(targetRow, COL_K_DECISION).setValue(kVal);

  // R/S: アポ日時 → 商談日・商談時間（無ければ商談日/商談時間）
  var apo = _parseApoDateTime_(p.apo_raw || '');
  var dateObj = apo.dateObj || _parseYmdDate_(p.deal_date);
  var timeStr = apo.timeStr || _extractHmString_(p.deal_time);
  if (dateObj) {
    sh.getRange(targetRow, COL_Q_DATE)
      .setValue(dateObj)
      .setNumberFormat('m/d');
  }
  if (timeStr) sh.getRange(targetRow, COL_R_TIME).setValue(timeStr);

  // N: アポ獲得日（日付のみ）
  var apoGetParsed = _parseJpDateTime_(p.apo_get_raw || '');
  var apoGetDate = apoGetParsed.date ? _dateOnly_(apoGetParsed.date) : null;
  if (apoGetDate) {
    sh.getRange(targetRow, COL_M_APO_GET)
      .setValue(apoGetDate)
      .setNumberFormat('m/d');
  }

  // P: 詰め直し日（日付のみ）
  var retryParsed = _parseJpDateTime_(p.retry || '');
  var retryDateOnly = retryParsed.date ? _dateOnly_(retryParsed.date) : null;
  if (retryDateOnly) {
    sh.getRange(targetRow, COL_O_RETRY)
      .setValue(retryDateOnly)
      .setNumberFormat('m/d');
  }

  // （任意）LINE/MEOの検証ルールを毎回適用
  _ensureYnValidation_(sh);

  // （任意）列全体も短い日付表示に整える
  _ensureShortDateFormatColumns_(sh);

  var warn = _checkApointer_(region, p.apointer);
  return warn ? '登録しました。（' + region + '）\n' + warn : 'OK';
}

/** ---- "14:00" や "14時30分" → "HH:mm" ---- */
function _extractHmString_(s) {
  if (!s) return '';
  s = String(s).trim();
  var m = s.match(/(\d{1,2})\s*(?::|：|時)\s*(\d{1,2})?/);
  if (!m) return '';
  var h = _pad2(parseInt(m[1], 10));
  var mm = _pad2(m[2] != null ? parseInt(m[2], 10) : 0);
  return h + ':' + mm;
}

/** ---- サイドバーHTML（大阪/京都の手動選択つき） ---- */
function buildSidebarHtml_() {
  return `
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ダービー貼り付け</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--line:#e6e8ec;--ink:#111;--muted:#6b7280;--accent:#06C755}
  html,body{margin:0;padding:0;background:var(--bg);font-family:"Noto Sans JP",system-ui,sans-serif;color:var(--ink)}
  .wrap{padding:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:0 1px 0 rgba(0,0,0,.04)}
  h1{font-size:16px;margin:0 0 8px}
  textarea{width:100%;min-height:200px;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:14px}
  .actions{display:flex;gap:8px;margin-top:10px}
  button{appearance:none;border:none;border-radius:10px;padding:10px 14px;font-size:14px;cursor:pointer}
  .primary{background:var(--accent);color:#fff}
  .ghost{background:#f2f3f5}
  .msg{margin-top:8px;font-size:13px;color:#333;white-space:pre-wrap}
  .hint{font-size:12px;color:#6b7280;margin-bottom:8px}
  .region{display:flex;gap:14px;align-items:center;margin:6px 0 10px;font-size:14px}
  .region label{display:flex;gap:5px;align-items:center;cursor:pointer}
  .region .ttl{font-size:13px;color:#374151;margin-right:4px}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>ダービー貼り付け登録</h1>
    <div class="hint">【ダービー部隊】ブロックをそのまま貼り付け → 地域を選んで登録</div>
    <div class="region">
      <span class="ttl">登録先：</span>
      <label><input type="radio" name="region" value="大阪"> 大阪</label>
      <label><input type="radio" name="region" value="京都"> 京都</label>
    </div>
    <textarea id="t" placeholder="例：
【ダービー部隊】
〈記入してください〉
■わくわくorダービー：わくわく
■アポインター名：山口
■電話番号：0457803166
■店舗名：ネイルサロン ラメール(LaMer)
■店舗住所：神奈川県横浜市金沢区…
■業種：ネイル
■媒体URL：https://...
■担当者様：サカイ様
■担当者の人柄：優しい女性オーナー様
■決済者の有無：有
■LINE@の有無：有
■MEO対策の有無：不明
■アポ日時：10月31日9時30分
■アポ獲得日：10月20日
■詰め直し日時：10月23日14時"></textarea>
    <div class="actions">
      <button class="primary" id="sendBtn">登録</button>
      <button class="ghost" id="clearBtn">クリア</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
</div>
<script>
  (function(){
    var t = document.getElementById('t');
    var msg = document.getElementById('msg');
    function getRegion(){
      var r = document.querySelector('input[name="region"]:checked');
      return r ? r.value : '';
    }
    document.getElementById('sendBtn').addEventListener('click', function(){
      var txt = t.value || '';
      if (!txt.trim()) { msg.textContent = '貼り付けが空です。'; return; }
      var region = getRegion();
      if (!region) { msg.textContent = '大阪 / 京都 を選択してください。'; return; }
      msg.textContent = '登録中…';
      var btn = this; btn.disabled = true;
      google.script.run
        .withSuccessHandler(function(res){
          msg.textContent = (res && res !== 'OK') ? res : '登録しました。（' + region + '）';
          btn.disabled = false;
        })
        .withFailureHandler(function(e){
          msg.textContent = '登録に失敗：' + (e && e.message ? e.message : e);
          btn.disabled = false;
        })
        .submitFromText(txt, region);
    });
    document.getElementById('clearBtn').addEventListener('click', function(){
      t.value = ''; msg.textContent = '';
    });
  })();
</script>
</body>
</html>
  `;
}

/** =========================
 * 商談メモ貼付 → 既存行の商談欄を更新 ＋ クローザー集計に追加
 * - 対象：大阪・京都 両シートを自動検索
 * - キー：電話番号 or 店舗名 の一致
 * - 書き込み先は見出し名で探す（列の追加・並べ替えがあってもずれない）
 *   商談担当 / 初回結果（空欄なら「商談実施」） / 有効商談有無 / 商談結果 / 商談所感 / 決裁権 / 提案商材 / 再訪日 / 人種（外人のみ）
 * ========================= */
function upsertDealMemo(pasteText, options) {
  options = options || {};
  if (!pasteText || !String(pasteText).trim()) {
    throw new Error('貼り付けテキストが空です。');
  }

  var sheetNames = options.sheetNames || UPDATE_SHEET_NAMES;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('ほかの人が更新中です。数秒待ってからもう一度押してください。');
  try {
    var m = parseSimpleDealBlock_(pasteText); // ラベル抽出 & 正規化
    var ss = SpreadsheetApp.getActive();

    var hit = null; // { sh, row, name }
    for (var s = 0; s < sheetNames.length && !hit; s++) {
      var sh0 = ss.getSheetByName(sheetNames[s]);
      if (!sh0) continue;
      var found = _findRowInSheet_(sh0, m);
      if (found > 0) hit = { sh: sh0, row: found, name: sheetNames[s] };
    }

    if (!hit) {
      throw new Error('一致する行が見つかりませんでした（大阪・京都シートの 電話番号/店舗名）。');
    }

    var sh = hit.sh;
    var r = hit.row;
    var set = function (header, value, numberFormat) {
      if (value === '' || value == null) return;
      var rg = sh.getRange(r, _requireCol_(sh, header)).setValue(value);
      if (numberFormat) rg.setNumberFormat(numberFormat);
    };

    set('商談担当', m.closer || m.apointer || '');
    // 有効/無効が書かれていれば商談は実施済み → 初回結果が空欄なら「商談実施」
    if (m.validFlag === '有効商談' || m.validFlag === '無効商談') {
      var firstCol = _requireCol_(sh, '初回結果');
      if (String(sh.getRange(r, firstCol).getValue()).trim() === '') sh.getRange(r, firstCol).setValue('商談実施');
    }
    set('有効商談有無', m.validFlag);
    set('商談結果', m.result);
    sh.getRange(r, _requireCol_(sh, '商談所感')).setValue(m.raw || '');
    set('決裁権', m.decision);
    set('提案商材', m.proposal);
    if (m.isForeign) set('人種', '外人');
    if (m.nextDateObj) set('再訪日', _dateOnly_(m.nextDateObj), 'm/d');
    else set('再訪日', m.nextDateStr || '');

    var message = '更新しました。（' + hit.name + ' ' + r + '行目）';
    if (WRITE_CLOSER_SHEET) message += '\n' + _upsertCloserRow_(m);
    return { result: 'OK', message: message };
  } finally {
    try { lock.releaseLock(); } catch (e) { }
  }
}

/** ---- クローザー集計に1行追加（同じ 店舗名＋商談担当＋商談日 があれば上書き） ---- */
function _upsertCloserRow_(m) {
  var sh = SpreadsheetApp.getActive().getSheetByName(CLOSER_SHEET_NAME);
  if (!sh) return '※' + CLOSER_SHEET_NAME + ' が見つからないため、クローザー集計には書いていません。';

  var cStore = _requireCol_(sh, '店舗名'), cDate = _requireCol_(sh, '商談日'), cCloser = _requireCol_(sh, '商談担当');
  var closer = m.closer || m.apointer || '';
  var dealDate = m.dealDateObj ? _dateOnly_(m.dealDateObj) : null;

  // 既存行を探す（店舗名・商談担当・商談日が同じ）／なければ店舗名列の最終行+1
  var last = sh.getLastRow(), target = -1, lastFilled = 1;
  if (last >= 2) {
    var n = last - 1;
    var stores = sh.getRange(2, cStore, n, 1).getValues();
    var dates = sh.getRange(2, cDate, n, 1).getValues();
    var closers = sh.getRange(2, cCloser, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      if (String(stores[i][0]).trim() === '') continue;
      lastFilled = i + 2;
      var sameDate = dealDate && dates[i][0] instanceof Date && _dateOnly_(dates[i][0]).getTime() === dealDate.getTime();
      if (_normalizeStr_(stores[i][0]) === _normalizeStr_(m.store) &&
          String(closers[i][0]).trim() === closer && (sameDate || (!dealDate && dates[i][0] === ''))) {
        target = i + 2;
      }
    }
  }
  var isNew = target < 0;
  if (isNew) target = lastFilled + 1;

  var put = function (header, value, numberFormat) {
    if (value === '' || value == null) return;
    var col = _colIndexByHeader(sh, header, 1);
    if (col < 0) return;
    var rg = sh.getRange(target, col).setValue(value);
    if (numberFormat) rg.setNumberFormat(numberFormat);
  };
  put('店舗名', m.store || '');
  put('商談日', dealDate, 'm/d');
  put('商談担当', closer);
  put('有効商談有無', m.validFlag);
  put('商談結果', m.result);
  put('商談所感', m.raw || '');
  put('決裁権', m.decision);
  put('提案商材', m.proposal);
  if (m.nextDateObj) put('再訪日', _dateOnly_(m.nextDateObj), 'm/d');

  return (isNew ? 'クローザー集計に追加しました（' : 'クローザー集計を上書きしました（') + target + '行目）。'
    + '最終結果・月額提案・初期費用提案・ジアポは手入力してください。';
}

/** ---- 1シート内で 電話番号→店舗名 の順に一致行を探す（見つからなければ -1） ---- */
function _findRowInSheet_(sh, m) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  var colPhone = headers.indexOf('電話番号') + 1;
  var colStore = headers.indexOf('店舗名') + 1;
  if (colPhone < 1 && colStore < 1) return -1;

  if (m.phone && colPhone > 0) {
    var target = _normalizePhone_(m.phone);
    var phones = sh.getRange(2, colPhone, lastRow - 1, 1).getValues();
    for (var i = 0; i < phones.length; i++) {
      var pv = _normalizePhone_(phones[i][0]);
      if (pv && pv === target) return 2 + i;
    }
  }
  if (m.store && colStore > 0) {
    var stores = sh.getRange(2, colStore, lastRow - 1, 1).getValues();
    for (var j = 0; j < stores.length; j++) {
      var sv = _normalizeStr_(stores[j][0]);
      if (sv && sv === _normalizeStr_(m.store)) return 2 + j;
    }
  }
  return -1;
}

/** ====== この“商談メモ”のパース ====== */
function parseSimpleDealBlock_(text) {
  var s = String(text).replace(/\r/g, '').trim();
  var out = { raw: s };

  // 先頭の氏名行（例「荻野」）→ 商談担当候補
  var firstLine = s.split('\n').find(function (line) { return line.trim() !== ''; }) || '';
  if (!/^【/.test(firstLine)) {
    out.closer = firstLine.trim();
  }

  // ラベル抽出
  var re = /【\s*([^】]+?)\s*】\s*([\s\S]*?)(?=\n【|$)/g;
  var mapNames = {
    'アポ獲得者': 'apointer',
    '商談担当者': 'closer',
    '商談担当': 'closer',
    '店舗名': 'store',
    '日時': 'date_raw',
    '決済': 'decision_raw',
    '年商': 'sales',
    '提案内容': 'proposal_raw',
    '商談所感': 'memo',
    'LINE or MEO': 'channel',
    '商談回数': 'count',
    '有効/無効': 'valid_raw',
    '受注/失注/検討/再商談': 'result_raw',
    '改善点': 'improve',
    '次回架電日': 'next_raw',
    '電話番号': 'phone'
  };
  var m;
  while ((m = re.exec(s))) {
    var key = (mapNames[m[1].trim()] || m[1].trim());
    var val = m[2].trim().replace(/\n+/g, ' ');
    out[key] = val;
  }

  if (!out.closer) {
    var mCloser = s.match(/【\s*商談担当(?:者)?\s*】\s*([\s\S]*?)(?=\n【|$)/);
    if (mCloser) out.closer = mCloser[1].trim().replace(/\n+/g, ' ');
  }

  // ---- 値を集計で数える言葉にそろえる ----
  // 決裁権（商談時）：決済者 / 非決済。外人は「人種＝外人」で別に記録
  var dec = String(out.decision_raw || '').trim();
  out.isForeign = /(外人|外国人|外国籍)/.test(dec);
  if (/(非決|不可|無)/.test(dec)) out.decision = '非決済';
  else if (/(決済|決裁|可|有)/.test(dec)) out.decision = '決済者';
  else out.decision = '';

  // 有効商談有無：有効商談 / 無効商談
  var v = String(out.valid_raw || '').trim();
  if (/無効/.test(v)) out.validFlag = '無効商談';
  else if (/有効/.test(v)) out.validFlag = '有効商談';
  else out.validFlag = v;

  // 商談結果：受注 / 失注 / 検討 / 再訪（再商談）/ リスケ / 商談キャンセル / 無効商談 / 再調整
  var res = String(out.result_raw || '').trim();
  var resultWords = [['受注', '受注'], ['失注', '失注'], ['検討', '検討'], ['再商談', '再訪'], ['再訪', '再訪'],
                     ['リスケ', 'リスケ'], ['キャンセル', '商談キャンセル'], ['無効', '無効商談'], ['再調整', '再調整']];
  out.result = res;
  for (var i = 0; i < resultWords.length; i++) {
    if (res.indexOf(resultWords[i][0]) >= 0) { out.result = resultWords[i][1]; break; }
  }

  // 提案商材：両方 / 自社LINE / 自社MEO / LP / ロケット（提案内容 > LINE or MEO）
  var prop = String(out.proposal_raw || '').trim() || String(out.channel || '').trim();
  var hasLine = /LINE/i.test(prop), hasMeo = /MEO/i.test(prop);
  if ((hasLine && hasMeo) || /両方/.test(prop)) out.proposal = '両方';
  else if (hasLine) out.proposal = '自社LINE';
  else if (hasMeo) out.proposal = '自社MEO';
  else if (/LP/i.test(prop)) out.proposal = 'LP';
  else if (/ロケット/.test(prop)) out.proposal = 'ロケット';
  else out.proposal = prop;

  // 商談日（【日時】）と再訪日（次回架電日）
  out.dealDateObj = _parseJpDateTime_(out.date_raw).date || null;
  var nextParsed = _parseJpDateTime_(out.next_raw);
  out.nextDateObj = nextParsed.date || null;
  out.nextDateStr = nextParsed.str || '';

  return out;
}

/** 文字のゆらぎをならす（全角半角/空白/記号の簡易除去） */
function _normalizeStr_(v) {
  if (v == null) return '';
  v = String(v).trim();
  // 全角→半角（数字・英字・記号の基本）
  v = v.replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  // ハイフン・空白のゆらぎ除去
  v = v.replace(/[\-\–—ー−‐\s]/g, '');
  return v;
}

/** 電話番号を比較用にそろえる（数字だけ・先頭の0を除く。数値で保存されて0が消えた番号とも一致させる） */
function _normalizePhone_(v) {
  return _normalizeStr_(v).replace(/\D/g, '').replace(/^0+/, '');
}

/** 和文日付文字列 → {date: Date|null, str: string|null} */
function _parseJpDateTime_(raw) {
  if (!raw) return { date: null, str: null };

  // 〜以降除去
  var s = String(raw).trim().replace(/〜.*$/, '');

  // 全角スペース→半角、連続空白は1つに
  s = s.replace(/[　]/g, ' ').replace(/\s+/g, ' ');

  var now = new Date();

  // YYYY年M月D日(HH[:：]mm)?
  var a = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:(\d{1,2})(?:[:：時](\d{1,2})?)?分?)?/);
  if (a) {
    var y = +a[1], mo = +a[2] - 1, d = +a[3];
    var hh = a[4] ? +a[4] : 0, mm = a[5] ? +a[5] : 0;
    return { date: new Date(y, mo, d, hh, mm, 0, 0), str: null };
  }

  // M月D日(HH[:：]mm)?
  var b = s.match(/(\d{1,2})月(\d{1,2})日(?:(\d{1,2})(?:[:：時](\d{1,2})?)?分?)?/);
  if (b) {
    var hh2 = b[3] ? +b[3] : 0, mm2 = b[4] ? +b[4] : 0;
    return { date: new Date(_inferYear_(+b[1], +b[2]), +b[1] - 1, +b[2], hh2, mm2, 0, 0), str: null };
  }

  // M/D( HH:mm or H時m分 )
  var c = s.match(/(\d{1,2})[\/\-](\d{1,2})(?:\s*(\d{1,2})(?:[:：時](\d{1,2})?)?分?)?/);
  if (c) {
    var hh3 = c[3] ? +c[3] : 0, mm3 = c[4] ? +c[4] : 0;
    return { date: new Date(_inferYear_(+c[1], +c[2]), +c[1] - 1, +c[2], hh3, mm3, 0, 0), str: null };
  }

  // HH[:：]mm のみ
  var d4 = s.match(/(\d{1,2})[:：時](\d{1,2})?/);
  if (d4) {
    var hh4 = +d4[1], mm4 = d4[2] ? +d4[2] : 0;
    return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh4, mm4, 0, 0), str: null };
  }

  return { date: null, str: raw };
}
