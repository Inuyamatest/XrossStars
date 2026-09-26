#!/usr/bin/env node
/* Xross Stars — カードマスタ（data/cards.json）生成スクリプト
 *
 * 入力:
 *   js/data/leaders.js         … リーダー72名（アプリの正データ。既に公式確認済み）
 *   data/source/all-cards.json … 公式サイト個別ページを人手確認したExcel台帳の「全カード」シート全行
 *   data/source/parallels.json … Excelの「パラレル一覧」シート
 *   cards/                     … 実際に存在するカード画像ファイル
 *
 * 出力:
 *   data/cards.json … デッキビルダーが読み込む統合カードマスタ
 *
 * 再実行方法: node scripts/build-cards-json.js
 * カードデータを追加・修正するときは、まず入力側（leaders.js / data/source/all-cards.json）を直し、
 * このスクリプトを再実行して data/cards.json を作り直す。data/cards.json を直接手編集しないこと。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadLeaders() {
  const leadersCode = fs.readFileSync(path.join(ROOT, 'js/data/leaders.js'), 'utf8');
  const imagesCode = fs.readFileSync(path.join(ROOT, 'js/data/images.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'CustomEvent', 'console',
    'var window = this;\n' + leadersCode + '\n' + imagesCode + '\nreturn window;');
  const win = fn.call({}, { dispatchEvent: () => {} }, function () {}, console);
  return { leaders: win.XS_LEADERS, images: win.XS_LEADER_IMAGES || {}, imagesAwakened: win.XS_LEADER_IMAGES_AWAKENED || {} };
}

const COLOR_MAP = { '赤': 'red', '青': 'blue', '黄': 'yellow', '緑': 'green', '無色': 'colorless', '無': 'colorless' };
const TYPE_MAP = {
  'リーダーカード': 'LEADER',
  'アタックカード': 'ATTACK',
  'メモリアカード': 'MEMORIA',
  'タクティクスカード': 'TACTICS',
  'PPカード': 'PP',
  'PPチケットカード': 'PP_TICKET',
};

function clean(v) {
  return v === '要確認' ? null : v;
}

// ビルドルール文字列 → 判定可能な構造化ルール
// 現行データで確認できているのは「リーダー：<名前>」と「<色>のリーダー<N>体以上」の2パターンのみ。
// それ以外はUNKNOWNとして返す（＝勝手に採用可否を決めない）。
const RE_LEADER_NAME = /^リーダー：(.+)$/;
const RE_COLOR_COUNT = /^(赤|青|黄|緑|無色)のリーダー(\d+)体以上$/;
function parseBuildRule(raw) {
  if (!raw) return null;
  const mName = raw.match(RE_LEADER_NAME);
  if (mName) return { kind: 'LEADER_NAME', leaderName: mName[1], raw };
  const mColor = raw.match(RE_COLOR_COUNT);
  if (mColor) return { kind: 'COLOR_COUNT', color: COLOR_MAP[mColor[1]] || mColor[1], min: Number(mColor[2]), raw };
  return { kind: 'UNKNOWN', raw };
}

function parseTriState(v) {
  // ACE/BAN列は True/False/None/'要確認' が混在する。確定できるのはTrue/Falseのみ。
  if (v === true) return true;
  if (v === false) return false;
  return null; // 未確認・不明
}

function findExistingImage(cardNumber) {
  const exts = ['.webp', '.png', '.jpg', '.jpeg'];
  for (const ext of exts) {
    const p = path.join(ROOT, 'cards', cardNumber + ext);
    if (fs.existsSync(p)) return 'cards/' + cardNumber + ext;
  }
  return null;
}

function main() {
  const { leaders, images, imagesAwakened } = loadLeaders();
  const rawCards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/all-cards.json'), 'utf8'));
  const parallels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/parallels.json'), 'utf8'));

  const out = [];

  // --- リーダー（正データは leaders.js。Excel側とはcardNumber単位で既に突き合わせ済み）---
  leaders.forEach((l) => {
    out.push({
      cardNumber: l.cardNumber.split('/')[0],
      name: l.name,
      cardType: 'LEADER',
      cardTypeJa: 'リーダーカード',
      set: l.boosterCode || (l.cardNumber.split('-')[0]),
      color: l.color || null,
      rarity: 'LR',
      cost: null,
      hp: l.hp ?? null,
      atk: l.attack ?? null,
      awakenHp: l.awakenedHp ?? null,
      awakenAtk: l.awakenedAttack ?? null,
      buildRule: null,
      buildRuleParsed: null,
      ace: false,
      ban: false,
      text: l.awakeningEffect ?? null,
      effectSummary: l.awakeningEffect ?? null,
      officialUrl: l.officialCardUrl ?? null,
      confirmStatus: l.confirmStatus || (l.hp == null ? '要確認（アプリ独自データ。HP/ATK等は未確認のためnull）' : '公式カードページ確認済（アプリ既存データ）'),
      confirmed: l.confirmStatus ? false : l.hp != null,
      parallelGroupId: l.cardNumber.split('/')[0],
      imageUrl: images[l.name] || null,
      imageUrlAwakened: imagesAwakened[l.name] || images[l.name] || null,
    });
  });

  // --- リーダー以外（Excel「全カード」シート）---
  rawCards.forEach((d) => {
    const typeJa = d['カード種類'];
    const cardType = TYPE_MAP[typeJa];
    if (!cardType || cardType === 'LEADER') return; // リーダーはleaders.js側を正とする

    const colorJa = clean(d['色']);
    const cardNumber = d['カード番号'];
    const buildRuleRaw = clean(d['ビルドルール']);
    out.push({
      cardNumber,
      name: clean(d['カード名']),
      cardType,
      cardTypeJa: typeJa,
      set: d['収録弾'],
      color: colorJa ? (COLOR_MAP[colorJa] || null) : null,
      rarity: clean(d['レアリティ']),
      cost: d['コスト'] ?? null,
      hp: null,
      atk: null,
      awakenHp: null,
      awakenAtk: null,
      buildRule: buildRuleRaw,
      buildRuleParsed: parseBuildRule(buildRuleRaw),
      ace: parseTriState(d['ACE']),
      ban: d['BAN'] === true,
      text: clean(d['カードテキスト']),
      effectSummary: clean(d['効果概要']),
      officialUrl: d['公式URL'] || null,
      confirmStatus: d['確認状況'] || null,
      confirmed: d['確認状況'] === '公式カードページ確認済' || d['確認状況'] === '公式ページ確認',
      parallelGroupId: cardNumber, // パラレルは下で上書き
      imageUrl: findExistingImage(cardNumber),
      imageUrlAwakened: null,
    });
  });

  // --- パラレルカード（通常版とは別カードとして追加。デッキ枚数カウント用に parallelGroupId を通常版に合わせる）---
  // パラレル/プロモは通常版と同名・同効果なので、コスト・テキスト・ビルドルール・BANは通常版から引き継ぐ
  // （cost: null のままだと対戦エンジンでコスト未確定としてプレイできなくなる）。
  const byNumber = {};
  out.forEach((c) => { byNumber[c.cardNumber] = c; });
  parallels.forEach((p) => {
    const base = byNumber[p.baseCardNumber];
    if (!base) throw new Error('パラレルの通常版が見つかりません: ' + p.cardNumber + ' -> ' + p.baseCardNumber);
    out.push({
      cardNumber: p.cardNumber,
      name: p.name,
      cardType: TYPE_MAP[p.cardType] || 'MEMORIA',
      cardTypeJa: p.cardType,
      set: p.set,
      color: COLOR_MAP[p.color] || null,
      rarity: p.rarity,
      cost: base.cost,
      hp: null, atk: null, awakenHp: null, awakenAtk: null,
      buildRule: base.buildRule,
      buildRuleParsed: base.buildRuleParsed,
      ace: p.ace === true,
      ban: base.ban,
      text: base.text,
      effectSummary: base.effectSummary,
      officialUrl: p.officialUrl || null,
      confirmStatus: p.confirmStatus || null,
      confirmed: p.confirmStatus === '公式カードページ確認済',
      isParallel: true,
      parallelGroupId: p.baseCardNumber,
      imageUrl: findExistingImage(p.cardNumber),
      imageUrlAwakened: null,
    });
  });

  fs.writeFileSync(path.join(ROOT, 'data/cards.json'), JSON.stringify(out, null, 1));

  // ブラウザから file:// で直接開いても読み込めるよう、JSファイル版も生成する
  // （fetch()はfile://だとCORSでブロックされるため、他のjs/data/*.jsと同じ<script>読み込み方式にする）
  const jsOut = '/* 自動生成: node scripts/build-cards-json.js で再生成。手編集しないこと。 */\n'
    + '(function () {\n'
    + '  window.XS_DECKBUILDER_CARDS = ' + JSON.stringify(out) + ';\n'
    + "  document.dispatchEvent(new CustomEvent('xs-deckbuilder-cards-ready'));\n"
    + '})();\n';
  fs.writeFileSync(path.join(ROOT, 'js/deckbuilder/cards-data.js'), jsOut);

  // 対戦エンジンがパラレルのカード番号からでも通常版の効果登録（cardEffectData.js）を引けるよう、
  // パラレル→通常版の対応表をエンジン用モジュールとして生成する。
  const aliases = {};
  parallels.forEach((p) => { aliases[p.cardNumber] = p.baseCardNumber; });
  const aliasOut = '/* 自動生成: node scripts/build-cards-json.js で再生成。手編集しないこと。\n'
    + ' * パラレル/プロモのカード番号 → 通常版のカード番号（効果は通常版と同一）。 */\n'
    + '(function (root, factory) {\n'
    + "  if (typeof module !== 'undefined' && module.exports) {\n"
    + '    module.exports = factory();\n'
    + '  } else {\n'
    + '    root.XS_ENGINE_PARALLEL_ALIASES = factory();\n'
    + '  }\n'
    + "}(typeof self !== 'undefined' ? self : this, function () {\n"
    + '  return ' + JSON.stringify(aliases, null, 2).replace(/\n/g, '\n  ') + ';\n'
    + '}));\n';
  fs.writeFileSync(path.join(ROOT, 'js/engine/parallelAliases.js'), aliasOut);

  const byType = {};
  out.forEach((c) => { byType[c.cardType] = (byType[c.cardType] || 0) + 1; });
  console.log('[build-cards-json] wrote', out.length, 'cards ->', JSON.stringify(byType));
  const unknownRules = out.filter((c) => c.buildRuleParsed && c.buildRuleParsed.kind === 'UNKNOWN');
  console.log('[build-cards-json] 特殊ビルドルール（自動判定不可）:', unknownRules.length, unknownRules.map((c) => c.cardNumber + ':' + c.buildRule));
}

main();
