export default function Home() {
  return (
    <main className="shell">
      <section className="card">
        <span className="badge">MVP · Docker bereit</span>
        <h1>Netzwerkplaner</h1>
        <p>
          Planung und Dokumentation strukturierter IT-Verkabelung auf Gebäudeplänen.
        </p>
        <div className="grid">
          <div><strong>Plan-Upload</strong><span>PDF/Bild als nächster Schritt</span></div>
          <div><strong>Netzwerkdosen</strong><span>Brüstung, AP, Decke, Sonderbedarf</span></div>
          <div><strong>Live-Zähler</strong><span>Ports je Etage und Montageart</span></div>
          <div><strong>Raumregeln</strong><span>Arbeitsplätze aus Raumfläche ableiten</span></div>
        </div>
      </section>
    </main>
  );
}
