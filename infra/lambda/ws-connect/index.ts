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
}) => {
  const { connectionId, domainName, stage } = event.requestContext;
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
