'use strict';

const Game = {

  /* ── Config ──────────────────────────────────────────────────── */
  config: {
    typeSpeed:      26,    // ms per character
    commaPause:     90,    // ms after ,  ;
    punctPause:     240,   // ms after .  !  ?  …
    paragraphPause: 440,   // ms between paragraphs
    choiceDelay:    160,   // ms stagger between each choice appearing
    sceneFadeDur:   220,   // ms for scene cross-fade (must exceed CSS opacity transition)
    notifDuration:  3800,  // ms before notification slides out
    saveKey:        'textgame_save',
  },

  /* ── Runtime state ───────────────────────────────────────────── */
  state: {
    currentSceneId: null,
    inventory: [],
    history: [],
    isTyping: false,
  },

  /* ── Story data (filled from JSON) ──────────────────────────── */
  data: {
    title: '',
    subtitle: '',
    startScene: 'start',
    scenes: {},
  },

  /* ── DOM refs ────────────────────────────────────────────────── */
  el: {},

  /* ── Internal handles ────────────────────────────────────────── */
  _twCancel:   null,   // call to skip current typewriter
  _notifTimer: null,

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */
  async init() {
    this._cacheDOM();
    this._bindEvents();

    try {
      await this._loadStory('story/demo.json');
    } catch (e) {
      console.error('Failed to load story:', e);
      document.body.innerHTML = '<p style="color:#666;padding:4rem;font-family:monospace">Could not load story file.</p>';
      return;
    }

    document.getElementById('page-title').textContent = this.data.title;
    this.el.gameTitle.textContent    = this.data.title;
    this.el.gameSubtitle.textContent = this.data.subtitle;

    if (this._hasSave()) {
      this.el.btnContinue.classList.remove('hidden');
    }
  },

  _cacheDOM() {
    const $ = id => document.getElementById(id);
    this.el = {
      titleScreen:      $('title-screen'),
      gameScreen:       $('game-screen'),
      gameTitle:        $('game-title'),
      gameSubtitle:     $('game-subtitle'),
      btnNew:           $('btn-new'),
      btnContinue:      $('btn-continue'),
      inventoryBtn:     $('inventory-btn'),
      inventoryCount:   $('inventory-count'),
      inventoryPanel:   $('inventory-panel'),
      inventoryClose:   $('inventory-close'),
      inventoryList:    $('inventory-list'),
      sceneText:        $('scene-text'),
      choicesContainer: $('choices-container'),
      itemNotification: $('item-notification'),
      itemNotifName:    $('item-notif-name'),
      itemNotifDesc:    $('item-notif-desc'),
      game:             $('game'),
    };
  },

  _bindEvents() {
    this.el.btnNew.addEventListener('click', () => this._startNew());
    this.el.btnContinue.addEventListener('click', () => this._startContinue());
    this.el.inventoryBtn.addEventListener('click', () => this._toggleInventory());
    this.el.inventoryClose.addEventListener('click', () => this._closeInventory());

    // Skip typewriter on click (ignore inventory / choice elements)
    document.addEventListener('click', e => {
      if (!this.state.isTyping) return;
      if (e.target.closest('#inventory-panel')) return;
      if (e.target.closest('#inventory-btn')) return;
      if (this._twCancel) this._twCancel();
    });

    // Skip on Space / Enter; open inventory on I
    document.addEventListener('keydown', e => {
      if ((e.key === 'i' || e.key === 'I') && !this.el.gameScreen.classList.contains('hidden')) {
        this._toggleInventory();
        return;
      }
      if (!this.state.isTyping) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (this._twCancel) this._twCancel();
      }
    });
  },

  async _loadStory(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.data = await res.json();
  },

  /* ═══════════════════════════════════════════════════════════════
     START / CONTINUE
  ═══════════════════════════════════════════════════════════════ */
  _startNew() {
    this._clearSave();
    this.state = {
      currentSceneId: this.data.startScene,
      inventory: [],
      history: [],
      isTyping: false,
    };
    this._showGame(this.data.startScene);
  },

  _startContinue() {
    if (!this._loadSave()) { this._startNew(); return; }
    this._showGame(this.state.currentSceneId);
  },

  _showGame(sceneId) {
    this.el.titleScreen.classList.add('fade-out');
    setTimeout(() => {
      this.el.titleScreen.classList.add('hidden');
      this.el.gameScreen.classList.remove('hidden');
      this.renderScene(sceneId);
    }, 370);
  },

  /* ═══════════════════════════════════════════════════════════════
     RENDER SCENE
  ═══════════════════════════════════════════════════════════════ */
  async renderScene(sceneId) {
    const scene = this.data.scenes[sceneId];
    if (!scene) { console.error('Unknown scene:', sceneId); return; }

    this.state.currentSceneId = sceneId;
    this.state.history.push(sceneId);
    this._saveState();

    // Fade out
    this.el.game.classList.add('fading');
    await this._wait(this.config.sceneFadeDur);

    // Clear
    this.el.sceneText.innerHTML = '';
    this.el.choicesContainer.classList.add('hidden');
    this.el.choicesContainer.innerHTML = '';

    // Fade in
    this.el.game.classList.remove('fading');

    // Type the prose
    await this._typewriteText(scene.text);

    // Award item if this scene has one (and player doesn't already carry it)
    if (scene.item && !this.hasItem(scene.item.id)) {
      this._addItem(scene.item);
    }

    // End of demo / story?
    if (scene.end) {
      this._renderEndOptions();
      return;
    }

    if (scene.choices?.length) {
      this._showChoices(scene.choices);
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     TYPEWRITER
  ═══════════════════════════════════════════════════════════════ */
  _typewriteText(rawText) {
    return new Promise(resolve => {
      const paragraphs = rawText
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean);

      let pIdx       = 0;
      let cIdx       = 0;
      let currentP   = null;
      let cursor     = null;
      let timer      = null;
      let inParagraph = false;
      let done       = false;

      this.state.isTyping = true;

      const finish = () => {
        this.state.isTyping = false;
        this._twCancel = null;
        done = true;
        resolve();
      };

      // Skip: immediately render all remaining text
      this._twCancel = () => {
        if (done) return;
        clearTimeout(timer);
        if (cursor?.parentNode) cursor.remove();

        // Complete current paragraph if partially typed
        if (inParagraph && pIdx < paragraphs.length) {
          currentP.textContent = paragraphs[pIdx];
          pIdx++;
          inParagraph = false;
        }

        // Append any remaining paragraphs
        while (pIdx < paragraphs.length) {
          const p = document.createElement('p');
          p.textContent = paragraphs[pIdx++];
          this.el.sceneText.appendChild(p);
        }

        finish();
      };

      const startParagraph = () => {
        if (pIdx >= paragraphs.length) { finish(); return; }

        currentP = document.createElement('p');
        cursor   = document.createElement('span');
        cursor.className = 'tw-cursor';

        this.el.sceneText.appendChild(currentP);
        currentP.appendChild(cursor);

        cIdx = 0;
        inParagraph = true;
        typeChar();
      };

      const typeChar = () => {
        const para = paragraphs[pIdx];

        if (cIdx < para.length) {
          const ch = para[cIdx++];
          currentP.insertBefore(document.createTextNode(ch), cursor);

          let delay = this.config.typeSpeed;
          if (ch === ',' || ch === ';')                       delay = this.config.commaPause;
          else if (ch === '.' || ch === '!' || ch === '?' || ch === '…') delay = this.config.punctPause;

          timer = setTimeout(typeChar, delay);
        } else {
          // Paragraph complete
          cursor.remove();
          cursor      = null;
          inParagraph = false;
          pIdx++;

          if (pIdx < paragraphs.length) {
            timer = setTimeout(startParagraph, this.config.paragraphPause);
          } else {
            finish();
          }
        }
      };

      startParagraph();
    });
  },

  /* ═══════════════════════════════════════════════════════════════
     CHOICES
  ═══════════════════════════════════════════════════════════════ */
  _showChoices(choices) {
    choices.forEach((choice, idx) => {
      const locked = choice.requires && !this.hasItem(choice.requires);

      const el = document.createElement('div');
      el.className = 'choice' + (locked ? ' locked' : '');
      el.style.animationDelay = `${idx * this.config.choiceDelay}ms`;

      const numSpan  = document.createElement('span');
      numSpan.className = 'choice-num';
      numSpan.textContent = String(idx + 1).padStart(2, '0');

      const textSpan = document.createElement('span');
      textSpan.className = 'choice-text';
      textSpan.textContent = choice.text;

      if (locked) {
        const reqNote = document.createElement('em');
        reqNote.textContent = ` [requires: ${this._resolveItemName(choice.requires)}]`;
        textSpan.appendChild(reqNote);
      }

      el.appendChild(numSpan);
      el.appendChild(textSpan);

      if (!locked) {
        el.addEventListener('click', () => this._makeChoice(choice));
      }

      this.el.choicesContainer.appendChild(el);
    });

    this.el.choicesContainer.classList.remove('hidden');
  },

  _resolveItemName(itemId) {
    const inInv = this.state.inventory.find(i => i.id === itemId);
    if (inInv) return inInv.name;
    for (const scene of Object.values(this.data.scenes)) {
      if (scene.item?.id === itemId) return scene.item.name;
    }
    return itemId;
  },

  _makeChoice(choice) {
    if (this.state.isTyping) return;

    if (choice.effects?.removeItem) {
      const ids = Array.isArray(choice.effects.removeItem)
        ? choice.effects.removeItem
        : [choice.effects.removeItem];
      ids.forEach(id => this._removeItem(id));
    }

    this.renderScene(choice.next);
  },

  /* ═══════════════════════════════════════════════════════════════
     END
  ═══════════════════════════════════════════════════════════════ */
  _renderEndOptions() {
    const wrap = document.createElement('div');
    wrap.id = 'restart-container';

    const btn = document.createElement('button');
    btn.id = 'btn-restart';
    btn.textContent = '— Begin again —';
    btn.addEventListener('click', () => {
      this._clearSave();
      location.reload();
    });

    wrap.appendChild(btn);
    this.el.sceneText.appendChild(wrap);
  },

  /* ═══════════════════════════════════════════════════════════════
     INVENTORY
  ═══════════════════════════════════════════════════════════════ */
  _addItem(item) {
    this.state.inventory.push(item);
    this._saveState();
    this._refreshInventoryUI();
    this._showItemNotification(item);
  },

  _removeItem(itemId) {
    this.state.inventory = this.state.inventory.filter(i => i.id !== itemId);
    this._saveState();
    this._refreshInventoryUI();
  },

  hasItem(itemId) {
    return this.state.inventory.some(i => i.id === itemId);
  },

  _refreshInventoryUI() {
    this.el.inventoryCount.textContent = this.state.inventory.length;

    if (!this.state.inventory.length) {
      this.el.inventoryList.innerHTML = '<p class="inv-empty">Nothing carried.</p>';
      return;
    }

    this.el.inventoryList.innerHTML = '';
    this.state.inventory.forEach(item => {
      const el = document.createElement('div');
      el.className = 'inventory-item';
      el.innerHTML = `<div class="inv-item-name">${item.name}</div>
                      <div class="inv-item-desc">${item.description}</div>`;
      this.el.inventoryList.appendChild(el);
    });
  },

  _toggleInventory() {
    const willOpen = !this.el.inventoryPanel.classList.contains('open');
    this.el.inventoryPanel.classList.toggle('open');
    this.el.inventoryPanel.setAttribute('aria-hidden', String(!willOpen));
  },

  _closeInventory() {
    this.el.inventoryPanel.classList.remove('open');
    this.el.inventoryPanel.setAttribute('aria-hidden', 'true');
  },

  /* ═══════════════════════════════════════════════════════════════
     ITEM NOTIFICATION
  ═══════════════════════════════════════════════════════════════ */
  _showItemNotification(item) {
    this.el.itemNotifName.textContent = item.name;
    this.el.itemNotifDesc.textContent = item.description;
    this.el.itemNotification.classList.add('show');

    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => {
      this.el.itemNotification.classList.remove('show');
    }, this.config.notifDuration);
  },

  /* ═══════════════════════════════════════════════════════════════
     PERSISTENCE
  ═══════════════════════════════════════════════════════════════ */
  _saveState() {
    try {
      localStorage.setItem(this.config.saveKey, JSON.stringify({
        currentSceneId: this.state.currentSceneId,
        inventory:      this.state.inventory,
        history:        this.state.history,
      }));
    } catch (_) {}
  },

  _loadSave() {
    try {
      const raw = localStorage.getItem(this.config.saveKey);
      if (!raw) return false;
      const s = JSON.parse(raw);
      this.state.currentSceneId = s.currentSceneId;
      this.state.inventory      = s.inventory || [];
      this.state.history        = s.history   || [];
      return true;
    } catch (_) {
      return false;
    }
  },

  _hasSave() {
    try { return !!localStorage.getItem(this.config.saveKey); } catch (_) { return false; }
  },

  _clearSave() {
    try { localStorage.removeItem(this.config.saveKey); } catch (_) {}
  },

  /* ═══════════════════════════════════════════════════════════════
     UTILITY
  ═══════════════════════════════════════════════════════════════ */
  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
