// ═══════════════════════════════════════════════
// EXPORT — JSON и CSV
// ═══════════════════════════════════════════════

function exportJSON() {
    if (APP.sections.length === 0) return;

    const data = {
        filename:    APP.fileName,
        bpm:         APP.bpm,
        offset:      APP.offset,
        duration:    parseFloat(APP.duration.toFixed(3)),
        analyzed_at: new Date().toISOString(),

        sections: APP.sections.map(s => ({
            type:          s.type,
            label:         s.label || SECTION_TYPES[s.type].label,
            start_bar:     s.startBar,
            end_bar:       s.endBar,
            start_time:    parseFloat(s.startTime.toFixed(3)),
            end_time:      parseFloat(s.endTime.toFixed(3)),
            start_display: formatTime(s.startTime),
            end_display:   formatTime(s.endTime),
            energy_level:  s.energyLevel || 0,
            confidence:    s.confidence,
        })),

        events: APP.events.map(ev => {
            const info = EVENT_TYPES[ev.type] || EVENT_TYPES.kick;
            const obj  = {
                type:          ev.type,
                kind:          info.kind,
                label:         ev.label || '',
                bar:           ev.bar,
                beat:          ev.beat || 1,
                start_time:    parseFloat(ev.startTime.toFixed(3)),
                start_display: formatTime(ev.startTime),
                intensity:     ev.intensity || 0,
                confidence:    ev.confidence || 'mid',
            };
            // для range-событий добавляем endBar/endTime и энергию
            if (info.kind === 'range') {
                obj.end_bar     = ev.endBar || ev.bar;
                obj.end_time    = parseFloat((ev.endTime || ev.startTime).toFixed(3));
                obj.end_display = formatTime(ev.endTime || ev.startTime);
                if (ev.energyStart !== undefined) obj.energy_start = ev.energyStart;
                if (ev.energyEnd   !== undefined) obj.energy_end   = ev.energyEnd;
            }
            return obj;
        }),
    };

    triggerDownload(
        JSON.stringify(data, null, 2),
        'application/json',
        `dnb_${APP.fileName.replace(/[^a-z0-9]/gi, '_')}.json`
    );
}

function exportCSV() {
    if (APP.sections.length === 0) return;

    const rows = [[
        'kind', 'type', 'label',
        'start_bar', 'end_bar', 'beat',
        'start_time', 'end_time',
        'energy_level', 'energy_start', 'energy_end',
        'confidence',
    ]];

    // секции
    APP.sections.forEach(s => {
        rows.push([
            'section',
            s.type,
            s.label || SECTION_TYPES[s.type].label,
            s.startBar,
            s.endBar,
            1,
            s.startTime.toFixed(3),
            s.endTime.toFixed(3),
            s.energyLevel || 0,
            '',
            '',
            s.confidence,
        ]);
    });

    // события
    APP.events.forEach(ev => {
        const info = EVENT_TYPES[ev.type] || EVENT_TYPES.kick;
        rows.push([
            'event',
            ev.type,
            ev.label || '',
            ev.bar,
            ev.endBar || ev.bar,
            ev.beat || 1,
            ev.startTime.toFixed(3),
            (ev.endTime || ev.startTime).toFixed(3),
            ev.intensity || 0,
            ev.energyStart !== undefined ? ev.energyStart : '',
            ev.energyEnd   !== undefined ? ev.energyEnd   : '',
            ev.confidence || 'mid',
        ]);
    });

    const csv = rows
        .map(r => r.map(v => `"${v}"`).join(','))
        .join('\n');

    triggerDownload(
        csv,
        'text/csv',
        `dnb_${APP.fileName.replace(/[^a-z0-9]/gi, '_')}.csv`
    );
}

function triggerDownload(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}