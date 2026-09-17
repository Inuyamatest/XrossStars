/* Xross Stars HP管理 — コンポーネントロジック
 * dc-runtime の DCLogic を継承。index.html 側の <script data-dc-script> が
 * このクラスを Component として登録する（ランタイムの制約でその1行だけはインライン）。
 */
const STEP_MAX_HP = 10;
const HISTORY_LIMIT = 30;
const SLOT_COUNT = 4;

window.XSComponent = class extends window.DCLogic {
  state = {
    slots: [], picker: null, detail: null, sheet: null, confirm: null,
    custom: '20', equipName: '', equipHp: '0', cols: 2,
    query: '', booster: 'ALL', color: 'ALL',
    // カスタマイズ：overrides = { [leaderId]: {name, awakeningEffect, hp, ..., imageUrl, awakenedImageUrl} }
    overrides: {}, editMode: false, editor: null, editorBusy: false
  };

  componentDidMount() {
    this.reload();
    if (window.XS_STORE) {
      window.XS_STORE.loadAll().then(overrides => this.setState({ overrides }));
    }
    if (window.XS_VERIFY_IMAGES) window.XS_VERIFY_IMAGES();
    document.addEventListener('xs-leaders-ready', this.reload);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }
  componentWillUnmount() {
    document.removeEventListener('xs-leaders-ready', this.reload);
    window.removeEventListener('resize', this.onResize);
  }

  reload = () => {
    this.setState({
      slots: Array.from({ length: SLOT_COUNT }, (_, i) => this.emptySlot(i))
    });
  };

  emptySlot(i) {
    return {
      slotIndex: i, leaderId: null, card: null,
      baseMaxHp: 0, maxHp: 0, damage: 0, currentHp: 0, isDown: false, manualMaxDelta: 0,
      awakened: false, attack: 0,
      equipment: [], history: [], lastLabel: 'なし', flashTick: 0, flashKind: null
    };
  }

  onResize = () => {
    const layout = this.props.layout ?? 'auto';
    const cols = layout === '2x2' ? 2 : layout === '1x4' ? 4
      : (window.innerWidth >= 620 ? 4 : 2);
    if (cols !== this.state.cols) this.setState({ cols });
  };

  // カタログ = 元データ ＋ この端末で保存したカスタマイズ（名前・テキスト・数値・画像）を重ねたもの
  catalog() {
    const ov = this.state.overrides || {};
    return (window.XS_LEADERS || []).map(c => ov[c.id] ? Object.assign({}, c, ov[c.id]) : c);
  }
  baseCard(id) { return (window.XS_LEADERS || []).find(c => c.id === id); }
  // 画像は名前キーのレジストリ → カード固有URL の順で解決（件数は一切ハードコードしない）
  imageOf(card, awakened) {
    if (!card) return null;
    const reg = window.XS_LEADER_IMAGES || {};
    const regAwake = window.XS_LEADER_IMAGES_AWAKENED || {};
    if (awakened) return card.awakenedImageUrl || regAwake[card.name] || card.imageUrl || reg[card.name] || null;
    return card.imageUrl || reg[card.name] || null;
  }
  colors() { return window.XS_COLORS || {}; }
  boosters() { return window.XS_BOOSTERS || []; }
  colorHex(key) { return (this.colors()[key] || {}).hex || '#605d5d'; }
  colorJa(key) { return (this.colors()[key] || {}).ja || '不明'; }
  boosterLabel(id) {
    const b = this.boosters().find(x => x.id === id);
    return b ? b.label : id;
  }

  // 1件のリーダーを枠に配置。HP/ATK/画像/色はカタログの値をそのまま使う。
  assign(slotIndex, leaderId) {
    const card = this.catalog().find(c => c.id === leaderId);
    if (!card) return;
    const hp = card.hp ?? window.XS_DEFAULT_HP ?? 100;
    this.setState(s => ({
      picker: null,
      slots: s.slots.map((sl, i) => i !== slotIndex ? sl : Object.assign({}, this.emptySlot(i), {
        leaderId: card.id, card,
        baseMaxHp: hp, maxHp: hp, currentHp: hp, damage: 0,
        attack: card.attack ?? 0,
        lastLabel: card.name + ' を選択'
      }))
    }));
  }

  // 最大HPは「基本の体力（装備で上書きされうる）＋ 増減効果 ＋ 手動調整」で毎回導出する。
  // サイバネアーマーのような SET_BASE_HP は覚醒状態に応じて基本値そのものを差し替える。
  computeBase(card, awakened, equipment) {
    let base = awakened ? (card.awakenedHp ?? card.hp ?? 0) : (card.hp ?? 0);
    (equipment || []).forEach(e => (e.effects || []).forEach(f => {
      if (f.type === 'SET_BASE_HP') base = awakened ? f.awakened : f.normal;
    }));
    return base;
  }
  computeMaxHp(card, awakened, equipment, manualDelta) {
    let d = manualDelta || 0;
    (equipment || []).forEach(e => (e.effects || []).forEach(f => {
      if (f.type === 'MAX_HP_MODIFIER') d += f.amount || 0;
    }));
    return Math.max(0, this.computeBase(card, awakened, equipment) + d);
  }

  equipNote(eq, awakened) {
    const parts = [];
    (eq.effects || []).forEach(f => {
      if (f.type === 'SET_BASE_HP') parts.push('基本の体力 ' + (awakened ? f.awakened : f.normal));
      if (f.type === 'MAX_HP_MODIFIER') parts.push('最大HP ' + (f.amount > 0 ? '+' : '') + f.amount);
    });
    return parts.length ? parts.join(' / ') : false;
  }

  // 枠からリーダーを外す（空き枠に戻す）
  clearSlot(i) {
    this.setState(s => ({
      detail: null, sheet: null,
      slots: s.slots.map((sl, j) => j === i ? this.emptySlot(j) : sl)
    }));
  }

  // すべての状態変化はここを通る（ダメージ／回復／最大HP／装備／覚醒）
  apply(slotIndex, patch, label) {
    this.setState(s => ({
      slots: s.slots.map((l, i) => {
        if (i !== slotIndex || !l.card) return l;
        const snap = {
          manualMaxDelta: l.manualMaxDelta, damage: l.damage, equipment: l.equipment,
          awakened: l.awakened, attack: l.attack, label: l.lastLabel
        };
        const equipment = patch.equipment || l.equipment;
        const awakened = patch.awakened ?? l.awakened;
        const manualMaxDelta = (l.manualMaxDelta || 0) + (patch.maxHpDelta || 0);
        const maxHp = this.computeMaxHp(l.card, awakened, equipment, manualMaxDelta);
        const damage = Math.max(0, Math.min(l.damage + (patch.damage || 0) - (patch.heal || 0), maxHp));
        const currentHp = Math.max(0, maxHp - damage);
        return Object.assign({}, l, {
          maxHp, damage, currentHp, manualMaxDelta,
          baseMaxHp: this.computeBase(l.card, awakened, equipment),
          equipment, awakened,
          attack: patch.attack ?? l.attack,
          isDown: currentHp <= 0,
          history: l.history.concat([Object.assign({ timestamp: Date.now(), action: label }, snap)]).slice(-HISTORY_LIMIT),
          lastLabel: label,
          flashTick: l.flashTick + 1,
          flashKind: patch.damage ? 'hit' : patch.heal ? 'heal' : null
        });
      })
    }));
  }

  toggleAwaken(i) {
    const l = this.state.slots[i];
    if (!l || !l.card) return;
    const c = l.card;
    if (!l.awakened) this.apply(i, { attack: c.awakenedAttack ?? l.attack, awakened: true }, '覚醒');
    else this.apply(i, { attack: c.attack ?? l.attack, awakened: false }, '覚醒解除');
  }

  undo(i) {
    this.setState(s => ({
      slots: s.slots.map((l, j) => {
        if (j !== i || !l.history.length) return l;
        const p = l.history[l.history.length - 1];
        const maxHp = this.computeMaxHp(l.card, p.awakened, p.equipment, p.manualMaxDelta);
        const currentHp = Math.max(0, maxHp - p.damage);
        return Object.assign({}, l, {
          maxHp, manualMaxDelta: p.manualMaxDelta, damage: p.damage, equipment: p.equipment,
          baseMaxHp: this.computeBase(l.card, p.awakened, p.equipment),
          awakened: p.awakened, attack: p.attack,
          currentHp, isDown: currentHp <= 0,
          history: l.history.slice(0, -1), lastLabel: p.label,
          flashTick: l.flashTick + 1, flashKind: null
        });
      })
    }));
  }

  // HPリセット：累計ダメージだけを 0 に戻す。覚醒状態・装備・最大HP調整はそのまま
  // （装備で最大HPが変わっていればその最大HPまで全回復）。1手戻すで取り消せる。
  resetSlot(l) {
    if (!l.card) return l;
    const snap = {
      manualMaxDelta: l.manualMaxDelta, damage: l.damage, equipment: l.equipment,
      awakened: l.awakened, attack: l.attack, label: l.lastLabel
    };
    const maxHp = this.computeMaxHp(l.card, l.awakened, l.equipment, l.manualMaxDelta);
    return Object.assign({}, l, {
      maxHp, damage: 0, currentHp: maxHp, isDown: false,
      history: l.history.concat([Object.assign({ timestamp: Date.now(), action: 'HPリセット' }, snap)]).slice(-HISTORY_LIMIT),
      lastLabel: 'HPリセット',
      flashTick: l.flashTick + 1, flashKind: 'heal'
    });
  }

  runConfirm = () => {
    const c = this.state.confirm;
    this.setState(s => ({
      confirm: null,
      sheet: c.index == null ? s.sheet : null,
      slots: s.slots.map((l, i) => (c.index == null || c.index === i) ? this.resetSlot(l) : l)
    }));
  };

  // ---- カスタマイズ（リーダー選択画面の ⚙ から）----
  openEditor(id) {
    const c = this.catalog().find(x => x.id === id);
    if (!c) return;
    const s = v => v == null ? '' : String(v);
    this.setState({
      editor: {
        id, name: s(c.name), awakeningEffect: s(c.awakeningEffect),
        hp: s(c.hp), awakenedHp: s(c.awakenedHp), attack: s(c.attack), awakenedAttack: s(c.awakenedAttack),
        imageUrl: c.imageUrl || null, awakenedImageUrl: c.awakenedImageUrl || null,
        imageCleared: false, awakenedImageCleared: false, error: ''
      }
    });
  }
  setEditor(patch) { this.setState(s => ({ editor: s.editor ? Object.assign({}, s.editor, patch) : null })); }

  pickImage(field, e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!window.XS_COMPRESS_IMAGE) return;
    this.setState({ editorBusy: true });
    window.XS_COMPRESS_IMAGE(file).then(dataUrl => {
      const patch = { error: '' }; patch[field] = dataUrl; patch[field + 'Cleared'] = false;
      this.setEditor(patch);
    }).catch(err => this.setEditor({ error: err.message || '画像を読み込めませんでした' }))
      .then(() => this.setState({ editorBusy: false }));
  }

  // 保存：元データと違うフィールドだけを override として残す
  saveEditor() {
    const ed = this.state.editor;
    const base = ed && this.baseCard(ed.id);
    if (!base) return;
    const num = v => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
    const ov = {};
    const name = ed.name.trim();
    if (name && name !== base.name) ov.name = name;
    if (ed.awakeningEffect.trim() !== (base.awakeningEffect || '')) ov.awakeningEffect = ed.awakeningEffect.trim();
    ['hp', 'awakenedHp', 'attack', 'awakenedAttack'].forEach(k => {
      const n = num(ed[k]);
      if (n != null && n !== base[k]) ov[k] = n;
    });
    if (ed.imageUrl && !ed.imageCleared) ov.imageUrl = ed.imageUrl;
    if (ed.awakenedImageUrl && !ed.awakenedImageCleared) ov.awakenedImageUrl = ed.awakenedImageUrl;
    this.commitOverride(ed.id, Object.keys(ov).length ? ov : null);
  }
  resetEditor() {
    const ed = this.state.editor;
    if (ed) this.commitOverride(ed.id, null);
  }
  commitOverride(id, ov) {
    if (window.XS_STORE) (ov ? window.XS_STORE.save(id, ov) : window.XS_STORE.remove(id))
      .catch(e => console.warn('[XS_STORE] save failed', e));
    this.setState(s => {
      const overrides = Object.assign({}, s.overrides);
      if (ov) overrides[id] = ov; else delete overrides[id];
      const base = this.baseCard(id);
      const merged = ov ? Object.assign({}, base, ov) : base;
      return {
        overrides, editor: null,
        // 配置済みの枠にも新しい名前・画像を反映する
        slots: s.slots.map(sl => sl.card && sl.card.id === id ? Object.assign({}, sl, { card: merged }) : sl)
      };
    });
  }

  num() {
    const n = Math.abs(parseInt(this.state.custom, 10));
    return isNaN(n) ? 0 : n;
  }

  renderVals() {
    const st = this.state;
    const flash = l => (this.props.showFlash === false || !l.flashKind)
      ? 'none'
      : `xs-${l.flashKind}-${l.flashTick % 2 ? 'a' : 'b'} .32s ease`;

    const slots = st.slots.map((l, i) => {
      const c = l.card;
      const img = this.imageOf(c, l.awakened);
      return {
        slotIndex: i,
        slotLabel: 'リーダー ' + (i + 1),
        empty: !c, filled: !!c,
        name: c ? c.name : '',
        colorHex: c ? this.colorHex(c.color) : '#605d5d',
        initial: c ? c.name.replace(/\s/g, '').slice(0, 1) : '',
        imageSrc: img || '', hasImage: !!img,
        noImage: !img,
        currentHp: l.currentHp, maxHp: l.maxHp, damage: l.damage,
        attack: l.attack, awakened: l.awakened, isDown: l.isDown,
        equipText: l.equipment.length ? l.equipment.map(e => e.name).join('・') : false,
        hpAnim: flash(l),
        openPicker: () => this.setState({ picker: { index: i }, query: '' }),
        openDetail: () => this.setState({ detail: { index: i } }),
        openMenu: () => this.setState({ sheet: { index: i }, equipName: '', equipHp: '0' }),
        heal10: () => this.apply(i, { heal: 10 }, '10回復'),
        hit10: () => this.apply(i, { damage: 10 }, '10ダメージ')
      };
    });

    // ---- 選択画面 ----
    const used = st.slots.map(l => l.card && l.card.name);
    const q = st.query.trim().toLowerCase();
    const list = this.catalog().filter(c =>
      (st.booster === 'ALL' || c.booster === st.booster) &&
      (st.color === 'ALL' || c.color === st.color) &&
      (!q || c.name.toLowerCase().includes(q))
    );
    const results = st.picker ? list.map(c => {
      const taken = used.some((n, i) => n === c.name && i !== st.picker.index);
      return {
        name: c.name,
        colorHex: this.colorHex(c.color),
        meta: c.booster + '『' + c.boosterName + '』 ・ ' + c.cardNumber + ((st.overrides || {})[c.id] ? ' ・ カスタム' : ''),
        hpText: c.hp == null ? 'HP ―' : 'HP ' + c.hp + ' → ' + c.awakenedHp,
        atkText: c.attack == null ? 'ATK ―' : 'ATK ' + c.attack + ' → ' + c.awakenedAttack,
        used: taken,
        opacity: taken ? 0.4 : 1,
        pick: () => { if (!taken) this.assign(st.picker.index, c.id); },
        editable: st.editMode,
        customized: !!(st.overrides || {})[c.id],
        edit: () => this.openEditor(c.id)
      };
    }) : [];

    // ---- カスタマイズ編集ダイアログ ----
    const ed = st.editor;
    const baseEd = ed && this.baseCard(ed.id);
    const editor = !ed || !baseEd ? false : {
      title: baseEd.name + ' をカスタマイズ',
      name: ed.name, awakeningEffect: ed.awakeningEffect,
      hp: ed.hp, awakenedHp: ed.awakenedHp, attack: ed.attack, awakenedAttack: ed.awakenedAttack,
      imageSrc: ed.imageCleared ? '' : (ed.imageUrl || (window.XS_LEADER_IMAGES || {})[baseEd.name] || ''),
      hasImage: !ed.imageCleared && !!(ed.imageUrl || (window.XS_LEADER_IMAGES || {})[baseEd.name]),
      awakenedImageSrc: ed.awakenedImageCleared ? '' : (ed.awakenedImageUrl || (window.XS_LEADER_IMAGES_AWAKENED || {})[baseEd.name] || ''),
      hasAwakenedImage: !ed.awakenedImageCleared && !!(ed.awakenedImageUrl || (window.XS_LEADER_IMAGES_AWAKENED || {})[baseEd.name]),
      hasCustomImage: !!ed.imageUrl && !ed.imageCleared,
      hasCustomAwakenedImage: !!ed.awakenedImageUrl && !ed.awakenedImageCleared,
      customized: !!(st.overrides || {})[ed.id],
      busy: st.editorBusy,
      error: ed.error || false,
      onName: e => this.setEditor({ name: e.target.value }),
      onEffect: e => this.setEditor({ awakeningEffect: e.target.value }),
      onHp: e => this.setEditor({ hp: e.target.value }),
      onAwakenedHp: e => this.setEditor({ awakenedHp: e.target.value }),
      onAttack: e => this.setEditor({ attack: e.target.value }),
      onAwakenedAttack: e => this.setEditor({ awakenedAttack: e.target.value }),
      pickImage: e => this.pickImage('imageUrl', e),
      pickAwakenedImage: e => this.pickImage('awakenedImageUrl', e),
      clearImage: () => this.setEditor({ imageUrl: null, imageCleared: true }),
      clearAwakenedImage: () => this.setEditor({ awakenedImageUrl: null, awakenedImageCleared: true }),
      save: () => this.saveEditor(),
      reset: () => this.resetEditor()
    };

    const counts = this.boosters().map(b =>
      b.label + ' ' + this.catalog().filter(c => c.booster === b.id).length + '名');

    const boosterOpts = [{ id: 'ALL', label: 'すべて' }]
      .concat(this.boosters().map(b => ({ id: b.id, label: b.label })))
      .map(o => ({
        label: o.label,
        bg: st.booster === o.id ? '#006786' : 'transparent',
        fg: st.booster === o.id ? '#e9f8ff' : '#f3f2f2',
        pick: () => this.setState({ booster: o.id })
      }));

    const colorOpts = [{ id: 'ALL', label: 'すべての色', hex: '#605d5d' }]
      .concat(Object.keys(this.colors()).map(k => ({ id: k, label: this.colorJa(k), hex: this.colorHex(k) })))
      .map(o => ({
        label: o.label,
        border: st.color === o.id ? o.hex : '#605d5d',
        bg: st.color === o.id ? o.hex : 'transparent',
        fg: st.color === o.id ? '#201e1d' : '#f3f2f2',
        pick: () => this.setState({ color: o.id })
      }));

    // ---- 詳細 ----
    const d = st.detail && st.slots[st.detail.index];
    const dc = d && d.card;
    const detail = !dc ? false : {
      name: dc.name,
      colorHex: this.colorHex(dc.color),
      imageSrc: this.imageOf(dc, d.awakened) || '', hasImage: !!this.imageOf(dc, d.awakened),
      meta: dc.booster + '『' + dc.boosterName + '』 ・ ' + dc.cardNumber + ' ・ ' + this.colorJa(dc.color),
      hp: dc.hp ?? '―', attack: dc.attack ?? '―',
      awakenedHp: dc.awakenedHp ?? '―', awakenedAttack: dc.awakenedAttack ?? '―',
      effectText: dc.awakeningEffect ? '【覚醒時】' + dc.awakeningEffect : '覚醒効果：データ未登録',
      awakenLabel: d.awakened ? '覚醒を解除' : '覚醒する',
      toggleAwaken: () => this.toggleAwaken(st.detail.index),
      change: () => this.setState({ detail: null, picker: { index: st.detail.index }, query: '' }),
      clear: () => this.clearSlot(st.detail.index)
    };

    // ---- カードメニュー ----
    const si = st.sheet && st.sheet.index;
    const s0 = st.sheet ? st.slots[si] : null;
    const sheet = !s0 || !s0.card ? false : {
      name: s0.card.name, colorHex: this.colorHex(s0.card.color),
      currentHp: s0.currentHp, maxHp: s0.maxHp, damage: s0.damage,
      baseMaxHp: s0.baseMaxHp, lastLabel: s0.lastLabel,
      awakenLabel: s0.awakened ? '覚醒を解除' : '覚醒する',
      toggleAwaken: () => this.toggleAwaken(si),
      equipment: s0.equipment.map((e, k) => ({
        name: e.name,
        hpNote: this.equipNote(e, s0.awakened),
        remove: () => this.apply(si, {
          equipment: s0.equipment.filter((_, j) => j !== k)
        }, e.name + ' を外す')
      })),
      catalog: (window.XS_EQUIPMENT || []).map(eq => ({
        name: eq.name,
        note: this.equipNote(eq, s0.awakened),
        equipped: s0.equipment.some(e => e.id === eq.id),
        opacity: s0.equipment.some(e => e.id === eq.id) ? 0.4 : 1,
        add: () => {
          if (s0.equipment.some(e => e.id === eq.id)) return;
          this.apply(si, { equipment: s0.equipment.concat([eq]) }, eq.name + ' を装備');
        }
      })),
      customHeal: () => this.apply(si, { heal: this.num() }, this.num() + '回復'),
      customHit: () => this.apply(si, { damage: this.num() }, this.num() + 'ダメージ'),
      maxUp: () => this.apply(si, { maxHpDelta: STEP_MAX_HP }, '最大HP +' + STEP_MAX_HP),
      maxDown: () => this.apply(si, { maxHpDelta: -STEP_MAX_HP }, '最大HP -' + STEP_MAX_HP),
      equip: () => {
        const name = this.state.equipName.trim();
        if (!name) return;
        const parsed = parseInt(this.state.equipHp, 10);
        const amount = isNaN(parsed) ? 0 : parsed;
        this.apply(si, {
          equipment: s0.equipment.concat([{ id: 'eq' + Date.now(), name, effects: amount ? [{ type: 'MAX_HP_MODIFIER', amount, target: 'SELF' }] : [] }])
        }, name + ' を装備' + (amount ? '（最大HP ' + (amount > 0 ? '+' : '') + amount + '）' : ''));
        this.setState({ equipName: '', equipHp: '0' });
      },
      undo: () => this.undo(si),
      clear: () => this.clearSlot(si),
      askReset: () => this.setState({ confirm: { index: si, detail: s0.card.name + ' のHPを全回復します。覚醒状態・装備・最大HPはそのまま残ります。' } })
    };

    return {
      slots, results, boosterOpts, colorOpts, detail, sheet, editor,
      picker: st.picker ? { title: 'リーダー ' + (st.picker.index + 1) + ' を選択' } : false,
      editMode: st.editMode,
      editBg: st.editMode ? '#006786' : 'transparent',
      editFg: st.editMode ? '#e9f8ff' : '#9b9797',
      toggleEdit: () => this.setState(s => ({ editMode: !s.editMode })),
      closeEditor: () => this.setState({ editor: null }),
      noResults: !!st.picker && results.length === 0,
      countLine: '登録 ' + this.catalog().length + '名（' + counts.join(' / ') + '）',
      gridCols: `repeat(${st.cols}, minmax(0, 1fr))`,
      query: st.query, custom: st.custom, equipName: st.equipName, equipHp: st.equipHp,
      confirm: st.confirm || false,
      onQuery: e => this.setState({ query: e.target.value }),
      onCustom: e => this.setState({ custom: e.target.value }),
      onEquipName: e => this.setState({ equipName: e.target.value }),
      onEquipHp: e => this.setState({ equipHp: e.target.value }),
      closePicker: () => this.setState({ picker: null }),
      closeDetail: () => this.setState({ detail: null }),
      closeSheet: () => this.setState({ sheet: null }),
      stop: e => e.stopPropagation(),
      askResetAll: () => this.setState({ confirm: { index: null, detail: '4人全員のHPを全回復します。覚醒状態・装備・最大HPはそのまま残ります。' } }),
      cancelConfirm: () => this.setState({ confirm: null }),
      doConfirm: this.runConfirm
    };
  }
};
