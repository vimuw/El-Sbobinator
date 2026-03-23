import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class RootErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean; message: string }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Root render failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#0f1115',
            color: '#e2e8f0',
            fontFamily: '"Manrope", "Segoe UI", sans-serif',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '560px',
              borderRadius: '24px',
              border: '1px solid rgba(148,163,184,0.16)',
              background: 'rgba(20,24,31,0.96)',
              padding: '24px',
              boxShadow: '0 24px 56px rgba(0,0,0,0.22)',
            }}
          >
            <h1 style={{ margin: 0, fontSize: '20px' }}>Errore caricamento interfaccia</h1>
            <p style={{ margin: '10px 0 0', color: '#94a3b8', lineHeight: 1.6 }}>
              L'app si e aperta ma il frontend ha generato un errore in avvio.
            </p>
            <pre
              style={{
                margin: '16px 0 0',
                padding: '12px 14px',
                borderRadius: '14px',
                background: 'rgba(15,17,21,0.92)',
                color: '#fca5a5',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: '12px',
              }}
            >
              {this.state.message || 'Errore sconosciuto'}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
