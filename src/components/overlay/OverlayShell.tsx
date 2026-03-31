import { useEffect, useState, type FC } from 'react';
import { app } from '@/lib/ipc-client';
import type { ComputerOverlayState } from '../../../shared/computer-use';
import { OverlayContent } from './OverlayContent';

export const OverlayShell: FC<{ sessionId: string }> = ({ sessionId }) => {
  const [state, setState] = useState<ComputerOverlayState | null>(null);

  // Strip all backgrounds from html/body so the transparent BrowserWindow works.
  // The app's globals.css sets background-color on body, which would otherwise
  // appear as a white/dark box behind the overlay content.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    document.body.style.backgroundImage = 'none';
  }, []);

  useEffect(() => {
    const unsubscribe = app.computerUse.onOverlayState((data) => {
      const overlayState = data as ComputerOverlayState;
      if (overlayState.sessionId === sessionId) {
        setState(overlayState);
      }
    });
    return unsubscribe;
  }, [sessionId]);

  if (!state) {
    return <div className="h-full w-full" />;
  }

  return <OverlayContent state={state} />;
};
