import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type FC,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';

type EditableTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  highlightBrand?: boolean;
};

/**
 * An editable div that looks/behaves like a textarea.
 * Uses contentEditable with careful cursor preservation to avoid DOM thrash.
 */
export const EditableTextarea: FC<EditableTextareaProps> = ({
  value,
  onChange,
  className = '',
  placeholder,
  autoFocus,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  highlightBrand = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const lastValueRef = useRef(value);
  const [isEmpty, setIsEmpty] = useState(!value.trim());

  // Save and restore cursor position across re-highlights
  const saveCursor = (): { node: Node; offset: number } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) return null;

    // Walk text nodes to compute a flat character offset
    let charOffset = 0;
    const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        charOffset += range.startOffset;
        break;
      }
      charOffset += node.textContent?.length ?? 0;
    }
    return { node: range.startContainer, offset: charOffset };
  };

  const restoreCursor = (charOffset: number) => {
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

    // Fallback: place cursor at end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Extract plain text from editor
  const getPlainText = (): string => {
    if (!editorRef.current) return '';
    // Walk child nodes: <br> and block elements become \n, text nodes are text
    let text = '';
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName;
        if (tag === 'BR') {
          text += '\n';
        } else if (tag === 'DIV' || tag === 'P') {
          if (text.length > 0 && !text.endsWith('\n')) text += '\n';
          for (const child of Array.from(el.childNodes)) walk(child);
          return;
        }
        for (const child of Array.from(el.childNodes)) walk(child);
      }
    };
    for (const child of Array.from(editorRef.current.childNodes)) walk(child);
    return text;
  };

  const renderTextHTML = useCallback((text: string): string => {
    return text
      .split('\n')
      .map((line) => line)
      .join('<br>');
  }, [highlightBrand]);

  const syncEditorHTML = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const cursor = saveCursor();
    const text = getPlainText();

    const html = renderTextHTML(text);

    // Only update if content changed (avoid unnecessary DOM thrash)
    if (el.innerHTML !== html) {
      el.innerHTML = html || '<br>'; // empty contentEditable needs a <br> to be clickable
    }

    if (cursor) {
      restoreCursor(cursor.offset);
    }
  }, [renderTextHTML]);

  // Sync from external value prop (initial load, config changes when not focused)
  useEffect(() => {
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;

    const el = editorRef.current;
    if (!el || document.activeElement === el) return; // don't overwrite while editing

    const html = renderTextHTML(value);
    el.innerHTML = html || '<br>';
  }, [renderTextHTML, value]);

  // Initial render
  useEffect(() => {
    if (!editorRef.current) return;
    const html = renderTextHTML(value);
    editorRef.current.innerHTML = html;
    setIsEmpty(!value.trim());
    if (autoFocus) editorRef.current.focus();
  }, [autoFocus, renderTextHTML, value]);

  const handleInput = () => {
    if (isComposingRef.current) return;
    const text = getPlainText();
    lastValueRef.current = text;
    const nowEmpty = !text.trim();
    setIsEmpty(nowEmpty);
    onChange(text);
    if (nowEmpty) {
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
      requestAnimationFrame(syncEditorHTML);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Tab inserts spaces instead of moving focus
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  };

  // Paste as plain text
  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const handleBlur = () => {
    const text = getPlainText();
    if (text !== lastValueRef.current) {
      lastValueRef.current = text;
      onChange(text);
    }
    onBlurProp?.();
  };

  const handleFocus = () => {
    onFocusProp?.();
    const el = editorRef.current;
    if (!el || getPlainText().trim()) return;
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  };

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={() => { isComposingRef.current = false; handleInput(); }}
      className={`whitespace-pre-wrap break-words outline-none app-ce-placeholder ${className}`}
      role="textbox"
      aria-multiline
      data-placeholder={isEmpty ? placeholder : undefined}
    />
  );
};
