import { Changeset, DiffRenderModel, DiffRenderModelSchema } from './schemas.js';

const colorByAction = {
  create: 'green',
  modify: 'blue',
  delete: 'red',
} as const;

export const buildDiffRenderModel = (changeset: Changeset): DiffRenderModel => {
  const created = changeset.resources.filter((resource) => resource.action === 'create').length;
  const modified = changeset.resources.filter((resource) => resource.action === 'modify').length;
  const deleted = changeset.resources.filter((resource) => resource.action === 'delete').length;

  return DiffRenderModelSchema.parse({
    summary: `${created} new resources, ${modified} existing, ${deleted} deletions`,
    resources: changeset.resources.map((resource) => ({
      ...resource,
      color: colorByAction[resource.action],
    })),
  });
};
