import { useState, useCallback, type FC, type ReactNode, type DragEvent } from 'react';
import { UploadIcon } from 'lucide-react';
import { useAttachments } from '@/providers/AttachmentContext';

export const DropZone: FC<{ children: ReactNode }> = ({ children }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const { addAttachments } = useAttachments();
  const dragCountRef = { current: 0 };

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const pending: Promise<void>[] = [];
    for (const file of files) {
      pending.push(
        new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const isText = file.type.startsWith('text/') || file.type === 'application/json';
            if (isText) {
              // Also read as text
              const textReader = new FileReader();
              textReader.onload = () => {
                addAttachments([{
                  name: file.name,
                  mime: file.type,
                  isImage: file.type.startsWith('image/'),
                  size: file.size,
                  dataUrl,
                  text: textReader.result as string,
                }]);
                resolve();
              };
              textReader.readAsText(file);
            } else {
              addAttachments([{
                name: file.name,
                mime: file.type,
                isImage: file.type.startsWith('image/'),
                size: file.size,
                dataUrl,
              }]);
              resolve();
            }
          };
          reader.readAsDataURL(file);
        }),
      );
    }
  }, [addAttachments]);

  return (
    <div
      className="relative h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Full-window drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 px-12 py-10">
            <UploadIcon className="h-10 w-10 text-primary/60" />
            <span className="text-lg font-medium text-primary/80">{__BRAND_DROP_ZONE_TEXT}</span>
            <span className="text-xs text-muted-foreground">Images, documents, code files</span>
          </div>
        </div>
      )}
    </div>
  );
};
