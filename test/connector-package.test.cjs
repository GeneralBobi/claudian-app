'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {entries,zip}=require('../connector-package.cjs');
test('both provider packages use the actual endpoint and the shared application protocol',()=>{
  for(const provider of ['chatgpt','claude-desktop']) {
    const url='https://relay.example/d/123/'+provider+'/mcp',files=entries({provider,url});
    assert.equal(JSON.parse(files['.mcp.json']).mcpServers.claudian.url,url);
    assert.ok(files['skills/claudian-memory/SKILL.md'].includes(require('../policy.cjs').protocol('en')));
    assert.ok(!JSON.stringify(files).includes('Boran'));assert.ok(!JSON.stringify(files).includes('Desktop\\'));
    const archive=zip(files);assert.equal(archive.readUInt32LE(0),0x04034b50);assert.equal(archive.readUInt32LE(archive.length-22),0x06054b50);
  }
});
test('packages refuse endpoints containing credentials or insecure remote URLs',()=>{
  for(const url of ['http://relay.example/mcp','https://token@relay.example/mcp','https://relay.example/mcp?token=secret'])assert.throws(()=>entries({provider:'chatgpt',url}));
});
