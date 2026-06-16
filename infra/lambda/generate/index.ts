import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({ region: 'ap-south-1' });

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

export const handler = async (event: any) => {
  const body = JSON.parse(event.body || '{}');
  const userMessage = body.message;

  if (!userMessage) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'message is required' }),
    };
  }

  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  };

  const command = new InvokeModelCommand({
    modelId: 'global.anthropic.claude-opus-4-5-20251101-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  const response = await client.send(command);

  // Decode the response bytes
  const responseText = new TextDecoder().decode(response.body);
  const responseJson = JSON.parse(responseText);

  // Claude's actual text is nested inside content[0].text
  const rawText = responseJson.content[0].text;

  // Parse the JSON Claude returned
  const result = JSON.parse(rawText);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
