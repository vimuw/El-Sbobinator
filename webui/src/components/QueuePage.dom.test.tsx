import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueuePage, type QueuePageProps } from './QueuePage';

vi.mock('../branding', () => ({
  GITHUB_URL: 'https://github.com/test',
  KOFI_URL: 'https://ko-fi.com/test',
}));

describe('QueuePage Component', () => {
  const defaultProps: QueuePageProps = {
    files: [],
    progress: {
      appState: 'idle',
      currentPhase: '',
      currentModel: 'gemini-2.5-flash',
      activeProgress: 0,
      workDone: { chunks: 0, macro: 0 },
      workTotals: { chunks: 0, macro: 0 },
      batchCompleted: 0,
      batchTotal: 0,
      completionFlash: false,
    },
    auth: {
      apiReady: true,
      bridgeDelayed: false,
      apiKey: 'AIzaSyTestKey123456789012345678901234',
      setApiKey: vi.fn(),
      hasProtectedKey: true,
      apiKeyInsecure: false,
      setApiKeyInsecure: vi.fn(),
      apiKeyInsecureReason: '',
      setApiKeyInsecureReason: vi.fn(),
      fallbackKeys: [],
      preferredModel: 'gemini-2.5-flash',
      fallbackModels: [],
    },
    ingest: {
      isDragging: false,
      handleDragOver: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDrop: vi.fn(),
      handleBrowseClick: vi.fn(),
    },
    console: {
      showConsole: false,
      setShowConsole: vi.fn(),
      consoleLogs: [],
      isConsoleExpanded: false,
      setIsConsoleExpanded: vi.fn(),
      appendConsole: vi.fn(),
    },
    actions: {
      requestRemoveFile: vi.fn(),
      handleClearAll: vi.fn(),
      handleQueueRetry: vi.fn(),
      openPreview: vi.fn(),
      openFile: vi.fn(),
      handleQueueStart: vi.fn(),
      handleQueueStop: vi.fn(),
      handleOpenSettings: vi.fn(),
      handleRemoveDoneFile: vi.fn(),
      setConfirmAction: vi.fn(),
      handleRetryFailedRevisionBlocks: vi.fn(),
    },
    autoContinue: true,
    setAutoContinue: vi.fn(),
    setIsJoinRoomOpen: vi.fn(),
    archiveSessions: [],
    isArchiveLoaded: true,
    dndSensors: [],
    handleDragEnd: vi.fn(),
    completedSessionFolderMap: new Map(),
  };

  it('renders welcome dashboard when queue is empty and idle', () => {
    render(<QueuePage {...defaultProps} />);
    expect(screen.getByText(/Progetto Open-Source/i)).toBeTruthy();
  });

  it('shows insecure api key banner when apiKeyInsecure is true', () => {
    render(
      <QueuePage
        {...defaultProps}
        auth={{
          ...defaultProps.auth,
          apiKeyInsecure: true,
          apiKeyInsecureReason: 'DPAPI non disponibile',
        }}
      />,
    );
    expect(screen.getByText(/La tua chiave API è salvata in chiaro/i)).toBeTruthy();
  });

  it('renders loading view when apiReady is false', () => {
    render(
      <QueuePage
        {...defaultProps}
        auth={{
          ...defaultProps.auth,
          apiReady: false,
        }}
      />,
    );
    expect(screen.getByText(/Connessione in corso/i)).toBeTruthy();
  });
});
