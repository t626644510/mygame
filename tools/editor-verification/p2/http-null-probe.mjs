import assert from 'node:assert/strict';
import path from 'node:path';
import { P2HttpContext, clone } from './http-context.mjs';
import { snapshotFiles, writeJson } from './evidence.mjs';

const test = new P2HttpContext(process.argv.slice(2));
let failure;
try {
  await test.initialize(); await test.start('optional-budget-null');
  await test.phase('Schema.OptionalRunBudgetNullIsNotFieldAbsence', async () => {
    const trialId = (await test.import('default.json')).trialId;
    const current = await test.get('trial', trialId); const candidate = clone(current.json); candidate.runBudget = null;
    const before = await snapshotFiles(test.content);
    const pure = await test.api('/api/validate-entity', 'POST', { type: 'trial', mode: 'update', entity: candidate });
    const afterPure = await snapshotFiles(test.content);
    assert.deepEqual(afterPure, before, 'Pure validation wrote files.');
    const fresh = await test.get('trial', trialId);
    const put = await test.api(`/api/content/trial/${trialId}`, 'PUT', candidate, { 'If-Match': fresh.response.headers.etag });
    const afterPut = await snapshotFiles(test.content);
    const evidence = { pureStatus: pure.status, putStatus: put.status, pureDirectoryUnchanged: JSON.stringify(before) === JSON.stringify(afterPure), putDirectoryUnchanged: JSON.stringify(before) === JSON.stringify(afterPut), before, afterPure, afterPut,
      expected: 'trial.schema.json permits an optional object; null is neither an object nor a removed field. Both endpoints must return 422 without writes.' };
    await writeJson(path.join(test.output, 'RUN_BUDGET_NULL.json'), evidence);
    test.require422(pure, 'runBudget'); test.require422(put, 'runBudget'); assert.deepEqual(afterPut, before);
    return 'RUN_BUDGET_NULL.json';
  });
} catch (error) {
  failure = { check: test.activeCheck, category: test.activeCheck === 'Preflight' ? 'HarnessOrEnvironmentPrecondition' : 'AcceptanceFailure_RequiresProductHarnessEnvironmentTriage', message: error.message, stack: error.stack };
}
process.exitCode = await test.finish(failure) ? 0 : 1;
