import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { MathEditorField } from './MathEditorField';

export function EditorMathComposer({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [snapshot] = useState(() => ({ doc: editor.state.doc, selection: editor.state.selection }));
  const [anchor] = useState(() => {
    const element = document.createElement('span');
    element.className = 'math-composer-anchor';
    element.contentEditable = 'false';
    return element;
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const key = new PluginKey('mathComposer');
    editor.registerPlugin(new Plugin({ key, props: {
      decorations: state => state.doc === snapshot.doc
        ? DecorationSet.create(state.doc, [Decoration.widget(snapshot.selection.from, anchor, {
          side: -1, stopEvent: () => true, ignoreSelection: true,
        })]) : DecorationSet.empty,
    } }));
    setReady(true);
    anchor.scrollIntoView?.({ block: 'nearest' });
    const dismissIfChanged = () => {
      if (editor.isDestroyed || editor.state.doc !== snapshot.doc) onClose();
    };
    editor.on('transaction', dismissIfChanged);
    editor.on('destroy', dismissIfChanged);
    return () => {
      editor.off('transaction', dismissIfChanged);
      editor.off('destroy', dismissIfChanged);
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
    };
  }, [editor, snapshot, anchor, onClose]);

  const close = (returnFocus: boolean) => {
    onClose();
    if (returnFocus && !editor.isDestroyed) editor.view.focus();
  };
  return ready ? createPortal(<MathEditorField onCancel={close} onCommit={(latex, returnFocus) => {
    if (editor.isDestroyed || editor.state.doc !== snapshot.doc) { close(returnFocus); return; }
    const node = editor.schema.nodes.mathInline.create({ latex });
    const tr = closeHistory(editor.state.tr).setSelection(snapshot.selection).replaceSelectionWith(node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to))).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
    close(returnFocus);
  }} />, anchor) : null;
}
