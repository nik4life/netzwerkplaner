import './globals.css';

export const metadata = {
  title: 'Netzwerkplaner',
  description: 'Planung und Dokumentation strukturierter IT-Verkabelung',
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
