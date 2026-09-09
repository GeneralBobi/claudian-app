'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async ({ win, core, app, home }) => {
  const output = process.env.CLAUDIAN_SMOKE_OUTPUT || path.join(core.dataDir, 'smoke-output');
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const js = source => win.webContents.executeJavaScript(source);
  const waitFor = async source => {
    const until = Date.now() + 15000;
    while (Date.now() < until) { if (await js(source)) return; await new Promise(r => setTimeout(r, 80)); }
    throw new Error('UI timeout: ' + source);
  };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const screenshot = async name => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise(r => setTimeout(r, 120));
    // The hidden window's compositor can lag the first DOM frame on Windows.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await fs.writeFile(path.join(output, name), (await win.webContents.capturePage()).toPNG()); return; }
      catch (e) { if (attempt === 4) throw e; await new Promise(r => setTimeout(r, 150)); }
    }
  };
  try {
    await waitFor('Boolean(document.querySelector("#name"))');
    await screenshot('01-setup.png');
    const vault = path.join(home, 'Hafıza Örneği');
    await js(`document.querySelector('#name').value = 'Deniz'; document.querySelector('#vault').value = ${JSON.stringify(vault)};`);
    await js('document.querySelectorAll("[name=host]").forEach(x => x.checked = true)');
    await click('[data-action=preview]');
    await waitFor('Boolean(document.querySelector("[data-action=install]"))');
    await screenshot('02-preview.png');
    await click('[data-action=install]');
    await waitFor('Boolean(document.querySelector("[data-action=enter]"))');
    await screenshot('02-complete.png');
    assert.equal(await js('Boolean(document.querySelector("nav"))'), false);
    await click('[data-action=enter]');
    await waitFor('Boolean(document.querySelector("[data-action=challenge]"))');
    assert.equal((await core.snapshot()).profile.hosts.length, 2);
    await screenshot('03-dashboard.png');
    await click('[data-action=challenge][data-host=codex]');
    await waitFor('Boolean(document.querySelector(".prompt"))');
    const h = (await core.snapshot()).profile.hosts.find(h => h.id === 'codex');
    // Simulate the host's filesystem operation; this is not a claim of real AI invocation.
    const input = await fs.readFile(h.challenge.input, 'utf8');
    const token = input.split('Doğrulama değeri: ')[1].trim();
    await fs.writeFile(h.challenge.output, token);
    await click('[data-action=verify][data-host=codex]');
    await waitFor('document.querySelector("#content").textContent.includes("Erişim testi geçti")');
    await screenshot('04-verified.png');
    await click('[data-view=companion]');
    await waitFor('document.querySelector("#content").textContent.includes("henüz hazır değil")');
    await screenshot('05-companion.png');
    // Reload the renderer; a committed setup must reopen in the panel.
    await win.loadURL('claudian://app/index.html');
    await waitFor('Boolean(document.querySelector("[data-action=challenge]"))');
    assert.equal(await js('typeof require'), 'undefined');
    assert.equal(await js('typeof process'), 'undefined');
    assert.equal(await js('document.querySelector("#error").hidden'), true);
    assert.deepEqual(errors, []);
    await win.webContents.executeJavaScript('document.fonts.ready');
    assert.equal(await js('document.fonts.check("700 30px Poppins")'), true);
    win.setMinimumSize(256, 256); win.setContentSize(256, 256);
    await js('document.body.classList.add("icon-preview")');
    await screenshot('app-icon.png');
    const png = (await win.webContents.capturePage()).resize({ width:256, height:256 }).toPNG();
    const ico = Buffer.alloc(22); ico.writeUInt16LE(1,2); ico.writeUInt16LE(1,4); ico.writeUInt16LE(1,10); ico.writeUInt16LE(32,12); ico.writeUInt32LE(png.length,14); ico.writeUInt32LE(22,18);
    await fs.writeFile(path.join(output,'icon.ico'),Buffer.concat([ico,png]));
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, packaged: app.isPackaged,
      checks: ['wizard', 'preview', 'install', 'profile persistence', 'challenge roundtrip (simulated host)', 'companion disclosure', 'renderer isolation'],
      dataDir: core.dataDir, errors }, null, 2));
    console.log('SMOKE PASS ' + output); app.exit(0);
  } catch (error) {
    await screenshot('failure.png');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, error: error.stack, errors }, null, 2));
    console.error(error); app.exit(1);
  }
};
