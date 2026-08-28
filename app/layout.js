import './globals.css';
import ExportButtons from './components/ExportButtons';

export const metadata = {
  title: 'Netzwerkplaner',
  description: 'Planung und Dokumentation strukturierter IT-Verkabelung',
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <ExportButtons />
        {children}
      </body>
    </html>
  );
}
