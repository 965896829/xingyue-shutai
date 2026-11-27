import path from 'node:path';

export const testOutputRoot = path.resolve(process.env.XINGYUE_TEST_OUTPUT ?? '.test-output');
export const acceptanceOutputRoot = path.resolve(process.env.XINGYUE_ACCEPTANCE_OUTPUT ?? testOutputRoot);
