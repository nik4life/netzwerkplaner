'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const TYPES = {
  bruestsung: { label: 'Brüstungskanal', short: 'BK', icon: '▣' },
  aufputz: { label: 'Aufputz', short: 'AP', icon: '▤' },
  decke: { label: 'Deckendose', short: 'DE', icon: '●' },
  sonder: { label: 'Sonderbedarf', short: 'SO', icon: '◆' },
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
  return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
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
  const [markerScale, setMarkerScale] = useState(0.68);
  const [mode, setMode] = useState('dose');
  const [channelStart, setChannelStart] = useState(null);
  const stageRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('netzwerkplaner-project-v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        parsed.floors = (parsed.floors || []).map((f) => ({ ...f, markers: f.markers || [], channels: f.channels || [] }));
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
    const byType = Object.fromEntries(Object.keys(TYPES).map((key) => [key, { outlets: 0, ports: 0 }]));
    let totalPorts = 0;
    markers.forEach((marker) => {
      totalPorts += Number(marker.ports || 0);
      if (byType[marker.type]) {
        byType[marker.type].outlets += 1;
        byType[marker.type].ports += Number(marker.ports || 0);
      }
    });
    return { outlets: markers.length, totalPorts, byType };
  }, [floor]);

  function patchFloor(updater) {
    setData((current) => ({
      ...current,
      floors: current.floors.map((item) => item.id === current.activeFloorId ? updater({ ...item, channels: item.channels || [], markers: item.markers || [] }) : item),
    }));
  }

  function setActiveFloor(id) {
    setSelectedId(null);
    setChannelStart(null);
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

  function snapToChannel(pos) {
    const channels = floor?.channels || [];
    if (!channels.length) return { ...pos, channelId: null };
    let best = null;
    for (const channel of channels) {
      const candidate = pointToSegment(pos, { x: channel.x1, y: channel.y1 }, { x: channel.x2, y: channel.y2 });
      if (!best || candidate.distance < best.distance) best = { ...candidate, channelId: channel.id };
    }
    return best && best.distance <= 4 ? best : { ...pos, channelId: null };
  }

  function handleStageClick(event) {
    if (!floor?.plan || draggingId) return;
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

    const finalPos = tool === 'bruestsung' ? snapToChannel(pos) : { ...pos, channelId: null };
    const marker = { id: uid('dose'), type: tool, ports: Number(ports), x: finalPos.x, y: finalPos.y, note: '', channelId: finalPos.channelId || null };
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
    patchFloor((current) => ({ ...current, channels: current.channels.slice(0, -1) }));
  }

  function startDrag(event, marker) {
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
    const finalPos = marker.type === 'bruestsung' ? snapToChannel(pos) : { ...pos, channelId: null };
    updateMarker(marker.id, { x: finalPos.x, y: finalPos.y, channelId: finalPos.channelId || null });
  }

  function endDrag(event) {
    event.stopPropagation();
    setDraggingId(null);
  }

  function resetProject() {
    if (!window.confirm('Projekt wirklich zurücksetzen? Markierungen und Etagen werden gelöscht.')) return;
    localStorage.removeItem('netzwerkplaner-project-v1');
    setData(EMPTY_STATE);
    setSelectedId(null);
    setChannelStart(null);
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
        {data.floors.map((item) => <button key={item.id} className={item.id === floor?.id ? 'floor-tab active' : 'floor-tab'} onClick={() => setActiveFloor(item.id)}>{item.name}<span>{item.markers.length}</span></button>)}
        <button className="floor-tab add" onClick={addFloor}>＋ Etage</button>
      </nav>

      <section className="workspace">
        <aside className="sidebar left-sidebar">
          <h2>Werkzeuge</h2>
          <p className="hint">Dosen setzen oder Brüstungskanal als Linie zeichnen.</p>
          <div className="mode-switch">
            <button className={mode === 'dose' ? 'mode active' : 'mode'} onClick={() => { setMode('dose'); setChannelStart(null); }}>Dosen</button>
            <button className={mode === 'channel' ? 'mode active' : 'mode'} onClick={() => { setMode('channel'); setSelectedId(null); }}>Kanal zeichnen</button>
          </div>
          {mode === 'channel' ? (
            <div className="channel-help">
              <strong>Brüstungskanal</strong>
              <span>{channelStart ? 'Endpunkt anklicken' : 'Startpunkt anklicken'}</span>
              <small>BK-Dosen rasten automatisch auf Kanälen ein.</small>
              <button className="mini-button" onClick={deleteLastChannel}>Letzten Kanal löschen</button>
            </div>
          ) : (
            <>
              <div className="tool-list">
                {Object.entries(TYPES).map(([key, item]) => <button key={key} className={tool === key ? 'tool active' : 'tool'} onClick={() => setTool(key)}><span className={`tool-icon type-${key}`}>{item.icon}</span><span><strong>{item.label}</strong><small>{item.short}</small></span></button>)}
              </div>
              <div className="form-block">
                <label>Ports je Dose</label>
                <div className="port-grid">{[1, 2, 4, 6, 8, 12].map((value) => <button key={value} className={Number(ports) === value ? 'port active' : 'port'} onClick={() => setPorts(value)}>{value}</button>)}</div>
                <input className="number-input" type="number" min="1" max="96" value={ports} onChange={(e) => setPorts(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            </>
          )}

          <div className="form-block compact-control">
            <label>Symbolgröße <span>{Math.round(markerScale * 100)}%</span></label>
            <input type="range" min="0.45" max="1.15" step="0.05" value={markerScale} onChange={(e) => setMarkerScale(Number(e.target.value))} />
          </div>

          <div className="legend"><strong>Bedienung</strong><span>① Modus wählen</span><span>② Plan zoomen falls nötig</span><span>③ Position anklicken</span><span>④ Dose ziehen zum Verschieben</span></div>
        </aside>

        <div className="canvas-column">
          <div className="canvas-toolbar">
            <div><strong>{floor?.name}</strong><span>{floor?.plan?.name || 'Noch kein Plan'}</span></div>
            <div className="canvas-controls">
              <button onClick={() => setZoom((z) => Math.max(.6, +(z - .1).toFixed(2)))}>−</button>
              <button className="zoom-label" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((z) => Math.min(2.2, +(z + .1).toFixed(2)))}>＋</button>
              <span>{(floor?.channels || []).length} Kanäle</span><span>{stats.outlets} Dosen</span><strong>{stats.totalPorts} Ports</strong>
            </div>
          </div>

          <div className={`plan-stage ${floor?.plan ? 'has-plan' : ''}`} ref={stageRef}>
            {!floor?.plan && <label className="empty-plan"><span className="upload-symbol">＋</span><strong>Gebäudeplan hochladen</strong><span>PDF, PNG, JPG oder WEBP</span><input hidden type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={uploadPlan} /></label>}

            {floor?.plan && (
              <div className="plan-content" ref={contentRef} onClick={handleStageClick} style={{ transform: `scale(${zoom})` }}>
                {floor.plan.mime === 'application/pdf' ? (
                  <object className="plan-pdf" data={`${floor.plan.url}#toolbar=0&navpanes=0&view=FitH`} type="application/pdf" aria-label="PDF Plan"><div className="pdf-fallback">PDF kann in diesem Browser nicht eingebettet werden.</div></object>
                ) : (
                  <img className="plan-image" src={floor.plan.url} alt={floor.plan.name || 'Gebäudeplan'} draggable="false" />
                )}

                <svg className="channel-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {(floor.channels || []).map((channel) => <line key={channel.id} x1={channel.x1} y1={channel.y1} x2={channel.x2} y2={channel.y2} vectorEffect="non-scaling-stroke" />)}
                  {channelStart && <circle cx={channelStart.x} cy={channelStart.y} r="0.75" vectorEffect="non-scaling-stroke" />}
                </svg>

                {(floor.markers || []).map((marker) => (
                  <button key={marker.id} className={`marker type-${marker.type} ${selectedId === marker.id ? 'selected' : ''} ${marker.channelId ? 'snapped' : ''}`} style={{ left: `${marker.x}%`, top: `${marker.y}%`, '--marker-scale': markerScale }} onPointerDown={(e) => startDrag(e, marker)} onPointerMove={(e) => dragMarker(e, marker)} onPointerUp={endDrag} onPointerCancel={endDrag} title={`${TYPES[marker.type]?.label || marker.type} · ${marker.ports} Ports`}><span>{TYPES[marker.type]?.short || '?'}</span><b>{marker.ports}</b></button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="sidebar right-sidebar">
          <h2>Auswertung</h2>
          <div className="big-stat"><strong>{stats.totalPorts}</strong><span>Ports in {floor?.name}</span></div>
          <div className="stats-list">{Object.entries(TYPES).map(([key, type]) => <div key={key} className="stat-row"><span><i className={`stat-dot type-${key}`}></i>{type.label}</span><strong>{stats.byType[key].ports}</strong><small>{stats.byType[key].outlets} Dosen</small></div>)}</div>
          <div className="building-total"><span>Gebäude gesamt</span><strong>{data.floors.reduce((sum, item) => sum + (item.markers || []).reduce((s, m) => s + Number(m.ports || 0), 0), 0)} Ports</strong></div>
          <div className="selection-panel">
            <h3>Ausgewählte Dose</h3>
            {!selected && <p className="hint">Eine Dose anklicken, um sie zu bearbeiten.</p>}
            {selected && <><label>Montageart<select value={selected.type} onChange={(e) => updateMarker(selected.id, { type: e.target.value, channelId: null })}>{Object.entries(TYPES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label><label>Ports<input type="number" min="1" value={selected.ports} onChange={(e) => updateMarker(selected.id, { ports: Math.max(1, Number(e.target.value) || 1) })} /></label><label>Notiz<textarea rows="3" placeholder="z. B. Drucker / Sonderbedarf" value={selected.note || ''} onChange={(e) => updateMarker(selected.id, { note: e.target.value })} /></label>{selected.channelId && <div className="snap-info">✓ Am Brüstungskanal eingerastet</div>}<button className="button danger" onClick={() => deleteMarker(selected.id)}>Dose löschen</button></>}
          </div>
        </aside>
      </section>
    </main>
  );
}
