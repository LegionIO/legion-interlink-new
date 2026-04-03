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
  const [showPlaceholder, setShowPlaceholder] = useState(true);

  const shouldShowPlaceholder = (text: string): boolean => text.trim().length === 0;

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
        setShowPlaceholder(shouldShowPlaceholder(runtimeText));
        if (el && document.activeElement !== el) {
          el.innerHTML = toHighlightedHTML(runtimeText) || '<br>';
        } else if (el && runtimeText === '') {
          el.innerHTML = '<br>';
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
    setShowPlaceholder(shouldShowPlaceholder(text));
    if (editorRef.current) {
      editorRef.current.innerHTML = toHighlightedHTML(text) || '<br>';
    }
    if (autoFocus) editorRef.current?.focus();
  }, []);

  // --- Input handler ---
  const handleInput = () => {
    if (isComposingRef.current) return;
    const text = getPlainText();
    lastTextRef.current = text;
    const nowEmpty = text.length === 0;
    setShowPlaceholder(shouldShowPlaceholder(text));
    composerRuntime.setText(text);
    if (nowEmpty) {
      // Preserve a clickable empty line shell so modified Enter works from the start.
      const el = editorRef.current;
      if (el) {
        el.innerHTML = '<br>';
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

  const insertLineBreak = () => {
    const el = editorRef.current;
    if (!el) return;

    el.focus();
    document.execCommand('insertLineBreak');
    handleInput();
  };

  // --- Keyboard ---
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.shiftKey || e.altKey) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      insertLineBreak();
      return;
    }

    // Enter sends; Shift+Enter and Option+Enter insert a newline.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const text = getPlainText().trim();
      if (text) {
        composerRuntime.send();
        if (editorRef.current) editorRef.current.innerHTML = '<br>';
        lastTextRef.current = '';
        setShowPlaceholder(true);
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
    if (getPlainText().length === 0) {
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
      data-placeholder={showPlaceholder ? placeholder : undefined}
    />
  );
};
