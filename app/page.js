'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const TYPES = {
  bruestsung: { label: 'Brüstungskanal', short: 'BK' },
  aufputz: { label: 'Aufputz', short: 'AP' },
  decke: { label: 'Deckendose', short: 'DE' },
  sonder: { label: 'Sonderbedarf', short: 'SO' },
};

const EMPTY_STATE = {
  projectName: 'Neues Verkabelungsprojekt',
  activeFloorId: 'eg',
  floors: [{ id: 'eg', name: 'EG', plan: null, markers: [], channels: [] }],
};

function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pointToSegment(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const x = a.x + t * vx;
  const y = a.y + t * vy;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

function pointOnChannel(channel, t) {
  return {
    x: channel.x1 + (channel.x2 - channel.x1) * t,
    y: channel.y1 + (channel.y2 - channel.y1) * t,
  };
}

export default function Home() {
  const [data, setData] = useState(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [tool, setTool] = useState('bruestsung');
  const [ports, setPorts] = useState(2);
  const [selectedId, setSelectedId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [draggingId, setDraggingId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [markerScale, setMarkerScale] = useState(0.45);
  const [mode, setMode] = useState('dose');
  const [channelStart, setChannelStart] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panDrag, setPanDrag] = useState(null);
  const stageRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('netzwerkplaner-project-v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.floors = (parsed.floors || []).map((floor) => ({
          ...floor,
          markers: floor.markers || [],
          channels: floor.channels || [],
        }));
        setData(parsed);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem('netzwerkplaner-project-v1', JSON.stringify(data));
  }, [data, loaded]);

  const floor = data.floors.find((item) => item.id === data.activeFloorId) || data.floors[0];
  const selected = floor?.markers.find((item) => item.id === selectedId) || null;

  const stats = useMemo(() => {
    const markers = floor?.markers || [];
    const byType = Object.fromEntries(Object.keys(TYPES).map((key) => [key, { points: 0, ports: 0 }]));
    let totalPorts = 0;
    markers.forEach((marker) => {
      const count = Number(marker.ports || 0);
      totalPorts += count;
      if (byType[marker.type]) {
        byType[marker.type].points += 1;
        byType[marker.type].ports += count;
      }
    });
    return { points: markers.length, totalPorts, byType };
  }, [floor]);

  function patchFloor(updater) {
    setData((current) => ({
      ...current,
      floors: current.floors.map((item) => item.id === current.activeFloorId
        ? updater({ ...item, markers: item.markers || [], channels: item.channels || [] })
        : item),
    }));
  }

  function setActiveFloor(id) {
    setSelectedId(null);
    setChannelStart(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setData((current) => ({ ...current, activeFloorId: id }));
  }

  function addFloor() {
    const name = window.prompt('Name der Etage, z. B. 1. OG');
    if (!name?.trim()) return;
    const id = uid('floor');
    setData((current) => ({
      ...current,
      activeFloorId: id,
      floors: [...current.floors, { id, name: name.trim(), plan: null, markers: [], channels: [] }],
    }));
    setSelectedId(null);
    setChannelStart(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }

  async function uploadPlan(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setMessage('Plan wird hochgeladen …');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/plans', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Upload fehlgeschlagen');
      patchFloor((current) => ({ ...current, plan: result, markers: [], channels: [] }));
      setSelectedId(null);
      setPan({ x: 0, y: 0 });
      setZoom(1);
      setMessage(`${file.name} geladen`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
      window.setTimeout(() => setMessage(''), 3000);
    }
  }

  function positionFromEvent(event) {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function rawSnapToChannel(pos) {
    const channels = floor?.channels || [];
    if (!channels.length) return { ...pos, channelId: null, channelT: null };
    let best = null;
    for (const channel of channels) {
      const candidate = pointToSegment(pos, { x: channel.x1, y: channel.y1 }, { x: channel.x2, y: channel.y2 });
      if (!best || candidate.distance < best.distance) best = { ...candidate, channelId: channel.id };
    }
    return best && best.distance <= 5
      ? { x: best.x, y: best.y, channelId: best.channelId, channelT: best.t }
      : { ...pos, channelId: null, channelT: null };
  }

  function avoidChannelOverlap(snap, ignoreId = null) {
    if (!snap.channelId || snap.channelT == null) return snap;
    const channel = (floor?.channels || []).find((item) => item.id === snap.channelId);
    if (!channel) return snap;

    const length = Math.hypot(channel.x2 - channel.x1, channel.y2 - channel.y1);
    const gapOnPlan = Math.max(0.55, 1.7 * markerScale);
    const gapT = Math.min(0.22, gapOnPlan / Math.max(length, 1));
    const occupied = (floor?.markers || [])
      .filter((marker) => marker.id !== ignoreId && marker.channelId === channel.id)
      .map((marker) => {
        if (typeof marker.channelT === 'number') return marker.channelT;
        return pointToSegment(marker, { x: channel.x1, y: channel.y1 }, { x: channel.x2, y: channel.y2 }).t;
      });

    const free = (candidateT) => occupied.every((taken) => Math.abs(taken - candidateT) >= gapT);
    let t = snap.channelT;
    if (!free(t)) {
      let found = null;
      for (let step = 1; step < 100 && found == null; step += 1) {
        const delta = gapT * step;
        for (const candidate of [t + delta, t - delta]) {
          if (candidate >= 0 && candidate <= 1 && free(candidate)) {
            found = candidate;
            break;
          }
        }
      }
      if (found != null) t = found;
    }

    const point = pointOnChannel(channel, t);
    return { ...point, channelId: channel.id, channelT: t };
  }

  function snapToChannel(pos, ignoreId = null) {
    return avoidChannelOverlap(rawSnapToChannel(pos), ignoreId);
  }

  function handlePlanClick(event) {
    if (!floor?.plan || draggingId || mode === 'pan') return;
    if (event.target.closest?.('.marker')) return;
    const pos = positionFromEvent(event);
    if (!pos) return;

    if (mode === 'channel') {
      if (!channelStart) {
        setChannelStart(pos);
        setMessage('Startpunkt gesetzt – jetzt Endpunkt anklicken');
        return;
      }
      const channel = { id: uid('channel'), x1: channelStart.x, y1: channelStart.y, x2: pos.x, y2: pos.y };
      patchFloor((current) => ({ ...current, channels: [...current.channels, channel] }));
      setChannelStart(null);
      setMessage('Brüstungskanal eingezeichnet');
      window.setTimeout(() => setMessage(''), 1800);
      return;
    }

    const finalPos = tool === 'bruestsung'
      ? snapToChannel(pos)
      : { ...pos, channelId: null, channelT: null };
    const marker = {
      id: uid('port'),
      type: tool,
      ports: Number(ports),
      x: finalPos.x,
      y: finalPos.y,
      note: '',
      channelId: finalPos.channelId || null,
      channelT: finalPos.channelT ?? null,
    };
    patchFloor((current) => ({ ...current, markers: [...current.markers, marker] }));
    setSelectedId(marker.id);
  }

  function updateMarker(id, changes) {
    patchFloor((current) => ({
      ...current,
      markers: current.markers.map((marker) => marker.id === id ? { ...marker, ...changes } : marker),
    }));
  }

  function deleteMarker(id) {
    patchFloor((current) => ({ ...current, markers: current.markers.filter((marker) => marker.id !== id) }));
    setSelectedId(null);
  }

  function deleteLastChannel() {
    if (!(floor?.channels || []).length) return;
    const removed = floor.channels[floor.channels.length - 1];
    patchFloor((current) => ({
      ...current,
      channels: current.channels.slice(0, -1),
      markers: current.markers.map((marker) => marker.channelId === removed.id
        ? { ...marker, channelId: null, channelT: null }
        : marker),
    }));
  }

  function distributeChannelPorts() {
    if (!(floor?.channels || []).length) return;
    patchFloor((current) => {
      let markers = [...current.markers];
      current.channels.forEach((channel) => {
        const ids = markers
          .filter((marker) => marker.channelId === channel.id)
          .sort((a, b) => {
            const ta = typeof a.channelT === 'number' ? a.channelT : pointToSegment(a, { x: channel.x1, y: channel.y1 }, { x: channel.x2, y: channel.y2 }).t;
            const tb = typeof b.channelT === 'number' ? b.channelT : pointToSegment(b, { x: channel.x1, y: channel.y1 }, { x: channel.x2, y: channel.y2 }).t;
            return ta - tb;
          })
          .map((marker) => marker.id);
        if (!ids.length) return;
        const padding = ids.length === 1 ? 0.5 : 0.025;
        markers = markers.map((marker) => {
          const index = ids.indexOf(marker.id);
          if (index < 0) return marker;
          const t = ids.length === 1 ? 0.5 : padding + (index / (ids.length - 1)) * (1 - padding * 2);
          const point = pointOnChannel(channel, t);
          return { ...marker, ...point, channelT: t };
        });
      });
      return { ...current, markers };
    });
    setMessage('Ports auf den Kanälen gleichmäßig verteilt');
    window.setTimeout(() => setMessage(''), 2200);
  }

  function startMarkerDrag(event, marker) {
    if (mode === 'pan') return;
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(marker.id);
    setDraggingId(marker.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function dragMarker(event, marker) {
    if (draggingId !== marker.id) return;
    event.stopPropagation();
    const pos = positionFromEvent(event);
    if (!pos) return;
    const finalPos = marker.type === 'bruestsung'
      ? snapToChannel(pos, marker.id)
      : { ...pos, channelId: null, channelT: null };
    updateMarker(marker.id, {
      x: finalPos.x,
      y: finalPos.y,
      channelId: finalPos.channelId || null,
      channelT: finalPos.channelT ?? null,
    });
  }

  function endMarkerDrag(event) {
    event.stopPropagation();
    setDraggingId(null);
  }

  function startPan(event) {
    if (mode !== 'pan' || !floor?.plan) return;
    event.preventDefault();
    setPanDrag({ startX: event.clientX, startY: event.clientY, x: pan.x, y: pan.y });
    stageRef.current?.setPointerCapture?.(event.pointerId);
  }

  function movePan(event) {
    if (!panDrag) return;
    setPan({
      x: panDrag.x + event.clientX - panDrag.startX,
      y: panDrag.y + event.clientY - panDrag.startY,
    });
  }

  function endPan() {
    setPanDrag(null);
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function resetProject() {
    if (!window.confirm('Projekt wirklich zurücksetzen? Markierungen und Etagen werden gelöscht.')) return;
    localStorage.removeItem('netzwerkplaner-project-v1');
    setData(EMPTY_STATE);
    setSelectedId(null);
    setChannelStart(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }

  if (!loaded) return null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-row"><span className="brand-mark">NP</span><strong>Netzwerkplaner</strong></div>
          <input className="project-name" value={data.projectName} onChange={(e) => setData((current) => ({ ...current, projectName: e.target.value }))} aria-label="Projektname" />
        </div>
        <div className="top-actions">
          {message && <span className="status-message">{message}</span>}
          <label className="button primary">{uploading ? 'Upload …' : floor?.plan ? 'Plan ersetzen' : 'Plan hochladen'}<input hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={uploadPlan} disabled={uploading} /></label>
          <button className="button ghost" onClick={resetProject}>Zurücksetzen</button>
        </div>
      </header>

      <nav className="floor-tabs">
        {data.floors.map((item) => (
          <button key={item.id} className={item.id === floor?.id ? 'floor-tab active' : 'floor-tab'} onClick={() => setActiveFloor(item.id)}>
            {item.name}<span>{item.markers.length}</span>
          </button>
        ))}
        <button className="floor-tab add" onClick={addFloor}>＋ Etage</button>
      </nav>

      <section className="workspace">
        <aside className="sidebar left-sidebar">
          <h2>Werkzeuge</h2>
          <p className="hint">Ports setzen, Brüstungskanal zeichnen oder Plan verschieben.</p>

          <div className="mode-switch three">
            <button className={mode === 'dose' ? 'mode active' : 'mode'} onClick={() => { setMode('dose'); setChannelStart(null); }}>Ports</button>
            <button className={mode === 'channel' ? 'mode active' : 'mode'} onClick={() => { setMode('channel'); setSelectedId(null); }}>Kanal</button>
            <button className={mode === 'pan' ? 'mode active' : 'mode'} onClick={() => { setMode('pan'); setChannelStart(null); }}>✋ Plan</button>
          </div>

          {mode === 'channel' ? (
            <div className="channel-help">
              <strong>Brüstungskanal</strong>
              <span>{channelStart ? 'Endpunkt anklicken' : 'Startpunkt anklicken'}</span>
              <small>Die Kanallinie und die Portpunkte verwenden dieselbe Plan-Koordinate und bleiben beim Moduswechsel deckungsgleich.</small>
              <button className="mini-button" onClick={distributeChannelPorts}>Ports gleichmäßig verteilen</button>
              <button className="mini-button" onClick={deleteLastChannel}>Letzten Kanal löschen</button>
            </div>
          ) : mode === 'pan' ? (
            <div className="channel-help">
              <strong>Plan verschieben</strong>
              <span>Klicken und ziehen</span>
              <small>Bei vergrößertem Plan kannst du jeden Bereich zurück in das Bearbeitungsfenster ziehen.</small>
              <button className="mini-button" onClick={resetView}>Ansicht zurücksetzen</button>
            </div>
          ) : (
            <>
              <div className="tool-list">
                {Object.entries(TYPES).map(([key, item]) => (
                  <button key={key} className={tool === key ? 'tool active' : 'tool'} onClick={() => setTool(key)}>
                    <span className={`tool-icon data-tool type-${key}`}><span className="data-jack"><i></i><i></i><i></i></span></span>
                    <span><strong>{item.label}</strong><small>{item.short}</small></span>
                  </button>
                ))}
              </div>
              <div className="form-block">
                <label>Ports je Punkt</label>
                <div className="port-grid">{[1, 2, 4, 6, 8, 12].map((value) => <button key={value} className={Number(ports) === value ? 'port active' : 'port'} onClick={() => setPorts(value)}>{value}</button>)}</div>
                <input className="number-input" type="number" min="1" max="96" value={ports} onChange={(e) => setPorts(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              {(floor?.channels || []).length > 0 && <button className="mini-button full" onClick={distributeChannelPorts}>Ports am Kanal verteilen</button>}
            </>
          )}

          <div className="form-block compact-control">
            <label>Symbolgröße <span>{Math.round(markerScale * 100)}%</span></label>
            <input type="range" min="0.15" max="1" step="0.05" value={markerScale} onChange={(e) => setMarkerScale(Number(e.target.value))} />
          </div>

          <div className="legend"><strong>Bedienung</strong><span>① Port-/Kanal-/Planmodus wählen</span><span>② Zoomen</span><span>③ Mit ✋ Plan verschieben</span><span>④ BK-Ports rasten am Kanal ein</span></div>
        </aside>

        <div className="canvas-column">
          <div className="canvas-toolbar">
            <div><strong>{floor?.name}</strong><span>{floor?.plan?.name || 'Noch kein Plan'}</span></div>
            <div className="canvas-controls">
              <button onClick={() => setZoom((value) => Math.max(.6, +(value - .1).toFixed(2)))}>−</button>
              <button className="zoom-label" onClick={resetView}>{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((value) => Math.min(3.5, +(value + .1).toFixed(2)))}>＋</button>
              <button className={mode === 'pan' ? 'pan-button active' : 'pan-button'} onClick={() => setMode(mode === 'pan' ? 'dose' : 'pan')} title="Plan verschieben">✋</button>
              <span>{(floor?.channels || []).length} Kanäle</span><span>{stats.points} Portpunkte</span><strong>{stats.totalPorts} Ports</strong>
            </div>
          </div>

          <div
            className={`plan-stage ${floor?.plan ? 'has-plan' : ''} ${mode === 'pan' ? 'pan-mode' : ''} ${panDrag ? 'panning' : ''}`}
            ref={stageRef}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            {!floor?.plan && <label className="empty-plan"><span className="upload-symbol">＋</span><strong>Gebäudeplan hochladen</strong><span>PDF, PNG, JPG oder WEBP</span><input hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={uploadPlan} /></label>}

            {floor?.plan && (
              <div
                className="plan-content"
                ref={contentRef}
                onClick={handlePlanClick}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
              >
                {floor.plan.mime === 'application/pdf' ? (
                  <object className="plan-pdf" data={`${floor.plan.url}#toolbar=0&navpanes=0&view=FitH`} type="application/pdf" aria-label="PDF Plan"><div className="pdf-fallback">PDF kann in diesem Browser nicht eingebettet werden.</div></object>
                ) : (
                  <img className="plan-image" src={floor.plan.url} alt={floor.plan.name || 'Gebäudeplan'} draggable="false" />
                )}

                <svg className="channel-layer" width="100%" height="100%" aria-hidden="true">
                  {(floor.channels || []).map((channel) => (
                    <line key={channel.id} x1={`${channel.x1}%`} y1={`${channel.y1}%`} x2={`${channel.x2}%`} y2={`${channel.y2}%`} />
                  ))}
                  {channelStart && <circle cx={`${channelStart.x}%`} cy={`${channelStart.y}%`} r="5" />}
                </svg>

                {(floor?.markers || []).map((marker) => (
                  <button
                    key={marker.id}
                    className={`marker port-marker type-${marker.type} ${selectedId === marker.id ? 'selected' : ''} ${marker.channelId ? 'snapped' : ''}`}
                    style={{ left: `${marker.x}%`, top: `${marker.y}%`, '--marker-scale': markerScale }}
                    onPointerDown={(event) => startMarkerDrag(event, marker)}
                    onPointerMove={(event) => dragMarker(event, marker)}
                    onPointerUp={endMarkerDrag}
                    onPointerCancel={endMarkerDrag}
                    onClick={(event) => { event.stopPropagation(); setSelectedId(marker.id); }}
                    title={`${TYPES[marker.type]?.label || 'Datenport'} · ${marker.ports} Port${Number(marker.ports) === 1 ? '' : 's'}`}
                  >
                    <span className="cad-port"><i></i><i></i><i></i></span>
                    {Number(marker.ports) > 1 && <b>{marker.ports}</b>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="sidebar right-sidebar">
          <h2>Auswertung</h2>
          <div className="big-stat"><strong>{stats.totalPorts}</strong><span>Ports in {floor?.name}</span></div>
          <div className="stats-list">
            {Object.entries(TYPES).map(([key, type]) => (
              <div key={key} className="stat-row">
                <span><i className={`stat-dot type-${key}`}></i>{type.label}</span>
                <strong>{stats.byType[key].ports}</strong>
                <small>{stats.byType[key].points} Portpunkte</small>
              </div>
            ))}
          </div>

          <div className="building-total">
            <span>Gebäude gesamt</span>
            <strong>{data.floors.reduce((sum, item) => sum + (item.markers || []).reduce((part, marker) => part + Number(marker.ports || 0), 0), 0)} Ports</strong>
          </div>

          <div className="selection-panel">
            <h3>Ausgewählter Portpunkt</h3>
            {!selected && <p className="hint">Einen Portpunkt anklicken, um ihn zu bearbeiten.</p>}
            {selected && (
              <>
                <label>Montageart<select value={selected.type} onChange={(e) => updateMarker(selected.id, { type: e.target.value, channelId: e.target.value === 'bruestsung' ? selected.channelId : null, channelT: e.target.value === 'bruestsung' ? selected.channelT : null })}>{Object.entries(TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
                <label>Ports<input type="number" min="1" value={selected.ports} onChange={(e) => updateMarker(selected.id, { ports: Math.max(1, Number(e.target.value) || 1) })} /></label>
                <label>Notiz<textarea rows="3" placeholder="z. B. Arbeitsplatz / Drucker / Sonderbedarf" value={selected.note || ''} onChange={(e) => updateMarker(selected.id, { note: e.target.value })} /></label>
                {selected.channelId && <div className="snap-info">✓ Am Brüstungskanal eingerastet</div>}
                <button className="button danger" onClick={() => deleteMarker(selected.id)}>Portpunkt löschen</button>
              </>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
