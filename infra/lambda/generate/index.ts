import Anthropic from '@anthropic-ai/sdk';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { getAnthropicApiKey } from '../shared/anthropicApiKey';
import { generateCdkCode } from '../shared/prompt';

const lambdaClient = new LambdaClient({});

const getSandboxFunctionName = () => {
  const functionName = process.env.SANDBOX_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('SANDBOX_FUNCTION_NAME is not configured');
  }

  return functionName;
};

const invokeSandbox = async (code: string, files?: Record<string, string>) => {
  const invokeResult = await lambdaClient.send(new InvokeCommand({
    FunctionName: getSandboxFunctionName(),
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({ code, files }),
  }));

  if (!invokeResult.Payload) {
    throw new Error('Sandbox Lambda returned an empty payload');
  }

  return JSON.parse(new TextDecoder().decode(invokeResult.Payload)) as Record<string, unknown>;
};

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
};

export const handler = async (event: any) => {
  const body = JSON.parse(event.body || '{}');
  const userMessage = body.message;

  if (!userMessage) {
    return {
      statusCode: 400,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: 'message is required' }),
    };
  }

  const anthropic = new Anthropic({
    apiKey: await getAnthropicApiKey(),
  });

  const result = await generateCdkCode(anthropic, userMessage);
  const sandboxResponse = await invokeSandbox(result.code, result.files);

  return {
    statusCode: 200,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({ ...result, ...sandboxResponse }),
  };
};
