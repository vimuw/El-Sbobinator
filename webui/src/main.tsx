import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';


class RootErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean; message: string; stack: string }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '', stack: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack || '') : '',
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
            background: 'var(--bg-base, #191919)',
            color: 'var(--text-primary, #f1f1ef)',
            fontFamily: '"Manrope", "Segoe UI", sans-serif',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              borderRadius: '12px',
              border: '1px solid var(--border-default, rgba(255,255,255,0.14))',
              background: 'var(--bg-elevated, #202020)',
              padding: '24px',
              boxShadow: 'var(--shadow-strong, 0 8px 32px rgba(0,0,0,0.35))',
            }}
          >
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Errore caricamento interfaccia</h1>
            <p style={{ margin: '10px 0 0', color: 'var(--text-muted, #9ca3af)', lineHeight: 1.6, fontSize: '0.875rem' }}>
              L&apos;app si è aperta ma il frontend ha generato un errore in avvio.
            </p>
            <pre
              style={{
                margin: '16px 0 0',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                background: 'var(--bg-panel, #141414)',
                color: 'var(--error-text, #fca5a5)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: '11px',
                maxHeight: '320px',
                overflowY: 'auto',
              }}
            >
              {this.state.stack || this.state.message || 'Errore sconosciuto'}
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
