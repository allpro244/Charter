import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './desk.css';

function Desk() {
  return (
    <main className="desk">
      <header className="bar">
        <span className="title">CHARTER</span>
        <span className="status">no bank</span>
      </header>
      <table>
        <thead>
          <tr>
            <th>screen</th>
            <th>key</th>
            <th className="num">status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>scaffold</td>
            <td>-</td>
            <td className="num">ready</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <Desk />
  </StrictMode>,
);
