// ═══════════════════════════════════════════════
// EVENTS — детекция событий с опорой на макроструктуру
// ═══════════════════════════════════════════════

function detectEvents(features, kickData) {
    const events = [];
    const { rms, sub, high, flux, numBlocks } = features; 
    // Напоминаю: 1 блок теперь = 1 бар
    
    const barDur = (60 / APP.bpm) * 4;
    const normalize = arr => {
        let max = Math.max(...arr) || 1;
        return Array.from(arr, v => v / max);
    };

    const nSub = normalize(sub);
    const nHigh = normalize(high);
    const nFlux = normalize(flux);

    function pushEvent(type, startBar, endBar, extra = {}) {
        const startTime = APP.offset + (startBar - 1) * barDur;
        const endTime = APP.offset + endBar * barDur;
        events.push({
            type,
            startTime,
            endTime,
            bar: startBar,
            endBar: Math.max(startBar, endBar),
            beat: 1,
            intensity: extra.intensity || 0.8,
            confidence: extra.confidence || 'mid',
            label: extra.label || '',
        });
    }

    // ВАЖНО: Опираемся на только что созданные секции!
    const sections = APP.sections;

    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        
        // ── 1. ИЩЕМ РАЗГОНЫ (RISERS) ТОЛЬКО ПЕРЕД ДРОПАМИ ──
        if (sec.type === 'DROP' && i > 0) {
            const prevSec = sections[i-1];
            // Смотрим последние 4-8 баров перед Дропом
            const riserEndBar = sec.startBar - 1;
            const riserStartBar = Math.max(prevSec.startBar, riserEndBar - 7); 
            
            // Проверяем, рос ли High сигнал в этой зоне
            let isRising = true;
            if (riserEndBar > riserStartBar) {
                pushEvent('riser', riserStartBar, riserEndBar, {
                    intensity: 0.8,
                    confidence: 'high'
                });
            }
        }

        // ── 2. ИЩЕМ СБИВКИ (DRUM FILLS) В КОНЦЕ ФРАЗ ──
        // Сбивка почти всегда происходит в 16-й или 32-й бар фразы
        const phraseLen = sec.endBar - sec.startBar + 1;
        
        for (let b = sec.startBar; b <= sec.endBar; b++) {
            const isEndOfPhrase = (b - sec.startBar + 1) % 16 === 0 || b === sec.endBar;
            
            if (isEndOfPhrase) {
                // Блок = Бар (b-1, так как массивы с нуля)
                const idx = b - 1;
                const prevIdx = Math.max(0, idx - 1);
                
                // Условие сбивки: Бас выключился (провал), транзиенты (Flux) подскочили
                const dropInSub = nSub[idx] < nSub[prevIdx] * 0.6 || nSub[idx] < 0.2;
                const spikeInFlux = nFlux[idx] > 0.3;

                if (dropInSub && spikeInFlux) {
                    pushEvent('drum_fill', b, b, {
                        intensity: nFlux[idx],
                        confidence: 'high'
                    });
                }
            }
        }

        // ── 3. IMPACT (ВЗРЫВ) НА НАЧАЛЕ ДРОПА ──
        if (sec.type === 'DROP') {
            const idx = sec.startBar - 1;
            // Если в начале дропа огромный всплеск широкополосной энергии
            if (nFlux[idx] > 0.5) {
                pushEvent('impact', sec.startBar, sec.startBar, {
                    intensity: 1.0,
                    confidence: 'high'
                });
            }
        }
    }

    return events.sort((a, b) => a.startTime - b.startTime);
}