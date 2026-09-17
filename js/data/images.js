/* Xross Stars — リーダー画像レジストリ
 *
 * data/image-map.json（フォルダ内カード画像の全件解析結果）から生成。
 * キーはリーダー名（同名カードは同一リーダー扱い）。
 * 件数はハードコードせず、対象は常に window.XS_LEADERS の全件。
 */
(function () {
  window.XS_LEADER_IMAGE_DIR = 'cards/';

  window.XS_LEADER_IMAGES = {
    'うぉっか': 'cards/imgi_2_image.webp',
    '昏昏アリア': 'cards/imgi_3_image.webp',
    '夜乃くろむ': 'cards/BP04-092_yano-kuromu.webp',
    'おぼ': 'cards/imgi_10_image.webp',
    '千燈ゆうひ': 'cards/BP04-098_sendou-yuuhi.webp',
    '龍巻ちせ': 'cards/imgi_12_image.webp',
    '胡桃のあ': 'cards/lrpp_kurumi-noa.webp',
    '兎咲ミミ': 'cards/imgi_25_image_1.webp',
    'VanilLa': 'cards/imgi_26_image_1.webp',
    'Ras': 'cards/imgi_27_image_1.webp',
    'けんき': 'cards/imgi_31_image.webp',
    '猫汰つな': 'cards/lrpp_nekota-tsuna.webp',
    '夜絆ニウ': 'cards/imgi_33_image.webp',
    '赤見かるび': 'cards/lrpp_akami-karubi.webp',
    '立川': 'cards/imgi_36_image.webp',
    '甘結もか': 'cards/lrpp_amayui-moka.webp',
    'ボンちゃん': 'cards/imgi_45_image.webp',
    '八雲べに': 'cards/imgi_46_image_1.webp',
    'うるか': 'cards/imgi_47_image_1.webp',
    '夢野あかり': 'cards/imgi_48_image.webp',
    '小森めと': 'cards/lrpp_komori-meto.webp',
    'らいじん': 'cards/imgi_49_image.webp',
    'Selly': 'cards/imgi_49_image_1.webp',
    '神楽めあ': 'cards/imgi_50_image.webp',
    '橘ひなの': 'cards/lrpp_tachibana-hinano.webp',
    '白波らむね': 'cards/imgi_51_image.webp',
    'ふらんしすこ': 'cards/imgi_51_image_1.webp',
    'まざー3': 'cards/imgi_52_image.webp',
    'Mondo': 'cards/imgi_52_image_1.webp',
    '一ノ瀬うるは': 'cards/BP01-115_ichinose-uruha.webp',
    'Kamito': 'cards/imgi_54_image_1.webp',
    '小雀とと': 'cards/lrpp_kosuzume-toto.webp',
    '渋谷ハル': 'cards/imgi_56_image_1.webp',
    'とおこ': 'cards/lrpp_tooko.webp',
    '白雪レイド': 'cards/imgi_57_image_1.webp',
    '乾伸一郎': 'cards/imgi_58_image.webp',
    '英リサ': 'cards/imgi_58_image_1.webp',
    '銀城サイネ': 'cards/imgi_59_image.webp',
    'じゃすぱー': 'cards/imgi_60_image.webp',
    'ごっちゃん@マイキー': 'cards/imgi_60_image_1.webp',
    '天帝フォルテ': 'cards/imgi_61_image.webp',
    'Cpt': 'cards/imgi_61_image_1.webp',
    '天月': 'cards/imgi_62_image.webp',
    '紫宮るな': 'cards/imgi_63_image.webp',
    '緋月ゆい': 'cards/lrpp_hizuki-yui.webp',
    'rion': 'cards/imgi_65_image.webp',
    '空澄セナ': 'cards/imgi_65_image_1.webp',
    'ズズ': 'cards/imgi_66_image.webp',
    'ありさか': 'cards/imgi_66_image_1.webp',
    '紡木こかげ': 'cards/imgi_67_image.webp',
    '花芽すみれ': 'cards/lrpp_haname-sumire.webp',
    '柊ツルギ': 'cards/imgi_68_image.webp',
    '花芽なずな': 'cards/lrpp_haname-nazuna.webp',
    '平岩康佑': 'cards/imgi_69_image.webp',
    'だるまいずごっど': 'cards/imgi_69_image_1.webp',
    '藍沢エマ': 'cards/lrpp_aizawa-ema.webp',
    '鬼ヶ谷テン': 'cards/imgi_71_image.webp',
    'ととみっくす': 'cards/imgi_72_image.webp',
    '猫麦とろろ': 'cards/lrpp_nekomugi-tororo.webp',
    '絲依とい': 'cards/imgi_74_image.webp',
    '如月れん': 'cards/BP02-088_kisaragi-ren.webp',
    '蝶屋はなび': 'cards/imgi_81_image.webp',
    'あれる': 'cards/imgi_82_image.webp',
    'かずのこ': 'cards/imgi_83_image.webp',
    'Shuto': 'cards/imgi_84_image.webp',
    'トナカイト': 'cards/imgi_85_image.webp',
    'nqrse': 'cards/BP01-130_nqrse.webp',
    'わいわい': 'cards/BP02-097_waiwai.webp',
    'kinako': 'cards/BP02-096_kinako.webp',
    '神成きゅぴ': 'cards/BP02-095_kaminari-kyupi.webp',
    'どぐら': 'cards/BP02-101_dogura.webp',
    '天鬼ぷるる': 'cards/BP02-100_amaki-pururu.webp'
  };

  // 覚醒後の画像（無ければ覚醒前を使用）
  window.XS_LEADER_IMAGES_AWAKENED = {
    '一ノ瀬うるは': 'cards/BP01-115_ichinose-uruha_awakened.webp',
    'nqrse': 'cards/BP01-130_nqrse_awakened.webp',
    '千燈ゆうひ': 'cards/BP04-098_sendou-yuuhi_awakened.png',
    '夜乃くろむ': 'cards/BP04-092_yano-kuromu_awakened.webp',
    '如月れん': 'cards/BP02-088_kisaragi-ren_awakened.webp',
    'とおこ': 'cards/lrpp_tooko_awakened.webp',
    '小森めと': 'cards/lrpp_komori-meto_awakened.webp',
    '小雀とと': 'cards/lrpp_kosuzume-toto_awakened.webp',
    '橘ひなの': 'cards/lrpp_tachibana-hinano_awakened.webp',
    '猫汰つな': 'cards/lrpp_nekota-tsuna_awakened.webp',
    '猫麦とろろ': 'cards/lrpp_nekomugi-tororo_awakened.webp',
    '甘結もか': 'cards/lrpp_amayui-moka_awakened.webp',
    '緋月ゆい': 'cards/lrpp_hizuki-yui_awakened.webp',
    '胡桃のあ': 'cards/lrpp_kurumi-noa_awakened.webp',
    '花芽すみれ': 'cards/lrpp_haname-sumire_awakened.webp',
    '花芽なずな': 'cards/lrpp_haname-nazuna_awakened.webp',
    '藍沢エマ': 'cards/lrpp_aizawa-ema_awakened.webp',
    '赤見かるび': 'cards/lrpp_akami-karubi_awakened.webp'
  };

  window.XS_VERIFY_IMAGES = function () {
    var leaders = window.XS_LEADERS || [];
    var names = [];
    leaders.forEach(function (l) { if (names.indexOf(l.name) < 0) names.push(l.name); });

    var map = window.XS_LEADER_IMAGES || {};
    var ok = [], ng = [];
    names.forEach(function (n) { (map[n] ? ok : ng).push(n); });

    var report =
      '=== リーダー画像取得結果 ===\n\n' +
      '対象: ' + names.length + '\n' +
      '取得成功: ' + ok.length + '\n' +
      '取得失敗: ' + ng.length + '\n\n' +
      '保存先:\n' + window.XS_LEADER_IMAGE_DIR + '\n\n' +
      '失敗したカード:\n' + (ng.length ? ng.join('\n') : 'なし');

    console.log(report);
    return { total: names.length, success: ok.length, failed: ng.length, failedNames: ng, report: report };
  };
})();
