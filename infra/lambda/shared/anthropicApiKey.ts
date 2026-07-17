import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

let cachedAnthropicApiKey: string | undefined;

export const getAnthropicApiKey = async (
  secretsManagerClient = new SecretsManagerClient({}),
): Promise<string> => {
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
