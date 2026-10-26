/**
 * ヒアリングフォーム連携（Google Apps Script）
 *
 * 使い方：
 *   1. 開通管理表.xlsx を Googleスプレッドシートとして保存
 *   2. 拡張機能 → Apps Script を開き、このファイルの中身を全部貼り付けて保存
 *   3. スプレッドシートを再読み込み → メニュー「ヒアリング」→「① フォームを作成（初回のみ）」
 *
 * できること：
 *   - ホームページ制作のヒアリング用 Googleフォームを自動作成し、回答をこのスプレッドシートに保存
 *   - 顧客IDが自動で入った「顧客ごとのフォームURL」を顧客一覧に表示（設定シートのひな形から計算）
 *   - 回答が届いたら、顧客一覧の「フォーム回答日」「制作ステータス」を自動更新
 *   - 「制作指示」シートに、店舗情報テンプレート形式のテキストを自動作成
 */

const CFG = {
  CUSTOMER_SHEET: '顧客一覧',
  CUSTOMER_HEADER_ROW: 4,
  RESPONSE_SHEET: 'フォーム回答',
  ORDER_SHEET: '制作指示',
  ORDER_HEADER_ROW: 4,
  SETTINGS_SHEET: '設定',
  SETTINGS_EDIT_URL: 'B12',
  SETTINGS_FORM_URL: 'B13',
  SETTINGS_PREFILL_URL: 'B14',
  FORM_TITLE: 'ホームページ制作 ヒアリングフォーム',
  ID_PLACEHOLDER: '__ID__',
};

// フォームの質問（key はテンプレートの {{KEY}} に対応）
const QUESTIONS = [
  { key: 'CUSTOMER_ID', title: 'お客様ID', type: 'text', required: true, help: 'LINEでお送りしたURLから開くと自動で入っています。変更しないでください。' },
  { key: 'STORE_NAME', title: '店舗名', type: 'text', required: true },
  { key: 'BUSINESS_TYPE', title: '業種', type: 'text', required: true, help: '例：整骨院、美容室、居酒屋' },
  { key: 'TARGET', title: '来てほしいお客様（ターゲット）', type: 'paragraph', required: true, help: '例：30〜50代の肩こり・腰痛に悩む会社員' },
  { key: 'BRAND_IMAGE', title: 'お店の雰囲気・イメージ', type: 'paragraph', required: false, help: '例：清潔感・ナチュラル・高級感、好きな色など' },
  { key: 'STRENGTHS', title: 'お店の強み・こだわり', type: 'paragraph', required: true, help: '他店と違うところを3つほど' },
  { key: 'MENU', title: 'メニュー・料金', type: 'paragraph', required: true, help: '1行に1つ「メニュー名：料金」' },
  { key: 'ADDRESS', title: '住所', type: 'text', required: true },
  { key: 'HOURS', title: '営業時間', type: 'text', required: true, help: '例：10:00〜20:00（土日は18:00まで）' },
  { key: 'HOLIDAY', title: '定休日', type: 'text', required: true },
  { key: 'PHONE', title: '電話番号', type: 'text', required: true },
  { key: 'RESERVATION_URL', title: '予約ページのURL', type: 'text', required: false, help: 'ホットペッパーなど。なければ空欄' },
  { key: 'LINE_URL', title: 'お店のLINEのURL', type: 'text', required: false, help: 'なければ空欄' },
  { key: 'INSTAGRAM_URL', title: 'InstagramのURL', type: 'text', required: false, help: 'なければ空欄' },
  { key: 'OTHER_INFO', title: 'その他・載せたいこと', type: 'paragraph', required: false, help: 'お客様の声、資格、駐車場の有無など' },
  { key: 'IMAGES', title: '画像（ロゴ・写真）の送り方', type: 'choice', required: true, choices: ['公式LINEで送る', '画像はない（おまかせ）'] },
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ヒアリング')
    .addItem('① フォームを作成（初回のみ）', 'setupForm')
    .addItem('制作指示を作り直す（全件）', 'rebuildAllOrders')
    .addToUi();
}

/** フォームを作成し、回答先・事前入力URL・送信時の自動処理を設定する */
function setupForm() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const settings = ss.getSheetByName(CFG.SETTINGS_SHEET);
  if (settings.getRange(CFG.SETTINGS_EDIT_URL).getValue()) {
    const ans = ui.alert('フォームは作成済みです', 'もう一度新しいフォームを作りますか？（古いフォームのURLは使えなくなります）', ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }

  const form = FormApp.create(CFG.FORM_TITLE);
  form.setDescription('ホームページ制作のために、お店の情報を教えてください（5分ほどで終わります）。\n写真は公式LINEにお送りください。');
  form.setConfirmationMessage('ご回答ありがとうございました！写真がまだの方は公式LINEにお送りください。');

  let idItem = null;
  QUESTIONS.forEach(q => {
    let item;
    if (q.type === 'paragraph') item = form.addParagraphTextItem();
    else if (q.type === 'choice') item = form.addMultipleChoiceItem().setChoiceValues(q.choices);
    else item = form.addTextItem();
    item.setTitle(q.title).setRequired(q.required);
    if (q.help) item.setHelpText(q.help);
    if (q.key === 'CUSTOMER_ID') idItem = item;
  });

  // addTextItem() が返すのは TextItem なので、そのまま createResponse できる
  const prefill = form.createResponse()
    .withItemResponse(idItem.createResponse(CFG.ID_PLACEHOLDER))
    .toPrefilledUrl();

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  renameResponseSheet_(ss, form.getId());
  settings.getRange(CFG.SETTINGS_EDIT_URL).setValue(form.getEditUrl());
  settings.getRange(CFG.SETTINGS_FORM_URL).setValue(form.getPublishedUrl());
  settings.getRange(CFG.SETTINGS_PREFILL_URL).setValue(prefill);

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onFormSubmit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();

  ui.alert('完了', 'フォームを作成しました。\n顧客一覧の「ヒアリングフォームURL」列に、顧客ごとのURLが表示されます。', ui.ButtonSet.OK);
}

/** フォーム回答時：顧客一覧を更新し、制作指示を作る */
function onFormSubmit(e) {
  const answers = {};
  QUESTIONS.forEach(q => {
    const v = e.namedValues[q.title];
    answers[q.key] = v ? String(v[0]).trim() : '';
  });
  const id = answers.CUSTOMER_ID;
  const submittedAt = new Date();

  const row = findCustomerRow_(id);
  if (row) {
    const today = new Date(submittedAt.getFullYear(), submittedAt.getMonth(), submittedAt.getDate());
    row.set('フォーム回答日', today);
    const status = row.get('制作ステータス');
    if (status === '' || status === '未着手' || status === 'ヒアリング依頼済') row.set('制作ステータス', 'フォーム回答済');
  }
  upsertOrder_(id, answers, submittedAt, row);
}

/** スラッグ・本番/デモを変えたあとなどに、フォーム回答から制作指示を全件作り直す */
function rebuildAllOrders() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CFG.RESPONSE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('まだフォームの回答がありません。');
    return;
  }
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(String);
  values.slice(1).forEach(r => {
    const answers = {};
    QUESTIONS.forEach(q => {
      const i = header.indexOf(q.title);
      answers[q.key] = i >= 0 ? String(r[i]).trim() : '';
    });
    if (!answers.CUSTOMER_ID) return;
    upsertOrder_(answers.CUSTOMER_ID, answers, r[0], findCustomerRow_(answers.CUSTOMER_ID));
  });
  SpreadsheetApp.getUi().alert('制作指示を作り直しました。');
}

// ---------- 内部処理 ----------

function renameResponseSheet_(ss, formId) {
  const old = ss.getSheetByName(CFG.RESPONSE_SHEET);
  ss.getSheets().forEach(s => {
    const url = s.getFormUrl();
    if (!url) return;
    if (FormApp.openByUrl(url).getId() === formId) {
      if (old && old.getSheetId() !== s.getSheetId()) old.setName(CFG.RESPONSE_SHEET + '（旧）' + Date.now());
      s.setName(CFG.RESPONSE_SHEET);
    }
  });
}

/** 顧客一覧から顧客IDの行を探し、見出し名で読み書きできるオブジェクトを返す */
function findCustomerRow_(id) {
  if (!id) return null;
  const sheet = SpreadsheetApp.getActive().getSheetByName(CFG.CUSTOMER_SHEET);
  const hr = CFG.CUSTOMER_HEADER_ROW;
  const header = sheet.getRange(hr, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idCol = header.indexOf('顧客ID') + 1;
  const last = sheet.getLastRow();
  if (idCol === 0 || last <= hr) return null;
  const ids = sheet.getRange(hr + 1, idCol, last - hr, 1).getValues();
  const idx = ids.findIndex(r => String(r[0]).trim() === id);
  if (idx < 0) return null;
  const rowNum = hr + 1 + idx;
  const col = name => {
    const c = header.indexOf(name) + 1;
    if (c === 0) throw new Error('顧客一覧に「' + name + '」列が見つかりません');
    return c;
  };
  return {
    get: name => String(sheet.getRange(rowNum, col(name)).getDisplayValue()).trim(),
    set: (name, value) => sheet.getRange(rowNum, col(name)).setValue(value),
  };
}

/** 制作指示シートに 1顧客1行で書き込む（同じIDがあれば上書き） */
function upsertOrder_(id, a, submittedAt, customerRow) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(CFG.ORDER_SHEET) || ss.insertSheet(CFG.ORDER_SHEET);
  const hr = CFG.ORDER_HEADER_ROW;
  const slug = customerRow ? customerRow.get('スラッグ') : '';
  const mode = customerRow ? customerRow.get('本番/デモ') : '';
  const images = a.IMAGES === '公式LINEで送る' ? 'チャットに添付（公式LINEで受領）' : 'なし（おまかせ）';

  const text = [
    '========================================',
    '■ 店舗情報',
    '========================================',
    '',
    '店舗名：' + a.STORE_NAME,
    '業種：' + a.BUSINESS_TYPE,
    'スラッグ：' + (slug || '（顧客一覧のスラッグ未入力）'),
    'ターゲット：' + a.TARGET,
    'ブランドイメージ：' + a.BRAND_IMAGE,
    '強み：' + a.STRENGTHS,
    'メニュー：' + a.MENU,
    '住所：' + a.ADDRESS,
    '営業時間：' + a.HOURS,
    '定休日：' + a.HOLIDAY,
    '電話：' + a.PHONE,
    '予約URL：' + a.RESERVATION_URL,
    'LINE：' + a.LINE_URL,
    'Instagram：' + a.INSTAGRAM_URL,
    'その他：' + a.OTHER_INFO,
    'デモかどうか：' + (mode || '（顧客一覧の本番/デモ未入力）'),
    '',
    '========================================',
    '■ 画像素材',
    '========================================',
    '',
    '画像：' + images,
  ].join('\n');

  const note = customerRow ? '' : '　※顧客一覧にこのIDがありません';
  const rowValues = [id + note, a.STORE_NAME, submittedAt, mode, text];

  const last = sheet.getLastRow();
  let target = -1;
  if (last > hr) {
    const ids = sheet.getRange(hr + 1, 1, last - hr, 1).getValues();
    const i = ids.findIndex(r => String(r[0]).split('　')[0].trim() === id);
    if (i >= 0) target = hr + 1 + i;
  }
  if (target < 0) target = Math.max(last, hr) + 1;
  sheet.getRange(target, 1, 1, rowValues.length).setValues([rowValues]);
  sheet.getRange(target, 3).setNumberFormat('yyyy/mm/dd hh:mm');
  sheet.getRange(target, 5).setWrap(true).setVerticalAlignment('top');
  sheet.getRange(target, 1, 1, 4).setVerticalAlignment('top');
}
