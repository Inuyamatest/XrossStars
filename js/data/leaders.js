/* Xross Stars — リーダーデータ（ユーザー提供JSONをそのまま登録・改変なし）
 * 第1弾16名 / ST01 4名 / ST02 4名 / 第2弾16名 / 第3弾16名 / 第4弾16名 / 1st Anniv. 4名 = 76名
 * （旧コメントは「=64名」だったが、ST01/ST02の8名が数え漏れていたため今回あわせて修正）
 * 第5弾以降は leaders 配列に追記するだけで選択画面へ自動反映されます。
 */
(function () {
  var DATA = {
    "game": "Xross Stars",
    "dataVersion": "1.0.0",
    "source": "https://xross-stars.com/card",
    "description": "第1弾〜第4弾のユニークなリーダー64名。LRP/LRPPなど同一リーダーのパラレルレアリティは重複登録しない。",
    "leaders": [
      {"id":"BP01-001","name":"うるか","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-001/100","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/1-001"},
      {"id":"BP01-002","name":"小森めと","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-002/100","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/1-002"},
      {"id":"BP01-003","name":"橘ひなの","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-003/100","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/1-003"},
      {"id":"BP01-004","name":"ふらんしすこ","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-004/100","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/1-004"},
      {"id":"BP01-005","name":"Kamito","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-005/100","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/1-005"},
      {"id":"BP01-006","name":"渋谷ハル","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-006/100","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/1-006"},
      {"id":"BP01-007","name":"白雪レイド","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-007/100","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/1-007"},
      {"id":"BP01-008","name":"英リサ","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-008/100","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/1-008"},
      {"id":"BP01-009","name":"胡桃のあ","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-009/100","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/1-009"},
      {"id":"BP01-010","name":"ごっちゃん@マイキー","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-010/100","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/1-010"},
      {"id":"BP01-011","name":"兎咲ミミ","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-011/100","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/1-011"},
      {"id":"BP01-012","name":"VanilLa","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-012/100","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/1-012"},
      {"id":"BP01-013","name":"空澄セナ","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-013/100","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/1-013"},
      {"id":"BP01-014","name":"ありさか","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-014/100","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/1-014"},
      {"id":"BP01-015","name":"だるまいずごっど","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-015/100","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/1-015"},
      {"id":"BP01-016","name":"nqrse","booster":"第1弾","boosterName":"Luminous Daybreak","cardNumber":"BP01-016/100","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/1-016"},
      {"id":"bp01-selly","name":"Selly","booster":"ST02","boosterCode":"ST02","boosterName":"魔王降臨","cardNumber":"ST02-001","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":null},
      {"id":"bp01-mondo","name":"Mondo","booster":"ST02","boosterCode":"ST02","boosterName":"魔王降臨","cardNumber":"ST02-002","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/3-002"},
      {"id":"bp01-ichinose-uruha","name":"一ノ瀬うるは","booster":"ST01","boosterCode":"ST01","boosterName":"初の栄冠","cardNumber":"ST01-001","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/2-001"},
      {"id":"bp01-kosuzume-toto","name":"小雀とと","booster":"ST01","boosterCode":"ST01","boosterName":"初の栄冠","cardNumber":"ST01-002","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/2-002"},
      {"id":"bp01-cpt","name":"Cpt","booster":"ST02","boosterCode":"ST02","boosterName":"魔王降臨","cardNumber":"ST02-003","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/3-003"},
      {"id":"bp01-ras","name":"Ras","booster":"ST02","boosterCode":"ST02","boosterName":"魔王降臨","cardNumber":"ST02-004","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/3-004"},
      {"id":"bp01-haname-sumire","name":"花芽すみれ","booster":"ST01","boosterCode":"ST01","boosterName":"初の栄冠","cardNumber":"ST01-003","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/2-003"},
      {"id":"bp01-haname-nazuna","name":"花芽なずな","booster":"ST01","boosterCode":"ST01","boosterName":"初の栄冠","cardNumber":"ST01-004","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/2-004"},

      {"id":"BP02-001","name":"赤見かるび","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-001/082","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/5-001"},
      {"id":"BP02-002","name":"如月れん","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-002/082","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-002"},
      {"id":"BP02-003","name":"立川","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-003/082","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/5-003"},
      {"id":"BP02-004","name":"蝶屋はなび","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-004/082","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/5-004"},
      {"id":"BP02-005","name":"あれる","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-005/082","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-005"},
      {"id":"BP02-006","name":"かずのこ","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-006/082","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/5-006"},
      {"id":"BP02-007","name":"Shuto","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-007/082","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/5-007"},
      {"id":"BP02-008","name":"トナカイト","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-008/082","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-008"},
      {"id":"BP02-009","name":"甘結もか","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-009/082","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-009"},
      {"id":"BP02-010","name":"神成きゅぴ","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-010/082","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-010"},
      {"id":"BP02-011","name":"kinako","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-011/082","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-011"},
      {"id":"BP02-012","name":"わいわい","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-012/082","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/5-012"},
      {"id":"BP02-013","name":"天鬼ぷるる","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-013/082","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/5-013"},
      {"id":"BP02-014","name":"どぐら","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-014/082","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/5-014"},
      {"id":"BP02-015","name":"ボンちゃん","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-015/082","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/5-015"},
      {"id":"BP02-016","name":"八雲べに","booster":"第2弾","boosterName":"Exceed Rampage","cardNumber":"BP02-016/082","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/5-016"},

      {"id":"BP03-001","name":"天月","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-001/081","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-001"},
      {"id":"BP03-002","name":"紫宮るな","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-002/081","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/6-002"},
      {"id":"BP03-003","name":"緋月ゆい","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-003/081","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/6-003"},
      {"id":"BP03-004","name":"rion","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-004/081","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-004"},
      {"id":"BP03-005","name":"ズズ","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-005/081","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/6-005"},
      {"id":"BP03-006","name":"紡木こかげ","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-006/081","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-006"},
      {"id":"BP03-007","name":"柊ツルギ","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-007/081","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/6-007"},
      {"id":"BP03-008","name":"平岩康佑","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-008/081","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/6-008"},
      {"id":"BP03-009","name":"藍沢エマ","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-009/081","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-009"},
      {"id":"BP03-010","name":"鬼ヶ谷テン","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-010/081","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-010"},
      {"id":"BP03-011","name":"ととみっくす","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-011/081","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-011"},
      {"id":"BP03-012","name":"猫麦とろろ","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-012/081","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダーすべてに10ダメージ。","officialCardUrl":"https://xross-stars.com/card/6-012"},
      {"id":"BP03-013","name":"絲依とい","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-013/081","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/6-013"},
      {"id":"BP03-014","name":"けんき","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-014/081","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/6-014"},
      {"id":"BP03-015","name":"猫汰つな","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-015/081","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/6-015"},
      {"id":"BP03-016","name":"夜絆ニウ","booster":"第3弾","boosterName":"Broken Neonlights","cardNumber":"BP03-016/081","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/6-016"},

      {"id":"BP04-001","name":"うぉっか","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-001/081","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/7-001"},
      {"id":"BP04-002","name":"昏昏アリア","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-002/081","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/7-002"},
      {"id":"BP04-003","name":"夢野あかり","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-003/081","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/7-003"},
      {"id":"BP04-004","name":"らいじん","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-004/081","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/7-004"},
      {"id":"BP04-005","name":"神楽めあ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-005/081","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/7-005"},
      {"id":"BP04-006","name":"白波らむね","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-006/081","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/7-006"},
      {"id":"BP04-007","name":"まざー3","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-007/081","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/7-007"},
      {"id":"BP04-008","name":"夜乃くろむ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-008/081","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/7-008"},
      {"id":"BP04-009","name":"おぼ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-009/081","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/7-009"},
      {"id":"BP04-010","name":"千燈ゆうひ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-010/081","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/7-010"},
      {"id":"BP04-011","name":"龍巻ちせ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-011/081","color":"yellow","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/7-011"},
      {"id":"BP04-012","name":"とおこ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-012/081","color":"yellow","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。","officialCardUrl":"https://xross-stars.com/card/7-012"},
      {"id":"BP04-013","name":"乾伸一郎","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-013/081","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に10ダメージ。","officialCardUrl":"https://xross-stars.com/card/7-013"},
      {"id":"BP04-014","name":"銀城サイネ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-014/081","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。","officialCardUrl":"https://xross-stars.com/card/7-014"},
      {"id":"BP04-015","name":"じゃすぱー","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-015/081","color":"green","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。","officialCardUrl":"https://xross-stars.com/card/7-015"},
      {"id":"BP04-016","name":"天帝フォルテ","booster":"第4弾","boosterName":"Grand Resonance","cardNumber":"BP04-016/081","color":"green","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。","officialCardUrl":"https://xross-stars.com/card/7-016"},

      // Xross Stars 1st Anniv. Collection PREMIUM SET（表示名は短く「1st Anniv.」）
      {"id":"AN01-001","name":"うるか (AN1)","booster":"1st Anniv.","boosterName":"Collection PREMIUM SET","cardNumber":"AN01-001/024 LRP","color":"red","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを2枚引き、手札を2枚捨てる。"},
      {"id":"AN01-002","name":"橘ひなの (AN1)","booster":"1st Anniv.","boosterName":"Collection PREMIUM SET","cardNumber":"AN01-002/024 LRP","color":"red","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"対戦相手のリーダー1体に20ダメージ。"},
      {"id":"AN01-003","name":"一ノ瀬うるは (AN1)","booster":"1st Anniv.","boosterName":"Collection PREMIUM SET","cardNumber":"AN01-003/024 LRP","color":"blue","hp":110,"awakenedHp":140,"attack":30,"awakenedAttack":40,"awakeningEffect":"自分のリーダー1体を20回復する。"},
      {"id":"AN01-004","name":"白雪レイド (AN1)","booster":"1st Anniv.","boosterName":"Collection PREMIUM SET","cardNumber":"AN01-004/024 LRP","color":"blue","hp":100,"awakenedHp":130,"attack":30,"awakenedAttack":40,"awakeningEffect":"カードを1枚引く。"}
    ]
  };

  var COLORS = {
    red:    { ja: '赤', hex: '#ff458e' },
    blue:   { ja: '青', hex: '#62c5ee' },
    green:  { ja: '緑', hex: '#6fae7c' },
    yellow: { ja: '黄', hex: '#edbb00' }
  };

  // 収録弾はデータから自動生成（第5弾以降を追記すればフィルターにも自動で並ぶ）
  var BOOSTERS = [];
  DATA.leaders.forEach(function (l) {
    if (!BOOSTERS.some(function (b) { return b.id === l.booster; })) {
      BOOSTERS.push({ id: l.booster, label: l.booster, title: l.boosterName });
    }
  });

  window.XS_DATA = DATA;
  window.XS_LEADERS = DATA.leaders;
  window.XS_BOOSTERS = BOOSTERS;
  window.XS_COLORS = COLORS;
  window.XS_DEFAULT_HP = 100;

  console.log('[Xross Stars] リーダー登録 ' + DATA.leaders.length + '名 — ' +
    BOOSTERS.map(function (b) {
      return b.label + ' ' + DATA.leaders.filter(function (l) { return l.booster === b.id; }).length + '名';
    }).join(' / '));

  document.dispatchEvent(new CustomEvent('xs-leaders-ready'));
})();
