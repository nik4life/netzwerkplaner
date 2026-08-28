'use client';

import { useRef, useState } from 'react';

const TYPES = {
  bruestsung: 'Brüstungskanal',
  aufputz: 'Aufputz',
  decke: 'Deckendose',
  sonder: 'Sonderbedarf',
};

const PROJECT_FORMAT = 'netzwerkplaner-project';
const PROJECT_VERSION = 1;

function projectState() {
  const raw = localStorage.getItem('netzwerkplaner-project-v1');
  if (!raw) throw new Error('Noch kein Projekt gespeichert.');
  return JSON.parse(raw);
}

function safeFilename(value = 'Netzwerkplaner') {
  return value.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'Netzwerkplaner';
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeProject(data) {
  if (!data || typeof data !== 'object') throw new Error('Ungültige Projektdatei.');
  if (!Array.isArray(data.floors) || !data.floors.length) throw new Error('Die Projektdatei enthält keine Etagen.');

  const floors = data.floors.map((floor, floorIndex) => ({
    ...floor,
    id: floor.id || `floor-import-${floorIndex + 1}`,
    name: floor.name || `Etage ${floorIndex + 1}`,
    markers: Array.isArray(floor.markers) ? floor.markers.map((marker, markerIndex) => ({
      ...marker,
      id: marker.id || `port-import-${floorIndex + 1}-${markerIndex + 1}`,
      type: TYPES[marker.type] ? marker.type : 'bruestsung',
      ports: Math.max(1, Number(marker.ports) || 1),
      x: Math.max(0, Math.min(100, Number(marker.x) || 0)),
      y: Math.max(0, Math.min(100, Number(marker.y) || 0)),
      note: marker.note || '',
      channelId: marker.channelId || null,
      channelT: typeof marker.channelT === 'number' ? marker.channelT : null,
    })) : [],
    channels: Array.isArray(floor.channels) ? floor.channels : [],
  }));

  const activeFloorId = floors.some((floor) => floor.id === data.activeFloorId)
    ? data.activeFloorId
    : floors[0].id;

  return {
    projectName: data.projectName || 'Importiertes Verkabelungsprojekt',
    activeFloorId,
    floors,
  };
}

export default function ExportButtons() {
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const importRef = useRef(null);

  function exportProject() {
    try {
      setStatus('');
      const data = projectState();
      const payload = {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        exportedAt: new Date().toISOString(),
        project: data,
      };
      const json = JSON.stringify(payload, null, 2);
      downloadBlob(
        new Blob([json], { type: 'application/json;charset=utf-8' }),
        `${safeFilename(data.projectName)}.netzplan.json`,
      );
      setStatus('Editierbare Projektdatei exportiert');
      window.setTimeout(() => setStatus(''), 2800);
    } catch (error) {
      setStatus(error?.message || 'Projekt-Export fehlgeschlagen');
    }
  }

  async function importProject(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setBusy('import');
      setStatus('Projekt wird geladen …');
      const text = await file.text();
      const payload = JSON.parse(text);
      const rawProject = payload?.format === PROJECT_FORMAT ? payload.project : payload;
      const project = normalizeProject(rawProject);

      const current = localStorage.getItem('netzwerkplaner-project-v1');
      if (current && !window.confirm('Aktuelles Projekt durch die importierte Projektdatei ersetzen?')) {
        setStatus('Import abgebrochen');
        return;
      }

      localStorage.setItem('netzwerkplaner-project-v1', JSON.stringify(project));
      setStatus('Projekt geladen – Bearbeitungsmodus wird geöffnet');
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setStatus(error instanceof SyntaxError ? 'Keine gültige Netzwerkplaner-Projektdatei.' : (error?.message || 'Projekt-Import fehlgeschlagen'));
    } finally {
      setBusy('');
      window.setTimeout(() => setStatus(''), 3500);
    }
  }

  function exportCsv() {
    try {
      setStatus('');
      const data = projectState();
      const rows = [['Etage', 'Portpunkt', 'Montageart', 'Ports', 'Brüstungskanal', 'Position X (%)', 'Position Y (%)', 'Notiz']];
      for (const floor of data.floors || []) {
        (floor.markers || []).forEach((marker, index) => {
          rows.push([
            floor.name || '', index + 1, TYPES[marker.type] || marker.type || '', Number(marker.ports || 0), marker.channelId ? 'Ja' : 'Nein',
            Number(marker.x || 0).toFixed(2).replace('.', ','), Number(marker.y || 0).toFixed(2).replace('.', ','), marker.note || '',
          ]);
        });
      }
      const csv = '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeFilename(data.projectName)}_Portliste.csv`);
      setStatus('Tabelle exportiert');
      window.setTimeout(() => setStatus(''), 2500);
    } catch (error) {
      setStatus(error?.message || 'CSV-Export fehlgeschlagen');
    }
  }

  async function exportPdf() {
    try {
      setBusy('pdf');
      setStatus('PDF wird erstellt …');
      const data = projectState();
      const floor = (data.floors || []).find((item) => item.id === data.activeFloorId) || data.floors?.[0];
      if (!floor?.plan) throw new Error('Auf der aktiven Etage ist kein Plan hinterlegt.');
      const response = await fetch('/api/export/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectName: data.projectName, floor }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'PDF-Export fehlgeschlagen.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/i);
      downloadBlob(blob, match?.[1] || `${safeFilename(data.projectName)}_${safeFilename(floor.name)}_Netzwerkplan.pdf`);
      setStatus('Plan-PDF exportiert');
    } catch (error) {
      setStatus(error?.message || 'PDF-Export fehlgeschlagen');
    } finally {
      setBusy('');
      window.setTimeout(() => setStatus(''), 3500);
    }
  }

  return (
    <div aria-label="Projekt und Export" style={{ position: 'fixed', top: 18, right: 270, zIndex: 50, display: 'flex', gap: 8, alignItems: 'center' }}>
      <button className="button primary" onClick={exportProject}>Projektdatei</button>
      <button className="button ghost" onClick={() => importRef.current?.click()} disabled={busy === 'import'}>{busy === 'import' ? 'Laden …' : 'Projekt öffnen'}</button>
      <input ref={importRef} hidden type="file" accept=".json,.netzplan,application/json" onChange={importProject} />
      <button className="button ghost" onClick={exportCsv}>CSV</button>
      <button className="button ghost" onClick={exportPdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'PDF …' : 'Plan-PDF'}</button>
      {status && <span style={{ position: 'absolute', top: 42, right: 0, whiteSpace: 'nowrap', fontSize: 11, color: '#52606d', background: '#fff', padding: '5px 8px', border: '1px solid #dbe2e8', borderRadius: 7 }}>{status}</span>}
    </div>
  );
}
