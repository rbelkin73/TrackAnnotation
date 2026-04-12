// ═══════════════════════════════════════════════
// MAIN — инициализация и связка всех модулей
// ═══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // читаем начальные значения из полей
    APP.bpm    = parseFloat(document.getElementById('bpmInput').value)    || 174;
    APP.offset = parseFloat(document.getElementById('offsetInput').value) || 0;

    // синхронизируем канвасы
    syncAllCanvases();

    // инициализируем zoom + seek на waveform
    initZoom();

    // вешаем все события UI
    bindUIEvents();

    // начальная отрисовка пустых канвасов
    drawWaveform();
    drawSectionTimeline();
    drawEventTimeline();
    drawEnergyGraph();

    // resize
    window.addEventListener('resize', () => {
        syncAllCanvases();
        updateWaveformView();
        redrawAll();
    });
}

// ─── Bind UI events ──────────────────────────────

function bindUIEvents() {

    // ── Загрузка файла ──
    const fileInput = document.getElementById('fileInput');
    document.getElementById('loadBtn')
        .addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        if (f) loadFile(f);
    });

    // ── BPM / Offset ──
    document.getElementById('bpmInput')
        .addEventListener('input', e => {
            APP.bpm = parseFloat(e.target.value) || 174;
            // пересчитываем viewEnd если трек загружен
            if (APP.duration) {
                APP.viewEnd = APP.viewStart + APP.duration / APP.zoom;
                APP.viewEnd = Math.min(APP.viewEnd, APP.duration);
            }
            redrawAll();
        });

    document.getElementById('offsetInput')
        .addEventListener('input', e => {
            APP.offset = parseFloat(e.target.value) || 0;
            redrawAll();
        });

    // ── Анализ ──
    document.getElementById('analyzeBtn')
        .addEventListener('click', () => runAnalysis());

    // ── Транспорт ──
    document.getElementById('playBtn')
        .addEventListener('click', () => togglePlay());
    document.getElementById('stopBtn')
        .addEventListener('click', () => stopPlayback());

    // ── Экспорт ──
    document.getElementById('exportJsonBtn')
        .addEventListener('click', () => exportJSON());
    document.getElementById('exportCsvBtn')
        .addEventListener('click', () => exportCSV());

    // ── Добавить событие вручную ──
    document.getElementById('addEventBtn')
        .addEventListener('click', () => addEventManual());

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', e => {
        // игнорируем если фокус в поле ввода
        if (e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.tagName === 'SELECT') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                togglePlay();
                break;
            case 'KeyM':
                // M — добавить событие в текущую позицию
                addEventManual();
                break;
            case 'ArrowLeft':
                // ← — назад на 1 бар
                if (APP.duration) {
                    const barDur = (60 / APP.bpm) * 4;
                    seekTo(Math.max(0, APP.currentTime - barDur));
                }
                break;
            case 'ArrowRight':
                // → — вперёд на 1 бар
                if (APP.duration) {
                    const barDur = (60 / APP.bpm) * 4;
                    seekTo(Math.min(APP.duration, APP.currentTime + barDur));
                }
                break;
            case 'ArrowLeft':
                // Shift+← — назад на 8 баров
                if (e.shiftKey && APP.duration) {
                    const barDur = (60 / APP.bpm) * 4;
                    seekTo(Math.max(0, APP.currentTime - barDur * 8));
                }
                break;
            case 'ArrowRight':
                // Shift+→ — вперёд на 8 баров
                if (e.shiftKey && APP.duration) {
                    const barDur = (60 / APP.bpm) * 4;
                    seekTo(Math.min(APP.duration, APP.currentTime + barDur * 8));
                }
                break;
        }
    });
}

// ─── Run analysis ────────────────────────────────

async function runAnalysis() {
    if (!APP.audioBuffer) return;

    const btn           = document.getElementById('analyzeBtn');
    const progress      = document.getElementById('progressBar');
    const progressFill  = document.getElementById('progressFill');
    const progressLabel = document.getElementById('progressLabel');

    btn.disabled    = true;
    btn.textContent = 'Analyzing...';
    progress.classList.remove('hidden');

    // даём UI обновиться перед тяжёлыми вычислениями
    await sleep(50);

    progressLabel.textContent = 'Extracting audio features...';
    progressFill.style.width  = '20%';
    await sleep(20);

    // все три функции теперь синхронные — НЕТ await
    APP.energyData = extractFeatures();

    progressFill.style.width  = '50%';
    progressLabel.textContent = 'Detecting kicks...';
    await sleep(20);

    const kickData = detectKickOnsets();

    progressFill.style.width  = '70%';
    progressLabel.textContent = 'Building structure...';
    await sleep(20);

    APP.sections = buildSections(APP.energyData, kickData.kickDensity);

    progressFill.style.width  = '85%';
    progressLabel.textContent = 'Detecting events...';
    await sleep(20);

    APP.events = detectEvents(APP.energyData, kickData);

    progressFill.style.width  = '95%';
    progressLabel.textContent = 'Rendering...';
    await sleep(20);

    redrawAll();
    renderSectionsList();
    renderEventsList();

    document.getElementById('exportJsonBtn').disabled = false;
    document.getElementById('exportCsvBtn').disabled  = false;

    progressFill.style.width = '100%';
    await sleep(300);
    progress.classList.add('hidden');

    btn.disabled    = false;
    btn.textContent = 'Re-analyze';
}