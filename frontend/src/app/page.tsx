'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  Copy, 
  Check, 
  Download, 
  History, 
  Send, 
  Plus, 
  Trash2, 
  Sparkles, 
  Code2, 
  CheckCircle2, 
  Server, 
  Loader2, 
  ArrowRight,
  Cpu
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ApprovalBar } from '../components/ApprovalBar';
import { CodeHighlight } from '../components/CodeHighlight';
import { CostEstimatePanel } from '../components/CostEstimatePanel';
import { DeployLogPanel } from '../components/DeployLogPanel';
import { DeploymentOutputsPanel } from '../components/DeploymentOutputsPanel';
import { DiffPanel } from '../components/DiffPanel';
import { PipelineSteps } from '../components/PipelineSteps';
import { SecurityFlagsPanel } from '../components/SecurityFlagsPanel';
import { usePipelineWebSocket } from '../hooks/usePipelineWebSocket';
import { getConversationId, resetConversationId } from '../lib/conversation';
import { isDeployStatus } from '../lib/deploy';
import { buildDiffFromChangeset } from '../lib/diff';
import { cn } from '../lib/utils';
import type { CostEstimate, GenerationItem, GenerationStatus, OrchestrationResponse, SecurityFlag } from '../lib/types';

const getOrchestrationUrl = () =>
  process.env.NEXT_PUBLIC_ORCHESTRATION_URL
  ?? process.env.NEXT_PUBLIC_API_GATEWAY_URL?.replace(/\/$/, '')
  ?? '';

const getApproveUrl = () => {
  const apiBase = process.env.NEXT_PUBLIC_API_GATEWAY_URL?.replace(/\/$/, '');
  return apiBase ? `${apiBase}/approve` : '';
};

const getHistoryUrl = (conversationId: string) => {
  const apiBase = process.env.NEXT_PUBLIC_API_GATEWAY_URL?.replace(/\/$/, '');
  return apiBase ? `${apiBase}/history?conversationId=${encodeURIComponent(conversationId)}` : '';
};

const mapHistoryRecord = (record: Record<string, unknown>): GenerationItem | null => {
  if (!record.generationId || !record.conversationId) {
    return null;
  }

  return {
    id: String(record.generationId),
    conversationId: String(record.conversationId),
    generationId: String(record.generationId),
    prompt: String(record.originalRequest ?? ''),
    code: String(record.generatedCdkCode ?? ''),
    explanation: String(record.generatedExplanation ?? 'No explanation recorded.'),
    status: (record.status as GenerationStatus) ?? 'failed',
    diff: buildDiffFromChangeset(record.changeset as Parameters<typeof buildDiffFromChangeset>[0]),
    costEstimate: record.costEstimate as CostEstimate | undefined,
    securityFlags: record.securityFlags as SecurityFlag[] | undefined,
    deploymentStackName: record.deploymentStackName
      ? String(record.deploymentStackName)
      : undefined,
    deploymentStackId: record.deploymentStackId
      ? String(record.deploymentStackId)
      : undefined,
    deploymentOutputs: record.deploymentOutputs as Record<string, string> | undefined,
    deploymentError: record.deploymentError ? String(record.deploymentError) : undefined,
    timestamp: record.createdAt ? new Date(String(record.createdAt)).getTime() : Date.now(),
  };
};

const formatStatusLabel = (status: GenerationStatus) =>
  status.replace(/_/g, ' ');

const EXAMPLE_PROMPTS = [
  {
    title: "ECS Fargate Auto-scaling App",
    text: "Deploy a containerized Node.js app on ECS Fargate with auto-scaling between 2 and 5 tasks."
  },
  {
    title: "Secure S3 Bucket with KMS",
    text: "Create a private S3 bucket with versioning enabled and customer-managed KMS key encryption."
  },
  {
    title: "Serverless API Gateway Stack",
    text: "An API Gateway HTTP API integrated with a Nodejs Lambda function that writes to a DynamoDB Table."
  }
];

export default function App() {
  const [history, setHistory] = useState<GenerationItem[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [conversationId, setConversationId] = useState(() => getConversationId());
  const [followUpFromGenerationId, setFollowUpFromGenerationId] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState('');
  const [activeItem, setActiveItem] = useState<GenerationItem | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    connectionId,
    isConnected,
    steps,
    resetSteps,
    deployEvents,
    deployStatus,
    resetDeploy,
  } = usePipelineWebSocket();

  // Temporary generation state before saving to history
  const [tempGeneration, setTempGeneration] = useState<GenerationItem | null>(null);

  const [copied, setCopied] = useState(false);
  const [isApprovalSubmitting, setIsApprovalSubmitting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reconciledTerminalRef = useRef<string | null>(null);
  const historyLoadedRef = useRef(false);

  const loadHistory = useCallback(async (targetConversationId: string) => {
    const historyUrl = getHistoryUrl(targetConversationId);
    if (!historyUrl) {
      return;
    }

    try {
      const response = await fetch(historyUrl);
      if (!response.ok) {
        return;
      }

      const data = await response.json() as { items?: Record<string, unknown>[] };
      const mapped = (data.items ?? [])
        .map(mapHistoryRecord)
        .filter((item): item is GenerationItem => item !== null);

      if (mapped.length > 0) {
        setHistory(mapped);
        setActiveItem((current) => current ?? mapped[0]);
      }
    } catch (loadError) {
      console.error('Failed to load history', loadError);
    }
  }, []);

  useEffect(() => {
    if (historyLoadedRef.current) {
      return;
    }

    historyLoadedRef.current = true;
    void loadHistory(conversationId);
  }, [conversationId, loadHistory]);

  // Keep a local cache for quick reloads; DynamoDB remains source of truth
  const saveHistory = (newHistory: GenerationItem[]) => {
    setHistory(newHistory);
    try {
      localStorage.setItem('apex_generation_history', JSON.stringify(newHistory));
    } catch (e) {
      console.error('Failed to save history to localStorage', e);
    }
  };

  const filteredHistory = history.filter((item) =>
    item.prompt.toLowerCase().includes(historySearch.toLowerCase()),
  );

  // Scroll to bottom of chat when active item or generation changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeItem, tempGeneration, isGenerating]);

  // Handle click on example prompt
  const handleExampleClick = (text: string) => {
    setPromptInput(text);
  };

  // Copy code to clipboard
  const handleCopyCode = () => {
    const codeToCopy = activeItem?.code || tempGeneration?.code;
    if (!codeToCopy) return;

    navigator.clipboard.writeText(codeToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Download code as .ts file
  const handleDownloadCode = () => {
    const codeToDownload = activeItem?.code || tempGeneration?.code;
    if (!codeToDownload) return;

    const element = document.createElement("a");
    const file = new Blob([codeToDownload], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = "generated-stack.ts";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Reset workspace for a new generation
  const handleNewStack = () => {
    setActiveItem(null);
    setTempGeneration(null);
    setPromptInput('');
    setError(null);
    setFollowUpFromGenerationId(null);
    resetSteps();
    resetDeploy();
    reconciledTerminalRef.current = null;
    const nextConversationId = resetConversationId();
    setConversationId(nextConversationId);
    setHistory([]);
  };

  // Delete specific history item
  const handleDeleteHistoryItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = history.filter(item => item.id !== id);
    saveHistory(updated);
    if (activeItem?.id === id) {
      setActiveItem(updated.length > 0 ? updated[0] : null);
    }
  };

  // Clear all history
  const handleClearAllHistory = () => {
    saveHistory([]);
    setActiveItem(null);
    setTempGeneration(null);
  };

  const submitApproval = async (action: 'approve' | 'cancel') => {
    const item = activeItem ?? tempGeneration;
    if (!item?.conversationId || !item?.generationId) {
      return;
    }

    const approveUrl = getApproveUrl();
    if (!approveUrl) {
      setError('NEXT_PUBLIC_API_GATEWAY_URL is not configured for approval requests.');
      return;
    }

    setIsApprovalSubmitting(true);
    setError(null);

    try {
      const response = await fetch(approveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: item.conversationId,
          generationId: item.generationId,
          action,
          connectionId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `Approval request failed with status ${response.status}`);
      }

      const updatedItem: GenerationItem = {
        ...item,
        status: data.status,
        deploymentStackName: data.item?.deploymentStackName ?? item.deploymentStackName,
        deploymentStackId: data.item?.deploymentStackId ?? item.deploymentStackId,
        deploymentOutputs: data.item?.deploymentOutputs ?? item.deploymentOutputs,
        deploymentError: data.item?.deploymentError ?? item.deploymentError,
      };

      const updatedHistory = history.map((entry) => (
        entry.id === item.id ? updatedItem : entry
      ));
      saveHistory(updatedHistory);
      setActiveItem(updatedItem);
      setTempGeneration(null);

      if (action === 'approve') {
        resetDeploy();
        reconciledTerminalRef.current = null;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approval request failed.');
    } finally {
      setIsApprovalSubmitting(false);
    }
  };

  // Trigger CDK code generation via orchestration pipeline
  const handleGenerate = async (e?: React.FormEvent, overridePrompt?: string) => {
    if (e) e.preventDefault();
    const requestText = (overridePrompt ?? promptInput).trim();
    if (!requestText || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setActiveItem(null);
    resetSteps();
    resetDeploy();
    reconciledTerminalRef.current = null;
    
    // Set temp state to show the user prompt in chat area immediately
    setTempGeneration({
      id: 'pending',
      conversationId: '',
      generationId: '',
      prompt: requestText,
      code: '',
      explanation: 'Generating CDK code, running sandbox synth, and building diff preview...',
      status: 'generating',
      timestamp: Date.now(),
    });

    const endpoint = getOrchestrationUrl();
    if (!endpoint) {
      setError('NEXT_PUBLIC_ORCHESTRATION_URL is not configured.');
      setIsGenerating(false);
      setTempGeneration(null);
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: requestText,
          conversationId,
          connectionId,
          followUpFromGenerationId: followUpFromGenerationId ?? undefined,
        }),
      });

      const data = await response.json() as OrchestrationResponse;

      if (!response.ok) {
        throw new Error(data.error ?? `Server returned code ${response.status}`);
      }

      if (!data.code) {
        throw new Error("Invalid response format. Expected generated CDK code.");
      }

      const newItem: GenerationItem = {
        id: data.generationId,
        conversationId: data.conversationId,
        generationId: data.generationId,
        prompt: requestText,
        code: data.code,
        explanation: data.explanation ?? 'CDK stack generated and validated in sandbox.',
        status: data.status,
        diff: data.diff,
        costEstimate: data.costEstimate,
        securityFlags: data.securityFlags,
        timestamp: Date.now(),
      };

      // Add to local history and set as active
      const updatedHistory = [newItem, ...history];
      saveHistory(updatedHistory);
      setActiveItem(newItem);
      setTempGeneration(null);
      if (!overridePrompt) {
        setPromptInput('');
      }
      setFollowUpFromGenerationId(null);
      void loadHistory(conversationId);

      // Play victory sound or confetti animation
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 }
      });

    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
      setTempGeneration(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const terminalDeployEvent = [...deployEvents].reverse().find((event) =>
    event.phase === 'complete' || event.phase === 'failed');

  useEffect(() => {
    if (!activeItem?.conversationId || !deployStatus) {
      return;
    }

    if (deployStatus !== 'deployed' && deployStatus !== 'deploy_failed') {
      return;
    }

    const terminalKey = `${activeItem.generationId}:${deployStatus}`;
    if (reconciledTerminalRef.current === terminalKey) {
      return;
    }

    reconciledTerminalRef.current = terminalKey;
    void loadHistory(activeItem.conversationId);
  }, [activeItem?.conversationId, activeItem?.generationId, deployStatus, loadHistory]);

  const handleRerun = () => {
    if (!activeItem?.prompt || isGenerating) {
      return;
    }

    setPromptInput(activeItem.prompt);
    void handleGenerate(undefined, activeItem.prompt);
  };

  // Determine current active item content to show in Workspace
  const currentPrompt = activeItem?.prompt || tempGeneration?.prompt || '';
  const currentCode = activeItem?.code || tempGeneration?.code || '';
  const currentExplanation = activeItem?.explanation || tempGeneration?.explanation || '';
  const currentStatus = (deployStatus && activeItem)
    ? deployStatus
    : (activeItem?.status || tempGeneration?.status);
  const currentDiff = activeItem?.diff || tempGeneration?.diff;
  const currentCostEstimate = activeItem?.costEstimate || tempGeneration?.costEstimate;
  const currentSecurityFlags = activeItem?.securityFlags || tempGeneration?.securityFlags;
  const currentStackName = terminalDeployEvent?.stackName ?? activeItem?.deploymentStackName;
  const currentStackId = terminalDeployEvent?.stackId ?? activeItem?.deploymentStackId;
  const currentDeploymentOutputs = terminalDeployEvent?.outputs ?? activeItem?.deploymentOutputs;
  const currentDeploymentError = currentStatus === 'deploy_failed'
    ? (terminalDeployEvent?.message ?? activeItem?.deploymentError)
    : activeItem?.deploymentError;
  const promptTimestamp = activeItem?.timestamp ?? tempGeneration?.timestamp ?? 0;
  const hasContent = !!(activeItem || tempGeneration);

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-slate-50/50 text-slate-800 font-sans overflow-hidden">
      
      {/* Sidebar: History */}
      <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-slate-200/80 bg-white flex flex-col h-48 md:h-full flex-shrink-0 select-none">
        
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-teal-600 flex items-center justify-center shadow-sm">
              <History className="h-4 w-4 text-white" />
            </div>
            <span className="font-semibold text-slate-700 text-sm">Stack History</span>
          </div>
          <button
            onClick={handleNewStack}
            className="p-1.5 rounded-lg hover:bg-slate-50 border border-slate-200/60 text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1 text-xs font-medium"
            title="New Generation Workspace"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        <div className="px-3 pb-2">
          <input
            type="search"
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
            placeholder="Search stack history..."
            className="w-full h-8 px-3 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:border-teal-500"
          />
        </div>

        {/* History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {filteredHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <History className="h-8 w-8 stroke-1 mb-2 text-slate-300" />
              <p className="text-xs">No generations yet</p>
              <p className="text-[10px] text-slate-400 mt-1 max-w-[160px]">
                Enter a prompt below to create your first CDK stack.
              </p>
            </div>
          ) : (
            filteredHistory.map((item) => {
              const isActive = activeItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setActiveItem(item);
                    setTempGeneration(null);
                    setError(null);
                  }}
                  className={cn(
                    "group relative p-3 rounded-xl cursor-pointer transition-all border text-left",
                    isActive
                      ? "bg-teal-50/50 border-teal-100/80 text-teal-900 shadow-sm"
                      : "bg-white border-transparent hover:bg-slate-50/70 hover:border-slate-100 text-slate-600 hover:text-slate-900"
                  )}
                >
                  <p className="font-medium text-xs truncate pr-5 leading-relaxed">
                    {item.prompt}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400">
                      {new Date(item.timestamp).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="text-[10px] uppercase text-slate-400">{formatStatusLabel(item.status)}</span>
                    <button
                      onClick={(e) => handleDeleteHistoryItem(e, item.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all absolute right-2.5 top-2.5"
                      title="Delete stack"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer */}
        {history.length > 0 && (
          <div className="p-3 border-t border-slate-100 bg-slate-50/30">
            <button
              onClick={handleClearAllHistory}
              className="w-full py-1.5 px-3 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 border border-transparent hover:border-rose-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear History
            </button>
          </div>
        )}
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Header */}
        <header className="h-16 border-b border-slate-200/80 bg-white flex items-center justify-between px-6 flex-shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-slate-900 flex items-center justify-center shadow-md shadow-slate-900/10">
              <Cpu className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-slate-900 tracking-tight flex items-center gap-1">
                Apex
                <span className="text-[10px] uppercase font-semibold text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100/50">
                  CDK AI
                </span>
              </span>
              <p className="text-[10px] text-slate-400">AWS Infrastructure Copilot</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100">
              <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="text-[10px] font-semibold text-slate-500">
                {isConnected ? 'Pipeline stream connected' : 'Pipeline stream offline'}
              </span>
            </div>
          </div>
        </header>

        {/* Workspace Body */}
        <main className="flex-1 flex overflow-hidden relative">
          
          {!hasContent ? (
            /* Empty State Container */
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50/30 overflow-y-auto">
              <div className="max-w-2xl w-full text-center space-y-6">
                
                {/* Hero section */}
                <div className="space-y-3">
                  <div className="mx-auto w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center text-teal-600 border border-teal-100 shadow-sm animate-pulse-glow">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                    Generate AWS CDK Stack Instantly
                  </h2>
                  <p className="text-slate-500 text-sm max-w-lg mx-auto">
                    Type your infrastructure description in plain English. Apex will generate a production-ready AWS CDK TypeScript stack.
                  </p>
                </div>

                {/* Example selection cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 text-left">
                  {EXAMPLE_PROMPTS.map((ex, index) => (
                    <div
                      key={index}
                      onClick={() => handleExampleClick(ex.text)}
                      className="p-4 bg-white border border-slate-200/70 rounded-2xl hover:border-teal-500/40 hover:shadow-md cursor-pointer transition-all duration-200 group flex flex-col justify-between"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Example {index + 1}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-teal-600 transition-colors" />
                        </div>
                        <h4 className="font-semibold text-xs text-slate-700">{ex.title}</h4>
                        <p className="text-[11px] text-slate-500 leading-normal">{ex.text}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Settings Alert / Disclaimer */}
                <div className="p-3.5 bg-slate-100/60 rounded-xl text-[11px] text-slate-400 inline-flex items-center gap-2 max-w-md mx-auto">
                  <Server className="h-3.5 w-3.5 shrink-0" />
                  <span>Deployment targets ap-south-1 using your AWS credentials.</span>
                </div>
              </div>
            </div>
          ) : (
            /* Active Generation Workspace (Split layout: Chat vs Code) */
            <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden">
              
              {/* Left Column: Chat Conversation */}
              <div className="w-full lg:w-[38%] border-b lg:border-b-0 lg:border-r border-slate-200/80 bg-white flex flex-col h-72 lg:h-full overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/20">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Conversation</span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-5">
                  {/* User Question */}
                  <div className="flex flex-col items-end space-y-1.5">
                    <div className="bg-slate-100 text-slate-800 text-xs px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] leading-relaxed shadow-sm">
                      {currentPrompt}
                    </div>
                    <span className="text-[10px] text-slate-400 px-1 font-medium">
                      You · {promptTimestamp
                        ? new Date(promptTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : 'now'}
                    </span>
                  </div>

                  {/* AI Explanation Response */}
                  <div className="flex flex-col items-start space-y-1.5">
                    <div className="bg-teal-50/40 border border-teal-100/50 text-slate-700 text-xs px-4 py-3 rounded-2xl rounded-tl-sm max-w-[90%] leading-relaxed shadow-sm">
                      {isGenerating ? (
                        <div className="flex items-center gap-2.5 text-teal-700">
                          <Loader2 className="h-4.5 w-4.5 animate-spin shrink-0 text-teal-600" />
                          <span className="font-medium animate-pulse">Analyzing requirement and writing CloudFormation definitions...</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-teal-700 font-semibold mb-1">
                            <Sparkles className="h-3.5 w-3.5 shrink-0" />
                            <span>Apex Copilot Solution</span>
                          </div>
                          <p className="text-slate-600">{currentExplanation}</p>
                          {currentStatus === 'awaiting_approval' && (
                            <div className="mt-2.5 pt-2 border-t border-teal-100/40 text-[10px] text-amber-600 flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              <span>Sandbox synth passed — awaiting your approval.</span>
                            </div>
                          )}
                          {currentStatus === 'deploying' && (
                            <div className="mt-2.5 pt-2 border-t border-teal-100/40 text-[10px] text-teal-700 flex items-center gap-1.5">
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                              <span>Deploying CloudFormation stack…</span>
                            </div>
                          )}
                          {currentStatus === 'deployed' && (
                            <div className="mt-2.5 pt-2 border-t border-teal-100/40 text-[10px] text-emerald-600 flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              <span>Stack deployed successfully.</span>
                            </div>
                          )}
                          {currentStatus === 'deploy_failed' && (
                            <div className="mt-2.5 pt-2 border-t border-teal-100/40 text-[10px] text-rose-600 flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              <span>Deployment failed — stack rolled back.</span>
                            </div>
                          )}
                          {!currentStatus || currentStatus === 'generating' ? (
                            <div className="mt-2.5 pt-2 border-t border-teal-100/40 text-[10px] text-slate-400 flex items-center gap-1.5">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span>Running full orchestration pipeline...</span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 px-1 font-medium">
                      Apex AI · {activeItem ? new Date(activeItem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}
                    </span>
                  </div>

                  {(isGenerating || steps.length > 0) && (
                    <div className="pt-2">
                      <PipelineSteps steps={steps} isActive={isGenerating} />
                    </div>
                  )}
                  
                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Right Column: Code + preview panels */}
              <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-100">
                {(currentDiff || currentCostEstimate || currentSecurityFlags || isDeployStatus(currentStatus)) && !isGenerating && (
                  <div className="border-b border-slate-200 bg-slate-50 p-4 space-y-3 overflow-y-auto max-h-[48%] shrink-0">
                    {currentStatus && (
                      <ApprovalBar
                        status={currentStatus}
                        onApprove={() => submitApproval('approve')}
                        onCancel={() => submitApproval('cancel')}
                        onRetryDeploy={() => submitApproval('approve')}
                        isSubmitting={isApprovalSubmitting}
                      />
                    )}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <DiffPanel diff={currentDiff} />
                      <CostEstimatePanel costEstimate={currentCostEstimate} />
                      <SecurityFlagsPanel flags={currentSecurityFlags} />
                    </div>
                    {isDeployStatus(currentStatus) && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        <DeployLogPanel events={deployEvents} status={currentStatus} />
                        <DeploymentOutputsPanel
                          status={currentStatus}
                          stackName={currentStackName}
                          stackId={currentStackId}
                          outputs={currentDeploymentOutputs}
                          deploymentError={currentDeploymentError}
                        />
                      </div>
                    )}
                    {activeItem && activeItem.status !== 'generating' && (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setFollowUpFromGenerationId(activeItem.generationId);
                            setPromptInput(`Refine the current stack: `);
                          }}
                          className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                        >
                          Refine this stack with a follow-up prompt
                        </button>
                        <button
                          type="button"
                          onClick={handleRerun}
                          disabled={isGenerating}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"
                        >
                          Re-run generation
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 bg-slate-900 flex flex-col min-h-0 overflow-hidden">
                
                {/* Editor Header Tab */}
                <div className="h-11 border-b border-slate-800/80 bg-slate-950 flex items-center justify-between px-4 select-none">
                  
                  {/* File name info */}
                  <div className="flex items-center gap-2.5">
                    <div className="h-4 w-4 bg-teal-500/10 rounded flex items-center justify-center border border-teal-500/20">
                      <Code2 className="h-2.5 w-2.5 text-teal-400" />
                    </div>
                    <span className="font-mono text-xs font-semibold text-slate-300">
                      generated-stack.ts
                    </span>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      TypeScript
                    </span>
                  </div>

                  {/* Actions */}
                  {currentCode && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopyCode}
                        className={cn(
                          "px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5",
                          copied 
                            ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
                            : "bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
                        )}
                        title="Copy to clipboard"
                      >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                      <button
                        onClick={handleDownloadCode}
                        className="px-2.5 py-1 rounded bg-slate-850 hover:bg-slate-800 border border-slate-700/60 text-slate-300 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5"
                        title="Download file"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </button>
                    </div>
                  )}
                </div>

                {/* Editor Body */}
                <div className="flex-1 overflow-auto bg-slate-950 font-mono relative scrollbar-editor">
                  {isGenerating ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-slate-950/70 backdrop-blur-[1px] space-y-3 z-10 select-none">
                      <div className="relative flex items-center justify-center">
                        <div className="w-10 h-10 border-2 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
                        <Sparkles className="w-4 h-4 text-teal-400 absolute" />
                      </div>
                      <p className="text-xs font-medium text-slate-300">Generating TypeScript CDK constructs...</p>
                    </div>
                  ) : null}

                  {currentCode ? (
                    <CodeHighlight code={currentCode} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 text-xs italic select-none">
                      Waiting for generation to finish...
                    </div>
                  )}
                </div>
                </div>
              </div>

            </div>
          )}

          {/* Error Message banner */}
          {error && (
            <div className="absolute top-4 right-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50 animate-in fade-in slide-in-from-top-4 max-w-sm">
              <span className="h-2 w-2 rounded-full bg-rose-600 animate-ping" />
              <div className="flex-1">
                <span className="font-semibold block">Generation Failed</span>
                <span className="text-[11px] text-rose-600 mt-0.5 block">{error}</span>
              </div>
              <button 
                onClick={() => setError(null)}
                className="text-rose-400 hover:text-rose-700 text-xs font-bold leading-none p-1"
              >
                ✕
              </button>
            </div>
          )}

        </main>

        {/* Bottom fixed prompt bar container */}
        <footer className="p-4 bg-white border-t border-slate-200/80 flex-shrink-0 select-none">
          <form onSubmit={handleGenerate} className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder={followUpFromGenerationId
                ? 'Describe how to refine the selected stack...'
                : "Ask Apex to generate some CDK stack (e.g. 'S3 bucket with KMS encryption')..."}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                disabled={isGenerating}
                className="w-full h-11 pl-4 pr-12 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 text-xs focus:bg-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all font-medium"
              />
              <div className="absolute right-3.5 top-3.5 text-slate-400 flex items-center gap-1.5 pointer-events-none">
                <span className="text-[10px] font-bold text-slate-400/70 border border-slate-200/80 bg-slate-100 px-1 py-0.5 rounded">Enter</span>
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isGenerating || !promptInput.trim()}
              className="h-11 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400 text-white font-semibold text-xs transition-all flex items-center gap-2 shadow-sm shrink-0"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  Generating
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Generate
                </>
              )}
            </button>
          </form>
        </footer>

      </div>
    </div>
  );
}
