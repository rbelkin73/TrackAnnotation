// ═══════════════════════════════════════════════
// AUDIO — загрузка файла, плейбэк, seekTo
// ═══════════════════════════════════════════════

async function loadFile(file) {
    APP.fileName = file.name;
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('analyzeBtn').disabled  = false;

    if (!APP.audioContext) {
        APP.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    await APP.audioContext.resume();

    const ab         = await file.arrayBuffer();
    APP.audioBuffer  = await APP.audioContext.decodeAudioData(ab);
    APP.duration     = APP.audioBuffer.duration;

    // сброс состояния
    stopPlayback();
    APP.sections    = [];
    APP.events      = [];
    APP.energyData  = null;
    APP.zoom        = 1;
    APP.viewStart   = 0;
    APP.viewEnd     = APP.duration;

    // waveform
    buildWaveformData();
    syncAllCanvases();
    drawWaveform();
    drawSectionTimeline();
    drawEventTimeline();
    drawEnergyGraph();

    document.getElementById('playBtn').disabled     = false;
    document.getElementById('stopBtn').disabled     = false;
    document.getElementById('addEventBtn').disabled = false;

    document.getElementById('sectionsList').innerHTML =
        '<div class="empty-state">Press Analyze to detect structure</div>';
    document.getElementById('eventsList').innerHTML =
        '<div class="empty-state">Events will appear after analysis</div>';
}

// ─── Playback ────────────────────────────────────

function togglePlay() {
    if (APP.isPlaying) pausePlayback();
    else startPlayback();
}

function startPlayback() {
    if (!APP.audioBuffer || !APP.audioContext) return;

    // ВАЖНО: всегда останавливаем старый источник перед новым
    _destroySource();

    if (APP.audioContext.state === 'suspended') APP.audioContext.resume();

    APP.audioSource        = APP.audioContext.createBufferSource();
    APP.audioSource.buffer = APP.audioBuffer;

    APP.gainNode           = APP.audioContext.createGain();
    APP.gainNode.gain.value = 1.0;
    APP.audioSource.connect(APP.gainNode);
    APP.gainNode.connect(APP.audioContext.destination);

    const offset  = Math.max(0, APP.pausedAt || 0);
    APP.audioSource.start(0, offset);
    APP.startedAt = APP.audioContext.currentTime - offset;
    APP.isPlaying = true;

    APP.audioSource.onended = () => {
        // срабатывает когда трек доиграл до конца
        if (APP.isPlaying) {
            APP.isPlaying   = false;
            APP.pausedAt    = 0;
            APP.currentTime = 0;
            updatePlaybackUI();
            stopAnimationLoop();
            updatePlayheads();
            updateTimeDisplay();
        }
    };

    updatePlaybackUI();
    startAnimationLoop();
}

function pausePlayback() {
    if (!APP.audioSource) return;
    // запоминаем позицию
    APP.pausedAt = APP.audioContext.currentTime - APP.startedAt;
    _destroySource();
    APP.isPlaying = false;
    updatePlaybackUI();
    stopAnimationLoop();
}

function stopPlayback() {
    _destroySource();
    APP.isPlaying   = false;
    APP.pausedAt    = 0;
    APP.currentTime = 0;
    updatePlaybackUI();
    stopAnimationLoop();
    updatePlayheads();
    updateTimeDisplay();
}

function seekTo(timeSec) {
    if (!APP.audioBuffer) return;

    const wasPlaying = APP.isPlaying;

    // ВАЖНО: всегда полностью останавливаем перед seek
    _destroySource();
    APP.isPlaying = false;
    stopAnimationLoop();

    APP.pausedAt    = Math.max(0, Math.min(APP.duration, timeSec));
    APP.currentTime = APP.pausedAt;

    updatePlayheads();
    updateTimeDisplay();

    // если играло — возобновляем с новой позиции
    if (wasPlaying) startPlayback();
}

// уничтожает audioSource безопасно
function _destroySource() {
    if (APP.audioSource) {
        APP.audioSource.onended = null; // отвязываем обработчик
        try { APP.audioSource.stop(); } catch(e) {}
        APP.audioSource.disconnect();
        APP.audioSource = null;
    }
    if (APP.gainNode) {
        try { APP.gainNode.disconnect(); } catch(e) {}
        APP.gainNode = null;
    }
}

// ─── Animation loop ──────────────────────────────

function startAnimationLoop() {
    if (APP.animationId !== null) return;

    const loop = () => {
        if (!APP.isPlaying) return;

        APP.currentTime = APP.audioContext.currentTime - APP.startedAt;

        if (APP.currentTime >= APP.duration) {
            APP.currentTime = APP.duration;
            APP.isPlaying   = false;
            APP.pausedAt    = 0;
            updatePlaybackUI();
            APP.animationId = null;
            updatePlayheads();
            updateTimeDisplay();
            return;
        }

        updatePlayheads();
        updateTimeDisplay();
        APP.animationId = requestAnimationFrame(loop);
    };

    APP.animationId = requestAnimationFrame(loop);
}

function stopAnimationLoop() {
    if (APP.animationId !== null) {
        cancelAnimationFrame(APP.animationId);
        APP.animationId = null;
    }
}

// ─── UI helpers ──────────────────────────────────

function updatePlaybackUI() {
    const btn = document.getElementById('playBtn');
    if (APP.isPlaying) {
        btn.innerHTML = '&#9646;&#9646;'; // пауза
        btn.classList.add('playing');
    } else {
        btn.innerHTML = '&#9654;'; // play
        btn.classList.remove('playing');
    }
}

function updateTimeDisplay() {
    if (!APP.duration) return;
    const t       = APP.currentTime;
    const barDur  = (60 / APP.bpm) * 4;
    const beatDur = 60 / APP.bpm;
    const adj     = Math.max(0, t - APP.offset);
    const bar     = Math.floor(adj / barDur) + 1;
    const beat    = Math.floor((adj % barDur) / beatDur) + 1;
    document.getElementById('timeDisplay').textContent = formatTime(t);
    document.getElementById('barDisplay').textContent  = `Bar ${bar}.${beat}`;
}

function updatePlayheads() {
    if (!APP.duration) return;

    const viewLen = APP.viewEnd - APP.viewStart;
    const clamped = Math.min(Math.max(APP.currentTime, APP.viewStart), APP.viewEnd);
    const ratio   = (clamped - APP.viewStart) / viewLen;

    _setPlayhead('playhead',        'waveformCanvas', ratio);
    _setPlayhead('sectionPlayhead', 'sectionCanvas',  ratio);
    _setPlayhead('eventPlayhead',   'eventCanvas',    ratio);
}

function _setPlayhead(headId, canvasId, ratio) {
    const canvas = document.getElementById(canvasId);
    const head   = document.getElementById(headId);
    if (!canvas || !head) return;
    const rect = canvas.getBoundingClientRect();
    head.style.left = `${ratio * rect.width - 1}px`;
}

// ─── Shared helpers ──────────────────────────────

function formatTime(sec) {
    const m  = Math.floor(sec / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

function timeToBar(timeSec) {
    const barDur   = (60 / APP.bpm) * 4;
    const adjusted = Math.max(0, timeSec - APP.offset);
    return Math.max(1, Math.round(adjusted / barDur) + 1);
}

function timeToBeat(timeSec) {
    const beatDur  = 60 / APP.bpm;
    const barDur   = beatDur * 4;
    const adjusted = Math.max(0, timeSec - APP.offset);
    return Math.floor((adjusted % barDur) / beatDur) + 1;
}

function barToTime(bar) {
    const barDur = (60 / APP.bpm) * 4;
    return APP.offset + (bar - 1) * barDur;
}

function snapToBar(timeSec) {
    const barDur   = (60 / APP.bpm) * 4;
    const adjusted = timeSec - APP.offset;
    const barIndex = Math.round(adjusted / barDur);
    return APP.offset + barIndex * barDur;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }