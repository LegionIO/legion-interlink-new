import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type FC,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';

type EditableInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  className?: string;
  placeholder?: string;
  type?: 'text' | 'password';
  highlightBrand?: boolean;
};

/**
 * Single-line contentEditable input.
 * Uses the same cursor logic as EditableTextarea but restricted to one line.
 */
export const EditableInput: FC<EditableInputProps> = ({
  value,
  onChange,
  onSubmit,
  className = '',
  placeholder,
  type = 'text',
  highlightBrand = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);
  const [isEmpty, setIsEmpty] = useState(!value);

  const toHTML = useCallback((text: string): string => {
    if (!text) return '';
    if (type === 'password') return '•'.repeat(text.length);
    return text;
  }, [highlightBrand, type]);

  // --- Cursor save/restore (same as EditableTextarea) ---
  const saveCursorOffset = (): number => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return 0;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) return 0;
    let offset = 0;
    const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) return offset + range.startOffset;
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
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const getPlainText = (): string => {
    if (!editorRef.current) return '';
    return editorRef.current.textContent ?? '';
  };

  const reHighlight = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    const cursor = saveCursorOffset();
    const html = toHTML(text);
    if (el.innerHTML !== html) el.innerHTML = html;
    restoreCursorOffset(cursor);
  }, [toHTML]);

  // Sync from prop when not focused
  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    setIsEmpty(!value);
    const el = editorRef.current;
    if (el && document.activeElement !== el) {
      el.innerHTML = toHTML(value);
    }
  }, [value, toHTML]);

  // Initial render
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = toHTML(value);
      setIsEmpty(!value);
    }
  }, []);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const isFocused = document.activeElement === el;
    const cursor = isFocused ? saveCursorOffset() : null;
    el.innerHTML = toHTML(value);
    if (cursor !== null) restoreCursorOffset(cursor);
  }, [type, toHTML, value]);

  const handleInput = () => {
    const text = getPlainText();
    lastValueRef.current = text;
    const nowEmpty = !text;
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
      requestAnimationFrame(() => reHighlight(text));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/[\n\r]/g, ' ');
    document.execCommand('insertText', false, text);
  };

  const handleFocus = () => {
    const el = editorRef.current;
    if (!el || getPlainText()) return;
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
      onFocus={handleFocus}
      className={`outline-none whitespace-nowrap overflow-hidden app-ce-placeholder ${className}`}
      role="textbox"
      data-placeholder={isEmpty ? placeholder : undefined}
    />
  );
};
