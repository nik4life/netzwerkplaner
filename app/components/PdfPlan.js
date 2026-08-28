'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './PdfPlan.module.css';

export default function PdfPlan({ url, zoom = 1, onAspect }) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let loadingTask;
    let resizeObserver;
    let pdf;

    async function start() {
      try {
        setError('');
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        loadingTask = pdfjs.getDocument(url);
        pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        onAspect?.(baseViewport.width / baseViewport.height);

        const render = async () => {
          if (cancelled || !hostRef.current || !canvasRef.current) return;
          const cssWidth = Math.max(1, hostRef.current.clientWidth);
          const cssHeight = Math.max(1, hostRef.current.clientHeight);
          const fitScale = Math.min(cssWidth / baseViewport.width, cssHeight / baseViewport.height);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: fitScale * Math.max(1, zoom) * dpr });

          const canvas = canvasRef.current;
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;

          renderTaskRef.current?.cancel?.();
          const context = canvas.getContext('2d', { alpha: false });
          renderTaskRef.current = page.render({ canvasContext: context, viewport });
          try {
            await renderTaskRef.current.promise;
          } catch (renderError) {
            if (renderError?.name !== 'RenderingCancelledException') throw renderError;
          }
        };

        resizeObserver = new ResizeObserver(render);
        resizeObserver.observe(hostRef.current);
        await render();
      } catch (err) {
        if (!cancelled) setError(err?.message || 'PDF konnte nicht gerendert werden.');
      }
    }

    start();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      renderTaskRef.current?.cancel?.();
      loadingTask?.destroy?.();
      pdf?.destroy?.();
    };
  }, [url, zoom, onAspect]);

  return (
    <div className={styles.host} ref={hostRef}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
