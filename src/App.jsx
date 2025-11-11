import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import LiveView from './pages/LiveView.jsx';
import CalendarMonth from './pages/CalendarMonth.jsx';
import NursesCalendar from './pages/NursesCalendar.jsx';
import SlotCompliance from './pages/SlotCompliance.jsx';
import CallCentre from './pages/CallCentre.jsx';
import './styles.css';

// Minimal Error Boundary to show runtime errors on the page instead of a blank screen
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error, info);
    this.setState({ error, info });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error, info } = this.state;
    return (
      <div style={{ padding: 24 }}>
        <h2>Something went wrong rendering this page</h2>
        <div style={{ marginTop: 12, color: '#7f1d1d' }}><strong>{error && error.toString()}</strong></div>
        {info && info.componentStack && (
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{info.componentStack}</pre>
        )}
        <div style={{ marginTop: 16 }}>
          <button onClick={() => window.location.reload()} className="refresh-button">Reload</button>
        </div>
      </div>
    );
  }
}

const navItems = [
  { to: '/live-view', label: 'Live View', end: true, primary: true },
  { to: '/', label: 'Drs Calendar', end: true },
  { to: '/nurses', label: 'Nurses Calendar' },
  { to: '/slot-compliance', label: 'Slot Compliance' },
  { to: '/call-centre', label: 'Call Centre' }
];

function App() {
  // Debug logging
  console.log('App component rendering...');
  console.log('Location:', window.location.href);
  
  return (
    <HashRouter>
      <div className="site-layout">
        <header className="site-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div className="site-brand">
              <span className="site-logo">GP</span>
              <div className="site-title">
                <span className="site-name">Operations Portal</span>
                <span className="site-subtitle">Demand vs Supply Intelligence</span>
              </div>
            </div>
            <NavLink
              to="/live-view"
              end
              className={({ isActive }) => [
                'nav-link',
                'nav-link-primary',
                isActive ? 'active' : ''
              ].filter(Boolean).join(' ')}
            >
              Live View
            </NavLink>
          </div>
          <nav className="topbar-nav" aria-label="Primary navigation">
            {navItems.slice(1).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => [
                  'nav-link',
                  item.primary ? 'nav-link-primary' : '',
                  isActive ? 'active' : ''
                ].filter(Boolean).join(' ')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="page-container">
          <Routes>
            <Route path="/live-view" element={<ErrorBoundary><LiveView /></ErrorBoundary>} />
            <Route path="/" element={<ErrorBoundary><CalendarMonth /></ErrorBoundary>} />
            <Route path="/calendar" element={<ErrorBoundary><CalendarMonth /></ErrorBoundary>} />
            <Route path="/nurses" element={<ErrorBoundary><NursesCalendar /></ErrorBoundary>} />
            <Route path="/slot-compliance" element={<ErrorBoundary><SlotCompliance /></ErrorBoundary>} />
              <Route path="/call-centre" element={<ErrorBoundary><CallCentre /></ErrorBoundary>} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default App;
