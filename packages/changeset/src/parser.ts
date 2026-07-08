import {
  Change,
  Changeset,
  ChangesetSchema,
  CloudFormationTemplate,
  CloudFormationTemplateSchema,
} from './schemas.js';

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const normalizeProperties = (template: CloudFormationTemplate, logicalId: string): Record<string, unknown> =>
  template.Resources[logicalId]?.Properties ?? {};

const hasShallowPropertyChanges = (
  previousProperties: Record<string, unknown>,
  nextProperties: Record<string, unknown>,
): boolean => {
  const propertyNames = new Set([...Object.keys(previousProperties), ...Object.keys(nextProperties)]);

  for (const propertyName of propertyNames) {
    if (stableStringify(previousProperties[propertyName]) !== stableStringify(nextProperties[propertyName])) {
      return true;
    }
  }

  return false;
};

export const parseChangeset = (
  nextTemplateInput: unknown,
  previousTemplateInput?: unknown,
): Changeset => {
  const nextTemplate = CloudFormationTemplateSchema.parse(nextTemplateInput);
  const previousTemplate = previousTemplateInput
    ? CloudFormationTemplateSchema.parse(previousTemplateInput)
    : CloudFormationTemplateSchema.parse({});

  const logicalIds = new Set([
    ...Object.keys(previousTemplate.Resources),
    ...Object.keys(nextTemplate.Resources),
  ]);

  const resources: Change[] = [];

  for (const logicalId of [...logicalIds].sort()) {
    const previousResource = previousTemplate.Resources[logicalId];
    const nextResource = nextTemplate.Resources[logicalId];

    if (!previousResource && nextResource) {
      resources.push({
        logicalId,
        resourceType: nextResource.Type,
        action: 'create',
        properties: nextResource.Properties ?? {},
      });
      continue;
    }

    if (previousResource && !nextResource) {
      resources.push({
        logicalId,
        resourceType: previousResource.Type,
        action: 'delete',
        properties: previousResource.Properties ?? {},
      });
      continue;
    }

    if (!previousResource || !nextResource) {
      continue;
    }

    if (
      previousResource.Type !== nextResource.Type ||
      hasShallowPropertyChanges(
        normalizeProperties(previousTemplate, logicalId),
        normalizeProperties(nextTemplate, logicalId),
      )
    ) {
      resources.push({
        logicalId,
        resourceType: nextResource.Type,
        action: 'modify',
        properties: nextResource.Properties ?? {},
      });
    }
  }

  return ChangesetSchema.parse({ resources });
};
