import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CACHE_BUSTER = '?v=' + Date.now();

/* =========================================================
   CONFIG
   ========================================================= */
const CONFIG = {
  models: {
    saluda:   'models/miku_saluda.glb'   + CACHE_BUSTER,
    sentada:  'models/miku_sentada.glb'  + CACHE_BUSTER,
    agradece: 'models/miku_agradece.glb' + CACHE_BUSTER,
    timida:   'models/miku_timida.glb'   + CACHE_BUSTER,
  },
  defaultPose: 'saluda',
  scale: 0.01,
  autoHideAfter: 12,
  autoPeekInterval: 25,
  rotY: 0,
  // ⚡ PERFORMANCE
  maxFPS: 60,               // límite de FPS (monitor 144Hz no fuerza 144)
  maxPixelRatio: 1.5,       // 1.5 en vez de 2 (menos carga en 4K/Retina)
  renderScale: 1.0,         // escala de renderizado (0.8 = más rápido, menos calidad)
};

const STEP = { move: 0.05, rotate: 0.1, scale: 0.001 };

const AUDIO_ORDER = [
  'presentacion', 'hace_dias', 'llueve', 'saludo4', 'hace_1_dia',
  'saludo', 'noche', 'saludo2', 'calor', 'saludo3',
];

/* =========================================================
   AUDIO
   ========================================================= */
const Audio = {
  volume: 0.8,
  enabled: localStorage.getItem('animate_voice') !== 'off',
  cache: {},
  current: null,
  loadedList: [],
  failedList: [],

  candidates: {
    presentacion: ['audios/presentacion.mp3', 'audios/presentacionmp3'],
    hace_dias:    ['audios/hace_dias.mp3', 'audios/hace_diasmp3'],
    llueve:       ['audios/llueve.mp3', 'audios/lluevemp3'],
    saludo4:      ['audios/saludo4.mp3'],
    hace_1_dia:   ['audios/hace_1_dia.mp3'],
    saludo:       ['audios/saludo.mp3', 'audios/saludomp3'],
    noche:        ['audios/noche.mp3', 'audios/nochemp3'],
    saludo2:      ['audios/saludo2.mp3'],
    calor:        ['audios/calor.mp3'],
    saludo3:      ['audios/saludo3.mp3'],
  },

  sequenceRunning: false,
  sequenceIndex: 0,

  tryLoad(key) {
    const paths = this.candidates[key];
    if (!paths) return;
    let index = 0;
    const tryNext = () => {
      if (index >= paths.length) {
        if (!this.failedList.includes(key)) { this.failedList.push(key); updateAudioDebugList(); }
        return;
      }
      const testAudio = new window.Audio();
      testAudio.preload = 'auto';
      testAudio.volume = this.volume;
      let resolved = false;
      const onSuccess = () => {
        if (resolved) return;
        resolved = true;
        this.cache[key] = testAudio;
        if (!this.loadedList.includes(key)) this.loadedList.push(key);
        updateAudioDebugList();
      };
      const onFail = () => {
        if (resolved) return;
        resolved = true;
        index++;
        tryNext();
      };
      testAudio.addEventListener('canplaythrough', onSuccess, { once: true });
      testAudio.addEventListener('loadeddata', onSuccess, { once: true });
      testAudio.addEventListener('error', onFail, { once: true });
      setTimeout(() => { if (!resolved) testAudio.readyState >= 2 ? onSuccess() : onFail(); }, 800);
      testAudio.src = paths[index] + CACHE_BUSTER;
      testAudio.load();
    };
    tryNext();
  },

  preload() {
    this.loadedList = [];
    this.failedList = [];
    this.cache = {};
    Object.keys(this.candidates).forEach((key) => this.tryLoad(key));
  },

  playOnce(key) {
    return new Promise((resolve) => {
      if (!this.enabled) { resolve(); return; }
      const audio = this.cache[key];
      if (!audio) { resolve(); return; }
      if (this.current && !this.current.paused) {
        this.current.pause();
        this.current.currentTime = 0;
      }
      audio.currentTime = 0;
      audio.volume = this.volume;
      this.current = audio;
      const onEnded = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onEnded);
        resolve();
      };
      audio.addEventListener('ended', onEnded, { once: true });
      audio.addEventListener('error', onEnded, { once: true });
      const p = audio.play();
      if (p) p.then(() => updateVoiceStatus(key)).catch(() => onEnded());
      else updateVoiceStatus(key);
    });
  },

  async playAllInOrder() {
    if (this.sequenceRunning) { this.stopSequence(); return; }
    this.sequenceRunning = true;
    this.sequenceIndex = 0;
    updatePlayAllButton();
    for (let i = 0; i < AUDIO_ORDER.length; i++) {
      if (!this.sequenceRunning) break;
      this.sequenceIndex = i + 1;
      updatePlayAllButton();
      const key = AUDIO_ORDER[i];
      if (!this.cache[key]) continue;
      await this.playOnce(key);
      await new Promise(r => setTimeout(r, 200));
    }
    this.sequenceRunning = false;
    updatePlayAllButton();
    updateVoiceStatus(null);
  },

  stopSequence() {
    this.sequenceRunning = false;
    this.sequenceIndex = 0;
    if (this.current) {
      this.current.pause();
      this.current.currentTime = 0;
      this.current = null;
    }
    updatePlayAllButton();
    updateVoiceStatus(null);
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('animate_voice', this.enabled ? 'on' : 'off');
    if (!this.enabled && this.current) {
      this.current.pause();
      this.current.currentTime = 0;
      this.current = null;
      updateVoiceStatus(null);
      this.stopSequence();
    }
    return this.enabled;
  },
};

/* =========================================================
   THREE.JS
   ========================================================= */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
  premultipliedAlpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

// ⚡ Solo 2 luces (antes 4) → 50% menos cálculo
scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const keyLight = new THREE.DirectionalLight(0xffeedd, 1.6);
keyLight.position.set(2, 3, 4);
scene.add(keyLight);

/* =========================================================
   UI refs
   ========================================================= */
const $ = (id) => document.getElementById(id);
const loadingBar = $('loading-bar');
const loadingStatus = $('loading-status');
const loaderSub = $('loader-sub');
const loaderEl = $('cyber-loader');
const toastEl = $('toast');
const voiceStatusEl = $('voice-status');
const voiceToggleBtn = $('voice-toggle');
const audioDebugBtn = $('audio-debug-btn');
const audioDebugList = $('audio-debug-list');
const playAllBtn = $('play-all-btn');
const dbgPos = $('dbg-pos');
const dbgRot = $('dbg-rot');
const dbgScale = $('dbg-scale');
const dbgPose = $('dbg-pose');
const dbgAnim = $('dbg-anim');

const panelEl = $('control-panel');
const panelOpenBtn = $('panel-open-btn');
const panelCloseBtn = $('panel-close-btn');

const creditsModal = $('credits-modal');
const creditsBtn = $('credits-btn');
const closeCreditsBtn = $('close-credits');
const startBtn = $('start-btn');
const dontShowAgain = $('dont-show-again');

const exitEl = $('exit-btn');

/* =========================================================
   HELPERS
   ========================================================= */
function updateLoading(pct, text, sub) {
  if (loadingBar) loadingBar.style.width = pct + '%';
  if (loadingStatus && text) loadingStatus.textContent = text;
  if (loaderSub && sub) loaderSub.textContent = sub;
}

let toastTimer = null;
function showToast(msg, ms = 2000) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), ms);
}

function updateVoiceStatus(key) {
  if (!voiceStatusEl) return;
  if (!Audio.enabled) voiceStatusEl.textContent = '🔇 Voz desactivada';
  else if (key) voiceStatusEl.textContent = `▶ ${key}`;
  else voiceStatusEl.textContent = 'Reproduciendo: —';
}

function updateVoiceButton() {
  if (!voiceToggleBtn) return;
  voiceToggleBtn.textContent = Audio.enabled ? '🔊 VOZ ON' : '🔇 VOZ OFF';
  voiceToggleBtn.classList.toggle('off', !Audio.enabled);
  updateVoiceStatus(null);
}

function updatePlayAllButton() {
  if (!playAllBtn) return;
  if (Audio.sequenceRunning) {
    playAllBtn.textContent = `⏹ DETENER (${Audio.sequenceIndex}/${AUDIO_ORDER.length})`;
    playAllBtn.classList.add('playing');
  } else {
    playAllBtn.textContent = '🎤 HABLAR TODO';
    playAllBtn.classList.remove('playing');
  }
}

function updateAudioDebugList() {
  if (!audioDebugList) return;
  let html = '';
  AUDIO_ORDER.forEach((key) => {
    if (Audio.loadedList.includes(key)) html += `<div class="audio-item ok">✅ ${key}</div>`;
    else if (Audio.failedList.includes(key)) html += `<div class="audio-item fail">❌ ${key}</div>`;
    else html += `<div class="audio-item">⏳ ${key}</div>`;
  });
  audioDebugList.innerHTML = html;
}

/* =========================================================
   CARGA DE MODELOS
   ========================================================= */
const loader = new GLTFLoader();
const characters = {};
const mixers = {};
const actionsMap = {};
let loadedCount = 0;
let failedCount = 0;
const totalModels = Object.keys(CONFIG.models).length;

let character = null;
let mixer = null;
let actions = [];
let currentAnimIndex = 0;

const State = {
  current: 'visible',
  pose: CONFIG.defaultPose,
  cursorOverUI: false,
  hiddenX: 4.0,
  peekX: 2.0,
  visibleX: 1.0,
  baseY: -1.0,
};

function onModelLoaded(key, gltf) {
  const model = gltf.scene;
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false;
    }
  });

  model.scale.setScalar(CONFIG.scale);
  model.rotation.set(0, CONFIG.rotY, 0);
  model.position.set(State.visibleX, State.baseY, 0);
  model.visible = false;
  scene.add(model);
  model.updateMatrixWorld(true);

  characters[key] = model;

  if (gltf.animations && gltf.animations.length > 0) {
    const m = new THREE.AnimationMixer(model);
    mixers[key] = m;
    actionsMap[key] = gltf.animations.map(clip => m.clipAction(clip));
  }

  loadedCount++;
  updateLoading(
    Math.round(((loadedCount + failedCount) / totalModels) * 100),
    `${loadedCount} / ${totalModels}`,
    `OK: ${key}`
  );

  if (loadedCount + failedCount >= totalModels) finishLoading();
}

function onModelFailed(key, errorMsg) {
  console.error(`❌ Falló "${key}": ${errorMsg}`);
  failedCount++;
  if (loadedCount + failedCount >= totalModels) finishLoading();
}

function finishLoading() {
  if (loadedCount === 0) return;
  activatePose(CONFIG.defaultPose, true);
  setTimeout(() => loaderEl && loaderEl.classList.add('hidden'), 800);
}

Object.entries(CONFIG.models).forEach(([key, path]) => {
  loader.load(
    path,
    (gltf) => onModelLoaded(key, gltf),
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        updateLoading(pct, `Cargando ${key}… ${pct}%`, key.toUpperCase());
      }
    },
    (error) => onModelFailed(key, error)
  );
});

/* =========================================================
   CAMBIO DE POSE
   ========================================================= */
function activatePose(poseKey, initial = false) {
  if (!characters[poseKey]) return false;

  // Ocultar todos
  Object.values(characters).forEach(c => { if (c) c.visible = false; });

  // ⚡ Pausar los mixers que NO se usan (ahorra CPU)
  Object.keys(mixers).forEach(k => {
    if (k !== poseKey && mixers[k]) mixers[k].timeScale = 0;
  });

  State.pose = poseKey;
  character = characters[poseKey];
  mixer = mixers[poseKey] || null;
  actions = actionsMap[poseKey] || [];
  currentAnimIndex = 0;

  if (mixer) mixer.timeScale = 1;  // ⚡ reactivar el mixer activo

  if (actions.length > 0) {
    actions.forEach(a => a.stop());
    actions[0].reset().play();
  }

  character.visible = true;
  character.scale.setScalar(CONFIG.scale);

  let targetX = State.visibleX;
  if (State.current === 'peek') targetX = State.peekX;
  else if (State.current === 'escondida') targetX = State.hiddenX;

  character.position.set(targetX, State.baseY, 0);
  character.rotation.set(0, CONFIG.rotY, 0);
  character.updateMatrixWorld(true);

  if (dbgPose) dbgPose.textContent = poseKey;
  if (dbgAnim) dbgAnim.textContent = actions.length > 0 ? `1/${actions.length}` : '-';
  return true;
}

function togglePose() {
  const available = Object.keys(characters);
  if (available.length < 2) return;
  const idx = available.indexOf(State.pose);
  const next = available[(idx + 1) % available.length];
  activatePose(next);
  showToast(`🎭 ${next.toUpperCase()}`);
}

function nextAnimation() {
  if (actions.length < 2) { showToast('⚠️ 1 animación'); return; }
  actions[currentAnimIndex].stop();
  currentAnimIndex = (currentAnimIndex + 1) % actions.length;
  actions[currentAnimIndex].reset().play();
  if (dbgAnim) dbgAnim.textContent = `${currentAnimIndex + 1}/${actions.length}`;
  showToast(`🎬 ${currentAnimIndex + 1}/${actions.length}`);
}

/* =========================================================
   AniMate (auto peek/hide)
   ========================================================= */
const AniMate = {
  peek() {
    if (State.current === 'visible') return;
    State.current = 'peek';
    if (character) character.position.x = State.peekX;
  },
  show() {
    State.current = 'visible';
    if (character) character.position.x = State.visibleX;
    this.scheduleAutoHide();
  },
  hide() {
    State.current = 'escondida';
    if (character) character.position.x = State.hiddenX;
  },
  scheduleAutoHide() {
    clearTimeout(State.autoHideTimer);
    State.autoHideTimer = setTimeout(() => {
      if (State.current === 'visible') this.peek();
    }, CONFIG.autoHideAfter * 1000);
  },
  scheduleAutoPeek() {
    clearTimeout(State.autoPeekTimer);
    State.autoPeekTimer = setTimeout(() => {
      if (State.current === 'escondida') this.peek();
      this.scheduleAutoPeek();
    }, CONFIG.autoPeekInterval * 1000);
  },
};
AniMate.scheduleAutoPeek();

/* =========================================================
   ACCIONES
   ========================================================= */
function doAction(action) {
  if (!character) { showToast('⚠️ Sin modelo'); return; }
  try {
    switch (action) {
      case 'move-up':    character.position.y += STEP.move; State.baseY = character.position.y; break;
      case 'move-down':  character.position.y -= STEP.move; State.baseY = character.position.y; break;
      case 'move-left':  character.position.x -= STEP.move; State.visibleX = character.position.x; break;
      case 'move-right': character.position.x += STEP.move; State.visibleX = character.position.x; break;
      case 'rot-up':    character.rotation.x -= STEP.rotate; break;
      case 'rot-down':  character.rotation.x += STEP.rotate; break;
      case 'rot-left':  character.rotation.y -= STEP.rotate; break;
      case 'rot-right': character.rotation.y += STEP.rotate; break;
      case 'scale-up':
        CONFIG.scale = Math.min(1, CONFIG.scale + STEP.scale);
        Object.values(characters).forEach(c => c && c.scale.setScalar(CONFIG.scale));
        break;
      case 'scale-down':
        CONFIG.scale = Math.max(0.001, CONFIG.scale - STEP.scale);
        Object.values(characters).forEach(c => c && c.scale.setScalar(CONFIG.scale));
        break;
      case 'center':
        State.current = 'visible';
        State.visibleX = 0;
        State.baseY = -0.5;
        character.position.set(0, -0.5, 0);
        character.rotation.set(0, 0, 0);
        showToast('🎯 Centrado');
        break;
      case 'toggle-pose': togglePose(); break;
      case 'next-anim': nextAnimation(); break;
      case 'copy-config': copyConfig(); break;
      case 'reset':
        character.rotation.set(0, CONFIG.rotY, 0);
        showToast('↺ Reset');
        break;
      case 'show':
        State.current = 'visible';
        State.visibleX = 0;
        State.baseY = -0.5;
        character.position.set(0, -0.5, 0);
        showToast('👀 Mostrando');
        break;
      case 'speak-now': Audio.playAllInOrder(); break;
    }
  } catch (e) { console.error(e); }
}

function copyConfig() {
  const txt = `// Estado actual:
State.visibleX = ${State.visibleX.toFixed(3)};
State.peekX    = ${State.peekX.toFixed(3)};
State.hiddenX  = ${State.hiddenX.toFixed(3)};
State.baseY    = ${State.baseY.toFixed(3)};
CONFIG.scale   = ${CONFIG.scale.toFixed(5)};`;
  try {
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => showToast('✅ Copiada'));
  } catch (e) {}
  console.log(txt);
}

/* =========================================================
   EVENT LISTENERS
   ========================================================= */
document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    doAction(btn.dataset.action);
  });
});

if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    Audio.toggle();
    updateVoiceButton();
    showToast(Audio.enabled ? '🔊 Voz ON' : '🔇 Voz OFF');
  });
}

if (audioDebugBtn) {
  audioDebugBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    audioDebugList.classList.toggle('visible');
    updateAudioDebugList();
  });
}

/* =========================================================
   PANEL
   ========================================================= */
function setPanelHidden(hidden) {
  if (!panelEl) return;
  if (hidden) {
    panelEl.classList.add('hidden');
    panelOpenBtn?.classList.add('visible');
    localStorage.setItem('archichum_panel_hidden', 'true');
  } else {
    panelEl.classList.remove('hidden');
    panelOpenBtn?.classList.remove('visible');
    localStorage.setItem('archichum_panel_hidden', 'false');
  }
}

if (localStorage.getItem('archichum_panel_hidden') === 'true') {
  setPanelHidden(true);
}

if (panelOpenBtn) {
  panelOpenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setPanelHidden(false);
  });
}

if (panelCloseBtn) {
  panelCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    setPanelHidden(true);
    showToast('📋 Panel oculto · pulsa ☰ para abrirlo');
  });
}

/* =========================================================
   MODAL DE CRÉDITOS
   ========================================================= */
function openCredits() {
  if (creditsModal) creditsModal.classList.add('visible');
}

function closeCredits() {
  if (creditsModal) creditsModal.classList.remove('visible');
}

function hideWelcome() {
  if (creditsModal) creditsModal.classList.remove('visible');
  if (dontShowAgain && dontShowAgain.checked) {
    localStorage.setItem('archichum_dont_show_welcome', 'true');
  } else {
    localStorage.removeItem('archichum_dont_show_welcome');
  }
}

if (creditsBtn) {
  creditsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openCredits();
  });
}

if (closeCreditsBtn) {
  closeCreditsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    hideWelcome();
  });
}

if (startBtn) {
  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    hideWelcome();
  });
}

if (creditsModal) {
  creditsModal.addEventListener('click', (e) => {
    if (e.target === creditsModal) hideWelcome();
  });
}

document.querySelectorAll('.credits-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const url = link.dataset.url;
    if (!url) return;
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  });
});

setTimeout(() => {
  if (localStorage.getItem('archichum_dont_show_welcome') !== 'true') {
    openCredits();
  }
}, 1500);

/* =========================================================
   CLICK-THROUGH
   ========================================================= */
let lastOverUI = false;

function isOverUI(x, y) {
  if (creditsModal && creditsModal.classList.contains('visible')) return true;
  if (panelOpenBtn && panelOpenBtn.classList.contains('visible')) {
    const r = panelOpenBtn.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  if (panelEl && !panelEl.classList.contains('hidden')) {
    const r = panelEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  if (exitEl) {
    const r = exitEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

window.addEventListener('mousemove', (e) => {
  const over = isOverUI(e.clientX, e.clientY);
  if (over !== lastOverUI) {
    lastOverUI = over;
    if (window.electronAPI) window.electronAPI.setIgnoreMouse(!over);
  }
});

/* =========================================================
   KEYBOARD
   ========================================================= */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideWelcome();
});

/* =========================================================
   IPC
   ========================================================= */
if (window.electronAPI) {
  window.electronAPI.onCallLunari(() => AniMate.show());
  window.electronAPI.onHideLunari(() => AniMate.hide());
  if (window.electronAPI.onTogglePose) window.electronAPI.onTogglePose(() => togglePose());
  if (window.electronAPI.onCopyConfig) window.electronAPI.onCopyConfig(() => copyConfig());
  if (window.electronAPI.onShowCredits) window.electronAPI.onShowCredits(() => openCredits());
}

if (exitEl) {
  exitEl.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (window.electronAPI) window.electronAPI.quit();
    else window.close();
  });
}

/* =========================================================
   LOOP OPTIMIZADO
   
   ⚡ Optimizaciones aplicadas:
   - Limita FPS a 60 (no malgasta en monitores 144Hz)
   - Solo actualiza el mixer ACTIVO (no los 4)
   - Solo renderiza si la ventana está visible
   - Pausa cuando el documento está oculto
   ========================================================= */
const clock = new THREE.Clock();
let lastFrameTime = 0;
const frameInterval = 1000 / CONFIG.maxFPS;
let isDocumentVisible = true;

document.addEventListener('visibilitychange', () => {
  isDocumentVisible = !document.hidden;
});

function animate(currentTime) {
  requestAnimationFrame(animate);

  // ⚡ Limitar FPS
  const elapsed = currentTime - lastFrameTime;
  if (elapsed < frameInterval) return;
  lastFrameTime = currentTime - (elapsed % frameInterval);

  // ⚡ Pausar render si la ventana no es visible
  if (!isDocumentVisible) return;

  const dt = clock.getDelta();

  // ⚡ Solo actualizar el mixer ACTIVO
  if (mixer) mixer.update(dt);

  if (character) {
    character.visible = State.current !== 'escondida';

    if (dbgPos) dbgPos.textContent = `${character.position.x.toFixed(2)}, ${character.position.y.toFixed(2)}`;
    if (dbgRot) dbgRot.textContent = `${character.rotation.x.toFixed(2)}, ${character.rotation.y.toFixed(2)}`;
    if (dbgScale) dbgScale.textContent = CONFIG.scale.toFixed(4);
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

/* =========================================================
   RESIZE (con debounce)
   ========================================================= */
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }, 150);
});

/* =========================================================
   INIT
   ========================================================= */
Audio.preload();
updateVoiceButton();
updateAudioDebugList();
updatePlayAllButton();