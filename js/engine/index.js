/* Xross Stars ゲームエンジン — エントリポイント（各モジュールの集約）
 *
 * ブラウザでは他のjs/engine/*.jsを<script>で先に読み込んだ上でこのファイルを読み込む
 * （js/data/*.js と同じ、ビルド不要・file://でも動く方式）。
 * Node（テスト）では require('./js/engine') で全モジュールをまとめて取得できる。
 *
 * 今回のフェーズでは、このファイル自体はどのHTMLからも読み込まれていない
 * （対戦UIは未実装のため）。将来UIを実装する際の入口として用意する。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./cardLookup.js'),
      require('./ruleConfig.js'),
      require('./gameState.js'),
      require('./events.js'),
      require('./resolutionStack.js'),
      require('./deck.js'),
      require('./combat.js'),
      require('./phases.js'),
      require('./match.js'),
      require('./cardEffect.js')
    );
  } else {
    root.XS_ENGINE = factory(
      root.XS_ENGINE_CARD_LOOKUP, root.XS_ENGINE_RULE_CONFIG, root.XS_ENGINE_STATE,
      root.XS_ENGINE_EVENTS, root.XS_ENGINE_RESOLUTION_STACK, root.XS_ENGINE_DECK,
      root.XS_ENGINE_COMBAT, root.XS_ENGINE_PHASES, root.XS_ENGINE_MATCH, root.XS_ENGINE_CARD_EFFECT
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  CardLookup, RuleConfig, GameState, Events, ResolutionStack, Deck, Combat, Phases, Match, CardEffect
) {
  'use strict';
  return {
    CardLookup: CardLookup,
    RuleConfig: RuleConfig,
    GameState: GameState,
    Events: Events,
    ResolutionStack: ResolutionStack,
    Deck: Deck,
    Combat: Combat,
    Phases: Phases,
    Match: Match,
    CardEffect: CardEffect,
  };
}));
