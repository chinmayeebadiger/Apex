import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

export const handler = async (event: {
  requestContext: {
    connectionId: string;
    domainName: string;
    stage: string;
  };
  body?: string;
}) => {
  const { connectionId, domainName, stage } = event.requestContext;

  if (!event.body) {
    return { statusCode: 400, body: 'Missing message body' };
  }

  let payload: { type?: string };
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  if (payload.type !== 'register') {
    return { statusCode: 400, body: 'Unsupported message type' };
  }

  const managementClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  await managementClient.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: Buffer.from(JSON.stringify({
      type: 'connected',
      connectionId,
    })),
  }));

  return { statusCode: 200 };
};
