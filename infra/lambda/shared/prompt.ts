import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const GeneratedCdkCodeSchema = z.object({
  code: z.string().min(1),
  explanation: z.string().min(1),
  files: z.record(z.string(), z.string()).optional(),
});

export type GeneratedCdkCode = z.infer<typeof GeneratedCdkCodeSchema>;

export const SYSTEM_PROMPT = `You are an expert AWS CDK TypeScript engineer.
Your job is to generate production-ready AWS CDK TypeScript code from plain English descriptions.

Rules:
- Always respond with ONLY a JSON object, no markdown, no backticks, no explanation outside the JSON
- Format: { "code": "<entry TypeScript file>", "explanation": "<one sentence summary>", "files": { "<optional extra paths>": "<contents>" } }
- The sandbox executes the "code" field with ts-node as a single entry file named app.ts unless you also provide bin/app.ts in files
- Prefer ONE self-contained entry file in "code" with ALL stack classes defined inline
- Do NOT import from relative paths like '../lib/...' or './lib/...' unless you also include those files in "files"
- Always use least-privilege IAM policies - never use Action: '*' or Resource: '*'
- Always enable encryption at rest for S3, RDS, and DynamoDB
- Always use multi-AZ for RDS
- Import only from 'aws-cdk-lib' and 'constructs'

Example output:
{ "code": "import * as cdk from 'aws-cdk-lib';\\nimport * as s3 from 'aws-cdk-lib/aws-s3';\\nimport { Construct } from 'constructs';\\n\\nclass SecureBucketStack extends cdk.Stack {\\n  constructor(scope: Construct, id: string) {\\n    super(scope, id);\\n    new s3.Bucket(this, 'Bucket', { versioned: true, encryption: s3.BucketEncryption.S3_MANAGED });\\n  }\\n}\\n\\nconst app = new cdk.App();\\nnew SecureBucketStack(app, 'SecureBucketStack');\\napp.synth();", "explanation": "Creates a versioned S3 bucket with encryption." }`;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isRetryableAnthropicError = (error: unknown) => {
  const status = (error as { status?: number })?.status;
  return status === 429 || status === 529;
};

export interface AnthropicMessagesClient {
  messages: {
    create: (
      params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ) => Promise<Anthropic.Messages.Message>;
  };
}

export const createMessageWithRetry = async (
  anthropic: AnthropicMessagesClient,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
) => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await anthropic.messages.create(params);
    } catch (error) {
      if (!isRetryableAnthropicError(error) || attempt === maxAttempts) {
        throw error;
      }

      await delay(250 * 2 ** (attempt - 1));
    }
  }

  throw new Error('Anthropic request failed after retries');
};

export const generateCdkCode = async (
  anthropic: AnthropicMessagesClient,
  userMessage: string,
): Promise<GeneratedCdkCode> => {
  const response = await createMessageWithRetry(anthropic, {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const rawText = response.content
    .filter((contentBlock): contentBlock is Anthropic.TextBlock => contentBlock.type === 'text')
    .map((contentBlock) => contentBlock.text)
    .join('');

  return GeneratedCdkCodeSchema.parse(JSON.parse(rawText));
};
