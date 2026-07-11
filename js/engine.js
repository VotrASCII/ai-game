'use strict';

const Game = {

  /* ── Config ──────────────────────────────────────────────────── */
  config: {
    typeSpeed:      26,
    commaPause:     90,
    punctPause:     240,
    paragraphPause: 440,
    choiceDelay:    160,
    sceneFadeDur:   220,
    notifDuration:  3800,
    progressKey:    'textgame_progress',
  },

  /* ── Runtime state ───────────────────────────────────────────── */
  state: {
    currentSceneId:   null,
    inventory:        [],
    history:          [],
    isTyping:         false,
    skills:           {},
    skillPoints:      0,
    waypointsClaimed: [],
  },

  /* ── Story data ──────────────────────────────────────────────── */
  manifest:          null,
  data:              { scenes: {}, startScene: 'start' },
  currentChapterId:  null,

  /* ── Progress ────────────────────────────────────────────────── */
  _progress: { chapters: {}, currentChapterId: null },

  /* ── DOM refs ────────────────────────────────────────────────── */
  el: {},

  /* ── Internal handles ────────────────────────────────────────── */
  _twCancel:      null,
  _notifTimer:    null,
  _currentScreen: 'library',

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */
  async init() {
    this._cacheDOM();
    this._bindEvents();

    try {
      const res = await fetch('stories.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.library = (await res.json()).stories;
    } catch (e) {
      console.error('Failed to load story library:', e);
      document.body.innerHTML = '<p style="color:#666;padding:4rem;font-family:monospace">Could not load stories.</p>';
      return;
    }

    this._buildStoryList();
    document.getElementById('page-title').textContent = 'Stories';

    /* A ?story= link still opens that story directly. */
    const param = new URLSearchParams(location.search).get('story');
    const direct = param && this.library.find(s => s.dir === param);
    if (direct) {
      await this._selectStory(direct, { instant: true });
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     LIBRARY (story select)
  ═══════════════════════════════════════════════════════════════ */
  _progressKeyFor(story) {
    return story.dir === 'story' ? 'textgame_progress' : `textgame_progress_${story.dir}`;
  },

  _storyHasProgress(story) {
    try {
      const raw = localStorage.getItem(this._progressKeyFor(story));
      if (!raw) return false;
      return Object.keys(JSON.parse(raw)?.chapters || {}).length > 0;
    } catch (_) {
      return false;
    }
  },

  _buildStoryList() {
    this.el.storyList.innerHTML = '';

    this.library.forEach(story => {
      const started = this._storyHasProgress(story);

      const tile = document.createElement('div');
      tile.className = 'story-tile';

      const info = document.createElement('div');
      info.className = 'story-info';

      const title = document.createElement('div');
      title.className = 'story-title-text';
      title.textContent = story.title;

      const subtitle = document.createElement('div');
      subtitle.className = 'story-subtitle';
      subtitle.textContent = story.subtitle;

      const blurb = document.createElement('div');
      blurb.className = 'story-blurb';
      blurb.textContent = story.blurb;

      info.appendChild(title);
      info.appendChild(subtitle);
      info.appendChild(blurb);

      const badge = document.createElement('span');
      badge.className = 'story-badge' + (started ? ' in-progress' : '');
      badge.textContent = started ? 'in progress' : `${story.chapters} chapters`;

      tile.appendChild(info);
      tile.appendChild(badge);
      tile.addEventListener('click', () => this._selectStory(story));

      this.el.storyList.appendChild(tile);
    });
  },

  async _selectStory(story, opts = {}) {
    this.storyDir           = story.dir;
    this.config.progressKey = this._progressKeyFor(story);

    /* Reset all per-story runtime state before loading the new manifest. */
    this.manifest         = null;
    this.data             = { scenes: {}, startScene: 'start' };
    this.currentChapterId = null;
    this.state            = this._freshState(null);
    this._loadProgress();

    try {
      const res = await fetch(`${this.storyDir}/manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = await res.json();
    } catch (e) {
      console.error('Failed to load manifest:', e);
      return;
    }

    document.getElementById('page-title').textContent = this.manifest.title;
    this.el.gameTitle.textContent    = this.manifest.title;
    this.el.gameSubtitle.textContent = this.manifest.subtitle;
    this.el.btnContinue.classList.toggle('hidden', !this._hasProgress());

    this._stageTitleReveal();

    if (opts.instant) {
      this.el.libraryScreen.classList.add('hidden');
      this.el.titleScreen.classList.remove('hidden');
      this._currentScreen = 'title';
    } else {
      await this._transitionTo('title');
    }

    this._playTitleReveal();
  },

  _cacheDOM() {
    const $ = id => document.getElementById(id);
    this.el = {
      libraryScreen:    $('library-screen'),
      storyList:        $('story-list'),
      btnTitleBack:     $('btn-title-back'),
      btnGameBack:      $('btn-game-back'),
      titleEyebrow:     $('title-eyebrow'),
      titleActions:     $('title-actions'),
      titleScreen:      $('title-screen'),
      chapterScreen:    $('chapter-screen'),
      previouslyScreen: $('previously-screen'),
      gameScreen:       $('game-screen'),
      chapterCard:      $('chapter-card'),
      chapterCardNum:   $('chapter-card-numeral'),
      chapterCardTitle: $('chapter-card-title'),
      gameTitle:        $('game-title'),
      gameSubtitle:     $('game-subtitle'),
      btnNew:           $('btn-new'),
      btnContinue:      $('btn-continue'),
      btnChapterBack:   $('btn-chapter-back'),
      btnPrevBack:      $('btn-prev-back'),
      chapterList:      $('chapter-list'),
      prevChapterLabel: $('prev-chapter-label'),
      prevChapterText:  $('prev-chapter-text'),
      prevActions:      $('prev-actions'),
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
    this.el.btnTitleBack.addEventListener('click',   () => this._backToLibrary());
    this.el.btnGameBack.addEventListener('click',    () => this._leaveGame());
    this.el.btnNew.addEventListener('click',         () => this._startFresh());
    this.el.btnContinue.addEventListener('click',    () => { this._clearTitleReveal(); this._transitionTo('chapter'); });
    this.el.btnChapterBack.addEventListener('click', () => this._transitionTo('title'));
    this.el.btnPrevBack.addEventListener('click',    () => this._transitionTo('chapter'));

    this.el.inventoryBtn.addEventListener('click',   () => this._toggleInventory());
    this.el.inventoryClose.addEventListener('click', () => this._closeInventory());

    document.addEventListener('click', e => {
      if (!this.state.isTyping) return;
      if (e.target.closest('#inventory-panel')) return;
      if (e.target.closest('#inventory-btn')) return;
      if (this._twCancel) this._twCancel();
    });

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

  /* ═══════════════════════════════════════════════════════════════
     CHAPTER CARD
  ═══════════════════════════════════════════════════════════════ */
  async _showChapterCard(ch) {
    const { chapterCard, chapterCardNum, chapterCardTitle } = this.el;

    chapterCardNum.textContent   = ch.numeral;
    chapterCardTitle.textContent = ch.title;
    chapterCardNum.classList.remove('card-enter');
    chapterCardTitle.classList.remove('card-enter');

    chapterCard.classList.remove('hidden');
    await this._wait(30);
    chapterCard.classList.add('card-visible');

    await this._wait(100);
    chapterCardNum.classList.add('card-enter');
    chapterCardTitle.classList.add('card-enter');

    await this._wait(2300);

    chapterCardNum.classList.remove('card-enter');
    chapterCardTitle.classList.remove('card-enter');
    chapterCard.classList.remove('card-visible');
    await this._wait(700);
    chapterCard.classList.add('hidden');
  },

  /* ═══════════════════════════════════════════════════════════════
     SCREEN TRANSITIONS
  ═══════════════════════════════════════════════════════════════ */
  async _backToLibrary() {
    this._clearTitleReveal();
    this._buildStoryList();
    document.getElementById('page-title').textContent = 'Stories';
    await this._transitionTo('library');
  },

  /* Leave a scene mid-play. The chapter state is already saved on every
     scene render, so this only has to stop what's still animating. */
  async _leaveGame() {
    if (this._twCancel) this._twCancel();
    clearTimeout(this._notifTimer);
    this.el.itemNotification.classList.remove('show');
    this._closeInventory();
    await this._backToLibrary();
  },

  /* ═══════════════════════════════════════════════════════════════
     TITLE REVEAL
  ═══════════════════════════════════════════════════════════════ */
  _revealTimers: [],

  _clearTitleReveal() {
    this._revealTimers.forEach(clearTimeout);
    this._revealTimers = [];
    this.el.titleScreen.classList.remove('revealing');
    this._revealEls().forEach(el => el.classList.remove('reveal-in'));
  },

  _revealEls() {
    return [...this.el.titleScreen.querySelectorAll('.reveal-el')];
  },

  /* Hide the title elements before the screen fades in, so nothing
     flashes at full opacity ahead of its cue. */
  _stageTitleReveal() {
    this._clearTitleReveal();
    this.el.titleScreen.classList.add('revealing');
    void this.el.titleScreen.offsetWidth;   // commit the staged state
  },

  _playTitleReveal() {
    const cues = [
      [this.el.titleEyebrow,   0],
      [this.el.gameTitle,      420],
      [this.el.gameSubtitle,   1750],
      [this.el.titleActions,   2750],
      [this.el.btnTitleBack,   2950],
    ];

    cues.forEach(([el, delay]) => {
      this._revealTimers.push(setTimeout(() => el.classList.add('reveal-in'), delay));
    });

    /* Once everything has landed, drop the staging class so later visits
       to this screen (from chapter select) render instantly. */
    this._revealTimers.push(setTimeout(() => {
      this.el.titleScreen.classList.remove('revealing');
      this._revealEls().forEach(el => el.classList.remove('reveal-in'));
    }, 5200));
  },

  async _transitionTo(screen, opts = {}) {
    const screens = {
      library:    this.el.libraryScreen,
      title:      this.el.titleScreen,
      chapter:    this.el.chapterScreen,
      previously: this.el.previouslyScreen,
      game:       this.el.gameScreen,
    };

    if (screen === 'chapter')    this._buildChapterList();
    if (screen === 'previously') this._buildPreviouslyCard(opts.chId);

    const fromEl = screens[this._currentScreen];
    const toEl   = screens[screen];

    fromEl.classList.add('fade-out');
    await this._wait(350);
    fromEl.classList.add('hidden');
    fromEl.classList.remove('fade-out');

    if (opts.chapterCard) {
      await this._showChapterCard(opts.chapterCard);
    }

    toEl.classList.remove('hidden');
    this._currentScreen = screen;

    if (screen === 'game' && opts.sceneId) {
      this.renderScene(opts.sceneId);
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     CHAPTER SELECT SCREEN
  ═══════════════════════════════════════════════════════════════ */
  _buildChapterList() {
    this.el.chapterList.innerHTML = '';

    this.manifest.chapters.forEach(ch => {
      const prog        = this._getChapterProgress(ch.id);
      const isUnlocked  = !!prog;
      const isCompleted = prog?.status === 'complete';

      const tile = document.createElement('div');
      tile.className = 'chapter-tile' + (!isUnlocked ? ' locked' : '');

      const numeral = document.createElement('span');
      numeral.className = 'chapter-numeral';
      numeral.textContent = ch.numeral;

      const info = document.createElement('div');
      info.className = 'chapter-info';

      const title = document.createElement('div');
      title.className = 'chapter-title-text';
      title.textContent = ch.title;

      const teaser = document.createElement('div');
      teaser.className = 'chapter-teaser';
      teaser.textContent = isUnlocked ? ch.teaser : '—';

      info.appendChild(title);
      info.appendChild(teaser);

      const badge = document.createElement('span');
      badge.className = 'chapter-badge';
      if (isCompleted)     badge.textContent = '✓';
      else if (isUnlocked) badge.textContent = '●';

      tile.appendChild(numeral);
      tile.appendChild(info);
      tile.appendChild(badge);

      if (isUnlocked) {
        tile.addEventListener('click', () => this._onChapterTileClick(ch, isCompleted));
      }

      this.el.chapterList.appendChild(tile);
    });
  },

  async _onChapterTileClick(ch, isCompleted) {
    if (isCompleted) {
      await this._transitionTo('previously', { chId: ch.id });
      return;
    }

    const prog = this._getChapterProgress(ch.id);
    await this._loadChapterData(ch);

    if (prog?.save?.currentSceneId) {
      this._restoreState(prog.save);
      await this._transitionTo('game', { sceneId: prog.save.currentSceneId });
    } else {
      this._startChapterFresh(ch);
      await this._transitionTo('game', { sceneId: ch.startScene, chapterCard: ch });
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     PREVIOUSLY SCREEN
  ═══════════════════════════════════════════════════════════════ */
  _buildPreviouslyCard(chId) {
    const ch     = this.manifest.chapters.find(c => c.id === chId);
    const prog   = this._getChapterProgress(chId);
    const invIds = (prog?.completedInventory || []).map(i => i.id);

    this.el.prevChapterLabel.textContent = `Chapter ${ch.numeral} · ${ch.title}`;

    let summaryText = '';
    const summaries = ch.summaries || [];
    for (const s of summaries) {
      if (!s.requires || s.requires.every(id => invIds.includes(id))) {
        summaryText = s.text;
        break;
      }
    }
    if (!summaryText && summaries.length) summaryText = summaries[summaries.length - 1].text;
    this.el.prevChapterText.textContent = summaryText;

    this.el.prevActions.innerHTML = '';

    const idx    = this.manifest.chapters.findIndex(c => c.id === chId);
    const nextCh = this.manifest.chapters[idx + 1];

    if (nextCh && this._getChapterProgress(nextCh.id)) {
      const btn = document.createElement('button');
      btn.className = 'btn-prev-action';
      btn.textContent = `Continue — Chapter ${nextCh.numeral}: ${nextCh.title}`;
      btn.addEventListener('click', async () => {
        const nextProg = this._getChapterProgress(nextCh.id);
        await this._loadChapterData(nextCh);
        if (nextProg?.save?.currentSceneId) {
          this._restoreState(nextProg.save);
          await this._transitionTo('game', { sceneId: nextProg.save.currentSceneId });
        } else {
          this._startChapterFresh(nextCh);
          await this._transitionTo('game', { sceneId: nextCh.startScene, chapterCard: nextCh });
        }
      });
      this.el.prevActions.appendChild(btn);
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     START / LOAD CHAPTER
  ═══════════════════════════════════════════════════════════════ */
  async _startFresh() {
    this._clearTitleReveal();
    this._clearProgress();
    const ch1 = this.manifest.chapters[0];
    this._initChapterProgress(ch1.id);
    await this._loadChapterData(ch1);
    this._startChapterFresh(ch1);
    this.el.btnContinue.classList.add('hidden');
    await this._transitionTo('game', { sceneId: ch1.startScene, chapterCard: ch1 });
  },

  _freshState(startScene) {
    return {
      currentSceneId:   startScene,
      inventory:        [],
      history:          [],
      isTyping:         false,
      skills:           {},
      skillPoints:      0,
      waypointsClaimed: [],
    };
  },

  /* Transfer persistent items and skills from the previous chapter's completed state */
  _startChapterFresh(ch) {
    const idx  = this.manifest.chapters.findIndex(c => c.id === ch.id);
    const next = this._freshState(ch.startScene);

    if (idx > 0) {
      const prevCh   = this.manifest.chapters[idx - 1];
      const prevProg = this._getChapterProgress(prevCh.id);
      if (prevProg?.completedInventory) {
        prevProg.completedInventory
          .filter(i => i.persistent)
          .forEach(i => next.inventory.push(i));
      }
      if (prevProg?.completedSkills)      next.skills           = { ...prevProg.completedSkills };
      if (prevProg?.completedSkillPoints) next.skillPoints      = prevProg.completedSkillPoints;
      if (prevProg?.completedWaypoints)   next.waypointsClaimed = [...prevProg.completedWaypoints];
    }

    this.state = next;
    this._refreshInventoryUI();
  },

  async _loadChapterData(ch) {
    const res = await fetch(ch.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.data             = await res.json();
    this.currentChapterId = ch.id;
    if (!this._getChapterProgress(ch.id)) this._initChapterProgress(ch.id);
  },

  _restoreState(save) {
    this.state = {
      currentSceneId:   save.currentSceneId,
      inventory:        save.inventory        || [],
      history:          save.history          || [],
      isTyping:         false,
      skills:           save.skills           || {},
      skillPoints:      save.skillPoints      || 0,
      waypointsClaimed: save.waypointsClaimed || [],
    };
    this._refreshInventoryUI();
  },

  /* ═══════════════════════════════════════════════════════════════
     RENDER SCENE
  ═══════════════════════════════════════════════════════════════ */
  async renderScene(sceneId) {
    const scene = this.data.scenes[sceneId];
    if (!scene) { console.error('Unknown scene:', sceneId); return; }

    this.state.currentSceneId = sceneId;
    this.state.history.push(sceneId);
    this._saveChapterState();

    this.el.game.classList.add('fading');
    await this._wait(this.config.sceneFadeDur);

    this.el.sceneText.innerHTML = '';
    this.el.choicesContainer.classList.add('hidden');
    this.el.choicesContainer.innerHTML = '';

    this.el.game.classList.remove('fading');

    await this._typewriteText(scene.text);

    if (scene.item && !this.hasItem(scene.item.id)) {
      this._addItem(scene.item);
    }

    if (scene.waypoint) {
      const key = `${this.currentChapterId}:${sceneId}`;
      if (!this.state.waypointsClaimed.includes(key)) {
        await this._runWaypoint(scene.waypoint, key);
      }
    }

    if (scene.end) {
      this._onChapterEnd();
      return;
    }

    if (scene.choices?.length) {
      this._showChoices(scene.choices);
    }
  },

  /* ═══════════════════════════════════════════════════════════════
     CHAPTER END
  ═══════════════════════════════════════════════════════════════ */
  _onChapterEnd() {
    const chId   = this.currentChapterId;
    const chIdx  = this.manifest.chapters.findIndex(c => c.id === chId);
    const nextCh = this.manifest.chapters[chIdx + 1] || null;

    this._progress.chapters[chId].status               = 'complete';
    this._progress.chapters[chId].completedInventory   = [...this.state.inventory];
    this._progress.chapters[chId].completedSkills      = { ...this.state.skills };
    this._progress.chapters[chId].completedSkillPoints = this.state.skillPoints;
    this._progress.chapters[chId].completedWaypoints   = [...this.state.waypointsClaimed];
    if (nextCh) this._initChapterProgress(nextCh.id);
    this._saveProgress();

    this.el.btnContinue.classList.remove('hidden');

    const wrap = document.createElement('div');
    wrap.id = 'chapter-end-container';

    if (nextCh) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn-chapter-end-next';
      nextBtn.textContent = `Begin Chapter ${nextCh.numeral}: ${nextCh.title}`;
      nextBtn.addEventListener('click', async () => {
        await this._loadChapterData(nextCh);
        this._startChapterFresh(nextCh);
        this.el.sceneText.innerHTML = '';
        this.el.choicesContainer.innerHTML = '';
        await this._showChapterCard(nextCh);
        this.renderScene(nextCh.startScene);
      });
      wrap.appendChild(nextBtn);
    }

    const chapBtn = document.createElement('button');
    chapBtn.className = 'btn-chapter-end-list';
    chapBtn.textContent = '← All chapters';
    chapBtn.addEventListener('click', async () => {
      this._currentScreen = 'game';
      await this._transitionTo('chapter');
    });
    wrap.appendChild(chapBtn);

    this.el.sceneText.appendChild(wrap);
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

      let pIdx        = 0;
      let cIdx        = 0;
      let currentP    = null;
      let cursor      = null;
      let timer       = null;
      let inParagraph = false;
      let done        = false;

      this.state.isTyping = true;

      const finish = () => {
        this.state.isTyping = false;
        this._twCancel = null;
        done = true;
        resolve();
      };

      this._twCancel = () => {
        if (done) return;
        clearTimeout(timer);
        if (cursor?.parentNode) cursor.remove();

        if (inParagraph && pIdx < paragraphs.length) {
          currentP.textContent = paragraphs[pIdx];
          pIdx++;
          inParagraph = false;
        }

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
          if (ch === ',' || ch === ';')                                  delay = this.config.commaPause;
          else if (ch === '.' || ch === '!' || ch === '?' || ch === '…') delay = this.config.punctPause;

          timer = setTimeout(typeChar, delay);
        } else {
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
    let shown = 0;
    choices.forEach(choice => {
      const itemLocked  = choice.requires && !this.hasItem(choice.requires);
      const countLocked = choice.requiresCount &&
        choice.requiresCount.of.filter(id => this.hasItem(id)).length < choice.requiresCount.min;
      const skillLocked = choice.skillRequires && !this._meetsSkills(choice.skillRequires);
      const locked      = itemLocked || countLocked || skillLocked;

      /* Hidden-thread choices: silently absent unless unlocked. */
      if (locked && choice.hideLocked) return;

      const idx = shown++;

      const el = document.createElement('div');
      el.className = 'choice' + (locked ? ' locked' : '');
      el.style.animationDelay = `${idx * this.config.choiceDelay}ms`;

      const numSpan = document.createElement('span');
      numSpan.className = 'choice-num';
      numSpan.textContent = String(idx + 1).padStart(2, '0');

      const textSpan = document.createElement('span');
      textSpan.className = 'choice-text';
      textSpan.textContent = choice.text;

      if (choice.skillRequires) {
        const tag = document.createElement('em');
        tag.className = 'choice-skill-tag';
        tag.textContent = ` [${Object.entries(choice.skillRequires)
          .map(([id, rank]) => `${this._skillName(id)} ${rank}`).join(', ')}]`;
        textSpan.appendChild(tag);
      }

      if (itemLocked) {
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
    this.renderScene(choice.next);
  },

  /* ═══════════════════════════════════════════════════════════════
     SKILLS
  ═══════════════════════════════════════════════════════════════ */
  skillRank(skillId) {
    return this.state.skills[skillId] || 0;
  },

  _meetsSkills(reqs) {
    return Object.entries(reqs).every(([id, rank]) => this.skillRank(id) >= rank);
  },

  _skillDefs() {
    return this.manifest?.skills || [];
  },

  _skillName(skillId) {
    return this._skillDefs().find(s => s.id === skillId)?.name || skillId;
  },

  _skillMax() {
    return this.manifest?.skillMax || 5;
  },

  /* Waypoint: award points and let the player allocate them. Resolves
     when the allocation is confirmed; unspent points carry forward. */
  _runWaypoint(waypoint, key) {
    return new Promise(resolve => {
      const defs    = this._skillDefs();
      const max     = this._skillMax();
      const alloc   = {};
      defs.forEach(d => { alloc[d.id] = 0; });
      let remaining = (waypoint.points || 0) + this.state.skillPoints;

      const panel = document.createElement('div');
      panel.className = 'waypoint-panel';

      const header = document.createElement('div');
      header.className = 'waypoint-header';
      header.textContent = waypoint.label || 'Waypoint';
      panel.appendChild(header);

      const ptsLine = document.createElement('div');
      ptsLine.className = 'waypoint-points';
      panel.appendChild(ptsLine);

      const rows = [];

      const refresh = () => {
        ptsLine.textContent = `${remaining} point${remaining === 1 ? '' : 's'} to spend`;
        rows.forEach(({ def, dots, minus, plus }) => {
          const base  = this.skillRank(def.id);
          const total = base + alloc[def.id];
          dots.forEach((dot, i) => {
            dot.className = 'wp-dot' +
              (i < base ? ' filled' : i < total ? ' pending' : '');
          });
          minus.disabled = alloc[def.id] === 0;
          plus.disabled  = remaining === 0 || total >= max;
        });
        confirmBtn.textContent = remaining > 0
          ? `Confirm (${remaining} unspent — carried forward)`
          : 'Confirm';
      };

      defs.forEach(def => {
        const row = document.createElement('div');
        row.className = 'waypoint-row';

        const name = document.createElement('div');
        name.className = 'wp-skill-name';
        name.textContent = def.name;
        name.title = def.desc || '';

        const desc = document.createElement('div');
        desc.className = 'wp-skill-desc';
        desc.textContent = def.desc || '';

        const controls = document.createElement('div');
        controls.className = 'wp-controls';

        const minus = document.createElement('button');
        minus.className = 'wp-btn';
        minus.textContent = '−';
        minus.addEventListener('click', () => {
          if (alloc[def.id] > 0) { alloc[def.id]--; remaining++; refresh(); }
        });

        const dotWrap = document.createElement('div');
        dotWrap.className = 'wp-dots';
        const dots = [];
        for (let i = 0; i < max; i++) {
          const dot = document.createElement('span');
          dot.className = 'wp-dot';
          dotWrap.appendChild(dot);
          dots.push(dot);
        }

        const plus = document.createElement('button');
        plus.className = 'wp-btn';
        plus.textContent = '+';
        plus.addEventListener('click', () => {
          if (remaining > 0 && this.skillRank(def.id) + alloc[def.id] < max) {
            alloc[def.id]++; remaining--; refresh();
          }
        });

        controls.appendChild(minus);
        controls.appendChild(dotWrap);
        controls.appendChild(plus);

        const left = document.createElement('div');
        left.className = 'wp-skill-info';
        left.appendChild(name);
        left.appendChild(desc);

        row.appendChild(left);
        row.appendChild(controls);
        panel.appendChild(row);

        rows.push({ def, dots, minus, plus });
      });

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'wp-confirm';
      confirmBtn.addEventListener('click', () => {
        defs.forEach(def => {
          if (alloc[def.id] > 0) {
            this.state.skills[def.id] = this.skillRank(def.id) + alloc[def.id];
          }
        });
        this.state.skillPoints = remaining;
        this.state.waypointsClaimed.push(key);
        this._saveChapterState();
        this._refreshInventoryUI();
        panel.remove();
        resolve();
      });
      panel.appendChild(confirmBtn);

      refresh();
      this.el.sceneText.appendChild(panel);
      requestAnimationFrame(() => panel.classList.add('wp-visible'));
    });
  },

  /* ═══════════════════════════════════════════════════════════════
     INVENTORY
  ═══════════════════════════════════════════════════════════════ */
  _addItem(item) {
    this.state.inventory.push(item);
    this._saveChapterState();
    this._refreshInventoryUI();
    if (!item.silent) this._showItemNotification(item);
  },

  hasItem(itemId) {
    return this.state.inventory.some(i => i.id === itemId);
  },

  _refreshInventoryUI() {
    const visible = this.state.inventory.filter(i => !i.silent);
    this.el.inventoryCount.textContent = visible.length;
    this.el.inventoryList.innerHTML = '';

    const defs = this._skillDefs();
    if (defs.length) {
      const block = document.createElement('div');
      block.className = 'inv-skills';
      const label = document.createElement('div');
      label.className = 'inv-skills-label';
      label.textContent = 'Skills';
      block.appendChild(label);
      defs.forEach(def => {
        const row = document.createElement('div');
        row.className = 'inv-skill-row';
        const rank = this.skillRank(def.id);
        const dots = Array.from({ length: this._skillMax() },
          (_, i) => `<span class="wp-dot${i < rank ? ' filled' : ''}"></span>`).join('');
        row.innerHTML = `<span class="inv-skill-name">${def.name}</span>
                         <span class="wp-dots">${dots}</span>`;
        block.appendChild(row);
      });
      this.el.inventoryList.appendChild(block);
    }

    if (!visible.length) {
      const p = document.createElement('p');
      p.className = 'inv-empty';
      p.textContent = 'Nothing carried.';
      this.el.inventoryList.appendChild(p);
      return;
    }

    visible.forEach(item => {
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
     PROGRESS PERSISTENCE
  ═══════════════════════════════════════════════════════════════ */
  _loadProgress() {
    this._progress = null;
    try {
      const raw = localStorage.getItem(this.config.progressKey);
      if (raw) this._progress = JSON.parse(raw);
    } catch (_) {}
    if (!this._progress?.chapters) this._progress = { chapters: {}, currentChapterId: null };
  },

  _saveProgress() {
    try { localStorage.setItem(this.config.progressKey, JSON.stringify(this._progress)); } catch (_) {}
  },

  _clearProgress() {
    this._progress = { chapters: {}, currentChapterId: null };
    try { localStorage.removeItem(this.config.progressKey); } catch (_) {}
  },

  _hasProgress() {
    return Object.keys(this._progress?.chapters || {}).length > 0;
  },

  _initChapterProgress(chId) {
    if (!this._progress.chapters[chId]) {
      this._progress.chapters[chId] = { status: 'active', save: null, completedInventory: null };
      this._progress.currentChapterId = chId;
      this._saveProgress();
    }
  },

  _getChapterProgress(chId) {
    return this._progress.chapters[chId] || null;
  },

  _saveChapterState() {
    if (!this.currentChapterId) return;
    const ch = this._progress.chapters[this.currentChapterId];
    if (!ch) return;
    ch.save = {
      currentSceneId:   this.state.currentSceneId,
      inventory:        this.state.inventory,
      history:          this.state.history,
      skills:           this.state.skills,
      skillPoints:      this.state.skillPoints,
      waypointsClaimed: this.state.waypointsClaimed,
    };
    this._progress.currentChapterId = this.currentChapterId;
    this._saveProgress();
  },

  /* ═══════════════════════════════════════════════════════════════
     UTILITY
  ═══════════════════════════════════════════════════════════════ */
  _wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
