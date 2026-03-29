import { useState, useEffect, type FC } from 'react';
import { DownloadIcon, FileTextIcon, FileJsonIcon, CopyIcon, CheckIcon, XIcon } from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface Message {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
  createdAt?: string;
}

interface Conversation {
  id: string;
  title?: string | null;
  fallbackTitle?: string | null;
  messages?: Message[];
  createdAt?: string;
  updatedAt?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
}

function messagesToMarkdown(conv: Conversation): string {
  const title = conv.title || conv.fallbackTitle || 'Conversation';
  const lines: string[] = [`# ${title}`, ''];
  if (conv.createdAt) lines.push(`_Created: ${new Date(conv.createdAt).toLocaleString()}_`, '');
  lines.push('---', '');

  for (const msg of conv.messages || []) {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role === 'system' ? 'System' : msg.role;
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((p) => p.type === 'text').map((p) => p.text || '').join('\n')
        : '';
    lines.push(`## ${role}`, '', text, '', '---', '');
  }
  return lines.join('\n');
}

function messagesToJson(conv: Conversation): string {
  return JSON.stringify({
    id: conv.id,
    title: conv.title || conv.fallbackTitle || null,
    created_at: conv.createdAt,
    updated_at: conv.updatedAt,
    message_count: conv.messages?.length || 0,
    messages: (conv.messages || []).map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter((p) => p.type === 'text').map((p) => p.text || '').join('\n') : '',
      created_at: m.createdAt,
    })),
  }, null, 2);
}

function messagesToText(conv: Conversation): string {
  const title = conv.title || conv.fallbackTitle || 'Conversation';
  const lines: string[] = [title, '='.repeat(title.length), ''];

  for (const msg of conv.messages || []) {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((p) => p.type === 'text').map((p) => p.text || '').join('\n')
        : '';
    lines.push(`[${role}]`, text, '');
  }
  return lines.join('\n');
}

type ExportFormat = 'markdown' | 'json' | 'text';

export const ExportDialog: FC<Props> = ({ open, onClose, conversationId }) => {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [preview, setPreview] = useState('');
  const [copied, setCopied] = useState(false);
  const [conv, setConv] = useState<Conversation | null>(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    void legion.conversations.get(conversationId).then((c) => {
      setConv(c as Conversation);
    });
  }, [open, conversationId]);

  useEffect(() => {
    if (!conv) { setPreview(''); return; }
    switch (format) {
      case 'markdown': setPreview(messagesToMarkdown(conv)); break;
      case 'json': setPreview(messagesToJson(conv)); break;
      case 'text': setPreview(messagesToText(conv)); break;
    }
  }, [conv, format]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = format === 'json' ? '.json' : format === 'markdown' ? '.md' : '.txt';
    const mime = format === 'json' ? 'application/json' : 'text/plain';
    const name = (conv?.title || conv?.fallbackTitle || 'conversation').replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 50).trim().replace(/\s+/g, '-');
    const blob = new Blob([preview], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  const msgCount = conv?.messages?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl rounded-xl border border-border/50 bg-popover/95 shadow-2xl backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <DownloadIcon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Export Conversation</h2>
            <span className="text-[10px] text-muted-foreground">{msgCount} messages</span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted/40 transition-colors">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Format selector */}
        <div className="flex items-center gap-2 border-b border-border/30 px-5 py-2">
          {([
            { key: 'markdown' as const, label: 'Markdown', icon: FileTextIcon },
            { key: 'json' as const, label: 'JSON', icon: FileJsonIcon },
            { key: 'text' as const, label: 'Plain Text', icon: FileTextIcon },
          ]).map((f) => (
            <button key={f.key} type="button" onClick={() => setFormat(f.key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${
                format === f.key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40'
              }`}>
              <f.icon className="h-3 w-3" />{f.label}
            </button>
          ))}
        </div>

        {/* Preview */}
        <div className="max-h-[40vh] overflow-y-auto p-4">
          <pre className="whitespace-pre-wrap text-[11px] font-mono text-muted-foreground leading-relaxed">
            {preview || 'No messages to export.'}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border/30 px-5 py-3">
          <button type="button" onClick={() => void handleCopy()}
            className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 transition-colors">
            {copied ? <CheckIcon className="h-3 w-3 text-emerald-400" /> : <CopyIcon className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={handleDownload} disabled={!preview}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            <DownloadIcon className="h-3 w-3" />Download
          </button>
        </div>
      </div>
    </div>
  );
};
