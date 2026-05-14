/**
 * Load Monaco Editor via the official AMD `loader.js` from jsDelivr.
 * Avoids bundling Monaco into the Angular app (esbuild cannot load codicon.ttf from the ESM entry).
 *
 * @see https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-amd.md
 */

const MONACO_VERSION = '0.52.2';
const VS_ROOT = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

/** Minimal surface used by Team IDE (full `monaco` is attached to `window`). */
export type MonacoGlobal = {
  editor: {
    create: (dom: HTMLElement, opts: Record<string, unknown>) => MonacoEditor;
    createModel: (value: string, language: string | undefined, uri: MonacoUri) => MonacoTextModel;
    getModel: (uri: MonacoUri) => MonacoTextModel | null;
    getModelMarkers: (filter: { resource: MonacoUri }) => MonacoMarker[];
    setModelMarkers: (model: MonacoTextModel, owner: string, markers: MonacoMarkerData[]) => void;
  };
  Uri: { parse: (s: string) => MonacoUri };
  MarkerSeverity: { Error: number; Warning: number; Hint: number; Info: number };
};

export type MonacoUri = unknown;
export type MonacoTextModel = {
  uri: MonacoUri;
  getValue: () => string;
  getLanguageId: () => string;
  getLineCount: () => number;
  getLineMaxColumn: (line: number) => number;
  onDidChangeContent: (cb: () => void) => { dispose: () => void };
};
export type MonacoMarker = { message: string; severity: number; startLineNumber: number };
export type MonacoMarkerData = {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};
export type MonacoEditor = {
  getModel: () => MonacoTextModel | null;
  setModel: (m: MonacoTextModel) => void;
  dispose: () => void;
};

export function loadMonacoFromCdn(): Promise<MonacoGlobal> {
  const w = window as unknown as {
    monaco?: MonacoGlobal;
    require?: { config: (c: Record<string, unknown>) => void; (a: string[], ok: () => void, err?: (e: unknown) => void): void };
    __pqMonacoPromise?: Promise<MonacoGlobal>;
  };

  if (w.monaco) {
    return Promise.resolve(w.monaco);
  }
  if (!w.__pqMonacoPromise) {
    const loadPromise = new Promise<MonacoGlobal>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${VS_ROOT}/loader.js`;
      script.async = true;
      script.onload = () => {
        try {
          const req = w.require;
          if (!req) {
            reject(new Error('Monaco loader did not define require'));
            return;
          }
          req.config({ paths: { vs: VS_ROOT } });
          req(
            ['vs/editor/editor.main'],
            () => {
              const monaco = (window as unknown as { monaco?: MonacoGlobal }).monaco;
              if (!monaco) {
                reject(new Error('window.monaco missing after editor.main'));
                return;
              }
              resolve(monaco);
            },
            (err: unknown) => reject(err ?? new Error('Monaco editor.main failed'))
          );
        } catch (e) {
          reject(e);
        }
      };
      script.onerror = () => reject(new Error('Failed to load Monaco loader.js'));
      document.head.appendChild(script);
    });
    w.__pqMonacoPromise = loadPromise;
    void loadPromise.catch(() => {
      if (w.__pqMonacoPromise === loadPromise) {
        delete w.__pqMonacoPromise;
      }
    });
  }
  return w.__pqMonacoPromise;
}
