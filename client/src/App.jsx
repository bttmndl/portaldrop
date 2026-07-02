import { Routes, Route } from 'react-router-dom';
import Desktop from './pages/Desktop.jsx';
import Mobile from './pages/Mobile.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Desktop />} />
      <Route path="/join/:code" element={<Mobile />} />
    </Routes>
  );
}
