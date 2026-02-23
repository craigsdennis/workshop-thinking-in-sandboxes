import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { SandboxAddon } from '@cloudflare/sandbox/xterm';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalBootstrapResult } from './types';

export function TerminalLab() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState('disconnected');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let terminal: Terminal | undefined;
    let addon: SandboxAddon | undefined;
    let fitAddon: FitAddon | undefined;
    let resizeObserver: ResizeObserver | undefined;

    async function connect() {
      try {
        const response = await fetch('/api/terminal/bootstrap');
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const bootstrap = (await response.json()) as TerminalBootstrapResult;
        if (!rootRef.current || disposed) return;

        terminal = new Terminal({
          cursorBlink: true,
          convertEol: true,
          fontSize: 14,
          lineHeight: 1.2,
          fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
          theme: {
            background: '#0f1115',
            foreground: '#f3f3f3'
          }
        });
        terminal.open(rootRef.current);
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        fitAddon.fit();
        terminal.writeln('Cloudflare Sandbox PTY connected');

        addon = new SandboxAddon({
          getWebSocketUrl: ({ sandboxId, sessionId, origin }) => {
            const params = new URLSearchParams({ id: sandboxId });
            if (sessionId) params.set('session', sessionId);
            return `${origin}/ws/terminal?${params.toString()}`;
          },
          onStateChange: (nextState, nextError) => {
            setState(nextState);
            if (nextError) {
              setError(nextError.message);
            }
          }
        });

        terminal.loadAddon(addon);
        addon.connect({ sandboxId: bootstrap.sandboxId, sessionId: bootstrap.sessionId });

        resizeObserver = new ResizeObserver(() => {
          fitAddon?.fit();
        });
        resizeObserver.observe(rootRef.current);
      } catch (connectError) {
        setError(connectError instanceof Error ? connectError.message : String(connectError));
      }
    }

    void connect();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      addon?.disconnect();
      terminal?.dispose();
    };
  }, []);

  return (
    <div className="terminal-wrap">
      <div className="terminal-meta">
        <span>PTY status: {state}</span>
        {error ? <span className="terminal-error">Error: {error}</span> : null}
      </div>
      <div ref={rootRef} className="terminal-root" />
    </div>
  );
}
