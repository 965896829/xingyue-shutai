import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from 'electron';
import { userDataDirectory } from '../electron/window-appearance';
import { brand } from '../src/shared/brand';

export function prepareEvaluationProfile(app: App, settingsDirectory = userDataDirectory(app.getPath('appData'), process.env.WENXU_DATA_DIR)) {
  const workspace = process.env.XINGYUE_TEST_OUTPUT;
  const temporary = fs.mkdtempSync(path.join(workspace ?? os.tmpdir(), 'xingyue-eval-profile-'));
  const cleanup = () => fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  try {
    if (process.platform === 'win32') {
      const state = path.join(settingsDirectory, 'Local State');
      if (fs.existsSync(state)) fs.copyFileSync(state, path.join(temporary, 'Local State'));
    }
    app.setPath('userData', temporary);
    app.setPath('sessionData', temporary);
    app.setName(brand.name);
  } catch (error) {
    cleanup();
    throw error;
  }
  // The test workspace is removed by the parent after Chromium finishes writing.
  if (!workspace) process.once('exit', cleanup);
  return settingsDirectory;
}
