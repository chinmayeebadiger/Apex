'use client';

import { useEffect, useRef } from 'react';
import {
  deployLogTone,
  formatDeployLogLine,
  type DeployEventMessage,
} from '../lib/deploy';
import type { GenerationStatus } from '../lib/types';

interface DeployLogPanelProps {
  events: DeployEventMessage[];
  status?: GenerationStatus;
}

const toneColor = (tone: ReturnType<typeof deployLogTone>) => {
  switch (tone) {
    case 'complete':
      return '\x1b[32m';
    case 'failed':
      return '\x1b[31m';
    case 'progress':
      return '\x1b[33m';
    default:
      return '\x1b[37m';
  }
};

export function DeployLogPanel({ events, status }: DeployLogPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{
    write: (data: string) => void;
    dispose: () => void;
    reset: () => void;
  } | null>(null);
  const writtenCountRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const mount = async () => {
      if (!containerRef.current) {
        return;
      }

      const [{ Terminal }, fitModule] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      await import('@xterm/xterm/css/xterm.css');

      if (disposed || !containerRef.current) {
        return;
      }

      const terminal = new Terminal({
        convertEol: true,
        disableStdin: true,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        theme: {
          background: '#020617',
          foreground: '#e2e8f0',
          cursor: '#020617',
        },
      });
      const fitAddon = new fitModule.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      termRef.current = terminal;
      writtenCountRef.current = 0;

      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);
    };

    void mount();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) {
      return;
    }

    if (events.length < writtenCountRef.current) {
      terminal.reset();
      writtenCountRef.current = 0;
    }

    for (let index = writtenCountRef.current; index < events.length; index += 1) {
      const event = events[index];
      const color = toneColor(deployLogTone(event.resourceStatus));
      terminal.write(`${color}${formatDeployLogLine(event)}\x1b[0m\r\n`);
    }

    writtenCountRef.current = events.length;
  }, [events]);

  if (!status || !['deploying', 'deployed', 'deploy_failed'].includes(status)) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          Deployment logs
        </span>
        <span className="text-[10px] font-medium text-slate-500">
          {status.replace('_', ' ')} · {events.length} events
        </span>
      </div>
      <div ref={containerRef} className="h-48 w-full px-2 py-2" />
    </div>
  );
}
