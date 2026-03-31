import { useRef, useState, useEffect, useCallback, type FC, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useComposerRuntime } from '@assistant-ui/react';
import { useAttachments } from '@/providers/AttachmentContext';

/**
 * Custom composer input using contentEditable that renders the product name
 * with the gradient animation. Replaces ComposerPrimitive.Input but
 * uses the same composer runtime for state management.
 */
export const ComposerInput: FC<{ placeholder?: string; className?: string; autoFocus?: boolean }> = ({
  placeholder = __BRAND_COMPOSER_PLACEHOLDER,
  className = '',
  autoFocus,
}) => {
  const composerRuntime = useComposerRuntime();
  const { addAttachments } = useAttachments();
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const lastTextRef = useRef('');
  const [isEmpty, setIsEmpty] = useState(true);

  // --- Cursor save/restore ---
  const saveCursorOffset = (): number => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return 0;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) return 0;

    let offset = 0;
    const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        return offset + range.startOffset;
      }
      offset += node.textContent?.length ?? 0;
    }
    return offset;
  };

  const restoreCursorOffset = (charOffset: number) => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel) return;

    let remaining = charOffset;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
    }
    // Fallback: end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // --- Extract plain text ---
  const getPlainText = (): string => {
    if (!editorRef.current) return '';
    let text = '';
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName;
        if (tag === 'BR') { text += '\n'; return; }
        if ((tag === 'DIV' || tag === 'P') && text.length > 0 && !text.endsWith('\n')) text += '\n';
        for (const child of Array.from(node.childNodes)) walk(child);
      }
    };
    for (const child of Array.from(editorRef.current.childNodes)) walk(child);
    return text;
  };

  // --- Render highlighted HTML ---
  const toHighlightedHTML = (text: string): string => {
    if (!text) return '';
    return text.split('\n').join('<br>');
  };

  const rerenderContent = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    const cursor = saveCursorOffset();
    const html = toHighlightedHTML(text) || '<br>';
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
    restoreCursorOffset(cursor);
  }, []);

  // --- Sync from composer runtime (e.g. when text is cleared after send) ---
  useEffect(() => {
    const unsub = composerRuntime.subscribe(() => {
      const state = composerRuntime.getState();
      const runtimeText = state.text ?? '';
      if (runtimeText !== lastTextRef.current) {
        lastTextRef.current = runtimeText;
        const el = editorRef.current;
        setIsEmpty(!runtimeText.trim());
        if (el && document.activeElement !== el) {
          el.innerHTML = toHighlightedHTML(runtimeText);
        } else if (el && runtimeText === '') {
          el.innerHTML = '';
        }
      }
    });
    return unsub;
  }, [composerRuntime, rerenderContent]);

  // --- Initial render ---
  useEffect(() => {
    const state = composerRuntime.getState();
    const text = state.text ?? '';
    lastTextRef.current = text;
    setIsEmpty(!text.trim());
    if (editorRef.current) {
      editorRef.current.innerHTML = toHighlightedHTML(text);
    }
    if (autoFocus) editorRef.current?.focus();
  }, []);

  // --- Input handler ---
  const handleInput = () => {
    if (isComposingRef.current) return;
    const text = getPlainText();
    lastTextRef.current = text;
    const nowEmpty = !text.trim();
    setIsEmpty(nowEmpty);
    composerRuntime.setText(text);
    if (nowEmpty) {
      // Clear fully and reset cursor to start
      const el = editorRef.current;
      if (el) {
        el.innerHTML = '';
        const range = document.createRange();
        range.setStart(el, 0);
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
    } else {
      requestAnimationFrame(() => rerenderContent(text));
    }
  };

  // --- Keyboard ---
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Enter to send (Shift+Enter for newline)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const text = getPlainText().trim();
      if (text) {
        composerRuntime.send();
        if (editorRef.current) editorRef.current.innerHTML = '';
        lastTextRef.current = '';
        setIsEmpty(true);
      }
      return;
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      composerRuntime.cancel();
      return;
    }
    // Tab for spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  };

  // --- Paste: handle images as attachments, text as plain text ---
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));

    if (imageItems.length > 0) {
      e.preventDefault();
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          addAttachments([{
            name: file.name || `pasted-image-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
            mime: file.type,
            isImage: true,
            size: file.size,
            dataUrl: reader.result as string,
          }]);
        };
        reader.readAsDataURL(file);
      }
      // Also paste any text that came with it
      const text = e.clipboardData.getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
      return;
    }

    // Plain text paste
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const handleFocus = () => {
    const el = editorRef.current;
    if (!el) return;
    // When empty, place cursor at position 0
    if (!getPlainText().trim()) {
      const range = document.createRange();
      range.setStart(el, 0);
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={handleFocus}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={() => { isComposingRef.current = false; handleInput(); }}
      className={`outline-none whitespace-pre-wrap break-words app-ce-placeholder ${className}`}
      role="textbox"
      aria-multiline
      data-placeholder={isEmpty ? placeholder : undefined}
    />
  );
};
