import { type FC, type ReactNode, useState, useCallback, memo } from 'react';
import ReactMarkdown, { type Components, type Options, defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { RefreshCwIcon } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { cn } from '@/lib/utils';
import { unwrapContentString } from '@/lib/unwrap-content';

const rehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'video'],
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), __BRAND_MEDIA_PROTOCOL],
  },
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...((defaultSchema.attributes?.img as string[] | undefined) || []),
      'alt',
      'title',
      'width',
      'height',
    ],
    video: ['src', 'controls', 'title', 'width', 'height', 'autoplay', 'loop', 'muted', 'preload', 'poster'],
    source: ['src', 'type', 'media', 'sizes', 'srcSet', 'srcset'],
  },
};

const ChatImage: FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ alt, src, ...props }) => {
  const [reloadKey, setReloadKey] = useState(0);

  const handleReload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  // Append cache-buster on reload
  const imgSrc = src ? (reloadKey > 0 ? `${src}${src.includes('?') ? '&' : '?'}_r=${reloadKey}` : src) : undefined;

  return (
    <span className="relative inline-block group">
      <img
        alt={alt ?? ''}
        src={imgSrc}
        className="my-2 max-w-full rounded-lg object-contain"
        loading="lazy"
        {...props}
      />
      {/* Reload button overlay */}
      <button
        type="button"
        onClick={handleReload}
        className="absolute top-3 right-1 opacity-0 group-hover:opacity-80 transition-opacity bg-black/60 hover:bg-black/80 text-white rounded-md p-1"
        title="Reload image"
      >
        <RefreshCwIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
};

/* ── Stable component overrides (hoisted to avoid re-mount on every render) ── */

const MdP: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <p className={cn('my-4 text-[0.95rem] leading-7 text-foreground/95', className)} {...props}>{children}</p>
);
const MdLi: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <li className={cn('my-1.5 leading-7 marker:text-primary/70', className)} {...props}>{children}</li>
);
const MdH1: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <h1 className={cn('mt-8 mb-4 text-3xl font-semibold tracking-tight text-foreground', className)} {...props}>{children}</h1>
);
const MdH2: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <h2 className={cn('mt-7 mb-3 text-2xl font-semibold tracking-tight text-foreground', className)} {...props}>{children}</h2>
);
const MdH3: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <h3 className={cn('mt-6 mb-3 text-xl font-semibold text-foreground', className)} {...props}>{children}</h3>
);
const MdH4: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <h4 className={cn('mt-5 mb-2 text-lg font-semibold text-foreground', className)} {...props}>{children}</h4>
);
const MdH5: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <h5 className={cn('mt-4 mb-2 text-base font-semibold uppercase tracking-[0.08em] text-foreground/90', className)} {...props}>{children}</h5>
);
const MdH6: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <h6 className={cn('mt-4 mb-2 text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground', className)} {...props}>{children}</h6>
);
const MdStrong: FC<{ children?: ReactNode } & Record<string, unknown>> = ({ children, ...props }) => (
  <strong {...props}>{children}</strong>
);
const MdEm: FC<{ children?: ReactNode } & Record<string, unknown>> = ({ children, ...props }) => (
  <em {...props}>{children}</em>
);
const MdUl: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <ul className={cn('my-4 ml-6 list-disc space-y-1 text-[0.95rem] text-foreground/95', className)} {...props}>{children}</ul>
);
const MdOl: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <ol className={cn('my-4 ml-6 list-decimal space-y-1 text-[0.95rem] text-foreground/95', className)} {...props}>{children}</ol>
);
const MdBlockquote: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => (
  <blockquote
    className={cn('my-5 border-l-4 border-primary/35 bg-muted/35 py-2 pl-4 italic text-foreground/85', className)}
    {...props}
  >
    {children}
  </blockquote>
);
const MdHr: FC<{ className?: string } & Record<string, unknown>> = ({ className, ...props }) => (
  <hr className={cn('my-6 border-border/70', className)} {...props} />
);
const MdPre: FC<{ children?: ReactNode }> = ({ children }) => {
  const codeEl = Array.isArray(children) ? children[0] : children;
  if (codeEl && typeof codeEl === 'object' && 'props' in codeEl) {
    const { className, children: codeChildren } = codeEl.props as { className?: string; children?: unknown };
    const lang = className?.replace(/^language-/, '') || undefined;
    const text = typeof codeChildren === 'string' ? codeChildren : String(codeChildren ?? '');
    return <div className="my-4"><CodeBlock code={text.replace(/\n$/, '')} language={lang} /></div>;
  }
  return <pre className="bg-muted rounded-lg p-3 overflow-x-auto text-xs">{children}</pre>;
};
const MdCode: FC<{ children?: ReactNode; className?: string } & Record<string, unknown>> = ({ children, className, ...props }) => {
  const isInline = !className;
  if (isInline) {
    return (
      <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
        {children}
      </code>
    );
  }
  return <code className={className} {...props}>{children}</code>;
};
const MdA: FC<{ children?: ReactNode; href?: string } & Record<string, unknown>> = ({ children, href, ...props }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline" {...props}>
    {children}
  </a>
);
const MdImg: FC<{ node?: unknown } & React.ImgHTMLAttributes<HTMLImageElement>> = ({ node: _node, ...imgProps }) => <ChatImage {...imgProps} />;
const MdVideo: FC<{ children?: ReactNode; controls?: boolean } & Record<string, unknown>> = ({ children, ...props }) => (
  <video
    controls={props.controls ?? true}
    className="my-2 max-w-full rounded-lg"
    {...props}
  >
    {children}
  </video>
);
const MdTable: FC<{ children?: ReactNode } & Record<string, unknown>> = ({ children, ...props }) => (
  <div className="overflow-x-auto">
    <table className="border-collapse border border-border text-xs" {...props}>
      {children}
    </table>
  </div>
);
const MdTh: FC<{ children?: ReactNode } & Record<string, unknown>> = ({ children, ...props }) => (
  <th className="border border-border bg-muted px-2 py-1 text-left text-xs font-semibold" {...props}>
    {children}
  </th>
);
const MdTd: FC<{ children?: ReactNode } & Record<string, unknown>> = ({ children, ...props }) => (
  <td className="border border-border px-2 py-1 text-xs" {...props}>
    {children}
  </td>
);

const markdownComponents = {
  p: MdP,
  li: MdLi,
  h1: MdH1,
  h2: MdH2,
  h3: MdH3,
  h4: MdH4,
  h5: MdH5,
  h6: MdH6,
  strong: MdStrong,
  em: MdEm,
  ul: MdUl,
  ol: MdOl,
  blockquote: MdBlockquote,
  hr: MdHr,
  pre: MdPre,
  code: MdCode,
  a: MdA,
  img: MdImg,
  video: MdVideo,
  table: MdTable,
  th: MdTh,
  td: MdTd,
};

const remarkPlugins: NonNullable<Options['remarkPlugins']> = [remarkGfm];
const rehypePlugins: NonNullable<Options['rehypePlugins']> = [rehypeRaw, [rehypeSanitize, rehypeSanitizeOptions]];

/**
 * react-markdown's defaultUrlTransform only allows http(s), irc(s), mailto, and xmpp protocols.
 * We extend it to also allow our custom media protocol used for locally-generated media.
 */
const allowedProtocols = new RegExp('^' + __BRAND_MEDIA_PROTOCOL + ':', 'i');

function urlTransform(url: string, _key: string, _node: unknown): string {
  if (allowedProtocols.test(url)) return url;
  return defaultUrlTransform(url);
}

export const MarkdownText: FC<{ text: string }> = memo(({ text }) => {
  return (
    <div className="max-w-none break-words text-sm text-foreground">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={markdownComponents as Components}
      >
        {unwrapContentString(text)}
      </ReactMarkdown>
    </div>
  );
});
