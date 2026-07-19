import type { DiffRenderModel } from './types';

interface ChangesetResource {
  logicalId: string;
  resourceType: string;
  action: 'create' | 'modify' | 'delete';
}

interface Changeset {
  resources: ChangesetResource[];
}

const colorByAction = {
  create: 'green',
  modify: 'blue',
  delete: 'red',
} as const;

export const buildDiffFromChangeset = (changeset?: Changeset): DiffRenderModel | undefined => {
  if (!changeset?.resources?.length) {
    return undefined;
  }

  const created = changeset.resources.filter((resource) => resource.action === 'create').length;
  const modified = changeset.resources.filter((resource) => resource.action === 'modify').length;
  const deleted = changeset.resources.filter((resource) => resource.action === 'delete').length;

  return {
    summary: `${created} new resources, ${modified} existing, ${deleted} deletions`,
    resources: changeset.resources.map((resource) => ({
      ...resource,
      color: colorByAction[resource.action],
    })),
  };
};
