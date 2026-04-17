import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, memo, type CSSProperties, type FC, type KeyboardEvent } from 'react';
import ShikiHighlighter from 'react-shiki';
import { CopyIcon, CheckIcon, BracketsIcon, MinimizeIcon, FileTextIcon } from 'lucide-react';
import { copyTextToClipboard, logClipboardError } from '@/lib/clipboard';

/* ── Lazy-loaded heavy deps ── */
const lazyHljs = () => import('highlight.js').then((m) => m.default);
const lazyYAML = () => import('yaml');
const lazyGraphQL = () => import('graphql');
const lazyXmlFormat = () => import('xml-formatter').then((m) => m.default);
const lazyJsBeautify = () => import('js-beautify').then((m) => m.default ?? m);
const lazySanitizeHtml = () => import('sanitize-html').then((m) => m.default ?? m);
// html-minifier-next, postcss, @csstools/postcss-minify removed (Node-only, incompatible with renderer)
const lazyPrettier = () => import('prettier/standalone');
const lazyPrettierTs = () => import('prettier/plugins/typescript');
const lazyPrettierEstree = () => import('prettier/plugins/estree');
const lazyPrettierHtml = () => import('prettier/plugins/html');
const lazyPrettierCss = () => import('prettier/plugins/postcss');
const lazyPrettierYaml = () => import('prettier/plugins/yaml');
const lazyPrettierMarkdown = () => import('prettier/plugins/markdown');
const lazyPrettierBabel = () => import('prettier/plugins/babel');
const lazyJson5 = () => import('json5');

/* ── Types ── */
export type ViewMode = 'original' | 'beautify' | 'minify';

type FormatInfo = {
  beautified: string;
  minified: string;
  modes: ViewMode[];
};

/* ── Formatting helpers ── */

async function prettierFormat(
  code: string, parser: string,
  pluginLoaders: (() => Promise<unknown>)[],
  extraOptions?: Record<string, unknown>,
): Promise<string> {
  const [prettier, ...plugins] = await Promise.all([lazyPrettier(), ...pluginLoaders.map((p) => p())]);
  const formatted = await prettier.format(code, { parser, plugins: plugins as never[], tabWidth: 2, ...extraOptions });
  return formatted.trimEnd();
}

// CSS minification: simple regex-based fallback (postcss removed — Node-only)
function minifyCssSimple(css: string): string {
  return css
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\s*([{}:;,])\s*/g, '$1')
    .replaceAll(/;}/g, '}')
    .trim();
}

function minifyJsFallback(js: string): string {
  return js
    .replaceAll(/\/\/.*$/gm, '')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\s{2,}/g, ' ')
    .replaceAll(/\s*([{}();,=+\-<>!&|:?])\s*/g, '$1')
    .trim();
}

async function minifyJs(js: string): Promise<string> {
  try {
    // esbuild-wasm not used in Electron renderer (too heavy) — use regex fallback
    return minifyJsFallback(js);
  } catch {
    return minifyJsFallback(js);
  }
}

async function beautifyJs(js: string): Promise<string> {
  try {
    return await prettierFormat(js, 'typescript', [lazyPrettierEstree, lazyPrettierTs]);
  } catch {
    const { js: jsBeautify } = await lazyJsBeautify();
    return jsBeautify(js, { indent_size: 2 });
  }
}

/* ── Language detection ── */

export async function detectLanguage(text: string): Promise<string> {
  try { JSON.parse(text); return 'json'; } catch { /* not json */ }
  try {
    const YAML = await lazyYAML();
    const parsed = YAML.parse(text);
    if (parsed != null && typeof parsed === 'object') return 'yaml';
  } catch { /* not yaml */ }
  const trimmed = text.trim();
  if (/^\s*(query|mutation|subscription|fragment)\s+/i.test(trimmed) ||
    (/^\s*\{/.test(trimmed) && /\s*\{[^{]*[a-zA-Z_]\w*(\s*\([^)]*\))?\s*\{/.test(trimmed))) {
    try {
      const { parse: parseGraphQL } = await lazyGraphQL();
      parseGraphQL(trimmed);
      return 'graphql';
    } catch { /* not graphql */ }
  }
  if (/^<[a-zA-Z?!]/.test(trimmed)) {
    if (/<!doctype\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed) ||
      /<(?:div|span|p|body|head|script|style|link|meta|form|table|ul|ol|nav|header|footer|section)[\s>/]/i.test(trimmed)) {
      return 'html';
    }
    return 'xml';
  }
  const hljs = await lazyHljs();
  const result = hljs.highlightAuto(text);
  return result.language ?? 'text';
}

/* ── Format analysis ── */

const ASYNC_LANGUAGES = ['yaml', 'graphql', 'xml', 'html', 'css', 'less', 'scss', 'javascript', 'js', 'typescript', 'ts', 'markdown', 'md', 'mdx', 'json5', 'jsonc', 'jsx', 'tsx'];

function analyzeJsonSync(text: string, language: string): FormatInfo | null {
  if (language !== 'json' || !text) return null;
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const beautified = JSON.stringify(parsed, null, 2);
    const minified = JSON.stringify(parsed);
    const modes: ViewMode[] = [];
    if (beautified !== trimmed) modes.push('beautify');
    if (minified !== trimmed) modes.push('minify');
    if (modes.length === 2) modes.push('original');
    return { beautified, minified, modes };
  } catch { return null; }
}

function buildModes(trimmed: string, beautified: string, minified: string): ViewMode[] {
  const modes: ViewMode[] = [];
  if (beautified !== trimmed) modes.push('beautify');
  if (minified !== trimmed) modes.push('minify');
  if (modes.length === 2) modes.push('original');
  return modes;
}

async function analyzeAsync(text: string, language: string): Promise<FormatInfo | null> {
  const trimmed = text.trim();

  if (language === 'yaml') {
    try {
      const YAML = await lazyYAML();
      const parsed = YAML.parse(trimmed);
      if (parsed == null || typeof parsed !== 'object') return null;
      let beautified: string;
      try { beautified = await prettierFormat(trimmed, 'yaml', [lazyPrettierYaml]); }
      catch { beautified = YAML.stringify(parsed, { indent: 2 }).trimEnd(); }
      const minified = JSON.stringify(parsed);
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (language === 'graphql') {
    try {
      const { parse: parseGQL, print: printGQL } = await lazyGraphQL();
      const parsed = parseGQL(trimmed);
      const beautified = printGQL(parsed);
      const minified = beautified.replaceAll(/\s+/g, ' ').replaceAll(/\s*([{}(),:])\s*/g, '$1').trim();
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (language === 'xml') {
    try {
      const xmlFormat = await lazyXmlFormat();
      const beautified = xmlFormat(trimmed, { indentation: '  ', lineSeparator: '\n', collapseContent: true });
      const minified = xmlFormat(trimmed, { indentation: '', lineSeparator: '', collapseContent: true });
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (language === 'html') {
    try {
      let beautified: string;
      try {
        beautified = await prettierFormat(trimmed, 'html', [lazyPrettierHtml, lazyPrettierCss, lazyPrettierTs, lazyPrettierEstree, lazyPrettierBabel], { htmlWhitespaceSensitivity: 'ignore' });
      } catch {
        const { html: htmlBeautify } = await lazyJsBeautify();
        beautified = htmlBeautify(trimmed, { indent_size: 2 });
      }
      // HTML minification/sanitization using a parser-backed sanitizer
      const sanitizeHtml = await lazySanitizeHtml();
      const sanitized = sanitizeHtml(trimmed, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: 'discard',
      });

      const minified = sanitized
        .replaceAll(/\s{2,}/g, ' ')
        .trim();
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (language === 'css') {
    try {
      let beautified: string;
      try { beautified = await prettierFormat(trimmed, 'css', [lazyPrettierCss]); }
      catch { const { css: cssBeautify } = await lazyJsBeautify(); beautified = cssBeautify(trimmed, { indent_size: 2 }); }
      const minified = minifyCssSimple(trimmed);
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (['ts', 'typescript', 'tsx'].includes(language)) {
    try {
      const beautified = await beautifyJs(trimmed);
      let minified = trimmed;
      try { minified = await minifyJs(trimmed); } catch { /* skip */ }
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (['js', 'javascript', 'jsx'].includes(language)) {
    try {
      const beautified = await beautifyJs(trimmed);
      let minified = trimmed;
      try { minified = await minifyJs(trimmed); } catch { /* skip */ }
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  if (['less', 'scss'].includes(language)) {
    try {
      const beautified = await prettierFormat(trimmed, language, [lazyPrettierCss]);
      if (beautified !== trimmed) return { beautified, minified: trimmed, modes: ['beautify'] };
    } catch { /* skip */ }
  }

  if (['markdown', 'md', 'mdx'].includes(language)) {
    try {
      const parser = language === 'mdx' ? 'mdx' : 'markdown';
      const beautified = await prettierFormat(trimmed, parser, [lazyPrettierMarkdown]);
      if (beautified !== trimmed) return { beautified, minified: trimmed, modes: ['beautify'] };
    } catch { /* skip */ }
  }

  if (['json5', 'jsonc'].includes(language)) {
    try {
      const JSON5 = (await lazyJson5()).default;
      const parsed = JSON5.parse(trimmed);
      const beautified = await prettierFormat(trimmed, 'json5', [lazyPrettierBabel, lazyPrettierEstree]);
      const minified = JSON.stringify(parsed);
      const modes = buildModes(trimmed, beautified, minified);
      return modes.length > 0 ? { beautified, minified, modes } : null;
    } catch { /* skip */ }
  }

  return null;
}

function useFormatInfo(text: string, language: string): FormatInfo | null {
  const syncResult = useMemo(() => analyzeJsonSync(text, language), [text, language]);
  const [asyncResult, setAsyncResult] = useState<FormatInfo | null>(null);

  useEffect(() => {
    if (!ASYNC_LANGUAGES.includes(language)) { setAsyncResult(null); return; }
    let cancelled = false;
    analyzeAsync(text, language).then((r) => { if (!cancelled) setAsyncResult(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [text, language]);

  return syncResult ?? asyncResult;
}

/* ── Mode cycling ── */

const modeIcons: Record<ViewMode, typeof BracketsIcon> = { beautify: BracketsIcon, minify: MinimizeIcon, original: FileTextIcon };
const modeTooltips: Record<ViewMode, string> = { beautify: 'Beautify', minify: 'Minify', original: 'Show original' };

function nextMode(current: ViewMode, available: ViewMode[]): ViewMode {
  if (available.length === 0) return 'original';
  const cycle: ViewMode[] = ['original', ...available.filter((m) => m !== 'original')];
  const idx = cycle.indexOf(current);
  if (idx === -1) return cycle[0];
  return cycle[(idx + 1) % cycle.length];
}

/* ── Main component ── */

type CodeBlockProps = {
  code: string;
  language?: string;
  isError?: boolean;
  maxHeight?: string;
};

export const CodeBlock: FC<CodeBlockProps> = memo(({ code: rawCode, language, isError, maxHeight = '400px' }) => {
  const code = rawCode ?? '';
  const [viewMode, setViewMode] = useState<ViewMode>('original');
  const [copied, setCopied] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string>(language || 'text');

  useEffect(() => {
    if (language) { setDetectedLang(language); return; }
    let cancelled = false;
    detectLanguage(code).then((lang) => { if (!cancelled) setDetectedLang(lang); });
    return () => { cancelled = true; };
  }, [code, language]);

  const formatInfo = useFormatInfo(code, detectedLang);
  const availableModes = formatInfo?.modes ?? [];
  const canToggle = availableModes.length > 0;

  const displayCode = (() => {
    if (!formatInfo) return code;
    if (viewMode === 'beautify') return formatInfo.beautified;
    if (viewMode === 'minify') return formatInfo.minified;
    return code;
  })();

  const handleCopy = useCallback(async () => {
    try {
      await copyTextToClipboard(displayCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopied(false);
      logClipboardError('Failed to copy code block', error);
    }
  }, [displayCode]);

  const next = nextMode(viewMode, availableModes);
  const NextIcon = modeIcons[next];
  const isActive = viewMode !== 'original';

  return (
    <div className={`relative group/code ${isError ? 'ring-1 ring-destructive/30 rounded-md' : ''}`}>
      <div className="absolute right-2 bottom-2 flex items-center gap-1 z-10">
        {canToggle && (
          <button
            type="button"
            onClick={() => setViewMode(next)}
            title={modeTooltips[next]}
            className={`h-6 w-6 p-0 inline-flex items-center justify-center rounded opacity-0 group-hover/code:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm ${
              isActive ? 'text-blue-500 hover:text-blue-600 hover:bg-blue-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            <NextIcon className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          title="Copy code"
          className="h-6 w-6 p-0 inline-flex items-center justify-center rounded opacity-0 group-hover/code:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          {copied ? <CheckIcon className="h-3 w-3 text-green-500" /> : <CopyIcon className="h-3 w-3" />}
        </button>
      </div>
      <div className="rounded-md overflow-hidden" style={{ maxHeight, overflow: 'auto' }}>
        <ShikiHighlighter
          language={detectedLang}
          theme={{ light: 'light-plus', dark: 'dark-plus' }}
          style={{ margin: 0, fontSize: '0.75rem' }}
        >
          {displayCode}
        </ShikiHighlighter>
      </div>
    </div>
  );
});

type EditableCodeBlockProps = {
  code: string;
  language?: string;
  onChange: (nextCode: string) => void;
  onLanguageChange: (nextLanguage: string) => void;
  registerHandle?: (handle: { focusStart: () => void; focusEnd: () => void } | null) => void;
  onFocusEditor?: () => void;
  onMoveCaretBefore?: () => void;
  onMoveCaretAfter?: () => void;
  className?: string;
  autoFocus?: boolean;
};

export const EditableCodeBlock: FC<EditableCodeBlockProps> = memo(({
  code,
  language,
  onChange,
  onLanguageChange,
  registerHandle,
  onFocusEditor,
  onMoveCaretBefore,
  onMoveCaretAfter,
  className,
  autoFocus,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string>(language || 'text');
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const isEditorFocusedRef = useRef(false);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (language?.trim()) {
      setDetectedLang(language.trim());
      return;
    }

    let cancelled = false;
    detectLanguage(code).then((lang) => {
      if (!cancelled) setDetectedLang(lang);
    });
    return () => { cancelled = true; };
  }, [code, language]);

  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    registerHandle?.({
      focusStart: () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        isEditorFocusedRef.current = true;
        textarea.focus();
        textarea.setSelectionRange(0, 0);
        selectionRef.current = { start: 0, end: 0 };
      },
      focusEnd: () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        isEditorFocusedRef.current = true;
        textarea.focus();
        const end = code.length;
        textarea.setSelectionRange(end, end);
        selectionRef.current = { start: end, end };
      },
    });
    return () => {
      registerHandle?.(null);
    };
  }, [code.length, registerHandle]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const selection = selectionRef.current;
    if (!textarea || !selection || !isEditorFocusedRef.current) return;

    textarea.focus();
    textarea.setSelectionRange(selection.start, selection.end);
  }, [code, language]);

  const previewLanguage = language?.trim() || detectedLang || 'text';
  const formatInfo = useFormatInfo(code, previewLanguage);
  const editorHeight = Math.min(Math.max((code.split('\n').length + 1) * 20 + 24, 140), 340);
  const editorTextStyle: CSSProperties = {
    margin: 0,
    padding: '1rem',
    minHeight: editorHeight,
    boxSizing: 'border-box',
    fontSize: '0.75rem',
    lineHeight: '1.25rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    tabSize: 2,
    whiteSpace: 'pre',
    overflowWrap: 'normal',
  };

  const handleCopy = useCallback(async () => {
    try {
      await copyTextToClipboard(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopied(false);
      logClipboardError('Failed to copy code block', error);
    }
  }, [code]);

  const applyTransform = useCallback((mode: Extract<ViewMode, 'beautify' | 'minify'>) => {
    if (!formatInfo) return;
    const nextCode = mode === 'beautify' ? formatInfo.beautified : formatInfo.minified;
    if (!nextCode || nextCode === code) return;
    onChange(nextCode);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [code, formatInfo, onChange]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    const textarea = textareaRef.current;

    if (event.key === 'Tab') {
      event.preventDefault();
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const nextCode = `${code.slice(0, start)}  ${code.slice(end)}`;
      selectionRef.current = { start: start + 2, end: start + 2 };
      onChange(nextCode);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + 2, start + 2);
      });
    }

    if (
      textarea
      && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && textarea.selectionStart === textarea.selectionEnd
      && textarea.selectionStart === 0
    ) {
      event.preventDefault();
      onMoveCaretBefore?.();
    }

    if (
      textarea
      && (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && textarea.selectionStart === textarea.selectionEnd
      && textarea.selectionEnd === code.length
    ) {
      event.preventDefault();
      onMoveCaretAfter?.();
    }
  }, [code, onChange, onMoveCaretAfter, onMoveCaretBefore]);

  return (
    <div className={`rounded-xl border border-border/70 bg-card/70 ${className ?? ''}`}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Code</span>
        <input
          type="text"
          value={language ?? ''}
          onChange={(event) => onLanguageChange(event.target.value)}
          onFocus={onFocusEditor}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="auto"
          className="h-7 w-24 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] font-medium outline-none focus:border-primary/60"
        />
        <div className="ml-auto flex items-center gap-1">
          {formatInfo?.modes.includes('beautify') && (
            <button
              type="button"
              onClick={() => applyTransform('beautify')}
              title="Beautify code"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <BracketsIcon className="h-3.5 w-3.5" />
            </button>
          )}
          {formatInfo?.modes.includes('minify') && (
            <button
              type="button"
              onClick={() => applyTransform('minify')}
              title="Minify code"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <MinimizeIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy code"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-b-xl" style={{ height: editorHeight }}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}>
            <ShikiHighlighter
              language={previewLanguage}
              theme={{ light: 'light-plus', dark: 'dark-plus' }}
              addDefaultStyles={false}
              style={editorTextStyle}
            >
              {code || ' '}
            </ShikiHighlighter>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(event) => {
            onFocusEditor?.();
            selectionRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
            onChange(event.target.value);
          }}
          onFocus={() => {
            isEditorFocusedRef.current = true;
            onFocusEditor?.();
            const textarea = textareaRef.current;
            if (textarea) {
              selectionRef.current = {
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
              };
            }
          }}
          onBlur={() => {
            isEditorFocusedRef.current = false;
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
            onFocusEditor?.();
          }}
          onKeyDown={handleKeyDown}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
            setScrollLeft(event.currentTarget.scrollLeft);
          }}
          onSelect={(event) => {
            selectionRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          spellCheck={false}
          className="absolute inset-0 w-full resize-none overflow-auto border-0 bg-transparent outline-none"
          style={{
            color: 'transparent',
            caretColor: 'var(--foreground)',
            WebkitTextFillColor: 'transparent',
            ...editorTextStyle,
          }}
        />
      </div>
    </div>
  );
});
