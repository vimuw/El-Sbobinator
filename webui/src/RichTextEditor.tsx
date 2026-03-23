import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Clipboard, Copy, FileText, Heading1, Heading2, Heading3, Heading4, Heading5, ImagePlus, Italic, List, ListOrdered, Printer, Quote, Redo, Scissors, Undo } from 'lucide-react';
import { FloatingImage } from './FloatingImage';

interface RichTextEditorProps {
  initialContent: string;
  onChange: (html: string) => void;
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Lettura immagine fallita.'));
    reader.readAsDataURL(file);
  });

const MenuBar = ({ editor, onInsertImages }: { editor: any; onInsertImages: (files: FileList | File[]) => void }) => {
  const [, forceUpdate] = React.useState({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!editor) return;
    const handleTransaction = () => forceUpdate({});
    editor.on('transaction', handleTransaction);
    return () => { editor.off('transaction', handleTransaction); };
  }, [editor]);

  if (!editor) return null;

  const toggleHeading = (level: 1 | 2 | 3 | 4 | 5) => {
    editor.chain().focus().toggleHeading({ level }).run();
  };

  const handlePrint = () => {
    const html = editor.getHTML();
    const printWindow = document.createElement('iframe');
    printWindow.style.position = 'fixed';
    printWindow.style.top = '5vh';
    printWindow.style.left = '5vw';
    printWindow.style.width = '90vw';
    printWindow.style.height = '90vh';
    printWindow.style.opacity = '0';
    printWindow.style.pointerEvents = 'none';
    printWindow.style.zIndex = '-1';
    document.body.appendChild(printWindow);

    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(el => el.outerHTML).join('\n');
    const doc = printWindow.contentWindow?.document;

    if (!doc) return;

    doc.open();
    doc.write(`
      <html>
        <head>
          <title>Sbobina</title>
          <meta charset="utf-8">
          ${styleLinks}
          <style>
            body { padding: 40px !important; background: white !important; color: black !important; }
            @media print { body { padding: 0 !important; } }
          </style>
        </head>
        <body>
          <div class="prose prose-sm sm:prose-base max-w-none tiptap-editor">
            ${html}
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
                setTimeout(() => {
                  window.parent.document.body.removeChild(window.frameElement);
                }, 1000);
              }, 750);
            };
          </script>
        </body>
      </html>
    `);
    doc.close();
  };

  const handleExportWord = async () => {
    const html = editor.getHTML();
    const docxTemplate = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Esporta Sbobina</title></head><body>
      ${html}
      </body></html>
    `;

    if (window.pywebview?.api?.export_docx) {
      const res = await window.pywebview.api.export_docx('Sbobina.doc', docxTemplate);
      if (!res.ok && res.error !== "Annullato dall'utente") {
        alert(`Errore salvataggio Word: ${res.error}`);
      }
    } else {
      const blob = new Blob(['\ufeff', docxTemplate], { type: 'application/msword;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Sbobina.doc';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const btnClass = (isActive: boolean) => `editor-button ${isActive ? 'is-active' : ''}`;

  return (
    <div className="editor-toolbar">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btnClass(editor.isActive('bold'))} title="Grassetto">
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btnClass(editor.isActive('italic'))} title="Corsivo">
        <Italic className="h-4 w-4" />
      </button>
      <div className="editor-separator" />
      <button type="button" onClick={() => toggleHeading(1)} className={btnClass(editor.isActive('heading', { level: 1 }))} title="Titolo 1">
        <Heading1 className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => toggleHeading(2)} className={btnClass(editor.isActive('heading', { level: 2 }))} title="Titolo 2">
        <Heading2 className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => toggleHeading(3)} className={btnClass(editor.isActive('heading', { level: 3 }))} title="Titolo 3">
        <Heading3 className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => toggleHeading(4)} className={btnClass(editor.isActive('heading', { level: 4 }))} title="Titolo 4">
        <Heading4 className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => toggleHeading(5)} className={btnClass(editor.isActive('heading', { level: 5 }))} title="Titolo 5">
        <Heading5 className="h-4 w-4" />
      </button>
      <div className="editor-separator" />
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btnClass(editor.isActive('bulletList'))} title="Elenco puntato">
        <List className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btnClass(editor.isActive('orderedList'))} title="Elenco numerato">
        <ListOrdered className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btnClass(editor.isActive('blockquote'))} title="Citazione">
        <Quote className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => imageInputRef.current?.click()} className="editor-button" title="Inserisci immagine">
        <ImagePlus className="h-4 w-4" />
      </button>
      <div className="editor-separator" />
      <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className="editor-button" title="Annulla">
        <Undo className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className="editor-button" title="Ripeti">
        <Redo className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={handleExportWord} className="editor-button" title="Esporta in Word (.doc)">
          <FileText className="h-4 w-4" />
        </button>
        <button type="button" onClick={handlePrint} className="editor-button" title="Stampa / Esporta in PDF">
          <Printer className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={event => {
          if (event.target.files?.length) {
            onInsertImages(event.target.files);
          }
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
};

export function RichTextEditor({ initialContent, onChange }: RichTextEditorProps) {
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<any>(null);

  const insertImageFiles = useCallback(async (inputFiles: FileList | File[]) => {
    const activeEditor = editorRef.current;
    if (!activeEditor) return;

    const files = Array.from(inputFiles).filter(file => file.type.startsWith('image/'));
    if (!files.length) return;

    for (const file of files) {
      const src = await readFileAsDataUrl(file);
      activeEditor
        .chain()
        .focus()
        .insertContent([
          {
            type: 'floatingImage',
            attrs: {
              src,
              alt: file.name,
              title: file.name,
              width: 56,
              layout: 'inline',
            },
          },
          {
            type: 'paragraph',
          },
        ])
        .run();
    }
  }, []);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.context-menu')) {
        return;
      }
      setContextMenu(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const menuWidth = 220;
    const menuHeight = 320;
    const padding = 12;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - padding);
    setContextMenu({
      x: Math.max(padding, x),
      y: Math.max(padding, y),
    });
  };

  const editor = useEditor({
    extensions: [StarterKit, FloatingImage],
    content: initialContent,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base max-w-none focus:outline-none min-h-[500px] p-6 tiptap-editor',
        spellcheck: 'false',
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor) {
      editorRef.current = editor;
    }
  }, [editor]);

  useEffect(() => {
    if (editor && initialContent !== editor.getHTML() && !editor.isFocused) {
      if (editor.isEmpty) {
        editor.commands.setContent(initialContent);
      }
    }
  }, [initialContent, editor]);

  return (
    <div className="editor-shell flex flex-1 min-h-0 w-full flex-col relative" onContextMenu={handleContextMenu}>
      <MenuBar editor={editor} onInsertImages={insertImageFiles} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {contextMenu && createPortal(
        <div
          className="context-menu fixed z-50 py-1 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => {
            e.stopPropagation();
            setContextMenu(null);
          }}
        >
          <button className="context-menu-item" onClick={() => { document.execCommand('cut'); editor?.chain().focus().run(); }}>
            <Scissors className="h-4 w-4" /> Taglia
          </button>
          <button className="context-menu-item" onClick={() => { document.execCommand('copy'); editor?.chain().focus().run(); }}>
            <Copy className="h-4 w-4" /> Copia
          </button>
          <button className="context-menu-item" onClick={async () => {
            try {
              const text = await navigator.clipboard.readText();
              editor?.commands.insertContent(text);
            } catch (_) {
              console.error('Clipboard permission denied');
            }
          }}>
            <Clipboard className="h-4 w-4" /> Incolla
          </button>
          <div className="editor-separator mx-3 my-1 w-auto" />
          <button className="context-menu-item" onClick={() => { editor?.chain().focus().toggleBold().run(); }}>
            <Bold className="h-4 w-4" /> Grassetto
          </button>
          <button className="context-menu-item" onClick={() => { editor?.chain().focus().toggleItalic().run(); }}>
            <Italic className="h-4 w-4" /> Corsivo
          </button>
          <button className="context-menu-item" onClick={() => imageInputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" /> Inserisci immagine
          </button>
          <button className="context-menu-item" onClick={() => { editor?.chain().focus().toggleHeading({ level: 1 }).run(); }}>
            <Heading1 className="h-4 w-4" /> Titolo 1
          </button>
          <button className="context-menu-item" onClick={() => { editor?.chain().focus().toggleHeading({ level: 2 }).run(); }}>
            <Heading2 className="h-4 w-4" /> Titolo 2
          </button>
        </div>
      , document.body)}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={event => {
          if (event.target.files?.length) {
            void insertImageFiles(event.target.files);
          }
          event.currentTarget.value = '';
          setContextMenu(null);
        }}
      />
    </div>
  );
}
