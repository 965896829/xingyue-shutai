import fs from 'node:fs';
import path from 'node:path';
import { commandContracts } from '../shared/contracts';
import { ApplicationError } from '../shared/errors';
import { storageFileName } from '../shared/file-names';
import { newProjectLocationError } from '../shared/project-location';
import type { BookSpec, TagCatalog } from '../shared/tags';
import { id, newProject } from './domain';
import { validateExpressionSelection } from './expression-rules';
import { bookProfilePath, renderBookProfile, resolveBookProfile } from './publishing';
import { ProjectCommitService } from './runtime/commit-kernel';
import { initialFiles } from './skill';
import { createProjectDirectory, FileStore } from './storage';
import { makeBookSpec, makeCreationSpec } from './tags';
import { validateBookTitle } from './title-naming';

export function createProjectArchive(input: unknown, skillRoot: string, catalog: TagCatalog) {
  const args = commandContracts['project.create'].input.parse(input);
  if (args.tagInput && args.creationInput) throw new Error('请只提交一份开书输入');
  if (args.bookProfile && (args.creationInput?.bookProfile || args.tagInput?.bookProfile))
    throw new Error('请只提交一份创作与发布分类');
  if (!args.tagInput && !args.creationInput && !args.premise.trim()) throw new Error('原有创建方式需要填写原始设定');
  const suppliedTitle = args.title?.trim();
  if (args.creationInput && suppliedTitle) throw new Error('统一开书流程请先确认作品方案，再确定书名');
  const title = suppliedTitle || `待定书名-${id().slice(0, 8)}`;
  validateBookTitle(title);
  const locationError = newProjectLocationError(path.resolve(args.parent));
  if (locationError) throw new ApplicationError('VALIDATION_ERROR', locationError);

  const prefix = `《${storageFileName(title)}》`;
  let root = path.join(args.parent, prefix + '创作档案');
  if (fs.existsSync(root)) root = path.join(args.parent, `${prefix}-${id().slice(0, 8)}创作档案`);
  if (fs.existsSync(root)) throw new Error('同名作品目录已存在，请改名或打开');

  const project = newProject(title, root, args.config ?? {});
  validateExpressionSelection(skillRoot, project.config);
  const rawProfile = args.bookProfile ?? args.creationInput?.bookProfile ?? args.tagInput?.bookProfile;
  const profile = rawProfile ? resolveBookProfile(rawProfile, catalog.publishingSnapshots ?? []) : null;
  if (profile) project.config.genre = profile.profile.creativeGenres.join('、') || '未限定';
  if (!suppliedTitle) project.titlePending = true;
  project.revision = 1;

  let draft: BookSpec | undefined;
  if (args.creationInput) {
    project.creationWorkflow = 2;
    project.schemaVersion = 3;
    project.tagEnabled = !!args.creationInput.selection.reading.main || !!args.creationInput.bookProfile?.publishing;
    draft = makeCreationSpec(project, args.creationInput, 1, catalog);
  } else if (args.tagInput) {
    project.tagEnabled = true;
    project.schemaVersion = 2;
    draft = makeBookSpec(project, args.tagInput, 1, catalog);
  }

  const premise = args.creationInput?.premise ?? args.tagInput?.premise ?? args.premise;
  const files = initialFiles(project, skillRoot, premise);
  if (profile) files[bookProfilePath] = renderBookProfile(profile.profile, profile.catalog);
  return createProjectDirectory(root, staged => {
    const store = new FileStore(staged);
    try {
      if (draft) store.db.set('tagDraft', draft);
      const changes = Object.entries(files).map(([path, content]) => ({ path, content, baseHash: null }));
      new ProjectCommitService(store).commit(changes, project);
      store.db.set('premise', premise);
    } finally { store.close(); }
  });
}
