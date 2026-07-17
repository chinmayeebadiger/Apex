export interface DiffResource {
  logicalId: string;
  resourceType: string;
  action: 'create' | 'modify' | 'delete';
  color: 'green' | 'blue' | 'red';
}

export interface DiffRenderModel {
  summary: string;
  resources: DiffResource[];
}

export interface ResourceEstimate {
  logicalId: string;
  monthlyCostUSD: number;
  basis: string;
}

export interface CostEstimate {
  resourceEstimates: ResourceEstimate[];
  totalMonthlyCostUSD: number;
}

export interface SecurityFlag {
  logicalId: string;
  severity: 'high' | 'medium';
  message: string;
}

export type GenerationStatus =
  | 'generating'
  | 'awaiting_approval'
  | 'approved'
  | 'cancelled'
  | 'failed';

export interface GenerationItem {
  id: string;
  conversationId: string;
  generationId: string;
  prompt: string;
  code: string;
  explanation: string;
  status: GenerationStatus;
  diff?: DiffRenderModel;
  costEstimate?: CostEstimate;
  securityFlags?: SecurityFlag[];
  timestamp: number;
}

export interface OrchestrationResponse {
  conversationId: string;
  generationId: string;
  status: GenerationStatus;
  code?: string;
  explanation?: string;
  diff?: DiffRenderModel;
  costEstimate?: CostEstimate;
  securityFlags?: SecurityFlag[];
  error?: string;
}
