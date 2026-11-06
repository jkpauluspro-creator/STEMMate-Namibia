
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdtemp, copyFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// Find an available test port.
async function findFreePort() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  await new Promise(resolve => server.close(resolve));

  return port;
}

// Start an isolated copy of the receiving server.
async function startReceiver(folder, port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: folder,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';

  child.stdout.on('data', data => {
    output += data.toString();
  });

  child.stderr.on('data', data => {
    output += data.toString();
  });

  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) {
      throw new Error('Receiver exited early: ' + output);
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/received`,
        { signal: AbortSignal.timeout(400) }
      );

      if (response.ok) return child;

    } catch {
      // The receiver may still be starting.
    }

    await delay(100);
  }

  child.kill();

  throw new Error('Receiver did not start: ' + output);
}

async function stopReceiver(child) {
  if (
    !child ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  const exited = once(child, 'exit');

  child.kill();
  await exited;
}

// Send one synthetic session plan.
async function postPlan(baseUrl, plan) {
  return fetch(`${baseUrl}/api/plans`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(plan)
  });
}

let tempFolder;
let port;
let baseUrl;
let receiver;
let firstReceipt;

// Fictional test data, not learner information.
const plan = {
  id: randomUUID(),
  activityId: 'act-water',
  activityTitle: 'Water Filtration Challenge',
  title: 'Automated Test Plan (synthetic)',
  duration: 35,
  steps: 'Prepare filter, pour water, compare observations.',
  safety: 'Do not drink filtered water.',
  createdAt: new Date().toISOString()
};

// Prepare an isolated server before testing.
before(async () => {
  tempFolder = await mkdtemp(
    path.join(tmpdir(), 'stemmate-test-')
  );

  await copyFile(
    path.join(__dirname, '..', 'server.js'),
    path.join(tempFolder, 'server.js')
  );

  port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  receiver = await startReceiver(tempFolder, port);
});

// Remove temporary files when testing finishes.
after(async () => {
  await stopReceiver(receiver);

  if (tempFolder) {
    await rm(tempFolder, {
      recursive: true,
      force: true
    });
  }
});

// AT01: A valid plan must be accepted.
test('AT01: valid plan is accepted and acknowledged', async () => {
  const response = await postPlan(baseUrl, plan);

  assert.equal(response.status, 200);

  firstReceipt = await response.json();

  assert.equal(firstReceipt.id, plan.id);

  assert.ok(
    firstReceipt.receivedAt,
    'Receipt must include a timestamp'
  );
});

// AT02: An invalid plan must be rejected.
test('AT02: invalid plan is rejected and not stored', async () => {
  const invalidPlan = {
    ...plan,
    id: randomUUID(),
    duration: 0
  };

  const response = await postPlan(baseUrl, invalidPlan);

  assert.equal(response.status, 400);

  const listResponse = await fetch(
    `${baseUrl}/api/received`
  );

  const data = await listResponse.json();

  assert.equal(
    data.count,
    1,
    'Invalid plan must not be saved'
  );
});

// AT03: Repeated submission must not create duplicates.
test('AT03: retrying same plan does not create duplicates', async () => {
  const response = await postPlan(baseUrl, plan);

  assert.equal(response.status, 200);

  const receipt = await response.json();

  assert.equal(
    receipt.receivedAt,
    firstReceipt.receivedAt
  );

  const listResponse = await fetch(
    `${baseUrl}/api/received`
  );

  const data = await listResponse.json();

  assert.equal(
    data.count,
    1,
    'Duplicate plan must not be added'
  );
});

// AT04: Stored data must survive a server restart.
test('AT04: plan remains stored after receiver restart', async () => {
  await stopReceiver(receiver);

  receiver = await startReceiver(tempFolder, port);

  const response = await fetch(
    `${baseUrl}/api/received`
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.count, 1);
  assert.equal(data.plans[0].id, plan.id);
  assert.equal(data.plans[0].title, plan.title);
});
