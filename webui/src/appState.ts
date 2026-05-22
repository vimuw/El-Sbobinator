import { normalizeSessionPath } from './utils';

export type FileItem = {
  id: string;
  name: string;
  size: number;
  duration: number;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  phase: number;
  phaseText?: string;
  errorText?: string;
  errorDetail?: string;
  path?: string;
  outputHtml?: string;
  outputDir?: string;
  completedAt?: number;
  startedAt?: number;
  primaryModel?: string;
  effectiveModel?: string;
  resumeSession?: boolean;
  completionStatus?: 'completed' | 'completed_with_warnings';
  revisionFailedBlocks?: number[];
};



export function getPendingFiles(files: FileItem[]): FileItem[] {
  return files.filter(f => f.status !== 'done');
}

/** Always returns a new sorted array. Wrap in useMemo to avoid per-render allocations. */
export function getDoneFiles(files: FileItem[]): FileItem[] {
  return [...files.filter(f => f.status === 'done')]
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export type FileDescriptor = {
  id: string;
  path?: string;
  name: string;
  size: number;
  duration?: number;
  resume_session?: boolean;
};

export type AppStatus = 'idle' | 'processing' | 'canceling';

export type ProcessDonePayload = {
  cancelled?: boolean;
  completed?: number;
  completed_with_warnings?: number;
  failed?: number;
  total?: number;
  quota_exhausted?: boolean;
};

export function isSuccessfulProcessDone(data?: ProcessDonePayload | null): boolean {
  if (!data || data.cancelled) return false;
  return Number(data.completed ?? 0) > 0 && Number(data.completed_with_warnings ?? 0) === 0 && Number(data.failed ?? 0) === 0;
}

export type SetCurrentFilePayload = {
  index: number;
  id: string;
  total: number;
};

export type FileDonePayload = {
  index: number;
  id: string;
  output_html: string;
  output_dir: string;
  primary_model?: string;
  effective_model?: string;
  completion_status?: 'completed' | 'completed_with_warnings';
  revision_failed_blocks?: number[];
};

export type FileFailedPayload = {
  index: number;
  id: string;
  error: string;
  error_detail?: string;
};

export type WorkTotalsPayload = {
  chunks?: number | null;
  macro?: number | null;
};

export type WorkDonePayload = {
  kind: 'chunks' | 'macro';
  done: number;
  total?: number | null;
};


export type ProcessingState = {
  files: FileItem[];
  structuralVersion: number;
  appState: AppStatus;
  currentPhase: string;
  currentModel: string;
  activeProgress: number;
  currentFileIndex: number;
  currentBatchTotal: number;
  workTotals: {
    chunks: number;
    macro: number;
  };
  workDone: {
    chunks: number;
    macro: number;
  };
};

export type ProcessingAction =
  | { type: 'queue/add'; files: FileItem[] }
  | { type: 'queue/remove'; id: string }
  | { type: 'queue/reorder'; fromIndex: number; toIndex: number }
  | { type: 'queue/update_source'; id?: string; sessionDir?: string; path?: string; name?: string; size?: number; duration?: number }
  | { type: 'queue/clear_completed' }
  | { type: 'queue/retry_failed' }
  | { type: 'queue/retry_one'; id: string }
  | { type: 'queue/update_revision_failed_blocks'; fileId?: string; sessionDir: string; blocks: number[]; htmlPath?: string; effectiveModel?: string }
  | { type: 'queue/clear_all' }
  | { type: 'app/set_status'; status: AppStatus }
  | { type: 'bridge/update_progress'; value: number }
  | { type: 'bridge/update_phase'; text: string }
  | { type: 'bridge/update_model'; model: string }
  | { type: 'bridge/process_done'; data: ProcessDonePayload }
  | { type: 'bridge/set_work_totals'; data: WorkTotalsPayload }
  | { type: 'bridge/update_work_done'; data: WorkDonePayload }
  | { type: 'bridge/set_current_file'; data: SetCurrentFilePayload }
  | { type: 'bridge/file_done'; data: FileDonePayload }
  | { type: 'bridge/file_failed'; data: FileFailedPayload };

export const initialProcessingState: ProcessingState = {
  files: [],
  structuralVersion: 0,
  appState: 'idle',
  currentPhase: '',
  currentModel: '',
  activeProgress: 0,
  currentFileIndex: 0,
  currentBatchTotal: 0,
  workTotals: { chunks: 0, macro: 0 },
  workDone: { chunks: 0, macro: 0 },
};

export function processingReducer(state: ProcessingState, action: ProcessingAction): ProcessingState {
  switch (action.type) {
    case 'queue/add':
      return { ...state, structuralVersion: state.structuralVersion + 1, files: [...state.files, ...action.files] };
    case 'queue/remove':
      return { ...state, structuralVersion: state.structuralVersion + 1, files: state.files.filter(file => file.id !== action.id) };
    case 'queue/reorder': {
      const { fromIndex, toIndex } = action;
      if (fromIndex === toIndex) return state;
      if (fromIndex < 0 || fromIndex >= state.files.length) return state;
      if (toIndex < 0 || toIndex >= state.files.length) return state;
      const files = [...state.files];
      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);
      return { ...state, structuralVersion: state.structuralVersion + 1, files };
    }
    case 'queue/update_source':
      return {
        ...state,
        structuralVersion: state.structuralVersion + 1,
        files: state.files.map(file =>
          (action.id ? file.id === action.id : false)
          || (action.sessionDir ? normalizeSessionPath(file.outputDir) === normalizeSessionPath(action.sessionDir) : false)
            ? {
                ...file,
                path: action.path ?? file.path,
                name: action.name ?? file.name,
                size: action.size ?? file.size,
                duration: action.duration ?? file.duration,
              }
            : file,
        ),
      };
    case 'queue/clear_completed':
      return { ...state, structuralVersion: state.structuralVersion + 1, files: state.files.filter(file => file.status !== 'done') };
    case 'queue/retry_failed':
      return {
        ...state,
        structuralVersion: state.structuralVersion + 1,
        files: state.files.map(file =>
          file.status === 'error'
            ? { ...file, status: 'queued', progress: 0, phase: 0, phaseText: undefined, errorText: undefined, errorDetail: undefined }
            : file,
        ),
      };
    case 'queue/retry_one':
      return {
        ...state,
        structuralVersion: state.structuralVersion + 1,
        files: state.files.map(file =>
          file.id === action.id && file.status === 'error'
            ? { ...file, status: 'queued', progress: 0, phase: 0, phaseText: undefined, errorDetail: undefined, errorText: undefined }
            : file,
        ),
      };
    case 'queue/update_revision_failed_blocks': {
      const targetDir = normalizeSessionPath(action.sessionDir);
      const hasFileIdMatch = action.fileId
        ? state.files.some(file => file.id === action.fileId)
        : false;
      let changed = false;
      const files = state.files.map(file => {
        const matches = hasFileIdMatch
          ? file.id === action.fileId
          : normalizeSessionPath(file.outputDir) === targetDir;
        if (!matches) return file;
        changed = true;
        return {
          ...file,
          revisionFailedBlocks: action.blocks,
          completionStatus: action.blocks.length > 0 ? ('completed_with_warnings' as const) : ('completed' as const),
          outputHtml: action.htmlPath ?? file.outputHtml,
          effectiveModel: action.effectiveModel ?? file.effectiveModel,
        };
      });
      if (!changed) return state;
      return { ...state, structuralVersion: state.structuralVersion + 1, files };
    }
    case 'queue/clear_all':
      return { ...state, structuralVersion: state.structuralVersion + 1, files: state.files.filter(file => file.status === 'done') };
    case 'app/set_status':
      return { ...state, appState: action.status };
    case 'bridge/update_progress': {
      const next = Math.round(action.value * 100);
      if (state.activeProgress === next) return state;
      return { ...state, activeProgress: next };
    }
    case 'bridge/update_phase':
      if (state.currentPhase === action.text) return state;
      return { ...state, currentPhase: action.text };
    case 'bridge/update_model':
      if (state.currentModel === action.model) return state;
      return { ...state, currentModel: action.model };
    case 'bridge/process_done':
      return {
        ...state,
        structuralVersion: action.data?.cancelled ? state.structuralVersion + 1 : state.structuralVersion,
        appState: 'idle',
        currentPhase: '',
        currentModel: '',
        activeProgress: action.data?.cancelled ? 0 : state.activeProgress,
        currentFileIndex: 0,
        currentBatchTotal: 0,
        workTotals: action.data?.cancelled ? { chunks: 0, macro: 0 } : state.workTotals,
        workDone: action.data?.cancelled ? { chunks: 0, macro: 0 } : state.workDone,
        files: action.data?.cancelled
          ? state.files.map(file =>
              file.status === 'processing'
                ? { ...file, status: 'queued', progress: 0, phase: 0, phaseText: undefined, errorText: undefined, errorDetail: undefined }
                : file,
            )
          : state.files,
      };
    case 'bridge/set_work_totals':
      return {
        ...state,
        workTotals: {
          chunks: Number(action.data.chunks ?? state.workTotals.chunks ?? 0),
          macro: Number(action.data.macro ?? state.workTotals.macro ?? 0),
        },
      };
    case 'bridge/update_work_done': {
      const prev = state.workDone[action.data.kind];
      const next = Number(action.data.done ?? 0);
      if (prev === next) return state;
      return {
        ...state,
        workDone: {
          ...state.workDone,
          [action.data.kind]: next,
        },
      };
    }

    case 'bridge/set_current_file':
      return {
        ...state,
        structuralVersion: state.structuralVersion + 1,
        appState: 'processing',
        currentPhase: '',
        currentModel: '',
        activeProgress: 0,
        currentFileIndex: action.data.index,
        currentBatchTotal: action.data.total,
        files: state.files.map(file =>
          file.id === action.data.id
            ? { ...file, status: 'processing', progress: 0, phase: 1, phaseText: undefined, errorText: undefined, errorDetail: undefined, startedAt: Date.now() }
            : file,
        ),
      };
    case 'bridge/file_done':
      return {
        ...state,
        structuralVersion: state.structuralVersion + 1,
        activeProgress: 0,
        files: state.files.map(file =>
          file.id === action.data.id
            ? {
                ...file,
                status: 'done',
                progress: 100,
                phase: 3,
                outputHtml: action.data.output_html,
                outputDir: action.data.output_dir,
                phaseText: undefined,
                errorText: undefined,
                errorDetail: undefined,
                completedAt: Date.now(),
                primaryModel: action.data.primary_model || undefined,
                effectiveModel: action.data.effective_model || undefined,
                completionStatus: action.data.completion_status || (Array.isArray(action.data.revision_failed_blocks) && action.data.revision_failed_blocks.length > 0 ? 'completed_with_warnings' : 'completed'),
                revisionFailedBlocks: Array.isArray(action.data.revision_failed_blocks) ? action.data.revision_failed_blocks : [],
              }
            : file,
        ),
      };
    case 'bridge/file_failed':
      return {
        ...state,
        structuralVersion: state.structuralVersion + 1,
        files: state.files.map(file =>
          file.id === action.data.id
            ? {
                ...file,
                status: 'error',
                progress: 0,
                phase: 0,
                phaseText: 'Errore',
                errorText: action.data.error || 'Elaborazione non completata.',
                errorDetail: action.data.error_detail || undefined,
              }
            : file,
        ),
      };
    default:
      return state;
  }
}
