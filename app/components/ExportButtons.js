'use client';

import { useState } from 'react';

const TYPES = {
  bruestsung: 'Brüstungskanal',
  aufputz: 'Aufputz',
  decke: 'Deckendose',
  sonder: 'Sonderbedarf',
};

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

export default function ExportButtons() {
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');

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
    <div aria-label="Export" style={{ position: 'fixed', top: 18, right: 270, zIndex: 50, display: 'flex', gap: 8, alignItems: 'center' }}>
      <button className="button ghost" onClick={exportCsv}>Tabelle CSV</button>
      <button className="button ghost" onClick={exportPdf} disabled={busy === 'pdf'}>{busy === 'pdf' ? 'PDF …' : 'Plan-PDF'}</button>
      {status && <span style={{ position: 'absolute', top: 42, right: 0, whiteSpace: 'nowrap', fontSize: 11, color: '#52606d', background: '#fff', padding: '5px 8px', border: '1px solid #dbe2e8', borderRadius: 7 }}>{status}</span>}
    </div>
  );
}
