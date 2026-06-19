import Anthropic from '@anthropic-ai/sdk';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secretsManagerClient = new SecretsManagerClient({});
let cachedAnthropicApiKey: string | undefined;

const SYSTEM_PROMPT = `You are an expert AWS CDK TypeScript engineer.
Your job is to generate production-ready AWS CDK TypeScript code from plain English descriptions.

Rules:
- Always respond with ONLY a JSON object, no markdown, no backticks, no explanation outside the JSON
- Format: { "code": "<full CDK TypeScript code here>", "explanation": "<one sentence summary>" }
- Always use least-privilege IAM policies — never use Action: '*' or Resource: '*'
- Always enable encryption at rest for S3, RDS, and DynamoDB
- Always use multi-AZ for RDS
- Import only from 'aws-cdk-lib' and 'constructs'

Example output:
{ "code": "import * as cdk from 'aws-cdk-lib';\nimport * as s3 from 'aws-cdk-lib/aws-s3';\n...", "explanation": "Creates a versioned S3 bucket with encryption." }`;

const getAnthropicApiKey = async () => {
  if (cachedAnthropicApiKey) {
    return cachedAnthropicApiKey;
  }

  const secretId = process.env.ANTHROPIC_API_KEY_SECRET_ARN;
  if (!secretId) {
    throw new Error('ANTHROPIC_API_KEY_SECRET_ARN is not configured');
  }

  const response = await secretsManagerClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secretValue = response.SecretString;

  if (!secretValue) {
    throw new Error('Anthropic API key secret must contain a string value');
  }

  cachedAnthropicApiKey = secretValue;
  return cachedAnthropicApiKey;
};

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isRetryableAnthropicError = (error: unknown) => {
  const status = (error as { status?: number })?.status;
  return status === 429 || status === 529;
};

const createMessageWithRetry = async (
  anthropic: Anthropic,
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

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (event: any) => {
  const body = JSON.parse(event.body || '{}');
  const userMessage = body.message;

  if (!userMessage) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'message is required' }),
    };
  }

  const anthropic = new Anthropic({
    apiKey: await getAnthropicApiKey(),
  });

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

  // Parse the JSON Claude returned
  const result = JSON.parse(rawText);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(result),
  };
};

